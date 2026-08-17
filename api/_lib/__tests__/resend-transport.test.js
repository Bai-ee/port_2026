'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyResendResponse, sendViaResend, IDEMPOTENT_PAYLOAD_MISMATCH_ERROR, IDEMPOTENT_CONCURRENT_ERROR } = require('../resend-transport.cjs');

// ── classifyResendResponse (pure) ───────────────────────────────────────────

test('classifies a 2xx response with a top-level id as accepted', () => {
  const result = classifyResendResponse({ status: 200, bodyText: JSON.stringify({ id: 'em_123' }) });
  assert.equal(result.ok, true);
  assert.equal(result.id, 'em_123');
  assert.equal(result.httpStatus, 200);
});

test('classifies a 2xx response with a NESTED data.id as accepted (defensive response-shape support)', () => {
  // The Aug 15/16 incident: the old code only checked the top-level `.id`.
  // If Resend ever answers with the id nested (as its own batch endpoint
  // does), the old code silently treated a genuine accept as a failure.
  const result = classifyResendResponse({ status: 200, bodyText: JSON.stringify({ data: { id: 'em_456' } }) });
  assert.equal(result.ok, true);
  assert.equal(result.id, 'em_456');
});

test('classifies a malformed 2xx (no id anywhere) as a RETRYABLE failure, never a silent success', () => {
  const result = classifyResendResponse({ status: 200, bodyText: JSON.stringify({ status: 'queued' }) });
  assert.equal(result.ok, false);
  assert.equal(result.retryable, true);
  assert.equal(result.errorCode, 'malformed-2xx');
  assert.match(result.reason, /no id field/);
});

test('classifies a non-JSON / empty 2xx body as a retryable malformed response', () => {
  const empty = classifyResendResponse({ status: 200, bodyText: '' });
  assert.equal(empty.ok, false);
  assert.equal(empty.retryable, true);

  const nonJson = classifyResendResponse({ status: 202, bodyText: '<html>not json</html>' });
  assert.equal(nonJson.ok, false);
  assert.equal(nonJson.retryable, true);
  assert.match(nonJson.reason, /non-JSON/);
});

test('classifies 400 as a PERMANENT (non-retryable) failure', () => {
  const result = classifyResendResponse({ status: 400, bodyText: JSON.stringify({ message: 'Invalid `to` field', name: 'validation_error' }) });
  assert.equal(result.ok, false);
  assert.equal(result.retryable, false);
  assert.equal(result.errorCode, 'validation_error');
});

test('classifies 401/403/404/422 as permanent failures', () => {
  for (const status of [401, 403, 404, 422]) {
    const result = classifyResendResponse({ status, bodyText: JSON.stringify({ message: 'nope' }) });
    assert.equal(result.retryable, false, `status ${status} should be non-retryable`);
  }
});

test('classifies 429 as retryable', () => {
  const result = classifyResendResponse({ status: 429, bodyText: JSON.stringify({ message: 'rate limited' }) });
  assert.equal(result.ok, false);
  assert.equal(result.retryable, true);
});

test('classifies 500-599 as retryable', () => {
  for (const status of [500, 502, 503]) {
    const result = classifyResendResponse({ status, bodyText: '' });
    assert.equal(result.retryable, true, `status ${status} should be retryable`);
  }
});

// ── 409 idempotency-key semantics (verified against Resend's own docs, 2026-08-17) ──

test('classifies 409 concurrent_idempotent_requests as retryable — the in-progress original just hasn\'t resolved yet', () => {
  const result = classifyResendResponse({ status: 409, bodyText: JSON.stringify({ name: IDEMPOTENT_CONCURRENT_ERROR, message: 'in progress' }) });
  assert.equal(result.ok, false);
  assert.equal(result.retryable, true);
  assert.equal(result.errorCode, IDEMPOTENT_CONCURRENT_ERROR);
});

