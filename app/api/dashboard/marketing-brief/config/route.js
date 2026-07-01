import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../../api/_lib/client-provisioning.cjs');
const { geocodeZip } = require('../../../../../features/intelligence/_weather.js');
const { loadClientBrainCardDefaults, saveClientBrainCardSettingsSnapshot } = require('../../../../../features/client-brain/store.cjs');

// Normalize + (re)geocode the weather config. Geocodes the zip on save so the
// brief/email can fetch a forecast by lat/lon without geocoding every run.
async function normalizeWeather(input, prior) {
  const enabled = Boolean(input?.enabled);
  const zip = String(input?.zip || '').trim().slice(0, 5);
  const weather = { enabled, zip };
  if (enabled && /^\d{5}$/.test(zip)) {
    if (prior?.zip === zip && prior?.lat != null && prior?.lon != null) {
      weather.lat = prior.lat; weather.lon = prior.lon; weather.place = prior.place || '';
    } else {
      const geo = await geocodeZip(zip);
      if (geo) { weather.lat = geo.lat; weather.lon = geo.lon; weather.place = geo.place; }
    }
  }
  return weather;
}

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function normalizeSearches(input) {
  const rows = Array.isArray(input) ? input : [];
  return rows
    .map((row, index) => ({
      label: String(row?.label || `SEARCH ${index + 1}`).trim().slice(0, 60),
      query: String(row?.query || '').trim().slice(0, 600),
      goal:  String(row?.goal || '').trim().slice(0, 240),
    }))
    .filter((row) => row.query)
    .slice(0, 8);
}

const ALLOWED_SOURCE_PLATFORMS = new Set(['web', 'x', 'reddit', 'instagram', 'youtube', 'tiktok', 'hackernews']);
const DEFAULT_SOURCE_PLATFORMS = ['web', 'x', 'reddit', 'hackernews', 'instagram'];

function normalizeSourcePlatforms(input) {
  const rows = Array.isArray(input) ? input : DEFAULT_SOURCE_PLATFORMS;
  const normalized = rows
    .map((item) => String(item || '').trim().toLowerCase())
    .filter((item) => ALLOWED_SOURCE_PLATFORMS.has(item));
  const unique = Array.from(new Set(normalized)).slice(0, 10);
  return unique.length ? unique : ['web'];
}

// Saved events feed the brief's upcomingEvents + Local Signals hydration.
// Each entry: { event, date (YYYY-MM-DD), location?, url?, source? }.
function normalizeEvents(input) {
  const rows = Array.isArray(input) ? input : [];
  return rows
    .map((row) => {
      // Event search results carry free-form dates — normalize anything
      // parseable to YYYY-MM-DD, drop entries with no usable date.
      const rawDate = String(row?.date || '').trim();
      let date = '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
        date = rawDate;
      } else if (rawDate) {
        const ms = Date.parse(rawDate);
        if (!Number.isNaN(ms)) date = new Date(ms).toISOString().slice(0, 10);
      }
      return {
        event:    String(row?.event || row?.name || row?.title || '').trim().slice(0, 200),
        date,
        location: String(row?.location || '').trim().slice(0, 160),
        url:      String(row?.url || '').trim().slice(0, 500),
        source:   String(row?.source || 'events-search').trim().slice(0, 60),
      };
    })
    .filter((row) => row.event && row.date)
    .slice(0, 20);
}

