// Strategy corpus refresh service (T1b). SERVER-ONLY (pulls in ingest.js -> node:child_process); never import from index.js.
//
// Contract (docs/plans/X-STRATEGY-TAB-MASTER-PLAN.md T1b + x-strategy-t0-spikes.md):
//  - A refresh is ALWAYS async: requestRefresh() writes x_strategy_refresh_requests/{id} {status:'queued'} and returns.
//    If bird is detected on this machine AND X_STRATEGY_LOCAL_INGEST=1 it also starts draining in-process
//    (fire-and-forget; `result.drain` is a non-enumerable promise tests/callers MAY await). Otherwise the Mac
//    worker (scripts/x-content/strategy-refresh-worker.mjs) calls drainQueue().
//  - Sequential per handle. First 429 -> request 'rate-limited', remaining handles 'skipped', no more bird calls.
//    EPERM (cookie access) -> request 'bird-unavailable', remaining 'skipped'.
//  - Lease = conditional status transition queued -> running({leaseId, startedAt, leaseAt}). Every later write is
//    guarded on (status==='running' && leaseId===mine) and bumps leaseAt (heartbeat). A 'running' whose leaseAt
//    (legacy docs: startedAt) is older than 30 min is reclaimable by a new leaseId; the old worker's next guarded
//    write fails and it stops without more bird calls. A reclaimed request resumes: 'done' handles are not re-pulled.
//  - One open request per client: a re-request with a clientId merges its handles into that client's
//    still-'queued' request (guarded update; falls back to a new doc if a worker claimed it or it would overflow).
//  - Writes only: the queue store (x_strategy_refresh_requests/*) and the injected corpus store's writeMergedRows.
//  - bird detection is `bird --version` only: no network, no auth.

import { randomUUID } from 'node:crypto';
import { STRATEGY_COLLECTIONS, PLAN_LIMITS } from './contracts.js';
import { HANDLE_RE } from './plan-state.js'; // single source of the handle regex (client-safe module)
import { ingestHandle, createAsyncBirdRunner, resolveBird, probeBirdVersion, BIRD_FAILURE } from './ingest.js';

export const STALE_RUNNING_MS = 30 * 60 * 1000;
export { HANDLE_RE };

export const REQUEST_STATUS = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  DONE: 'done',
  PARTIAL: 'partial',
  FAILED: 'failed',
  RATE_LIMITED: 'rate-limited',
  BIRD_UNAVAILABLE: 'bird-unavailable',
});

const badRequest = (message, code) => Object.assign(new Error(message), { status: 400, code });

/** Normalize + dedupe + validate. Throws status-400 errors. -> lowercase handles in first-seen order. */
export function normalizeRefreshHandles(handles) {
  if (!Array.isArray(handles) || !handles.length) throw badRequest('handles must be a non-empty array.', 'NO_HANDLES');
  const out = [];
  for (const raw of handles) {
    const h = String(raw ?? '').trim().replace(/^@+/, '');
    if (!HANDLE_RE.test(h)) throw badRequest(`Invalid X handle: "${String(raw).slice(0, 40)}".`, 'BAD_HANDLE');
    const key = h.toLowerCase();
    if (!out.includes(key)) out.push(key);
  }
  if (out.length > PLAN_LIMITS.maxHandlesPerRefreshRequest) {
    throw badRequest(`At most ${PLAN_LIMITS.maxHandlesPerRefreshRequest} handles per refresh request.`, 'TOO_MANY_HANDLES');
  }
  return out;
}

// ---- queue stores: identical interface ------------------------------------------------------------------
// create(doc) -> doc | get(id) -> doc|null | update(id, patch, {when}) -> doc|null (null = missing or `when(doc)` false;
// the check + write are atomic) | listQueued({now, staleMs}) -> docs oldest-createdAt first: queued + stale running.

