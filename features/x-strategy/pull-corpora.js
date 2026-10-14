// Per-client benchmark corpus pull (multi-client F3). SERVER-ONLY (the default fetcher pulls in ingest.js ->
// node:child_process); never import from index.js or a client component. CLI: scripts/x-content/pull-corpora.mjs.
//
// For each client: read client_configs/{id}.marketingBriefConfig.xGrowth.{ownHandle, benchmarkHandles}, pull each
// handle's timeline through `bird` (local, free: browser cookies, no X API) and merge the rows into the shared
// handle-keyed corpus store x_corpora/{handle}/rows/* (writeMergedRows: merge by id, never drops stored rows,
// an empty pull writes nothing). The bird -> row conversion is ingestHandle (same as the refresh worker).
//
// Rules:
//  - No handle defaults: a client with no xGrowth handles is skipped (never the home handles).
//  - Handles are pulled once per run even when several clients share one (corpora are keyed by handle).
//  - Sequential. First rate-limit (429) or cookie-access failure stops all further bird calls; the rest are 'skipped'.
//  - Dry run (write:false) never calls writeMergedRows; it pulls only when `fetch` is true.

import { normalizeHandle } from './corpus-store.js';
import { ingestHandle, BIRD_FAILURE } from './ingest.js';

/**
 * Own + benchmark handles from a raw xGrowth config (pure). Normalized (lowercase, no @), invalid entries dropped,
 * de-duplicated (a benchmark equal to the own handle is dropped).
 * @param {{ownHandle?:string, benchmarkHandles?:string[]}|null|undefined} xGrowth
 * @returns {{own:string|null, benchmarks:string[], handles:string[], invalid:string[]}}
 */
export function resolveHandles(xGrowth) {
  const invalid = [];
  const norm = (v) => {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    try { return normalizeHandle(v); } catch { invalid.push(String(v).slice(0, 40)); return null; }
  };
  const own = norm(xGrowth?.ownHandle);
  const benchmarks = [];
  for (const raw of Array.isArray(xGrowth?.benchmarkHandles) ? xGrowth.benchmarkHandles : []) {
    const h = norm(raw);
    if (h && h !== own && !benchmarks.includes(h)) benchmarks.push(h);
  }
  return { own, benchmarks, handles: [...(own ? [own] : []), ...benchmarks], invalid };
}

/** Raw marketingBriefConfig.xGrowth for one client (Firestore read only); null when absent. */
export async function readClientXGrowth(db, clientId) {
  if (!clientId || typeof clientId !== 'string' || clientId.includes('/')) return null;
  const snap = await db.collection('client_configs').doc(clientId).get();
  return snap.exists ? snap.data()?.marketingBriefConfig?.xGrowth ?? null : null;
}

/**
 * Default fetcher: ingestHandle over a bird runner. -> {rows, error|null}; error = {kind, message}.
 * Rows pulled before a mid-pull error are kept (error reported alongside), same as the refresh worker.
 */
export function createBirdFetchTimeline({ runBird, days, log = () => {}, now = Date.now, ingest = ingestHandle } = {}) {
  return async (handle) => {
    try {
      const res = await ingest({ handle, runBird, log, now: now(), ...(days ? { days } : {}) });
      return { rows: res.rows, error: res.pull?.error || null };
    } catch (err) {
      const e = err?.pull?.error;
      return { rows: [], error: { kind: e?.kind || BIRD_FAILURE.OTHER, message: String(e?.message || err?.message || err).slice(0, 300) } };
    }
  };
}

const STOP_KINDS = new Set([BIRD_FAILURE.RATE_LIMITED, BIRD_FAILURE.COOKIE_ACCESS]);

/**
 * @param {Object} o
 * @param {string[]} o.clients
 * @param {(clientId:string)=>Promise<object|null>} o.readXGrowth   raw xGrowth per client
 * @param {{readRows:Function, writeMergedRows:Function}} o.store  corpus store
 * @param {(handle:string)=>Promise<{rows:object[], error:null|{kind:string,message:string}}>} [o.fetchTimeline]
 * @param {boolean} [o.write=false]
 * @param {boolean} [o.fetch=false]   dry run only: pull (but do not write) to report row counts
 * @param {(ms:number)=>Promise<void>} [o.sleep]
 * @param {number} [o.delayMs=0]   pause between bird pulls (shared rate limit)
 * @param {()=>number} [o.now]
 * @param {(line:string)=>void} [o.log]
 * @returns {Promise<{clients:object[], handles:object, skippedClients:number, pulled:number, failedPulls:number, stopped:string|null, exitCode:number}>}
 */
