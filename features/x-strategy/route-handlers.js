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

import { DEFAULT_PLAN, EVALUATION_THRESHOLDS } from './contracts.js';
import { evaluate as defaultEvaluate } from './evaluate.js';
import { StrategyPlanError, createFirestorePlanStore } from './plan-store.js';
import { createFirestoreCorpusStore, normalizeHandle, CorpusStoreError } from './corpus-store.js';
import { createRefreshService, createFirestoreRefreshQueue, readWorkerHealth as readWorkerHealthFromDb } from './refresh.js';
import { resolveXGrowthProfile } from '../x-benchmark/profile.js';
import { buildDayPlan as buildContentDayPlan } from '../x-content-inventory/plan-day.js';
import { hasPlaceholderStory } from '../x-content-inventory/match.js';
import { projectDayPlan } from '../x-content-inventory/day-plan-projection.js';
import { resolvePlanInputs } from './plan-inputs.js';
import { tracksOf } from './content-tracks.js';
import { hasExplicitTracks, trackBenchmarkHandles, newTrackBenchmarkHandles, loadTrackProfiles, profileBenchmarksFromPlan } from './track-profile.js';
import { normalizeXGrowthProfile } from '../x-benchmark/profile.js';
import { createFirestoreChatStore, ChatCapError, ChatStoreError, THREAD_ID_RE } from './agent/chat-store.js';
import {
  validateProposal, assignProposal, decideProposal, buildExecutors, normalizeHandleInput,
} from './agent/proposals.js';
import { normalizeSelected, describeSelected } from './agent/prompt.js';
import { randomUUID } from 'node:crypto';

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
]);

export const CHAT_TEXT_MAX = 2000;
const MAX_PROPOSALS_PER_TURN = 2;
const HISTORY_MESSAGES_TO_MODEL = 60;

const DAY_MS = 86400000;
const DEFAULT_PROFILE = Object.freeze({ ownHandle: 'bai_ee', benchmarkHandles: Object.freeze(['seb__design']), timezone: 'America/Chicago' });
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Until a client saves an xGrowth profile, the tab runs on the engine's existing hard-wired pair
 * (@bai_ee vs @seb__design, Chicago) so it works without a client_configs write. `defaulted` names
 * the fields filled in, so the UI can say so instead of passing them off as saved settings.
 * Shared with content-plan.js so the Plan tab and the Strategy tab resolve the same handles.
 * @param {object} p  resolveXGrowthProfile() output
 */
