'use strict';

// resend-transport.cjs — a single, honest classification of what Resend's API
// actually returned, shared by the first send attempt AND every retry.
//
// Root-cause fix (2026-08-16 incident, see docs/source-of-truth/
// EMAIL-DIGEST-CARD.md's incident checkpoint): the old call site in
// daily-digest/route.js only ever checked `emailResult.id` at the TOP level
// of the parsed JSON body. Any 2xx response whose id was nested (or simply
// shaped differently than expected) was silently treated as "no id
// returned" and the digest was marked failed even though Resend accepted
// it — with no retry, no record of what actually came back, and no signal
// beyond a runtime log that expires within about an hour on Vercel Hobby.
//
// classifyResendResponse() is pure (no network I/O) so the response-shape
// logic is fully unit-testable without hitting the real API.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DEFAULT_TIMEOUT_MS = 15_000;

// Permanent, caller-error statuses — retrying without changing the request
// wastes a call and, worse, can look like abuse to the provider.
const PERMANENT_STATUSES = new Set([400, 401, 403, 404, 422]);

// Verified against Resend's own idempotency-key docs (resend.com/docs/
// dashboard/emails/idempotency-keys, checked 2026-08-17): a duplicate
// request under the SAME key with a DIFFERENT payload 409s with this exact
// error name. That is a structural bug signal, not a transient condition —
// this system's payload-immutability guarantee (digest-delivery.cjs's
// storeRenderedHtml never overwrites an existing render) means it should
// never legitimately happen; if it ever does, retrying with the same
// key+payload cannot fix it, so it is treated as permanent.
const IDEMPOTENT_PAYLOAD_MISMATCH_ERROR = 'invalid_idempotent_request';
// A genuinely concurrent duplicate under the same key also 409s, but with
// THIS error name — that one is transient (the in-progress request just
// hasn't resolved yet) and safe to retry.
const IDEMPOTENT_CONCURRENT_ERROR = 'concurrent_idempotent_requests';

function extractEmailId(body) {
  if (!body || typeof body !== 'object') return null;
  if (typeof body.id === 'string' && body.id) return body.id;
  // Defensive: Resend's batch endpoint (and some idempotent-replay shapes)
  // nest the id under `data`. Accepting it here is defensive response-shape
  // support; the historical provider body expired from logs, so this shape
  // is not claimed as the proven incident root cause.
  if (body.data && typeof body.data === 'object' && typeof body.data.id === 'string' && body.data.id) {
    return body.data.id;
  }
  return null;
}

/**
 * @param {object} args
 * @param {number} args.status       HTTP status code (0 for a network/timeout failure)
 * @param {string|null} args.bodyText  raw response text (may be empty / non-JSON)
 * @param {Error|null} [args.networkError]  set instead of status/bodyText on a fetch throw
 * @returns {{ ok: boolean, id?: string, retryable: boolean, reason?: string, errorCode?: string, httpStatus: number|null, detail?: string }}
 */
function classifyResendResponse({ status, bodyText, networkError = null }) {
  if (networkError) {
    return {
      ok: false,
      retryable: true,
      reason: 'network-error',
      errorCode: 'network-error',
      httpStatus: null,
      responseKeys: null,
      detail: networkError.message || String(networkError),
    };
  }

  let body = null;
  let parseError = null;
  if (bodyText) {
    try { body = JSON.parse(bodyText); } catch (err) { parseError = err.message; }
  }
  // Observability: the KEYS present in the response, never the values — used
  // to diagnose an unexpected shape without ever logging recipient content
  // or provider secrets.
  const responseKeys = body && typeof body === 'object' ? Object.keys(body) : null;

  if (status >= 200 && status < 300) {
    const id = extractEmailId(body);
    if (id) return { ok: true, id, httpStatus: status, responseKeys };
    // 2xx but no id anywhere we know to look — a malformed success, not a
    // rejection. Always retryable: a retry against the SAME idempotency key
    // is safe (Resend returns the original result for a duplicate key with
    // the SAME payload, it never sends a second email — see the module
    // header), and far more likely to reveal a response shape we
    // mis-parsed than a duplicate delivery.
    return {
      ok: false,
      retryable: true,
      httpStatus: status,
      reason: parseError
        ? `malformed-response: non-JSON 2xx body (${parseError})`
        : 'malformed-response: 2xx with no id field',
      errorCode: 'malformed-2xx',
      responseKeys,
      detail: responseKeys ? responseKeys.join(',') : (bodyText ? bodyText.slice(0, 200) : '(empty body)'),
    };
  }

  const errorCode = body?.name || body?.error?.type || body?.type || `http-${status}`;
  const message = body?.message || body?.error?.message || (bodyText ? bodyText.slice(0, 200) : `HTTP ${status}`);

  // 409 splits into two distinct Resend error names (verified against
  // Resend's idempotency-key docs, 2026-08-17): a genuinely concurrent
  // duplicate is transient; a payload mismatch under a reused key is a
  // structural bug this system's immutability guarantee should prevent —
  // if it ever fires anyway, retrying the same key+payload cannot help.
  if (status === 409) {
    if (errorCode === IDEMPOTENT_PAYLOAD_MISMATCH_ERROR) {
      return { ok: false, retryable: false, httpStatus: status, reason: `resend-409: ${message}`, errorCode, responseKeys };
    }
    // concurrent_idempotent_requests, or an unrecognized 409 shape — treat
    // as transient by the same safe-default rule as any other unknown status.
    return { ok: false, retryable: true, httpStatus: status, reason: `resend-409: ${message}`, errorCode, responseKeys };
  }

  if (PERMANENT_STATUSES.has(status)) {
    return { ok: false, retryable: false, httpStatus: status, reason: `resend-${status}: ${message}`, errorCode, responseKeys };
  }
  // 429 and 5xx (and any other unexpected status) are transient by default —
  // a durable delivery system must never silently drop a paid-for email
  // because of an unrecognized status code.
  return { ok: false, retryable: true, httpStatus: status, reason: `resend-${status}: ${message}`, errorCode, responseKeys };
}

/**
 * Send one email through Resend with a deterministic Idempotency-Key. Never
 * throws — every outcome (including a network failure) comes back as a
 * classified result so callers never need try/catch for control flow.
 */
async function sendViaResend({ apiKey, from, to, subject, html, idempotencyKey, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!apiKey) {
    return { ok: false, retryable: false, skipped: true, reason: 'RESEND_API_KEY not configured', errorCode: 'not-configured', httpStatus: null };
  }
  if (!idempotencyKey) {
    return { ok: false, retryable: false, reason: 'idempotencyKey is required for a durable send', errorCode: 'missing-idempotency-key', httpStatus: null };
  }

  let res;
  try {
    res = await fetchImpl(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ from, to: Array.isArray(to) ? to : [to], subject, html }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
  } catch (err) {
    return classifyResendResponse({ status: 0, bodyText: null, networkError: err });
  }

  let bodyText = '';
  try { bodyText = await res.text(); } catch { /* empty/unreadable body — classifier treats it as such */ }
  return classifyResendResponse({ status: res.status, bodyText });
}

module.exports = {
  classifyResendResponse,
  sendViaResend,
  extractEmailId,
  RESEND_ENDPOINT,
  IDEMPOTENT_PAYLOAD_MISMATCH_ERROR,
  IDEMPOTENT_CONCURRENT_ERROR,
};
