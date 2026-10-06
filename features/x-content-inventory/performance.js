// Performance feedback loop (Active Content System Phase 4).
//
// Pure: joins posted social_posts rows to captured X metrics and summarises per
// engine / series. No fs, no network, no clock (pass `now`).
//
// HONESTY RULES
// - n < MIN_N (5) is flagged `insufficient`; such groups are never ranked and
//   never get a trend.
// - A capture is a single snapshot, not a velocity series. The first 2h decide
//   reach (x-2026-10-03 profile) but a daily capture cannot see them; only
//   `ageHoursAtCapture` is recorded so callers can see how mature a number is.
// - `views` can be null (bird does not always return it). Null is "unknown",
//   never 0, and is excluded from view medians.

import { resolveEngine } from './engines.js';

export const MIN_N = 5;
/** Verified ranking weights (x-2026-10-03.json): reply/quote 5, repost 1, like 0.5. */
export const VALUE_WEIGHTS = { replies: 5, quotes: 5, reposts: 1, likes: 0.5 };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? null : t; }
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  return null;
}

export function median(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Weighted engagement. Missing counts are 0 here (an absent like is no like). */
export function valueScore(m) {
  if (!m) return null;
  let s = 0;
  for (const [k, w] of Object.entries(VALUE_WEIGHTS)) s += (num(m[k]) ?? 0) * w;
  return s;
}

function normMetrics(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const m = {
    views: num(raw.views),
    likes: num(raw.likes),
    replies: num(raw.replies),
    reposts: num(raw.reposts ?? raw.retweets),
    quotes: num(raw.quotes),
    bookmarks: num(raw.bookmarks),
    capturedAt: raw.capturedAt ?? null,
  };
  const any = ['views', 'likes', 'replies', 'reposts', 'quotes', 'bookmarks'].some((k) => m[k] != null);
  return any ? m : null;
}

function lookup(timeline, id) {
  if (!timeline || !id) return null;
  if (Array.isArray(timeline)) return timeline.find((t) => String(t.id ?? t.twitterId) === String(id)) || null;
  return timeline[id] || null;
}

/**
 * @param {object} input
 * @param {object[]} input.posts     social_posts rows
 * @param {object|object[]} [input.timeline] metrics by tweet id (map or array)
 * @param {object[]} [input.packages] used for engine/series fallback via packageId
 * @returns {object[]} rows for posted posts that have a twitterId. `metrics` is
 *   null when nothing has been captured yet (kept so callers can count gaps).
 */
export function joinPerformance({ posts = [], timeline = null, packages = [] } = {}) {
  const pkgById = new Map((packages || []).map((p) => [p.id, p]));
  const rows = [];
  for (const post of posts || []) {
    if (!post?.twitterId) continue;
    if (post.status && post.status !== 'posted') continue;
    const pkg = post.packageId ? pkgById.get(post.packageId) : null;
    const series = post.series || pkg?.series || null;
    const engine = post.engine || (pkg ? resolveEngine(pkg) : null) || (series ? resolveEngine({ series }) : 'untagged');
    const metrics = normMetrics(lookup(timeline, post.twitterId)) || normMetrics(post.performance);
    const postedMs = toMs(post.postedAt);
    const capMs = toMs(metrics?.capturedAt);
    rows.push({
      id: post.id ?? null,
      twitterId: post.twitterId,
      packageId: post.packageId ?? null,
      engine,
      series,
      postedAt: postedMs != null ? new Date(postedMs).toISOString() : null,
      metrics,
      valueScore: valueScore(metrics),
      ageHoursAtCapture: postedMs != null && capMs != null ? Math.round(((capMs - postedMs) / HOUR) * 10) / 10 : null,
    });
  }
  return rows;
}

function summarize(rows, prevRows) {
  const measured = rows.filter((r) => r.metrics);
  const withViews = measured.filter((r) => r.metrics.views != null);
  const n = rows.length;
  const sumViews = withViews.reduce((a, r) => a + r.metrics.views, 0);
  const sumReplies = withViews.reduce((a, r) => a + (r.metrics.replies ?? 0), 0);
  const insufficient = measured.length < MIN_N;
  const medianViews = median(withViews.map((r) => r.metrics.views));
  const sorted = [...withViews].sort((a, b) => b.metrics.views - a.metrics.views);
  const brief = (r) => (r ? { id: r.id, twitterId: r.twitterId, packageId: r.packageId, views: r.metrics.views, valueScore: r.valueScore } : null);

  let trend = { state: 'insufficient', pct: null };
  if (!insufficient && prevRows) {
    const prevMeasured = prevRows.filter((r) => r.metrics?.views != null);
    const prevMedian = median(prevMeasured.map((r) => r.metrics.views));
    if (prevMeasured.length >= MIN_N && prevMedian > 0 && medianViews != null) {
      const pct = Math.round(((medianViews - prevMedian) / prevMedian) * 100);
      trend = { state: pct > 10 ? 'up' : pct < -10 ? 'down' : 'flat', pct };
    }
  }

  return {
    n,
    measured: measured.length,
    insufficient,
    medianViews,
    medianLikes: median(measured.map((r) => r.metrics.likes)),
    medianValue: median(measured.map((r) => r.valueScore)),
    // Replies per 1,000 views over posts with known views; null when unknowable.
    replyRate: sumViews > 0 ? Math.round((sumReplies / sumViews) * 100000) / 100 : null,
    best: insufficient ? null : brief(sorted[0]),
    worst: insufficient ? null : brief(sorted[sorted.length - 1]),
    trend,
  };
}

function group(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = r[key] || 'untagged';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

/**
 * @param {object[]} rows  joinPerformance output
 * @param {{windowDays?:number, now?:number|string|Date}} [opts] windowDays null/0 = all time
 *   (no trend). `now` is required for a windowed read to be deterministic.
 */
export function engineStats(rows = [], { windowDays = 30, now = Date.now() } = {}) {
  const nowMs = toMs(now instanceof Date ? now.getTime() : now) ?? Date.now();
  const at = (r) => toMs(r.postedAt);
  let cur = rows;
  let prev = null;
  if (windowDays > 0) {
    const from = nowMs - windowDays * DAY;
    const prevFrom = from - windowDays * DAY;
    cur = rows.filter((r) => at(r) != null && at(r) >= from && at(r) <= nowMs);
    prev = rows.filter((r) => at(r) != null && at(r) >= prevFrom && at(r) < from);
  }
  const build = (key) => {
    const curG = group(cur, key);
    const prevG = prev ? group(prev, key) : null;
    const out = {};
    for (const [k, list] of curG) out[k] = summarize(list, prevG ? prevG.get(k) || [] : null);
    return out;
  };
  const engines = build('engine');
  // Rank only on groups with enough measured posts, by median value score.
  const rankable = Object.entries(engines)
    .filter(([, s]) => !s.insufficient && s.medianValue != null)
    .sort((a, b) => b[1].medianValue - a[1].medianValue);
  rankable.forEach(([k], i) => { engines[k].rank = i + 1; });
  for (const s of Object.values(engines)) if (s.rank == null) s.rank = null;
  return {
    windowDays: windowDays || null,
    minN: MIN_N,
    engines,
    series: build('series'),
    unmeasured: cur.filter((r) => !r.metrics).length,
    total: cur.length,
  };
}
