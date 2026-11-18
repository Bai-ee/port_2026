// server.js - production wiring for the MCP server: Firestore, strategy handlers, NAS, X Monitor, GitHub fetch.
// SERVER ONLY. Everything is lazy so importing this file never touches Firestore until a request arrives.
// The pure logic (oauth, jsonrpc, tools, limits) is unit-tested with fakes; this file only plugs in the real services.

import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createStrategyHandlersFromDb } from '../x-strategy/route-handlers.js';
import * as timelineStore from '../social-archive/timeline-store.js';
import { handleNasAction } from '../x-content-inventory/nas.js';
import { getPackage, upsertPackage } from '../x-content-inventory/store.js';
import * as xSync from '../x-monitor/sync.js';
import * as xStore from '../x-monitor/store.js';
import { createReaders } from './readers.js';
import { createFirestoreOAuthStore } from './oauth.js';
import { createFirestoreCounters, createFirestoreAudit } from './limits.js';
import { createFirestoreOpsStores } from './ops/stores.js';
import { restrictAgentHandlers } from './ops/catalog.js';
import { readDataSources, saveDataSources } from '../x-strategy/data-sources.js';
import { applyModuleToggle, readModuleEnabledMap } from '../scout-intake/module-toggle.mjs';
import { loadXMonitorService } from './paid-syncs.js';
import { MODULE_IDS } from './ops/settings.js';
import { buildInstructions } from './instructions.js';
import { DEFAULT_CLIENT_ID } from './tools/common.js';

const require = createRequire(import.meta.url);
const fb = require('../../api/_lib/firebase-admin.cjs');
const { isAdminEmail } = require('../../api/_lib/auth.cjs');

let singleton = null;

