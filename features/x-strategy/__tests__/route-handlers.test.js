import test from 'node:test';
import assert from 'node:assert/strict';
import { createStrategyHandlers, STRATEGY_ROUTE_ACTIONS, localDate } from '../route-handlers.js';
import { createMemoryCorpusStore } from '../corpus-store.js';
import { createMemoryPlanStore } from '../plan-store.js';
import { createRefreshService, createMemoryRefreshQueue } from '../refresh.js';
import { DEFAULT_PLAN } from '../contracts.js';

const NOW = Date.parse('2026-10-11T12:00:00.000Z');
const CTX = { clientId: 'c1' };
const AUTH = { decoded: { email: 'admin@x.test', uid: 'u1' } };
const row = (id, extra = {}) => ({ id: String(id), type: 'original', createdAt: '2026-10-01T10:00:00.000Z', likes: 5, views: 100, ...extra });
const rowsFor = (n, p = 0) => Array.from({ length: n }, (_, i) => row(p + i));

function setup({ config = { ownHandle: 'me_acct', benchmarkHandles: ['bench_a'], timezone: 'America/Chicago' }, committed = {}, birdAvailable = false, enabled = false, evaluate } = {}) {
  const corpusStore = createMemoryCorpusStore({ loadCommitted: (h) => committed[h] ?? null });
  const planStore = createMemoryPlanStore();
  const queueStore = createMemoryRefreshQueue();
  let n = 0;
  const detects = [];
  const refreshService = createRefreshService({
    store: corpusStore, queueStore, now: () => NOW, enabled,
    detectBird: async () => { detects.push(1); return { available: birdAvailable }; },
    idGen: () => `req-${++n}`,
    ingest: async () => ({ rows: [], pull: {} }),
    runBirdFor: () => () => '',
  });
  const evalCalls = [];
  const fakeEvaluate = evaluate ?? (async (input) => { evalCalls.push(input); return { fake: true, own: { handle: input.ownHandle, rows: input.ownRows.length }, benchmarks: input.benchmarks.map((b) => b.handle) }; });
  const previewCalls = [];
  const h = createStrategyHandlers({
    corpusStore, planStore, refreshService, clock: () => NOW, evaluate: fakeEvaluate,
    readXGrowthConfig: async () => config,
    readPackages: async () => [],
    buildPreviewPlan: (input) => { previewCalls.push(input); return { slots: [], filled: 0, gaps: [] }; },
  });
  return { h, corpusStore, planStore, queueStore, evalCalls, previewCalls, detects, call: (a, b) => h.handle(a, { clientId: 'c1', ...b }, CTX, AUTH) };
}

test('route actions list matches the T2b scope', () => {
  assert.deepEqual([...STRATEGY_ROUTE_ACTIONS].sort(), ['strategy-evaluate-handle', 'strategy-get', 'strategy-plan-apply', 'strategy-plan-revert', 'strategy-refresh', 'strategy-refresh-status']);
});

test('strategy-get happy path: profile, rowsMeta + freshness, evaluation, plan, preview', async () => {
  const s = setup();
  await s.corpusStore.writeMergedRows('me_acct', rowsFor(5), { pulledAt: '2026-10-10T12:00:00.000Z' });
  await s.corpusStore.writeMergedRows('bench_a', rowsFor(3, 100), { pulledAt: '2026-09-01T12:00:00.000Z' });
  await s.call('strategy-plan-apply', { changes: { authoredPerDay: 6 }, expectedVersion: 0, reason: 'r' });
  const r = await s.call('strategy-get');
  assert.equal(r.ok, true);
  assert.deepEqual([r.profile.ownHandle, r.profile.benchmarkHandles, r.profile.timezone], ['me_acct', ['bench_a'], 'America/Chicago']);
  const own = r.rowsMeta.find((m) => m.handle === 'me_acct');
  assert.equal(own.freshness.stale, false);
  assert.equal(own.rowsMeta.rowCount, 5);
  assert.equal(r.rowsMeta.find((m) => m.handle === 'bench_a').freshness.stale, true);
  assert.equal(r.evaluation.fake, true);
  assert.equal(s.evalCalls[0].plan.authoredPerDay, 6);
  assert.equal(s.evalCalls[0].now, NOW);
  assert.equal(r.plan.version, 1);
  assert.equal(r.todayPlanPreview.available, true);
  assert.equal(s.previewCalls[0].posts, 6);
  assert.equal(s.previewCalls[0].date, '2026-10-11');
});

test('strategy-get with absent plan: plan null, evaluation uses DEFAULT_PLAN, preview uses untouched defaults', async () => {
  const s = setup();
  await s.corpusStore.writeMergedRows('me_acct', rowsFor(5), { pulledAt: '2026-10-10T12:00:00.000Z' });
  const r = await s.call('strategy-get');
  assert.equal(r.plan, null);
  assert.deepEqual(s.evalCalls[0].plan, DEFAULT_PLAN);
  assert.equal('posts' in s.previewCalls[0], false);
  assert.equal('engineConfig' in s.previewCalls[0], false);
});