const isStale = (d, now, staleMs) => d.status === REQUEST_STATUS.RUNNING && now - Date.parse(d.leaseAt || d.startedAt || 0) > staleMs;
const claimable = (d, now, staleMs) => d.status === REQUEST_STATUS.QUEUED || isStale(d, now, staleMs);
const byCreated = (a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);

export function createMemoryRefreshQueue() {
  const docs = new Map();
  const copy = (d) => (d ? structuredClone(d) : null);
  return {
    async create(doc) {
      if (docs.has(doc.id)) throw new Error(`refresh request ${doc.id} already exists`);
      docs.set(doc.id, copy(doc));
      return copy(doc);
    },
    async get(id) { return copy(docs.get(id)); },
    async update(id, patch, { when } = {}) {
      const cur = docs.get(id);
      if (!cur || (when && !when(copy(cur)))) return null;
      const next = { ...cur, ...structuredClone(patch) };
      docs.set(id, next);
      return copy(next);
    },
    async listQueued({ now = Date.now(), staleMs = STALE_RUNNING_MS } = {}) {
      return [...docs.values()].filter((d) => claimable(d, now, staleMs)).sort(byCreated).map(copy);
    },
    async findOpenQueued(clientId) {
      return copy([...docs.values()].filter((d) => openFor(d, clientId)).sort(byCreated)[0] || null);
    },
  };
}

// An unclaimed request for this client: a re-request merges into it instead of queueing a duplicate.
const openFor = (d, clientId) => !!clientId && d?.status === REQUEST_STATUS.QUEUED && d.clientId === clientId;

export function createFirestoreRefreshQueue(db) {
  const col = () => db.collection(STRATEGY_COLLECTIONS.refreshRequests);
  return {
    async create(doc) { await col().doc(doc.id).create(doc); return doc; },
    async get(id) { const s = await col().doc(id).get(); return s.exists ? s.data() : null; },
    async update(id, patch, { when } = {}) {
      const ref = col().doc(id);
      return db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        if (!s.exists) return null;
        const cur = s.data();
        if (when && !when(cur)) return null;
        tx.update(ref, patch);
        return { ...cur, ...patch };
      });
    },
    // Two single-field equality queries (no composite index); staleness + ordering done in memory. A status
    // equality query combined with orderBy on another field (createdAt) would require a composite index, so we
    // do NOT orderBy server-side; limit is raised to 200 per status so oldest-first sorting stays meaningful.
    async listQueued({ now = Date.now(), staleMs = STALE_RUNNING_MS } = {}) {
      const [q, r] = await Promise.all([
        col().where('status', '==', REQUEST_STATUS.QUEUED).limit(200).get(),
        col().where('status', '==', REQUEST_STATUS.RUNNING).limit(200).get(),
      ]);
      return [...q.docs, ...r.docs].map((s) => s.data()).filter((d) => claimable(d, now, staleMs)).sort(byCreated);
    },
    // Single-field equality + in-memory clientId filter (no composite index), oldest first.
    async findOpenQueued(clientId) {
      const q = await col().where('status', '==', REQUEST_STATUS.QUEUED).limit(200).get();
      return q.docs.map((s) => s.data()).filter((d) => openFor(d, clientId)).sort(byCreated)[0] || null;
    },
  };
}

// ---- worker heartbeat ------------------------------------------------------------------------------------
// The Mac worker writes x_strategy_workers/{workerId} on every poll (even with an empty queue). The app only reads it.
// It proves "the worker polled at T", nothing more: no claim of online/offline is made from it.

export const WORKER_COLLECTION = 'x_strategy_workers';
export const WORKER_VERSION = 'strategy-refresh-worker/1';
export const WORKER_STALE_AFTER_MINUTES = 15;

const toMs = (v) => (typeof v === 'number' ? v : v instanceof Date ? v.getTime() : Date.parse(v));

