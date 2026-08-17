'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const digestDelivery = require('../digest-delivery.cjs');
const { makeFakeContext } = require('./fake-firestore.cjs');

let fakeCtx;

beforeEach(() => {
  fakeCtx = makeFakeContext();
  digestDelivery.__setTestContext(fakeCtx);
});

afterEach(() => {
  digestDelivery.__setTestContext(null);
});

function okSend(id = 'em_1') { return { ok: true, id, httpStatus: 200, responseKeys: ['id'] }; }
function retryableFail(reason = 'resend-500: boom') { return { ok: false, retryable: true, reason, httpStatus: 500, errorCode: 'resend-500', responseKeys: [] }; }
function permanentFail(reason = 'resend-400: bad request') { return { ok: false, retryable: false, reason, httpStatus: 400, errorCode: 'validation_error', responseKeys: ['message'] }; }

// Drives a delivery through the REAL stage path (scheduled -> ... ->
// delivery-pending -> sending) so tests exercise the same transition graph
// production code does.
async function primeForSending(deliveryId, { html = '<p>t</p>', subject = 's', recipient = 'r@r.com' } = {}) {
  await digestDelivery.storeRenderedHtml(deliveryId, { html, subject, recipient });
  return digestDelivery.claimForSend(deliveryId);
}

async function recordCurrentSendAttempt(deliveryId, result) {
  const current = await digestDelivery.getDelivery(deliveryId);
  return digestDelivery.recordSendAttempt(deliveryId, result, { leaseOwner: current?.sendLeaseOwner || null });
}

// Legitimately puts a delivery into `retry-wait` via one real failed send
// attempt (delivery-pending -> sending -> retry-wait), then optionally
// overrides nextRetryAt via the raw test backdoor purely to control timing.
async function primeIntoRetryWait(clientId, dateKey, { nextRetryAt } = {}) {
  const delivery = await digestDelivery.getOrCreateDelivery({ clientId, dateKey });
  await primeForSending(delivery.id);
  const updated = await recordCurrentSendAttempt(delivery.id, retryableFail());
  if (nextRetryAt) {
    fakeCtx.adminDb._patch(digestDelivery.COLLECTION, delivery.id, { nextRetryAt, dueSortKey: nextRetryAt });
  }
  return { id: delivery.id, ...updated, nextRetryAt: nextRetryAt || updated.nextRetryAt };
}

// ── Basic idempotent creation, transactional ────────────────────────────────

test('getOrCreateDelivery is idempotent per (clientId, dateKey) and transactional', async () => {
  const first = await digestDelivery.getOrCreateDelivery({ clientId: 'c1', dateKey: '2026-08-17' });
  assert.equal(first.stage, 'scheduled');
  await digestDelivery.markStage(first.id, 'refreshing');
  const second = await digestDelivery.getOrCreateDelivery({ clientId: 'c1', dateKey: '2026-08-17' });
  assert.equal(second.stage, 'refreshing', 'a second call must return the SAME record, not reset progress');
  assert.equal(second.id, first.id);
});

test('scheduled duplicate invocation stays idempotent end to end', async () => {
  const html = '<p>digest</p>';
  let sendCalls = 0;
  const sendFn = async () => { sendCalls += 1; return okSend('em_dup'); };

  async function runOnce() {
    const delivery = await digestDelivery.getOrCreateDelivery({ clientId: 'c1', dateKey: '2026-08-17', source: 'cron-scheduled' });
    await digestDelivery.storeRenderedHtml(delivery.id, { html, subject: 's', recipient: 'r@r.com' });
    return digestDelivery.sendFirstAttempt(delivery.id, sendFn);
  }

  const first = await runOnce();
  const second = await runOnce();
  assert.equal(sendCalls, 1, 'the transport must only ever be called once across two full duplicate invocations');
  assert.equal(first.ok, true);
  assert.equal(second.alreadySent, true);
  assert.equal(second.providerEmailId, 'em_dup');
});

// ── Stage-transition guard ──────────────────────────────────────────────────

test('a `sent` record can never regress to any other stage', async () => {
  const delivery = await digestDelivery.getOrCreateDelivery({ clientId: 'c1', dateKey: '2026-08-17' });
  await primeForSending(delivery.id);
  await recordCurrentSendAttempt(delivery.id, okSend('em_locked'));
  const attemptRegress = await digestDelivery.markStage(delivery.id, 'retry-wait', { nextRetryAt: new Date().toISOString() });
  assert.equal(attemptRegress.stage, 'sent', 'an illegal transition away from sent must be refused, not applied');
});

test('markStage refuses an out-of-order jump (e.g. scheduled straight to sending)', async () => {
  const delivery = await digestDelivery.getOrCreateDelivery({ clientId: 'c1', dateKey: '2026-08-17' });
  const blocked = await digestDelivery.markStage(delivery.id, 'sending');
  assert.equal(blocked.stage, 'scheduled', 'scheduled cannot jump directly to sending — delivery-pending must come first');
});

