// Server-only: the corpora the daily loop reads, from the stored rows (x_corpora) with committed-JSON fallback.
// The loop must never fail because the rows store is down: a throwing store falls back to the committed loader.
import { withDefaultPair } from './route-handlers.js';
import { normalizeHandle, defaultLoadCommitted } from './corpus-store.js';

const COMMITTED_LABELS = Object.freeze({
  bai_ee: 'docs/audits/bai-ee-x-corpus.json',
  seb__design: 'docs/audits/seb-design-x-corpus.json',
});

const NO_ROWS = 'no stored rows';

function pulledDate(meta) {
  const t = meta?.pulledAt ? new Date(meta.pulledAt) : null;
  return t && !Number.isNaN(t.getTime()) ? t.toISOString().slice(0, 10) : 'unknown';
}

function committedLabel(handle, rows) {
  const file = COMMITTED_LABELS[handle];
  return file && rows.length ? `committed file ${file}` : NO_ROWS;
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
    return { rows, source: `rows store, pulled ${pulledDate(stored.meta)}` };
  }
  return { rows, source: committedLabel(handle, rows) };
}

/**
 * @param {object} p
 * @param {{readRows:(h:string)=>Promise<{rows:object[],meta:object|null,source:string}>}} p.corpusStore
 * @param {{ownHandle?:string, benchmarkHandles?:string[]}} [p.profileHandles]  resolved xGrowth profile; missing fields default to bai_ee / seb__design
 * @param {(handle:string)=>object[]|null} [p.loadCommitted]  committed loader used only when the store throws
 * @returns {Promise<{own:object[],benchmark:object[],ownSource:string,benchmarkSource:string,ownHandle:string,benchmarkHandle:string}>}
 */
export async function loadLoopCorpora({ corpusStore, profileHandles, loadCommitted = defaultLoadCommitted } = {}) {
  if (!corpusStore || typeof corpusStore.readRows !== 'function') throw new Error('loadLoopCorpora: corpusStore is required');
  const profile = withDefaultPair(profileHandles || {});
  const safe = (h) => { try { return normalizeHandle(h); } catch { return null; } };
  const ownHandle = safe(profile.ownHandle) || 'bai_ee';
  const benchmarkHandle = safe(profile.benchmarkHandles[0]) || 'seb__design';
  const deps = { corpusStore, loadCommitted };
  const [own, bench] = await Promise.all([readOne(ownHandle, deps), readOne(benchmarkHandle, deps)]);
  return {
    own: own.rows, benchmark: bench.rows, ownSource: own.source, benchmarkSource: bench.source, ownHandle, benchmarkHandle,
  };
}

/**
 * Profile handles for the loop, never throwing: a failed config read/resolve yields {} so loadLoopCorpora uses the
 * default pair (the rows store is still used). Only a failing STORE read falls back to committed files, per handle.
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
