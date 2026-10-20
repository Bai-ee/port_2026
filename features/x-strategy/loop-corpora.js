// Server-only: the corpora the daily loop reads, from the stored rows (x_corpora) with committed-JSON fallback.
// The loop must never fail because the rows store is down: a throwing store falls back to the committed loader.
import { withProfileDefaults } from './route-handlers.js';
import { normalizeHandle, defaultLoadCommitted } from './corpus-store.js';

const COMMITTED_LABELS = Object.freeze({
  bai_ee: 'docs/audits/bai-ee-x-corpus.json',
  seb__design: 'docs/audits/seb-design-x-corpus.json',
});

// Labels name the handle and row count so two readers of the same store can never disagree silently.
const noRows = (handle) => `no stored rows for @${handle}`;
const NO_OWN = 'no own X handle on record for this client';
const NO_BENCH = 'no benchmark handle on record for this client';

function pulledDate(meta) {
  const t = meta?.pulledAt ? new Date(meta.pulledAt) : null;
  return t && !Number.isNaN(t.getTime()) ? t.toISOString().slice(0, 10) : 'unknown';
}

function committedLabel(handle, rows) {
  const file = COMMITTED_LABELS[handle];
  return file && rows.length ? `committed file ${file}` : noRows(handle);
}

async function readOne(handle, { corpusStore, loadCommitted }) {
  let stored;
  try {
    stored = await corpusStore.readRows(handle);
  } catch {
    let rows = [];
    try {
      const c = loadCommitted(handle);
      rows = Array.isArray(c) ? c : [];
    } catch { rows = []; }
    return { rows, source: `${committedLabel(handle, rows)} (rows store unavailable)` };
  }
  const rows = Array.isArray(stored?.rows) ? stored.rows : [];
  if (stored?.source === 'firestore') {
    if (stored.meta?.source === 'committed-json') {
      const file = COMMITTED_LABELS[handle];
      return { rows, source: `committed file ${file || handle} (seeded in rows store)` };
    }
    return { rows, source: `rows store, ${rows.length} rows for @${handle}, pulled ${pulledDate(stored.meta)}` };
  }
  return { rows, source: committedLabel(handle, rows) };
}

/**
 * @param {object} p
 * @param {{readRows:(h:string)=>Promise<{rows:object[],meta:object|null,source:string}>}} p.corpusStore
 * @param {{ownHandle?:string, benchmarkHandles?:string[]}} [p.profileHandles]  resolved xGrowth profile. No handle defaults:
 *   a missing own handle => own [] + ownHandle null; no benchmark => benchmark null + benchmarkHandle null (no report).
 * @param {(handle:string)=>object[]|null} [p.loadCommitted]  committed loader used only when the store throws
 * @returns {Promise<{own:object[],benchmark:object[]|null,ownSource:string,benchmarkSource:string,ownHandle:string|null,benchmarkHandle:string|null}>}
 */
export async function loadLoopCorpora({ corpusStore, profileHandles, loadCommitted = defaultLoadCommitted } = {}) {
  if (!corpusStore || typeof corpusStore.readRows !== 'function') throw new Error('loadLoopCorpora: corpusStore is required');
  const profile = withProfileDefaults(profileHandles || {});
  const safe = (h) => { try { return h ? normalizeHandle(h) : null; } catch { return null; } };
  const ownHandle = safe(profile.ownHandle);
  const benchmarkHandle = safe(profile.benchmarkHandles[0]);
  const deps = { corpusStore, loadCommitted };
  const [own, bench] = await Promise.all([
    ownHandle ? readOne(ownHandle, deps) : { rows: [], source: NO_OWN },
    benchmarkHandle ? readOne(benchmarkHandle, deps) : { rows: null, source: NO_BENCH },
  ]);
  return {
    own: own.rows, benchmark: bench.rows, ownSource: own.source, benchmarkSource: bench.source, ownHandle, benchmarkHandle,
  };
}

/**
 * The loop's corpora for ONE client, keyed on that client's own X handle (resolveClientXHandle). With no handle on
 * record the own corpus is EMPTY and ownHandle null (the saved profile's ownHandle is not consulted: the resolved
 * account handle decides). The benchmark side uses the client's saved profile only; none => no benchmark.
 * @param {object} p  loadLoopCorpora's args plus `ownHandle` (string|null)
 */
export async function loadClientLoopCorpora({ ownHandle, profileHandles, ...rest } = {}) {
  const corpora = await loadLoopCorpora({ ...rest, profileHandles: { ...(profileHandles || {}), ownHandle: ownHandle || null } });
  if (!ownHandle) return { ...corpora, own: [], ownHandle: null, ownSource: NO_OWN };
  // The connected X account decides the own handle; say so when it is not the handle saved in xGrowth.
  const configured = profileHandles?.ownHandle ? String(profileHandles.ownHandle).replace(/^@+/, '').toLowerCase() : null;
  const resolved = String(ownHandle).replace(/^@+/, '').toLowerCase();
  if (configured && configured !== resolved) {
    return { ...corpora, ownHandleMismatch: `Own handle @${resolved} comes from the connected X account, but xGrowth.ownHandle is @${configured}: check Social Accounts > X for this client.` };
  }
  return corpora;
}

/**
 * Profile handles for the loop, never throwing: a failed config read/resolve yields {} (no handles => no corpora,
 * never another account's). Only a failing STORE read falls back to committed files, per handle.
 * @param {()=>Promise<object|null>|object|null} readConfig  reads the client's xGrowth config
 * @param {(arg:{config:object|null})=>object} resolveProfile  e.g. resolveXGrowthProfile
 */
export async function safeProfileHandles(readConfig, resolveProfile) {
  try { return resolveProfile({ config: (await readConfig()) ?? null }) || {}; } catch { return {}; }
}

/**
 * Per-track corpora for the loop: for each track, the stored rows of ITS benchmark handles (never pooled across tracks).
 * Same store-first / committed-fallback rule as loadLoopCorpora; the primary path above is untouched.
 * @param {object} p
 * @param {{readRows:(h:string)=>Promise<object>}} p.corpusStore
 * @param {{id:string, benchmarks:string[]}[]} p.tracks
 * @returns {Promise<Record<string,{handles:string[], byHandle:Record<string,{rows:object[], source:string}>}>>}  keyed by track id
 */
export async function loadTrackCorpora({ corpusStore, tracks, loadCommitted = defaultLoadCommitted } = {}) {
  if (!corpusStore || typeof corpusStore.readRows !== 'function') throw new Error('loadTrackCorpora: corpusStore is required');
  const deps = { corpusStore, loadCommitted };
  const cache = new Map();
  const out = {};
  for (const track of Array.isArray(tracks) ? tracks : []) {
    const handles = [];
    const byHandle = {};
    for (const raw of track.benchmarks || []) {
      let h;
      try { h = normalizeHandle(raw); } catch { continue; }
      if (!cache.has(h)) cache.set(h, readOne(h, deps));
      handles.push(h);
      byHandle[h] = await cache.get(h);
    }
    out[track.id] = { handles, byHandle };
  }
  return out;
}