test('strategy-get with absent rows falls back to committed json via loadCommitted', async () => {
  const s = setup({ committed: { me_acct: rowsFor(4), bench_a: rowsFor(2, 50) } });
  const r = await s.call('strategy-get');
  const own = r.rowsMeta.find((m) => m.handle === 'me_acct');
  assert.equal(own.source, 'committed-json');
  assert.equal(own.freshness.pulledAt, null);
  assert.equal(own.freshness.stale, true);
  assert.equal(s.evalCalls[0].ownRows.length, 4);
  assert.equal(s.evalCalls[0].benchmarks[0].rows.length, 2);
});

test('strategy-get: no rows anywhere -> preview unavailable, still ok; empty profile falls back to the default pair', async () => {
  const a = setup({ config: {} });
  const r = await a.call('strategy-get');
  assert.equal(r.ok, true);
  assert.equal(r.todayPlanPreview.available, false);
  assert.equal(r.profile.ownHandle, 'bai_ee');
  assert.deepEqual(r.profile.benchmarkHandles, ['seb__design']);
  assert.deepEqual(r.profile.defaulted, ['ownHandle', 'benchmarkHandles', 'timezone']);
});

test('strategy-get: a partial saved profile only has the missing fields defaulted', async () => {
  const b = setup({ config: { ownHandle: 'me_acct', benchmarkHandles: [] } });
  const r = await b.call('strategy-get');
  assert.equal(r.profile.ownHandle, 'me_acct');
  assert.deepEqual(r.profile.benchmarkHandles, ['seb__design']);
  assert.deepEqual(r.profile.defaulted, ['benchmarkHandles', 'timezone']);
  assert.equal(b.evalCalls.length, 1);
});

test('missing clientId -> 400; mismatched client -> 403 (every client-scoped action)', async () => {
  const s = setup();
  for (const a of ['strategy-get', 'strategy-refresh', 'strategy-evaluate-handle', 'strategy-plan-apply', 'strategy-plan-revert']) {
    const missing = await s.h.handle(a, {}, CTX, AUTH);
    assert.equal(missing.status, 400, a);
    const other = await s.h.handle(a, { clientId: 'someone-else' }, CTX, AUTH);
    assert.equal(other.status, 403, a);
  }
  assert.equal((await s.h.handle('strategy-get', { clientId: 'c1' }, {}, AUTH)).status, 403); // no selected client
});

test('unknown action is rejected without throwing', async () => {
  const s = setup();
  assert.equal((await s.call('strategy-chat-send')).status, 400);
});

test('strategy-refresh: default handles = own + benchmarks, queued when bird undetected, drain not awaited', async () => {
  const s = setup({ enabled: true, birdAvailable: false });
  const r = await s.call('strategy-refresh');
  assert.deepEqual(r, { ok: true, requestId: 'req-1', status: 'queued' });
  assert.equal(s.detects.length, 1);
  const doc = (await s.call('strategy-refresh-status', { requestId: 'req-1' })).request;
  assert.deepEqual(doc.handles, ['me_acct', 'bench_a']);
  assert.equal(doc.status, 'queued');
  assert.equal(doc.requestedBy, 'admin@x.test');
});

test('strategy-refresh: explicit handles; disabled flag never probes bird', async () => {
  const s = setup({ enabled: false, birdAvailable: true });
  const r = await s.call('strategy-refresh', { handles: ['@Foo_1', 'bar'] });
  assert.equal(r.status, 'queued');
  assert.equal(s.detects.length, 0);
  assert.deepEqual((await s.queueStore.get(r.requestId)).handles, ['foo_1', 'bar']);
});

