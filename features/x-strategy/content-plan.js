// content-plan.js - the Plan tab's `content-plan` and the `refresh-analysis` actions, moved out of
// app/api/dashboard/quote-targets/route.js so they read the SAME Strategy plan doc as the Strategy tab and the
// daily loop (master plan T5). SERVER-ONLY (stores injected); no model, no bird, no X API.
//
// - Rows come from corpusStore.readRows(handle) (Firestore rows, committed-JSON fallback inside), not static imports.
//   ⚠️ Live output therefore uses the FRESHER Firestore rows; only the committed-json source is byte-identical to the
//   pre-T5 output (t5-golden.test.js pins that case).
// - Handles come from the client's xGrowth profile with the shared default-pair fallback (withDefaultPair).
// - Owner contract: NO plan doc (planStore.get -> null) => the pre-T5 route logic runs UNCHANGED (legacyContentPlan /
//   legacyRefreshAnalysis below): the two static committed corpora handed in as `legacyRows`, no profile-derived handles,
//   no lanes, the 400 for an incomplete profile, stat-block (readCorpus/readCorpora) based refresh-analysis, no 409 for
//   missing rows, and no planSource/planVersion fields. t5-golden.test.js pins this against output captured from git 5cfce1e9.
// - ONLY when a plan doc exists the new behaviour applies: rows store + profile/default-pair handles + lanes,
//   authoredPerDay -> posts, engineTargets -> engineConfig, benchmarkPrimary picks the benchmark, the request's `posts`
//   is ignored (the plan is the answer), and a missing corpus is a 409 pointing at Refresh.

import { resolveXGrowthProfile, resolveTier, TIERS } from '../x-benchmark/profile.js';
import { summarizeCorpus } from '../x-benchmark/summarize.js';
import { compareToBenchmark } from '../x-benchmark/compare.js';
import { buildCalendar } from '../x-benchmark/build-calendar.js';
import { buildDayPlan as buildContentDayPlan } from '../x-content-inventory/plan-day.js';
import { projectDayPlan } from '../x-content-inventory/day-plan-projection.js';
import { resolvePlanInputs } from './plan-inputs.js';
import { withDefaultPair } from './route-handlers.js';
import { normalizeHandle } from './corpus-store.js';
import { tierForAuthoredPerDay } from './contracts.js';
import { tracksOf } from './content-tracks.js';
import { applyTrackAllocation, hasExplicitTracks, loadTrackProfiles } from './track-profile.js';

export const MAX_PLAN_POSTS = 12;
export const DEFAULT_REQUEST_POSTS = 5;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Primary benchmark first: the plan's `benchmarkPrimary` when it is one of the profile's handles, else profile order. */
function orderBenchmarks(handles, primary) {
  const list = handles.map((h) => { try { return normalizeHandle(h); } catch { return null; } }).filter(Boolean);
  const unique = [...new Set(list)];
  if (primary && unique.includes(primary)) return [primary, ...unique.filter((h) => h !== primary)];
  return unique;
}

/**
 * @param {Object} deps
 * @param {{readRows:(h:string)=>Promise<{rows:object[],meta:object|null,source:string}>}} deps.corpusStore
 * @param {{get:(clientId:string)=>Promise<object|null>}} deps.planStore
 * @param {(clientId:string)=>Promise<object|null>} deps.readXGrowthConfig  raw marketingBriefConfig.xGrowth
 * @param {()=>Promise<{packages:object[], seeded?:boolean}>} deps.readInventory
 * @param {(handle:string)=>Promise<object|null>} [deps.readCorpus]  x_corpora stat block (legacy path; plan path only when a handle has no rows)
 * @param {(handles:string[])=>Promise<object[]>} [deps.readCorpora]  legacy path only: stat blocks of several handles
 * @param {{own:object[], benchmark:object[]}} [deps.legacyRows]  legacy path only: the two committed corpora as rows
 * @param {(clientId:string, out:{report:object, calendar:object})=>Promise<unknown>} [deps.saveGapReport]
 * @param {()=>number} [deps.clock]
 */
