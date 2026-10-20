// insights.js - pure shapers for the strategy agent's algorithm / scoring / rule-check / audience tools.
// No I/O and no imports of the scorer or guard: route-handlers.js injects scoreXPost, guardXPost and the
// algorithm profile, so this file stays testable with fakes. Every result states its window and caveats.

const ORIGINAL_TYPES = new Set(['original-showcase', 'original-text', 'self-quote']);
const NOT_AUTHORED = new Set(['retweet', 'reply']);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const median = (xs) => {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const excerpt = (t, n = 140) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const utcOf = (r) => r?.utc ?? r?.createdAt ?? null;
const DAY_MS = 86400000;

function windowOf(rows) {
  const days = rows.map(utcOf).filter(Boolean).map((u) => String(u).slice(0, 10)).sort();
  return days.length ? { from: days[0], to: days[days.length - 1], rows: rows.length } : { from: null, to: null, rows: 0 };
}

/** Rows newer than `days` before `nowMs` (rows without a date are dropped). */
export function recentRows(rows, days, nowMs) {
  const cut = nowMs - days * DAY_MS;
  return (Array.isArray(rows) ? rows : []).filter((r) => { const t = Date.parse(utcOf(r) || ''); return Number.isFinite(t) && t >= cut; });
}

/** Ranking weights + assumptions from an algorithm profile JSON, compacted for the model. */
export function summarizeAlgorithm(profile) {
  if (!profile || typeof profile !== 'object') return { error: 'no algorithm profile' };
  const w = profile.rankingWeights || {};
  const top = (o, n) => Object.entries(o || {}).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, n).map(([k, v]) => ({ signal: k, weight: v }));
  const assumptions = Object.entries(profile.assumptions || {}).map(([k, a]) => ({
    id: k, confidence: a?.confidence ?? null, status: a?.status ?? null,
    hypothesis: excerpt(a?.hypothesis, 220), ...(a?.caveat ? { caveat: excerpt(a.caveat, 160) } : {}),
    ...(a?.suggestedWorkaround ? { workaround: excerpt(a.suggestedWorkaround, 160) } : {}),
  }));
  return {
    profileId: profile.id ?? null,
    reviewedAt: profile.reviewedAt ?? null,
    source: profile.upstream?.repo ? `${profile.upstream.repo} @ ${profile.upstream.commit ?? '?'} (${profile.upstream.commitDate ?? '?'})` : null,
    positive: top(w.positive, 12),
    negative: top(w.negative, 5),
    boosts: w.boosts ?? {},
    multipliers: w.multipliers ?? {},
    coldStart: w.coldStart ?? {},
    video: w.video ?? {},
    assumptions,
    note: 'Weights are the published ranking defaults. They say what the ranker rewards per predicted action, not what any one post will get.',
  };
}

/**
 * Score originals with the injected scorer. Quote-reacts/commentary are skipped on purpose: the scorer models
 * engagement per impression and has no borrowed-reach term, so it ranks them wrongly.
 */
export function scorePosts(rows, { score, handle, limit = 10, days = null, nowMs = Date.now() } = {}) {
  if (typeof score !== 'function') return { error: 'scorer not available' };
  const pool = days ? recentRows(rows, days, nowMs) : (Array.isArray(rows) ? rows : []);
  const originals = pool.filter((r) => ORIGINAL_TYPES.has(r.type) && String(r.text ?? '').trim());
  const scored = originals.map((r) => {
    let s = null;
    try { s = score(String(r.text), { mediaType: r.media || 'none' }); } catch { s = null; }
    return {
      id: r.id ?? null, at: utcOf(r), type: r.type, media: r.media ?? null, text: excerpt(r.text),
      score: num(s?.xGrowthScore), targetAction: s?.targetAction ?? null,
      views: num(r.views), likes: num(r.likes), replies: num(r.replies),
    };
  }).filter((x) => x.score !== null);
  scored.sort((a, b) => b.score - a.score);
  const withViews = scored.filter((x) => x.views !== null);
  const half = Math.floor(withViews.length / 2);
  const byScore = [...withViews].sort((a, b) => b.score - a.score);
  const agreement = withViews.length >= 6
    ? { topHalfMedianViews: median(byScore.slice(0, half).map((x) => x.views)), bottomHalfMedianViews: median(byScore.slice(half).map((x) => x.views)), posts: withViews.length }
    : null;
  const n = Math.min(Math.max(1, Number(limit) || 10), 15);
  return {
    handle: handle ?? null,
    window: windowOf(pool),
    originalsScored: scored.length,
    skipped: pool.length - originals.length,
    medianScore: median(scored.map((x) => x.score)),
    best: scored.slice(0, n),
    worst: scored.length > n ? scored.slice(-Math.min(5, scored.length - n)) : [],
    scoreVsViews: agreement,
    caveats: [
      'Originals only: quote-reacts are skipped because the scorer has no borrowed-reach term.',
      ...(agreement ? [] : ['Too few originals with views to compare score against real reach.']),
    ],
  };
}