test('classifies 409 invalid_idempotent_request as PERMANENT — the same key was reused with a different payload, a structural bug this system\'s immutability guarantee should prevent', () => {
  const result = classifyResendResponse({ status: 409, bodyText: JSON.stringify({ name: IDEMPOTENT_PAYLOAD_MISMATCH_ERROR, message: 'payload mismatch' }) });
  assert.equal(result.ok, false);
  assert.equal(result.retryable, false);
  assert.equal(result.errorCode, IDEMPOTENT_PAYLOAD_MISMATCH_ERROR);
});

test('an unrecognized 409 shape defaults to retryable (safe default)', () => {
  const result = classifyResendResponse({ status: 409, bodyText: JSON.stringify({ name: 'some_future_error' }) });
  assert.equal(result.retryable, true);
});

// ── responseKeys observability (status/keys only, never values) ────────────

test('every classified outcome carries responseKeys (KEYS only) for observability, success or failure', () => {
  const success = classifyResendResponse({ status: 200, bodyText: JSON.stringify({ id: 'em_1', from: 'secret@internal.example' }) });
  assert.deepEqual(success.responseKeys, ['id', 'from']);
  assert.equal(JSON.stringify(success).includes('secret@internal.example'), false, 'a response VALUE must never leak into the classified result');

  const failure = classifyResendResponse({ status: 400, bodyText: JSON.stringify({ message: 'bad', name: 'validation_error' }) });
  assert.deepEqual(failure.responseKeys, ['message', 'name']);
});

test('classifies a network/timeout error as retryable', () => {
  const result = classifyResendResponse({ status: 0, bodyText: null, networkError: new Error('fetch failed: timeout') });
  assert.equal(result.ok, false);
  assert.equal(result.retryable, true);
  assert.equal(result.errorCode, 'network-error');
});

// ── sendViaResend (fetch injected — no real network call) ──────────────────

test('sendViaResend sends the Idempotency-Key header and returns the classified success', async () => {
  let capturedHeaders = null;
  let capturedBody = null;
  const fetchImpl = async (url, opts) => {
    capturedHeaders = opts.headers;
    capturedBody = JSON.parse(opts.body);
    return { status: 200, text: async () => JSON.stringify({ id: 'em_789' }) };
  };
  const result = await sendViaResend({
    apiKey: 'fake-key', from: 'a@b.com', to: 'c@d.com', subject: 'hi', html: '<p>hi</p>',
    idempotencyKey: 'client__2026-08-16', fetchImpl,
  });
  assert.equal(result.ok, true);
  assert.equal(result.id, 'em_789');
  assert.equal(capturedHeaders['Idempotency-Key'], 'client__2026-08-16');
  assert.deepEqual(capturedBody.to, ['c@d.com']);
});

test('sendViaResend skips (never retryable) when no API key is configured', async () => {
  const result = await sendViaResend({ apiKey: '', from: 'a@b.com', to: 'c@d.com', subject: 'hi', html: '<p>hi</p>', idempotencyKey: 'k' });
  assert.equal(result.ok, false);
  assert.equal(result.retryable, false);
  assert.equal(result.skipped, true);
});

test('sendViaResend requires an idempotencyKey', async () => {
  const result = await sendViaResend({ apiKey: 'fake-key', from: 'a@b.com', to: 'c@d.com', subject: 'hi', html: '<p>hi</p>' });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'missing-idempotency-key');
});

test('sendViaResend catches a fetch throw as a network-error result, never throws itself', async () => {
  const fetchImpl = async () => { throw new Error('ECONNRESET'); };
  const result = await sendViaResend({
    apiKey: 'fake-key', from: 'a@b.com', to: 'c@d.com', subject: 'hi', html: '<p>hi</p>',
    idempotencyKey: 'k', fetchImpl,
  });
  assert.equal(result.ok, false);
  assert.equal(result.retryable, true);
  assert.equal(result.errorCode, 'network-error');
});
