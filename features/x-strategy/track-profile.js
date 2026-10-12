// track-profile.js - per-track benchmark profiles + track -> engine allocation (content tracks, plan section 4.1).
// Pure except loadTrackProfiles, which reads rows through an INJECTED corpusStore (no Firestore/bird/network here).
//
// A track's profile is computed ONLY from the rows of that track's own benchmark handles (pooled), using the
// existing x-benchmark summarizer. Nothing is averaged across tracks. A track with no benchmarks reports
// { status:'no-benchmark', fallback:'own-history' } and shows the owner's own rows instead - a visible gap,
// never invented numbers. Old plans (no explicit plan.contentTracks) are untouched: allocation is a no-op for them.

import { summarizeCorpus, MIN_CLASS_N } from '../x-benchmark/summarize.js';
import { mergeEngineConfig, raiseEngineMinimums } from '../x-content-inventory/engine-quota.js';
import { ENGINE_IDS } from '../x-content-inventory/engines.js';
import { tracksOf } from './content-tracks.js';

export const TOP_EXAMPLES = 5;
export const BEST_HOURS = 3;
export const MIN_HOUR_N = 3;
const ORIGINAL_TYPES = new Set(['original-showcase', 'original-text']);

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const cleanHandle = (h) => String(h ?? '').trim().replace(/^@+/, '').toLowerCase();
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function planOf(planOrDoc) {
  return isPlain(planOrDoc?.plan) ? planOrDoc.plan : isPlain(planOrDoc) ? planOrDoc : null;
}

/** True only when the plan carries its own contentTracks (the opt-in that turns allocation on). */
export function hasExplicitTracks(planOrDoc) {
  return Array.isArray(planOf(planOrDoc)?.contentTracks);
}

/** Every distinct benchmark handle across tracks, in track order. */
export function trackBenchmarkHandles(tracks) {
  return [...new Set((tracks || []).flatMap((t) => t.benchmarks || []).map(cleanHandle).filter(Boolean))];
}

/** Handles present in `after`'s tracks but not `before`'s: the ones that need a corpus refresh queued. */
export function newTrackBenchmarkHandles(beforePlanOrDoc, afterPlanOrDoc) {
  const before = new Set(trackBenchmarkHandles(tracksOf(beforePlanOrDoc)));
  return trackBenchmarkHandles(tracksOf(afterPlanOrDoc)).filter((h) => !before.has(h));
}

// ---- allocation ---------------------------------------------------------------------------------------------

/**
 * Track share x authored originals -> per-engine minimums. Each track's originals/day is split across the engines it
 * owns by the engine's existing weight (targetPerDay, else weeklyMin/7 - the same signals allocateEngines scores by).
 * Daily-quota engines get `minPerDay`, weekly-quota engines get `weeklyMin`.
 *
 * @param {{tracks:object[], authoredPerDay:number, config?:object}} p  config = merged engine config (defaults if omitted)
 * @returns {{minimums:Record<string,object>, byTrack:{trackId:string, share:number, originalsPerDay:number}[]}}
 */
export function trackEngineMinimums({ tracks, authoredPerDay, config } = {}) {
  const cfg = config ?? mergeEngineConfig({});
  const perDay = Number.isFinite(authoredPerDay) && authoredPerDay > 0 ? authoredPerDay : cfg.authored.targetPerDay;
  const minimums = {};
  const byTrack = [];
  for (const t of tracks || []) {
    const originals = perDay * (Number(t.share) || 0);
    byTrack.push({ trackId: t.id, share: t.share, originalsPerDay: Math.round(originals * 100) / 100 });
    const engines = (t.engines || []).filter((e) => ENGINE_IDS.includes(e));
    const weightOf = (e) => {
      const c = cfg.engines[e] ?? {};
      if (c.targetPerDay > 0) return c.targetPerDay;
      if (c.weeklyMin > 0) return c.weeklyMin / 7;
      return 1;
    };
    const total = engines.reduce((s, e) => s + weightOf(e), 0);
    if (!total || originals <= 0) continue;
    for (const e of engines) {
      const part = (originals * weightOf(e)) / total;
      const weekly = (cfg.engines[e] ?? {}).weeklyMin != null;
      minimums[e] = weekly ? { weeklyMin: Math.round(part * 7) } : { minPerDay: Math.floor(part) };
    }
  }
  return { minimums, byTrack };
}

