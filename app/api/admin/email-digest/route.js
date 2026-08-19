import { NextResponse } from 'next/server';
import { createRequire } from 'module';

// email-digest — the new POST-only admin surface for the Email Digest card
// (EMAIL-REBUILD-PLAN.md Phase 3: "POST routes replacing GET ?send=1 and the
// digest-config action grab-bag"). One route, five actions in the request
// body ({action, ...}): config (load when no `patch`, save when `patch` is
// present), preview, send-now, retry, reset-breaker.
//
// config/retry/reset-breaker are ported near-verbatim from the existing
// app/api/admin/digest-config/route.js (proven logic, unchanged behavior —
// that route stays live as a compat path for now, not deleted here).
//
// preview/send-now are a thin FACADE over the existing, Phase-0+1-hardened
// app/api/admin/daily-digest/route.js: this route does not reimplement
// rendering or sending, it translates a clean POST body into that route's
// existing query-string contract and forwards the caller's own admin bearer
// token to it via a same-origin server-to-server request (digestSelfOrigin —
// never url.origin/VERCEL_URL, same SSO-protection trap Phase 0+1 fixed for
// the worker fan-out). daily-digest's internals are untouched by this file.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const require = createRequire(import.meta.url);
const { buildAuthRequestShim, verifyAdminRequest, getHeaderValue } = require('../../../../api/_lib/auth.cjs');
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const digestConfig = require('../../../../features/intelligence/_digest-config.js');
const { getMarketInsightPlatformState } = require('../../../../features/intelligence/_market-insight-platform-state.js');
const digestDelivery = require('../../../../api/_lib/digest-delivery.cjs');
const digestBreaker = require('../../../../api/_lib/digest-circuit-breaker.cjs');
const { hasResendKey } = require('../../../../api/_lib/digest-refresh-preflight.cjs');
const { sendViaResend } = require('../../../../api/_lib/resend-transport.cjs');
const { digestSelfOrigin } = require('../../../../api/_lib/digest-self-origin.cjs');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DIGEST_FROM = process.env.DIGEST_FROM || 'HITLOOP Daily <digest@hitloop.agency>';

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function digestSendFn({ subject, html, to, idempotencyKey }) {
  return sendViaResend({ apiKey: RESEND_API_KEY, from: DIGEST_FROM, to, subject, html, idempotencyKey });
}

/** The client's own configured digest timezone (default America/Chicago) —
 *  delivery identity is keyed by LOCAL day, not UTC, so admin surfaces must
 *  resolve dateKey the same way the send route does or they'll look up the
 *  wrong record. Ported verbatim from digest-config/route.js. */
async function clientDigestTimeZone(clientId) {
  try {
    const cfg = await digestConfig.getDigestConfig(clientId);
    return cfg?.schedule?.timezone || 'America/Chicago';
  } catch {
    return 'America/Chicago';
  }
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

/** Best-effort, bounded sweep piggybacked onto an authenticated admin action
 *  — an admin actively viewing the card is exactly the moment an incident is
 *  most likely being investigated. Ported from digest-config/route.js. */
async function opportunisticSweep() {
  try {
    await digestDelivery.sweepDueRetries({ sendFn: digestSendFn, limit: 5 });
  } catch { /* best-effort only */ }
}

// ── action: config (load when no patch, save when patch present) ──────────
async function handleConfig(body) {
  const clientId = String(body.clientId || '').trim() || await digestConfig.resolveDigestClientId();
  if (!clientId) {
    return json({ error: 'No digest client resolved. Set DIGEST_CLIENT_ID or a client owned by DIGEST_EMAIL.' }, 400);
  }

  if (body.patch && typeof body.patch === 'object') {
    let config = await digestConfig.saveDigestConfig(clientId, body.patch);
    config = await persistCompatInclude(clientId, config, body.patch);
    const homeClientId = config.homeClientId || clientId;
    const marketInsights = await getMarketInsightPlatformState(homeClientId);
    return json({ ok: true, clientId, homeClientId, config, marketInsights });
  }

  await opportunisticSweep();
  let config = await digestConfig.getDigestConfig(clientId);
  config = mergeCompatInclude(config, await readRawDigestInclude(clientId));
  const homeClientId = config.homeClientId || clientId;
  let docs = [];
  if (homeClientId) {
    try {
      const result = await digestConfig.getRecentDocsText({ clientId: homeClientId, count: config.recentDocsCount, maxChars: config.maxDocChars });
      docs = result.docs;
    } catch { docs = []; }
  }
  let clients = [];
  try { clients = await digestConfig.listSelectableClients(); } catch { clients = []; }
  clients = await enrichClientsWithMarketInsights(clients);
  const marketInsights = await getMarketInsightPlatformState(homeClientId);
  let ownerEmail = '';
  try {
    const cSnap = await fb.adminDb.collection('clients').doc(clientId).get();
    ownerEmail = cSnap.exists ? (cSnap.data()?.ownerEmail || '') : '';
  } catch { /* placeholder only — non-fatal */ }
  return json({ ok: true, clientId, homeClientId, config, docs, clients, marketInsights, ownerEmail });
}

// ── action: status — delivery record + circuit-breaker state + last cron stamps ──
async function handleStatus(body) {
  const clientId = String(body.clientId || '').trim();
  if (!clientId) return json({ error: 'clientId is required.' }, 400);
  const dateKey = String(body.dateKey || '').trim() || digestDelivery.localDateKey(Date.now(), await clientDigestTimeZone(clientId));
  const deliveryId = digestDelivery.buildDeliveryId(clientId, dateKey);
  const [delivery, breaker, configSnap] = await Promise.all([
    digestDelivery.getDelivery(deliveryId),
    digestBreaker.getBreakerState(clientId),
    // Cron stamps (lastCronRefresh*/lastCronSend*, written by stampCronRun)
    // aren't part of getDigestConfig's curated shape — read the raw doc
    // directly rather than widen that shared contract for an operator-panel-
    // only need.
    fb.adminDb.collection('digest_config').doc(clientId).get(),
  ]);
  const raw = configSnap.exists ? (configSnap.data() || {}) : {};
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
    lastRefresh: { at: raw.lastCronRefreshAt || null, status: raw.lastCronRefreshStatus || null, reason: raw.lastCronRefreshReason || null },
    lastSend: { at: raw.lastCronSendAt || null, status: raw.lastCronSendStatus || null, reason: raw.lastCronSendReason || null },
  });
}