export function withDefaultPair(p) {
  const defaulted = [];
  const fill = (field, value, fallback) => {
    if (value && (!Array.isArray(value) || value.length)) return value;
    defaulted.push(field);
    return fallback;
  };
  const ownHandle = fill('ownHandle', p.ownHandle, DEFAULT_PROFILE.ownHandle);
  const benchmarkHandles = fill('benchmarkHandles', p.benchmarkHandles, DEFAULT_PROFILE.benchmarkHandles);
  const timezone = fill('timezone', p.timezone, DEFAULT_PROFILE.timezone);
  return { ownHandle, benchmarkHandles, timezone, lanes: p.lanes || [], defaulted };
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
  chatStore = null, agentLoopFactory = null, callModel = null, logUsage = null,
  runDailyAction = null, runUpdateItemFacets = null, readTodayRun = null, readContentContext = null, saveXGrowthProfile = null,
  readQueueSummary = null, readPost = null, readOpportunities = null, readResults = null, // chat read tools: (clientId[, postId]) -> plain JSON | null
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
  const planStore = {
    ...basePlanStore,
    get: (...a) => basePlanStore.get(...a),
    apply: withMirror((...a) => basePlanStore.apply(...a)),
    revert: withMirror((...a) => basePlanStore.revert(...a)),
  };

  /** The admin-selected client only: body.clientId must be present and equal context.clientId. */
  function requireClient(body, context) {
    const id = typeof body?.clientId === 'string' ? body.clientId.trim() : '';
    if (!id || id.includes('/')) return { error: fail(400, 'clientId is required.') };
    if (!context?.clientId || id !== context.clientId) return { error: fail(403, 'clientId does not match the selected client.') };
    return { clientId: id };
  }

  // Default-pair fallback + `defaulted` live in withDefaultPair (shared with content-plan.js).
  async function loadProfile(clientId) {
    const config = await readXGrowthConfig(clientId);
    return withDefaultPair(resolveProfile({ config }));
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
      plan: planDoc?.plan ?? DEFAULT_PLAN, now,
    });

    const primary = planDoc?.plan?.benchmarkPrimary;
    const bench = benchmarks.find((b) => b.handle === primary) || benchmarks[0] || null;
    const packages = own.rows.length ? await readPackages() : [];
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
  function buildToolDeps(clientId, context, preloaded) {
    return {
      // Same computation as strategy-get (one source of numbers); the model never gets raw rows.
      getEvaluation: async () => {
        const r = await strategyGet({ clientId }, context);
        return r.ok ? { evaluation: r.evaluation ?? null, profile: r.profile, rowsMeta: r.rowsMeta, evaluationError: r.evaluationError ?? null } : { error: r.error };
      },
      getProfileHandles: async () => {
        const profile = preloaded.profile ?? (preloaded.profile = await loadProfile(clientId));
        return [profile.ownHandle, ...(profile.benchmarkHandles || [])].map((h) => safeHandle(h)).filter(Boolean);
      },
      getTracks: async () => {
        const planDoc = await planStore.get(clientId);
        const profile = preloaded.profile ?? (preloaded.profile = await loadProfile(clientId));
        return { tracks: tracksOf(planDoc), profiles: await safeTrackProfiles(planDoc, profile) };
      },
      getPlan: async () => ((await planStore.get(clientId)) ?? { version: 0, plan: DEFAULT_PLAN, history: [], isDefault: true }),
      getContext: async () => (readContentContext ? readContentContext(clientId) : { error: 'Content context is not available.' }),
      getTodayRun: async () => summarizeTodayRun(readTodayRun ? await readTodayRun(clientId) : null),
      // Closed over THIS request's clientId; the model never supplies one. Absent reader => key absent => tool says 'not available'.
      ...(readQueueSummary ? { readQueueSummary: () => readQueueSummary(clientId) } : {}),
      ...(readPost ? { readPost: (postId) => readPost(clientId, postId) } : {}),
      ...(readOpportunities ? { readOpportunities: () => readOpportunities(clientId) } : {}),
      ...(readResults ? { readResults: () => readResults(clientId) } : {}),
      searchInventory: async ({ query, limit } = {}) => {
        const max = Math.min(Math.max(1, Number(limit) || 10), 20);
        const tokens = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
        const pkgs = await readPackages();
        const scored = [];
        for (const p of pkgs || []) {
          const hay = `${p.id} ${p.title ?? ''} ${p.story ?? ''} ${(p.searchTokens || []).join(' ')} ${JSON.stringify(p.facets ?? {})} ${JSON.stringify(p.humanEdits ?? {})}`.toLowerCase();
          const score = tokens.length ? tokens.filter((t) => hay.includes(t)).length : 0;
          if (!tokens.length || score) scored.push({ score, p });
        }
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, max).map(({ p }) => ({
          id: p.id, title: p.title ?? null, story: String(p.story ?? '').slice(0, 160), bucketId: p.bucketId ?? null,
          hasStory: !!String(p.story ?? '').trim() && !hasPlaceholderStory(p), facets: p.humanEdits || p.facets || {},
        }));
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

  async function strategyChatSend(body, context) {
    const c = requireClient(body, context);
    if (c.error) return c.error;
    const off = needChat(); if (off) return off;
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) return fail(400, 'text is required.');
    if (text.length > CHAT_TEXT_MAX) return fail(400, `text must be at most ${CHAT_TEXT_MAX} characters.`);
    const t = parseThreadId(body?.threadId);
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
    const toolDeps = buildToolDeps(c.clientId, context, preloaded);
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
      ...(thread?.messages || []).slice(-HISTORY_MESSAGES_TO_MODEL).map((m) => ({ role: m.role, text: m.text })),
    ];
    let turn;
    try {
      const selectedContext = await resolveSelectedContext(c.clientId, body?.selected);
      turn = await loop.runTurn({ clientId: c.clientId, threadId, history, userText: text, now, ...(selectedContext ? { selectedContext } : {}) });
    } catch (err) {
      return fail(502, `The strategy agent failed: ${String(err?.message || err).slice(0, 200)}`, { turnsUsedToday: used, cap: chatStore.cap });
    }

    const planDoc = await planStore.get(c.clientId);
    const currentPlan = planDoc?.plan;
    const proposals = [];
    const dropped = [];
    for (const raw of (Array.isArray(turn?.proposals) ? turn.proposals : []).slice(0, MAX_PROPOSALS_PER_TURN)) {
      const v = validateProposal(raw, { currentPlan });
      if (!v.ok) { dropped.push({ kind: raw?.kind ?? null, errors: v.errors }); continue; }
      proposals.push(assignProposal({ ...raw, kind: v.proposal.kind, payload: v.proposal.payload }, { threadId, now }));
    }
    const assistantText = String(turn?.text ?? '');
    await chatStore.appendTurn({ clientId: c.clientId, threadId, userText: text, assistantText, proposals, usage: turn?.usage, now });
    return {
      ok: true, threadId, text: assistantText, proposals,
      ...(dropped.length ? { droppedProposals: dropped } : {}),
      usage: turn?.usage ?? null, rounds: turn?.rounds ?? null, stopped: turn?.stopped ?? null,
      turnsUsedToday: used, cap: chatStore.cap,
    };
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
    refreshHandles: async ({ clientId, handles, context, auth }) => strategyRefresh({ clientId, handles }, context, auth),
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
      return fail(out.status || 500, out.error, { proposal: out.proposal });
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

  const table = {
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
      if (err instanceof ChatStoreError) return fail(err.status, err.message, { code: err.code });
      if (err instanceof CorpusStoreError && err.code === 'invalid-handle') return fail(400, err.message);
      if (err?.status && err.status < 500) return fail(err.status, err.message, err.code ? { code: err.code } : {});
      throw err;
    }
  }

  return { handle, actions: STRATEGY_ROUTE_ACTIONS };
}

