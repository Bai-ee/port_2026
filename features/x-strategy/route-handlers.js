// Strategy tab route handlers (T2b). SERVER-ONLY (pulls corpus/refresh stores). Keeps
// app/api/dashboard/quote-targets/route.js thin: the route authenticates, then calls handle().
// Every dependency is injected so the whole surface is testable with memory stores.
//
// Result contract: handlers return plain objects. Failures are `{ok:false, status, error, ...extra}`
// (the route maps `status`); success is `{ok:true, ...}`. Nothing here throws to the caller for
// expected failures (validation, version conflict, unknown handle).
//
// Writes only through the injected stores: x_strategy_plans, x_strategy_refresh_requests, x_corpora rows.
// Never calls bird / X API / ScrapeCreators / a model. A refresh only enqueues (the service may start an
// in-process drain when X_STRATEGY_LOCAL_INGEST=1 and bird is detected; that promise is never awaited here).
//
// Besides `handle` and `actions`, the returned object exposes two functions for other server modules (the MCP server):
//   toolDepsFor(clientId, context?) -> toolDeps
//       A NEW read-tool deps object (fresh preload cache) for exactly that client, same readers the chat uses; feed it to
//       runReadTool / prepareProposal from agent/tools.js. clientId is closed over: nothing the caller passes later can
//       reach another client.
//   createProposalInThread({ clientId, threadId?, proposals }) -> Promise<{ok, threadId, proposals, dropped}>
//       Validates + assigns + persists raw proposals ({kind,payload,summary,rationale,evidence}) into a chat thread
//       (default threadId `t_mcp_<yyyymmdd>`, created on first use) so they show up as ordinary pending cards in the
//       Strategy chat. Executes nothing; the owner still confirms in the UI. Needs a chatStore (else {ok:false,status:503}).

import { DEFAULT_PLAN, EVALUATION_THRESHOLDS, MAX_BULK_PROPOSALS_PER_TURN, BULK_PROPOSAL_KINDS } from './contracts.js';
import { evaluate as defaultEvaluate } from './evaluate.js';
import { StrategyPlanError, createFirestorePlanStore } from './plan-store.js';
import { createFirestoreCorpusStore, normalizeHandle, CorpusStoreError } from './corpus-store.js';
import { createRefreshService, createFirestoreRefreshQueue, readWorkerHealth as readWorkerHealthFromDb } from './refresh.js';
import { resolveXGrowthProfile } from '../x-benchmark/profile.js';
import { buildDayPlan as buildContentDayPlan } from '../x-content-inventory/plan-day.js';
import { hasPlaceholderStory } from '../x-content-inventory/match.js';
import { projectDayPlan } from '../x-content-inventory/day-plan-projection.js';
import { resolvePlanInputs } from './plan-inputs.js';
import { tracksOf, trackForPackage } from './content-tracks.js';
import { syncBucketTracks } from './bucket-tracks.js';
import { normalizeBatchSpec, planCalendarBatch, createCalendarBatch } from '../x-content-inventory/calendar-batch.js';
import { runDailyFill, isFillPost } from '../x-content-inventory/daily-fill.js';
import { findMediaCandidates, linkMediaPatch, normalizeLinks, mediaOf } from '../x-content-inventory/item-media.js';
import { planMemorySuggestions, postNeedsMemory, MAX_MEMORY_SUGGESTIONS, MEMORY_LINE_MAX } from '../x-content-inventory/memory-suggest.js';
import { planMediaTasks, createContentTaskStore } from '../x-content-inventory/content-tasks.js';
import { ctDate } from '../x-content-inventory/month-calendar.js';
import { hasExplicitTracks, trackBenchmarkHandles, newTrackBenchmarkHandles, loadTrackProfiles, profileBenchmarksFromPlan } from './track-profile.js';
import { normalizeXGrowthProfile } from '../x-benchmark/profile.js';
import { createFirestoreChatStore, ChatCapError, ChatStoreError, THREAD_ID_RE } from './agent/chat-store.js';
import {
  validateProposal, assignProposal, decideProposal, buildExecutors, normalizeHandleInput,
} from './agent/proposals.js';
import { normalizeSelected, describeSelected } from './agent/prompt.js';
import { shapeMarketSignals } from './agent/tools.js';
import { createActionRuntime } from './agent/action-runtime.js';
import { createFirestoreActionStores } from './agent/action-stores.js';
import { randomUUID } from 'node:crypto';
import { StrategyDocError, createFirestoreStrategyDocStore } from './strategy-doc-store.js';
import { draftDoc, STRATEGY_DOC_SECTIONS, describeDocChange } from './strategy-doc.js';
import { SEED_STRATEGY_SECTIONS } from './strategy-doc-seed.js';
import { summarizeAlgorithm, scorePosts as shapeScoredPosts, ruleCheck, summarizeAudience } from './insights.js';
import { buildBriefBundle, freshnessOf, readBriefRaw as readBriefRawFromDb } from './brief-bundle.js';
import { scoreXPost, getAlgorithmProfile } from '../x-growth/index.js';
import { guardXPost } from '../x-content-guard/index.js';

export const STRATEGY_ROUTE_ACTIONS = Object.freeze([
  'strategy-get',
  'strategy-refresh',
  'strategy-refresh-status',
  'strategy-evaluate-handle',
  'strategy-plan-apply',
  'strategy-plan-revert',
  'strategy-chat-send',
  'strategy-chat-history',
  'strategy-proposal-decide',
  'strategy-profile-save',
  'strategy-doc-get',
  'strategy-doc-save',
  'strategy-doc-revert',
  'strategy-review',
  'strategy-calendar-batch-preview',
  'strategy-calendar-batch-create',
  'strategy-daily-fill-preview',
  'strategy-daily-fill-create',
  'strategy-freshness',
  'strategy-action-undo',
  'strategy-action-log',
  'strategy-autonomy-get',
  'strategy-autonomy-save',
]);

export const REVIEW_DISPLAY_TEXT = 'Review my strategy against the latest data.';
const REVIEW_MAX_ROUNDS = 6;
const REVIEW_MAX_TOKENS = 2500;

/** The model-side brief for a Review. The thread stores REVIEW_DISPLAY_TEXT instead. */
export function buildReviewBrief(doc) {
  const draft = !doc?.confirmed;
  return [
    'STRATEGY REVIEW (the owner pressed "Review strategy").',
    'Use tools to check the strategy against current data: get_strategy_doc, get_evaluation, get_tracks, score_posts (own, and the lead benchmark if useful), get_rule_check, get_audience, get_algorithm. Call several in one round where you can; you have a limited tool budget.',
    'Then answer in plain text, in this order, under about 250 words:',
    '1. Since the last review: the last review date from get_strategy_doc (or "first review"), and how fresh each account\'s data is.',
    '2. Section check: for each strategy section the data speaks to, say holds, weaker or contradicted, with one figure and its source/window. Skip sections the data cannot test and say so in one line.',
    '3. What I would change: at most 2 proposals (a strategy section edit and/or a plan change) as proposal cards. If nothing should change, say "No change recommended" and why.',
    draft ? 'The document is still a DRAFT: frame section 3 as what to fix before the owner confirms it.' : '',
  ].filter(Boolean).join('\n');
}

export const CHAT_TEXT_MAX = 2000;
const MAX_PROPOSALS_PER_TURN = 2;
const MAX_EXTERNAL_PROPOSALS = 5; // createProposalInThread (MCP) per call
const HISTORY_MESSAGES_TO_MODEL = 60;

const DAY_MS = 86400000;
// Only the timezone has a neutral default. Handles never do: no client inherits @bai_ee / @seb__design
// (multi-client Phase 4.4); the home client carries those as its own stored config (scripts/x-content/seed-home-priors.mjs).
const DEFAULT_TIMEZONE = 'America/Chicago';
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Resolved xGrowth profile with honest gaps: a missing own handle stays null and missing benchmarks stay [].
 * `unset` names the handle fields the client has not saved (the UI asks for them); `defaulted` names fields filled
 * with a neutral default (timezone only). Shared with content-plan.js and loop-corpora.js so every surface
 * resolves the same handles.
 * @param {object} p  resolveXGrowthProfile() output
 */
export function withProfileDefaults(p = {}) {
  const unset = [];
  const defaulted = [];
  const ownHandle = p.ownHandle || null;
  if (!ownHandle) unset.push('ownHandle');
  const benchmarkHandles = Array.isArray(p.benchmarkHandles) ? p.benchmarkHandles.filter(Boolean) : [];
  if (!benchmarkHandles.length) unset.push('benchmarkHandles');
  const timezone = p.timezone || DEFAULT_TIMEZONE;
  if (!p.timezone) defaulted.push('timezone');
  return { ownHandle, benchmarkHandles, timezone, lanes: p.lanes || [], unset, defaulted };
}

/** Daily-run doc -> the compact shape the agent's get_today_run tool and suggestion-id checks expect. */
export function summarizeTodayRun(run) {
  const list = Array.isArray(run?.suggestions) ? run.suggestions : [];
  return {
    suggestions: list.filter((s) => s && typeof s.id === 'string').map((s) => ({
      id: s.id,
      slot: s.slot ? [s.slot.letter, s.slot.timeCT].filter(Boolean).join(' ') || null : (s.proposedSlot?.localTime ?? null),
      type: s.type ?? null,
      status: s.reviewState ?? 'pending',
      text: String(s.edit?.text || s.savedText || s.draft?.text || '').slice(0, 600),
    })),
  };
}

const fail = (status, error, extra = {}) => ({ ok: false, status, error, ...extra });

/** YYYY-MM-DD in `tz` (IANA) or UTC when tz is empty/invalid. */
export function localDate(nowMs, tz) {
  try {
    if (tz) return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs));
  } catch { /* invalid tz -> UTC */ }
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** rowsMeta + freshness for one handle's readRows() result. */
export function describeRows(handle, read, nowMs) {
  const meta = read?.meta ?? null;
  const pulledMs = meta?.pulledAt ? Date.parse(meta.pulledAt) : NaN;
  const ageDays = Number.isFinite(pulledMs) ? Math.max(0, Math.floor((nowMs - pulledMs) / DAY_MS)) : null;
  return {
    handle,
    source: read?.source ?? 'none',
    rowsMeta: meta,
    freshness: {
      pulledAt: meta?.pulledAt ?? null,
      ageDays,
      // Committed-json seeds carry no pull time: staleness is unknown, not "fresh".
      stale: ageDays === null ? (read?.source === 'none' ? null : true) : ageDays > EVALUATION_THRESHOLDS.staleDays,
    },
  };
}

