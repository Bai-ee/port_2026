// ops-world.js - shared fakes for the ops-*.test.js files (not a test file). No Firebase, no network.
// The settings writers below mirror the REAL semantics verified in code:
//   saveDigestConfig: include rebuilt from defaults (todayPlan dropped unless in the patch), schedule rebuilt whole.
//   saveRefreshDaily: replaces the whole object; omitted enabled -> true. readRefreshDaily: unsaved -> derived default.
//   data sources: the real applyDataSourcesPatch (deep merge).
import { registry } from '../registry.js';
import { handleRpc } from '../jsonrpc.js';
import { createMemoryCounters } from '../limits.js';
import { createMemoryOpsStores } from '../ops/stores.js';
import { applyDataSourcesPatch, normalizeDataSources } from '../../x-strategy/data-sources.js';
import { createFakeDb } from './fake-db.js';
import { readModuleEnabledMap } from '../../scout-intake/module-toggle.mjs';
import { MODULE_IDS } from '../ops/settings.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SECTIONS } = require('../../email-digest/sections.registry.cjs'); // the REAL section registry (pure CJS)
const { normalizeRefreshDaily, resolveRefreshDaily } = require('../../intelligence/_refresh-daily.js'); // the REAL normalizer/resolver (db is lazy)

export const NOW = Date.parse('2026-10-12T12:00:00Z');
export const OWNER = 'bryan-balli-WUoltG84';
export const OTHER = 'other-client-1';
export const OWNER_EMAIL = 'bryanballi@gmail.com';

const INCLUDE_KEYS = SECTIONS.map((x) => x.key);
const DEFAULT_INCLUDE = Object.fromEntries(SECTIONS.map((x) => [x.key, x.defaultOn])); // same derivation as _digest-config.js
const DEFAULT_SCHEDULE = { enabled: false, frequency: 'off', sendHour: 7, weekday: 1, timezone: 'America/Chicago' };

