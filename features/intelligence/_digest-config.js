'use strict';

// _digest-config.js — persistence + helpers for the daily-digest summary feature.
// Stores per-client config in Firestore `digest_config/{clientId}` and reads
// recent knowledge-base document text to feed the LLM summary. CJS so it can be
// required from both the ESM route and the admin API route via createRequire.

const fb = require('../../api/_lib/firebase-admin.cjs');

// Aggregation toggles — EVERY rendered section of the email is individually
// on/off here. Each key maps to exactly one section in the digest route's
// buildEmailHtml, so the EMAIL PREVIEW and the actual sent email hide/show
// identically (no data-presence gating). Default ON (except creativeBrief).
const INCLUDE_KEYS = [
  'execBriefLink',    // "Open Executive Brief" CTA button (top + footer)
  'execSummary',      // LLM executive-summary paragraph
  'agenda',           // Today's Agenda (calendar)
  'marketingBrief',   // Strategic Brief (opportunities / KOLs / competitors / narratives)
  'watchlist',        // "Happening on X" watchlist analysis
  'creativeBrief',    // Attached Creative Brief deliverable
  'platformOverview', // Platform Overview stat cells
  'ga4Traffic',       // GA4 Traffic overview
  'topPages',         // GA4 Top Pages
  'trafficSources',   // GA4 Traffic Sources
  'keyEvents',        // GA4 Key Events
  'homepage',         // Homepage interaction analytics
  'signups',          // Firebase New Sign-ups table
  'dashboards',       // Firebase Dashboards table
  'pipeline',         // Firebase Pipeline Status
  'deployments',      // Vercel Deployments
  'runtimeErrors',    // Vercel Runtime Errors
];
const DEFAULT_INCLUDE = {
  execBriefLink: true,
  execSummary: true,
  agenda: true,
  marketingBrief: true,
  watchlist: true,
  creativeBrief: false,
  platformOverview: true,
  ga4Traffic: true,
  topPages: true,
  trafficSources: true,
  keyEvents: true,
  homepage: true,
  signups: true,
  dashboards: true,
  pipeline: true,
  deployments: true,
  runtimeErrors: true,
};

// Legacy coarse keys (the pre-granular schema). A saved doc using these expands
// to the matching granular set so existing configs keep working unchanged.
// Applied BEFORE granular keys so any granular key present wins.
const LEGACY_INCLUDE_EXPANSION = {
  calendar: ['agenda'],
  webStats: ['ga4Traffic', 'topPages', 'trafficSources', 'keyEvents', 'homepage'],
  platformStats: ['platformOverview', 'signups', 'dashboards', 'pipeline'],
  deployments: ['deployments', 'runtimeErrors'],
  marketingBrief: ['marketingBrief', 'watchlist'],
  creativeBrief: ['creativeBrief'],
};

// How the "Open Executive Brief" link resolves its target:
//   'fresh'  — run a brand-new brief on send and link to it (LLM cost per send)
//   'latest' — link to the newest already-published hosted brief (free)
//   'off'    — no hosted link (button hidden)
const BRIEF_LINK_MODES = ['fresh', 'latest', 'off'];
const DEFAULT_BRIEF_LINK_MODE = 'fresh';

// Send schedule. Enforcement (turning this into per-recipient cron dispatch) is
// a later phase; for now these values are stored and surfaced, the existing
// Vercel cron still fires the run.
const SCHEDULE_FREQUENCIES = ['daily', 'weekly', 'off'];
const DEFAULT_SCHEDULE = {
  enabled: true,
  frequency: 'daily',          // 'daily' | 'weekly' | 'off'
  sendHour: 7,                 // 0–23, in `timezone`
  weekday: 1,                  // 0–6 (Sun–Sat), used when frequency === 'weekly'
  timezone: 'America/Chicago',
};

