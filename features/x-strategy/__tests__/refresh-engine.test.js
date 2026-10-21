import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgentRefresh, agentRefreshAvailability, agentRefreshStatus, planGroup, PLACEHOLDER_USD } from '../agent/refresh-engine.js';
import { createMemoryRefreshSpendStore, utcDayKey } from '../agent/refresh-spend.js';
import { normalizeAutonomy, normalizeTrustedRefresh } from '../agent/action-runtime.js';
import { AGENT_REFRESH_GROUP_IDS, REFRESH_GROUP_IDS } from '../contracts.js';

const NOW = Date.parse('2026-10-21T15:00:00Z');
const never = () => new Promise(() => {});

function fakeDeps(over = {}) {
  const calls = [];
  const deps = {
    calls,
    spend: createMemoryRefreshSpendStore(),
    getSources: async () => ({ strategyAccounts: 'mac', quoteTargets: 'mac' }),
    digestPhase: async (a) => { calls.push(['digest', a.phase, a.group]); return { ok: true }; },
    paidSync: async (a) => { calls.push(['paidSync', a.kind]); return { kind: a.kind, calls: 3 }; },
    queueScan: async ({ mode }) => { calls.push(['scan', mode]); return { requestId: `req-${mode}`, status: 'queued' }; },
    requestStrategyRefresh: async () => { calls.push(['strategy']); return { requestId: 'req-strategy', status: 'queued' }; },
    pullStrategyAccounts: async () => { calls.push(['pull']); return { ok: true, calls: 6, posts: 600 }; },
    generateToday: async () => { calls.push(['today']); return { ok: true, run: { suggestions: [1, 2] } }; },
    ...over,
  };
  return deps;
}

test('agent group ids: the panel groups minus x-search, plus recent-posts', () => {
  assert.ok(!AGENT_REFRESH_GROUP_IDS.includes('x-search'));
  assert.ok(AGENT_REFRESH_GROUP_IDS.includes('recent-posts'));
  assert.ok(!REFRESH_GROUP_IDS.includes('recent-posts')); // REFRESH_GROUP_IDS mirrors the panel catalog
});

test('free groups always run, even with the policy off: server group done, Mac groups queued with ETA', async () => {
  const deps = fakeDeps();
  const out = await runAgentRefresh({ clientId: 'c1', groups: ['today-queue', 'recent-posts', 'hot-quotes', 'bookmarks', 'quote-targets', 'strategy-accounts'], deps, policy: { enabled: false, dailyCapUsd: 1 }, now: NOW });
  const by = Object.fromEntries(out.results.map((r) => [r.group, r]));
  assert.equal(by['today-queue'].status, 'done');
  assert.equal(by['today-queue'].mode, 'server');
  assert.deepEqual(['recent-posts', 'hot-quotes', 'bookmarks', 'quote-targets', 'strategy-accounts'].map((g) => [by[g].mode, by[g].status, by[g].etaSeconds]),
    [['mac', 'queued', 60], ['mac', 'queued', 480], ['mac', 'queued', 120], ['mac', 'queued', 240], ['mac', 'queued', 180]]);
  assert.deepEqual(deps.calls.filter((c) => c[0] === 'scan').map((c) => c[1]).sort(), ['bookmarks', 'hot', 'quote', 'recent-posts']);
  assert.equal(out.spentUsd, 0);
  assert.equal(out.ok, true);
  assert.deepEqual(out.pendingRequestIds.sort(), ['req-bookmarks', 'req-hot', 'req-quote', 'req-recent-posts', 'req-strategy']);
});

test('paid groups under the cap run, record spend, and respect the running total', async () => {
  const deps = fakeDeps();
  const out = await runAgentRefresh({ clientId: 'c1', groups: ['market-signals', 'analysis'], deps, policy: { enabled: true, dailyCapUsd: 1 }, now: NOW });
  assert.deepEqual(out.results.map((r) => [r.group, r.mode, r.status]), [['market-signals', 'paid', 'done'], ['analysis', 'paid', 'done']]);
  assert.deepEqual(deps.calls, [['digest', 'signals', 'market-signals'], ['digest', 'analysis', 'analysis']]);
  assert.equal(out.spentUsd, PLACEHOLDER_USD['market-signals'] + PLACEHOLDER_USD.analysis);
  const ledger = await deps.spend.get('c1', utcDayKey(NOW));
  assert.equal(ledger.usd, 0.35);
  assert.deepEqual(ledger.runs.map((r) => r.group), ['market-signals', 'analysis']);
});

test('paid over the cap or with the policy off is needs-confirm and runs nothing', async () => {
  const off = fakeDeps();
  const a = await runAgentRefresh({ clientId: 'c1', groups: ['x-monitor', 'renders'], deps: off, policy: { enabled: false, dailyCapUsd: 5 }, now: NOW });
  assert.deepEqual(a.results.map((r) => r.status), ['needs-confirm', 'needs-confirm']);
  assert.match(a.results[0].detail, /propose_refresh/);
  assert.equal(off.calls.length, 0);
  assert.equal(a.spentUsd, 0);
  assert.match(a.guidance, /propose_refresh/);

  const capped = fakeDeps();
  await capped.spend.add('c1', utcDayKey(NOW), { at: 'x', group: 'analysis', usd: 0.9 });
  const b = await runAgentRefresh({ clientId: 'c1', groups: ['analysis', 'today-queue'], deps: capped, policy: { enabled: true, dailyCapUsd: 1 }, now: NOW });
  assert.deepEqual(b.results.map((r) => [r.group, r.status]), [['analysis', 'needs-confirm'], ['today-queue', 'done']]); // free group still ran
  assert.match(b.results[0].detail, /cap/);
});