/** Run the content guard over the own account's recent authored posts. */
export function ruleCheck(rows, { guard, handle, days = 30, nowMs = Date.now() } = {}) {
  if (typeof guard !== 'function') return { error: 'guard not available' };
  const pool = recentRows(rows, days, nowMs);
  const authored = pool.filter((r) => !NOT_AUTHORED.has(r.type));
  const retweets = pool.filter((r) => r.type === 'retweet').length;
  const flagCounts = {};
  const lanes = {};
  const offenders = [];
  let hardBlocks = 0;
  for (const r of authored) {
    let v = null;
    try { v = guard({ text: r.text, type: r.type, media: r.media, quotedText: r.quotedText }, { handle }); } catch { v = null; }
    if (!v) continue;
    lanes[v.lane] = (lanes[v.lane] || 0) + 1;
    if (v.hardBlock) hardBlocks += 1;
    for (const f of v.flags || []) flagCounts[f.code] = (flagCounts[f.code] || 0) + 1;
    if ((v.hardBlock || (v.flags || []).some((f) => f.severity === 'major')) && offenders.length < 5) {
      offenders.push({ id: r.id ?? null, at: utcOf(r), type: r.type, text: excerpt(r.text), lane: v.lane, flags: (v.flags || []).map((f) => f.code) });
    }
  }
  const links = authored.filter((r) => r.hasLink === true).length;
  return {
    handle: handle ?? null,
    window: { ...windowOf(pool), days },
    authored: authored.length,
    retweets,
    hardBlocks,
    lanes,
    flagCounts,
    linksInMainPost: links,
    offenders,
    caveats: ['Retweets earn no impression and are counted, not judged. Reply text is not on a profile timeline.'],
  };
}

/** Stored X Monitor data (free reads only) -> follower trend, audience events, impressions. */
export function summarizeAudience({ account = null, snapshots = [], events = [], posts = [] } = {}, { days = 30, nowMs = Date.now() } = {}) {
  if (!account) return { available: false, reason: 'X Monitor has no connected account data.' };
  const snaps = (snapshots || []).filter((s) => s && s.date).sort((a, b) => (a.date < b.date ? -1 : 1));
  const first = snaps[0] ?? null;
  const last = snaps[snaps.length - 1] ?? null;
  const recent = recentRows(posts.map((p) => ({ ...p, utc: p.createdAt })), days, nowMs);
  const imps = recent.map((p) => num(p.metrics?.impressions)).filter((x) => x !== null);
  const top = [...recent].filter((p) => num(p.metrics?.impressions) !== null)
    .sort((a, b) => b.metrics.impressions - a.metrics.impressions).slice(0, 5)
    .map((p) => ({ id: p.id, at: p.createdAt, kind: p.kind ?? null, text: excerpt(p.text), impressions: p.metrics.impressions, likes: num(p.metrics.likes), replies: num(p.metrics.replies) }));
  const gained = events.filter((e) => e?.type === 'gained' || e?.kind === 'gained').length;
  const lost = events.filter((e) => e?.type === 'lost' || e?.kind === 'lost').length;
  const syncedAt = Math.max(0, ...[account.sync?.postsAt, account.sync?.profileAt, account.updatedAt].map(Number).filter(Number.isFinite)) || null;
  return {
    available: true,
    handle: account.profile?.username ?? null,
    followersNow: num(account.profile?.followers),
    followerTrend: snaps.length >= 2 ? { from: { date: first.date, followers: first.followers }, to: { date: last.date, followers: last.followers }, change: last.followers - first.followers } : null,
    snapshots: snaps.length,
    audienceEvents: { gained, lost, total: events.length },
    impressions: { source: 'x-monitor', asOf: Number.isFinite(Number(account.sync?.postsAt)) ? new Date(Number(account.sync.postsAt)).toISOString() : null, window: { days, posts: recent.length, withImpressions: imps.length }, median: median(imps), top, note: 'As of the last X Monitor sync; recent posts keep gaining views after it. For views in the last days use get_recent_posts.' },
    lastSync: syncedAt ? new Date(syncedAt).toISOString() : null,
    caveats: [
      ...(snaps.length < 2 ? ['Fewer than two follower snapshots: no follower trend yet. Snapshots only come from a manual X Monitor sync (metered).'] : []),
      ...(imps.length ? [] : ['No posts with impressions in the window.']),
      'Read from stored X Monitor data only; nothing was synced and nothing was spent.',
    ],
  };
}

const pctMix = (mix) => {
  const e = Object.entries(mix || {}).filter(([, v]) => Number.isFinite(v) && v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
  return e.length ? e.map(([k, v]) => `${k} ${Math.round(v)}%`).join(' · ') : 'no mix data';
};
const perDay = (v) => (Number.isFinite(v) ? `${v}/day` : 'n/a');

/**
 * One evaluation.byTrack entry -> three display lines: benchmark profile, Brain/plan target, actual last 14 days.
 * Pure; tolerates entries from before these fields existed (returns null).
 */
export function trackEvalLines(t) {
  if (!t || (!t.target && !t.actual && !t.benchmarkProfile)) return null;
  const bp = t.benchmarkProfile;
  const benchmark = bp
    ? `Benchmark ${bp.handles.map((h) => `@${h}`).join(' + ')}: ${perDay(bp.postsPerDay)} · types ${pctMix(bp.typeMix)} · media ${pctMix(bp.mediaMix)}`
    : t.status === 'no-benchmark' ? 'Benchmark: none for this track' : 'Benchmark: no stored posts yet';
  const tg = t.target;
  const shares = tg?.brainShares ? Object.entries(tg.brainShares).map(([k, v]) => `${k} ${v}%`).join(' · ') : null;
  const target = `Target: ${perDay(tg?.postsPerDay)}${shares ? ` · ${shares}` : ' · per-type shares live in the Brain'}`;
  const a = t.actual;
  const actual = a && a.rows
    ? `Actual last ${a.windowDays} days: ${perDay(a.postsPerDay)} · types ${pctMix(a.typeMix)} · media ${pctMix(a.mediaMix)}${a.scope === 'all-own-rows' ? ' (all your posts, not track-specific)' : ''}`
    : `Actual last ${a?.windowDays ?? 14} days: no posts`;
  return { benchmark, target, actual };
}
