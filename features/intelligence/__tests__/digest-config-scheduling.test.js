'use strict';

// listDueClientIds/claimDueOccurrence — the Firestore-touching half of Phase
// 3 scheduling (the pure half, computeNextRunAt, is tested standalone in
// features/email-digest/__tests__/scheduler.test.js). Uses the require.cache
// swap pattern established in api/_lib/__tests__/deleted-accounts.test.js so
// _digest-config.js's `require('.../firebase-admin.cjs')` resolves to the
// fake instead of a real Firestore connection.

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');

const firebaseAdminPath = path.resolve(__dirname, '../../../api/_lib/firebase-admin.cjs');
const digestConfigPath = path.resolve(__dirname, '../_digest-config.js');

function loadModuleWithFakeFirebase() {
  delete require.cache[digestConfigPath];
  const fake = makeFakeContext();
  require.cache[firebaseAdminPath] = {
    id: firebaseAdminPath, filename: firebaseAdminPath, loaded: true, exports: fake,
  };
  const mod = require(digestConfigPath);
  return { fake, mod };
}

function enrolledSchedule(overrides = {}) {
  return { enabled: true, frequency: 'daily', sendHour: 7, weekday: 1, timezone: 'America/Chicago', ...overrides };
}

test('listDueClientIds: only enrolled clients with nextRunAt <= now are due', async () => {
  const { fake, mod } = loadModuleWithFakeFirebase();
  const now = Date.UTC(2026, 5, 15, 12, 0, 0);

  fake.adminDb._patch('digest_config', 'due-client', { schedule: enrolledSchedule(), nextRunAt: now - 1000 });
  fake.adminDb._patch('digest_config', 'not-due-client', { schedule: enrolledSchedule(), nextRunAt: now + 1000 * 60 * 60 });
  fake.adminDb._patch('digest_config', 'disabled-client', { schedule: enrolledSchedule({ enabled: false }), nextRunAt: now - 1000 });
  fake.adminDb._patch('digest_config', 'off-client', { schedule: enrolledSchedule({ frequency: 'off' }), nextRunAt: now - 1000 });
  fake.adminDb._patch('digest_config', 'never-scheduled-client', { schedule: enrolledSchedule() }); // no nextRunAt at all

  const due = await mod.listDueClientIds(now);
  assert.deepEqual(due.sort(), ['due-client', 'never-scheduled-client'].sort());
});

test('listDueClientIds orders most-overdue first', async () => {
  const { fake, mod } = loadModuleWithFakeFirebase();
  const now = Date.UTC(2026, 5, 15, 12, 0, 0);

  fake.adminDb._patch('digest_config', 'recently-due', { schedule: enrolledSchedule(), nextRunAt: now - 1000 });
  fake.adminDb._patch('digest_config', 'very-overdue', { schedule: enrolledSchedule(), nextRunAt: now - 1000 * 60 * 60 * 24 * 3 });

  const due = await mod.listDueClientIds(now);
  assert.deepEqual(due, ['very-overdue', 'recently-due']);
});

test('claimDueOccurrence: a due client is claimed and its nextRunAt advances to a real future slot', async () => {
  const { fake, mod } = loadModuleWithFakeFirebase();
  const now = Date.UTC(2026, 5, 15, 12, 0, 0); // Monday, 07:00 CDT — past a 07:00 sendHour, so next slot is tomorrow
  const schedule = enrolledSchedule({ sendHour: 7 });
  fake.adminDb._patch('digest_config', 'client-a', { schedule, nextRunAt: now - 1000 });

  const result = await mod.claimDueOccurrence('client-a', now);
  assert.equal(result.claimed, true);
  assert.ok(result.advancedNextRunAt > now, 'advanced nextRunAt must be strictly after now');

  const stored = fake.adminDb._raw('digest_config', 'client-a');
  assert.equal(stored.nextRunAt, result.advancedNextRunAt, 'the transaction must have persisted the advanced value');
});

test('claimDueOccurrence: a client not yet due is not claimed, and its nextRunAt is untouched', async () => {
  const { fake, mod } = loadModuleWithFakeFirebase();
  const now = Date.UTC(2026, 5, 15, 12, 0, 0);
  const futureNextRunAt = now + 1000 * 60 * 60;
  fake.adminDb._patch('digest_config', 'client-b', { schedule: enrolledSchedule(), nextRunAt: futureNextRunAt });

  const result = await mod.claimDueOccurrence('client-b', now);
  assert.equal(result.claimed, false);
  assert.equal(fake.adminDb._raw('digest_config', 'client-b').nextRunAt, futureNextRunAt);
});