export function makeSettingsFakes({ homeClientId = OWNER } = {}) {
  const digestDocs = new Map(); // clientId -> raw stored doc
  const dailyDocs = new Map();
  const moduleDocs = new Map(); // clientId -> client_configs doc ({ moduleConfig: {...} }), NESTED as the real writer produces
  const sourceDocs = new Map();
  const writes = { digest: [], daily: [], sources: [], modules: [] };
  const tick = () => new Promise((r) => setImmediate(r));
  return {
    digestDocs, dailyDocs, sourceDocs, moduleDocs, writes,
    modules: {
      read: async (clientId) => readModuleEnabledMap(moduleDocs.get(clientId) || null, MODULE_IDS),
      write: async (clientId, cardId, enabled) => {
        writes.modules.push({ clientId, cardId, enabled });
        const cur = moduleDocs.get(clientId) || {};
        moduleDocs.set(clientId, { ...cur, moduleConfig: { ...(cur.moduleConfig || {}), [cardId]: { enabled } } });
      },
    },
    digest: {
      get: async (clientId) => {
        await tick();
        const raw = digestDocs.get(clientId) || {};
        const include = { ...DEFAULT_INCLUDE, ...(clientId === homeClientId && typeof raw.include?.todayPlan !== 'boolean' ? { todayPlan: true } : {}), ...(raw.include || {}) };
        return {
          summaryEnabled: raw.summaryEnabled !== false, include, includeClientIds: raw.includeClientIds || [], schedule: { ...DEFAULT_SCHEDULE, ...(raw.schedule || {}) }, dailyXSearch: raw.dailyXSearch === true,
          briefLinkMode: raw.briefLinkMode || 'fresh', autoPostX: raw.autoPostX !== false, autoPublish: { platforms: { x: { mode: 'off' }, instagram: { mode: 'approval' } } }, recipientEmail: 'secret@example.com',
        };
      },
      save: async (clientId, patch) => {
        writes.digest.push({ clientId, patch: structuredClone(patch) });
        await tick();
        const prior = digestDocs.get(clientId) || {};
        const next = { ...prior };
        if (typeof patch.summaryEnabled === 'boolean') next.summaryEnabled = patch.summaryEnabled;
        if (typeof patch.dailyXSearch === 'boolean') next.dailyXSearch = patch.dailyXSearch;
        if (patch.briefLinkMode) next.briefLinkMode = patch.briefLinkMode;
        if ('include' in patch) {
          const inc = { ...DEFAULT_INCLUDE };
          for (const k of INCLUDE_KEYS) if (typeof patch.include[k] === 'boolean') inc[k] = patch.include[k];
          if (typeof patch.include.todayPlan !== 'boolean') delete inc.todayPlan;
          next.include = inc; // whole map replaced: a key left out of the patch reverts to its default
        }
        if ('schedule' in patch) next.schedule = { ...DEFAULT_SCHEDULE, ...Object.fromEntries(Object.entries(patch.schedule).filter(([k]) => k in DEFAULT_SCHEDULE)) }; // whole schedule replaced
        digestDocs.set(clientId, next);
        return null;
      },
    },
    refreshDaily: {
      // Real semantics: resolveRefreshDaily over the stored doc (unsaved -> derived default); save = normalizeRefreshDaily (omitted enabled -> true).
      read: async (clientId) => resolveRefreshDaily(dailyDocs.has(clientId) ? { refreshDaily: dailyDocs.get(clientId) } : {}),
      save: async (clientId, input, { by } = {}) => {
        writes.daily.push({ clientId, input: structuredClone(input), by });
        await tick();
        dailyDocs.set(clientId, { ...normalizeRefreshDaily(input), updatedAt: 'now', updatedBy: by });
        return { ...dailyDocs.get(clientId), saved: true };
      },
    },
    dataSources: {
      read: async (clientId) => normalizeDataSources(sourceDocs.get(clientId) || null),
      save: async (clientId, patch) => {
        writes.sources.push({ clientId, patch: structuredClone(patch) });
        await tick();
        const next = applyDataSourcesPatch(sourceDocs.get(clientId) || null, patch);
        sourceDocs.set(clientId, next);
        return next;
      },
    },
    trustedRefresh: async () => ({ enabled: true, dailyCapUsd: 5 }),
  };
}