const DEFAULTS = {
  summaryEnabled: true,
  tone: 'concise, professional, direct',
  recentDocsCount: 5,
  maxDocChars: 8000,
  extraInstructions: '',
  homeClientId: null,      // brain + primary brief source (defaults to email-resolved client)
  includeClientIds: [],    // additional clients whose latest brief to fold in
  include: { ...DEFAULT_INCLUDE },
  schedule: { ...DEFAULT_SCHEDULE },
  briefLinkMode: DEFAULT_BRIEF_LINK_MODE, // how the Executive Brief link resolves
};

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function cleanIdList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((v) => String(v || '').trim()).filter(Boolean))].slice(0, 25);
}

function normalizeInclude(value) {
  const out = { ...DEFAULT_INCLUDE };
  if (value && typeof value === 'object') {
    // 1) Expand any legacy coarse keys first (a granular key below overrides).
    for (const [legacy, targets] of Object.entries(LEGACY_INCLUDE_EXPANSION)) {
      if (typeof value[legacy] === 'boolean') {
        for (const t of targets) out[t] = value[legacy];
      }
    }
    // 2) Apply granular keys — these win over the legacy expansion.
    for (const k of INCLUDE_KEYS) {
      if (typeof value[k] === 'boolean') out[k] = value[k];
    }
  }
  return out;
}

function normalizeBriefLinkMode(value) {
  return BRIEF_LINK_MODES.includes(value) ? value : DEFAULT_BRIEF_LINK_MODE;
}

function normalizeSchedule(value) {
  const v = value && typeof value === 'object' ? value : {};
  return {
    enabled: v.enabled !== false,
    frequency: SCHEDULE_FREQUENCIES.includes(v.frequency) ? v.frequency : DEFAULT_SCHEDULE.frequency,
    sendHour: clampInt(v.sendHour, 0, 23, DEFAULT_SCHEDULE.sendHour),
    weekday: clampInt(v.weekday, 0, 6, DEFAULT_SCHEDULE.weekday),
    timezone: typeof v.timezone === 'string' && v.timezone.trim()
      ? v.timezone.trim().slice(0, 64)
      : DEFAULT_SCHEDULE.timezone,
  };
}

function configDocRef(clientId) {
  return fb.adminDb.collection('digest_config').doc(clientId);
}

async function getDigestConfig(clientId) {
  if (!clientId) return { ...DEFAULTS };
  const snap = await configDocRef(clientId).get();
  if (!snap.exists) return { ...DEFAULTS };
  const data = snap.data() || {};
  return {
    summaryEnabled: data.summaryEnabled !== false,
    tone: data.tone || DEFAULTS.tone,
    recentDocsCount: clampInt(data.recentDocsCount, 1, 20, DEFAULTS.recentDocsCount),
    maxDocChars: clampInt(data.maxDocChars, 500, 40000, DEFAULTS.maxDocChars),
    extraInstructions: typeof data.extraInstructions === 'string' ? data.extraInstructions : '',
    homeClientId: data.homeClientId || null,
    includeClientIds: cleanIdList(data.includeClientIds),
    include: normalizeInclude(data.include),
    schedule: normalizeSchedule(data.schedule),
    briefLinkMode: normalizeBriefLinkMode(data.briefLinkMode),
    updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() || null,
  };
}

async function saveDigestConfig(clientId, patch = {}) {
  if (!clientId) throw new Error('saveDigestConfig: clientId is required');
  const next = {};
  if (typeof patch.summaryEnabled === 'boolean') next.summaryEnabled = patch.summaryEnabled;
  if (typeof patch.tone === 'string') next.tone = patch.tone.slice(0, 200);
  if (patch.recentDocsCount != null) next.recentDocsCount = clampInt(patch.recentDocsCount, 1, 20, DEFAULTS.recentDocsCount);
  if (patch.maxDocChars != null) next.maxDocChars = clampInt(patch.maxDocChars, 500, 40000, DEFAULTS.maxDocChars);
  if (typeof patch.extraInstructions === 'string') next.extraInstructions = patch.extraInstructions.slice(0, 2000);
  if ('homeClientId' in patch) next.homeClientId = patch.homeClientId ? String(patch.homeClientId).trim() : null;
  if ('includeClientIds' in patch) next.includeClientIds = cleanIdList(patch.includeClientIds);
  if ('include' in patch) next.include = normalizeInclude(patch.include);
  if ('schedule' in patch) next.schedule = normalizeSchedule(patch.schedule);
  if ('briefLinkMode' in patch) next.briefLinkMode = normalizeBriefLinkMode(patch.briefLinkMode);
  next.updatedAt = fb.FieldValue.serverTimestamp();
  await configDocRef(clientId).set(next, { merge: true });
  return getDigestConfig(clientId);
}

