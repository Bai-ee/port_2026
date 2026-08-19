'use strict';

// digest-self-origin.cjs — origin + response contract for the digest crons'
// self-fan-out sub-requests (daily-digest send fan-out, pre-digest-refresh
// dispatch, delivery-sweep generation reclaim).
//
// WHY THIS EXISTS (2026-08-18 root cause): this Vercel project runs SSO
// Deployment Protection with deploymentType "all_except_custom_domains", so
// every *.vercel.app host of the project 302s to vercel.com/sso-api BEFORE the
// app runs. The scheduled cron invocation itself bypasses protection (Vercel
// signs it), but the dispatchers used to re-enter the route at `url.origin` —
// the protected host the cron request carried — so every per-client
// sub-request landed on the vercel.com login page (final HTTP 200, text/html)
// instead of the app. The refresh dispatcher read that login page as "ok";
// the send dispatcher stamped it "Email provider did not return an id.".
// Production scheduled sends never ran. See docs/plans/EMAIL-REBUILD-PLAN.md §1.
//
// Rules enforced here:
//  1. Self-requests ALWAYS target an explicit unprotected origin: env override
//     first, then the custom production domain. NEVER `url.origin`, NEVER
//     VERCEL_URL (both are protected hosts under the current setting).
//  2. Self-requests set `redirect: 'error'` — a protection/SSO redirect must
//     fail loudly, never be silently followed to a 200 login page.
//  3. A sub-response only counts as executed when it is real JSON; anything
//     else reports an honest reason naming the HTTP status + content type.

const DEFAULT_PRODUCTION_ORIGIN = 'https://hitloop.agency';

/** Origin for cron/worker self-requests. Env override → custom prod domain. */
function digestSelfOrigin() {
  const raw =
    process.env.DIGEST_SELF_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.PUBLIC_APP_URL ||
    process.env.APP_URL ||
    DEFAULT_PRODUCTION_ORIGIN;
  return String(raw).trim().replace(/\/+$/, '');
}

/** Auth headers a dispatcher forwards to its own worker sub-requests. */
function workerAuthHeaders() {
  const headers = { 'cache-control': 'no-store' };
  if (process.env.CRON_SECRET) headers.authorization = `Bearer ${process.env.CRON_SECRET}`;
  else if (process.env.WORKER_SECRET) headers['x-worker-secret'] = process.env.WORKER_SECRET;
  return headers;
}

/**
 * Fetch a worker sub-request and enforce the JSON contract.
 * Never throws. Returns:
 *   { executed: true,  status, body }                    — real JSON came back
 *   { executed: false, status?, contentType?, reason }   — anything else
 */
async function fetchWorkerJson(targetUrl, { headers = {}, fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(String(targetUrl), {
      headers: { ...workerAuthHeaders(), ...headers },
      cache: 'no-store',
      redirect: 'error', // an SSO/protection redirect is a hard failure, not a page to follow
    });
  } catch (err) {
    return { executed: false, reason: `sub-request failed: ${err.message}` };
  }
  const contentType = String(res.headers?.get?.('content-type') || '');
  if (!contentType.toLowerCase().includes('application/json')) {
    return {
      executed: false,
      status: res.status,
      contentType,
      reason: `sub-request returned HTTP ${res.status} (${contentType || 'no content-type'}) — route did not execute`,
    };
  }
  let body;
  try {
    body = await res.json();
  } catch (err) {
    return {
      executed: false,
      status: res.status,
      contentType,
      reason: `sub-request returned HTTP ${res.status} with unparseable JSON: ${err.message}`,
    };
  }
  return { executed: true, status: res.status, body };
}

// ── Stamp-entry builders ─────────────────────────────────────────────────────
// One place that decides what a dispatcher records about a sub-request, so the
// rules are testable: an empty/foreign JSON body is a FAILURE (never "ok"),
// and the child's body can never overwrite the dispatcher's trusted fields
// (clientId / status / ok / reason are computed HERE, after any spread).

function phaseWord(r) {
  return r?.ok ? 'ok' : (r?.skipped ? 'skipped' : 'failed');
}

/** Refresh fan-out: success requires an explicit `ok: true` from the child. */
function buildRefreshStampEntry(clientId, sub) {
  if (!sub?.executed) {
    return { clientId, status: sub?.status || null, ok: false, reason: sub?.reason || 'sub-request did not execute' };
  }
  const body = sub.body && typeof sub.body === 'object' ? sub.body : {};
  const looksLikeRefresh = body.ok !== undefined || body.scout !== undefined;
  const phases = `scout:${phaseWord(body.scout)} watchlist:${phaseWord(body.watchlist)} strategy:${phaseWord(body.strategy)} summary:${phaseWord(body.executiveSummary)}`;
  return {
    ...body,
    clientId,
    status: sub.status,
    ok: sub.status >= 200 && sub.status < 300 && body.ok === true,
    skipped: body.skipped === true,
    reason: body.error || body.reason
      || (looksLikeRefresh ? phases : `sub-request HTTP ${sub.status} returned unrecognized JSON`),
  };
}

/** Send fan-out: success requires a provider email id from the child. */
function buildSendStampEntry(clientId, sub) {
  if (!sub?.executed) {
    return { clientId, status: sub?.status || null, ok: false, reason: sub?.reason || 'sub-request did not execute', error: sub?.reason || null, emailId: null };
  }
  const body = sub.body && typeof sub.body === 'object' ? sub.body : {};
  const emailSkipped = body?.email?.skipped === true || body?.emailSkipped === true;
  const emailId = body?.email?.id || null;
  return {
    clientId,
    status: sub.status,
    ok: sub.status >= 200 && sub.status < 300 && body?.ok !== false && !emailSkipped && Boolean(emailId),
    skipped: body?.skipped === true || emailSkipped,
    reason: body?.reason || body?.email?.reason || body?.error
      || (!emailId ? `sub-request HTTP ${sub.status} answered without a provider email id` : null),
    error: body?.error || null,
    emailId,
    deliveryId: body?.delivery?.id || null,
  };
}

module.exports = {
  DEFAULT_PRODUCTION_ORIGIN,
  digestSelfOrigin,
  workerAuthHeaders,
  fetchWorkerJson,
  buildRefreshStampEntry,
  buildSendStampEntry,
};
