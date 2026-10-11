import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryPlanStore, createFirestorePlanStore, StrategyPlanError } from '../plan-store.js';

const req = (over = {}) => ({ changes: { authoredPerDay: 6 }, by: 'owner', source: 'manual', reason: 'r', expectedVersion: 0, ...over });

test('absent doc: get returns null and nothing is created', async () => {
  const s = createMemoryPlanStore();
  assert.equal(await s.get('c1'), null);
  assert.equal(await s.get('c1'), null);
});

test('first write expectedVersion 0 creates v1; get returns it', async () => {
  const s = createMemoryPlanStore();
  const { doc, changed } = await s.apply('c1', req());
  assert.equal(changed, true);
  assert.equal(doc.version, 1);
  assert.equal((await s.get('c1')).plan.authoredPerDay, 6);
});

test('stale expectedVersion -> StrategyPlanError version-conflict (409), doc untouched', async () => {
  const s = createMemoryPlanStore();
  await s.apply('c1', req());
  const before = JSON.stringify(await s.get('c1'));
  await assert.rejects(s.apply('c1', req({ changes: { authoredPerDay: 9 }, expectedVersion: 0 })), (e) => {
    assert.ok(e instanceof StrategyPlanError);
    assert.equal(e.code, 'version-conflict');
    assert.equal(e.status, 409);
    assert.equal(e.currentVersion, 1);
    return true;
  });
  assert.equal(JSON.stringify(await s.get('c1')), before);
});

test('invalid -> 400; noop -> changed:false, no bump', async () => {
  const s = createMemoryPlanStore();
  await assert.rejects(s.apply('c1', req({ changes: { authoredPerDay: 0 } })), (e) => e.code === 'invalid' && e.status === 400 && e.errors.length > 0);
  assert.equal(await s.get('c1'), null);
  await s.apply('c1', req());
  const r = await s.apply('c1', req({ expectedVersion: 1 }));
  assert.equal(r.changed, false);
  assert.equal((await s.get('c1')).version, 1);
});

test('concurrent apply with same expectedVersion: exactly one wins', async () => {
  const s = createMemoryPlanStore();
  const results = await Promise.allSettled([
    s.apply('c1', req({ changes: { authoredPerDay: 5 } })),
    s.apply('c1', req({ changes: { authoredPerDay: 9 } })),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const lost = results.find((r) => r.status === 'rejected');
  assert.equal(lost.reason.code, 'version-conflict');
  const doc = await s.get('c1');
  assert.equal(doc.version, 1);
  assert.equal(doc.history.length, 1);
});

test('clients are isolated; bad clientId invalid', async () => {
  const s = createMemoryPlanStore();
  await s.apply('a', req());
  assert.equal(await s.get('b'), null);
  await assert.rejects(s.get(''), (e) => e.code === 'invalid');
  await assert.rejects(s.apply('a/b', req()), (e) => e.code === 'invalid');
});

test('revert: not-found when absent; restores plan, bumps version; dropped version -> invalid', async () => {
  const s = createMemoryPlanStore();
  await assert.rejects(s.revert('c1', 1, { by: 'o' }), (e) => e.code === 'not-found' && e.status === 404);
  await s.apply('c1', req({ changes: { authoredPerDay: 6 } }));
  await s.apply('c1', req({ changes: { authoredPerDay: 10 }, expectedVersion: 1 }));
  const { doc } = await s.revert('c1', 1, { by: 'o' });
  assert.equal(doc.version, 3);
  assert.equal(doc.plan.authoredPerDay, 6);
  assert.equal((await s.get('c1')).version, 3);
  await assert.rejects(s.revert('c1', 99, { by: 'o' }), (e) => e.code === 'invalid');
  for (let i = 3; i < 40; i += 1) await s.apply('c1', req({ changes: { authoredPerDay: 2 + (i % 2) }, expectedVersion: i }));
  await assert.rejects(s.revert('c1', 1, { by: 'o' }), (e) => e.code === 'invalid' && e.reason === 'version-unavailable');
});

test('firestore store writes only x_strategy_plans/{clientId} via a transaction', async () => {
  const writes = []; const store = new Map();
  const ref = (path) => ({ path });
  const db = {
    collection: (c) => ({ doc: (id) => ref(`${c}/${id}`) }),
    runTransaction: async (fn) => fn({
      get: async (r) => ({ exists: store.has(r.path), data: () => store.get(r.path) }),
      set: (r, d) => { writes.push(r.path); store.set(r.path, d); },
    }),
  };
  const s = createFirestorePlanStore(db);
  assert.equal(await s.get('c1').catch(() => 'threw'), 'threw'); // db.get not provided: proves get() reads via ref
  await s.apply('c1', req());
  assert.deepEqual(writes, ['x_strategy_plans/c1']);
  await assert.rejects(s.apply('c1', req({ expectedVersion: 0, changes: { authoredPerDay: 9 } })), (e) => e.code === 'version-conflict');
  assert.equal(writes.length, 1);
  await s.apply('c1', req({ expectedVersion: 1 })); // noop -> no write
  assert.equal(writes.length, 1);
});