/**
 * Resolve the clientId whose knowledge base feeds the digest. Prefers the
 * DIGEST_CLIENT_ID env var; otherwise looks up the client owned by DIGEST_EMAIL.
 */
async function resolveDigestClientId() {
  const explicit = process.env.DIGEST_CLIENT_ID;
  if (explicit) return explicit;
  const email = String(process.env.DIGEST_EMAIL || 'bryanballi@gmail.com').toLowerCase();
  try {
    // Deterministic: prefer the recipient's PRIMARY client (users.clientId).
    // ownerEmail can match multiple clients (admins own several), so a plain
    // "first owned client" query is order-unstable — avoid it as the primary path.
    const userSnap = await fb.adminDb.collection('users').where('email', '==', email).limit(5).get();
    for (const doc of userSnap.docs) {
      const cid = doc.data()?.clientId;
      if (cid) return cid;
    }
    const snap = await fb.adminDb.collection('clients').where('ownerEmail', '==', email).limit(1).get();
    if (!snap.empty) {
      const doc = snap.docs[0];
      return doc.data()?.clientId || doc.id;
    }
  } catch {
    // ignore — caller treats null as "no docs"
  }
  return null;
}

/**
 * Pull text from the most recent ready knowledge-base items for a client.
 * Caps total characters; returns the joined text plus a docs manifest.
 * @returns {Promise<{ text: string, docs: Array<{id,title,chars}> }>}
 */
async function getRecentDocsText({ clientId, count = 5, maxChars = 8000 } = {}) {
  if (!clientId) return { text: '', docs: [] };
  const kbRoot = fb.adminDb.collection('knowledge_base').doc(clientId);
  const itemsSnap = await kbRoot
    .collection('items')
    .orderBy('createdAt', 'desc')
    .limit(clampInt(count, 1, 20, 5))
    .get();

  const docs = [];
  let text = '';

  for (const itemDoc of itemsSnap.docs) {
    const item = itemDoc.data() || {};
    if (item.status && item.status !== 'ready') continue;

    const chunksSnap = await kbRoot
      .collection('chunks')
      .where('itemId', '==', itemDoc.id)
      .limit(50)
      .get();

    const body = chunksSnap.docs
      .map((d) => d.data() || {})
      .sort((a, b) => (a.position || 0) - (b.position || 0))
      .map((d) => d.text || '')
      .join('\n')
      .trim();

    const title = item.title || item.fileName || 'Untitled';
    const entry = `\n### ${title}\n${body}\n`;
    docs.push({ id: itemDoc.id, title, chars: body.length });

    if (text.length + entry.length > maxChars) {
      text += entry.slice(0, Math.max(0, maxChars - text.length));
      break;
    }
    text += entry;
  }

  return { text: text.trim(), docs };
}

/** List clients for the email-settings pickers: [{ clientId, name, hasBrief }]. */
async function listSelectableClients() {
  const snap = await fb.adminDb.collection('clients').orderBy('createdAt', 'desc').limit(100).get();
  return snap.docs.map((d) => {
    const data = d.data() || {};
    return {
      clientId: data.clientId || d.id,
      name: data.companyName || data.dashboardTitle || d.id,
      websiteUrl: data.websiteUrl || '',
    };
  });
}

module.exports = {
  DEFAULTS,
  INCLUDE_KEYS,
  DEFAULT_INCLUDE,
  BRIEF_LINK_MODES,
  getDigestConfig,
  saveDigestConfig,
  resolveDigestClientId,
  getRecentDocsText,
  listSelectableClients,
};