test('storeRenderedHtml is immutable — a second call for the same delivery never overwrites the stored render', async () => {
  const delivery = await digestDelivery.getOrCreateDelivery({ clientId: 'c1', dateKey: '2026-08-17' });
  await digestDelivery.storeRenderedHtml(delivery.id, { html: '<p>v1</p>', subject: 'Subject A', recipient: 'a@a.com' });
  await digestDelivery.storeRenderedHtml(delivery.id, { html: '<p>v2 — should never land</p>', subject: 'Subject B', recipient: 'b@b.com' });
  const loaded = await digestDelivery.loadRenderedHtml(delivery.id);
  assert.equal(loaded.html, '<p>v1</p>');
  assert.equal(loaded.subject, 'Subject A');
});

test('storeRenderedHtml under concurrency: two near-simultaneous callers for the SAME delivery never disagree', async () => {
  const delivery = await digestDelivery.getOrCreateDelivery({ clientId: 'c1', dateKey: '2026-08-17' });
  const [a, b] = await Promise.all([
    digestDelivery.storeRenderedHtml(delivery.id, { html: '<p>A</p>', subject: 'Subject A', recipient: 'a@a.com' }),
    digestDelivery.storeRenderedHtml(delivery.id, { html: '<p>B</p>', subject: 'Subject B', recipient: 'b@b.com' }),
  ]);
  assert.equal(a.htmlHash, b.htmlHash);
  const loaded = await digestDelivery.loadRenderedHtml(delivery.id);
  assert.ok(loaded.html === '<p>A</p>' || loaded.html === '<p>B</p>');
});

test('recordSendAttempt is idempotent past `sent` — stray extra calls never regress stage, attempts, or the provider id', async () => {
  const delivery = await digestDelivery.getOrCreateDelivery({ clientId: 'c1', dateKey: '2026-08-17' });
  await primeForSending(delivery.id);
  const sent = await recordCurrentSendAttempt(delivery.id, okSend('em_1'));
  const again = await recordCurrentSendAttempt(delivery.id, retryableFail());
  assert.equal(again.stage, 'sent');
  assert.equal(again.attempts, sent.attempts);
  assert.equal(again.providerEmailId, 'em_1');
});

// ── Send attempt outcomes ────────────────────────────────────────────────────

test('recordSendAttempt: success moves to sent, stores provider id, and logs a sanitized attempt entry', async () => {
  const delivery = await digestDelivery.getOrCreateDelivery({ clientId: 'c1', dateKey: '2026-08-17' });
  await primeForSending(delivery.id);
  const updated = await recordCurrentSendAttempt(delivery.id, okSend('em_42'));
  assert.equal(updated.stage, 'sent');
  assert.equal(updated.providerEmailId, 'em_42');
  assert.equal(updated.attempts, 1);
  assert.equal(updated.lastError, null);
  assert.equal(updated.attemptLog.length, 1);
  assert.equal(updated.attemptLog[0].providerId, 'em_42');
  assert.equal(updated.sendLeaseOwner, null, 'the lease must be cleared once resolved');
});

test('recordSendAttempt: a malformed-2xx retryable failure is observable and schedules a backoff retry', async () => {
  const delivery = await digestDelivery.getOrCreateDelivery({ clientId: 'c1', dateKey: '2026-08-17' });
  await primeForSending(delivery.id);
  const malformed = { ok: false, retryable: true, reason: 'malformed-response: 2xx with no id field', errorCode: 'malformed-2xx', httpStatus: 200, responseKeys: ['status'] };
  const updated = await recordCurrentSendAttempt(delivery.id, malformed);
  assert.equal(updated.stage, 'retry-wait');
  assert.ok(updated.nextRetryAt);
  assert.equal(updated.dueSortKey, updated.nextRetryAt);
  assert.equal(updated.lastError.retryable, true);
  assert.equal(updated.attemptLog[0].errorCode, 'malformed-2xx');
  assert.equal(JSON.stringify(updated).includes('Authorization'), false);
});

test('recordSendAttempt: a permanent 4xx goes straight to terminal-failure and is never retried again', async () => {
  const delivery = await digestDelivery.getOrCreateDelivery({ clientId: 'c1', dateKey: '2026-08-17' });
  await primeForSending(delivery.id);
  const updated = await recordCurrentSendAttempt(delivery.id, permanentFail());
  assert.equal(updated.stage, 'terminal-failure');
  assert.equal(updated.nextRetryAt, null);
  assert.equal(updated.dueSortKey, null);
  const due = await digestDelivery.listDueWork({ now: Date.now() + 999_999_999 });
  assert.equal(due.find((d) => d.id === delivery.id), undefined);
});

test('recordSendAttempt: retry-budget exhaustion reaches terminal-failure deterministically', async () => {
  const delivery = await digestDelivery.getOrCreateDelivery({ clientId: 'c1', dateKey: '2026-08-17' });
  await primeForSending(delivery.id);
  let updated = await recordCurrentSendAttempt(delivery.id, retryableFail());
  for (let i = 1; i < digestDelivery.MAX_SEND_ATTEMPTS; i++) {
    // eslint-disable-next-line no-await-in-loop
    await digestDelivery.claimForSend(delivery.id);
    // eslint-disable-next-line no-await-in-loop
    updated = await recordCurrentSendAttempt(delivery.id, retryableFail());
  }
  assert.equal(updated.stage, 'terminal-failure');
  assert.equal(updated.attempts, digestDelivery.MAX_SEND_ATTEMPTS);
});

