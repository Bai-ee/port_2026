'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const breaker = require('../digest-circuit-breaker.cjs');
const digestDelivery = require('../digest-delivery.cjs');
const { checkDigestRefreshPreflight } = require('../digest-refresh-preflight.cjs');
const { makeFakeContext } = require('./fake-firestore.cjs');

let fakeCtx;
let savedKillSwitch;
let savedResendKey;

beforeEach(() => {
  fakeCtx = makeFakeContext();
  breaker.__setTestContext(fakeCtx);
  digestDelivery.__setTestContext(fakeCtx);
  savedKillSwitch = process.env.DIGEST_REFRESH_KILL_SWITCH;
  savedResendKey = process.env.RESEND_API_KEY;
  delete process.env.DIGEST_REFRESH_KILL_SWITCH;
  process.env.RESEND_API_KEY = 'fake-resend-key';
});

afterEach(() => {
  breaker.__setTestContext(null);
  digestDelivery.__setTestContext(null);
  if (savedKillSwitch === undefined) delete process.env.DIGEST_REFRESH_KILL_SWITCH; else process.env.DIGEST_REFRESH_KILL_SWITCH = savedKillSwitch;
  if (savedResendKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = savedResendKey;
});

async function recordCurrentSendAttempt(deliveryId, result) {
  const current = await digestDelivery.getDelivery(deliveryId);
  return digestDelivery.recordSendAttempt(deliveryId, result, { leaseOwner: current?.sendLeaseOwner || null });
}

test('passes when transport is configured, breaker is clear, kill switch is off, and no unresolved prior delivery exists', async () => {
  const result = await checkDigestRefreshPreflight('c1');
  assert.equal(result.ok, true);
  assert.equal(result.reason, null);
});

test('blocks refresh when the global kill switch is set — checked BEFORE any client-specific state', async () => {
  process.env.DIGEST_REFRESH_KILL_SWITCH = '1';
  const result = await checkDigestRefreshPreflight('c1');
  assert.equal(result.ok, false);
  assert.match(result.reason, /kill-switch-enabled/);
});

test('blocks refresh when RESEND_API_KEY is missing — no paid work for an email that can never be delivered', async () => {
  delete process.env.RESEND_API_KEY;
  const result = await checkDigestRefreshPreflight('c1');
  assert.equal(result.ok, false);
  assert.match(result.reason, /transport-not-configured/);
});

test('blocks refresh when the client\'s delivery breaker is paused, and surfaces the breaker\'s own reason', async () => {
  for (let i = 0; i < breaker.THRESHOLD; i++) {
    // eslint-disable-next-line no-await-in-loop
    await breaker.recordDeliveryOutcome('paused-client', { ok: false });
  }
  const result = await checkDigestRefreshPreflight('paused-client');
  assert.equal(result.ok, false);
  assert.match(result.reason, /consecutive delivery failures/);
});

test('a paused client does not block a DIFFERENT, healthy client', async () => {
  for (let i = 0; i < breaker.THRESHOLD; i++) {
    // eslint-disable-next-line no-await-in-loop
    await breaker.recordDeliveryOutcome('paused-client', { ok: false });
  }
  const healthy = await checkDigestRefreshPreflight('healthy-client');
  assert.equal(healthy.ok, true);
});

test('blocks refresh when an OLDER delivery for this client is still unresolved (retrying / mid-send) — test #11', async () => {
  const delivery = await digestDelivery.getOrCreateDelivery({ clientId: 'stuck-client', dateKey: '2026-08-16' });
  await digestDelivery.storeRenderedHtml(delivery.id, { html: '<p>x</p>', subject: 's', recipient: 'r@r.com' });
  await digestDelivery.claimForSend(delivery.id);
  await recordCurrentSendAttempt(delivery.id, { ok: false, retryable: true, reason: 'boom', httpStatus: 500 });
  const result = await checkDigestRefreshPreflight('stuck-client');
  assert.equal(result.ok, false);
  assert.match(result.reason, /unresolved prior delivery/);
});

test('excludeDeliveryId ignores only the exact delivery, never every same-day attempt', async () => {
  const delivery = await digestDelivery.getOrCreateDelivery({ clientId: 'c1', dateKey: '2026-08-17' });
  await digestDelivery.storeRenderedHtml(delivery.id, { html: '<p>x</p>', subject: 's', recipient: 'r@r.com' });
  await digestDelivery.claimForSend(delivery.id);
  await recordCurrentSendAttempt(delivery.id, { ok: false, retryable: true, reason: 'boom', httpStatus: 500 });
  const exact = await checkDigestRefreshPreflight('c1', { excludeDeliveryId: delivery.id });
  assert.equal(exact.ok, true, 'the exact delivery may be excluded explicitly');

  const otherSameDayId = `${delivery.id}__manual-other`;
  const other = await digestDelivery.getOrCreateDelivery({ clientId: 'c1', dateKey: '2026-08-17', source: 'manual-admin', deliveryId: otherSameDayId });
  await digestDelivery.storeRenderedHtml(other.id, { html: '<p>other</p>', subject: 's', recipient: 'r@r.com' });
  await digestDelivery.claimForSend(other.id);
  await recordCurrentSendAttempt(other.id, { ok: false, retryable: true, reason: 'boom', httpStatus: 500 });
  const blocked = await checkDigestRefreshPreflight('c1', { excludeDeliveryId: delivery.id });
  assert.equal(blocked.ok, false, 'a different unresolved attempt from the same date must still block paid work');
});

test('allowUnresolvedPrior is an explicit override that bypasses the unresolved-prior-delivery block', async () => {
  const delivery = await digestDelivery.getOrCreateDelivery({ clientId: 'stuck-client', dateKey: '2026-08-16' });
  await digestDelivery.storeRenderedHtml(delivery.id, { html: '<p>x</p>', subject: 's', recipient: 'r@r.com' });
  await digestDelivery.claimForSend(delivery.id);
  await recordCurrentSendAttempt(delivery.id, { ok: false, retryable: true, reason: 'boom', httpStatus: 500 });
  const result = await checkDigestRefreshPreflight('stuck-client', { allowUnresolvedPrior: true });
  assert.equal(result.ok, true);
});

test('FAILS CLOSED (test #10): a broken breaker-state read blocks paid work rather than being silently treated as healthy', async () => {
  const brokenCtx = {
    adminDb: {
      collection: () => ({ doc: () => ({ get: async () => { throw new Error('simulated Firestore outage'); } }) }),
    },
    FieldValue: fakeCtx.FieldValue,
    adminStorage: fakeCtx.adminStorage,
  };
  breaker.__setTestContext(brokenCtx);
  const result = await checkDigestRefreshPreflight('c1');
  assert.equal(result.ok, false, 'an unreadable breaker state must block, never pass through');
  assert.match(result.reason, /breaker check failed/);
});

test('FAILS CLOSED (test #10): a broken unresolved-prior-delivery scan blocks paid work rather than being silently treated as healthy', async () => {
  const brokenDeliveryCtx = {
    adminDb: {
      collection: () => ({ where: () => ({ limit: () => ({ get: async () => { throw new Error('simulated Firestore outage'); } }) }) }),
    },
    FieldValue: fakeCtx.FieldValue,
    adminStorage: fakeCtx.adminStorage,
  };
  digestDelivery.__setTestContext(brokenDeliveryCtx);
  const result = await checkDigestRefreshPreflight('c1');
  assert.equal(result.ok, false, 'an unreadable delivery scan must block, never pass through');
  assert.match(result.reason, /unresolved-prior-delivery check failed/);
});

test('repeated provider failure prevents the NEXT paid morning refresh (test #11, end to end)', async () => {
  // Simulate three consecutive fully-resolved delivery failures for the
  // same client (each day's send exhausts retries and terminal-fails).
  for (let day = 1; day <= breaker.THRESHOLD; day++) {
    const dateKey = `2026-08-1${day}`;
    // eslint-disable-next-line no-await-in-loop
    const delivery = await digestDelivery.getOrCreateDelivery({ clientId: 'flaky-client', dateKey });
    // eslint-disable-next-line no-await-in-loop
    await digestDelivery.storeRenderedHtml(delivery.id, { html: '<p>x</p>', subject: 's', recipient: 'r@r.com' });
    // eslint-disable-next-line no-await-in-loop
    await digestDelivery.claimForSend(delivery.id);
    // eslint-disable-next-line no-await-in-loop
    await recordCurrentSendAttempt(delivery.id, { ok: false, retryable: false, reason: 'boom', httpStatus: 400 });
  }
  const nextMorning = await checkDigestRefreshPreflight('flaky-client');
  assert.equal(nextMorning.ok, false, 'three consecutive terminal delivery failures must block the next morning\'s paid refresh');
});

test('successful retry resets the breaker (test #12)', async () => {
  await breaker.recordDeliveryOutcome('c1', { ok: false });
  await breaker.recordDeliveryOutcome('c1', { ok: false });
  let state = await breaker.getBreakerState('c1');
  assert.equal(state.consecutiveFailures, 2);
  await breaker.recordDeliveryOutcome('c1', { ok: true });
  state = await breaker.getBreakerState('c1');
  assert.equal(state.consecutiveFailures, 0);
  const result = await checkDigestRefreshPreflight('c1');
  assert.equal(result.ok, true);
});
