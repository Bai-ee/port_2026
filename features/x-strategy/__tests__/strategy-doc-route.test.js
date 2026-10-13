import test from 'node:test';
import assert from 'node:assert/strict';
import { createStrategyHandlers } from '../route-handlers.js';
import { createMemoryCorpusStore } from '../corpus-store.js';
import { createMemoryPlanStore } from '../plan-store.js';
import { createRefreshService, createMemoryRefreshQueue } from '../refresh.js';
import { createMemoryStrategyDocStore } from '../strategy-doc-store.js';
import { SEED_STRATEGY_SECTIONS } from '../strategy-doc-seed.js';
import { SECTION_KEYS } from '../strategy-doc.js';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const CTX = { clientId: 'c1' };
const AUTH = { decoded: { email: 'owner@x.test' } };

function setup({ withDoc = true } = {}) {
  const corpusStore = createMemoryCorpusStore({ loadCommitted: () => null });
  const refreshService = createRefreshService({
    store: corpusStore, queueStore: createMemoryRefreshQueue(), now: () => NOW, enabled: false,
    detectBird: async () => ({ available: false }), idGen: () => 'r1', ingest: async () => ({ rows: [], pull: {} }), runBirdFor: () => () => '',
  });
  const docStore = withDoc ? createMemoryStrategyDocStore() : null;
  const h = createStrategyHandlers({
    corpusStore, planStore: createMemoryPlanStore(), refreshService, clock: () => NOW,
    readXGrowthConfig: async () => ({ ownHandle: 'me_acct', benchmarkHandles: ['bench_a'] }), docStore,
  });
  return { docStore, call: (a, b = {}) => h.handle(a, { clientId: 'c1', ...b }, CTX, AUTH) };
}

test('strategy-doc-get returns the seeded draft until a save, plus section metadata', async () => {
  const { call, docStore } = setup();
  const r = await call('strategy-doc-get');
  assert.equal(r.ok, true);
  assert.equal(r.doc.version, 0);
  assert.equal(r.doc.confirmed, false);
  assert.equal(r.doc.isDraft, true);
  assert.equal(r.doc.sections.thesis, SEED_STRATEGY_SECTIONS.thesis);
  assert.deepEqual(r.sections.map((s) => s.key), [...SECTION_KEYS]);
  assert.equal(await docStore.get('c1'), null, 'a read never persists the draft');
});

test('strategy-doc-save writes version 1 from the draft, confirms, and reports the change', async () => {
  const { call } = setup();
  const r = await call('strategy-doc-save', { sections: { rules: 'No hashtags.' }, expectedVersion: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.doc.version, 1);
  assert.equal(r.doc.confirmed, true);
  assert.equal(r.doc.sections.thesis, SEED_STRATEGY_SECTIONS.thesis);
  assert.equal(r.doc.history[0].by, 'owner@x.test');
  assert.match(r.change, /Strategy v1 - Rules edited by owner@x.test/);
});

test('strategy-doc-save: stale version -> 409 with currentVersion; bad section -> 400', async () => {
  const { call } = setup();
  await call('strategy-doc-save', { sections: { rules: 'a' }, expectedVersion: 0 });
  const stale = await call('strategy-doc-save', { sections: { rules: 'b' }, expectedVersion: 0 });
  assert.equal(stale.ok, false);
  assert.equal(stale.status, 409);
  assert.equal(stale.currentVersion, 1);
  const bad = await call('strategy-doc-save', { sections: { nope: 'b' }, expectedVersion: 1 });
  assert.equal(bad.status, 400);
});

test('strategy-doc-revert restores a version as a new one; unknown client doc -> 404', async () => {
  const { call } = setup();
  await call('strategy-doc-save', { sections: { thesis: 'one' }, expectedVersion: 0 });
  await call('strategy-doc-save', { sections: { thesis: 'two' }, expectedVersion: 1 });
  const r = await call('strategy-doc-revert', { version: 1 });
  assert.equal(r.doc.version, 3);
  assert.equal(r.doc.sections.thesis, 'one');
  const other = setup();
  assert.equal((await other.call('strategy-doc-revert', { version: 1 })).status, 404);
});

test('doc actions answer 503 without a docStore and 403 for another client', async () => {
  const { call } = setup({ withDoc: false });
  assert.equal((await call('strategy-doc-get')).status, 503);
  const s = setup();
  assert.equal((await s.call('strategy-doc-get', { clientId: 'c2' })).status, 403);
});