test('recordSendAttempt: past the 24h Resend idempotency-key safety margin, a retryable failure goes to terminal-failure even with attempts remaining', async () => {
  const delivery = await digestDelivery.getOrCreateDelivery({ clientId: 'c1', dateKey: '2026-08-01' });
  await primeForSending(delivery.id);
  fakeCtx.adminDb._patch(digestDelivery.COLLECTION, delivery.id, { createdAt: new Date(Date.now() - 21 * 60 * 60 * 1000).toISOString() });
  const updated = await recordCurrentSendAttempt(delivery.id, retryableFail());
  assert.equal(updated.stage, 'terminal-failure');
  assert.equal(updated.lastError.code, 'idempotency-window-exceeded');
  assert.equal(updated.attempts, 1);
});

// ── attemptSendCore / claim semantics ───────────────────────────────────────

test('sendFirstAttempt / retryDeliveryNow reuse the stored render — the transport receives no generator dependency', async () => {
  const delivery = await digestDelivery.getOrCreateDelivery({ clientId: 'c1', dateKey: '2026-08-17' });
  await digestDelivery.storeRenderedHtml(delivery.id, { html: '<p>v1</p>', subject: 'Daily', recipient: 'you@x.com' });

  let calls = 0;
  let lastArgs = null;
  const sendFn = async (args) => { calls += 1; lastArgs = args; return retryableFail(); };
  const outcome = await digestDelivery.sendFirstAttempt(delivery.id, sendFn);
  assert.equal(calls, 1);
  assert.equal(lastArgs.html, '<p>v1</p>');
  assert.equal(lastArgs.idempotencyKey, delivery.idempotencyKey);
  assert.equal(outcome.stage, 'retry-wait');

  let retryCalls = 0;
  const retrySendFn = async (args) => { retryCalls += 1; assert.equal(args.html, '<p>v1</p>'); return okSend('em_retry'); };
  const retried = await digestDelivery.retryDeliveryNow(delivery.id, { sendFn: retrySendFn });
  assert.equal(retryCalls, 1);
  assert.equal(retried.stage, 'sent');
});

test('retryDeliveryNow on an already-sent delivery is a safe no-op — never calls sendFn again, never duplicates', async () => {
  const delivery = await digestDelivery.getOrCreateDelivery({ clientId: 'c1', dateKey: '2026-08-17' });
  await digestDelivery.storeRenderedHtml(delivery.id, { html: '<p>v1</p>', subject: 'Daily', recipient: 'you@x.com' });
  await digestDelivery.sendFirstAttempt(delivery.id, async () => okSend('em_1'));
  let calls = 0;
  const outcome = await digestDelivery.retryDeliveryNow(delivery.id, { sendFn: async () => { calls += 1; return okSend('em_should_not_happen'); } });
  assert.equal(calls, 0);
  assert.equal(outcome.alreadySent, true);
});

// ── Concurrency: exactly one winner ─────────────────────────────────────────

test('CRITICAL: concurrent retry workers racing the SAME delivery cannot both send it — exactly one wins', async () => {
  const primed = await primeIntoRetryWait('c1', '2026-08-17');
  let sendCalls = 0;
  const sendFn = async () => { sendCalls += 1; return okSend('em_winner'); };
  const [a, b, c] = await Promise.all([
    digestDelivery.retryDeliveryNow(primed.id, { sendFn }),
    digestDelivery.retryDeliveryNow(primed.id, { sendFn }),
    digestDelivery.retryDeliveryNow(primed.id, { sendFn }),
  ]);
  assert.equal(sendCalls, 1);
  const outcomes = [a, b, c];
  const winners = outcomes.filter((o) => o.ok && !o.alreadySent);
  const losers = outcomes.filter((o) => !(o.ok && !o.alreadySent));
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 2);
  for (const loser of losers) assert.ok(loser.alreadySent || !loser.ok);
});

test('CRITICAL: concurrent acquireRefreshLock calls for the same client/day — exactly one winner', async () => {
  const attempts = await Promise.all([
    digestDelivery.acquireRefreshLock('c1', '2026-08-17'),
    digestDelivery.acquireRefreshLock('c1', '2026-08-17'),
    digestDelivery.acquireRefreshLock('c1', '2026-08-17'),
    digestDelivery.acquireRefreshLock('c1', '2026-08-17'),
  ]);
  const won = attempts.filter((a) => a.acquired);
  assert.equal(won.length, 1);
});

test('acquireRefreshLock does not block a DIFFERENT client on the same day', async () => {
  const [a, b] = await Promise.all([
    digestDelivery.acquireRefreshLock('client-a', '2026-08-17'),
    digestDelivery.acquireRefreshLock('client-b', '2026-08-17'),
  ]);
  assert.equal(a.acquired, true);
  assert.equal(b.acquired, true);
});

