import assert from 'node:assert/strict';
import test from 'node:test';
import { planBackfill, applyBackfill, BATCH_MAX } from '../backfill-package-client.mjs';

test('planBackfill: only rows without a clientId are planned; existing clientIds are counted, never touched', () => {
  const p = planBackfill([{ id: 'a' }, { id: 'b', clientId: '' }, { id: 'c', clientId: 'x' }, { id: 'd', clientId: '  ' }, { id: 'e', clientId: 'x' }, { id: 'f', clientId: 'y' }]);
  assert.equal(p.total, 6);
  assert.deepEqual(p.missing, ['a', 'b', 'd']);
  assert.deepEqual(p.byClient, { x: 2, y: 1 });
  assert.equal(p.batches.length, 1);
});

test('planBackfill: batches never exceed BATCH_MAX; an already-backfilled set plans nothing (idempotent)', () => {
  const rows = Array.from({ length: BATCH_MAX * 2 + 1 }, (_, i) => ({ id: `r${i}` }));
  assert.deepEqual(planBackfill(rows).batches.map((b) => b.length), [BATCH_MAX, BATCH_MAX, 1]);
  const done = planBackfill(rows.map((r) => ({ ...r, clientId: 'home' })));
  assert.equal(done.missing.length, 0);
  assert.equal(done.batches.length, 0);
});

test('applyBackfill writes one merged clientId field per planned id, batch by batch', async () => {
  const commits = [];
  const db = {
    collection: (c) => ({ doc: (id) => ({ c, id }) }),
    batch: () => { const ops = []; return { set: (ref, data, opts) => ops.push({ ref, data, opts }), commit: async () => commits.push(ops) }; },
  };
  const n = await applyBackfill(db, planBackfill([{ id: 'a' }, { id: 'b', clientId: 'z' }, { id: 'c' }]), 'home');
  assert.equal(n, 2);
  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0].map((o) => [o.ref.c, o.ref.id, o.data, o.opts]), [
    ['x_content_packages', 'a', { clientId: 'home' }, { merge: true }],
    ['x_content_packages', 'c', { clientId: 'home' }, { merge: true }],
  ]);
});
