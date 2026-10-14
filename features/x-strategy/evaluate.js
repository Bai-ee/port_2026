// evaluate.js - rows -> Strategy-tab evaluation view model (T2a). Pure, client-safe, no I/O.
// Source: docs/plans/X-STRATEGY-TAB-MASTER-PLAN.md section 5 (Evaluation view model).
//
// All figures come from summarizeCorpus / compareToBenchmark / resolveTier, called the same way
// the gap-report route does (quote-targets handleRefreshAnalysis). Nothing is recomputed here.
//
// Two tiers are exposed on purpose:
//   currentTier     = tierForAuthoredPerDay(plan.authoredPerDay)  the tier the plan sits IN
//   recommendedTier = resolveTier(own authored/day)               the NEXT step up (a recommendation)
// Benchmarks: each is summarized individually; gaps are computed against ONE benchmark
// (plan.benchmarkPrimary if it has rows, else the first benchmark with rows) - never averaged.

import { summarizeCorpus } from '../x-benchmark/summarize.js';
import { compareToBenchmark } from '../x-benchmark/compare.js';
import { resolveTier } from '../x-benchmark/profile.js';
import { DEFAULT_PLAN, EVALUATION_CAVEAT, EVALUATION_THRESHOLDS, tierForAuthoredPerDay } from './contracts.js';
import { buildRowsMeta, freshness } from './corpus-rows.js';
import { normalizePlan } from './plan-state.js';
import { tracksOf } from './content-tracks.js';
import { computeRowMetrics } from './track-profile.js';
import { mergeEngineConfig } from '../x-content-inventory/engine-quota.js';

export const QUOTE_REACT_CAVEAT = 'quote-react-undervalued';
export const MAX_GAPS = 8;

const cleanHandle = (h) => String(h ?? '').trim().replace(/^@+/, '').toLowerCase();
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

function toMs(now) {
  const ms = now === undefined || now === null ? Date.now() : new Date(now).getTime();
  return Number.isFinite(ms) ? ms : Date.now();
}

/** One side of the comparison: stats + provenance. `summary` is the raw summarizeCorpus block (not exposed). */
function buildEntry(handle, rowsIn, meta, nowMs) {
  const rows = Array.isArray(rowsIn) ? rowsIn : [];
  const metaObj = isObj(meta) ? meta : null;
  const derived = buildRowsMeta(rows, { pulledAt: null, source: 'committed-json' });
  const { ageDays, stale } = freshness(metaObj, nowMs);
  const summary = rows.length ? summarizeCorpus(rows, { handle }) : null;
  const range = metaObj?.range && (metaObj.range.from || metaObj.range.to) ? { ...metaObj.range } : derived.range;
  const viewsCoverage = metaObj && Number.isFinite(metaObj.viewsCoverage) ? metaObj.viewsCoverage : derived.viewsCoverage;
  const entry = {
    handle,
    rows: rows.length,
    range: rows.length ? range : null,
    pulledAt: metaObj?.pulledAt ?? null,
    stale,
    ageDays,
    viewsCoverage: rows.length ? viewsCoverage : 0,
    cadence: summary ? clone(summary.cadence) : null,
    byType: summary ? clone(summary.byType) : {},
    source: metaObj?.source ?? 'committed-json',
  };
  return { entry, summary, rows };
}

function entryCaveats(entry, role) {
  const T = EVALUATION_THRESHOLDS;
  const out = [];
  const who = role === 'own' ? `own @${entry.handle}` : `benchmark @${entry.handle}`;
  if (entry.rows < T.minRows) {
    out.push({ code: EVALUATION_CAVEAT.FEW_ROWS, handle: entry.handle, message: `${who} has ${entry.rows} rows (under ${T.minRows}); per-type figures are thin.` });
  }
  if (entry.rows === 0) return out;
  if (entry.viewsCoverage < T.viewsCoverageMin) {
    out.push({ code: EVALUATION_CAVEAT.LIKES_ONLY, handle: entry.handle, message: `${who}: views on ${Math.round(entry.viewsCoverage * 100)}% of rows (under ${Math.round(T.viewsCoverageMin * 100)}%); lift is likes-only.` });
  }
  if (entry.pulledAt === null || entry.ageDays === null) {
    out.push({ code: EVALUATION_CAVEAT.STALE, handle: entry.handle, message: `${who}: committed data, refresh to update.` });
  } else if (entry.stale) {
    out.push({ code: EVALUATION_CAVEAT.STALE, handle: entry.handle, message: `${who}: data is ${Math.floor(entry.ageDays)} days old (over ${T.staleDays}); refresh to update.` });
  }
  return out;
}