test('strategy-refresh: >6 handles -> 400; bad handle chars -> 400', async () => {
  const s = setup();
  const many = await s.call('strategy-refresh', { handles: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
  assert.equal(many.status, 400);
  assert.equal(many.code, 'TOO_MANY_HANDLES');
  const bad = await s.call('strategy-refresh', { handles: ['ok', 'bad handle!'] });
  assert.equal(bad.status, 400);
  assert.equal(bad.code, 'BAD_HANDLE');
  assert.equal(await s.queueStore.listQueued().then((l) => l.length), 0);
});

test('strategy-refresh with an empty profile refreshes the default pair', async () => {
  const s = setup({ config: {} });
  const r = await s.call('strategy-refresh');
  assert.equal(r.ok, true);
  assert.deepEqual((await s.queueStore.get(r.requestId)).handles, ['bai_ee', 'seb__design']);
});

test('strategy-refresh-status: found, 404, bad id', async () => {
  const s = setup();
  const { requestId } = await s.call('strategy-refresh', { handles: ['foo'] });
  assert.equal((await s.call('strategy-refresh-status', { requestId })).request.id, requestId);
  assert.equal((await s.call('strategy-refresh-status', { requestId: 'nope' })).status, 404);
  assert.equal((await s.call('strategy-refresh-status', { requestId: '../x/y' })).status, 400);
  assert.equal((await s.call('strategy-refresh-status', {})).status, 400);
});

test('strategy-evaluate-handle: no rows -> needsRefresh; rows -> evaluation vs own; bad handle -> 400', async () => {
  const s = setup();
  await s.corpusStore.writeMergedRows('me_acct', rowsFor(5), { pulledAt: '2026-10-10T12:00:00.000Z' });
  const none = await s.call('strategy-evaluate-handle', { handle: '@stranger' });
  assert.equal(none.needsRefresh, true);
  assert.equal(s.evalCalls.length, 0);
  await s.corpusStore.writeMergedRows('stranger', rowsFor(3, 200), { pulledAt: '2026-10-10T12:00:00.000Z' });
  const ok = await s.call('strategy-evaluate-handle', { handle: '@Stranger' });
  assert.equal(ok.needsRefresh, false);
  assert.deepEqual(ok.evaluation.benchmarks, ['stranger']);
  assert.equal(s.evalCalls[0].ownHandle, 'me_acct');
  assert.equal((await s.call('strategy-evaluate-handle', { handle: 'no spaces/allowed' })).status, 400);
  assert.equal((await s.call('strategy-evaluate-handle', {})).status, 400);
});

test('strategy-evaluate-handle: own rows missing -> needsRefresh with missingOwn', async () => {
  const s = setup();
  await s.corpusStore.writeMergedRows('stranger', rowsFor(3), { pulledAt: '2026-10-10T12:00:00.000Z' });
  const r = await s.call('strategy-evaluate-handle', { handle: 'stranger' });
  assert.equal(r.needsRefresh, true);
  assert.equal(r.missingOwn, true);
});

test('plan apply: creates v1, stale version -> 409 with currentVersion, invalid -> 400 errors[], noop is ok/unchanged', async () => {
  const s = setup();
  const a = await s.call('strategy-plan-apply', { changes: { authoredPerDay: 8 }, expectedVersion: 0, reason: 'more' });
  assert.equal(a.ok, true);
  assert.equal(a.plan.version, 1);
  assert.equal(a.plan.plan.authoredPerDay, 8);
  assert.equal(a.plan.history[0].source, 'manual');
  assert.equal(a.plan.updatedBy, 'admin@x.test');

  const stale = await s.call('strategy-plan-apply', { changes: { authoredPerDay: 5 }, expectedVersion: 0 });
  assert.equal(stale.status, 409);
  assert.equal(stale.currentVersion, 1);
  assert.equal(stale.code, 'version-conflict');

  const bad = await s.call('strategy-plan-apply', { changes: { authoredPerDay: 999 }, expectedVersion: 1 });
  assert.equal(bad.status, 400);
  assert.ok(Array.isArray(bad.errors) && bad.errors.length > 0);
  const tier = await s.call('strategy-plan-apply', { changes: { tier: 3 }, expectedVersion: 1 });
  assert.equal(tier.status, 400);

  const noop = await s.call('strategy-plan-apply', { changes: { authoredPerDay: 8 }, expectedVersion: 1 });
  assert.equal(noop.ok, true);
  assert.equal(noop.changed, false);
  assert.equal(noop.plan.version, 1);
});

test('plan revert restores the earlier plan as a new version; 404 with no plan; 400 bad version', async () => {
  const s = setup();
  assert.equal((await s.call('strategy-plan-revert', { version: 1 })).status, 404);
  await s.call('strategy-plan-apply', { changes: { authoredPerDay: 8 }, expectedVersion: 0 });
  await s.call('strategy-plan-apply', { changes: { authoredPerDay: 12 }, expectedVersion: 1 });
  const r = await s.call('strategy-plan-revert', { version: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.plan.version, 3);
  assert.equal(r.plan.plan.authoredPerDay, 8);
  assert.equal((await s.call('strategy-plan-revert', { version: 99 })).status, 400);
  assert.equal((await s.call('strategy-plan-revert', { version: 'x' })).status, 400);
  assert.equal((await s.planStore.get('c1')).version, 3);
});

test('writes stay scoped: plan apply for c1 does not create docs for other clients', async () => {
  const s = setup();
  await s.call('strategy-plan-apply', { changes: { authoredPerDay: 8 }, expectedVersion: 0 });
  assert.equal(await s.planStore.get('other'), null);
});

test('localDate honors timezone and falls back to UTC', () => {
  const late = Date.parse('2026-10-11T02:00:00.000Z');
  assert.equal(localDate(late, 'America/Chicago'), '2026-10-10');
  assert.equal(localDate(late, ''), '2026-10-11');
  assert.equal(localDate(late, 'Not/AZone'), '2026-10-11');
});
