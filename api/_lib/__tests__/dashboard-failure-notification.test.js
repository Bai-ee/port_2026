'use strict';

// Covers Phase 2 of docs/plans/DASHBOARD_CREATION_FAILURE_UX_CLAUDE_PLAN.md:
// the Bryan alert for a hard-gated dashboard-creation incident. Every case
// asserts notifyDashboardFailure() never throws and never leaks a secret
// into the outbound email — see the module's contract note.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  notifyDashboardFailure,
  resolveAlertRecipient,
  redactSecrets,
  buildEmailHtml,
} = require('../dashboard-failure-notification.cjs');

const BASE_INCIDENT = {
  clientId: 'client-a',
  runId: 'client-a-signup',
  publicCode: 'HIT-ABC123',
  publicStage: 'website_access',
  companyName: 'Rositas',
  ownerEmail: 'owner@rositas.com',
  websiteUrl: 'https://rositas.com',
  internalError: { message: 'ENOTFOUND rositas.com', stage: 'pipeline' },
  failedAt: '2026-08-26T00:00:00.000Z',
};

let originalApiKey;
let originalAlertEmail;
let originalDigestEmail;

beforeEach(() => {
  originalApiKey = process.env.RESEND_API_KEY;
  originalAlertEmail = process.env.DASHBOARD_FAILURE_ALERT_EMAIL;
  originalDigestEmail = process.env.DIGEST_EMAIL;
});

afterEach(() => {
  process.env.RESEND_API_KEY = originalApiKey;
  process.env.DASHBOARD_FAILURE_ALERT_EMAIL = originalAlertEmail;
  process.env.DIGEST_EMAIL = originalDigestEmail;
});

test('notifyDashboardFailure: not_configured when RESEND_API_KEY is absent, never calls sendFn', async () => {
  delete process.env.RESEND_API_KEY;
  let called = false;
  const result = await notifyDashboardFailure(BASE_INCIDENT, { sendFn: async () => { called = true; return { ok: true, id: 'x' }; } });
  assert.equal(result.status, 'not_configured');
  assert.ok(result.attemptedAt);
  assert.equal(called, false);
});

test('notifyDashboardFailure: sent when the transport reports ok:true', async () => {
  process.env.RESEND_API_KEY = 'test-key';
  let capturedArgs = null;
  const result = await notifyDashboardFailure(BASE_INCIDENT, {
    sendFn: async (args) => { capturedArgs = args; return { ok: true, id: 'email_123' }; },
  });
  assert.equal(result.status, 'sent');
  assert.equal(capturedArgs.idempotencyKey, `dashboard-failure:${BASE_INCIDENT.runId}`);
  assert.match(capturedArgs.subject, /Rositas/);
  assert.match(capturedArgs.subject, /HIT-ABC123/);
});

test('notifyDashboardFailure: failed (never throws) when the transport reports ok:false', async () => {
  process.env.RESEND_API_KEY = 'test-key';
  const result = await notifyDashboardFailure(BASE_INCIDENT, {
    sendFn: async () => ({ ok: false, retryable: true, reason: 'resend-500: provider down', errorCode: 'http-500' }),
  });
  assert.equal(result.status, 'failed');
});

test('notifyDashboardFailure: failed (never throws) when sendFn itself throws', async () => {
  process.env.RESEND_API_KEY = 'test-key';
  const result = await notifyDashboardFailure(BASE_INCIDENT, {
    sendFn: async () => { throw new Error('network exploded'); },
  });
  assert.equal(result.status, 'failed');
});

test('notifyDashboardFailure: recipient prefers DASHBOARD_FAILURE_ALERT_EMAIL, falls back to DIGEST_EMAIL, then the hardcoded default', () => {
  process.env.DASHBOARD_FAILURE_ALERT_EMAIL = 'alerts@example.com';
  process.env.DIGEST_EMAIL = 'digest@example.com';
  assert.equal(resolveAlertRecipient(), 'alerts@example.com');

  delete process.env.DASHBOARD_FAILURE_ALERT_EMAIL;
  assert.equal(resolveAlertRecipient(), 'digest@example.com');

  delete process.env.DIGEST_EMAIL;
  assert.equal(resolveAlertRecipient(), 'bryanballi@gmail.com');
});

test('redactSecrets: strips bearer tokens and long opaque keys', () => {
  // A "Bearer <token>" match consumes the whole token first, regardless of
  // its shape — the [redacted-key] label only shows for a bare key with no
  // preceding "Bearer ".
  assert.equal(redactSecrets('Authorization failed: Bearer sk-ant-abcdefghijklmnop123456'), 'Authorization failed: Bearer [redacted]');
  assert.equal(redactSecrets('API key sk-ant-abcdefghijklmnop123456 rejected'), 'API key [redacted-key] rejected');
  assert.ok(!redactSecrets('token=aVeryLongOpaqueApiKeyThatLooksLikeASecret1234567890').includes('aVeryLongOpaqueApiKeyThatLooksLikeASecret1234567890'));
});

test('buildEmailHtml: includes the admin-visible internal error but redacts secret-shaped substrings within it', () => {
  const html = buildEmailHtml({
    ...BASE_INCIDENT,
    internalError: { message: 'Auth failed with Bearer sk-ant-supersecretvalue1234567890', stage: 'pipeline' },
  });
  assert.match(html, /Auth failed with Bearer \[redacted\]/);
  assert.ok(!html.includes('sk-ant-supersecretvalue1234567890'));
  assert.match(html, /HIT-ABC123/);
  assert.match(html, /rositas\.com/);
});

test('buildEmailHtml: escapes HTML in attacker-controlled-ish fields (company name, website URL)', () => {
  const html = buildEmailHtml({
    ...BASE_INCIDENT,
    companyName: '<script>alert(1)</script>',
    websiteUrl: 'https://example.com/"><img src=x onerror=alert(1)>',
  });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
});
