import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildAuthRequestShim, verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const digestConfig = require('../../../../features/intelligence/_digest-config.js');
const { getMarketInsightPlatformState } = require('../../../../features/intelligence/_market-insight-platform-state.js');
const digestDelivery = require('../../../../api/_lib/digest-delivery.cjs');
const digestBreaker = require('../../../../api/_lib/digest-circuit-breaker.cjs');
const { hasResendKey } = require('../../../../api/_lib/digest-refresh-preflight.cjs');
const { sendViaResend } = require('../../../../api/_lib/resend-transport.cjs');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DIGEST_FROM = process.env.DIGEST_FROM || 'HITLOOP Daily <digest@hitloop.agency>';

function digestSendFn({ subject, html, to, idempotencyKey }) {
  return sendViaResend({ apiKey: RESEND_API_KEY, from: DIGEST_FROM, to, subject, html, idempotencyKey });
}

/** The client's own configured digest timezone (default America/Chicago) —
 *  delivery identity is keyed by LOCAL day, not UTC, so admin surfaces must
 *  resolve dateKey the same way the send route does or they'll look up the
 *  wrong record. */
async function clientDigestTimeZone(clientId) {
  try {
    const cfg = await digestConfig.getDigestConfig(clientId);
    return cfg?.schedule?.timezone || 'America/Chicago';
  } catch {
    return 'America/Chicago';
  }
}

/** Best-effort, bounded, non-blocking-ish sweep piggybacked onto an
 *  authenticated admin GET — when someone is actively looking at the Email
 *  Digest card during an incident, a due retry resolves within seconds
 *  instead of waiting for the next scheduled wake-up. Never the ONLY
 *  wake-up mechanism (see docs/source-of-truth/EMAIL-DIGEST-CARD.md §12b) —
 *  purely additive, and never allowed to fail the request it rides on. */
async function opportunisticSweep() {
  try {
    await digestDelivery.sweepDueRetries({
      sendFn: digestSendFn,
      limit: 5,
    });
  } catch { /* best-effort only */ }
}

/** GET ?action=delivery-status&clientId=…&dateKey=… — surfaces the durable
 *  delivery record + circuit-breaker state for the dashboard. Read-only.
 *  `dateKey` defaults to the CLIENT's own local digest day (not UTC) when
 *  omitted, matching how the send route resolves delivery identity. */
async function getDeliveryStatus(request, url) {
  try {
    await verifyAdminRequest(buildAuthRequestShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Forbidden.' }, 403);
  }
  const clientId = (url.searchParams.get('clientId') || '').trim();
  if (!clientId) return json({ error: 'clientId is required.' }, 400);
  const dateKey = (url.searchParams.get('dateKey') || '').trim()
    || digestDelivery.localDateKey(Date.now(), await clientDigestTimeZone(clientId));
  const deliveryId = digestDelivery.buildDeliveryId(clientId, dateKey);
  const [delivery, breaker] = await Promise.all([
    digestDelivery.getDelivery(deliveryId),
    digestBreaker.getBreakerState(clientId),
  ]);
  return json({
    ok: true,
    clientId,
    dateKey,
    delivery: delivery
      ? {
          id: delivery.id, stage: delivery.stage, attempts: delivery.attempts,
          nextRetryAt: delivery.nextRetryAt, lastError: delivery.lastError,
          attemptLog: delivery.attemptLog || [],
          providerEmailId: delivery.providerEmailId, source: delivery.source,
          updatedAt: delivery.updatedAt,
        }
      : null,
    breaker,
  });
}

/** POST action:'retry-delivery' — reuses the stored render for a delivery,
 *  calling Resend again under the same idempotency key. Never calls
 *  Anthropic: it has no dependency capable of generating content, only
 *  digest-delivery.cjs's transport replay. Accepts an explicit
 *  `deliveryId` (preferred — from a delivery-status lookup) or falls back
 *  to resolving (clientId, dateKey) against the client's own local day. */
async function retryDelivery(patch) {
  const clientId = String(patch.clientId || '').trim();
  if (!clientId) return json({ error: 'clientId is required.' }, 400);
  const explicitId = String(patch.deliveryId || '').trim();
  const dateKey = String(patch.dateKey || '').trim()
    || digestDelivery.localDateKey(Date.now(), await clientDigestTimeZone(clientId));
  const deliveryId = explicitId || digestDelivery.buildDeliveryId(clientId, dateKey);
  const outcome = await digestDelivery.retryDeliveryNow(deliveryId, { sendFn: digestSendFn });
  return json({ ok: Boolean(outcome.ok || outcome.alreadySent), deliveryId, outcome });
}

/** POST action:'reset-breaker' — explicit admin reset, only when transport
 *  is actually healthy (never re-open the gate onto a still-broken sender). */
async function resetBreaker(patch, actorUid) {
  const clientId = String(patch.clientId || '').trim();
  if (!clientId) return json({ error: 'clientId is required.' }, 400);
  if (!hasResendKey()) {
    return json({ error: 'Cannot reset: RESEND_API_KEY is not configured, so the transport is still unhealthy.' }, 409);
  }
  const state = await digestBreaker.resetBreaker(clientId, { actorUid });
  return json({ ok: true, clientId, breaker: state });
}

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
  const url0 = new URL(request.url);
  if (url0.searchParams.get('action') === 'delivery-status') {
    return getDeliveryStatus(request, url0);
  }
  try {
    await verifyAdminRequest(buildAuthRequestShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Forbidden.' }, 403);
  }

  // Opportunistic wake-up: an admin opening this card is exactly the moment
  // an incident is most likely being actively investigated. See
  // docs/source-of-truth/EMAIL-DIGEST-CARD.md §12b.
  await opportunisticSweep();

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
  let decoded;
  try {
    decoded = await verifyAdminRequest(buildAuthRequestShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Forbidden.' }, 403);
  }

  try {
    const patch = await request.json().catch(() => ({}));
    if (patch.action === 'retry-delivery') return retryDelivery(patch);
    if (patch.action === 'reset-breaker') return resetBreaker(patch, decoded?.uid || null);
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