// Accepts either a string (newline / comma separated) or an array. Returns a
// cleaned string array, max `maxItems` items each up to `maxLen` chars.
function normalizeLineList(input, { maxItems = 20, maxLen = 240 } = {}) {
  const raw = Array.isArray(input)
    ? input
    : String(input || '').split(/\n+/);
  return raw
    .map((item) => String(item || '').trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

function defaultValue(item) {
  return item && typeof item === 'object' && Object.prototype.hasOwnProperty.call(item, 'value') ? item.value : item;
}

function isEmptyConfigValue(field, value) {
  if (field === 'searches') {
    return !Array.isArray(value) || !value.some((row) => String(row?.query || '').trim());
  }
  if (Array.isArray(value)) return value.length === 0;
  if (value && typeof value === 'object') return Object.keys(value).length === 0;
  return !String(value || '').trim();
}

function mergeClientBrainDefaults(config, defaults) {
  if (!config || !defaults?.fields) return { config, applied: [] };
  const next = { ...config };
  const applied = [];
  for (const [field, wrapped] of Object.entries(defaults.fields || {})) {
    const value = defaultValue(wrapped);
    if (isEmptyConfigValue(field, value)) continue;
    if (!isEmptyConfigValue(field, next[field])) continue;
    next[field] = value;
    applied.push(field);
  }
  return {
    config: applied.length
      ? {
          ...next,
          clientBrainDefaults: {
            appliedFields: applied,
            status: 'suggested',
            updatedAtIso: new Date().toISOString(),
          },
        }
      : next,
    applied,
  };
}

async function resolveContext(request) {
  const decoded = await verifyRequestUser(makeReqShim(request));
  const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  if (!context.userProfile) {
    const err = new Error('No user record.');
    err.status = 404;
    throw err;
  }
  if (!context.clientId) {
    const err = new Error('No clientId on user record.');
    err.status = 404;
    throw err;
  }
  return { decoded, context };
}

export async function GET(request) {
  let context;
  try {
    ({ context } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  const snap = await fb.adminDb.collection('client_configs').doc(context.clientId).get();
  if (!snap.exists) return json({ error: 'No client config.' }, 404);

  const data = snap.data() || {};
  const config = data.marketingBriefConfig || null;
  let defaults = { fields: {} };
  try {
    defaults = await loadClientBrainCardDefaults(context.clientId, { cardId: 'marketing-brief' });
  } catch { /* non-fatal — config works without Client Brain defaults */ }
  const merged = mergeClientBrainDefaults(config, defaults);
  return json({
    ok: true,
    clientId: context.clientId,
    config: merged.config,
    clientBrainDefaults: {
      fields: defaults.fields || {},
      appliedFields: merged.applied,
    },
  });
}

export async function POST(request) {
  let context;
  try {
    ({ context } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const searches = normalizeSearches(body?.searches);

  let priorWeather = null;
  let priorScoutConfig = null;
  let priorSourceWebsiteUrl = null;
  let priorAcknowledged = {};
  let priorEvents = [];
  let priorLocalSignals = [];
  let priorAuditSeed = null;
  let priorCalendar = null;
  try {
    const priorSnap = await fb.adminDb.collection('client_configs').doc(context.clientId).get();
    priorWeather = priorSnap.data()?.marketingBriefConfig?.weather || null;
    priorCalendar = priorSnap.data()?.marketingBriefConfig?.calendar || null;
    priorScoutConfig = priorSnap.data()?.scoutConfig || null;
    priorSourceWebsiteUrl = priorSnap.data()?.sourceInputs?.websiteUrl || null;
    const a = priorSnap.data()?.marketingBriefConfig?.acknowledgedCards;
    if (a && typeof a === 'object') priorAcknowledged = a;
    const pe = priorSnap.data()?.marketingBriefConfig?.events;
    if (Array.isArray(pe)) priorEvents = pe;
    const pl = priorSnap.data()?.marketingBriefConfig?.localSignals;
    if (Array.isArray(pl)) priorLocalSignals = pl;
    const ps = priorSnap.data()?.marketingBriefConfig?.auditSeed;
    if (ps && typeof ps === 'object') priorAuditSeed = ps;
  } catch { /* no prior */ }
  const weather = await normalizeWeather(body?.weather, priorWeather);
  const incomingAck = (body?.acknowledgedCards && typeof body.acknowledgedCards === 'object') ? body.acknowledgedCards : {};

  const splitTerms = (input, max) => String(input || '')
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);

  const marketingBriefConfig = {
    enabled: true,
    weather,
    // Omitted fields preserve prior values — a card save that doesn't carry
    // events/localSignals must never wipe what another card stored.
    events: body?.events !== undefined ? normalizeEvents(body.events) : priorEvents,
    localSignals: body?.localSignals !== undefined
      ? normalizeLineList(body.localSignals, { maxItems: 12, maxLen: 300 })
      : priorLocalSignals,
    // Provenance snapshot written by the audit merger — what the last website
    // run produced per field group. Server-owned; never accepted from the body.
    ...(priorAuditSeed ? { auditSeed: priorAuditSeed } : {}),
    acknowledgedCards: { ...priorAcknowledged, ...incomingAck },
    brandName: String(body?.brandName || '').trim().slice(0, 120),
    brandKeywords: splitTerms(body?.brandKeywords, 12),
    categoryTerms: splitTerms(body?.categoryTerms, 12),
    sourceFocus: String(body?.sourceFocus || '').trim().slice(0, 1000),
    scoutInstructions: String(body?.scoutInstructions || '').trim().slice(0, 6000),
    agentDataTemplate: String(body?.agentDataTemplate || '').trim().slice(0, 6000),
    freshnessDays: Math.max(1, Math.min(30, Number(body?.freshnessDays || 7))),
    sourcePlatforms: normalizeSourcePlatforms(body?.sourcePlatforms),
    searches,
    kolSearchMode: body?.kolSearchMode === 'combined' ? 'combined' : 'per-handle',
    kols: String(body?.kols || '')
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 20),
    instagramHandles: (Array.isArray(body?.instagramHandles) ? body.instagramHandles.join('\n') : String(body?.instagramHandles || ''))
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 20),
    competitors: String(body?.competitors || '')
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 20),
    scribeTone: String(body?.scribeTone || '').trim().slice(0, 4000),
    scribeHardConstraints: normalizeLineList(body?.scribeHardConstraints, { maxItems: 20, maxLen: 240 }),
    // Include the approved Client Brain (curated identity/positioning/proof/voice)
    // in the brief analysis. Default ON — the brain should always be considered.
    includeClientBrain: body?.includeClientBrain !== false,
    guardianReviewerContext: String(body?.guardianReviewerContext || '').trim().slice(0, 800),
    guardianRestrictedPatterns: normalizeLineList(body?.guardianRestrictedPatterns, { maxItems: 30, maxLen: 240 }),
    // Enabled analysis-skill recipe ids (Market Signals card). Array of registry
    // ids the user toggled ON; the recipe-run path executes only these. See SSOT §8.
    analysisRecipes: Array.isArray(body?.analysisRecipes)
      ? [...new Set(body.analysisRecipes.map((s) => String(s || '').trim()).filter(Boolean))].slice(0, 12)
      : [],
    // Calendar / Agenda toggle (Market Signals card). Controls whether the daily
    // digest includes the Today's Agenda section. Defaults ON when never set.
    calendar: {
      enabled: (body?.calendar?.enabled ?? priorCalendar?.enabled) !== false,
    },
    // Watchlist pull detail level (Market Signals card) — booleans.
    watchlistDetail: {
      tweets: body?.watchlistDetail?.tweets !== false,
      mentions: body?.watchlistDetail?.mentions !== false,
      latestOnly: body?.watchlistDetail?.latestOnly === true,
    },
    updatedAtIso: new Date().toISOString(),
  };

  // Mirror the canonical brand identity back into scoutConfig so the
  // external-scout path (which reads scoutConfig, not marketingBriefConfig)
  // sees card edits instead of the original audit values. Only mirror when an
  // audit-generated scoutConfig already exists — never fabricate a partial one
  // before the crawl has run. merge:true deep-merges, so untouched scoutConfig
  // fields (industry, reddit.subreddits, …) are preserved.
  const writePayload = {
    marketingBriefConfig,
    updatedAt: fb.FieldValue.serverTimestamp(),
  };
  // Re-quote multi-word terms to match the audit's exact-match form
  // (same rule buildSearchPlan uses for the brand query).
  const quoteTerm = (t) => (/\s/.test(t) && !/^".*"$/.test(t) ? `"${t}"` : t);
  const quotedKeywords = marketingBriefConfig.brandKeywords.map(quoteTerm);

  if (priorScoutConfig) {
    // URL client: mirror card edits back into existing scoutConfig.
    const scoutConfigMirror = {
      brandKeywords: quotedKeywords,
      categoryTerms: marketingBriefConfig.categoryTerms,
    };
    if (marketingBriefConfig.brandName) scoutConfigMirror.clientName = marketingBriefConfig.brandName;
    // reddit.mentionQueries is the brand identity in the shape the reddit
    // external scout actually queries — refresh it from the edited keywords.
    if (priorScoutConfig.reddit) {
      scoutConfigMirror.reddit = { mentionQueries: quotedKeywords };
    }
    writePayload.scoutConfig = scoutConfigMirror;
  } else if (!priorSourceWebsiteUrl) {
    // Name-only client: no URL means no crawl will ever run — seed store A from
    // the first card save so external scouts have a canonical identity to read.
    writePayload.scoutConfig = {
      clientName: marketingBriefConfig.brandName || '',
      brandKeywords: quotedKeywords,
      categoryTerms: marketingBriefConfig.categoryTerms,
      competitors: [],
      industry: '',
      reddit: { subreddits: [], mentionQueries: quotedKeywords },
    };
  }

  await fb.adminDb.collection('client_configs').doc(context.clientId).set(
    writePayload,
    { merge: true }
  );

  try {
    await saveClientBrainCardSettingsSnapshot(context.clientId, {
      cardId: 'marketing-brief',
      config: marketingBriefConfig,
      source: 'card',
      promote: true,
    });
  } catch { /* non-fatal — card config is canonical for its own run state */ }

  return json({ ok: true, clientId: context.clientId, config: marketingBriefConfig });
}
