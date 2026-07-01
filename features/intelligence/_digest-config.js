'use strict';

// _digest-config.js — persistence + helpers for the daily-digest summary feature.
// Stores per-client config in Firestore `digest_config/{clientId}` and reads
// recent knowledge-base document text to feed the LLM summary. CJS so it can be
// required from both the ESM route and the admin API route via createRequire.

const fb = require('../../api/_lib/firebase-admin.cjs');
const {
  DEFAULT_MARKET_INSIGHT_SOURCE_PLATFORMS,
  getMarketInsightPlatformState,
} = require('./_market-insight-platform-state.js');

// Aggregation toggles — EVERY rendered section of the email is individually
// on/off here. Each key maps to exactly one section in the digest route's
// buildEmailHtml, so the EMAIL PREVIEW and the actual sent email hide/show
// identically (no data-presence gating). Default ON (except creativeBrief).
const INCLUDE_KEYS = [
  'execBriefLink',    // "Open Executive Brief" CTA button (top + footer)
  'contactHuman',     // "Contact Your Human" CTA button (opens contactUrl / Calendly)
  'execSummary',      // LLM executive-summary paragraph
  'videoPosts',       // Video Remix "Post content" row (video + X promo post)
  'videoPromo',       // Video Promo (Mockup Studio) "Post content" row
  'agenda',           // Today's Agenda (calendar)
  'weather',          // Local weather forecast
  'followerPosts',    // 1 post from each followed handle
  'watchlist',        // "Happening on X" watchlist analysis
  'redditAnalysis',   // "Happening on Reddit" platform analysis
  'instagramAnalysis',// "Happening on Instagram" platform analysis
  'creativeBrief',    // Attached Creative Brief deliverable
  // Market Signals · Strategic-brief items (each individually toggled)
  'humanBrief',       // Human brief blurb
  'opportunities',    // Post opportunities (Conversation / angle)
  'suggestedReplies', // Suggested replies (drafted reply per opportunity)
  'signals',          // KOLs / competitors / narratives
  'watchlistAccounts',// Watchlist accounts (name-for-name)
  'suggestedPosts',   // Suggested posts
  'planPreview',      // 30-day plan preview
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
// Tease-by-default: a NEW config shows the short "tease" core (summary, agenda,
// new sign-ups, both CTAs) plus post-content video rows. Everything heavier is
// OFF — the full detail lives in the linked Executive Brief; the admin opts each
// extra section in.
// NOTE: only applies to brand-new / missing keys — existing saved configs keep
// whatever they saved (normalizeInclude overlays saved keys on top of this).
const DEFAULT_INCLUDE = {
  execBriefLink: true,
  contactHuman: true,
  execSummary: true,
  agenda: true,
  weather: true,
  followerPosts: true,
  videoPosts: true,
  videoPromo: true,
  signups: true,
  // ── opt-in extras (off by default) ──
  humanBrief: false,
  opportunities: false,
  suggestedReplies: true,
  signals: false,
  watchlistAccounts: false,
  suggestedPosts: false,
  planPreview: false,
  watchlist: false,
  redditAnalysis: false,
  instagramAnalysis: false,
  creativeBrief: false,
  platformOverview: false,
  ga4Traffic: false,
  topPages: false,
  trafficSources: false,
  keyEvents: false,
  homepage: false,
  dashboards: false,
  pipeline: false,
  deployments: false,
  runtimeErrors: false,
};

// Legacy coarse keys (the pre-granular schema). A saved doc using these expands
// to the matching granular set so existing configs keep working unchanged.
// Applied BEFORE granular keys so any granular key present wins.
const LEGACY_INCLUDE_EXPANSION = {
  calendar: ['agenda'],
  webStats: ['ga4Traffic', 'topPages', 'trafficSources', 'keyEvents', 'homepage'],
  platformStats: ['platformOverview', 'signups', 'dashboards', 'pipeline'],
  deployments: ['deployments', 'runtimeErrors'],
  marketingBrief: ['humanBrief', 'opportunities', 'suggestedReplies', 'signals', 'watchlistAccounts', 'suggestedPosts', 'planPreview', 'watchlist', 'redditAnalysis', 'instagramAnalysis'],
  creativeBrief: ['creativeBrief'],
};

// How the "Open Executive Brief" link resolves its target:
//   'fresh'  — run a brand-new brief on send and link to it (LLM cost per send)
//   'latest' — link to the newest already-published hosted brief (free)
//   'off'    — no hosted link (button hidden)
const BRIEF_LINK_MODES = ['fresh', 'latest', 'off'];
const DEFAULT_BRIEF_LINK_MODE = 'fresh';

// Send schedule + daily opt-in. `schedule.enabled` is the master "daily email"
// switch per client: the pre-digest refresh cron and the daily-digest send cron
// BOTH only run for clients whose schedule is enrolled (see isCronEnrolled).
// Default is OFF — a new client (signup) gets the one-time Creative Brief and
// nothing daily until an admin turns this on from that client's Email Digest
// card. `listCronEnrolledClientIds` is what the refresh cron loops over.
// Section order. The admin can shuffle sections up/down WITHIN their group; the
// email renders each group's items in this saved order. CTAs (execBriefLink /
// contactHuman) are not part of the section flow, so they're excluded.
const ORDERABLE_KEYS = INCLUDE_KEYS.filter((k) => !['execBriefLink', 'contactHuman'].includes(k));
const DEFAULT_ORDER = [...ORDERABLE_KEYS];

function normalizeOrder(value) {
  const seen = new Set();
  const out = [];
  if (Array.isArray(value)) {
    for (const k of value) {
      if (ORDERABLE_KEYS.includes(k) && !seen.has(k)) { seen.add(k); out.push(k); }
    }
  }
  for (const k of ORDERABLE_KEYS) if (!seen.has(k)) out.push(k); // append any missing
  return out;
}

// Suggested-post platform registry — the SINGLE source of truth for which
// platforms can appear in the email's Suggested Posts section (no own header,
// just in/out). The marketing brief generates ALL platforms (for the Executive
// Brief); this only filters what the EMAIL pulls in. Future-proofed: add a
// platform here and it flows everywhere (config defaults, the route's content
// mapping + hint matching + preview override, and the settings checkboxes).
//   key     — stable id stored in config
//   label   — UI/email label
//   default — included in a NEW config (X only by default)
//   fields  — intel.content keys whose drafts belong to this platform
//   hints   — substrings matched against a post's platformHint
const POST_PLATFORMS = [
  { key: 'x',         label: 'X',             default: true,  fields: ['x_post'],                              hints: ['x', 'twitter'] },
  { key: 'thread',    label: 'Thread opener', default: false, fields: ['x_thread_opener'],                     hints: ['thread'] },
  { key: 'discord',   label: 'Discord',       default: false, fields: ['discord_announcement', 'discord_post'], hints: ['discord'] },
  { key: 'reddit',    label: 'Reddit',        default: false, fields: ['reddit_post', 'reddit_announcement'],  hints: ['reddit'] },
  { key: 'instagram', label: 'Instagram',     default: false, fields: ['instagram_post', 'instagram_caption'], hints: ['instagram', 'insta', 'ig'] },
];
const POST_PLATFORM_KEYS = POST_PLATFORMS.map((p) => p.key);
const DEFAULT_POST_PLATFORMS = Object.fromEntries(POST_PLATFORMS.map((p) => [p.key, p.default]));
function normalizePostPlatforms(value) {
  const v = value && typeof value === 'object' ? value : {};
  const out = {};
  for (const p of POST_PLATFORMS) {
    out[p.key] = typeof v[p.key] === 'boolean' ? v[p.key] : p.default;
  }
  return out;
}

const SCHEDULE_FREQUENCIES = ['daily', 'weekly', 'off'];
// Default OFF: opt-in only. A brand-new / missing config never enrolls in the
// daily crons — the admin turns it on per client.
const DEFAULT_SCHEDULE = {
  enabled: false,
  frequency: 'off',            // 'daily' | 'weekly' | 'off'
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
  order: [...DEFAULT_ORDER],
  postPlatforms: { ...DEFAULT_POST_PLATFORMS },
  schedule: { ...DEFAULT_SCHEDULE },
  briefLinkMode: DEFAULT_BRIEF_LINK_MODE, // how the Executive Brief link resolves
  contactUrl: '',          // "Contact Your Human" CTA target (Calendly etc.); env DIGEST_CONTACT_URL is the fallback
  autoPostX: true,         // on a REAL send, queue the suggested x_post to the social-posting system. Default ON (as-built); off = skip.
  recipientEmail: '',      // where THIS client's daily email is sent. Blank = the admin address (DIGEST_EMAIL) — a client is never emailed until this is set.
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
    // Opt-in: absent/unknown → OFF (was default-on). Only an explicit true enrolls.
    enabled: v.enabled === true,
    frequency: SCHEDULE_FREQUENCIES.includes(v.frequency) ? v.frequency : DEFAULT_SCHEDULE.frequency,
    sendHour: clampInt(v.sendHour, 0, 23, DEFAULT_SCHEDULE.sendHour),
    weekday: clampInt(v.weekday, 0, 6, DEFAULT_SCHEDULE.weekday),
    timezone: typeof v.timezone === 'string' && v.timezone.trim()
      ? v.timezone.trim().slice(0, 64)
      : DEFAULT_SCHEDULE.timezone,
  };
}