/**
 * Real xGrowth saver over client_configs/{clientId}.marketingBriefConfig.xGrowth. Mirrors the config route:
 * normalizeXGrowthProfile(incoming, prior) keeps every field the incoming block does not name (enabled, mode,
 * lanes, tierOverride, timezone), then a plain merge write touches only marketingBriefConfig.xGrowth.
 * NOT called by any code path in the T4b build; reachable only via strategy-profile-save / a confirmed benchmarks-change.
 * @param {object} db firebase-admin Firestore
 */
export function createXGrowthProfileSaver(db) {
  return async function saveXGrowthProfile(clientId, { ownHandle, benchmarkHandles }) {
    const ref = db.collection('client_configs').doc(clientId);
    const snap = await ref.get();
    const prior = snap.exists ? snap.data()?.marketingBriefConfig?.xGrowth ?? null : null;
    const incoming = { benchmarkHandles, ...(ownHandle !== undefined ? { ownHandle } : {}) };
    const next = normalizeXGrowthProfile(incoming, prior);
    await ref.set({ marketingBriefConfig: { xGrowth: next } }, { merge: true });
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
  readQueueSummary, readPost, readOpportunities, readResults,
  saveXGrowthProfile = createXGrowthProfileSaver(db), chatStore = createFirestoreChatStore(db, { env }),
  agentLoopFactory, callModel, logUsage, loadCommitted,
} = {}) {
  // `loadCommitted` (handle -> rows|null) lets a serverless host supply the committed corpora from static imports.
  const corpusStore = createFirestoreCorpusStore(db, loadCommitted ? { loadCommitted } : {});
  const planStore = createFirestorePlanStore(db);
  const refreshService = createRefreshService({
    store: corpusStore,
    queueStore: createFirestoreRefreshQueue(db),
    enabled: () => env.X_STRATEGY_LOCAL_INGEST === '1',
  });
  return createStrategyHandlers({
    corpusStore, planStore, refreshService, readPackages,
    readWorkerHealth: (clientId) => readWorkerHealthFromDb(db, { now: Date.now(), clientId }),
    chatStore, agentLoopFactory, callModel, logUsage, runDailyAction, runUpdateItemFacets, readTodayRun, readContentContext, saveXGrowthProfile, env,
    readQueueSummary, readPost, readOpportunities, readResults,
    readXGrowthConfig: async (clientId) => {
      const snap = await db.collection('client_configs').doc(clientId).get();
      return snap.exists ? snap.data()?.marketingBriefConfig?.xGrowth ?? null : null;
    },
  });
}