/** Upsert the heartbeat doc (merge). lastRequestId is only written when a request id is given, so an idle poll keeps the last one. */
export async function recordWorkerSeen(db, { workerId, now = Date.now(), requestId = null } = {}) {
  const id = String(workerId || '').trim();
  if (!id || id.includes('/')) throw new Error('recordWorkerSeen: a valid workerId is required');
  const at = new Date(toMs(now)).toISOString();
  const doc = { lastSeenAt: at, lastPollAt: at, version: WORKER_VERSION, ...(requestId ? { lastRequestId: String(requestId) } : {}) };
  await db.collection(WORKER_COLLECTION).doc(id).set(doc, { merge: true });
  return doc;
}

/**
 * Honest worker signal. state: 'recent' (seen <= 15 min ago) | 'stale' | 'never' (no heartbeat doc at all).
 * oldestQueuedAgeMinutes counts only status==='queued' requests carrying THIS clientId (legacy requests without one are ignored).
 * Single-field equality reads only (no composite index).
 */
export async function readWorkerHealth(db, { now = Date.now(), clientId = null } = {}) {
  const nowMs = toMs(now);
  const [workers, queued] = await Promise.all([
    db.collection(WORKER_COLLECTION).limit(50).get(),
    clientId ? db.collection(STRATEGY_COLLECTIONS.refreshRequests).where('status', '==', REQUEST_STATUS.QUEUED).limit(200).get() : Promise.resolve({ docs: [] }),
  ]);
  const seen = workers.docs.map((d) => toMs(d.data()?.lastSeenAt)).filter(Number.isFinite);
  const last = seen.length ? Math.max(...seen) : null;
  const created = queued.docs.map((d) => d.data()).filter((d) => d.clientId === clientId).map((d) => toMs(d.createdAt)).filter(Number.isFinite);
  const oldest = created.length ? Math.min(...created) : null;
  const ageMinutes = last === null ? null : Math.max(0, Math.floor((nowMs - last) / 60000));
  return {
    lastSeenAt: last === null ? null : new Date(last).toISOString(),
    ageMinutes,
    state: last === null ? 'never' : ageMinutes > WORKER_STALE_AFTER_MINUTES ? 'stale' : 'recent',
    staleAfterMinutes: WORKER_STALE_AFTER_MINUTES,
    oldestQueuedAgeMinutes: oldest === null ? null : Math.max(0, Math.floor((nowMs - oldest) / 60000)),
  };
}

// ---- service ---------------------------------------------------------------------------------------------

/**
 * @param {Object} o
 * @param {{writeMergedRows:(handle:string,rows:object[],meta:{pulledAt:string,source:string})=>Promise<{before:number,after:number,added:number,updated:number,viewsBefore:number,viewsAfter:number}>}} o.store  corpus store (T1a)
 * @param {ReturnType<typeof createMemoryRefreshQueue>} o.queueStore
 * @param {()=>Promise<{available:boolean,path?:string,version?:string|null,error?:string}>} [o.detectBird]
 * @param {()=>((args:string[])=>string|Promise<string>)} [o.runBirdFor]  called once per drain
 * @param {()=>number} [o.now]
 * @param {boolean|(()=>boolean)} [o.enabled]  in-process draining switch; default env X_STRATEGY_LOCAL_INGEST==='1'
 * @param {(handle:string)=>object} [o.ingestOptionsFor]  extra ingestHandle opts (tz, days, lanes, rounds)
 * @param {typeof ingestHandle} [o.ingest]
 * @param {()=>string} [o.idGen]
 * @param {(line:string)=>void} [o.log]
 */