// ── action: retry — reuse the stored render, replay transport only ────────
async function handleRetry(body) {
  const clientId = String(body.clientId || '').trim();
  if (!clientId) return json({ error: 'clientId is required.' }, 400);
  const explicitId = String(body.deliveryId || '').trim();
  const dateKey = String(body.dateKey || '').trim() || digestDelivery.localDateKey(Date.now(), await clientDigestTimeZone(clientId));
  const deliveryId = explicitId || digestDelivery.buildDeliveryId(clientId, dateKey);
  const outcome = await digestDelivery.retryDeliveryNow(deliveryId, { sendFn: digestSendFn });
  return json({ ok: Boolean(outcome.ok || outcome.alreadySent), deliveryId, outcome });
}

// ── action: reset-breaker — only when transport is actually healthy ───────
async function handleResetBreaker(body, actorUid) {
  const clientId = String(body.clientId || '').trim();
  if (!clientId) return json({ error: 'clientId is required.' }, 400);
  if (!hasResendKey()) {
    return json({ error: 'Cannot reset: RESEND_API_KEY is not configured, so the transport is still unhealthy.' }, 409);
  }
  const state = await digestBreaker.resetBreaker(clientId, { actorUid });
  return json({ ok: true, clientId, breaker: state });
}

// ── action: preview / send-now — facade over the existing daily-digest route ──
/** Forward the caller's own admin bearer token to daily-digest, same-origin.
 *  Never reimplements rendering or sending — this only translates a clean
 *  POST body into that route's existing GET query contract. */
async function forwardToLegacyDigestRoute(request, searchParams) {
  const target = new URL('/api/admin/daily-digest', digestSelfOrigin());
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined || value === null || value === '') continue;
    target.searchParams.set(key, String(value));
  }
  const authorization = getHeaderValue(request.headers, 'authorization');
  const res = await fetch(target, {
    headers: authorization ? { authorization, 'cache-control': 'no-store' } : { 'cache-control': 'no-store' },
    cache: 'no-store',
    redirect: 'error',
  });
  const contentType = String(res.headers?.get?.('content-type') || '');
  if (!contentType.toLowerCase().includes('application/json')) {
    return json({ error: `Legacy digest route returned a non-JSON response (HTTP ${res.status})` }, 502);
  }
  const body = await res.json().catch(() => null);
  if (body === null) return json({ error: 'Legacy digest route returned unparseable JSON.' }, 502);
  return NextResponse.json(body, { status: res.status, headers: { 'cache-control': 'no-store' } });
}

async function handlePreview(request, body) {
  const clientId = String(body.clientId || '').trim();
  const searchParams = {
    preview: body.mode === 'live' ? '1' : 'template',
    clientId,
    include: Array.isArray(body.includeKeys) ? body.includeKeys.join(',') : undefined,
    contactUrl: body.contactUrl,
    order: Array.isArray(body.order) ? body.order.join(',') : undefined,
    posts: Array.isArray(body.postPlatforms) ? body.postPlatforms.join(',') : undefined,
    demo: Array.isArray(body.demoGroups) ? body.demoGroups.join(',') : undefined,
    noLlm: body.noLlm ? '1' : undefined,
  };
  return forwardToLegacyDigestRoute(request, searchParams);
}

async function handleSendNow(request, body) {
  const clientId = String(body.clientId || '').trim();
  const searchParams = {
    send: '1',
    clientId,
    // Saved-data default (this action never refreshes) — skipRefresh is
    // already the legacy route's own no-op inline-refresh flag; kept
    // explicit here so intent reads clearly at this call site too.
    skipRefresh: '1',
    freshnessToken: body.freshnessToken,
    requestId: body.requestId,
  };
  return forwardToLegacyDigestRoute(request, searchParams);
}

async function handle(request) {
  let decoded;
  try {
    decoded = await verifyAdminRequest(buildAuthRequestShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Forbidden.' }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Request body must be JSON.' }, 400);
  }
  const action = String(body?.action || '').trim();

  try {
    switch (action) {
      case 'config': return await handleConfig(body);
      case 'status': return await handleStatus(body);
      case 'retry': return await handleRetry(body);
      case 'reset-breaker': return await handleResetBreaker(body, decoded?.uid || null);
      case 'preview': return await handlePreview(request, body);
      case 'send-now': return await handleSendNow(request, body);
      default: return json({ error: `Unknown action "${action}". Expected one of: config, status, retry, reset-breaker, preview, send-now.` }, 400);
    }
  } catch (err) {
    return json({ error: err.message || `Action "${action}" failed.` }, 500);
  }
}

export async function POST(request) { return handle(request); }