test('releasing the lock allows a subsequent acquire; FAILS CLOSED when the transaction errors', async () => {
  const first = await digestDelivery.acquireRefreshLock('c1', '2026-08-17');
  assert.equal(first.acquired, true);
  const blocked = await digestDelivery.acquireRefreshLock('c1', '2026-08-17');
  assert.equal(blocked.acquired, false);
  await digestDelivery.releaseRefreshLock(first.deliveryId, first.ownerId);
  const third = await digestDelivery.acquireRefreshLock('c1', '2026-08-17');
  assert.equal(third.acquired, true);

  const brokenCtx = {
    adminDb: { collection: () => { throw new Error('simulated outage'); }, runTransaction: async () => { throw new Error('simulated outage'); } },
    FieldValue: fakeCtx.FieldValue, adminStorage: fakeCtx.adminStorage,
  };
  digestDelivery.__setTestContext(brokenCtx);
  const duringOutage = await digestDelivery.acquireRefreshLock('c2', '2026-08-17');
  assert.equal(duringOutage.acquired, false);
  digestDelivery.__setTestContext(fakeCtx);
});

test('fencing: an old lock owner can never release a lock a newer owner already took over', async () => {
  const dateKey = '2026-08-17';
  const past = Date.now() - 20 * 60_000;
  const ownerA = await digestDelivery.acquireRefreshLock('c1', dateKey, { now: past });
  assert.equal(ownerA.acquired, true);
  const ownerB = await digestDelivery.acquireRefreshLock('c1', dateKey, { now: Date.now() });
  assert.equal(ownerB.acquired, true);
  assert.notEqual(ownerB.ownerId, ownerA.ownerId);
  const released = await digestDelivery.releaseRefreshLock(ownerA.deliveryId, ownerA.ownerId);
  assert.equal(released.released, false);
  const stillBlocked = await digestDelivery.acquireRefreshLock('c1', dateKey, { now: Date.now() });
  assert.equal(stillBlocked.acquired, false);
  const bReleased = await digestDelivery.releaseRefreshLock(ownerB.deliveryId, ownerB.ownerId);
  assert.equal(bReleased.released, true);
});

// ── Due-work selection / sweep ──────────────────────────────────────────────

test('a retry becomes claimable once its backoff elapses, and sweeping it performs ZERO generation calls', async () => {
  const primed = await primeIntoRetryWait('c1', '2026-08-17', { nextRetryAt: new Date(Date.now() + 5 * 60_000).toISOString() });
  const notYetDue = await digestDelivery.listDueWork({ now: Date.now() });
  assert.equal(notYetDue.find((d) => d.id === primed.id), undefined);
  const sendFn = async () => okSend('em_swept');
  const swept = await digestDelivery.sweepDueRetries({ sendFn, now: Date.now() + 6 * 60_000 });
  assert.equal(swept.swept, 1);
  assert.equal(swept.results[0].stage, 'sent');
});

test('sweepDueRetries fires onOutcome only on a TERMINAL stage', async () => {
  const willSucceed = await primeIntoRetryWait('will-succeed', '2026-08-17', { nextRetryAt: new Date(Date.now() - 1000).toISOString() });
  fakeCtx.adminDb._patch(digestDelivery.COLLECTION, willSucceed.id, { recipient: 'a@a.com' });
  const stillRetrying = await primeIntoRetryWait('still-retrying', '2026-08-17', { nextRetryAt: new Date(Date.now() - 1000).toISOString() });
  fakeCtx.adminDb._patch(digestDelivery.COLLECTION, stillRetrying.id, { recipient: 'b@b.com' });
  const outcomes = [];
  const sendFn = async ({ to }) => (to === 'a@a.com' ? okSend('em_a') : retryableFail());
  const result = await digestDelivery.sweepDueRetries({ sendFn, onOutcome: (o) => { outcomes.push(o); } });
  assert.equal(result.swept, 2);
  assert.equal(outcomes.length, 1);
  assert.deepEqual(outcomes[0], { clientId: 'will-succeed', ok: true });
});

// ── Delivery identity: manual vs. scheduled ─────────────────────────────────

test('the SCHEDULED cron always targets the primary occurrence, never a manual attempt id', async () => {
  const cron1 = await digestDelivery.resolveDeliveryIdentity({ clientId: 'c1', timestampMs: Date.now(), timeZone: 'America/Chicago', source: 'cron-scheduled' });
  const cron2 = await digestDelivery.resolveDeliveryIdentity({ clientId: 'c1', timestampMs: Date.now() + 60_000, timeZone: 'America/Chicago', source: 'cron-scheduled' });
  assert.equal(cron1.deliveryId, cron2.deliveryId);
});

test('an explicit requestedDeliveryId (the admin Retry action) always wins identity resolution', async () => {
  const resolved = await digestDelivery.resolveDeliveryIdentity({ clientId: 'c1', timestampMs: Date.now(), timeZone: 'America/Chicago', source: 'manual-admin', requestedDeliveryId: 'c1__2026-08-01__manual-abc' });
  assert.equal(resolved.deliveryId, 'c1__2026-08-01__manual-abc');
  assert.equal(resolved.isNewAttempt, false);
});

test('a manual send NEVER shares identity with the scheduled cron occurrence, even as the first send of the day', async () => {
  const dateKey = digestDelivery.localDateKey(Date.now(), 'America/Chicago');
  const scheduled = await digestDelivery.resolveDeliveryIdentity({ clientId: 'c1', timestampMs: Date.now(), timeZone: 'America/Chicago', source: 'cron-scheduled' });
  const manual = await digestDelivery.resolveDeliveryIdentity({ clientId: 'c1', timestampMs: Date.now(), timeZone: 'America/Chicago', source: 'manual-admin', requestId: 'req-1' });
  assert.notEqual(scheduled.deliveryId, manual.deliveryId);
  assert.equal(manual.deliveryId, digestDelivery.buildManualAttemptId('c1', dateKey, 'req-1'));
});