export function createRefreshService({
  store,
  queueStore,
  detectBird = async () => probeBirdVersion(),
  runBirdFor = () => createAsyncBirdRunner({ bird: resolveBird(), cookieSource: process.env.X_STRATEGY_BIRD_COOKIE_SOURCE || 'chrome' }),
  now = Date.now,
  enabled = () => process.env.X_STRATEGY_LOCAL_INGEST === '1',
  ingestOptionsFor = () => ({}),
  ingest = ingestHandle,
  idGen = randomUUID,
  log = () => {},
} = {}) {
  if (!store || typeof store.writeMergedRows !== 'function') throw new Error('createRefreshService: store.writeMergedRows is required');
  if (!queueStore) throw new Error('createRefreshService: queueStore is required');

  const iso = () => new Date(now()).toISOString();
  const isEnabled = () => (typeof enabled === 'function' ? !!enabled() : !!enabled);

  async function drainRequest(id) {
    const leaseId = randomUUID();
    const claimed = await queueStore.update(
      id,
      { status: REQUEST_STATUS.RUNNING, startedAt: iso(), leaseAt: iso(), leaseId },
      { when: (d) => claimable(d, now(), STALE_RUNNING_MS) },
    );
    if (!claimed) return { claimed: false, request: await queueStore.get(id) };

    // Every post-claim write is guarded on still owning the lease and doubles as a heartbeat.
    const mine = (d) => d.status === REQUEST_STATUS.RUNNING && d.leaseId === leaseId;
    const write = (patch) => queueStore.update(id, patch, { when: mine });
    const lost = async () => ({ claimed: true, lost: true, request: await queueStore.get(id) });

    const results = { ...(claimed.results || {}) };
    let stop = null; // REQUEST_STATUS.RATE_LIMITED | BIRD_UNAVAILABLE
    try {
      // Queue docs are untrusted input: re-validate before anything is spawned.
      let handles;
      try {
        handles = normalizeRefreshHandles(claimed.handles);
      } catch (err) {
        log(`refresh ${id} has invalid handles: ${err?.message}`);
        const request = await write({ status: REQUEST_STATUS.FAILED, finishedAt: iso(), error: `invalid handles: ${String(err?.message || err).slice(0, 200)}` });
        return request ? { claimed: true, request } : lost();
      }
      const runBird = runBirdFor();
      for (const handle of handles) {
        if (results[handle]?.status === 'done') continue; // resumed after a reclaim
        if (stop) { results[handle] = { status: 'skipped' }; continue; }
        if (!(await write({ leaseAt: iso() }))) return lost(); // heartbeat + ownership check BEFORE any bird call
        results[handle] = await pullOne(handle, runBird);
        const kind = results[handle].errorKind;
        if (kind === BIRD_FAILURE.RATE_LIMITED) stop = REQUEST_STATUS.RATE_LIMITED;
        else if (kind === BIRD_FAILURE.COOKIE_ACCESS) stop = REQUEST_STATUS.BIRD_UNAVAILABLE;
        if (!(await write({ results, leaseAt: iso() }))) return lost(); // progress is visible while running
      }
      const vals = handles.map((h) => results[h]);
      const status = stop
        || (vals.every((r) => r.status === 'done') ? REQUEST_STATUS.DONE
          : vals.some((r) => r.status === 'done' || r.status === 'partial') ? REQUEST_STATUS.PARTIAL : REQUEST_STATUS.FAILED);
      const request = await write({ status, results, finishedAt: iso() });
      return request ? { claimed: true, request } : lost();
    } catch (err) {
      log(`refresh ${id} crashed: ${err?.message}`);
      const request = await write({ status: REQUEST_STATUS.FAILED, results, finishedAt: iso(), error: String(err?.message || err).slice(0, 300) });
      return request ? { claimed: true, request } : lost();
    }
  }

  async function pullOne(handle, runBird) {
    let res;
    try {
      res = await ingest({ handle, runBird, log, now: now(), ...ingestOptionsFor(handle) });
    } catch (err) {
      if (err?.code === 'NO_POSTS') {
        const e = err.pull?.error;
        return { status: 'failed', added: 0, updated: 0, rowCount: 0, viewsBefore: 0, viewsAfter: 0, error: e?.message || err.message, errorKind: e?.kind || BIRD_FAILURE.OTHER };
      }
      return { status: 'failed', added: 0, updated: 0, rowCount: 0, viewsBefore: 0, viewsAfter: 0, error: String(err?.message || err).slice(0, 300), errorKind: BIRD_FAILURE.OTHER };
    }
    // Rows pulled before a mid-pull error are KEPT: merge them, then report the error.
    let merged;
    try {
      merged = await store.writeMergedRows(handle, res.rows, { pulledAt: iso(), source: 'bird' });
    } catch (err) {
      return { status: 'failed', added: 0, updated: 0, rowCount: 0, viewsBefore: 0, viewsAfter: 0, error: `store write failed: ${String(err?.message || err).slice(0, 200)}`, errorKind: BIRD_FAILURE.OTHER };
    }
    const base = { added: merged.added, updated: merged.updated, rowCount: merged.after, viewsBefore: merged.viewsBefore, viewsAfter: merged.viewsAfter };
    if (res.pull?.error) return { status: 'partial', ...base, error: res.pull.error.message, errorKind: res.pull.error.kind };
    return { status: 'done', ...base };
  }

  /** Merge `list` into this client's open queued request; null when there is none, it would overflow, or a worker claimed it first. */
  async function mergeIntoOpen(clientId, list) {
    if (!clientId || typeof queueStore.findOpenQueued !== 'function') return null;
    const open = await queueStore.findOpenQueued(clientId);
    if (!open) return null;
    const merged = [...new Set([...(open.handles || []), ...list])];
    if (merged.length > PLAN_LIMITS.maxHandlesPerRefreshRequest) return null;
    const patch = merged.length === (open.handles || []).length ? { requeuedAt: iso() } : { handles: merged, requeuedAt: iso() };
    // Guard on the handles we merged from too: a concurrent merge in between makes ours fall back to a new doc.
    const same = (d) => JSON.stringify(d.handles || []) === JSON.stringify(open.handles || []);
    const updated = await queueStore.update(open.id, patch, { when: (d) => openFor(d, clientId) && same(d) });
    return updated ? open.id : null;
  }

  async function requestRefresh({ handles, requestedBy, clientId } = {}) {
    const list = normalizeRefreshHandles(handles);
    const mergedId = await mergeIntoOpen(clientId, list);
    const id = mergedId || idGen();
    if (!mergedId) await queueStore.create({ id, handles: list, status: REQUEST_STATUS.QUEUED, requestedBy: requestedBy || null, ...(clientId ? { clientId } : {}), createdAt: iso(), results: {} });
    const out = { requestId: id, status: REQUEST_STATUS.QUEUED, ...(mergedId ? { merged: true } : {}) };
    if (isEnabled()) {
      const det = await detectBird().catch(() => ({ available: false }));
      if (det?.available) {
        const drain = drainRequest(id).catch((err) => { log(`in-process drain failed: ${err?.message}`); return null; });
        Object.defineProperty(out, 'drain', { value: drain, enumerable: false });
      }
    }
    return out;
  }

  const getRequestStatus = (id) => queueStore.get(id);

  /** Worker entry: detect bird (no network), then drain queued/stale requests oldest-first. */
  async function drainQueue({ max = 10 } = {}) {
    const det = await detectBird().catch((err) => ({ available: false, error: String(err?.message || err) }));
    if (!det?.available) return { processed: 0, reason: 'bird-unavailable', requests: [] };
    const pending = (await queueStore.listQueued({ now: now(), staleMs: STALE_RUNNING_MS })).slice(0, max);
    const requests = [];
    for (const p of pending) {
      const r = await drainRequest(p.id);
      if (r.claimed) requests.push({ id: p.id, status: r.request?.status });
    }
    return { processed: requests.length, requests };
  }

  return { detectBird: () => detectBird(), requestRefresh, drainRequest, getRequestStatus, drainQueue };
}
