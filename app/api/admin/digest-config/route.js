import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildAuthRequestShim, verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const digestConfig = require('../../../../features/intelligence/_digest-config.js');
const { getMarketInsightPlatformState } = require('../../../../features/intelligence/_market-insight-platform-state.js');

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

const COMPAT_INCLUDE_KEYS = ['redditAnalysis', 'suggestedReplies'];

function mergeCompatInclude(config, includePatch = {}) {
  if (!config || !includePatch || typeof includePatch !== 'object') return config;
  const include = { ...(config.include || {}) };
  for (const key of COMPAT_INCLUDE_KEYS) {
    if (typeof includePatch[key] === 'boolean') include[key] = includePatch[key];
  }
  return { ...config, include };
}

async function readRawDigestInclude(clientId) {
  if (!clientId) return {};
  try {
    const snap = await fb.adminDb.collection('digest_config').doc(clientId).get();
    return snap.exists ? (snap.data()?.include || {}) : {};
  } catch {
    return {};
  }
}

async function persistCompatInclude(clientId, config, patch = {}) {
  const includePatch = {};
  const incoming = patch?.include && typeof patch.include === 'object' ? patch.include : {};
  for (const key of COMPAT_INCLUDE_KEYS) {
    if (typeof incoming[key] === 'boolean') includePatch[key] = incoming[key];
  }
  if (Object.keys(includePatch).length && clientId) {
    await fb.adminDb.collection('digest_config').doc(clientId).set({ include: includePatch }, { merge: true });
  }
  return mergeCompatInclude(config, includePatch);
}

async function enrichClientsWithMarketInsights(clients = []) {
  return Promise.all((Array.isArray(clients) ? clients : []).map(async (client) => {
    if (client?.platformAvailability && client?.marketInsightSourcePlatforms) return client;
    const state = await getMarketInsightPlatformState(client?.clientId);
    return {
      ...client,
      marketInsightSourcePlatforms: state.sourcePlatforms,
      platformAvailability: state.platformAvailability,
    };
  }));
}

export async function GET(request) {
  try {
    await verifyAdminRequest(buildAuthRequestShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Forbidden.' }, 403);
  }

  try {
    // Scope to the client loaded in the dashboard (?clientId=) — the Email Digest
    // card is per-client. Falls back to the email-resolved admin client.
    const explicitClientId = (new URL(request.url).searchParams.get('clientId') || '').trim();
    const clientId = explicitClientId || await digestConfig.resolveDigestClientId();
    let config = await digestConfig.getDigestConfig(clientId);
    config = mergeCompatInclude(config, await readRawDigestInclude(clientId));
    const homeClientId = config.homeClientId || clientId;
    let docs = [];
    if (homeClientId) {
      try {
        const result = await digestConfig.getRecentDocsText({
          clientId: homeClientId, count: config.recentDocsCount, maxChars: config.maxDocChars,
        });
        docs = result.docs;
      } catch {
        docs = [];
      }
    }
    let clients = [];
    try {
      clients = await digestConfig.listSelectableClients();
    } catch {
      clients = [];
    }
    clients = await enrichClientsWithMarketInsights(clients);
    const marketInsights = await getMarketInsightPlatformState(homeClientId);
    // Owner email of the scoped client — the card uses it as the recipient
    // placeholder ("send this client's daily email here"). Not auto-saved.
    let ownerEmail = '';
    try {
      const cSnap = await fb.adminDb.collection('clients').doc(clientId).get();
      ownerEmail = cSnap.exists ? (cSnap.data()?.ownerEmail || '') : '';
    } catch { /* placeholder only — non-fatal */ }
    return json({ ok: true, clientId, homeClientId, config, docs, clients, marketInsights, ownerEmail });
  } catch (err) {
    return json({ error: err.message || 'Could not load digest config.' }, 500);
  }
}

export async function POST(request) {
  try {
    await verifyAdminRequest(buildAuthRequestShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Forbidden.' }, 403);
  }

  try {
    const patch = await request.json().catch(() => ({}));
    // Scope to the client loaded in the dashboard (body.clientId or ?clientId=);
    // falls back to the email-resolved admin client. `clientId` is not a config
    // field, so saveDigestConfig ignores it in the patch.
    const explicitClientId = (patch.clientId || new URL(request.url).searchParams.get('clientId') || '').trim();
    const clientId = explicitClientId || await digestConfig.resolveDigestClientId();
    if (!clientId) {
      return json({ error: 'No digest client resolved. Set DIGEST_CLIENT_ID or a client owned by DIGEST_EMAIL.' }, 400);
    }
    let config = await digestConfig.saveDigestConfig(clientId, patch);
    config = await persistCompatInclude(clientId, config, patch);
    const homeClientId = config.homeClientId || clientId;
    const marketInsights = await getMarketInsightPlatformState(homeClientId);
    return json({ ok: true, clientId, homeClientId, config, marketInsights });
  } catch (err) {
    return json({ error: err.message || 'Could not save digest config.' }, 500);
  }
}