// A client is enrolled in the daily crons only when its schedule is explicitly
// on and not 'off'. This is the single gate both crons (refresh + send) honor.
function isCronEnrolled(schedule) {
  return Boolean(schedule) && schedule.enabled === true && schedule.frequency !== 'off';
}

// All clients currently enrolled in the daily crons (scans digest_config).
async function listCronEnrolledClientIds() {
  try {
    const snap = await fb.adminDb.collection('digest_config').limit(500).get();
    const ids = [];
    snap.forEach((doc) => {
      if (isCronEnrolled(normalizeSchedule(doc.data()?.schedule))) ids.push(doc.id);
    });
    return ids;
  } catch {
    return [];
  }
}

// One-time, idempotent: with the opt-in default flip, every existing config that
// was saved daily-on would otherwise auto-enroll. Turn them all OFF except the
// home client, so daily runs become explicit opt-in. Guarded by a flag doc so it
// runs once; re-enabling a client afterward via its card is never undone.
async function ensureDailyOptInMigration(homeClientId) {
  const flagRef = fb.adminDb.collection('system_flags').doc('digest_optin_v1');
  try {
    if ((await flagRef.get()).exists) return { migrated: false, alreadyDone: true };
    const snap = await fb.adminDb.collection('digest_config').get();
    const batch = fb.adminDb.batch();
    let disabled = 0;
    snap.forEach((doc) => {
      if (doc.id === homeClientId) return; // home stays on
      if (doc.data()?.schedule?.enabled === true) {
        batch.set(doc.ref, { schedule: { enabled: false } }, { merge: true });
        disabled++;
      }
    });
    if (disabled > 0) await batch.commit();
    await flagRef.set({ ranAt: fb.FieldValue.serverTimestamp(), homeClientId: homeClientId || null, disabled });
    return { migrated: true, disabled };
  } catch (err) {
    return { migrated: false, error: err.message };
  }
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
    order: normalizeOrder(data.order),
    postPlatforms: normalizePostPlatforms(data.postPlatforms),
    schedule: normalizeSchedule(data.schedule),
    briefLinkMode: normalizeBriefLinkMode(data.briefLinkMode),
    contactUrl: typeof data.contactUrl === 'string' ? data.contactUrl : '',
    autoPostX: data.autoPostX !== false,
    recipientEmail: typeof data.recipientEmail === 'string' ? data.recipientEmail : '',
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
  if ('order' in patch) next.order = normalizeOrder(patch.order);
  if ('postPlatforms' in patch) next.postPlatforms = normalizePostPlatforms(patch.postPlatforms);
  if ('schedule' in patch) next.schedule = normalizeSchedule(patch.schedule);
  if ('briefLinkMode' in patch) next.briefLinkMode = normalizeBriefLinkMode(patch.briefLinkMode);
  if (typeof patch.contactUrl === 'string') next.contactUrl = patch.contactUrl.trim().slice(0, 500);
  if (typeof patch.autoPostX === 'boolean') next.autoPostX = patch.autoPostX;
  if (typeof patch.recipientEmail === 'string') next.recipientEmail = patch.recipientEmail.trim().slice(0, 200);
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
  const clients = snap.docs.map((d) => {
    const data = d.data() || {};
    return {
      clientId: data.clientId || d.id,
      name: data.companyName || data.dashboardTitle || d.id,
      websiteUrl: data.websiteUrl || '',
    };
  });
  const platformStates = await Promise.all(clients.map((c) => getMarketInsightPlatformState(c.clientId)));
  return clients.map((c, index) => ({
    ...c,
    marketInsightSourcePlatforms: platformStates[index].sourcePlatforms,
    platformAvailability: platformStates[index].platformAvailability,
  }));
}

module.exports = {
  DEFAULTS,
  INCLUDE_KEYS,
  DEFAULT_INCLUDE,
  ORDERABLE_KEYS,
  DEFAULT_ORDER,
  POST_PLATFORMS,
  POST_PLATFORM_KEYS,
  DEFAULT_POST_PLATFORMS,
  DEFAULT_MARKET_INSIGHT_SOURCE_PLATFORMS,
  BRIEF_LINK_MODES,
  getDigestConfig,
  saveDigestConfig,
  isCronEnrolled,
  listCronEnrolledClientIds,
  ensureDailyOptInMigration,
  getMarketInsightPlatformState,
  resolveDigestClientId,
  getRecentDocsText,
  listSelectableClients,
};