test('two paid groups cannot both squeeze under one cap', async () => {
  const deps = fakeDeps();
  const out = await runAgentRefresh({ clientId: 'c1', groups: ['renders', 'analysis', 'market-signals'], deps, policy: { enabled: true, dailyCapUsd: 0.6 }, now: NOW });
  assert.deepEqual(out.results.map((r) => r.status), ['done', 'needs-confirm', 'done']); // 0.50 fits; +0.25 would pass 0.60; +0.10 lands exactly on it
});

test('x-api strategy-accounts is paid; x-api quote-targets is never auto-started; x-search is refused', async () => {
  const deps = fakeDeps({ getSources: async () => ({ strategyAccounts: 'x-api', quoteTargets: 'x-api' }) });
  const out = await runAgentRefresh({ clientId: 'c1', groups: ['strategy-accounts', 'quote-targets', 'x-search'], deps, policy: { enabled: true, dailyCapUsd: 5 }, now: NOW });
  assert.deepEqual(out.results.map((r) => [r.group, r.mode, r.status]), [['strategy-accounts', 'paid', 'done'], ['quote-targets', 'paid', 'needs-confirm'], ['x-search', 'skipped', 'failed']]);
  assert.deepEqual(deps.calls, [['pull']]);
});

test('a server group that overruns the timeout reports running; the turn is not held', async () => {
  const deps = fakeDeps({ digestPhase: never });
  const t0 = Date.now();
  const out = await runAgentRefresh({ clientId: 'c1', groups: ['market-signals', 'today-queue'], deps, policy: { enabled: true, dailyCapUsd: 1 }, now: NOW, serverTimeoutMs: 20 });
  assert.ok(Date.now() - t0 < 1000);
  assert.deepEqual(out.results.map((r) => [r.group, r.status]), [['market-signals', 'running'], ['today-queue', 'done']]);
  assert.match(out.results[0].detail, /keeps going/);
  assert.equal(out.spentUsd, 0.1); // the work started, so it is counted
});

test('failures are per group and do not stop the others', async () => {
  const deps = fakeDeps({ digestPhase: async () => { throw new Error('scout blocked'); }, queueScan: async () => ({ error: 'no queue' }) });
  const out = await runAgentRefresh({ clientId: 'c1', groups: ['analysis', 'recent-posts', 'today-queue'], deps, policy: { enabled: true, dailyCapUsd: 1 }, now: NOW });
  assert.deepEqual(out.results.map((r) => r.status), ['failed', 'failed', 'done']);
  assert.match(out.results[0].detail, /scout blocked/);
  assert.equal(out.ok, false);
});

test('availability: true / needs-confirm / no-path', () => {
  const on = agentRefreshAvailability({ groups: ['today-queue', 'recent-posts', 'analysis', 'x-monitor', 'x-search'], policy: { enabled: true, dailyCapUsd: 0.2 }, spentTodayUsd: 0 });
  assert.deepEqual(on, { 'today-queue': true, 'recent-posts': true, analysis: 'needs-confirm', 'x-monitor': true, 'x-search': 'no-path' });
  assert.equal(planGroup('analysis').paid, true);
  assert.equal(agentRefreshAvailability({ groups: ['analysis'], policy: { enabled: false, dailyCapUsd: 5 } }).analysis, 'needs-confirm');
});

test('agentRefreshStatus validates ids, maps statuses, and hides unknown ones', async () => {
  const out = await agentRefreshStatus({
    requestIds: ['req-a', 'req-b', 'bad id!', 'req-c'],
    deps: { requestStatus: async (id) => (id === 'req-a' ? { status: 'done', result: { picks: 4 } } : id === 'req-b' ? { status: 'running' } : null) },
  });
  assert.deepEqual(out.requests.map((r) => [r.requestId, r.status]), [['req-a', 'done'], ['req-b', 'running'], ['req-c', 'unknown']]);
  assert.match(out.note, /1 still running/);
});

test('trustedRefresh normalizes: default off, cap clamped 0.1-20', () => {
  assert.deepEqual(normalizeTrustedRefresh(undefined), { enabled: false, dailyCapUsd: 1 });
  assert.deepEqual(normalizeTrustedRefresh({ enabled: true, dailyCapUsd: 500 }), { enabled: true, dailyCapUsd: 20 });
  assert.deepEqual(normalizeTrustedRefresh({ enabled: 'yes', dailyCapUsd: 0 }), { enabled: false, dailyCapUsd: 0.1 });
  assert.deepEqual(normalizeAutonomy({}).trustedRefresh, { enabled: false, dailyCapUsd: 1 });
});