/**
 * Engine config for a plan, with track minimums merged in. NO explicit contentTracks => returns `engineConfig`
 * exactly as given (undefined stays undefined), so old plans behave as before. Never lowers a cap or floor.
 */
export function applyTrackAllocation(planOrDoc, engineConfig) {
  if (!hasExplicitTracks(planOrDoc)) return engineConfig;
  const plan = planOf(planOrDoc);
  const base = engineConfig ?? mergeEngineConfig(isPlain(plan.engineTargets) ? plan.engineTargets : {});
  const authoredPerDay = Number.isInteger(plan.authoredPerDay) ? plan.authoredPerDay : base.authored.targetPerDay;
  const { minimums } = trackEngineMinimums({ tracks: tracksOf(planOrDoc), authoredPerDay, config: base });
  return raiseEngineMinimums(base, minimums);
}

// ---- profiles -----------------------------------------------------------------------------------------------

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(s.length / 2) - 1))];
}

function shares(block) {
  return Object.fromEntries(Object.entries(block || {}).map(([k, v]) => [k, v.share]));
}

/** Share of original posts whose own thread has a self-reply carrying a link. null when the rows hold no replies at all. */
function linkReplyCounts(rows) {
  const originals = rows.filter((r) => ORIGINAL_TYPES.has(r.type));
  const hasReplies = rows.some((r) => r.type === 'reply');
  const linked = new Set(rows.filter((r) => r.type === 'reply' && r.hasLink && r.conversationId).map((r) => String(r.conversationId)));
  return {
    originals: originals.length,
    withLinkReply: originals.filter((r) => linked.has(String(r.id))).length,
    observable: hasReplies,
  };
}

/** Compact metric block for one row set (a handle, or a pooled track). Null-safe: no rows => all metrics null. */
export function computeRowMetrics(rows, { handle = '' } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    return { rows: 0, authoredPosts: 0, formatMix: null, postTypeMix: null, medianLength: null, linkInReplyRate: null, bestHours: [], topExampleIds: [], range: null };
  }
  const summary = summarizeCorpus(list, { handle });
  const authored = list.filter((r) => r.type !== 'retweet' && r.type !== 'reply');
  const lengths = authored.map((r) => num(r.chars)).filter((n) => n != null);
  const lc = linkReplyCounts(list);
  const bestHours = summary.byHour
    .filter((h) => h.n >= MIN_HOUR_N && h.avgLikes != null)
    .sort((a, b) => b.avgLikes - a.avgLikes || b.n - a.n || a.hour - b.hour)
    .slice(0, BEST_HOURS)
    .map((h) => ({ hour: h.hour, n: h.n, avgLikes: h.avgLikes, lift: h.lift }));
  const topExampleIds = [...authored]
    .sort((a, b) => (num(b.likes) ?? 0) - (num(a.likes) ?? 0) || String(a.id).localeCompare(String(b.id)))
    .slice(0, TOP_EXAMPLES)
    .map((r) => String(r.id));
  return {
    rows: list.length,
    authoredPosts: summary.authoredPosts,
    formatMix: shares(summary.byMedia),
    postTypeMix: shares(summary.byType),
    medianLength: median(lengths),
    linkInReplyRate: lc.observable && lc.originals ? Math.round((lc.withLinkReply / lc.originals) * 10000) / 10000 : null,
    bestHours,
    topExampleIds,
    range: summary.cadence.firstDate ? { from: summary.cadence.firstDate, to: summary.cadence.lastDate } : null,
    viewsCoverage: summary.base.viewsCoverage,
  };
}

