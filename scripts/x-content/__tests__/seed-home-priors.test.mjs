import assert from 'node:assert/strict';
import test from 'node:test';
import { planHomePriors, HOME_PRIORS } from '../seed-home-priors.mjs';
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
