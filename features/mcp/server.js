// server.js - production wiring for the MCP server: Firestore, strategy handlers, NAS, X Monitor, GitHub fetch.
// SERVER ONLY. Everything is lazy so importing this file never touches Firestore until a request arrives.
// The pure logic (oauth, jsonrpc, tools, limits) is unit-tested with fakes; this file only plugs in the real services.

import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createStrategyHandlersFromDb } from '../x-strategy/route-handlers.js';
import * as timelineStore from '../social-archive/timeline-store.js';
import { handleNasAction } from '../x-content-inventory/nas.js';
import { getPackage, upsertPackage } from '../x-content-inventory/store.js';
import { getXOAuthStatus } from '../social-posting/x-oauth.js';
import * as xSync from '../x-monitor/sync.js';
import * as xStore from '../x-monitor/store.js';
import { createReaders } from './readers.js';
import { createFirestoreOAuthStore } from './oauth.js';
import { createFirestoreCounters, createFirestoreAudit } from './limits.js';
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
      xMonitor: () => ({
        status: async () => { const s = await getXOAuthStatus(); return { accountId: s.userId ? String(s.userId) : null, username: s.username || null }; },
        readAccount: xStore.readAccount, listSnapshots: xStore.listSnapshots, listPosts: xStore.listPosts, listAudienceEvents: xStore.listAudienceEvents,
        estimateAudienceCalls: xSync.estimateAudienceCalls, // pricing only: the MCP server has NO sync functions; paid syncs run from a confirmed card
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
    },
    defaultClientId: DEFAULT_CLIENT_ID,
  };
  return singleton;
}
