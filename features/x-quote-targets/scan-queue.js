// Quote-target scan requests for the Mac worker (Refresh group "Quote targets" on the free Mac source).
//
// The server cannot reach the Mac (bird needs its browser cookies), so a dashboard Refresh writes
// x_quote_scan_requests/{id} {status:'queued'} and the Mac refresh worker (scripts/x-content/strategy-refresh-worker.mjs,
// launchd every 60 s) claims it, runs scripts/x-content/scan-quote-targets.mjs --client <id> --write, and records the
// outcome. Same semantics as the strategy refresh queue (features/x-strategy/refresh.js), kept separate because that
// queue is per-handle corpus pulls:
//  - One open request per client: a second Refresh while one is queued/running returns that one (no duplicate scans).
//  - Claim = transaction queued -> running {leaseId, startedAt}; a 'running' older than 30 min is reclaimable.
//  - finish() only writes when the lease still matches.
// Single-field equality queries only (no composite index).

import { randomUUID } from 'node:crypto';

export const QUOTE_SCAN_COLLECTION = 'x_quote_scan_requests';
export const SCAN_STATUS = Object.freeze({ QUEUED: 'queued', RUNNING: 'running', DONE: 'done', FAILED: 'failed', RATE_LIMITED: 'rate-limited' });
export const SCAN_STALE_RUNNING_MS = 30 * 60 * 1000;
export const SCAN_TERMINAL = Object.freeze([SCAN_STATUS.DONE, SCAN_STATUS.FAILED, SCAN_STATUS.RATE_LIMITED]);

const toMs = (v) => (typeof v === 'number' ? v : Date.parse(v || ''));
const isOpen = (d, now) => d && (d.status === SCAN_STATUS.QUEUED || (d.status === SCAN_STATUS.RUNNING && now - toMs(d.startedAt) < SCAN_STALE_RUNNING_MS));
const isClaimable = (d, now) => d && (d.status === SCAN_STATUS.QUEUED || (d.status === SCAN_STATUS.RUNNING && !(now - toMs(d.startedAt) < SCAN_STALE_RUNNING_MS)));

export function createFirestoreQuoteScanQueue(db, { now = Date.now, idGen = randomUUID } = {}) {
  const col = () => db.collection(QUOTE_SCAN_COLLECTION);
  const iso = () => new Date(now()).toISOString();

  /** Queue a scan for this client, or return its already-open one. */
  async function request({ clientId, requestedBy = null } = {}) {
    if (!clientId) throw Object.assign(new Error('clientId is required.'), { status: 400 });
    const open = await col().where('clientId', '==', clientId).limit(20).get();
    const live = open.docs.map((d) => d.data()).filter((d) => isOpen(d, now())).sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))[0];
    if (live) return { requestId: live.id, status: live.status, reused: true };
    const id = idGen();
    await col().doc(id).set({ id, clientId, status: SCAN_STATUS.QUEUED, requestedBy: requestedBy ? String(requestedBy).slice(0, 200) : null, createdAt: iso() });
    return { requestId: id, status: SCAN_STATUS.QUEUED };
  }

  async function get(id) {
    if (!id || String(id).includes('/')) return null;
    const snap = await col().doc(String(id)).get();
    return snap.exists ? snap.data() : null;
  }

  /** Worker: claim the oldest queued (or stale running) request. null when there is nothing to do. */
  async function claimNext() {
    const [queued, running] = await Promise.all([
      col().where('status', '==', SCAN_STATUS.QUEUED).limit(20).get(),
      col().where('status', '==', SCAN_STATUS.RUNNING).limit(20).get(),
    ]);
    const candidates = [...queued.docs, ...running.docs].map((d) => d.data()).filter((d) => isClaimable(d, now()))
      .sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt));
    for (const c of candidates) {
      const leaseId = idGen();
      const ref = col().doc(c.id);
      const claimed = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const cur = snap.exists ? snap.data() : null;
        if (!isClaimable(cur, now())) return null;
        const next = { ...cur, status: SCAN_STATUS.RUNNING, leaseId, startedAt: iso() };
        tx.set(ref, next);
        return next;
      });
      if (claimed) return claimed;
    }
    return null;
  }

  /** Worker: record the outcome, only while still holding the lease. */
  async function finish(id, leaseId, patch) {
    const ref = col().doc(String(id));
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const cur = snap.exists ? snap.data() : null;
      if (!cur || cur.status !== SCAN_STATUS.RUNNING || cur.leaseId !== leaseId) return false;
      tx.set(ref, { ...cur, ...patch, finishedAt: iso() });
      return true;
    });
  }

  return { request, get, claimNext, finish };
}
