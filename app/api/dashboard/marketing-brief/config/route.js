import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../../api/_lib/client-provisioning.cjs');
const { geocodeZip } = require('../../../../../features/intelligence/_weather.js');

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
  return json({
    ok: true,
    clientId: context.clientId,
    config: data.marketingBriefConfig || null,
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
  try {
    const priorSnap = await fb.adminDb.collection('client_configs').doc(context.clientId).get();
    priorWeather = priorSnap.data()?.marketingBriefConfig?.weather || null;
    priorScoutConfig = priorSnap.data()?.scoutConfig || null;
    priorSourceWebsiteUrl = priorSnap.data()?.sourceInputs?.websiteUrl || null;
  } catch { /* no prior */ }
  const weather = await normalizeWeather(body?.weather, priorWeather);

  const splitTerms = (input, max) => String(input || '')
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);

  const marketingBriefConfig = {
    enabled: true,
    weather,
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
    competitors: String(body?.competitors || '')
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 20),
    scribeTone: String(body?.scribeTone || '').trim().slice(0, 4000),
    scribeHardConstraints: normalizeLineList(body?.scribeHardConstraints, { maxItems: 20, maxLen: 240 }),
    guardianReviewerContext: String(body?.guardianReviewerContext || '').trim().slice(0, 800),
    guardianRestrictedPatterns: normalizeLineList(body?.guardianRestrictedPatterns, { maxItems: 30, maxLen: 240 }),
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

  return json({ ok: true, clientId: context.clientId, config: marketingBriefConfig });
}
