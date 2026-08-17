'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const breaker = require('../digest-circuit-breaker.cjs');
const { makeFakeContext } = require('./fake-firestore.cjs');

let fakeCtx;
let savedKillSwitchEnv;

beforeEach(() => {
  fakeCtx = makeFakeContext();
  breaker.__setTestContext(fakeCtx);
  savedKillSwitchEnv = process.env.DIGEST_REFRESH_KILL_SWITCH;
});

afterEach(() => {
  breaker.__setTestContext(null);
  if (savedKillSwitchEnv === undefined) delete process.env.DIGEST_REFRESH_KILL_SWITCH;
  else process.env.DIGEST_REFRESH_KILL_SWITCH = savedKillSwitchEnv;
});

test('getBreakerState defaults to not-paused, zero failures for a client with no config doc', async () => {
  const state = await breaker.getBreakerState('brand-new-client');
  assert.equal(state.consecutiveFailures, 0);
  assert.equal(state.pausedAt, null);
  assert.equal(await breaker.isRefreshPaused('brand-new-client'), false);
});

test('a successful delivery outcome resets the failure counter', async () => {
  await breaker.recordDeliveryOutcome('c1', { ok: false });
  await breaker.recordDeliveryOutcome('c1', { ok: false });
  let state = await breaker.recordDeliveryOutcome('c1', { ok: true });
  assert.equal(state.consecutiveFailures, 0);
  assert.equal(state.pausedAt, null);
});

test(`the breaker trips after ${3} consecutive delivery failures and pauses new refreshes`, async () => {
  await breaker.recordDeliveryOutcome('c1', { ok: false });
  assert.equal(await breaker.isRefreshPaused('c1'), false);
  await breaker.recordDeliveryOutcome('c1', { ok: false });
  assert.equal(await breaker.isRefreshPaused('c1'), false);
  const tripped = await breaker.recordDeliveryOutcome('c1', { ok: false });
  assert.equal(tripped.consecutiveFailures, breaker.THRESHOLD);
  assert.ok(tripped.pausedAt);
  assert.match(tripped.pausedReason, /Paid refresh paused after 3 consecutive delivery failures/);
  assert.equal(await breaker.isRefreshPaused('c1'), true);
});

test('concurrent breaker outcomes use a transaction and do not lose increments', async () => {
  await Promise.all([
    breaker.recordDeliveryOutcome('c1', { ok: false }),
    breaker.recordDeliveryOutcome('c1', { ok: false }),
  ]);
  const state = await breaker.getBreakerState('c1');
  assert.equal(state.consecutiveFailures, 2);
});

test('the breaker never mutates digest_config.schedule — only its own deliveryBreaker field', async () => {
  const docRef = fakeCtx.adminDb.collection('digest_config').doc('c1');
  await docRef.set({ schedule: { enabled: true, frequency: 'daily' } });
  for (let i = 0; i < breaker.THRESHOLD; i++) {
    // eslint-disable-next-line no-await-in-loop
    await breaker.recordDeliveryOutcome('c1', { ok: false });
  }
  const raw = (await docRef.get()).data();
  assert.deepEqual(raw.schedule, { enabled: true, frequency: 'daily' }, 'schedule.enabled must be untouched by the breaker tripping');
  assert.ok(raw.deliveryBreaker.pausedAt);
});

test('resetBreaker clears the paused state and records who reset it', async () => {
  for (let i = 0; i < breaker.THRESHOLD; i++) {
    // eslint-disable-next-line no-await-in-loop
    await breaker.recordDeliveryOutcome('c1', { ok: false });
  }
  assert.equal(await breaker.isRefreshPaused('c1'), true);
  const state = await breaker.resetBreaker('c1', { actorUid: 'admin-uid-1' });
  assert.equal(state.consecutiveFailures, 0);
  assert.equal(state.pausedAt, null);
  assert.equal(state.lastResetBy, 'admin-uid-1');
  assert.equal(await breaker.isRefreshPaused('c1'), false);
});

test('resetBreaker does not re-enable schedule.enabled — that is a separate, untouched field', async () => {
  const docRef = fakeCtx.adminDb.collection('digest_config').doc('c1');
  await docRef.set({ schedule: { enabled: false, frequency: 'off' } });
  for (let i = 0; i < breaker.THRESHOLD; i++) {
    // eslint-disable-next-line no-await-in-loop
    await breaker.recordDeliveryOutcome('c1', { ok: false });
  }
  await breaker.resetBreaker('c1');
  const raw = (await docRef.get()).data();
  assert.deepEqual(raw.schedule, { enabled: false, frequency: 'off' }, 'a breaker reset must never flip the user\'s own schedule toggle');
});

test('isGlobalKillSwitchEnabled defaults to normal operation (unset)', () => {
  delete process.env.DIGEST_REFRESH_KILL_SWITCH;
  assert.equal(breaker.isGlobalKillSwitchEnabled(), false);
});

test('isGlobalKillSwitchEnabled is true only for the exact value "1"', () => {
  process.env.DIGEST_REFRESH_KILL_SWITCH = '1';
  assert.equal(breaker.isGlobalKillSwitchEnabled(), true);
  process.env.DIGEST_REFRESH_KILL_SWITCH = 'true';
  assert.equal(breaker.isGlobalKillSwitchEnabled(), false, 'only the literal "1" trips the switch, to avoid truthy-string surprises');
  process.env.DIGEST_REFRESH_KILL_SWITCH = '0';
  assert.equal(breaker.isGlobalKillSwitchEnabled(), false);
});
