import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireSyncLease, SYNC_LEASE_MS } from '../sync-lease.js';
import { SYNC_THROTTLE_MS } from '../sync.js';

const NOW = 10_000_000_000;
function makeDeps(meta) {
  const patches = [];
  return { patches, transact: (fn) => fn({ read: async () => meta, merge: (p) => patches.push(p) }) };
}

test('missing meta acquires and stamps syncStartedAtMs', async () => {
  const d = makeDeps(null);
  assert.deepEqual(await acquireSyncLease(d, { now: NOW }), { acquired: true });
  assert.deepEqual(d.patches, [{ syncStartedAtMs: NOW }]);
});
test('recent lastSync is throttled', async () => {
  const d = makeDeps({ lastSyncAtMs: NOW - SYNC_THROTTLE_MS + 1000 });
  assert.deepEqual(await acquireSyncLease(d, { now: NOW }), { acquired: false, skipped: 'throttled' });
  assert.equal(d.patches.length, 0);
});
test('fresh lease is skipped', async () => {
  const d = makeDeps({ lastSyncAtMs: NOW - SYNC_THROTTLE_MS - 1, syncStartedAtMs: NOW - SYNC_LEASE_MS + 1000 });
  assert.deepEqual(await acquireSyncLease(d, { now: NOW }), { acquired: false, skipped: 'leased' });
  assert.equal(d.patches.length, 0);
});
test('stale lease and old lastSync acquires', async () => {
  const d = makeDeps({ lastSyncAtMs: NOW - SYNC_THROTTLE_MS - 1, syncStartedAtMs: NOW - SYNC_LEASE_MS - 1 });
  assert.deepEqual(await acquireSyncLease(d, { now: NOW }), { acquired: true });
  assert.deepEqual(d.patches, [{ syncStartedAtMs: NOW }]);
});