export function createContentPlanHandlers({
  corpusStore, planStore, readXGrowthConfig, readInventory,
  readCorpus = async () => null, readCorpora = async () => [], legacyRows = null, saveGapReport = async () => null,
  clock = Date.now, resolveProfile = resolveXGrowthProfile, buildPlan = buildContentDayPlan,
} = {}) {
  if (!corpusStore || !planStore || typeof readXGrowthConfig !== 'function' || typeof readInventory !== 'function') {
    throw new Error('createContentPlanHandlers: corpusStore, planStore, readXGrowthConfig, readInventory are required');
  }

  /** PRE-T5 content-plan, verbatim: committed corpora, no lanes, request posts, no plan fields. */
  async function legacyContentPlan(context, body) {
    if (!legacyRows?.own || !legacyRows?.benchmark) throw new Error('createContentPlanHandlers: legacyRows {own, benchmark} are required for the no-plan path');
    const requested = Number(body?.posts);
    const posts = Number.isFinite(requested) && requested >= 1 ? Math.min(Math.floor(requested), MAX_PLAN_POSTS) : DEFAULT_REQUEST_POSTS;
    const date = typeof body?.date === 'string' && DATE_RE.test(body.date.trim()) ? body.date.trim() : new Date(clock()).toISOString().slice(0, 10);
    const { packages, seeded } = await readInventory({ clientId: context.clientId });
    // The committed corpus labels itself (its post URLs name the account); plan-day has no owner default.
    // This legacy no-plan-doc path still reads the owner's committed corpora (COMMITTED_CORPORA, multi-client Phase 4).
    const handle = /(?:x|twitter)\.com\/([^/]+)\/status\//i.exec(legacyRows.own.find((r) => r?.url)?.url || '')?.[1] || null;
    const plan = buildPlan({ corpusRows: legacyRows.own, benchmarkRows: legacyRows.benchmark, packages, date, posts, handle });
    return { ok: true, plan, seeded, summary: projectDayPlan(plan, { posts }).summary };
  }

  /** PRE-T5 refresh-analysis, verbatim: stat blocks from x_corpora, raw profile, tier from tierOverride/cadence. */
  async function legacyRefreshAnalysis(context) {
    const profile = resolveProfile({ config: await readXGrowthConfig(context.clientId) });
    if (!profile.ready) throw httpError(400, `X growth profile is incomplete — missing: ${profile.missing.join(', ')}.`);
    const ownCorpus = await readCorpus(profile.ownHandle);
    if (!ownCorpus?.stats) throw httpError(409, `No ingested corpus for @${profile.ownHandle}. Run: node scripts/x-content/ingest-corpus.mjs --handle ${profile.ownHandle} --write`);
    const benchmarks = await readCorpora(profile.benchmarkHandles);
    if (!benchmarks.length) throw httpError(409, `No ingested corpus for any benchmark account (${profile.benchmarkHandles.join(', ')}).`);
    const reports = benchmarks
      .map((b) => compareToBenchmark({ own: ownCorpus.stats, benchmark: b.stats }))
      .filter((r) => Array.isArray(r.gaps));
    const primary = reports[0];
    const tier = resolveTier({ tierOverride: profile.tierOverride, currentAuthoredPerDay: ownCorpus.stats?.cadence?.authoredPerActiveDay });
    const calendar = buildCalendar({ report: primary, ownStats: ownCorpus.stats, tier, profile, days: 15, startDate: new Date(clock()).toISOString().slice(0, 10) });
    const report = {
      ...primary,
      tier,
      alternates: reports.slice(1).map((r) => ({ benchmarkHandle: r.benchmarkHandle, gaps: r.gaps, projection: r.projection })),
      corpora: {
        own: { handle: ownCorpus.handle, ...(ownCorpus.meta ?? {}) },
        benchmarks: benchmarks.map((b) => ({ handle: b.handle, ...(b.meta ?? {}) })),
      },
    };
    await saveGapReport(context.clientId, { report, calendar });
    return { ok: true, report, calendar, tier };
  }

  async function load(clientId, planDoc) {
    const rawProfile = resolveProfile({ config: await readXGrowthConfig(clientId) });
    const profile = withDefaultPair(rawProfile);
    return { rawProfile, profile, resolved: resolvePlanInputs(planDoc) };
  }

  /** One day of authored posts for the Plan tab. With a plan doc: same shape plus planSource / planVersion. */
  async function contentPlan(context, body) {
    const planDoc = await planStore.get(context.clientId);
    if (!planDoc) return legacyContentPlan(context, body);
    const { profile, resolved } = await load(context.clientId, planDoc);
    const requested = Number(body?.posts);
    const requestedPosts = Number.isFinite(requested) && requested >= 1
      ? Math.min(Math.floor(requested), MAX_PLAN_POSTS)
      : DEFAULT_REQUEST_POSTS;
    // A plan doc decides the cadence; the Plan tab's picker only applies when there is none.
    const posts = resolved.posts ?? requestedPosts;
    const now = clock();
    const date = typeof body?.date === 'string' && DATE_RE.test(body.date.trim())
      ? body.date.trim()
      : new Date(now).toISOString().slice(0, 10);

    const ownHandle = normalizeHandle(profile.ownHandle);
    const benchHandle = orderBenchmarks(profile.benchmarkHandles, resolved.benchmarkPrimary)[0] ?? null;
    const own = await corpusStore.readRows(ownHandle);
    if (!own.rows.length) throw httpError(409, `No corpus rows for @${ownHandle} yet - run Refresh in the Strategy tab first.`);
    const bench = benchHandle ? await corpusStore.readRows(benchHandle) : null;
    const { packages, seeded } = await readInventory({ clientId: context.clientId });
    // Content tracks (opt-in): track shares raise per-engine minimums; a plan without contentTracks is untouched.
    const engineConfig = applyTrackAllocation(planDoc, resolved.engineConfig);

    const plan = buildPlan({
      corpusRows: own.rows,
      benchmarkRows: bench?.rows?.length ? bench.rows : null,
      packages, date, posts, now, handle: ownHandle,
      ...(profile.lanes.length ? { lanes: profile.lanes } : {}),
      ...(engineConfig ? { engineConfig } : {}),
    });
    const trackProfiles = hasExplicitTracks(planDoc)
      ? await loadTrackProfiles({ tracks: tracksOf(planDoc), corpusStore, ownHandle }).catch(() => null)
      : null;
    // `seeded` travels with the plan so the card can say the gaps come from the example rows.
    return {
      ok: true, plan, seeded, summary: projectDayPlan(plan, { posts }).summary,
      planSource: resolved.source, planVersion: resolved.planVersion,
      ...(trackProfiles ? { trackProfiles } : {}),
    };
  }

  /** Stats for one handle: summarize its rows; fall back to a legacy stored stat block only when it has no rows. */
  async function statsFor(handle) {
    const read = await corpusStore.readRows(handle);
    if (read.rows.length) return { handle, stats: summarizeCorpus(read.rows, { handle }), meta: { rowCount: read.rows.length, source: read.source, ...(read.meta ?? {}) } };
    const legacy = await readCorpus(handle);
    return legacy?.stats ? { handle, stats: legacy.stats, meta: legacy.meta ?? {} } : null;
  }

  /** Recompute the gap report + 15-day calendar from corpus rows. Free and offline; saves via the injected saveGapReport. */
  async function refreshAnalysis(context) {
    const planDoc = await planStore.get(context.clientId);
    if (!planDoc) return legacyRefreshAnalysis(context);
    const { rawProfile, profile, resolved } = await load(context.clientId, planDoc);
    const ownHandle = normalizeHandle(profile.ownHandle);
    const own = await statsFor(ownHandle);
    if (!own?.stats) throw httpError(409, `No corpus for @${ownHandle}. Run Refresh in the Strategy tab (or scripts/x-content/ingest-corpus.mjs).`);

    const benchmarks = [];
    for (const h of orderBenchmarks(profile.benchmarkHandles, resolved.benchmarkPrimary)) {
      const b = await statsFor(h);
      if (b?.stats) benchmarks.push(b);
    }
    if (!benchmarks.length) throw httpError(409, `No corpus for any benchmark account (${profile.benchmarkHandles.join(', ')}).`);

    // One report per benchmark, kept separate (not averaged). The first - the plan's primary when set - drives the calendar.
    const reports = benchmarks
      .map((b) => compareToBenchmark({ own: own.stats, benchmark: b.stats }))
      .filter((r) => Array.isArray(r.gaps));
    const primary = reports[0];

    // A plan doc pins the cadence: the calendar gets exactly authoredPerDay slots/day (not the tier's nominal count).
    const tier = resolved.source === 'plan-doc' && resolved.authoredPerDay
      ? { tier: tierForAuthoredPerDay(resolved.authoredPerDay), authoredPerDay: resolved.authoredPerDay, label: TIERS[tierForAuthoredPerDay(resolved.authoredPerDay)].label, source: 'plan' }
      : resolveTier({ tierOverride: rawProfile.tierOverride, currentAuthoredPerDay: own.stats?.cadence?.authoredPerActiveDay });
    const calendar = buildCalendar({
      report: primary, ownStats: own.stats, tier, profile: { lanes: rawProfile.lanes }, days: 15,
      startDate: new Date(clock()).toISOString().slice(0, 10),
    });

    const report = {
      ...primary,
      tier,
      alternates: reports.slice(1).map((r) => ({ benchmarkHandle: r.benchmarkHandle, gaps: r.gaps, projection: r.projection })),
      corpora: {
        own: { handle: own.handle, ...own.meta },
        benchmarks: benchmarks.map((b) => ({ handle: b.handle, ...b.meta })),
      },
    };
    await saveGapReport(context.clientId, { report, calendar });
    return { ok: true, report, calendar, tier, planSource: resolved.source, planVersion: resolved.planVersion };
  }

  return { contentPlan, refreshAnalysis };
}