test('local schedule-day identity uses the CLIENT timezone, not UTC', () => {
  const ts = Date.parse('2026-08-17T02:00:00.000Z');
  assert.equal(digestDelivery.utcDateKey(ts), '2026-08-17');
  assert.equal(digestDelivery.localDateKey(ts, 'America/Chicago'), '2026-08-16');
});

test('local schedule-day identity is correct across DST spring-forward (2026-03-08) and fall-back (2026-11-01), America/Chicago', () => {
  assert.equal(digestDelivery.localDateKey(Date.parse('2026-03-08T06:00:00.000Z'), 'America/Chicago'), '2026-03-08');
  assert.equal(digestDelivery.localDateKey(Date.parse('2026-03-08T09:00:00.000Z'), 'America/Chicago'), '2026-03-08');
  assert.equal(digestDelivery.localDateKey(Date.parse('2026-11-01T06:00:00.000Z'), 'America/Chicago'), '2026-11-01');
  assert.equal(digestDelivery.localDateKey(Date.parse('2026-11-01T10:00:00.000Z'), 'America/Chicago'), '2026-11-01');
});

test('an unknown/invalid IANA timezone string falls back to UTC rather than throwing', () => {
  const ts = Date.now();
  assert.doesNotThrow(() => digestDelivery.localDateKey(ts, 'Not/A_Real_Zone'));
  assert.equal(digestDelivery.localDateKey(ts, 'Not/A_Real_Zone'), digestDelivery.utcDateKey(ts));
});

test('sanitizeRequestId strips unsafe characters and bounds length', () => {
  assert.equal(digestDelivery.sanitizeRequestId('abc-123_XYZ'), 'abc-123_XYZ');
  assert.equal(digestDelivery.sanitizeRequestId('../../etc/passwd; rm -rf'), 'etcpasswdrm-rf');
  assert.equal(digestDelivery.sanitizeRequestId('x'.repeat(200)).length, 80);
  assert.equal(digestDelivery.sanitizeRequestId(null), '');
});

// ── Retention ────────────────────────────────────────────────────────────────

test('retention: only fully-resolved records past the cutoff are selected, and purge removes both the doc and its stored HTML', async () => {
  const old = await digestDelivery.getOrCreateDelivery({ clientId: 'c1', dateKey: '2026-07-01' });
  await digestDelivery.storeRenderedHtml(old.id, { html: '<p>old</p>', subject: 's', recipient: 'r@r.com' });
  await digestDelivery.sendFirstAttempt(old.id, async () => okSend('em_old'));
  fakeCtx.adminDb._patch(digestDelivery.COLLECTION, old.id, { updatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() });

  const recentSent = await digestDelivery.getOrCreateDelivery({ clientId: 'c2', dateKey: '2026-08-17' });
  await digestDelivery.storeRenderedHtml(recentSent.id, { html: '<p>recent</p>', subject: 's', recipient: 'r@r.com' });
  await digestDelivery.sendFirstAttempt(recentSent.id, async () => okSend('em_recent'));

  const stillRetrying = await primeIntoRetryWait('c3', '2026-07-01');
  fakeCtx.adminDb._patch(digestDelivery.COLLECTION, stillRetrying.id, { updatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() });

  const cutoff = Date.now() - digestDelivery.DEFAULT_RETENTION_MS;
  const candidates = await digestDelivery.listDeliveriesOlderThan(cutoff);
  const candidateIds = candidates.map((c) => c.id);
  assert.ok(candidateIds.includes(old.id));
  assert.ok(!candidateIds.includes(recentSent.id));
  assert.ok(!candidateIds.includes(stillRetrying.id));

  const purge = await digestDelivery.purgeDeliveriesOlderThan(cutoff);
  assert.equal(purge.count, 1);
  assert.equal(await digestDelivery.getDelivery(old.id), null);
  assert.equal(fakeCtx.adminStorage.bucket()._raw(`digest-html/${old.id}.html`), undefined);
  assert.ok(await digestDelivery.getDelivery(stillRetrying.id));
});

test('retention also reaps abandoned bookkeeping stages (found in the adversarial review) — but never sending/retry-wait, which have their own recovery paths', async () => {
  const abandonedRefresh = await digestDelivery.getOrCreateDelivery({ clientId: 'crashed-client', dateKey: '2026-07-01' });
  await digestDelivery.markStage(abandonedRefresh.id, 'refreshing');
  fakeCtx.adminDb._patch(digestDelivery.COLLECTION, abandonedRefresh.id, { updatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() });

  const oldButLive = await digestDelivery.getOrCreateDelivery({ clientId: 'still-sending-client', dateKey: '2026-07-01' });
  await digestDelivery.storeRenderedHtml(oldButLive.id, { html: '<p>x</p>', subject: 's', recipient: 'r@r.com' });
  await digestDelivery.claimForSend(oldButLive.id);
  fakeCtx.adminDb._patch(digestDelivery.COLLECTION, oldButLive.id, { updatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() });

  const cutoff = Date.now() - digestDelivery.DEFAULT_RETENTION_MS;
  const candidates = await digestDelivery.listDeliveriesOlderThan(cutoff);
  const ids = candidates.map((c) => c.id);
  assert.ok(ids.includes(abandonedRefresh.id), 'an abandoned refreshing-stage record must be eligible after the retention window');
  assert.ok(!ids.includes(oldButLive.id), 'a sending record — even an old one — is never swept by age alone; it has its own lease-based recovery');

  const purge = await digestDelivery.purgeDeliveriesOlderThan(cutoff);
  assert.equal(purge.count, 1);
  assert.equal(await digestDelivery.getDelivery(abandonedRefresh.id), null);
  assert.ok(await digestDelivery.getDelivery(oldButLive.id));
});