export function makeWorld({ email = OWNER_EMAIL, now = NOW, agentResults = {}, statusResults = {}, defer = 'queue' } = {}) {
  const clock = { now };
  const db = createFakeDb({ [`clients/${OWNER}`]: { name: 'Bryan' }, [`clients/${OTHER}`]: { name: 'Other' } });
  const counters = createMemoryCounters();
  const stores = createMemoryOpsStores();
  const settings = makeSettingsFakes();
  const spies = { agent: [], regenerate: [], shared: [], sources: [], digest: [], xmonitor: [], showcase: [], showcaseStatus: [], sync: [] };
  const routeMode = { statusFails: false };
  const pending = []; // deferred paid work, run by the test with runDeferred()
  const showcaseJobs = new Map();
  const xsearch = { marketingBriefConfig: { sourcePlatforms: ['x', 'reddit'], brandXHandle: 'acme', brandKeywords: ['acme tools', 'acme app'], opportunitySignals: { enabled: true, platforms: ['x', 'reddit'], maxQueriesPerRun: 4, maxItemsPerPlatform: 10, queries: [{ query: 'q1' }, { query: 'q2' }] } }, include: { xMarketTalk: true }, hasScrapeKey: true, pricing: { perPostReadUsd: 0.005 } }; // x-search plan inputs (tests mutate)
  const holds = { digest: null }; // set a promise to keep a paid digest run "in progress"
  let idn = 0;
  const sources = { strategyAccounts: 'mac', quoteTargets: 'mac' };
  const ops = {
    stores,
    sleep: () => new Promise((r) => setTimeout(r, 1)),
    newId: (p) => `${p}_t${++idn}`,
    readSources: async () => { spies.sources.push(1); return { ...sources }; },
    agent: {
      handle: async (action, body, context, auth) => {
        spies.agent.push({ action, body, context, auth });
        if (action === 'agent-refresh') {
          const g = body.groups[0];
          return agentResults[g] || { ok: true, results: [{ group: g, mode: 'mac', status: 'queued', requestId: `req_${g}`, etaSeconds: 120, detail: 'queued' }] };
        }
        if (action === 'agent-refresh-status') return statusResults[body.requestIds[0]] || { ok: true, requests: [{ requestId: body.requestIds[0], status: 'queued' }] };
        throw new Error(`unexpected ${action}`);
      },
    },
    settings,
    secret: 'test-secret-0123456789',
    paid: {
      digestRefresh: async (clientId, args) => { spies.digest.push({ clientId, args }); if (holds.digest) await holds.digest; return { ok: true }; },
      loadDigestCfg: async () => ({ include: { signals: true }, briefLinkMode: 'latest' }),
      loadXSearchInputs: async (clientId) => { spies.xsearchInputs = (spies.xsearchInputs || []).concat(clientId); return structuredClone(xsearch); },
      xMonitor: async () => ({
        status: async () => ({ accountId: '1' }), estimateAudienceCalls: async () => ({ pages: 2 }),
        syncProfile: async () => { spies.xmonitor.push('profile'); return { callsMade: 1 }; }, syncPosts: async () => { spies.xmonitor.push('posts'); return { callsMade: 2 }; }, syncAudience: async () => { spies.xmonitor.push('audience'); return { callsMade: 2 }; },
      }),
      loadShowcaseRoute: async () => { throw new Error('use ctx.services.showcaseRoute in tests'); },
      readShowcaseJob: async (jobId) => showcaseJobs.get(jobId) || null,
    },
  };
  const services = {
    ops: () => ops,
    counters: () => counters,
    regenerateToday: async (clientId, o) => { spies.regenerate.push([clientId, o]); return { skipped: false, suggestionCount: 3 }; },
    strategyHandlers: () => { spies.shared.push(1); throw new Error('the shared strategy handlers must not be used by MCP-OPS'); },
    ownerAuthorization: async () => 'Bearer test-owner',
    showcaseRoute: async () => ({
      GET: async (request) => {
        const url = new URL(request.url);
        spies.showcaseStatus.push({ as: url.searchParams.get('as'), action: url.searchParams.get('action'), jobId: url.searchParams.get('jobId'), method: request.method });
        if (routeMode.statusFails) throw new Error('route down');
        const job = showcaseJobs.get(url.searchParams.get('jobId'));
        return new Response(JSON.stringify(job ? { job } : { error: 'Job not found.' }), { status: job ? 200 : 404 });
      },
      POST: async (request) => {
        const url = new URL(request.url);
        const body = await request.json();
        spies.showcase.push({ as: url.searchParams.get('as'), action: url.searchParams.get('action'), authorization: request.headers.get('authorization'), body });
        const jobId = 'sc_test_job1';
        showcaseJobs.set(jobId, { jobId, clientId: world.showcaseJobClient || url.searchParams.get('as'), status: 'queued' });
        return new Response(JSON.stringify({ jobId, status: 'queued' }), { status: 202 });
      },
    }),
    ...(defer === 'queue' ? { defer: (fn) => { pending.push(fn); } } : defer === 'inline' ? { defer: (fn) => { pending.push(fn()); } } : {}),
  };
  const ctx = { db, email, clientId: OWNER, origin: 'https://hitloop.test', now: () => clock.now, services };
  const call = async (name, args = {}, c = ctx) => {
    const { body } = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { registry, ctx: c, instructions: '' });
    return body.result;
  };
  const json = (r) => JSON.parse(r.content[0].text);
  const runDeferred = async () => { while (pending.length) { const f = pending.shift(); await (typeof f === 'function' ? f() : f); } };
  const world = { showcaseJobClient: null };
  return { xsearch, routeMode, world, showcaseJobs, holds, runDeferred, pending, ctx, call, json, ops, services, counters, stores, settings, spies, sources, clock, db };
}