/**
 * @param {Object} deps
 * @param {{readRows:(h:string)=>Promise<{rows:object[],meta:object|null,source:string}>}} deps.corpusStore
 * @param {{get:Function,apply:Function,revert:Function}} deps.planStore
 * @param {{requestRefresh:Function,getRequestStatus:Function}} deps.refreshService
 * @param {(clientId:string)=>Promise<object|null>} deps.readXGrowthConfig  raw client_configs marketingBriefConfig.xGrowth
 * @param {()=>Promise<object[]>} [deps.readPackages]  content inventory packages for the preview
 * @param {(input:object)=>Promise<object>|object} [deps.evaluate]  FIXED interface, see master plan T2a
 * @param {(clientId:string)=>Promise<object>} [deps.readWorkerHealth]  heartbeat signal; absent => responses omit workerHealth
 * @param {()=>number} [deps.clock]
 * Chat / proposals (T4b), all injected and optional so the T2 surface is unchanged without them:
 * @param {object} [deps.chatStore]  agent/chat-store.js store
 * @param {(a:{clientId:string,toolDeps:object})=>Promise<{runTurn:Function}>|{runTurn:Function}} [deps.agentLoopFactory]
 *        default: lazy import of ./agent/loop.js createAgentLoop({callModel: deps.callModel || createAnthropicCaller(env key), toolDeps, logUsage: deps.logUsage || createDefaultLogUsage()});
 *        no callModel and no env.ANTHROPIC_API_KEY => 503
 * @param {Function} [deps.callModel] @param {Function} [deps.logUsage]
 * @param {(context:object, action:string, body:object)=>Promise<object>} [deps.runDailyAction]  route's handleDailyRun
 * @param {(context:object, body:object)=>Promise<object>} [deps.runUpdateItemFacets]  route's handleUpdateItemFacets
 * @param {(clientId:string)=>Promise<object|null>} [deps.readTodayRun]
 * @param {(clientId:string, profile:{ownHandle?:string,benchmarkHandles:string[]})=>Promise<object>} [deps.saveXGrowthProfile]
 */
