import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScanPlan, partitionPool, DEFAULT_BUDGET } from '../scan-plan.js';

const acct = (handle, over = {}) => ({ handle, vein: 'design', weight: 100, unproven: false, ...over });

test('an account two clients want is fetched once', () => {
  const plan = buildScanPlan([
    { clientId: 'a', accounts: [acct('shared'), acct('only_a')] },
    { clientId: 'b', accounts: [acct('shared'), acct('only_b')] },
  ]);
  assert.equal(plan.meta.uniqueAccounts, 3);
  assert.equal(plan.meta.naiveFetches, 4, 'per-client sweeps would have fetched 4');
  assert.equal(plan.meta.plannedFetches, 3);
  const shared = plan.fetch.find((a) => a.handle === 'shared');
  assert.deepEqual(shared.clients.sort(), ['a', 'b']);
});

test('shared accounts outrank higher-weighted single-client ones', () => {
  // Rate limit is the scarce resource; a fetch that serves two clients buys
  // more than one that serves one.
  const plan = buildScanPlan([
    { clientId: 'a', accounts: [acct('shared', { weight: 10 }), acct('solo', { weight: 5000 })] },
    { clientId: 'b', accounts: [acct('shared', { weight: 10 })] },
  ]);
  assert.equal(plan.fetch[0].handle, 'shared');
});

test('the budget caps the sweep and the rest is reported, not dropped silently', () => {
  const accounts = Array.from({ length: 40 }, (_, i) => acct(`acct${String(i).padStart(2, '0')}`, { weight: 1000 - i }));
  const plan = buildScanPlan([{ clientId: 'a', accounts }], { budget: 15 });
  assert.equal(plan.fetch.length, 15);
  assert.equal(plan.skipped.length, 25);
  assert.equal(plan.meta.budget, 15);
});

test('the default budget matches the measured rate-limit ceiling', () => {
  // A 39-account sweep returned 429 on 32 of them.
  assert.equal(DEFAULT_BUDGET, 15);
});

test('rotation reaches accounts below the cut without evicting the top ones', () => {
  const accounts = Array.from({ length: 10 }, (_, i) => acct(`a${i}`, { weight: 1000 - i }));
  const first = buildScanPlan([{ clientId: 'c', accounts }], { budget: 4, offset: 0 });
  const second = buildScanPlan([{ clientId: 'c', accounts }], { budget: 4, offset: 3 });
  assert.notDeepEqual(first.fetch.map((a) => a.handle), second.fetch.map((a) => a.handle));
  // The single most valuable account stays in every sweep.
  assert.equal(first.fetch[0].handle, 'a0');
  assert.equal(second.fetch[0].handle, 'a0');
});

test('a client starved by the budget is named', () => {
  const plan = buildScanPlan([
    { clientId: 'rich', accounts: Array.from({ length: 5 }, (_, i) => acct(`r${i}`, { weight: 900 })) },
    { clientId: 'poor', accounts: [acct('p0', { weight: 1 })] },
  ], { budget: 3 });
  assert.deepEqual(plan.meta.starvedClients, ['poor']);
});

test('proven accounts beat unproven ones at equal value', () => {
  const plan = buildScanPlan([{
    clientId: 'a',
    accounts: [acct('unproven_one', { weight: 0, unproven: true }), acct('proven_one', { weight: 0, unproven: false })],
  }], { budget: 1 });
  assert.equal(plan.fetch[0].handle, 'proven_one');
});

test('an account is proven for the sweep if it is proven for anyone', () => {
  const plan = buildScanPlan([
    { clientId: 'a', accounts: [acct('x', { unproven: true })] },
    { clientId: 'b', accounts: [acct('x', { unproven: false })] },
  ]);
  assert.equal(plan.fetch[0].unproven, false);
});

test('ordering does not depend on input order', () => {
  const a = [{ clientId: 'a', accounts: [acct('m'), acct('z'), acct('b')] }];
  const b = [{ clientId: 'a', accounts: [acct('z'), acct('b'), acct('m')] }];
  assert.deepEqual(
    buildScanPlan(a).fetch.map((x) => x.handle),
    buildScanPlan(b).fetch.map((x) => x.handle),
  );
});

test('handles differing only by @ or case are one account', () => {
  const plan = buildScanPlan([
    { clientId: 'a', accounts: [acct('@RareJpg')] },
    { clientId: 'b', accounts: [acct('rarejpg')] },
  ]);
  assert.equal(plan.meta.uniqueAccounts, 1);
  assert.equal(plan.fetch[0].clients.length, 2);
});

test('the pooled fetch is split back to exactly the clients who asked', () => {
  const plan = buildScanPlan([
    { clientId: 'a', accounts: [acct('shared'), acct('only_a')] },
    { clientId: 'b', accounts: [acct('shared')] },
  ]);
  const pool = [
    { id: '1', author: { username: 'shared' } },
    { id: '2', author: { username: 'only_a' } },
    { id: '3', author: { username: 'nobody_asked' } },
  ];
  const split = partitionPool(pool, plan);
  assert.deepEqual(split.a.map((p) => p.id), ['1', '2']);
  assert.deepEqual(split.b.map((p) => p.id), ['1'], 'b must not receive a\'s account');
});

test('a client with nothing fetched gets an empty list, not a missing key', () => {
  const plan = buildScanPlan([{ clientId: 'a', accounts: [acct('x')] }, { clientId: 'b', accounts: [] }]);
  const split = partitionPool([], plan);
  assert.deepEqual(split.b, []);
});

test('never throws on junk', () => {
  for (const input of [null, 'x', 42, [null, {}, { clientId: 'a' }]]) {
    const plan = buildScanPlan(input);
    assert.ok(Array.isArray(plan.fetch));
  }
  assert.deepEqual(partitionPool(null, null), {});
});