test('backoffForAttempt returns an increasing, bounded schedule', () => {
  const values = [1, 2, 3, 4, 5, 6, 99].map((n) => digestDelivery.backoffForAttempt(n));
  for (let i = 1; i < values.length - 1; i++) assert.ok(values[i] >= values[i - 1]);
  assert.equal(values[values.length - 1], values[4]);
});

// ═══════════════════════════════════════════════════════════════════════════
// REGRESSIONS — required by the P1-1/P1-2/P1-3/P2-4 review pass (2026-08-17)
// ═══════════════════════════════════════════════════════════════════════════

test('REGRESSION 1: a crashed sender is recovered by the sweep once its lease expires, and sends under the SAME idempotency key — no duplicate', async () => {
  const delivery = await digestDelivery.getOrCreateDelivery({ clientId: 'c1', dateKey: '2026-08-17' });
  await digestDelivery.storeRenderedHtml(delivery.id, { html: '<p>x</p>', subject: 's', recipient: 'r@r.com' });

  const claimTime = Date.now();
  const claimed = await digestDelivery.claimForSend(delivery.id, { now: claimTime });
  assert.equal(claimed.stage, 'sending');
  const leaseExpiresAt = claimed.sendLeaseExpiresAt;
  assert.ok(leaseExpiresAt);
  // The process "dies" here — nothing ever calls recordSendAttempt.

  // Before expiry, the sweep must not touch it.
  const beforeExpiry = await digestDelivery.listDueWork({ now: claimTime + 1000 });
  assert.equal(beforeExpiry.find((d) => d.id === delivery.id), undefined);

  // After expiry, the sweep reclaims and sends it — reusing the SAME key.
  const afterExpiry = Date.parse(leaseExpiresAt) + 1000;
  let sendCalls = 0;
  let sentKey = null;
  const sendFn = async ({ idempotencyKey }) => { sendCalls += 1; sentKey = idempotencyKey; return okSend('em_recovered'); };
  const swept = await digestDelivery.sweepDueRetries({ sendFn, now: afterExpiry });

  assert.equal(swept.swept, 1);
  assert.equal(sendCalls, 1);
  assert.equal(sentKey, delivery.idempotencyKey, 'recovery must reuse the SAME idempotency key as the original claim');
  const final = await digestDelivery.getDelivery(delivery.id);
  assert.equal(final.stage, 'sent');
  assert.equal(final.providerEmailId, 'em_recovered');
});

test('REGRESSION 2: an expired-lease `sending` does NOT permanently block paid refresh; a live (unexpired) lease DOES', async () => {
  const now = Date.now();
  const delivery = await digestDelivery.getOrCreateDelivery({ clientId: 'flaky-refresh-client', dateKey: '2026-08-16' });
  await digestDelivery.storeRenderedHtml(delivery.id, { html: '<p>x</p>', subject: 's', recipient: 'r@r.com' });
  await digestDelivery.claimForSend(delivery.id, { now });

  const blockedWhileLive = await digestDelivery.hasUnresolvedPriorDelivery('flaky-refresh-client', { now: now + 1000 });
  assert.equal(blockedWhileLive, true, 'a LIVE lease must block — the send may genuinely still be in flight');

  const afterExpiry = now + digestDelivery.SEND_LEASE_TTL_MS + 1000;
  const notBlockedAfterExpiry = await digestDelivery.hasUnresolvedPriorDelivery('flaky-refresh-client', { now: afterExpiry });
  assert.equal(notBlockedAfterExpiry, false, 'an EXPIRED lease must be treated as recoverable, never a permanent block');
});

test('REGRESSION 3: the same requestId submitted twice (HTTP-timeout retry) resolves to exactly ONE record and ONE provider call', async () => {
  const requestId = 'req-abc-123';
  let sendCalls = 0;
  const sendFn = async () => { sendCalls += 1; return okSend('em_once'); };

  async function submit() {
    const identity = await digestDelivery.resolveDeliveryIdentity({ clientId: 'c1', timestampMs: Date.now(), timeZone: 'America/Chicago', source: 'manual-admin', requestId });
    const delivery = await digestDelivery.getOrCreateDelivery({ clientId: 'c1', dateKey: identity.dateKey, source: 'manual-admin', deliveryId: identity.deliveryId });
    await digestDelivery.storeRenderedHtml(delivery.id, { html: '<p>x</p>', subject: 's', recipient: 'r@r.com' });
    return digestDelivery.sendFirstAttempt(delivery.id, sendFn);
  }

  const first = await submit();
  const second = await submit(); // client retries after a perceived timeout
  assert.equal(sendCalls, 1);
  assert.equal(first.id, 'em_once');
  assert.equal(second.alreadySent, true);
  assert.equal(second.providerEmailId, 'em_once');
});