export async function runPull({
  clients, readXGrowth, store, fetchTimeline, write = false, fetch = false,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), delayMs = 0, now = Date.now, log = () => {},
} = {}) {
  if (!Array.isArray(clients) || !clients.length) throw new Error('runPull: clients is required');
  if (typeof readXGrowth !== 'function') throw new Error('runPull: readXGrowth is required');
  if (!store) throw new Error('runPull: store is required');
  const pulls = write || fetch;
  if (pulls && typeof fetchTimeline !== 'function') throw new Error('runPull: fetchTimeline is required to pull');

  const clientResults = [];
  const handles = {}; // handle -> result (shared across clients)
  let skippedClients = 0;
  let stopped = null;
  let pullCount = 0;

  for (const clientId of clients) {
    let resolved;
    try {
      resolved = resolveHandles(await readXGrowth(clientId));
    } catch (err) {
      log(`[${clientId}] ERROR reading xGrowth: ${String(err?.message || err).slice(0, 200)} — skipped.`);
      skippedClients += 1;
      clientResults.push({ clientId, skipped: 'read-failed', handles: [] });
      continue;
    }
    if (resolved.invalid.length) log(`[${clientId}] ignoring invalid handle(s): ${resolved.invalid.join(', ')}`);
    if (!resolved.handles.length) {
      log(`[${clientId}] no xGrowth handles (client_configs/${clientId}.marketingBriefConfig.xGrowth.ownHandle / benchmarkHandles) — skipped, nothing pulled.`);
      skippedClients += 1;
      clientResults.push({ clientId, skipped: 'no-handles', handles: [] });
      continue;
    }
    log(`[${clientId}] own ${resolved.own ? `@${resolved.own}` : '(none)'} · benchmarks ${resolved.benchmarks.length ? resolved.benchmarks.map((h) => `@${h}`).join(', ') : '(none)'}`);

    for (const handle of resolved.handles) {
      if (handles[handle]) { log(`  @${handle}: already handled this run (${handles[handle].status})`); continue; }
      const stored = await store.readRows(handle).catch(() => ({ rows: [], source: 'unreadable' }));
      const base = { storedRows: stored.rows.length, storedSource: stored.source };
      if (!pulls) {
        handles[handle] = { status: 'resolved', ...base };
        log(`  @${handle}: stored ${base.storedRows} rows (${base.storedSource}); dry run, not pulled (add --fetch to pull, --write to persist)`);
        continue;
      }
      if (stopped) {
        handles[handle] = { status: 'skipped', reason: stopped, ...base };
        log(`  @${handle}: skipped (${stopped})`);
        continue;
      }
      if (pullCount > 0 && delayMs > 0) await sleep(delayMs);
      pullCount += 1;
      const res = await fetchTimeline(handle);
      const rows = Array.isArray(res?.rows) ? res.rows : [];
      const error = res?.error || null;
      if (error && STOP_KINDS.has(error.kind)) stopped = error.kind;
      if (!rows.length) {
        handles[handle] = { status: 'failed', pulledRows: 0, error, ...base };
        log(`  @${handle}: FAILED${error ? ` (${error.kind}: ${error.message})` : ' (no rows)'}`);
        continue;
      }
      const status = error ? 'partial' : 'done';
      if (!write) {
        handles[handle] = { status, pulledRows: rows.length, error, wouldWrite: true, ...base };
        log(`  @${handle}: pulled ${rows.length} rows; would merge into ${base.storedRows} stored (DRY RUN)`);
        continue;
      }
      try {
        const merged = await store.writeMergedRows(handle, rows, { pulledAt: new Date(now()).toISOString(), source: 'bird' });
        handles[handle] = { status, pulledRows: rows.length, error, added: merged.added, updated: merged.updated, rowCount: merged.after, wrote: merged.wrote !== false, ...base };
        log(`  @${handle}: pulled ${rows.length}, +${merged.added} new, ${merged.updated} updated -> ${merged.after} rows${error ? ` (partial: ${error.message})` : ''}`);
      } catch (err) {
        handles[handle] = { status: 'failed', pulledRows: rows.length, error: { kind: 'store', message: String(err?.message || err).slice(0, 200) }, ...base };
        log(`  @${handle}: store write FAILED: ${String(err?.message || err).slice(0, 200)}`);
      }
    }
    clientResults.push({ clientId, own: resolved.own, benchmarks: resolved.benchmarks, handles: resolved.handles });
  }

  const vals = Object.values(handles);
  const failedPulls = vals.filter((h) => h.status === 'failed' || h.status === 'skipped').length;
  const succeeded = vals.filter((h) => h.status === 'done' || h.status === 'partial').length;
  // Non-zero when every client was skipped (misconfiguration), or a pulling run got nothing at all (environment
  // problem: bird missing / cookies / rate limit), so the launchd log shows it instead of corpora going stale.
  const allSkipped = skippedClients === clients.length;
  const nothingPulled = pulls && vals.length > 0 && succeeded === 0;
  return { clients: clientResults, handles, skippedClients, pulled: succeeded, failedPulls, stopped, exitCode: allSkipped || nothingPulled ? 1 : 0 };
}