export function createStrategyHandlers({
  corpusStore, planStore: basePlanStore, refreshService, readXGrowthConfig,
  readPackages = async () => [], readWorkerHealth = null, evaluate = defaultEvaluate, clock = Date.now,
  resolveProfile = resolveXGrowthProfile, buildPreviewPlan = buildContentDayPlan,
  docStore: baseDocStore = null, onBrainOwnedSaved = null, // strategy-doc-store.js; absent => the strategy-doc-* actions answer 503
  readBrainTrackTargets = null, // clientId -> approved Brain Track Targets rows (per-type shares); absent => postsPerDay only
  chatStore = null, agentLoopFactory = null, callModel = null, logUsage = null,
  runDailyAction = null, runUpdateItemFacets = null, readTodayRun = null, readContentContext = null, saveXGrowthProfile = null,
  readQueueSummary = null, readPost = null, readOpportunities = null, readResults = null, // chat read tools: (clientId[, postId]) -> plain JSON | null
  readMarketSignals = null, // (clientId) -> projected brief (features/intelligence/_brief-intel.js projectBrief) | null
  readBriefRaw = null, // (clientId, {readPlanDoc, readStrategyDoc, readCorpora, readXMonitor, readTodayRun}) -> raw brief inputs (brief-bundle.js readBriefRaw); absent => get_brief / get_freshness say not available
  editPost = null, // ({clientId, postId, content?, scheduledAt?}) -> saved post; the existing updateSocialPost path
  runPaidSync = null, // ({clientId, kind, params, by, auth, context}) -> result; the `paid-sync` proposal executor (features/mcp/paid-syncs.js). Absent => confirming one fails with a clear message
  readAudience = null, // (clientId) -> {account, snapshots, events, posts} from THIS client's stored X Monitor account ({account:null} when none); null => tool says unavailable
  readBuckets = null, // (clientId) -> Content Center buckets (listBuckets rows); absent => tracks are not synced to buckets
  readBucketEngine = null, // (clientId, bucketId) -> engine of one item in that bucket | null (first-sync migration only)
  readOpenPackageIds = null, // (clientId) -> Map packageId -> {postId, status, scheduledAt, reviewOn} of open posts (or a Set); batch skips or places them
  placeDraft = null, // (clientId, postId, {reviewOn, bucketId, media}) -> bool; sets an unscheduled draft's review day + missing media
  readFillContext = null, // (clientId) -> {fillPosts:[{postId,status,reviewOn,fillKind,bucketId,idempotencyKey}], lastUsed: Map packageId -> 'YYYY-MM-DD'}; daily fill re-run accounting + 30-day spread
  readQuoteTargets = null, // (clientId) -> {generatedAt, targets:[{id,url,text,handle,createdAt,trackId?}]} open (non-dismissed) quote candidates; daily fill quotes
  ensureDraft = null, // (clientId, payload) -> {post, existing}; twitter-service ensureDraftPost. Absent => batch create answers 503
  mediaForItem = null, // (clientId, pkg) -> {mediaUrl, mediaType, mediaContentType, mediaStoragePath} | null; calendar-batch drafts carry the item's media
  upsertBucket = null, deleteBucket = null, // (clientId, bucket) / (clientId, bucketId, {reassignTo}) -> the Content Center bucket-store writers (bucket-edit proposals). Absent => bucket-edit confirm fails clearly
  actionRuntime = null, // agent/action-runtime.js createActionRuntime(...): run_action / undo / audit log / autonomy. Absent => the action tools answer "not available" and the action-* routes 503
  rejectPost = null, // (clientId, postId, {reviewedBy, expectedRevision}) -> rejectDraft; queue-bulk delete-draft. Absent => lazy import of twitter-service
  readQueuePosts = null, // (clientId) -> raw social_posts rows (newest first); memory-suggest / media-tasks previews. Absent => those tools say not available
  listMediaTaskIds = null, createMediaTasks = null, // (clientId) -> Set of existing task ids; ({clientId, rows, by, proposalId}) -> {created, existing}: the content_tasks store (media-tasks)
  linkItemMedia = null, // (clientId, links) -> {linked, failed, results}; the quote-targets link-item-media writer. Absent => item-media confirm fails clearly
  env = {}, // explicit on purpose: only createStrategyHandlersFromDb passes process.env, so a bare handler can never reach a real model
} = {}) {
  if (!corpusStore || !basePlanStore || !refreshService || typeof readXGrowthConfig !== 'function') {
    throw new Error('createStrategyHandlers: corpusStore, planStore, refreshService, readXGrowthConfig are required');
  }

  // Every plan write (manual apply, revert, chat plan-change) goes through this wrapper: when it changes the
  // tracks or the pace benchmark, the xGrowth profile's benchmarkHandles are rewritten from the tracks
  // (profileBenchmarksFromPlan) so the daily loop, content plan and scripts read the same handles.
  // A mirror failure never fails the plan write; it is reported as result.profileSync.error.
  async function mirrorProfile(clientId, before, after) {
    const next = profileBenchmarksFromPlan(after);
    if (!next || typeof saveXGrowthProfile !== 'function') return null;
    const prev = profileBenchmarksFromPlan(before);
    if (prev && prev.join() === next.join()) return null;
    try {
      const saved = await saveXGrowthProfile(clientId, { benchmarkHandles: next });
      return { benchmarkHandles: saved?.benchmarkHandles ?? next };
    } catch (err) { return { error: String(err?.message || err).slice(0, 160), benchmarkHandles: next }; }
  }
  const withMirror = (write) => async (clientId, ...args) => {
    const before = await basePlanStore.get(clientId);
    const out = await write(clientId, ...args);
    const profileSync = out?.changed ? await mirrorProfile(clientId, before, out.doc) : null;
    return profileSync ? { ...out, profileSync } : out;
  };
  // Direct profile saves (Handles editor, chat benchmarks-change) keep the track-derived list when tracks exist,
  // so they can only change the own handle there.
  const saveProfileKeepingTracks = typeof saveXGrowthProfile !== 'function' ? null : async (clientId, p) => {
    const derived = profileBenchmarksFromPlan(await basePlanStore.get(clientId));
    return saveXGrowthProfile(clientId, derived ? { ...p, benchmarkHandles: derived } : p);
  };
  // Client Brain write-back: strategy-doc and plan saves (manual card edits AND confirmed chat proposals, which run
  // through these same stores) tell the Brain via onBrainOwnedSaved(clientId, target, prior, next), where prior/next
  // are the whole stored docs. Awaited (a serverless function can end before an un-awaited write, which lost the
  // 2026-10-17 bucket-track write-back) and run one target at a time (each rewrites the Brain Markdown, so two at
  // once could drop one). A hook failure never fails the save. The Brain's own sync (source 'client-brain') is
  // skipped so it cannot loop. Absent hook => stores are used as-is.
  const jsonEq = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const fromBrain = (opts) => opts?.source === 'client-brain' || opts?.by === 'client-brain';
  async function notifyBrain(clientId, target, prior, next) {
    try { await onBrainOwnedSaved(clientId, target, prior, next); }
    catch (err) { console.warn('[x-strategy] onBrainOwnedSaved failed:', target, err?.message || err); }
  }
  const notifyPlan = async (clientId, prior, out, opts) => {
    if (!onBrainOwnedSaved || !out?.changed || fromBrain(opts)) return;
    if (!jsonEq(prior?.plan?.contentTracks, out.doc?.plan?.contentTracks)) await notifyBrain(clientId, 'contentTracks', prior, out.doc);
    if (!jsonEq(prior?.plan?.engineTargets, out.doc?.plan?.engineTargets)) await notifyBrain(clientId, 'trackTargets', prior, out.doc);
  };
  const withBrainPlan = (write) => async (clientId, ...args) => {
    const prior = onBrainOwnedSaved ? await basePlanStore.get(clientId) : null;
    const out = await write(clientId, ...args);
    await notifyPlan(clientId, prior, out, args[0]);
    return out;
  };
  const planStore = {
    ...basePlanStore,
    get: (...a) => basePlanStore.get(...a),
    apply: withBrainPlan(withMirror((...a) => basePlanStore.apply(...a))),
    revert: withBrainPlan(withMirror((...a) => basePlanStore.revert(...a))),
  };
  const withBrainDoc = (write) => async (clientId, ...args) => {
    const prior = onBrainOwnedSaved ? await baseDocStore.get(clientId) : null;
    const out = await write(clientId, ...args);
    if (onBrainOwnedSaved && out?.changed && !fromBrain(args[0])) await notifyBrain(clientId, 'strategyDoc', prior, out.doc);
    return out;
  };
  const docStore = baseDocStore && onBrainOwnedSaved
    ? { ...baseDocStore, get: (...a) => baseDocStore.get(...a), apply: withBrainDoc((...a) => baseDocStore.apply(...a)), revert: withBrainDoc((...a) => baseDocStore.revert(...a)) }
    : baseDocStore;

  // Content tracks follow Content Center buckets (bucket-tracks.js). Runs on every Strategy load and after bucket
  // create/rename/delete; writes through the wrapped planStore so the Brain and the profile mirror hear about it.
  // Never fails the caller: a conflict or error just leaves the plan as it is until the next sync.
  async function syncTracks(clientId) {
    if (typeof readBuckets !== 'function') return { changed: false, skipped: 'no-reader' };
    try {
      return await syncBucketTracks(clientId, { planStore, readBuckets, readBucketEngine, now: clock() });
    } catch (err) {
      return { changed: false, error: String(err?.message || err).slice(0, 160) };
    }
  }

  // Calendar batch (calendar-batch.js): plan review drafts for a set of library items, and write them on `execute`.
  // Shared by the route actions, the agent's propose tool (preview) and the confirmed proposal (execute).
  async function calendarBatch(clientId, rawSpec, { execute = false, batchId = null } = {}) {
    const norm = normalizeBatchSpec(rawSpec);
    if (!norm.ok) return { ok: false, status: 400, error: norm.errors.join('; ') };
    const profile = await loadProfile(clientId);
    const planDoc = await planStore.get(clientId);
    const open = typeof readOpenPackageIds === 'function' ? await readOpenPackageIds(clientId) : new Set();
    const packages = await readPackages(clientId);
    const plan = planCalendarBatch({
      packages, tracks: tracksOf(planDoc), spec: norm.spec,
      today: localDate(clock(), profile.timezone), openPackageIds: open,
    });
    if (!plan.ok) return { ok: false, status: 400, error: plan.error };
    if (!execute) return { ok: true, spec: norm.spec, ...plan };
    if (typeof ensureDraft !== 'function') return { ok: false, status: 503, error: 'Creating drafts is not available on this deployment.' };
    const byId = new Map((packages || []).map((p) => [p.id, p]));
    const mediaFor = typeof mediaForItem === 'function' ? (id) => mediaForItem(clientId, byId.get(id)) : null;
    const written = await createCalendarBatch(clientId, plan, {
      ensureDraft, mediaFor, batchId,
      ...(typeof placeDraft === 'function' ? { placeDraft: (postId, patch) => placeDraft(clientId, postId, patch) } : {}),
    });
    return { ok: true, spec: norm.spec, counts: plan.counts, firstDate: plan.firstDate, lastDate: plan.lastDate, ...written };
  }
  // Preview rows for the agent: first 20, text shortened. `previewCalendarBatch` keeps nasSha for the card thumbnails.
  const stripRows = (r) => (r.ok ? { ...r, rows: r.rows.slice(0, 20).map(({ content, ...row }) => ({ ...row, content: content.slice(0, 140) })) } : r);
  async function strategyCalendarBatchPreview(body, context) {
    const c = requireClient(body, context);
    if (c.error) return c.error;
    const r = await calendarBatch(c.clientId, body?.spec);
    return r.ok ? stripRows(r) : fail(r.status, r.error);
  }
  async function strategyCalendarBatchCreate(body, context) {
    const c = requireClient(body, context);
    if (c.error) return c.error;
    const r = await calendarBatch(c.clientId, body?.spec, { execute: true, batchId: `calendar-batch-${clock()}` });
    return r.ok ? r : fail(r.status, r.error);
  }

  // Daily fill (daily-fill.js): baseline + quote + narrative + client-work review drafts for a run of days. Shared by the
  // route actions, the agent's propose tool (preview) and the confirmed proposal (execute); the cron uses dailyFillDeps.
  const dailyFillDeps = {
    loadInputs: async (clientId) => {
      const profile = await loadProfile(clientId);
      const planDoc = await planStore.get(clientId);
      const nowMs = clock();
      const [packages, openPosts, ctx, quotes, signals] = await Promise.all([
        readPackages(clientId),
        typeof readOpenPackageIds === 'function' ? readOpenPackageIds(clientId) : new Set(),
        typeof readFillContext === 'function' ? readFillContext(clientId) : { fillPosts: [], lastUsed: new Map() },
        typeof readQuoteTargets === 'function' ? readQuoteTargets(clientId).catch(() => null) : null,
        typeof readMarketSignals === 'function' ? readMarketSignals(clientId).catch(() => null) : null,
      ]);
      return {
        tracks: tracksOf(planDoc), engineTargets: planDoc?.plan?.engineTargets ?? {}, packages, openPosts,
        fillPosts: (ctx?.fillPosts || []).filter(isFillPost), lastUsed: ctx?.lastUsed ?? new Map(),
        quoteTargets: quotes?.targets ?? [], marketSignals: signals ? shapeMarketSignals(signals) : null,
        asOf: { quotes: quotes?.generatedAt ?? null, signals: signals?.generatedAt ?? null },
        today: localDate(nowMs, profile.timezone), nowMs,
      };
    },
    ensureDraft: (clientId, payload) => (typeof ensureDraft === 'function' ? ensureDraft(clientId, payload) : Promise.reject(new Error('Creating drafts is not available on this deployment.'))),
    placeDraft: (clientId, postId, patch) => (typeof placeDraft === 'function' ? placeDraft(clientId, postId, patch) : Promise.resolve(false)),
    mediaFor: async (clientId, packageId) => {
      if (typeof mediaForItem !== 'function') return null;
      const pkg = ((await readPackages(clientId)) || []).find((p) => p.id === packageId);
      return pkg ? mediaForItem(clientId, pkg) : null;
    },
  };
  async function dailyFill(clientId, spec, { execute = false, batchId = null } = {}) {
    if (execute && typeof ensureDraft !== 'function') return { ok: false, status: 503, error: 'Creating drafts is not available on this deployment.' };
    return runDailyFill(clientId, { from: spec?.from, days: spec?.days, include: spec?.include, execute, batchId, deps: dailyFillDeps });
  }
  // Preview rows: text shortened (the agent's context is small); counts and skip examples are unchanged.
  const stripFillRows = (r) => (r.ok ? { ...r, rows: r.rows.map(({ text, ...row }) => ({ ...row, text: text.slice(0, 140) })) } : r);
  // Per-part freshness (the same bundle get_freshness reads) plus, per Refresh group, the OLDEST age-ruled part's asOf
  // and the tightest max age, so the Refresh panel's "updated Xh ago / stale" labels agree with the agent.
  async function strategyFreshness(body, context) {
    const c = requireClient(body, context);
    if (c.error) return c.error;
    if (!readBriefRaw) return fail(501, 'Freshness is not available on this deployment.');
    const f = freshnessOf(buildBriefBundle(await readBriefRaw(c.clientId, briefReaders(c.clientId, {})), { now: Date.now() }));
    const serverAsOf = {};
    const staleAfterHours = {};
    for (const p of Object.values(f.parts)) {
      const g = p.refreshGroup;
      if (!g || !Number.isFinite(p.maxAgeHours)) continue;
      staleAfterHours[g] = Math.min(staleAfterHours[g] ?? Infinity, p.maxAgeHours);
      if (!(g in serverAsOf)) serverAsOf[g] = p.asOf ?? null;
      else if (serverAsOf[g] && (!p.asOf || Date.parse(p.asOf) < Date.parse(serverAsOf[g]))) serverAsOf[g] = p.asOf ?? null;
    }
    return { ok: true, ...f, groups: { serverAsOf, staleAfterHours } };
  }
  async function strategyDailyFillPreview(body, context) {
    const c = requireClient(body, context);
    if (c.error) return c.error;
    const r = await dailyFill(c.clientId, body?.spec);
    return r.ok ? stripFillRows(r) : fail(r.status, r.error);
  }
  async function strategyDailyFillCreate(body, context) {
    const c = requireClient(body, context);
    if (c.error) return c.error;
    const r = await dailyFill(c.clientId, body?.spec, { execute: true, batchId: `daily-fill-${clock()}` });
    return r.ok ? r : fail(r.status, r.error);
  }

  /** The admin-selected client only: body.clientId must be present and equal context.clientId. */
  function requireClient(body, context) {
    const id = typeof body?.clientId === 'string' ? body.clientId.trim() : '';
    if (!id || id.includes('/')) return { error: fail(400, 'clientId is required.') };
    if (!context?.clientId || id !== context.clientId) return { error: fail(403, 'clientId does not match the selected client.') };
    return { clientId: id };
  }

  // Null handle / [] benchmarks / `unset` + `defaulted` live in withProfileDefaults (shared with content-plan.js).
  async function loadProfile(clientId) {
    const config = await readXGrowthConfig(clientId);
    return withProfileDefaults(resolveProfile({ config }));
  }

  /** Local readers the brief bundle composes (same stores the other chat tools use). */
  function briefReaders(clientId, preloaded) {
    return {
      readPlanDoc: (id) => planStore.get(id),
      readStrategyDoc: (id) => (docStore ? readDoc(id) : null),
      readTodayRun: readTodayRun ? (id) => readTodayRun(id) : null,
      readXMonitor: readAudience ? async (id) => (await readAudience(id))?.account ?? null : null,
      readCorpora: async () => {
        const profile = preloaded.profile ?? (preloaded.profile = await loadProfile(clientId));
        const handles = [profile.ownHandle, ...(profile.benchmarkHandles || [])].map((h) => safeHandle(h)).filter(Boolean);
        const now = Date.now();
        return Promise.all([...new Set(handles)].map(async (h) => {
          const r = await readHandle(h);
          const d = describeRows(h, r, now);
          return { handle: h, source: r.source, rows: (r.rows || []).length, pulledAt: d.freshness.pulledAt };
        }));
      },
    };
  }

  /** Never fails a read path: a health lookup error just omits the field. */
  async function workerHealthFor(clientId) {
    if (typeof readWorkerHealth !== 'function') return {};
    try { return { workerHealth: await readWorkerHealth(clientId) }; } catch { return {}; }
  }

  const safeHandle = (h) => { try { return normalizeHandle(h); } catch { return null; } };

  async function readHandle(handle) {
    const h = safeHandle(handle);
    if (!h) return { handle, invalid: true, rows: [], meta: null, source: 'none' };
    const r = await corpusStore.readRows(h);
    return { handle: h, rows: r.rows || [], meta: r.meta ?? null, source: r.source };
  }

  /** Never fails a read path: no Brain / not approved / error => no Brain shares. */
  async function brainTargetsFor(clientId) {
    if (typeof readBrainTrackTargets !== 'function') return {};
    try {
      const rows = await readBrainTrackTargets(clientId);
      return Array.isArray(rows) && rows.length ? { brainTrackTargets: rows } : {};
    } catch { return {}; }
  }

  async function runEvaluate(input) {
    try {
      return { evaluation: await evaluate(input) };
    } catch (err) {
      return { evaluation: null, evaluationError: String(err?.message || err).slice(0, 200) };
    }
  }

  function todayPreview({ profile, planDoc, own, bench, packages, now }) {
    if (!own.rows.length) return { available: false, reason: 'no-own-rows' };
    try {
      const plan = planDoc?.plan ?? null;
      const date = localDate(now, profile.timezone);
      const input = {
        corpusRows: own.rows, benchmarkRows: bench?.rows?.length ? bench.rows : null,
        packages, date, handle: own.handle, now,
        ...(profile.lanes.length ? { lanes: profile.lanes } : {}),
      };
      // No plan -> untouched buildDayPlan defaults. With a plan: its cadence (+ non-empty engine overrides).
      if (plan) {
        const resolved = resolvePlanInputs(planDoc);
        input.posts = resolved.posts;
        if (resolved.engineConfig) input.engineConfig = resolved.engineConfig;
      }
      const dayPlan = buildPreviewPlan(input);
      const posts = input.posts ?? dayPlan?.posts ?? undefined;
      return { available: true, date, posts: posts ?? null, usedPlan: !!plan, plan: dayPlan, summary: projectDayPlan(dayPlan, posts ? { posts } : undefined).summary };
    } catch (err) {
      return { available: false, reason: `preview-failed: ${String(err?.message || err).slice(0, 160)}` };
    }
  }

  /** Per-track profiles (never averaged across tracks); a failure omits them rather than failing the read. */
  async function safeTrackProfiles(planDoc, profile) {
    try {
      return await loadTrackProfiles({ tracks: tracksOf(planDoc), corpusStore, ownHandle: safeHandle(profile.ownHandle) });
    } catch { return []; }
  }

  async function strategyGet(body, context) {
    const c = requireClient(body, context);
    if (c.error) return c.error;
    const now = clock();
    await syncTracks(c.clientId);
    const profile = await loadProfile(c.clientId);
    const planDoc = await planStore.get(c.clientId);
    const explicitTracks = hasExplicitTracks(planDoc);
    const trackHandles = explicitTracks ? trackBenchmarkHandles(tracksOf(planDoc)) : [];
    const handles = [...new Set([profile.ownHandle, ...profile.benchmarkHandles, ...trackHandles].filter(Boolean).map((h) => safeHandle(h) || h))];
    const reads = {};
    for (const h of handles) reads[h] = await readHandle(h);
    const rowsMeta = handles.map((h) => describeRows(h, reads[h], now));

    const ownKey = safeHandle(profile.ownHandle);
    const own = (ownKey && reads[ownKey]) || { handle: ownKey || profile.ownHandle, rows: [], meta: null, source: 'none' };
    const benchmarkKeys = [...new Set([...profile.benchmarkHandles, ...trackHandles].map((h) => safeHandle(h)).filter(Boolean))];
    const benchmarks = benchmarkKeys.map((h) => ({ handle: h, rows: reads[h].rows, meta: reads[h].meta }));

    const { evaluation, evaluationError } = await runEvaluate({
      ownHandle: own.handle, ownRows: own.rows, ownMeta: own.meta, benchmarks,
      ...(explicitTracks ? { tracks: tracksOf(planDoc) } : {}),
      ...(await brainTargetsFor(c.clientId)),
      plan: planDoc?.plan ?? DEFAULT_PLAN, now,
    });

    const primary = planDoc?.plan?.benchmarkPrimary;
    const bench = benchmarks.find((b) => b.handle === primary) || benchmarks[0] || null;
    const packages = own.rows.length ? await readPackages(c.clientId) : [];
    return {
      ok: true,
      clientId: c.clientId,
      profile,
      rowsMeta,
      evaluation,
      ...(evaluationError ? { evaluationError } : {}),
      plan: planDoc,
      trackProfiles: await safeTrackProfiles(planDoc, profile),
      todayPlanPreview: todayPreview({ profile, planDoc, own, bench, packages, now }),
      ...(await workerHealthFor(c.clientId)),
    };
  }

  async function strategyRefresh(body, context, auth) {
    const c = requireClient(body, context);
    if (c.error) return c.error;
    let handles = body?.handles;
    if (handles === undefined || handles === null) {
      const p = await loadProfile(c.clientId);
      handles = [p.ownHandle, ...p.benchmarkHandles].filter(Boolean);
      if (!handles.length) return fail(400, 'No handles to refresh: the X growth profile has no own or benchmark handle.');
    }
    // requestRefresh validates (chars, non-empty, <= PLAN_LIMITS.maxHandlesPerRefreshRequest) and throws status-400 errors.
    const out = await refreshService.requestRefresh({ handles, clientId: c.clientId, requestedBy: auth?.decoded?.email || auth?.decoded?.uid || null });
    return { ok: true, requestId: out.requestId, status: out.status, ...(out.merged ? { merged: true } : {}) }; // drain (if any) is intentionally not awaited
  }

  // body.workerOnly:true (+ clientId) returns just the worker heartbeat, no requestId needed (the Inputs strip uses it).
  async function strategyRefreshStatus(body, context) {
    const id = typeof body?.requestId === 'string' ? body.requestId.trim() : '';
    const hasClient = body?.clientId !== undefined && body?.clientId !== null && body?.clientId !== '';
    let health = {};
    if (hasClient) {
      const c = requireClient(body, context);
      if (c.error) return c.error;
      health = await workerHealthFor(c.clientId);
    }
    if (!id && hasClient && body?.workerOnly === true) return { ok: true, ...health };
    if (!REQUEST_ID_RE.test(id)) return fail(400, 'requestId is required.');
    const request = await refreshService.getRequestStatus(id);
    if (!request) return fail(404, 'Refresh request not found.');
    return { ok: true, request, ...health };
  }

  async function strategyEvaluateHandle(body, context) {
    const c = requireClient(body, context);
    if (c.error) return c.error;
    const handle = safeHandle(body?.handle);
    if (!handle) return fail(400, 'A valid X handle is required.');
    const now = clock();
    const profile = await loadProfile(c.clientId);
    const planDoc = await planStore.get(c.clientId);
    const target = await readHandle(handle);
    if (!target.rows.length) return { ok: true, handle, needsRefresh: true, rowsMeta: describeRows(handle, target, now) };
    const ownKey = safeHandle(profile.ownHandle);
    const own = ownKey ? await readHandle(ownKey) : null;
    if (!own || !own.rows.length) {
      return { ok: true, handle, needsRefresh: true, missingOwn: true, ownHandle: ownKey || null, rowsMeta: describeRows(handle, target, now) };
    }
    const { evaluation, evaluationError } = await runEvaluate({
      ownHandle: own.handle, ownRows: own.rows, ownMeta: own.meta,
      benchmarks: [{ handle, rows: target.rows, meta: target.meta }],
      plan: planDoc?.plan ?? DEFAULT_PLAN, now,
    });
    return {
      ok: true, handle, needsRefresh: false, evaluation,
      ...(evaluationError ? { evaluationError } : {}),
      rowsMeta: describeRows(handle, target, now),
    };
  }

  const by = (auth) => auth?.decoded?.email || auth?.decoded?.uid || 'admin';
  /** What run_action needs to call a route AS the owner: their own authorization header (+ ?as= while impersonating). */
  const actionCtx = (clientId, context, auth) => ({
    clientId, authorization: auth?.authorization || null, origin: auth?.origin || null,
    impersonating: auth?.impersonating ?? context?.impersonating === true, by: by(auth),
  });

  async function strategyPlanApply(body, context, auth) {
    const c = requireClient(body, context);
    if (c.error) return c.error;
    const tracksTouched = !!body?.changes && 'contentTracks' in body.changes;
    const before = tracksTouched ? await planStore.get(c.clientId) : null;
    const doc = await planStore.apply(c.clientId, {
      changes: body?.changes, expectedVersion: body?.expectedVersion, reason: typeof body?.reason === 'string' ? body.reason : '',
      by: by(auth), source: 'manual', now: clock(),
    });
    // A new track benchmark handle queues a corpus refresh (drained by the Mac worker); a queue failure never fails the save.
    let refresh = null;
    const added = tracksTouched ? newTrackBenchmarkHandles(before, doc.doc) : [];
    if (added.length) {
      try {
        const out = await refreshService.requestRefresh({ handles: added, clientId: c.clientId, requestedBy: by(auth) });
        refresh = { requestId: out.requestId, status: out.status, handles: added };
      } catch (err) { refresh = { error: String(err?.message || err).slice(0, 160), handles: added }; }
    }
    return { ok: true, plan: doc.doc, changed: doc.changed, ...(refresh ? { refresh } : {}), ...(doc.profileSync ? { profileSync: doc.profileSync } : {}) };
  }

  async function strategyPlanRevert(body, context, auth) {
    const c = requireClient(body, context);
    if (c.error) return c.error;
    const doc = await planStore.revert(c.clientId, body?.version, { by: by(auth), now: clock() });
    return { ok: true, plan: doc.doc, changed: doc.changed, ...(doc.profileSync ? { profileSync: doc.profileSync } : {}) };
  }

  // ---- T4b: chat, proposals, profile save -------------------------------------------------------------

  const needChat = () => (chatStore ? null : fail(503, 'Strategy chat is not configured on this deployment.'));
  const parseThreadId = (v) => (v === undefined || v === null || v === '' ? { id: null } : THREAD_ID_RE.test(String(v)) ? { id: String(v) } : { error: fail(400, 'threadId is invalid.') });

  const compactRow = (r) => ({
    id: r.id, type: r.type ?? null, at: r.utc ?? r.createdAt ?? null,
    text: String(r.text ?? '').slice(0, 220), likes: r.likes ?? null, views: r.views ?? null,
    ...(r.url ? { url: r.url } : {}),
  });

  /** Read tools for the agent, built from the same readers the strategy-get action uses. */
  function buildToolDeps(clientId, context, preloaded, auth) {
    return {
      // run_action / find_actions / undo_action / get_action_log. Needs the owner's own request auth (MCP and workers have none).
      ...(actionRuntime ? { actions: { runtime: actionRuntime, ctx: actionCtx(clientId, context, auth) } } : {}),
      // Same computation as strategy-get (one source of numbers); the model never gets raw rows.
      getEvaluation: async () => {
        const r = await strategyGet({ clientId }, context);
        return r.ok ? { evaluation: r.evaluation ?? null, profile: r.profile, rowsMeta: r.rowsMeta, evaluationError: r.evaluationError ?? null } : { error: r.error };
      },
      getProfileHandles: async () => {
        const profile = preloaded.profile ?? (preloaded.profile = await loadProfile(clientId));
        return [profile.ownHandle, ...(profile.benchmarkHandles || [])].map((h) => safeHandle(h)).filter(Boolean);
      },
      // Each track also reports what is in it (item count, top tags, sample titles), so the model can pick from a track.
      getTracks: async () => {
        const planDoc = await planStore.get(clientId);
        const profile = preloaded.profile ?? (preloaded.profile = await loadProfile(clientId));
        const tracks = tracksOf(planDoc);
        return { tracks, library: summarizeTrackLibrary(tracks, await readPackages(clientId)), profiles: await safeTrackProfiles(planDoc, profile) };
      },
      getPlan: async () => ((await planStore.get(clientId)) ?? { version: 0, plan: DEFAULT_PLAN, history: [], isDefault: true }),
      // Stored doc or the seeded draft (version 0); absent docStore => null (prompt says none available).
      getStrategyDoc: async () => (docStore ? readDoc(clientId) : null),
      getContext: async () => (readContentContext ? readContentContext(clientId) : { error: 'Content context is not available.' }),
      getTodayRun: async () => summarizeTodayRun(readTodayRun ? await readTodayRun(clientId) : null),
      // Closed over THIS request's clientId; the model never supplies one. Absent reader => key absent => tool says 'not available'.
      ...(readQueueSummary ? { readQueueSummary: () => readQueueSummary(clientId) } : {}),
      ...(readPost ? { readPost: (postId) => readPost(clientId, postId) } : {}),
      ...(readOpportunities ? { readOpportunities: () => readOpportunities(clientId) } : {}),
      ...(readResults ? { readResults: () => readResults(clientId) } : {}),
      ...(readMarketSignals ? { readMarketSignals: () => readMarketSignals(clientId) } : {}),
      // Every brief/market/strategy part with its age + the Refresh group that updates it. Read-only; never refreshes.
      ...(readBriefRaw ? { readBriefBundle: async ({ part } = {}) => buildBriefBundle(await readBriefRaw(clientId, briefReaders(clientId, preloaded)), { now: Date.now(), part }) } : {}),
      searchInventory: async ({ query, limit, track } = {}) => {
        const max = Math.min(Math.max(1, Number(limit) || 10), 20);
        const tokens = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
        const tracks = tracksOf(await planStore.get(clientId));
        const want = track ? String(track).trim().toLowerCase() : '';
        const only = want ? tracks.find((t) => t.id === want || t.label.toLowerCase() === want) : null;
        if (want && !only) return { error: `unknown track "${track}"`, tracks: tracks.map((t) => ({ id: t.id, label: t.label })) };
        const pkgs = await readPackages(clientId);
        const scored = [];
        for (const p of pkgs || []) {
          if (only && trackForPackage(tracks, p)?.id !== only.id) continue;
          const hay = `${p.id} ${p.title ?? ''} ${p.story ?? ''} ${(p.searchTokens || []).join(' ')} ${JSON.stringify(p.facets ?? {})} ${JSON.stringify(p.humanEdits ?? {})}`.toLowerCase();
          const score = tokens.length ? tokens.filter((t) => hay.includes(t)).length : 0;
          if (!tokens.length || score) scored.push({ score, p });
        }
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, max).map(({ p }) => ({
          id: p.id, title: p.title ?? null, story: String(p.story ?? '').slice(0, 160), bucketId: p.bucketId ?? null, track: trackForPackage(tracks, p)?.id ?? null,
          hasStory: !!String(p.story ?? '').trim() && !hasPlaceholderStory(p), facets: p.humanEdits || p.facets || {},
        }));
      },
      // Item media (item-media.js): who could lend media to an item, and a dry run of a set of links (no writes).
      findItemMedia: async ({ id, limit } = {}) => {
        const pkgs = await readPackages(clientId);
        const target = (pkgs || []).find((p) => p.id === id);
        if (!target) return { error: `unknown item ${id}` };
        return { id, title: target.title ?? null, hasMedia: !!mediaOf(target).kind, candidates: findMediaCandidates(target, pkgs, { limit }) };
      },
      previewItemMedia: async (links) => {
        const norm = normalizeLinks(links);
        if (!norm.ok) return { ok: false, error: norm.errors.join('; ') };
        const byId = new Map((await readPackages(clientId) || []).map((p) => [p.id, p]));
        const rows = norm.links.map((l) => {
          const t = byId.get(l.targetId);
          const s = byId.get(l.sourceId);
          const r = t && s ? linkMediaPatch(t, s) : { error: `${!t ? l.targetId : l.sourceId} not found` };
          return { ...l, targetTitle: t?.title ?? null, sourceTitle: s?.title ?? null, ...(r.error ? { error: r.error } : { kind: r.patch.mediaFrom.kind }) };
        });
        return { ok: true, rows };
      },
      // Suggested memory lines for placeholder drafts (memory-suggest.js). Read-only; the card + decide carry the owner's edits.
      ...(readQueuePosts ? {
        previewMemorySuggestions: async ({ postIds = [], filter = null, suggestions = {} } = {}) => {
          const posts = await readQueuePosts(clientId);
          const inRange = (p) => (!filter?.from || (p.reviewOn && p.reviewOn >= filter.from)) && (!filter?.to || (p.reviewOn && p.reviewOn <= filter.to));
          const want = new Set(postIds);
          const picked = (want.size ? posts.filter((p) => want.has(p.id)) : posts.filter((p) => postNeedsMemory(p) && inRange(p))).slice(0, MAX_MEMORY_SUGGESTIONS);
          const missing = [...want].filter((id) => !picked.some((p) => p.id === id)).map((id) => `${id}: unknown post id`);
          const out = planMemorySuggestions({ posts: picked, packages: (await readPackages(clientId)) || [], suggestions });
          return { ok: true, rows: out.rows, problems: [...missing, ...out.problems] };
        },
      } : {}),
      // "Film this" reminders (content-tasks.js) for calendar items without media. Read-only dry run.
      ...(readQueuePosts && listMediaTaskIds ? {
        previewMediaTasks: async ({ postIds = [], filter = null, kind = 'film' } = {}) => {
          const [posts, packages, existingTaskIds] = await Promise.all([readQueuePosts(clientId), readPackages(clientId), listMediaTaskIds(clientId)]);
          return { ok: true, ...planMediaTasks({ posts, packages: packages || [], existingTaskIds, kind, today: ctDate(clock()), postIds, filter }) };
        },
      } : {}),
      // Dry run only (no writes): what a calendar batch would create. The proposal re-plans at confirm time.
      previewCalendarBatch: async (spec) => stripRows(await calendarBatch(clientId, spec)),
      // Dry run only (no writes): what a daily fill would create. The proposal re-plans at confirm time.
      previewDailyFill: async (spec) => stripFillRows(await dailyFill(clientId, spec)),
      getAlgorithm: async () => summarizeAlgorithm(getAlgorithmProfile()),
      scorePosts: async ({ handle, days, limit } = {}) => {
        const profile = preloaded.profile ?? (preloaded.profile = await loadProfile(clientId));
        const planDoc = await planStore.get(clientId);
        const allowed = [profile.ownHandle, ...profile.benchmarkHandles, ...trackBenchmarkHandles(tracksOf(planDoc))].map((h) => safeHandle(h)).filter(Boolean);
        const h = safeHandle(handle) || safeHandle(profile.ownHandle);
        if (!h || !allowed.includes(h)) return { error: 'handle must be the own or a benchmark handle', allowed: [...new Set(allowed)] };
        const read = await readHandle(h);
        return shapeScoredPosts(read.rows, { score: scoreXPost, handle: h, days, limit, nowMs: clock() });
      },
      getRuleCheck: async ({ days } = {}) => {
        const profile = preloaded.profile ?? (preloaded.profile = await loadProfile(clientId));
        const h = safeHandle(profile.ownHandle);
        if (!h) return { error: 'no own handle' };
        return ruleCheck((await readHandle(h)).rows, { guard: guardXPost, handle: h, days, nowMs: clock() });
      },
      getAudience: async ({ days } = {}) => {
        if (typeof readAudience !== 'function') return { available: false, reason: 'X Monitor data is not available on this deployment.' };
        // Resolved by the client's X account id, never by a handle match: no other client's account can answer.
        return summarizeAudience(await readAudience(clientId), { days, nowMs: clock() });
      },
      getXSpend: async ({ days } = {}) => {
        const { readXUsage } = await import('../x-api-usage/index.js');
        const u = await readXUsage({ days });
        return { today: u.today, month: u.month, byDay: u.byDay.slice(-14), bySource: u.bySource, byEndpoint: u.byEndpoint, estUsd: u.estUsd, ratesSet: u.ratesSet, cap: u.cap, projectUsage: u.projectUsage, note: u.note };
      },
      topPosts: async ({ handle, type, topic, limit } = {}) => {
        const profile = preloaded.profile ?? (preloaded.profile = await loadProfile(clientId));
        const allowed = [profile.ownHandle, ...profile.benchmarkHandles].map((h) => safeHandle(h)).filter(Boolean);
        const h = safeHandle(handle) || safeHandle(profile.ownHandle);
        if (!h || !allowed.includes(h)) return { error: 'handle must be the own or a benchmark handle', allowed };
        const read = await readHandle(h);
        const t = topic ? String(topic).toLowerCase() : '';
        const rows = read.rows
          .filter((r) => (!type || r.type === type) && (!t || String(r.text ?? '').toLowerCase().includes(t) || (Array.isArray(r.tags) && r.tags.some((x) => String(x).toLowerCase() === t))))
          .sort((a, b) => (Number(b.views ?? b.likes ?? 0)) - (Number(a.views ?? a.likes ?? 0)))
          .slice(0, Math.min(Math.max(1, Number(limit) || 5), 10));
        return { handle: h, rowCount: read.rows.length, rows: rows.map(compactRow) };
      },
    };
  }

  // THE ONLY PLACE THE MODEL IS CALLED FROM THE ROUTE. Everything else in this file (and the whole route) is
  // model-free; the agent loop reaches Anthropic solely through the `callModel` built here, and only for
  // `strategy-chat-send`, after the daily-turn cap has been reserved. No ANTHROPIC_API_KEY (and no injected
  // callModel / agentLoopFactory) => null => the caller answers 503 and nothing is called.
  // The import is a static-string dynamic import: lazy (route cold-start never loads the loop) yet still
  // visible to the Next/Turbopack tracer, so ./agent/loop.js is bundled.
  async function resolveLoop(clientId, toolDeps) {
    if (agentLoopFactory) return agentLoopFactory({ clientId, toolDeps });
    const apiKey = env?.ANTHROPIC_API_KEY;
    if (typeof callModel !== 'function' && !apiKey) return null;
    const { createAgentLoop, createAnthropicCaller, createDefaultLogUsage } = await import('./agent/loop.js');
    return createAgentLoop({
      callModel: typeof callModel === 'function' ? callModel : createAnthropicCaller({ apiKey }),
      toolDeps,
      logUsage: typeof logUsage === 'function' ? logUsage : createDefaultLogUsage(), // loop supplies clientId + purpose 'x-strategy-chat'
    });
  }

  /** Resolve the selected item for the request's OWN client only; null when unknown/other-client/unreadable. */
  async function resolveSelectedContext(clientId, rawSelected) {
    const sel = normalizeSelected(rawSelected);
    if (!sel) return '';
    let resolved = null;
    try {
      if (sel.kind === 'suggestion' && readTodayRun) {
        const hit = summarizeTodayRun(await readTodayRun(clientId)).suggestions.find((s) => s.id === sel.id);
        if (hit) resolved = { status: hit.status, text: hit.text };
      } else if (sel.kind === 'post' && readPost) {
        const p = await readPost(clientId, sel.id);
        if (p && typeof p === 'object') resolved = { status: p.status ?? null, scheduledAt: p.scheduledAt ?? null, text: p.content ?? p.text ?? '' };
      } else if (sel.kind === 'opportunity' && readOpportunities) {
        const o = await readOpportunities(clientId);
        const list = Array.isArray(o?.targets) ? o.targets : Array.isArray(o?.rows) ? o.rows : [];
        const hit = list.find((t) => t && t.id === sel.id);
        if (hit) resolved = { text: hit.text ?? hit.excerpt ?? '' };
      }
    } catch { resolved = null; }
    return describeSelected(sel, resolved);
  }

  async function strategyChatSend(body, context, auth) {
    const c = requireClient(body, context);
    if (c.error) return c.error;
    const off = needChat(); if (off) return off;
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) return fail(400, 'text is required.');
    if (text.length > CHAT_TEXT_MAX) return fail(400, `text must be at most ${CHAT_TEXT_MAX} characters.`);
    return runChatTurn(c.clientId, context, { threadIdRaw: body?.threadId, modelText: text, storedText: text, selected: body?.selected, auth });
  }

  /**
   * One agent turn: thread lookup, model-config check, turn-cap reservation, the loop, proposal validation, persist.
   * `modelText` is what the model reads; `storedText` is what the thread shows (a Review stores a short line but
   * sends the full brief). `turnOpts` ({maxRounds, maxTokens}) lets a Review use a bigger tool budget.
   */
  async function runChatTurn(clientId, context, { threadIdRaw, modelText, storedText, selected, turnOpts, auth } = {}) {
    const c = { clientId };
    const text = storedText;
    const t = parseThreadId(threadIdRaw);
    if (t.error) return t.error;

    let thread = null;
    if (t.id) {
      thread = await chatStore.getThread(c.clientId, t.id);
      if (!thread) return fail(404, 'Thread not found.');
    }
    const threadId = t.id || `t_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const now = clock();

    // An unconfigured model must not burn a turn: resolve the loop (no model call) before reserving.
    const preloaded = {};
    const toolDeps = buildToolDeps(c.clientId, context, preloaded, auth);
    const loop = await resolveLoop(c.clientId, toolDeps);
    if (!loop) return fail(503, 'The strategy agent model is not configured on this deployment (no model configured).', { turnsUsedToday: await chatStore.usedToday(c.clientId, now), cap: chatStore.cap });

    // Cap first, and BEFORE any model work. The reservation is atomic and counts a turn that later fails.
    let used;
    try {
      used = await chatStore.reserveTurn(c.clientId, now);
    } catch (err) {
      if (err instanceof ChatCapError) return fail(429, err.message, { code: 'chat-cap', used: err.used, cap: err.cap });
      throw err;
    }

    // History for the loop: stored messages (user/assistant) preceded by the folded summary as a 'note'.
    const history = [
      ...(thread?.summaryNote ? [{ role: 'note', text: thread.summaryNote }] : []),
      ...(thread?.messages || []).slice(-HISTORY_MESSAGES_TO_MODEL).map((m) => ({ role: m.role, text: withCardOutcomes(m, thread?.proposals) })),
    ];
    let turn;
    try {
      const selectedContext = await resolveSelectedContext(c.clientId, selected);
      turn = await loop.runTurn({ clientId: c.clientId, threadId, history, userText: modelText, now, ...(selectedContext ? { selectedContext } : {}), ...(turnOpts || {}) });
    } catch (err) {
      return fail(502, `The strategy agent failed: ${String(err?.message || err).slice(0, 200)}`, { turnsUsedToday: used, cap: chatStore.cap });
    }

    const planDoc = await planStore.get(c.clientId);
    const currentPlan = planDoc?.plan;
    const proposals = [];
    const dropped = [];
    let singles = 0;
    let bulks = 0;
    for (const raw of Array.isArray(turn?.proposals) ? turn.proposals : []) {
      // Single-item cards are capped at 2 a turn; bulk-class cards (incl. `action`) have their own cap.
      if (BULK_PROPOSAL_KINDS.includes(raw?.kind) ? bulks >= MAX_BULK_PROPOSALS_PER_TURN : singles >= MAX_PROPOSALS_PER_TURN) continue;
      if (BULK_PROPOSAL_KINDS.includes(raw?.kind)) bulks += 1; else singles += 1;
      const v = validateProposal(raw, { currentPlan });
      if (!v.ok) { dropped.push({ kind: raw?.kind ?? null, errors: v.errors }); continue; }
      proposals.push(assignProposal({ ...raw, kind: v.proposal.kind, payload: v.proposal.payload }, { threadId, now }));
    }
    // Honesty guard: the reply must never claim a card that does not exist. When a propose attempt failed and no
    // card was made, say so under the reply.
    let assistantText = String(turn?.text ?? '');
    if (!proposals.length) {
      const errs = [...(Array.isArray(turn?.proposalErrors) ? turn.proposalErrors : []), ...dropped.map((d) => `${d.kind}: ${(d.errors || []).join('; ')}`)];
      if (errs.length) assistantText += `\n\n(No confirm card was created: ${errs.slice(0, 3).join(' | ').slice(0, 400)}. Ask me to try again.)`;
    }
    const toolResults = (Array.isArray(turn?.toolResults) ? turn.toolResults : []).slice(0, 20);
    const undoIds = toolResults.map((r) => r.undoId).filter(Boolean);
    await chatStore.appendTurn({ clientId: c.clientId, threadId, userText: text, assistantText, proposals, usage: turn?.usage, now, undoIds });
    return {
      ok: true, threadId, text: assistantText, proposals, toolResults, undoIds,
      ...(dropped.length ? { droppedProposals: dropped } : {}),
      usage: turn?.usage ?? null, rounds: turn?.rounds ?? null, stopped: turn?.stopped ?? null,
      turnsUsedToday: used, cap: chatStore.cap,
    };
  }

  // The model only sees message text, so an assistant message is followed by what happened to the cards it made
  // (pending / confirmed / rejected / failed + the result line). Without this it tells the owner "you haven't
  // confirmed it" after they did.
  function withCardOutcomes(m, proposalsById) {
    const text = String(m?.text ?? '');
    if (m?.role !== 'assistant' || !Array.isArray(m.proposalIds) || !m.proposalIds.length || !proposalsById) return text;
    const lines = m.proposalIds.map((pid) => proposalsById[pid]).filter(Boolean).map((p) => {
      const result = p.result?.message || (p.result?.clientAction === 'marketing-refresh' ? `handed to the Refresh panel: ${(p.result.groups || []).join(', ')}` : '');
      return `- ${p.kind} card: ${p.status}${result ? ` (${String(result).slice(0, 160)})` : ''}${p.error ? ` (error: ${String(p.error).slice(0, 160)})` : ''}`;
    });
    return lines.length ? `${text}\n\n[CARD OUTCOMES, recorded by the system]\n${lines.join('\n')}` : text;
  }

  /** Newest corpus pull across the own + benchmark handles (ISO) or null: "the data a review looked at". */
  async function newestDataAt(clientId) {
    const profile = await loadProfile(clientId);
    const planDoc = await planStore.get(clientId);
    const handles = [...new Set([profile.ownHandle, ...profile.benchmarkHandles, ...trackBenchmarkHandles(tracksOf(planDoc))].map((h) => safeHandle(h)).filter(Boolean))];
    let best = null;
    for (const h of handles) {
      const at = (await corpusStore.readRows(h))?.meta?.pulledAt;
      if (at && (!best || at > best)) best = at;
    }
    return best;
  }

  // Review = one agent turn with a fixed brief and a bigger tool budget. Same cap, same proposals, same thread.
  async function strategyReview(body, context, auth) {
    const c = requireClient(body, context);
    if (c.error) return c.error;
    const off = needChat(); if (off) return off;
    const doc = docStore ? await readDoc(c.clientId) : null;
    const out = await runChatTurn(c.clientId, context, {
      threadIdRaw: body?.threadId, modelText: buildReviewBrief(doc), storedText: REVIEW_DISPLAY_TEXT,
      turnOpts: { maxRounds: REVIEW_MAX_ROUNDS, maxTokens: REVIEW_MAX_TOKENS }, auth,
    });
    if (!out.ok || !docStore) return out;
    let lastReview = null;
    try {
      const planDoc = await planStore.get(c.clientId);
      lastReview = { at: new Date(clock()).toISOString(), threadId: out.threadId, docVersion: doc?.version ?? 0, planVersion: planDoc?.version ?? 0, dataAsOf: await newestDataAt(c.clientId) };
      await docStore.markReviewed(c.clientId, lastReview);
    } catch { lastReview = null; } // a failed stamp never fails the review the owner already paid for
    return { ...out, ...(lastReview ? { lastReview } : {}) };
  }

  async function strategyChatHistory(body, context) {
    const c = requireClient(body, context);
    if (c.error) return c.error;
    const off = needChat(); if (off) return off;
    const t = parseThreadId(body?.threadId);
    if (t.error) return t.error;
    const now = clock();
    const turnsUsedToday = await chatStore.usedToday(c.clientId, now);
    const base = { ok: true, turnsUsedToday, cap: chatStore.cap };
    if (t.id) {
      const thread = await chatStore.getThread(c.clientId, t.id);
      if (!thread) return fail(404, 'Thread not found.');
      return { ...base, thread };
    }
    const threads = await chatStore.listThreads(c.clientId, 20);
    const latest = threads[0] ? await chatStore.getThread(c.clientId, threads[0].threadId) : null;
    return { ...base, threads, thread: latest };
  }

  const executors = buildExecutors({
    planStore, runDailyAction, runUpdateItemFacets, saveXGrowthProfile: saveProfileKeepingTracks, clock,
    docStore, docBase: SEED_STRATEGY_SECTIONS,
    readPost, editPost: editPost ? (a) => editPost(a) : null, runPaidSync,
    runMediaTasks: createMediaTasks ? (a) => createMediaTasks(a) : null,
    runItemMedia: linkItemMedia ? ({ clientId, links }) => linkItemMedia(clientId, links) : null,
    runCalendarBatch: async ({ clientId, spec, proposalId }) => calendarBatch(clientId, spec, { execute: true, batchId: proposalId ? `calendar-batch-${proposalId}` : null }),
    runDailyFill: async ({ clientId, spec, proposalId }) => dailyFill(clientId, spec, { execute: true, batchId: proposalId ? `daily-fill-${proposalId}` : null }),
    refreshHandles: async ({ clientId, handles, context, auth }) => strategyRefresh({ clientId, handles }, context, auth),
    placeDraft, upsertBucket, deleteBucket, syncTracks, ...(rejectPost ? { rejectPost } : {}),
    runAction: actionRuntime ? ({ clientId, payload, by: who, auth, context, proposalId }) => actionRuntime.executeApproved({ ...actionCtx(clientId, context, auth), by: who }, payload, { proposalId }) : null,
  });
  async function strategyProposalDecide(body, context, auth) {
    const c = requireClient(body, context);
    if (c.error) return c.error;
    const off = needChat(); if (off) return off;
    const t = parseThreadId(body?.threadId);
    if (t.error || !t.id) return t.error || fail(400, 'threadId is required.');
    const proposalId = typeof body?.proposalId === 'string' ? body.proposalId.trim() : '';
    if (!proposalId) return fail(400, 'proposalId is required.');
    const decision = body?.decision;
    if (decision !== 'confirm' && decision !== 'reject') return fail(400, "decision must be 'confirm' or 'reject'.");
    const now = clock();

    // Lookup is scoped to THIS thread: an id from another thread is simply not found here.
    const thread = await chatStore.getThread(c.clientId, t.id);
    if (!thread) return fail(404, 'Thread not found.');
    const existing = thread.proposals?.[proposalId];
    if (!existing || existing.threadId !== t.id) return fail(404, 'Proposal not found in this thread.');
    if (existing.status === 'deciding') return fail(409, 'Proposal is already being applied (or was interrupted). Check Today/Plan before retrying.', { proposal: existing });
    if (existing.status !== 'pending') return fail(409, `Proposal already ${existing.status}.`, { proposal: existing });

    async function releaseQuietly() {
      try { await chatStore.releaseProposal({ clientId: c.clientId, threadId: t.id, proposalId, now }); } catch { /* leaves 'deciding'; surfaced in the UI */ }
    }

    // Atomic claim: two concurrent confirms cannot both execute.
    const claim = await chatStore.claimProposal({ clientId: c.clientId, threadId: t.id, proposalId, now });
    if (!claim.claimed) return fail(409, claim.inFlight ? 'Proposal is already being decided.' : `Proposal already ${claim.proposal?.status ?? 'decided'}.`, { proposal: claim.proposal });

    // The model-use choice is the OWNER's, made on the card at confirm time; honored only for regenerate-today.
    const options = decision === 'confirm' && claim.proposal.kind === 'regenerate-today' && body?.options?.useModel === true ? { useModel: true } : {};
    if (decision === 'confirm' && claim.proposal.kind === 'action') options.typed = typeof body?.typed === 'string' ? body.typed.slice(0, 80) : '';
    // memory-suggest: the owner's per-row edits / skips from the card. Only ids that are rows of THIS proposal, lines capped.
    if (decision === 'confirm' && claim.proposal.kind === 'memory-suggest') {
      const rowIds = new Set((claim.proposal.payload?.rows || []).map((r) => r.postId));
      const rawEdits = body?.edits && typeof body.edits === 'object' && !Array.isArray(body.edits) ? body.edits : {};
      options.edits = Object.fromEntries(Object.entries(rawEdits).filter(([k, v]) => rowIds.has(k) && typeof v === 'string').map(([k, v]) => [k, v.slice(0, MEMORY_LINE_MAX + 1)]));
      options.skip = (Array.isArray(body?.skip) ? body.skip : []).map((x) => String(x ?? '')).filter((x) => rowIds.has(x));
    }
    let out;
    try {
      out = await decideProposal({ proposal: claim.proposal, decision, executors, context, clientId: c.clientId, by: by(auth), auth, options, now });
    } catch (err) {
      await releaseQuietly();
      throw err;
    }
    if (!out.ok) {
      // Nothing ran: put it back to pending so there is no stuck state.
      await releaseQuietly();
      return fail(out.status || 500, out.error, { ...(out.code ? { code: out.code } : {}), proposal: out.proposal });
    }
    // The executor may have already run. Never re-execute: retry the save, and on persistent failure leave 'deciding'.
    let proposal = null;
    for (let attempt = 0; attempt < 3 && !proposal; attempt += 1) {
      try { proposal = await chatStore.saveProposal({ clientId: c.clientId, threadId: t.id, proposal: out.proposal, now }); } catch { /* retry */ }
    }
    if (!proposal) {
      if (decision === 'reject') await releaseQuietly(); // reject executed nothing: safe to release
      return fail(500, decision === 'reject' ? 'Could not record the rejection; try again.' : 'The change was applied but the result could not be recorded - do not retry. Check Today/Plan.');
    }
    const res = { ok: true, proposal };
    if (proposal.kind === 'plan-change') res.planDoc = await planStore.get(c.clientId);
    if (proposal.kind === 'strategy-doc-edit' && docStore) res.strategyDoc = await readDoc(c.clientId);
    return res;
  }

  async function strategyProfileSave(body, context) {
    const c = requireClient(body, context);
    if (c.error) return c.error;
    const h = normalizeHandleInput({ ownHandle: body?.ownHandle, benchmarkHandles: body?.benchmarkHandles }, { requireOwn: true });
    if (!h.ok) return fail(400, h.errors.join('; '), { errors: h.errors });
    if (!saveProfileKeepingTracks) return fail(501, 'Profile save is not available on this deployment.');
    const profile = await saveProfileKeepingTracks(c.clientId, { ownHandle: h.ownHandle, benchmarkHandles: h.benchmarkHandles });
    return { ok: true, profile: profile ?? { ownHandle: h.ownHandle, benchmarkHandles: h.benchmarkHandles } };
  }

  // ---- Strategy document ------------------------------------------------------------------------------

  const needDoc = () => (docStore ? null : fail(503, 'The strategy document is not configured on this deployment.'));
  const DOC_META = STRATEGY_DOC_SECTIONS.map((s) => ({ ...s }));

  /** Stored doc, or the seeded draft (version 0, never persisted by a read). */
  async function readDoc(clientId) {
    return (await docStore.get(clientId)) ?? draftDoc(SEED_STRATEGY_SECTIONS);
  }

  async function strategyDocGet(body, context) {
    const c = requireClient(body, context);
    if (c.error) return c.error;
    const off = needDoc(); if (off) return off;
    return { ok: true, doc: await readDoc(c.clientId), sections: DOC_META };
  }

  async function strategyDocSave(body, context, auth) {
    const c = requireClient(body, context);
    if (c.error) return c.error;
    const off = needDoc(); if (off) return off;
    const out = await docStore.apply(c.clientId, {
      sections: body?.sections, expectedVersion: body?.expectedVersion, by: by(auth), source: 'manual',
      reason: typeof body?.reason === 'string' ? body.reason : '', now: clock(), base: SEED_STRATEGY_SECTIONS,
    });
    return { ok: true, doc: out.doc, changed: out.changed, ...(out.changed ? { change: describeDocChange(out.doc.history.at(-1)) } : {}) };
  }

  async function strategyDocRevert(body, context, auth) {
    const c = requireClient(body, context);
    if (c.error) return c.error;
    const off = needDoc(); if (off) return off;
    const out = await docStore.revert(c.clientId, body?.version, { by: by(auth), now: clock() });
    return { ok: true, doc: out.doc, changed: out.changed, ...(out.changed ? { change: describeDocChange(out.doc.history.at(-1)) } : {}) };
  }

  // ---- Agent actions: undo, log, autonomy (owner-set permissions) ---------------------------------------------

  const needActions = () => (actionRuntime ? null : fail(503, 'Agent actions are not configured on this deployment.'));

  async function strategyActionUndo(body, context, auth) {
    const c = requireClient(body, context);
    if (c.error) return c.error;
    const off = needActions(); if (off) return off;
    const undoId = typeof body?.undoId === 'string' ? body.undoId.trim() : '';
    if (!undoId) return fail(400, 'undoId is required.');
    const out = await actionRuntime.undo(actionCtx(c.clientId, context, auth), undoId);
    return out.ok ? out : fail(409, out.error, { code: 'undo-refused' });
  }

  async function strategyActionLog(body, context, auth) {
    const c = requireClient(body, context);
    if (c.error) return c.error;
    const off = needActions(); if (off) return off;
    return { ok: true, log: await actionRuntime.log(actionCtx(c.clientId, context, auth)) };
  }

  async function strategyAutonomyGet(body, context) {
    const c = requireClient(body, context);
    if (c.error) return c.error;
    const off = needActions(); if (off) return off;
    return { ok: true, autonomy: await actionRuntime.getAutonomy(c.clientId), xFloor: 'typed' };
  }

  async function strategyAutonomySave(body, context) {
    const c = requireClient(body, context);
    if (c.error) return c.error;
    const off = needActions(); if (off) return off;
    const current = await actionRuntime.getAutonomy(c.clientId);
    const given = body?.autonomy && typeof body.autonomy === 'object' ? body.autonomy : body; // UI sends {autonomy:{tier1,tier2,tier3}}
    const next = {
      tier1: given?.tier1 === undefined ? current.tier1 : given.tier1,
      tier3: given?.tier3 === undefined ? current.tier3 : given.tier3,
    };
    if (!['auto', 'confirm'].includes(next.tier1)) return fail(400, "tier1 must be 'auto' or 'confirm'.");
    if (!['confirm', 'typed'].includes(next.tier3)) return fail(400, "tier3 must be 'confirm' or 'typed'. X publishing is always typed.");
    return { ok: true, autonomy: await actionRuntime.saveAutonomy(c.clientId, next), xFloor: 'typed' };
  }

  const table = {
    'strategy-action-undo': strategyActionUndo,
    'strategy-action-log': strategyActionLog,
    'strategy-autonomy-get': strategyAutonomyGet,
    'strategy-autonomy-save': strategyAutonomySave,
    'strategy-get': strategyGet,
    'strategy-refresh': strategyRefresh,
    'strategy-refresh-status': strategyRefreshStatus,
    'strategy-evaluate-handle': strategyEvaluateHandle,
    'strategy-plan-apply': strategyPlanApply,
    'strategy-plan-revert': strategyPlanRevert,
    'strategy-chat-send': strategyChatSend,
    'strategy-chat-history': strategyChatHistory,
    'strategy-proposal-decide': strategyProposalDecide,
    'strategy-profile-save': strategyProfileSave,
    'strategy-doc-get': strategyDocGet,
    'strategy-doc-save': strategyDocSave,
    'strategy-doc-revert': strategyDocRevert,
    'strategy-review': strategyReview,
    'strategy-calendar-batch-preview': strategyCalendarBatchPreview,
    'strategy-calendar-batch-create': strategyCalendarBatchCreate,
    'strategy-daily-fill-preview': strategyDailyFillPreview,
    'strategy-daily-fill-create': strategyDailyFillCreate,
    'strategy-freshness': strategyFreshness,
  };

  /** @returns {Promise<object>} result; failures carry {ok:false,status}. Auth is the caller's job. */
  async function handle(action, body, context, auth) {
    const fn = table[action];
    if (!fn) return fail(400, `Unknown strategy action: ${action}`);
    try {
      return await fn(body || {}, context, auth);
    } catch (err) {
      if (err instanceof StrategyPlanError) {
        return fail(err.status, err.message, {
          code: err.code,
          ...(err.currentVersion !== undefined ? { currentVersion: err.currentVersion } : {}),
          ...(err.errors ? { errors: err.errors } : {}),
        });
      }
      if (err instanceof StrategyDocError) {
        return fail(err.status, err.message, {
          code: err.code,
          ...(err.currentVersion !== undefined ? { currentVersion: err.currentVersion } : {}),
          ...(err.errors ? { errors: err.errors } : {}),
        });
      }
      if (err instanceof ChatStoreError) return fail(err.status, err.message, { code: err.code });
      if (err instanceof CorpusStoreError && err.code === 'invalid-handle') return fail(400, err.message);
      if (err?.status && err.status < 500) return fail(err.status, err.message, err.code ? { code: err.code } : {});
      throw err;
    }
  }

  /** Fresh tool deps for one client (see file header). */
  function toolDepsFor(clientId, context = {}) {
    const id = typeof clientId === 'string' ? clientId.trim() : '';
    if (!id) throw new Error('toolDepsFor: clientId is required');
    return buildToolDeps(id, { ...context, clientId: id }, {});
  }

  /** Persist externally created proposals as pending cards in a chat thread (see file header). */
  async function createProposalInThread({ clientId, threadId, proposals } = {}) {
    const off = needChat(); if (off) return off;
    const id = typeof clientId === 'string' ? clientId.trim() : '';
    if (!id) return fail(400, 'clientId is required.');
    const t = parseThreadId(threadId);
    if (t.error) return t.error;
    const now = clock();
    const tid = t.id || `t_mcp_${new Date(now).toISOString().slice(0, 10).replace(/-/g, '')}`;
    const planDoc = await planStore.get(id);
    const out = [];
    const dropped = [];
    for (const raw of (Array.isArray(proposals) ? proposals : []).slice(0, MAX_EXTERNAL_PROPOSALS)) {
      const v = validateProposal(raw, { currentPlan: planDoc?.plan });
      if (!v.ok) { dropped.push({ kind: raw?.kind ?? null, errors: v.errors }); continue; }
      const payload = { ...v.proposal.payload };
      if (v.proposal.kind === 'post-edit') {
        // Same checks the chat tool runs, and the card's "current text" snapshot, from this client's own post.
        const post = readPost ? await readPost(id, payload.postId) : null;
        const errs = [];
        if (!post) errs.push('post not found for this client');
        else {
          if (!['draft', 'approved', 'scheduled'].includes(post.status)) errs.push(`post is ${post.status}; only draft, approved or scheduled posts can be edited`);
          if ((post.updatedAt || '') !== payload.expectedUpdatedAt) errs.push('post changed since it was read; re-read it and retry');
          if (payload.scheduledAt !== undefined && post.status !== 'scheduled') errs.push('only a scheduled post can be moved to a new time');
          if (payload.scheduledAt !== undefined && Date.parse(payload.scheduledAt) <= now) errs.push('scheduledAt must be in the future');
        }
        if (errs.length) { dropped.push({ kind: 'post-edit', errors: errs }); continue; }
        payload.currentText = String(post.content ?? '').slice(0, 560);
        payload.currentStatus = post.status;
        if (post.scheduledAt) payload.currentScheduledAt = String(post.scheduledAt);
      }
      out.push(assignProposal({ ...raw, kind: v.proposal.kind, payload }, { threadId: tid, now }));
    }
    if (!out.length) return fail(400, 'No valid proposals.', { dropped });
    await chatStore.appendTurn({
      clientId: id, threadId: tid, userText: 'Proposals from an external assistant (MCP).',
      assistantText: `${out.length} proposal${out.length === 1 ? '' : 's'} created outside the chat. Review and confirm or reject each card.`,
      proposals: out, now,
    });
    return { ok: true, threadId: tid, proposals: out, ...(dropped.length ? { dropped } : {}) };
  }

  return { handle, actions: STRATEGY_ROUTE_ACTIONS, toolDepsFor, createProposalInThread, syncTracks, dailyFillDeps };
}

/**
 * Real xGrowth saver over client_configs/{clientId}.marketingBriefConfig.xGrowth. Mirrors the config route:
 * normalizeXGrowthProfile(incoming, prior) keeps every field the incoming block does not name (enabled, mode,
 * lanes, tierOverride, timezone), then a plain merge write touches only marketingBriefConfig.xGrowth.
 * NOT called by any code path in the T4b build; reachable only via strategy-profile-save / a confirmed benchmarks-change.
 * @param {object} db firebase-admin Firestore
 */
/** Per track: how many library items it holds, its most common tags and a few sample titles (no full rows). */
export function summarizeTrackLibrary(tracks, packages, { tags = 5, samples = 3 } = {}) {
  const by = new Map((tracks || []).map((t) => [t.id, { trackId: t.id, label: t.label, itemCount: 0, tagCounts: new Map(), sampleTitles: [] }]));
  for (const p of packages || []) {
    const row = by.get(trackForPackage(tracks, p)?.id);
    if (!row) continue;
    row.itemCount += 1;
    for (const tag of Array.isArray(p.tags) ? p.tags : []) {
      const k = String(tag ?? '').trim().toLowerCase();
      if (k) row.tagCounts.set(k, (row.tagCounts.get(k) || 0) + 1);
    }
    const title = String(p.title ?? '').trim();
    if (title && row.sampleTitles.length < samples) row.sampleTitles.push(title.slice(0, 80));
  }
  return [...by.values()].map(({ tagCounts, ...row }) => ({
    ...row,
    topTags: [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, tags).map(([tag, count]) => ({ tag, count })),
  }));
}

export function createXGrowthProfileSaver(db, { onSaved } = {}) {
  return async function saveXGrowthProfile(clientId, { ownHandle, benchmarkHandles }) {
    const ref = db.collection('client_configs').doc(clientId);
    const snap = await ref.get();
    const prior = snap.exists ? snap.data()?.marketingBriefConfig?.xGrowth ?? null : null;
    const incoming = { benchmarkHandles, ...(ownHandle !== undefined ? { ownHandle } : {}) };
    const next = normalizeXGrowthProfile(incoming, prior);
    await ref.set({ marketingBriefConfig: { xGrowth: next } }, { merge: true });
    // The Client Brain owns the own handle + benchmark accounts (brain-sync.cjs).
    if (onSaved) { try { await onSaved(clientId, prior, next); } catch { /* non-fatal */ } }
    return next;
  };
}

/**
 * Production wiring over firebase-admin Firestore. The refresh service gets the real bird detection and
 * enabled = env X_STRATEGY_LOCAL_INGEST==='1'.
 * @param {object} db  firebase-admin Firestore
 * @param {{readPackages?:Function, env?:object, loadCommitted?:(handle:string)=>object[]|null}} [extras]
 */
export function createStrategyHandlersFromDb(db, {
  readPackages, env = process.env, runDailyAction, runUpdateItemFacets, readTodayRun, readContentContext,
  readQueueSummary, readPost, readOpportunities, readResults, readMarketSignals, editPost, runPaidSync,
  onXGrowthSaved, onBrainOwnedSaved, readBrainTrackTargets, saveXGrowthProfile = createXGrowthProfileSaver(db, { onSaved: onXGrowthSaved }), chatStore = createFirestoreChatStore(db, { env }),
  agentLoopFactory, callModel, logUsage, loadCommitted, docStore = createFirestoreStrategyDocStore(db),
  actionRuntime = createActionRuntime(createFirestoreActionStores(db)),
  ...passThrough // any other createStrategyHandlers dep (linkItemMedia, mediaForItem from the quote-targets route; test overrides), forwarded as-is
} = {}) {
  // `loadCommitted` (handle -> rows|null) lets a serverless host supply the committed corpora from static imports.
  const corpusStore = createFirestoreCorpusStore(db, loadCommitted ? { loadCommitted } : {});
  const planStore = createFirestorePlanStore(db);
  const refreshService = createRefreshService({
    store: corpusStore,
    queueStore: createFirestoreRefreshQueue(db),
    enabled: () => env.X_STRATEGY_LOCAL_INGEST === '1',
  });
  // Same account resolver as the X Monitor card (home keeps its global-connection history); lazy so tests stay pure.
  const readAudience = async (clientId) => readClientAudience(db, clientId, {
    resolveAccountId: async (id) => (await import('../x-monitor/sync.js')).resolveAccountId(id),
  });
  // Content Center buckets drive the tracks (bucket-tracks.js). Lazy imports keep the bare handler pure for tests.
  const readBuckets = async (clientId) => (await import('../x-content-inventory/bucket-store.js')).listBuckets(clientId, { db });
  const readBucketEngine = async (clientId, bucketId) => {
    const snap = await db.collection('x_content_packages').where('clientId', '==', clientId).where('bucketId', '==', bucketId).limit(1).get();
    return snap.empty ? null : (await import('../x-content-inventory/engines.js')).resolveEngine(snap.docs[0].data());
  };
  // Calendar batch: items that already have an open post are skipped; drafts go through the create-once path.
  const readOpenPackageIds = async (clientId) => {
    const { OPEN_STATUSES } = await import('../social-posting/lifecycle.js');
    const snap = await db.collection('social_posts').where('clientId', '==', clientId).select('packageId', 'status', 'scheduledAt', 'reviewOn').get();
    const open = new Map();
    for (const d of snap.docs) {
      const r = d.data();
      if (r.packageId && OPEN_STATUSES.includes(r.status) && !open.has(r.packageId)) open.set(r.packageId, { postId: d.id, status: r.status, scheduledAt: r.scheduledAt || null, reviewOn: r.reviewOn || null });
    }
    return open;
  };
  // Place an existing draft (transaction): still this client's unscheduled draft => set reviewOn (+ bucket, + media only
  // when it has none), bump revision. Never touches status, text or schedule.
  const placeDraft = async (clientId, postId, { reviewOn, bucketId, media }) => db.runTransaction(async (tx) => {
    const ref = db.collection('social_posts').doc(postId);
    const snap = await tx.get(ref);
    const cur = snap.exists ? snap.data() : null;
    if (!cur || cur.clientId !== clientId || cur.status !== 'draft' || cur.scheduledAt) return false;
    tx.set(ref, {
      reviewOn, ...(bucketId ? { bucketId } : {}),
      ...(media && !cur.mediaUrl ? media : {}),
      revision: (Number(cur.revision) || 0) + 1, updatedAt: new Date().toISOString(),
    }, { merge: true });
    return true;
  });
  // Daily fill: earlier fill drafts (re-run accounting) and each item's last used day (the 30-day spread). Read-only.
  const readFillContext = async (clientId) => {
    const snap = await db.collection('social_posts').where('clientId', '==', clientId)
      .select('packageId', 'status', 'source', 'fillKind', 'bucketId', 'reviewOn', 'scheduledAt', 'postedAt', 'idempotencyKey').get();
    const fillPosts = [];
    const lastUsed = new Map();
    for (const d of snap.docs) {
      const r = d.data();
      if (r.source === 'daily-fill') fillPosts.push({ postId: d.id, status: r.status, source: r.source, reviewOn: r.reviewOn || null, fillKind: r.fillKind || null, bucketId: r.bucketId || null, idempotencyKey: r.idempotencyKey || null });
      const day = String(r.postedAt || r.scheduledAt || r.reviewOn || '').slice(0, 10);
      if (r.packageId && /^\d{4}-\d{2}-\d{2}$/.test(day) && r.status !== 'rejected' && (lastUsed.get(r.packageId) || '') < day) lastUsed.set(r.packageId, day);
    }
    return { fillPosts, lastUsed };
  };
  // Open (not dismissed) quote candidates straight from the stored scan; the route passes a richer reader (track-list merge).
  const readQuoteTargets = async (clientId) => {
    const snap = await db.collection('dashboard_state').doc(clientId).get();
    const qt = snap.exists ? snap.data()?.marketingBrief?.quoteTargets : null;
    const dismissed = new Set(Array.isArray(qt?.dismissed) ? qt.dismissed : []);
    const targets = (Array.isArray(qt?.candidates) ? qt.candidates : []).filter((c) => c && !dismissed.has(c.id))
      .map((c) => ({ id: c.id || c.url, url: c.url, text: c.text, handle: c.author?.username || (typeof c.author === 'string' ? c.author : null), createdAt: c.createdAt, trackId: c.trackId }));
    return { generatedAt: qt?.generatedAt || null, targets };
  };
  const ensureDraft = async (clientId, payload) => (await import('../social-posting/twitter-service.js')).ensureDraftPost(clientId, payload);
  const taskStore = createContentTaskStore(db);
  const listMediaTaskIds = (clientId) => taskStore.ids(clientId);
  const createMediaTasks = ({ clientId, rows, by, proposalId }) => taskStore.create(clientId, rows, { by, proposalId });
  return createStrategyHandlers({
    corpusStore, planStore, refreshService, readPackages, readAudience, readBuckets, readBucketEngine, readOpenPackageIds, readFillContext, readQuoteTargets, ensureDraft, placeDraft, listMediaTaskIds, createMediaTasks,
    readWorkerHealth: (clientId) => readWorkerHealthFromDb(db, { now: Date.now(), clientId }),
    docStore, onBrainOwnedSaved, readBrainTrackTargets, chatStore, agentLoopFactory, callModel, logUsage, runDailyAction, runUpdateItemFacets, readTodayRun, readContentContext, saveXGrowthProfile, env,
    readQueueSummary, readPost, readOpportunities, readResults, readMarketSignals, editPost, runPaidSync, actionRuntime,
    readBriefRaw: (clientId, local) => readBriefRawFromDb(clientId, { db, ...local }),
    readXGrowthConfig: async (clientId) => {
      const snap = await db.collection('client_configs').doc(clientId).get();
      return snap.exists ? snap.data()?.marketingBriefConfig?.xGrowth ?? null : null;
    },
    ...passThrough, // last: a caller's dep wins over the defaults above
  });
}

/**
 * Stored X Monitor data for ONE client (free Firestore reads; never syncs). The account is resolved by id:
 * social_accounts/{clientId}.platforms.x.userId -> x_monitor/{userId}; else the x_monitor root whose `clientIds`
 * contains this client. Neither => {account:null} ("not available"), never another client's account.
 */
export async function readClientAudience(db, clientId, { resolveAccountId } = {}) {
  if (!clientId || typeof clientId !== 'string') return { account: null };
  let doc = null;
  if (resolveAccountId) {
    // The X Monitor resolver (free reads): the account this client's card shows. A resolver failure falls through.
    const resolved = await resolveAccountId(clientId).catch(() => null);
    if (resolved?.accountId) {
      const snap = await db.collection('x_monitor').doc(String(resolved.accountId)).get();
      if (snap.exists) doc = snap;
    }
  }
  const social = doc ? null : await db.collection('social_accounts').doc(clientId).get();
  const userId = social?.exists ? social.data()?.platforms?.x?.userId : null;
  if (userId) {
    const snap = await db.collection('x_monitor').doc(String(userId)).get();
    if (snap.exists) doc = snap;
  }
  if (!doc) {
    const q = await db.collection('x_monitor').where('clientIds', 'array-contains', clientId).limit(1).get();
    doc = q.docs[0] ?? null;
  }
  if (!doc) return { account: null };
  const [snaps, events, posts] = await Promise.all([
    doc.ref.collection('snapshots').orderBy('date', 'desc').limit(120).get(),
    doc.ref.collection('audience_events').orderBy('detectedAt', 'desc').limit(300).get(),
    doc.ref.collection('posts').limit(300).get(),
  ]);
  return { account: doc.data(), snapshots: snaps.docs.map((d) => d.data()), events: events.docs.map((d) => d.data()), posts: posts.docs.map((d) => d.data()) };
}