test('REGRESSION 4: two DIFFERENT requestIds the same day produce two records and two provider calls', async () => {
  const dateKey = digestDelivery.localDateKey(Date.now(), 'America/Chicago');
  const idA = await digestDelivery.resolveDeliveryIdentity({ clientId: 'c1', timestampMs: Date.now(), timeZone: 'America/Chicago', source: 'manual-admin', requestId: 'req-A' });
  const idB = await digestDelivery.resolveDeliveryIdentity({ clientId: 'c1', timestampMs: Date.now(), timeZone: 'America/Chicago', source: 'manual-admin', requestId: 'req-B' });
  assert.notEqual(idA.deliveryId, idB.deliveryId);

  let calls = 0;
  const sendFn = async () => { calls += 1; return okSend(`em_${calls}`); };

  const devA = await digestDelivery.getOrCreateDelivery({ clientId: 'c1', dateKey, source: 'manual-admin', deliveryId: idA.deliveryId });
  await digestDelivery.storeRenderedHtml(devA.id, { html: '<p>A</p>', subject: 'sA', recipient: 'a@a.com' });
  const outA = await digestDelivery.sendFirstAttempt(devA.id, sendFn);

  const devB = await digestDelivery.getOrCreateDelivery({ clientId: 'c1', dateKey, source: 'manual-admin', deliveryId: idB.deliveryId });
  await digestDelivery.storeRenderedHtml(devB.id, { html: '<p>B</p>', subject: 'sB', recipient: 'b@b.com' });
  const outB = await digestDelivery.sendFirstAttempt(devB.id, sendFn);

  assert.equal(calls, 2);
  assert.notEqual(outA.id, outB.id);
});

test('REGRESSION 5: two concurrent FIRST manual sends of the day (different requestIds) never collapse or lose a send', async () => {
  const dateKey = digestDelivery.localDateKey(Date.now(), 'America/Chicago');
  const [idA, idB] = await Promise.all([
    digestDelivery.resolveDeliveryIdentity({ clientId: 'c1', timestampMs: Date.now(), timeZone: 'America/Chicago', source: 'manual-admin', requestId: 'req-concurrent-A' }),
    digestDelivery.resolveDeliveryIdentity({ clientId: 'c1', timestampMs: Date.now(), timeZone: 'America/Chicago', source: 'manual-admin', requestId: 'req-concurrent-B' }),
  ]);
  assert.notEqual(idA.deliveryId, idB.deliveryId);

  let calls = 0;
  const sendFn = async () => { calls += 1; return okSend(`em_${calls}`); };
  const [devA, devB] = await Promise.all([
    digestDelivery.getOrCreateDelivery({ clientId: 'c1', dateKey, source: 'manual-admin', deliveryId: idA.deliveryId }),
    digestDelivery.getOrCreateDelivery({ clientId: 'c1', dateKey, source: 'manual-admin', deliveryId: idB.deliveryId }),
  ]);
  await Promise.all([
    digestDelivery.storeRenderedHtml(devA.id, { html: '<p>A</p>', subject: 'sA', recipient: 'a@a.com' }),
    digestDelivery.storeRenderedHtml(devB.id, { html: '<p>B</p>', subject: 'sB', recipient: 'b@b.com' }),
  ]);
  const [outA, outB] = await Promise.all([
    digestDelivery.sendFirstAttempt(devA.id, sendFn),
    digestDelivery.sendFirstAttempt(devB.id, sendFn),
  ]);
  assert.equal(calls, 2, 'both concurrent sends must go through — neither silently dropped');
  assert.ok(outA.ok && outB.ok);
});

test('REGRESSION 6: the unresolved-delivery guard finds an unresolved record even when the client has >20 delivery records', async () => {
  for (let i = 0; i < 25; i++) {
    // eslint-disable-next-line no-await-in-loop
    const d = await digestDelivery.getOrCreateDelivery({ clientId: 'busy-client', dateKey: `2026-07-${String(i + 1).padStart(2, '0')}` });
    // eslint-disable-next-line no-await-in-loop
    await digestDelivery.storeRenderedHtml(d.id, { html: '<p>x</p>', subject: 's', recipient: 'r@r.com' });
    // eslint-disable-next-line no-await-in-loop
    await digestDelivery.sendFirstAttempt(d.id, async () => okSend(`em_${i}`));
  }
  await primeIntoRetryWait('busy-client', '2026-08-01');
  const unresolved = await digestDelivery.hasUnresolvedPriorDelivery('busy-client');
  assert.equal(unresolved, true, 'must be found regardless of how many OTHER resolved records this client has — the old .limit(20) sampled query could miss this');
});