export const ACTUAL_WINDOW_DAYS = 14;
const DAY_MS = 86400000;
const round2 = (n) => Math.round(n * 100) / 100;

/** Brain target for a track: postsPerDay = its engines' targets summed (daily target, else weekly minimum / 7). Per-type
 *  shares are Brain-only (not in the plan): shown only when the caller passes the approved Brain's trackTargets rows. */
function trackTarget(track, plan, brainRows) {
  const cfg = mergeEngineConfig(isObj(plan.engineTargets) ? plan.engineTargets : {});
  const perDay = (track.engines || []).reduce((s, e) => {
    const c = cfg.engines[e] ?? {};
    return s + (c.targetPerDay > 0 ? c.targetPerDay : c.weeklyMin > 0 ? c.weeklyMin / 7 : 0);
  }, 0);
  const label = String(track.label ?? '').trim().toLowerCase();
  const row = Array.isArray(brainRows) ? brainRows.find((r) => String(r?.track ?? '').trim().toLowerCase() === label) : null;
  const shares = row ? Object.fromEntries(Object.entries(row).filter(([k, v]) => k !== 'track' && k !== 'postsPerDay' && Number.isFinite(v))) : null;
  return { postsPerDay: perDay > 0 ? round2(perDay) : null, source: 'plan-engine-targets', brainShares: shares && Object.keys(shares).length ? shares : null };
}

/** Own authored posts in the last 14 days. Scoped to the track's topics when enough rows match; otherwise all own rows,
 *  flagged scope 'all-own-rows' so the UI says it is not track-specific. */
function trackActual(track, ownRows, nowMs) {
  const cut = nowMs - ACTUAL_WINDOW_DAYS * DAY_MS;
  const recent = (Array.isArray(ownRows) ? ownRows : []).filter((r) => { const ms = Date.parse(r?.utc ?? r?.createdAt ?? r?.dateLocal ?? ''); return Number.isFinite(ms) && ms >= cut && ms <= nowMs; });
  const topics = (track.topics || []).map((x) => String(x).toLowerCase());
  const hit = (r) => [...(r.topics || []), ...(r.lanes || [])].some((x) => topics.includes(String(x).toLowerCase()));
  const scoped = topics.length ? recent.filter(hit) : [];
  const useRows = scoped.length >= 3 ? scoped : recent;
  const m = computeRowMetrics(useRows);
  return {
    windowDays: ACTUAL_WINDOW_DAYS, scope: useRows === scoped ? 'topic-filtered' : 'all-own-rows', rows: useRows.length,
    postsPerDay: useRows.length ? round2(m.authoredPosts / ACTUAL_WINDOW_DAYS) : null,
    typeMix: m.postTypeMix, mediaMix: m.formatMix,
  };
}

/** Pooled benchmark profile for one track (only this track's handles; never blended with other tracks). */
function trackBenchmarkProfile(withSummary) {
  const rows = withSummary.flatMap((b) => b.rows);
  if (!rows.length) return null;
  const m = computeRowMetrics(rows);
  const cadence = summarizeCorpus(rows, { handle: withSummary.map((b) => b.entry.handle).join('+') }).cadence;
  return { handles: withSummary.map((b) => b.entry.handle), rows: rows.length, postsPerDay: cadence.authoredPerActiveDay ?? null, typeMix: m.postTypeMix, mediaMix: m.formatMix, range: m.range };
}

/**
 * Per-track evaluation: each track is compared with ITS OWN benchmarks only (never averaged across tracks, and the
 * plan's overall primary is only a tie-break inside a track that contains it). A track without benchmarks reports
 * { status:'no-benchmark', fallback:'own-history' } with no gaps.
 */
function evaluateTracks(tracks, bench, own, primaryWanted, ctx = {}) {
  return tracks.map((track) => {
    const base = {
      trackId: track.id, label: track.label, engines: [...track.engines], share: track.share, benchmarks: [...track.benchmarks],
      target: trackTarget(track, ctx.plan ?? {}, ctx.brainTrackTargets),
      actual: trackActual(track, own.rows, ctx.nowMs ?? Date.now()),
    };
    if (!track.benchmarks.length) {
      return { ...base, status: 'no-benchmark', fallback: 'own-history', benchmarkProfile: null, gapsAgainst: null, gaps: [], perBenchmark: [], needsRefresh: [], caveats: [] };
    }
    const entries = track.benchmarks.map((h) => ({ handle: h, found: bench.find((b) => b.entry.handle === h) ?? null }));
    const withSummary = entries.map((e) => e.found).filter((f) => f?.summary);
    const needsRefresh = entries.filter((e) => !e.found?.summary).map((e) => e.handle);
    const perBenchmark = own.summary
      ? withSummary.map((b) => ({ handle: b.entry.handle, gaps: compareToBenchmark({ own: own.summary, benchmark: b.summary }).gaps.slice(0, MAX_GAPS) }))
      : [];
    const lead = withSummary.find((b) => b.entry.handle === primaryWanted) ?? withSummary[0] ?? null;
    const gaps = lead ? (perBenchmark.find((p) => p.handle === lead.entry.handle)?.gaps ?? []) : [];
    return {
      ...base,
      status: withSummary.length ? 'ok' : 'no-rows',
      benchmarkProfile: trackBenchmarkProfile(withSummary),
      fallback: null,
      gapsAgainst: lead ? lead.entry.handle : null,
      gaps: clone(gaps),
      perBenchmark: clone(perBenchmark),
      needsRefresh,
      caveats: withSummary.flatMap((b) => entryCaveats(b.entry, 'benchmark')),
    };
  });
}

