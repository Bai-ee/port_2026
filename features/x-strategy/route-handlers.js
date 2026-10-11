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
import { createRefreshService, createFirestoreRefreshQueue } from './refresh.js';
import { resolveXGrowthProfile } from '../x-benchmark/profile.js';
import { buildDayPlan as buildContentDayPlan } from '../x-content-inventory/plan-day.js';
import { projectDayPlan } from '../x-content-inventory/day-plan-projection.js';
import { mergeEngineConfig } from '../x-content-inventory/engine-quota.js';

export const STRATEGY_ROUTE_ACTIONS = Object.freeze([
  'strategy-get',
  'strategy-refresh',
  'strategy-refresh-status',
  'strategy-evaluate-handle',
  'strategy-plan-apply',
  'strategy-plan-revert',
]);

const DAY_MS = 86400000;
const DEFAULT_PROFILE = Object.freeze({ ownHandle: 'bai_ee', benchmarkHandles: Object.freeze(['seb__design']), timezone: 'America/Chicago' });
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

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
 * @param {()=>number} [deps.clock]
 */
export function createStrategyHandlers({
  corpusStore, planStore, refreshService, readXGrowthConfig,
  readPackages = async () => [], evaluate = defaultEvaluate, clock = Date.now,
  resolveProfile = resolveXGrowthProfile, buildPreviewPlan = buildContentDayPlan,
} = {}) {
  if (!corpusStore || !planStore || !refreshService || typeof readXGrowthConfig !== 'function') {
    throw new Error('createStrategyHandlers: corpusStore, planStore, refreshService, readXGrowthConfig are required');
  }

  /** The admin-selected client only: body.clientId must be present and equal context.clientId. */
  function requireClient(body, context) {
    const id = typeof body?.clientId === 'string' ? body.clientId.trim() : '';
    if (!id || id.includes('/')) return { error: fail(400, 'clientId is required.') };
    if (!context?.clientId || id !== context.clientId) return { error: fail(403, 'clientId does not match the selected client.') };
    return { clientId: id };
  }

  // Until a client saves an xGrowth profile, the tab runs on the engine's existing hard-wired pair
  // (@bai_ee vs @seb__design, Chicago) so it works without a client_configs write. `defaulted` names
  // the fields filled in, so the UI can say so instead of passing them off as saved settings.
  async function loadProfile(clientId) {
    const config = await readXGrowthConfig(clientId);
    const p = resolveProfile({ config });
    const defaulted = [];
    const fill = (field, value, fallback) => {
      if (value && (!Array.isArray(value) || value.length)) return value;
      defaulted.push(field);
      return fallback;
    };
    const ownHandle = fill('ownHandle', p.ownHandle, DEFAULT_PROFILE.ownHandle);
    const benchmarkHandles = fill('benchmarkHandles', p.benchmarkHandles, DEFAULT_PROFILE.benchmarkHandles);
    const timezone = fill('timezone', p.timezone, DEFAULT_PROFILE.timezone);
    return {
      ownHandle,
      benchmarkHandles,
      timezone,
      lanes: p.lanes || [],
      defaulted,
    };
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
        input.posts = plan.authoredPerDay;
        if (plan.engineTargets && Object.keys(plan.engineTargets).length) input.engineConfig = mergeEngineConfig(plan.engineTargets);
      }
      const dayPlan = buildPreviewPlan(input);
      const posts = input.posts ?? dayPlan?.posts ?? undefined;
      return { available: true, date, posts: posts ?? null, usedPlan: !!plan, plan: dayPlan, summary: projectDayPlan(dayPlan, posts ? { posts } : undefined).summary };
    } catch (err) {
      return { available: false, reason: `preview-failed: ${String(err?.message || err).slice(0, 160)}` };
    }
  }

  async function strategyGet(body, context) {
    const c = requireClient(body, context);
    if (c.error) return c.error;
    const now = clock();
    const profile = await loadProfile(c.clientId);
    const planDoc = await planStore.get(c.clientId);
    const handles = [...new Set([profile.ownHandle, ...profile.benchmarkHandles].filter(Boolean).map((h) => safeHandle(h) || h))];
    const reads = {};
    for (const h of handles) reads[h] = await readHandle(h);
    const rowsMeta = handles.map((h) => describeRows(h, reads[h], now));

    const ownKey = safeHandle(profile.ownHandle);
    const own = (ownKey && reads[ownKey]) || { handle: ownKey || profile.ownHandle, rows: [], meta: null, source: 'none' };
    const benchmarks = profile.benchmarkHandles.map((h) => safeHandle(h)).filter(Boolean)
      .map((h) => ({ handle: h, rows: reads[h].rows, meta: reads[h].meta }));

    const { evaluation, evaluationError } = await runEvaluate({
      ownHandle: own.handle, ownRows: own.rows, ownMeta: own.meta, benchmarks,
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
      todayPlanPreview: todayPreview({ profile, planDoc, own, bench, packages, now }),
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
    const out = await refreshService.requestRefresh({ handles, requestedBy: auth?.decoded?.email || auth?.decoded?.uid || null });
    return { ok: true, requestId: out.requestId, status: out.status }; // drain (if any) is intentionally not awaited
  }

  async function strategyRefreshStatus(body) {
    const id = typeof body?.requestId === 'string' ? body.requestId.trim() : '';
    if (!REQUEST_ID_RE.test(id)) return fail(400, 'requestId is required.');
    const request = await refreshService.getRequestStatus(id);
    if (!request) return fail(404, 'Refresh request not found.');
    return { ok: true, request };
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
    const doc = await planStore.apply(c.clientId, {
      changes: body?.changes, expectedVersion: body?.expectedVersion, reason: typeof body?.reason === 'string' ? body.reason : '',
      by: by(auth), source: 'manual', now: clock(),
    });
    return { ok: true, plan: doc.doc, changed: doc.changed };
  }

  async function strategyPlanRevert(body, context, auth) {
    const c = requireClient(body, context);
    if (c.error) return c.error;
    const doc = await planStore.revert(c.clientId, body?.version, { by: by(auth), now: clock() });
    return { ok: true, plan: doc.doc, changed: doc.changed };
  }

  const table = {
    'strategy-get': strategyGet,
    'strategy-refresh': strategyRefresh,
    'strategy-refresh-status': strategyRefreshStatus,
    'strategy-evaluate-handle': strategyEvaluateHandle,
    'strategy-plan-apply': strategyPlanApply,
    'strategy-plan-revert': strategyPlanRevert,
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
      if (err instanceof CorpusStoreError && err.code === 'invalid-handle') return fail(400, err.message);
      if (err?.status && err.status < 500) return fail(err.status, err.message, err.code ? { code: err.code } : {});
      throw err;
    }
  }

  return { handle, actions: STRATEGY_ROUTE_ACTIONS };
}

/**
 * Production wiring over firebase-admin Firestore. The refresh service gets the real bird detection and
 * enabled = env X_STRATEGY_LOCAL_INGEST==='1'.
 * @param {object} db  firebase-admin Firestore
 * @param {{readPackages?:Function, env?:object}} [extras]
 */
export function createStrategyHandlersFromDb(db, { readPackages, env = process.env } = {}) {
  const corpusStore = createFirestoreCorpusStore(db);
  const planStore = createFirestorePlanStore(db);
  const refreshService = createRefreshService({
    store: corpusStore,
    queueStore: createFirestoreRefreshQueue(db),
    enabled: () => env.X_STRATEGY_LOCAL_INGEST === '1',
  });
  return createStrategyHandlers({
    corpusStore, planStore, refreshService, readPackages,
    readXGrowthConfig: async (clientId) => {
      const snap = await db.collection('client_configs').doc(clientId).get();
      return snap.exists ? snap.data()?.marketingBriefConfig?.xGrowth ?? null : null;
    },
  });
}