test('REGRESSION 7: due-work selection returns the OLDEST due work first even with more candidates than the scan cap — starvation impossible by construction', async () => {
  const now = Date.now();
  const ordered = [];
  for (let i = 0; i < 10; i++) {
    const nextRetryAt = new Date(now - (10 - i) * 60_000).toISOString(); // i=0 is the oldest
    // eslint-disable-next-line no-await-in-loop
    const d = await primeIntoRetryWait(`starve-client-${i}`, '2026-08-17', { nextRetryAt });
    ordered.push(d.id);
  }
  const due = await digestDelivery.listDueWork({ now, limit: 3 });
  assert.equal(due.length, 3);
  assert.deepEqual(due.map((d) => d.id), ordered.slice(0, 3), 'must select the genuinely oldest-due work, in order — never an arbitrary page');
});

test('REGRESSION 8: lease TTL boundary — not-yet-expired is not stealable, just-expired is', async () => {
  const claimTime = Date.now();
  const delivery = await digestDelivery.getOrCreateDelivery({ clientId: 'c1', dateKey: '2026-08-17' });
  await digestDelivery.storeRenderedHtml(delivery.id, { html: '<p>x</p>', subject: 's', recipient: 'r@r.com' });
  const claimed = await digestDelivery.claimForSend(delivery.id, { now: claimTime });
  const expiresAtMs = Date.parse(claimed.sendLeaseExpiresAt);
  assert.equal(expiresAtMs, claimTime + digestDelivery.SEND_LEASE_TTL_MS);

  const notYetExpired = await digestDelivery.claimForSend(delivery.id, { now: expiresAtMs - 1 });
  assert.equal(notYetExpired, null, 'a lease that has not yet expired must never be reclaimed');

  const justExpired = await digestDelivery.claimForSend(delivery.id, { now: expiresAtMs });
  assert.notEqual(justExpired, null);
  assert.equal(justExpired.stage, 'sending');
});

test('REGRESSION 9: a superseded lease owner cannot write a late send outcome', async () => {
  const claimTime = Date.now();
  const delivery = await digestDelivery.getOrCreateDelivery({ clientId: 'lease-fence-client', dateKey: '2026-08-17' });
  await digestDelivery.storeRenderedHtml(delivery.id, { html: '<p>x</p>', subject: 's', recipient: 'r@r.com' });
  const ownerA = await digestDelivery.claimForSend(delivery.id, { now: claimTime });
  const ownerB = await digestDelivery.claimForSend(delivery.id, { now: Date.parse(ownerA.sendLeaseExpiresAt) });
  assert.notEqual(ownerA.sendLeaseOwner, ownerB.sendLeaseOwner);

  const stale = await digestDelivery.recordSendAttempt(delivery.id, okSend('em_stale'), { leaseOwner: ownerA.sendLeaseOwner });
  assert.equal(stale.__leaseRejected, true);
  assert.equal(stale.stage, 'sending');
  assert.equal(stale.sendLeaseOwner, ownerB.sendLeaseOwner);

  const current = await digestDelivery.recordSendAttempt(delivery.id, okSend('em_current'), { leaseOwner: ownerB.sendLeaseOwner });
  assert.equal(current.stage, 'sent');
  assert.equal(current.providerEmailId, 'em_current');
});

test('REGRESSION 10: terminal delivery and breaker update commit atomically or neither does', async () => {
  const delivery = await digestDelivery.getOrCreateDelivery({ clientId: 'atomic-breaker-client', dateKey: '2026-08-17' });
  const claimed = await primeForSending(delivery.id);
  const originalRunTransaction = fakeCtx.adminDb.runTransaction.bind(fakeCtx.adminDb);
  fakeCtx.adminDb.runTransaction = async () => { throw new Error('simulated breaker transaction failure'); };

  await assert.rejects(
    digestDelivery.recordSendAttempt(delivery.id, permanentFail(), { leaseOwner: claimed.sendLeaseOwner }),
    /simulated breaker transaction failure/,
  );
  fakeCtx.adminDb.runTransaction = originalRunTransaction;

  const unchanged = await digestDelivery.getDelivery(delivery.id);
  assert.equal(unchanged.stage, 'sending', 'terminal state must not land without its breaker bookkeeping');
  assert.equal(unchanged.sendLeaseOwner, claimed.sendLeaseOwner);
  const breakerDoc = await fakeCtx.adminDb.collection('digest_config').doc('atomic-breaker-client').get();
  assert.equal(breakerDoc.exists, false);
  assert.equal(await digestDelivery.hasUnresolvedPriorDelivery('atomic-breaker-client'), true, 'failed breaker bookkeeping must keep paid refresh blocked');
});

test('REGRESSION 11: concurrent terminal failures increment the breaker without lost updates', async () => {
  const deliveries = await Promise.all(['A', 'B'].map(async (suffix) => {
    const delivery = await digestDelivery.getOrCreateDelivery({ clientId: 'concurrent-breaker-client', dateKey: `2026-08-1${suffix === 'A' ? '6' : '7'}` });
    const claimed = await primeForSending(delivery.id);
    return { delivery, claimed };
  }));
  await Promise.all(deliveries.map(({ delivery, claimed }) => (
    digestDelivery.recordSendAttempt(delivery.id, permanentFail(), { leaseOwner: claimed.sendLeaseOwner })
  )));
  const breakerDoc = await fakeCtx.adminDb.collection('digest_config').doc('concurrent-breaker-client').get();
  assert.equal(breakerDoc.data().deliveryBreaker.consecutiveFailures, 2);
});