/**
 * @param {{ownHandle:string, ownRows:object[], ownMeta:object|null,
 *          benchmarks:{handle:string, rows:object[], meta:object|null}[],
 *          plan:object|null, now?:number|string|Date, tracks?:object[]}} input
 *   `byTrack` is added ONLY when the plan has contentTracks (or `tracks` is passed); otherwise the output is unchanged.
 */
export function evaluate(input = {}) {
  const nowMs = toMs(input.now);
  const ownHandle = cleanHandle(input.ownHandle);

  // plan: accept the plan object (or a plan doc); absent -> DEFAULT_PLAN.
  const planIn = isObj(input.plan) ? (isObj(input.plan.plan) ? input.plan.plan : input.plan) : null;
  const planSource = planIn ? 'plan-doc' : 'default';
  const plan = normalizePlan(planIn ?? DEFAULT_PLAN);

  const own = buildEntry(ownHandle, input.ownRows, input.ownMeta, nowMs);

  const seen = new Set([ownHandle]);
  const bench = [];
  for (const b of Array.isArray(input.benchmarks) ? input.benchmarks : []) {
    const h = cleanHandle(b?.handle);
    if (!h || seen.has(h)) continue;
    seen.add(h);
    bench.push(buildEntry(h, b.rows, b.meta, nowMs));
  }

  const primaryWanted = cleanHandle(plan.benchmarkPrimary);
  const primary = bench.find((b) => b.entry.handle === primaryWanted && b.summary) ?? bench.find((b) => b.summary) ?? null;

  let gaps = [];
  if (own.summary && primary?.summary) {
    gaps = compareToBenchmark({ own: own.summary, benchmark: primary.summary }).gaps.slice(0, MAX_GAPS);
  }

  const caveats = [...entryCaveats(own.entry, 'own'), ...bench.flatMap((b) => entryCaveats(b.entry, 'benchmark'))];
  const quoteReactSeen = gaps.some((g) => String(g.id).includes('quote-react'))
    || bench.some((b) => (b.entry.byType?.['quote-react']?.n ?? 0) > 0);
  if (quoteReactSeen) {
    caveats.push({ code: QUOTE_REACT_CAVEAT, message: "quote-react lift is likes-based and can't see reach - see Seb model." });
  }

  const recommendedTier = resolveTier({ currentAuthoredPerDay: own.entry.cadence?.authoredPerActiveDay });
  const currentTier = tierForAuthoredPerDay(plan.authoredPerDay);

  const trackList = Array.isArray(input.tracks) ? input.tracks : Array.isArray(plan.contentTracks) ? tracksOf(plan) : null;

  return {
    ...(trackList ? { byTrack: evaluateTracks(trackList, bench, own, primaryWanted, { plan, nowMs, brainTrackTargets: input.brainTrackTargets }) } : {}),
    generatedAt: new Date(nowMs).toISOString(),
    own: own.entry,
    benchmarks: bench.map((b) => b.entry),
    gaps: clone(gaps),
    gapsAgainst: primary ? primary.entry.handle : null,
    recommendedTier,
    currentTier,
    caveats,
    baselinePlan: {
      authoredPerDay: plan.authoredPerDay,
      tier: plan.tier,
      typeFloors: clone(plan.typeFloors),
      typeCaps: clone(plan.typeCaps),
      benchmarkPrimary: plan.benchmarkPrimary,
      // Data only, never applied: the next cadence step the evaluation suggests.
      recommended: {
        tier: recommendedTier.tier,
        authoredPerDay: recommendedTier.authoredPerDay,
        label: recommendedTier.label,
        source: recommendedTier.source,
      },
    },
    planSource,
    needsRefresh: [own, ...bench].filter((x) => x.entry.rows === 0).map((x) => x.entry.handle),
  };
}
