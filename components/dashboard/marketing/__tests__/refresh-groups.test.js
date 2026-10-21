import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateFor, paidGroupsFor, skippedGroupsFor } from '../refresh-groups.js';

test('empty ctx falls back to the static cost string with no dollars', () => {
  const e = estimateFor('market-signals', {});
  assert.equal(e.usd, null);
  assert.match(e.text, /Scout/);
  assert.equal(estimateFor('renders').usd, null);
});

test('market-signals counts sources (excl. X), un-parked handles, skills; dollars are a floor', () => {
  const e = estimateFor('market-signals', {
    marketingBriefConfig: { sourcePlatforms: ['web', 'x', 'reddit'], kols: ['@a', 'b', 'c'], kolsOff: ['c'], analysisRecipes: ['r1'] },
  });
  assert.equal(e.text, '2 sources · 2 handles · 1 skill · ≥~$0.10');
  assert.equal(e.usd, 0.1);
});

test('free groups say free', () => {
  assert.deepEqual(estimateFor('strategy-accounts'), { text: 'free', usd: 0 });
  assert.equal(estimateFor('today-queue', {}).text, 'free');
});

test('today-queue with model: per-slot text, no dollars', () => {
  assert.equal(estimateFor('today-queue', { todayWithModel: true, todaySlots: 3 }).text, '1 Claude call per slot · 3 slots');
  assert.equal(estimateFor('today-queue', { todayWithModel: true }).text, '1 Claude call per slot');
  assert.equal(estimateFor('today-queue', { todayWithModel: true }).usd, null);
});

test('x-monitor: 2 + 1 per 1,000 followers; x-search caps at maxQueriesPerRun', () => {
  assert.equal(estimateFor('x-monitor', {}).calls, 3);
  assert.equal(estimateFor('x-monitor', { xMonitorState: { profile: { followers: 2500 } } }).text, '5 metered X calls');
  const q = (n) => Array.from({ length: n }, (_, i) => ({ query: `q${i}`, enabled: true }));
  assert.equal(estimateFor('x-search', { marketingBriefConfig: { opportunitySignals: { queries: q(6), maxQueriesPerRun: 4 } } }).calls, 4);
});

test('paidGroupsFor stays backward compatible and attaches estimates only with ctx', () => {
  const sel = { ids: ['x-monitor'], todayWithModel: false };
  assert.equal(paidGroupsFor(sel)[0].estimate, undefined);
  assert.equal(paidGroupsFor(sel, {})[0].estimate.calls, 3);
});

test('groupFreshness: local memory, server asOf (newer wins), stale, none', async () => {
  const { groupFreshness } = await import('../refresh-groups.js');
  const now = Date.parse('2026-10-17T12:00:00Z');
  const none = groupFreshness('analysis', { now });
  assert.deepEqual(none, { asOf: null, ageHours: null, stale: true, source: null });
  const local = groupFreshness('analysis', { now, lastRefreshed: { analysis: '2026-10-17T09:00:00Z' } });
  assert.equal(local.ageHours, 3); assert.equal(local.stale, false); assert.equal(local.source, 'local');
  const server = groupFreshness('analysis', { now, lastRefreshed: { analysis: '2026-10-17T09:00:00Z' }, serverAsOf: { analysis: '2026-10-17T11:00:00Z' } });
  assert.equal(server.source, 'server'); assert.equal(server.ageHours, 1);
  const old = groupFreshness('analysis', { now, serverAsOf: { analysis: '2026-10-15T12:00:00Z' } });
  assert.equal(old.stale, true);
  assert.equal(groupFreshness('analysis', { now, serverAsOf: { analysis: '2026-10-16T12:00:00Z' }, staleAfterHours: 48 }).stale, false);
});

test('skippedGroupsFor lists unselected groups in catalog order with a reason', () => {
  const out = skippedGroupsFor(['today-queue', 'market-signals']);
  assert.equal(out.length, 7);
  assert.deepEqual(out.map((g) => g.id), ['x-search', 'analysis', 'strategy-accounts', 'x-monitor', 'renders', 'quote-targets', 'hot-quotes']);
  assert.equal(out.find((g) => g.id === 'x-monitor').reason, 'paid groups start off; tick it in Refresh settings');
  assert.equal(out.find((g) => g.id === 'x-monitor').label, 'X Monitor');
  assert.equal(out.find((g) => g.id === 'strategy-accounts').reason, 'not selected');
});

test('skippedGroupsFor treats x-api source groups as paid; bad input skips everything', () => {
  const out = skippedGroupsFor([], { dataSources: { quoteTargets: 'x-api' } });
  assert.match(out.find((g) => g.id === 'quote-targets').reason, /paid groups/);
  assert.equal(skippedGroupsFor(undefined).length, 9);
});
