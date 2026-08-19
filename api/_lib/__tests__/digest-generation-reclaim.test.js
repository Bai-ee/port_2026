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

const NOW = Date.parse('2026-08-18T14:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

function doc(overrides = {}) {
  return {
    stage: 'refreshing',
    source: 'cron-scheduled',
    createdAt: iso(NOW - 2 * HOUR),
    updatedAt: iso(NOW - HOUR),
    ...overrides,
  };
}

// ── isReclaimableGeneration (pure predicate) ─────────────────────────────────

test('a cron occurrence stuck mid-generation past staleness is reclaimable', () => {
  for (const stage of ['scheduled', 'refreshing', 'generated']) {
    assert.equal(digestDelivery.isReclaimableGeneration(doc({ stage }), NOW), true, stage);
  }
});

test('post-render / terminal stages are never reclaimed here (transport sweep owns them)', () => {
  for (const stage of ['delivery-pending', 'sending', 'retry-wait', 'sent', 'terminal-failure']) {
    assert.equal(digestDelivery.isReclaimableGeneration(doc({ stage }), NOW), false, stage);
  }
});

test('manual-flow bookkeeping is never auto-resent', () => {
  // e.g. the 2026-08-17 record: created by a manual Generate & Send's refresh
  // phase, left at `refreshing` — an operator was watching; reclaim must not
  // fire a surprise second email for it.
  assert.equal(digestDelivery.isReclaimableGeneration(doc({ source: 'manual-admin' }), NOW), false);
});

test('fresh work is left alone until the staleness window passes', () => {
  // 12:35 refresh marks `refreshing`; the ~13:00 send cron must always win the
  // race against the 5-minute sweep — 45min staleness guarantees that.
  assert.equal(digestDelivery.isReclaimableGeneration(doc({ updatedAt: iso(NOW - 10 * MIN) }), NOW), false);
  assert.equal(digestDelivery.isReclaimableGeneration(doc({ updatedAt: iso(NOW - 44 * MIN) }), NOW), false);
  assert.equal(digestDelivery.isReclaimableGeneration(doc({ updatedAt: iso(NOW - 46 * MIN) }), NOW), true);
});

test('records older than the idempotency safety window are not reclaimed', () => {
  const old = doc({ createdAt: iso(NOW - 21 * HOUR), updatedAt: iso(NOW - 21 * HOUR) });
  assert.equal(digestDelivery.isReclaimableGeneration(old, NOW), false);
});

test('records without parseable timestamps are not reclaimed', () => {
  assert.equal(digestDelivery.isReclaimableGeneration(doc({ updatedAt: null, createdAt: null }), NOW), false);
});

// ── listStuckScheduledGeneration (query + selection) ─────────────────────────

test('lists only reclaimable cron records, oldest first, bounded by limit', async () => {
  const put = (id, d) => fakeCtx.adminDb._patch(digestDelivery.COLLECTION, id, d);
  put('a__2026-08-18', doc({ updatedAt: iso(NOW - 3 * HOUR) }));
  put('b__2026-08-18', doc({ updatedAt: iso(NOW - 2 * HOUR) }));
  put('c__2026-08-18', doc({ updatedAt: iso(NOW - HOUR) }));
  put('manual__2026-08-18', doc({ source: 'manual-admin' }));
  put('sent__2026-08-18', doc({ stage: 'sent' }));
  put('fresh__2026-08-18', doc({ updatedAt: iso(NOW - 5 * MIN) }));

  const out = await digestDelivery.listStuckScheduledGeneration({ now: NOW, limit: 2 });
  assert.deepEqual(out.map((d) => d.id), ['a__2026-08-18', 'b__2026-08-18']);
});

test('returns empty when nothing is stuck', async () => {
  fakeCtx.adminDb._patch(digestDelivery.COLLECTION, 'x__2026-08-18', doc({ stage: 'sent' }));
  const out = await digestDelivery.listStuckScheduledGeneration({ now: NOW });
  assert.deepEqual(out, []);
});

// ── validateReclaimTarget: reclaim advances the EXACT stuck record ───────────

test('a prior-date stuck record reclaims AS ITSELF — identity from the record, never the clock', () => {
  // Stuck since yesterday evening, still inside the 20h idempotency window at
  // 02:00 next day. The reviewer's case: recomputing identity from Date.now()
  // would mint a NEW current-day delivery at 2am and leave this one stuck.
  const stuck = {
    id: 'paradice__2026-08-17',
    clientId: 'paradice',
    dateKey: '2026-08-17',
    ...doc({ createdAt: iso(NOW - 12 * HOUR), updatedAt: iso(NOW - 12 * HOUR) }),
  };
  const check = digestDelivery.validateReclaimTarget(stuck, { clientId: 'paradice', now: NOW });
  assert.equal(check.ok, true);
  assert.equal(check.identity.deliveryId, 'paradice__2026-08-17'); // the ORIGINAL record advances
  assert.equal(check.identity.dateKey, '2026-08-17');              // its own date, not "today"
  assert.equal(check.identity.clientId, 'paradice');
});

test('reclaim target validation refuses mismatched client, manual source, done/missing records', () => {
  const base = { id: 'a__2026-08-18', clientId: 'a', dateKey: '2026-08-18', ...doc() };
  assert.equal(digestDelivery.validateReclaimTarget(null, { now: NOW }).ok, false);
  assert.equal(digestDelivery.validateReclaimTarget(base, { clientId: 'someone-else', now: NOW }).reason, 'client-mismatch');
  assert.equal(digestDelivery.validateReclaimTarget({ ...base, source: 'manual-admin' }, { clientId: 'a', now: NOW }).ok, false);
  assert.equal(digestDelivery.validateReclaimTarget({ ...base, stage: 'sent' }, { clientId: 'a', now: NOW }).ok, false);
  assert.equal(digestDelivery.validateReclaimTarget({ ...base, updatedAt: iso(NOW - 5 * MIN) }, { clientId: 'a', now: NOW }).ok, false);
});

// ── Generation lease: one owner, one snapshot ────────────────────────────────

test('two concurrent generation claims yield exactly one owner', async () => {
  const delivery = await digestDelivery.getOrCreateDelivery({ clientId: 'c1', dateKey: '2026-08-18' });
  const [a, b] = await Promise.all([
    digestDelivery.claimGeneration(delivery.id, { now: NOW }),
    digestDelivery.claimGeneration(delivery.id, { now: NOW }),
  ]);
  const winners = [a, b].filter((r) => r.ok);
  const losers = [a, b].filter((r) => !r.ok);
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
  assert.equal(losers[0].reason, 'generation-in-progress');
});

test('claim reports already-sent (with provider id) and already-rendered honestly', async () => {
  const delivery = await digestDelivery.getOrCreateDelivery({ clientId: 'c2', dateKey: '2026-08-18' });
  await digestDelivery.storeRenderedHtml(delivery.id, { html: '<p>x</p>', subject: 's', recipient: 'r@r.com' });
  const rendered = await digestDelivery.claimGeneration(delivery.id, { now: NOW });
  assert.equal(rendered.ok, false);
  assert.equal(rendered.reason, 'already-rendered');

  fakeCtx.adminDb._patch(digestDelivery.COLLECTION, delivery.id, { stage: 'sent', providerEmailId: 'em_99' });
  const sent = await digestDelivery.claimGeneration(delivery.id, { now: NOW });
  assert.equal(sent.ok, false);
  assert.equal(sent.reason, 'already-sent');
  assert.equal(sent.providerEmailId, 'em_99');
});

test('an expired generation lease is reclaimable; release is fenced to its owner', async () => {
  const delivery = await digestDelivery.getOrCreateDelivery({ clientId: 'c3', dateKey: '2026-08-18' });
  const first = await digestDelivery.claimGeneration(delivery.id, { now: NOW });
  assert.equal(first.ok, true);
  // Wrong owner cannot release.
  await digestDelivery.releaseGeneration(delivery.id, 'gen-not-the-owner');
  const still = await digestDelivery.getDelivery(delivery.id);
  assert.equal(still.genLeaseOwner, first.ownerId);
  // Past TTL a new claim takes over (dead-worker recovery).
  const later = NOW + digestDelivery.GENERATION_LEASE_TTL_MS + 1;
  const second = await digestDelivery.claimGeneration(delivery.id, { now: later });
  assert.equal(second.ok, true);
  assert.notEqual(second.ownerId, first.ownerId);
});

test('storeRenderedHtml is fenced: the losing generator cannot touch the winning snapshot, bytes match the recorded hash', async () => {
  const crypto = require('crypto');
  const delivery = await digestDelivery.getOrCreateDelivery({ clientId: 'c4', dateKey: '2026-08-18' });
  const winner = await digestDelivery.claimGeneration(delivery.id, { now: NOW });
  assert.equal(winner.ok, true);

  const winnerHtml = '<p>winner render</p>';
  const storedByWinner = await digestDelivery.storeRenderedHtml(delivery.id, {
    html: winnerHtml, subject: 'w', recipient: 'r@r.com', leaseOwner: winner.ownerId,
  });
  assert.equal(storedByWinner.__generationFenced, undefined);

  // A stale worker (expired/foreign lease owner) tries to store a DIFFERENT
  // render for the same delivery — it must be fenced out entirely and the
  // immutable snapshot must keep the winner's bytes + hash.
  const fenced = await digestDelivery.storeRenderedHtml(delivery.id, {
    html: '<p>stale competing render</p>', subject: 'x', recipient: 'r@r.com', leaseOwner: 'gen-stale-owner',
  });
  assert.equal(fenced.htmlHash, crypto.createHash('sha256').update(winnerHtml, 'utf8').digest('hex'));

  const loaded = await digestDelivery.loadRenderedHtml(delivery.id);
  assert.equal(loaded.html, winnerHtml); // storage bytes = Firestore truth
  assert.equal(loaded.delivery.htmlBytes, Buffer.byteLength(winnerHtml, 'utf8'));
  assert.equal(loaded.delivery.htmlHash, crypto.createHash('sha256').update(winnerHtml, 'utf8').digest('hex'));
});

test('a fenced pre-render attempt never uploads competing bytes', async () => {
  const delivery = await digestDelivery.getOrCreateDelivery({ clientId: 'c5', dateKey: '2026-08-18' });
  const owner = await digestDelivery.claimGeneration(delivery.id, { now: NOW });
  assert.equal(owner.ok, true);
  // Loser arrives BEFORE the owner has stored anything: pre-upload fence must
  // turn it away — no Storage object may appear.
  const fenced = await digestDelivery.storeRenderedHtml(delivery.id, {
    html: '<p>loser</p>', subject: 'l', recipient: 'r@r.com', leaseOwner: 'gen-imposter',
  });
  assert.equal(fenced.__generationFenced, true);
  assert.equal(await digestDelivery.loadRenderedHtml(delivery.id), null); // nothing stored at all
});