function ownHistoryRows(track, ownRows) {
  const rows = Array.isArray(ownRows) ? ownRows : [];
  const topics = (track.topics || []).map((t) => t.toLowerCase());
  if (!topics.length) return { rows, scope: 'all-own-rows' };
  const hit = (r) => [...(r.topics || []), ...(r.lanes || [])].some((x) => topics.includes(String(x).toLowerCase()));
  const filtered = rows.filter(hit);
  return filtered.length >= MIN_CLASS_N ? { rows: filtered, scope: 'topic-filtered' } : { rows, scope: 'all-own-rows' };
}

/**
 * One track's profile. `rowsByHandle` maps handle -> rows; ONLY this track's benchmark handles are read from it, so a
 * profile can never include another handle's rows.
 *
 * @param {{track:object, rowsByHandle:Record<string,object[]>, ownRows?:object[], ownHandle?:string}} p
 */
export function buildTrackProfile({ track, rowsByHandle = {}, ownRows = [], ownHandle = '' } = {}) {
  const base = { trackId: track.id, label: track.label, engines: [...track.engines], share: track.share, benchmarks: [...track.benchmarks] };
  if (!track.benchmarks.length) {
    const own = ownHistoryRows(track, ownRows);
    return {
      ...base, status: 'no-benchmark', fallback: 'own-history', source: 'own-history',
      message: 'No benchmark chosen for this track. Add a benchmark handle to profile it; these figures are your own history.',
      scope: own.scope, ownHandle: cleanHandle(ownHandle) || null, needsRefresh: [],
      metrics: computeRowMetrics(own.rows, { handle: ownHandle }), perHandle: [],
    };
  }
  const perHandle = track.benchmarks.map((h) => {
    const key = cleanHandle(h);
    const rows = Array.isArray(rowsByHandle[key]) ? rowsByHandle[key] : Array.isArray(rowsByHandle[h]) ? rowsByHandle[h] : [];
    return { handle: key, rows, metrics: computeRowMetrics(rows, { handle: key }) };
  });
  const pooled = perHandle.flatMap((p) => p.rows);
  const needsRefresh = perHandle.filter((p) => !p.rows.length).map((p) => p.handle);
  const outHandles = perHandle.map(({ handle, metrics }) => ({ handle, ...metrics }));
  if (!pooled.length) {
    return {
      ...base, status: 'no-rows', fallback: null, source: 'benchmark',
      message: 'This track has benchmark handles but no stored rows yet. Run Refresh for them.',
      needsRefresh, metrics: computeRowMetrics([]), perHandle: outHandles,
    };
  }
  return {
    ...base, status: 'ok', fallback: null, source: 'benchmark', needsRefresh,
    metrics: computeRowMetrics(pooled, { handle: track.benchmarks.join('+') }), perHandle: outHandles,
  };
}

/**
 * Profiles for every track. Reads rows only for the handles tracks need (+ own history when a track has no benchmark).
 * A failing read for one handle yields no rows for it (listed in needsRefresh), never a thrown error.
 *
 * @param {{tracks:object[], corpusStore:{readRows:(h:string)=>Promise<{rows:object[]}>}, ownHandle?:string}} p
 * @returns {Promise<object[]>}
 */
export async function loadTrackProfiles({ tracks, corpusStore, ownHandle = '' } = {}) {
  if (!corpusStore || typeof corpusStore.readRows !== 'function') throw new Error('loadTrackProfiles: corpusStore is required');
  const cache = new Map();
  const rowsFor = async (handle) => {
    const key = cleanHandle(handle);
    if (!key) return [];
    if (!cache.has(key)) {
      try { const r = await corpusStore.readRows(key); cache.set(key, Array.isArray(r?.rows) ? r.rows : []); } catch { cache.set(key, []); }
    }
    return cache.get(key);
  };
  const needOwn = (tracks || []).some((t) => !t.benchmarks.length);
  const ownRows = needOwn ? await rowsFor(ownHandle) : [];
  const out = [];
  for (const track of tracks || []) {
    const rowsByHandle = {};
    for (const h of track.benchmarks) rowsByHandle[cleanHandle(h)] = await rowsFor(h);
    out.push(buildTrackProfile({ track, rowsByHandle, ownRows, ownHandle }));
  }
  return out;
}
