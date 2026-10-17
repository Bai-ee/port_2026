import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDataSources, sourceFor, withSource, withAutoDaily, sourceGroupsPresent, xApiPaidRows, formatXSpendLine, buildPricingBody,
} from '../x-source-model.js';

test('normalize defaults to mac / false and accepts the envelope', () => {
  assert.deepEqual(normalizeDataSources(null), { strategyAccounts: 'mac', quoteTargets: 'mac', autoDaily: { strategyAccounts: false, quoteTargets: false } });
  const n = normalizeDataSources({ dataSources: { quoteTargets: 'x-api', autoDaily: { quoteTargets: true }, strategyAccounts: 'bogus' } });
  assert.equal(n.quoteTargets, 'x-api');
  assert.equal(n.strategyAccounts, 'mac');
  assert.equal(n.autoDaily.quoteTargets, true);
});

test('auto-daily only applies on x-api and clears when switching to mac', () => {
  let s = withAutoDaily(normalizeDataSources({}), 'quote-targets', true);
  assert.equal(s.autoDaily.quoteTargets, false);
  s = withAutoDaily(withSource(s, 'quote-targets', 'x-api'), 'quote-targets', true);
  assert.equal(s.autoDaily.quoteTargets, true);
  s = withSource(s, 'quote-targets', 'mac');
  assert.equal(s.autoDaily.quoteTargets, false);
  assert.equal(sourceFor(s, 'quote-targets'), 'mac');
});

test('toggle shown only for groups in the catalog', () => {
  assert.deepEqual(sourceGroupsPresent([{ id: 'strategy-accounts' }, { id: 'x-monitor' }]), ['strategy-accounts']);
  assert.deepEqual(sourceGroupsPresent([{ id: 'strategy-accounts' }, { id: 'quote-targets' }]), ['strategy-accounts', 'quote-targets']);
});

test('x-api rows join the confirm list, deduped against already-paid', () => {
  const sources = normalizeDataSources({ strategyAccounts: 'x-api', quoteTargets: 'x-api' });
  const sel = { ids: ['strategy-accounts', 'quote-targets', 'x-monitor'] };
  const rows = xApiPaidRows(sel, sources, [{ id: 'quote-targets' }], { 'strategy-accounts': { calls: 12, maxPosts: 600 } }, [{ id: 'strategy-accounts', label: 'Strategy accounts' }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].estimate.calls, 12);
  assert.match(rows[0].estimate.text, /12 calls, up to 600 posts/);
  assert.deepEqual(xApiPaidRows(sel, normalizeDataSources({}), []), []);
});

test('spend line: dollars only with a rate, cap when set', () => {
  assert.equal(formatXSpendLine({ today: { calls: 3, posts: 120 } }), 'X API today: 3 calls · 120 posts · no rate set');
  assert.equal(formatXSpendLine({ today: { calls: 1, posts: 1, estUsd: 0.5 }, cap: { dailyReadCap: 500 } }), 'X API today: 1 call · 1 post · ~$0.50 (cap 500)');
  assert.equal(formatXSpendLine(null), 'X API today: unavailable');
});

test('pricing body validates', () => {
  assert.deepEqual(buildPricingBody({ perPostReadUsd: '0.005', dailyReadCap: '500.7', perUserLookupUsd: '' }).body, { action: 'set-pricing', perPostReadUsd: 0.005, dailyReadCap: 500 });
  assert.ok(buildPricingBody({ perPostReadUsd: '-1' }).error);
  assert.ok(buildPricingBody({}).error);
});