export function getServices() {
  if (singleton) return singleton;
  const db = fb.adminDb;
  const readers = createReaders(db);
  let handlers = null;
  let opsBundle = null;
  let instructions = null;

  // The NAS belongs to one client (NAS_INVENTORY_CLIENT_ID, same as the worker results route). Unset => NAS rows are
  // invisible here and new ones are refused (package-client-required).
  const nasClientId = () => process.env.NAS_INVENTORY_CLIENT_ID || null;
  const nasDeps = () => ({
    db, fieldValue: fb.FieldValue,
    getPackage: async (id) => { const p = await getPackage(id); return p && p.clientId === nasClientId() ? p : null; },
    upsertPackage: (pkg) => upsertPackage(pkg, { returnPackages: false, clientId: nasClientId() }),
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    randomId: () => randomUUID(),
  });

  singleton = {
    db,
    oauthStore: createFirestoreOAuthStore(db),
    isAdmin: isAdminEmail,
    audit: createFirestoreAudit(db),
    getInstructions: () => (instructions ||= buildInstructions()),
    services: {
      fetch: (...a) => fetch(...a),
      githubToken: (process.env.GITHUB_TOKEN || '').trim() || null,
      treeCache: { tree: null, at: 0 },
      strategyHandlers: () => (handlers ||= createStrategyHandlersFromDb(db, readers.strategyExtras)),
      timeline: () => timelineStore,
      // Per client: status() resolves THAT client's X account id from stored data (free); never the global token for a
      // non-home client (features/x-monitor/sync.js resolveAccountId).
      xMonitor: (clientId) => ({
        status: async () => {
          if (!clientId) return { accountId: null, username: null };
          const s = await xSync.resolveAccountId(clientId);
          return { accountId: s.accountId, username: s.username || null };
        },
        readAccount: xStore.readAccount, listSnapshots: xStore.listSnapshots, listPosts: xStore.listPosts, listAudienceEvents: xStore.listAudienceEvents,
        estimateAudienceCalls: xSync.estimateAudienceCalls, // pricing only: these read-side services have no sync functions; paid syncs run from a confirmed card or MCP-OPS run_refresh (ops.paid.xMonitor)
      }),
      regenerateToday: readers.regenerateToday,
      todayPlan: readers.readTodayPlan,
      nas: async (action, body, email) => {
        try {
          return await handleNasAction(nasDeps(), action, body, { email });
        } catch (err) {
          if (err?.status && err.status < 500) return { ok: false, error: err.message, status: err.status };
          throw err;
        }
      },
      counters: () => createFirestoreCounters(db),
      // MCP-OPS (ops-only deps). The agent handlers here are a SEPARATE instance with the refresh spend store turned off
      // (free Mac groups only; trustedRefresh can never spend through them), and the shared strategyHandlers above
      // (strategy_refresh_data) gets no new deps. PAID refreshes run only via run_refresh preview -> confirm:true using
      // ops.paid below. Settings writers are the same functions the dashboard routes call.
      ops: () => (opsBundle ||= (() => {
        const digest = require('../intelligence/_digest-config.js');
        const daily = require('../intelligence/_refresh-daily.js');
        const agent = restrictAgentHandlers(createStrategyHandlersFromDb(db, { ...readers.strategyExtras, refreshSpendStore: null }));
        return {
          stores: createFirestoreOpsStores(db),
          agent,
          readSources: (clientId) => readDataSources(db, clientId),
          secret: process.env.MCP_OAUTH_SECRET || null,
          paid: {
            // The pre-digest-refresh phase for ONE group, in-process (lazy: the route pulls in the whole digest pipeline).
            digestRefresh: async (clientId, args) => (await import('../../app/api/worker/pre-digest-refresh/route.js')).refreshDigestClient(clientId, args),
            loadDigestCfg: (clientId) => digest.getDigestConfig(clientId),
            // x-search plan inputs: free reads only (client config, key presence, ledger pricing, digest include).
            loadXSearchInputs: async (clientId) => {
              const [cfgSnap, dcfg, { getXPricing }] = await Promise.all([db.collection('client_configs').doc(clientId).get(), digest.getDigestConfig(clientId).catch(() => null), import('../x-api-usage/index.js')]);
              const { hasApiKey } = require('../scout-intake/external-scouts/scrapecreators-client.js');
              return { marketingBriefConfig: (cfgSnap.exists ? cfgSnap.data() : {})?.marketingBriefConfig || {}, include: dcfg?.include || {}, hasScrapeKey: hasApiKey(), pricing: await getXPricing().catch(() => ({ perPostReadUsd: null })) };
            },
            xMonitor: loadXMonitorService, // sync-capable X Monitor service; only reachable after a confirmed paid preview
            loadShowcaseRoute: () => import('../../app/api/dashboard/showcase/route.js'),
            readShowcaseJob: async (jobId) => { const s = await db.collection('showcase_jobs').doc(String(jobId)).get(); return s.exists ? s.data() : null; },
          },
          settings: {
            modules: {
              read: async (clientId) => { const [c, d] = await Promise.all([db.collection('client_configs').doc(clientId).get(), db.collection('dashboard_state').doc(clientId).get()]); return readModuleEnabledMap(c.exists ? c.data() : null, MODULE_IDS, d.exists ? d.data() : null); },
              write: (clientId, cardId, enabled) => applyModuleToggle(db, clientId, cardId, enabled, { now: fb.FieldValue.serverTimestamp() }),
            },
            digest: { get: digest.getDigestConfig, save: digest.saveDigestConfig },
            refreshDaily: { read: daily.readRefreshDaily, save: daily.saveRefreshDaily },
            dataSources: { read: (clientId) => readDataSources(db, clientId), save: (clientId, patch) => saveDataSources(db, clientId, patch) },
            trustedRefresh: async (clientId) => (await agent.handle('strategy-autonomy-get', { clientId }, { clientId }, { decoded: {} }))?.autonomy?.trustedRefresh ?? null,
          },
        };
      })()),
    },
    defaultClientId: DEFAULT_CLIENT_ID,
  };
  return singleton;
}
