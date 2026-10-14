import assert from 'node:assert/strict';
import test from 'node:test';
import {
  planHomePriors, HOME_PRIORS, planHomeStrategyPlan, planHomeStrategyDoc,
  HOME_STRATEGY_SECTIONS, HOME_CONTENT_TRACKS, HOME_BENCHMARK_PRIMARY,
} from '../seed-home-priors.mjs';
import { createMemoryPlanStore } from '../../../features/x-strategy/plan-store.js';
import { createMemoryStrategyDocStore } from '../../../features/x-strategy/strategy-doc-store.js';
import { SECTION_KEYS } from '../../../features/x-strategy/strategy-doc.js';
import { DEFAULT_TRACKS, tracksOf } from '../../../features/x-strategy/content-tracks.js';
import { SEED_STRATEGY_SECTIONS } from '../../../features/x-strategy/strategy-doc-seed.js';
import { DEFAULT_PLAN } from '../../../features/x-strategy/contracts.js';
import { HOME_SEED_WATCHLIST } from '../../../features/x-quote-targets/watchlist.js';

test('planHomePriors: an empty / absent xGrowth gets every home prior', () => {
  for (const xGrowth of [null, undefined, {}, { ownHandle: '', benchmarkHandles: [], timezone: ' ', watchlist: [] }]) {
    const p = planHomePriors(xGrowth);
    assert.deepEqual(p.fill, ['ownHandle', 'benchmarkHandles', 'timezone', 'watchlist']);
    assert.deepEqual(p.keep, []);
    assert.equal(p.patch.ownHandle, 'bai_ee');
    assert.deepEqual(p.patch.benchmarkHandles, ['seb__design']);
    assert.equal(p.patch.timezone, 'America/Chicago');
    assert.deepEqual(p.patch.watchlist, HOME_SEED_WATCHLIST);
    assert.notEqual(p.patch.watchlist, HOME_SEED_WATCHLIST, 'a copy, not the module constant');
  }
});

test('planHomePriors: fills ONLY empty fields, never overwrites a saved value', () => {
  const saved = { enabled: true, ownHandle: 'someone', benchmarkHandles: ['rival'], timezone: 'Europe/Paris', watchlist: [{ handle: 'mine', vein: 'craft-tools' }] };
  const all = planHomePriors(saved);
  assert.deepEqual(all, { patch: {}, fill: [], keep: ['ownHandle', 'benchmarkHandles', 'timezone', 'watchlist'] });

  const partial = planHomePriors({ ownHandle: 'bai_ee', timezone: 'America/New_York' });
  assert.deepEqual(partial.fill, ['benchmarkHandles', 'watchlist']);
  assert.deepEqual(Object.keys(partial.patch), ['benchmarkHandles', 'watchlist']);
  assert.equal('ownHandle' in partial.patch, false);
  assert.equal('timezone' in partial.patch, false);
});

test('HOME_PRIORS are today\'s home values', () => {
  assert.equal(HOME_PRIORS.ownHandle, 'bai_ee');
  assert.deepEqual([...HOME_PRIORS.benchmarkHandles], ['seb__design']);
  assert.equal(HOME_PRIORS.timezone, 'America/Chicago');
  assert.equal(HOME_PRIORS.watchlist.length, HOME_SEED_WATCHLIST.length);
});

// --- Phase 4.7: strategy doc + plan tracks/benchmark ------------------------------------------------------------

test('code carries no home priors: blank seed, no default tracks, no default benchmark', () => {
  assert.deepEqual([...DEFAULT_TRACKS], []);
  assert.equal(DEFAULT_PLAN.benchmarkPrimary, '');
  for (const k of SECTION_KEYS) assert.equal(SEED_STRATEGY_SECTIONS[k], '');
  for (const k of SECTION_KEYS) assert.ok(HOME_STRATEGY_SECTIONS[k], `home text has ${k}`);
  assert.match(HOME_STRATEGY_SECTIONS.thesis, /Show the work, not the casino/);
});

test('planHomeStrategyPlan: absent plan / no contentTracks => fill tracks + benchmark', () => {
  for (const doc of [null, { version: 2, plan: { authoredPerDay: 4, benchmarkPrimary: '' } }]) {
    const p = planHomeStrategyPlan(doc);
    assert.deepEqual(p.fill, ['contentTracks', 'benchmarkPrimary']);
    assert.deepEqual(p.keep, []);
    assert.deepEqual(p.changes.contentTracks.map((t) => t.id), ['design', 'music']);
    assert.equal(p.changes.benchmarkPrimary, HOME_BENCHMARK_PRIMARY);
    assert.equal(p.expectedVersion, doc?.version ?? 0);
  }
});

test('planHomeStrategyPlan: stored tracks (even []) and a stored benchmark are kept', () => {
  const p = planHomeStrategyPlan({ version: 5, plan: { contentTracks: [], benchmarkPrimary: 'someone' } });
  assert.deepEqual(p, { changes: {}, fill: [], keep: ['contentTracks', 'benchmarkPrimary'], expectedVersion: 5 });
  const q = planHomeStrategyPlan({ version: 1, plan: { benchmarkPrimary: 'seb__design' } });
  assert.deepEqual(q.fill, ['contentTracks']);
  assert.deepEqual(q.keep, ['benchmarkPrimary']);
});

test('planHomeStrategyDoc: fills only when the doc is absent', () => {
  const p = planHomeStrategyDoc(null);
  assert.equal(p.fill, true);
  assert.deepEqual(p.sections, { ...HOME_STRATEGY_SECTIONS });
  assert.deepEqual(planHomeStrategyDoc({ version: 1, sections: { thesis: 'mine' } }), { fill: false, sections: null });
});

test('seed writes through the versioned stores: home gets its priors, an existing doc/tracks are never touched', async () => {
  const planStore = createMemoryPlanStore();
  const docStore = createMemoryStrategyDocStore();
  const p = planHomeStrategyPlan(await planStore.get('home'));
  await planStore.apply('home', { changes: p.changes, by: 'seed-home-priors', source: 'manual', reason: 'seed', expectedVersion: p.expectedVersion });
  const d = planHomeStrategyDoc(await docStore.get('home'));
  await docStore.apply('home', { sections: d.sections, by: 'seed-home-priors', source: 'seed', expectedVersion: 0 });

  const plan = await planStore.get('home');
  assert.deepEqual(tracksOf(plan).map((t) => [t.id, t.benchmarks]), [['design', ['seb__design']], ['music', []]]);
  assert.equal(plan.plan.benchmarkPrimary, 'seb__design');
  const doc = await docStore.get('home');
  assert.equal(doc.confirmed, false, 'seeded text stays an unconfirmed draft');
  assert.equal(doc.sections.thesis, HOME_STRATEGY_SECTIONS.thesis);

  // Re-run: nothing left to fill.
  assert.deepEqual(planHomeStrategyPlan(await planStore.get('home')).fill, []);
  assert.equal(planHomeStrategyDoc(await docStore.get('home')).fill, false);
  // A doc created in between is never overwritten (expectedVersion 0 conflicts).
  await assert.rejects(docStore.apply('home', { sections: d.sections, by: 'x', source: 'seed', expectedVersion: 0 }), (e) => e.code === 'version-conflict');
  // Another client is untouched.
  assert.equal(await planStore.get('other'), null);
  assert.deepEqual(tracksOf(await planStore.get('other')), []);
  assert.equal(HOME_CONTENT_TRACKS.length, 2);
});
