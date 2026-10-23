// server.js - production wiring for the client-scoped MCP server. SERVER ONLY, lazy: no Firestore until a request.
// Reuses the owner MCP's readers' underlying modules (same queries); every reader takes the token's clientId.

import { createRequire } from 'node:module';
import { readSocialQueue } from '../social-posting/twitter-service.js';
import { createFirestoreStrategyDocStore } from '../x-strategy/strategy-doc-store.js';
import { readTodayPlan } from '../email-digest/today-plan.js';
import { createFirestoreCounters, createFirestoreAudit } from '../mcp/limits.js';
import { createFirestoreGrantStore } from './grants.js';
import { DATA_SOURCES } from './sources.js';
import { getSiteReport, getSessionPaths } from '../site-analytics/report.js';

const require = createRequire(import.meta.url);
const fb = require('../../api/_lib/firebase-admin.cjs');

let singleton = null;

export function getClientServices() {
  if (singleton) return singleton;
  const db = fb.adminDb;
  singleton = {
    grants: createFirestoreGrantStore(db),
    counters: createFirestoreCounters(db),
    audit: createFirestoreAudit(db),
    services: {
      env: process.env,
      fetch: (...a) => fetch(...a),
      sources: DATA_SOURCES,
      readSiteReport: (args) => getSiteReport({ db, ...args }),
      readSiteSessions: (args) => getSessionPaths({ db, ...args }),
      readBrainDoc: (clientId) => require('../client-brain/store.cjs').readClientBrainDoc(clientId),
      readStrategyDoc: (clientId) => createFirestoreStrategyDocStore(db).get(clientId),
      readPosts: (clientId) => readSocialQueue(clientId, { limit: 1500 }),
      readTodayPlan: (clientId) => readTodayPlan({ db, clientId }),
      readDashboardState: async (clientId) => { const s = await db.collection('dashboard_state').doc(clientId).get(); return s.exists ? s.data() : null; },
      projectBrief: (brief, state) => require('../intelligence/_brief-intel.js').projectBrief(brief, state),
    },
  };
  return singleton;
}