test('claimDueOccurrence: a disabled client is never claimed even with a stale nextRunAt', async () => {
  const { fake, mod } = loadModuleWithFakeFirebase();
  const now = Date.UTC(2026, 5, 15, 12, 0, 0);
  fake.adminDb._patch('digest_config', 'client-c', { schedule: enrolledSchedule({ enabled: false }), nextRunAt: now - 1000 });

  const result = await mod.claimDueOccurrence('client-c', now);
  assert.equal(result.claimed, false);
});

test('claimDueOccurrence: an overdue client (days-stale nextRunAt) is claimed exactly once and the advance skips the backlog, never bursts multiple catch-up sends', async () => {
  const { fake, mod } = loadModuleWithFakeFirebase();
  const now = Date.UTC(2026, 5, 15, 12, 0, 0);
  const schedule = enrolledSchedule({ sendHour: 7 });
  fake.adminDb._patch('digest_config', 'client-d', { schedule, nextRunAt: now - (1000 * 60 * 60 * 24 * 5) }); // 5 days overdue

  const result = await mod.claimDueOccurrence('client-d', now);
  assert.equal(result.claimed, true);
  // The advanced slot must be near `now`, not "5 days after the old stale nextRunAt".
  assert.ok(result.advancedNextRunAt - now <= 1000 * 60 * 60 * 25, 'advanced slot must be within about a day of now, not a backlog-preserving value');

  // Immediately re-checking due status confirms there is nothing left to claim for this client.
  const dueAfter = await mod.listDueClientIds(now);
  assert.ok(!dueAfter.includes('client-d'));
});

test('claimDueOccurrence: CRITICAL — two dispatchers racing on the same due client resolve to exactly one winner, never both, never neither', async () => {
  const { fake, mod } = loadModuleWithFakeFirebase();
  const now = Date.UTC(2026, 5, 15, 12, 0, 0);
  fake.adminDb._patch('digest_config', 'client-e', { schedule: enrolledSchedule({ sendHour: 7 }), nextRunAt: now - 1000 });

  const [r1, r2] = await Promise.all([
    mod.claimDueOccurrence('client-e', now),
    mod.claimDueOccurrence('client-e', now),
  ]);
  const claimedCount = [r1, r2].filter((r) => r.claimed).length;
  assert.equal(claimedCount, 1, `expected exactly one winner, got ${claimedCount} (r1=${JSON.stringify(r1)}, r2=${JSON.stringify(r2)})`);
});

test('claimDueOccurrence: racing dispatchers across DIFFERENT clients claim disjoint sets (both win, independently)', async () => {
  const { fake, mod } = loadModuleWithFakeFirebase();
  const now = Date.UTC(2026, 5, 15, 12, 0, 0);
  fake.adminDb._patch('digest_config', 'client-f', { schedule: enrolledSchedule({ sendHour: 7 }), nextRunAt: now - 1000 });
  fake.adminDb._patch('digest_config', 'client-g', { schedule: enrolledSchedule({ sendHour: 7 }), nextRunAt: now - 1000 });

  const [r1, r2] = await Promise.all([
    mod.claimDueOccurrence('client-f', now),
    mod.claimDueOccurrence('client-g', now),
  ]);
  assert.equal(r1.claimed, true);
  assert.equal(r2.claimed, true);
});

test('saveDigestConfig recomputes nextRunAt on every schedule save, and clears it to null when disabled', async () => {
  const { fake, mod } = loadModuleWithFakeFirebase();
  await mod.saveDigestConfig('client-h', { schedule: enrolledSchedule({ sendHour: 9 }) });
  const enrolled = fake.adminDb._raw('digest_config', 'client-h');
  assert.equal(typeof enrolled.nextRunAt, 'number');
  assert.ok(Number.isFinite(enrolled.nextRunAt));

  await mod.saveDigestConfig('client-h', { schedule: { ...enrolledSchedule({ sendHour: 9 }), enabled: false } });
  const disabled = fake.adminDb._raw('digest_config', 'client-h');
  assert.equal(disabled.nextRunAt, null);
});
