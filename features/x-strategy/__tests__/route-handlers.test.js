import test from 'node:test';
import assert from 'node:assert/strict';
import { createStrategyHandlers, createStrategyHandlersFromDb, STRATEGY_ROUTE_ACTIONS, localDate } from '../route-handlers.js';
import { createMemoryCorpusStore } from '../corpus-store.js';
import { createMemoryPlanStore } from '../plan-store.js';
import { createRefreshService, createMemoryRefreshQueue } from '../refresh.js';
import { DEFAULT_PLAN } from '../contracts.js';
import { createMemoryChatStore } from '../agent/chat-store.js';
import { createXGrowthProfileSaver } from '../route-handlers.js';

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
  assert.deepEqual([...STRATEGY_ROUTE_ACTIONS].sort(), ['strategy-chat-history', 'strategy-chat-send', 'strategy-evaluate-handle', 'strategy-get', 'strategy-plan-apply', 'strategy-plan-revert', 'strategy-profile-save', 'strategy-proposal-decide', 'strategy-refresh', 'strategy-refresh-status']);
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
  assert.equal((await s.call('strategy-nope')).status, 400);
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


// ============================ T4b: chat, proposals, profile save ============================

function chatSetup({ loopResult, cap = 60, packages = [], extra = {} } = {}) {
  const corpusStore = createMemoryCorpusStore({ loadCommitted: () => null });
  const planStore = createMemoryPlanStore();
  const chatStore = createMemoryChatStore({ cap });
  const refreshService = createRefreshService({ store: corpusStore, queueStore: createMemoryRefreshQueue(), now: () => NOW, enabled: false, detectBird: async () => ({ available: false }), idGen: () => 'req-1', ingest: async () => ({ rows: [], pull: {} }), runBirdFor: () => () => '' });
  const loopCalls = [];
  const toolsSeen = [];
  const factory = ({ toolDeps }) => {
    toolsSeen.push(toolDeps);
    return { runTurn: async (a) => { loopCalls.push(a); return typeof loopResult === 'function' ? loopResult(a, toolDeps) : (loopResult ?? { text: 'hi', proposals: [], usage: { calls: 1, inputTokens: 10, outputTokens: 5, costUsd: 0.01 }, rounds: 1, stopped: 'done' }); } };
  };
  const dailyCalls = [];
  const itemCalls = [];
  const saved = [];
  const h = createStrategyHandlers({
    corpusStore, planStore, refreshService, clock: () => NOW,
    evaluate: async (i) => ({ fake: true, own: { handle: i.ownHandle } }),
    readXGrowthConfig: async () => ({ ownHandle: 'me_acct', benchmarkHandles: ['bench_a'], timezone: 'America/Chicago' }),
    readPackages: async () => packages, buildPreviewPlan: () => ({ slots: [] }),
    chatStore, agentLoopFactory: factory,
    runDailyAction: async (ctx, action, body) => { dailyCalls.push([action, body]); return { ok: true, run: { localDate: '2026-10-11' } }; },
    runUpdateItemFacets: async (ctx, body) => { itemCalls.push(body); return { ok: true, pkg: { id: body.id } }; },
    readTodayRun: async () => ({ localDate: '2026-10-11', suggestions: [{ id: 's1' }] }),
    saveXGrowthProfile: async (id, prof) => { saved.push([id, prof]); return prof; },
    ...extra,
  });
  const call = (a, b, ctx = CTX) => h.handle(a, { clientId: 'c1', ...b }, ctx, AUTH);
  return { h, call, corpusStore, planStore, chatStore, loopCalls, toolsSeen, dailyCalls, itemCalls, saved };
}
const twoProposals = () => ({
  text: 'Here is what I suggest.',
  proposals: [
    { kind: 'plan-change', payload: { changes: { authoredPerDay: 6 }, expectedVersion: 0 }, summary: 'Raise cadence to 6/day', rationale: 'gap', evidence: [{ source: 'eval', figure: '4 vs 9' }] },
    { kind: 'suggestion-dismiss', payload: { suggestionId: 's1' }, summary: 'Dismiss s1', rationale: 'off-brand', evidence: [] },
  ],
  usage: { calls: 2, inputTokens: 100, outputTokens: 50, costUsd: 0.02 }, rounds: 2, stopped: 'done',
});

test('chat-send: runs the loop, persists 2 pending proposals with ids, returns usage and counts', async () => {
  const s = chatSetup({ loopResult: twoProposals() });
  const r = await s.call('strategy-chat-send', { text: '  how am I doing?  ' });
  assert.equal(r.ok, true);
  assert.match(r.threadId, /^t_[a-z0-9]+$/);
  assert.equal(r.text, 'Here is what I suggest.');
  assert.equal(r.proposals.length, 2);
  for (const p of r.proposals) { assert.match(p.id, /^[0-9a-f-]{36}$/); assert.equal(p.status, 'pending'); assert.equal(p.threadId, r.threadId); }
  assert.deepEqual([r.turnsUsedToday, r.cap], [1, 60]);
  assert.equal(r.usage.costUsd, 0.02);
  assert.equal(s.loopCalls[0].userText, 'how am I doing?');
  assert.deepEqual(s.loopCalls[0].history, []);
  const th = await s.chatStore.getThread('c1', r.threadId);
  assert.equal(th.messages.length, 2);
  assert.deepEqual(Object.values(th.proposals).map((p) => p.status), ['pending', 'pending']);
  // second turn on the same thread sees history
  const r2 = await s.call('strategy-chat-send', { text: 'and now?', threadId: r.threadId });
  assert.equal(r2.threadId, r.threadId);
  assert.deepEqual(s.loopCalls[1].history.map((m) => m.role), ['user', 'assistant']);
});

test('chat-send: invalid or extra proposals are dropped (and reported), max 2 kept', async () => {
  const s = chatSetup({ loopResult: { text: 't', proposals: [
    { kind: 'plan-change', payload: { changes: { authoredPerDay: 99 }, expectedVersion: 0 }, summary: 'bad' },
    { kind: 'suggestion-dismiss', payload: { suggestionId: 'a' } },
    { kind: 'suggestion-dismiss', payload: { suggestionId: 'b' } },
    { kind: 'suggestion-dismiss', payload: { suggestionId: 'c' } },
  ] } });
  const r = await s.call('strategy-chat-send', { text: 'q' });
  assert.equal(r.proposals.length, 1, 'first of the 2 allowed is invalid, second is kept, rest ignored');
  assert.equal(r.droppedProposals.length, 1);
});

test('chat-send validation: empty / too long -> 400, clientId mismatch -> 403, unknown thread -> 404, no model call, no cap spend', async () => {
  const s = chatSetup();
  assert.equal((await s.call('strategy-chat-send', { text: '   ' })).status, 400);
  assert.equal((await s.call('strategy-chat-send', { text: 'x'.repeat(2001) })).status, 400);
  assert.equal((await s.call('strategy-chat-send', { text: 'hi', clientId: 'other' })).status, 403);
  assert.equal((await s.call('strategy-chat-send', { text: 'hi', clientId: undefined })).status, 400);
  assert.equal((await s.call('strategy-chat-send', { text: 'hi', threadId: 'nope' })).status, 404);
  assert.equal((await s.call('strategy-chat-send', { text: 'hi', threadId: '../x' })).status, 400);
  assert.equal(s.loopCalls.length, 0);
  assert.equal(await s.chatStore.usedToday('c1', NOW), 0);
  assert.equal((await s.call('strategy-chat-send', { text: 'x'.repeat(2000) })).ok, true, '2000 chars is allowed');
});

test('daily cap -> 429 with used/cap, and the model is never called', async () => {
  const s = chatSetup({ cap: 2 });
  assert.equal((await s.call('strategy-chat-send', { text: 'a' })).ok, true);
  assert.equal((await s.call('strategy-chat-send', { text: 'b' })).ok, true);
  const r = await s.call('strategy-chat-send', { text: 'c' });
  assert.deepEqual([r.ok, r.status, r.used, r.cap, r.code], [false, 429, 2, 2, 'chat-cap']);
  assert.equal(s.loopCalls.length, 2);
});

test('chat-send without a configured model/loop -> 503, nothing is called', async () => {
  const s = chatSetup({ extra: { agentLoopFactory: null, callModel: null } });
  const r = await s.call('strategy-chat-send', { text: 'hi' });
  assert.equal(r.status, 503);
  assert.equal(s.loopCalls.length, 0);
});

test('chat-send: a loop that throws -> 502 (the reserved turn still counts)', async () => {
  const s = chatSetup({ loopResult: () => { throw new Error('upstream down'); } });
  const r = await s.call('strategy-chat-send', { text: 'hi' });
  assert.deepEqual([r.ok, r.status], [false, 502]);
  assert.equal(r.turnsUsedToday, 1);
});

test('toolDeps: getPlan/getTodayRun/searchInventory/topPosts/getEvaluation use the handlers\' readers', async () => {
  const pkgs = [
    { id: 'p1', title: 'Pier sunrise', story: 'shot at dawn', searchTokens: ['pier', 'dawn'], bucketId: 'b' },
    { id: 'p2', title: 'Studio', story: '', searchTokens: ['studio'] },
  ];
  let deps;
  const s = chatSetup({ packages: pkgs, loopResult: (a, d) => { deps = d; return { text: 'ok', proposals: [] }; } });
  await s.corpusStore.writeMergedRows('me_acct', [
    { id: '1', type: 'original', utc: '2026-10-01T10:00:00.000Z', likes: 5, views: 100, text: 'about brand work' },
    { id: '2', type: 'quote-react', utc: '2026-10-02T10:00:00.000Z', likes: 9, views: 900, text: 'hot take on brand' },
    { id: '3', type: 'original', utc: '2026-10-03T10:00:00.000Z', likes: 1, views: 50, text: 'lunch' },
  ], { pulledAt: '2026-10-10T12:00:00.000Z' });
  await s.call('strategy-chat-send', { text: 'q' });
  assert.equal((await deps.getPlan()).isDefault, true);
  await s.call('strategy-plan-apply', { changes: { authoredPerDay: 6 }, expectedVersion: 0 });
  assert.equal((await deps.getPlan()).version, 1);
  assert.equal((await deps.getTodayRun()).suggestions[0].id, 's1');
  assert.deepEqual((await deps.searchInventory({ query: 'dawn pier', limit: 5 })).map((p) => p.id), ['p1']);
  assert.equal((await deps.searchInventory({ query: '', limit: 999 })).length, 2);
  const top = await deps.topPosts({ handle: 'me_acct', limit: 2 });
  assert.deepEqual(top.rows.map((r) => r.id), ['2', '1']);
  assert.deepEqual((await deps.topPosts({ handle: 'me_acct', type: 'original', topic: 'brand' })).rows.map((r) => r.id), ['1']);
  assert.ok((await deps.topPosts({ handle: 'random_person' })).error, 'only own/benchmark handles');
  const ev = await deps.getEvaluation();
  assert.equal(ev.evaluation.fake, true);
});

test('chat-history: thread by id, list + latest without id, unknown thread 404, counts + cap, mismatch 403', async () => {
  const s = chatSetup({ cap: 9 });
  const a = await s.call('strategy-chat-send', { text: 'first' });
  const empty = await chatSetup().call('strategy-chat-history', {});
  assert.deepEqual([empty.ok, empty.threads, empty.thread, empty.turnsUsedToday], [true, [], null, 0]);
  const list = await s.call('strategy-chat-history', {});
  assert.equal(list.threads.length, 1);
  assert.equal(list.thread.threadId, a.threadId);
  assert.deepEqual([list.turnsUsedToday, list.cap], [1, 9]);
  const one = await s.call('strategy-chat-history', { threadId: a.threadId });
  assert.equal(one.thread.messages.length, 2);
  assert.equal((await s.call('strategy-chat-history', { threadId: 'ghost' })).status, 404);
  assert.equal((await s.call('strategy-chat-history', { clientId: 'zzz' })).status, 403);
});

async function threadWith(s, proposals) {
  const r = await s.call('strategy-chat-send', { text: 'q' });
  return r;
}

test('proposal-decide: reject executes nothing; confirm executes once; double confirm -> 409 without a second run', async () => {
  const s = chatSetup({ loopResult: twoProposals() });
  const r = await threadWith(s);
  const [planP, dismissP] = r.proposals;
  const rej = await s.call('strategy-proposal-decide', { threadId: r.threadId, proposalId: dismissP.id, decision: 'reject' });
  assert.equal(rej.ok, true);
  assert.equal(rej.proposal.status, 'rejected');
  assert.equal(s.dailyCalls.length, 0);
  const again = await s.call('strategy-proposal-decide', { threadId: r.threadId, proposalId: dismissP.id, decision: 'confirm' });
  assert.deepEqual([again.ok, again.status], [false, 409]);
  assert.equal(s.dailyCalls.length, 0);

  const c1 = await s.call('strategy-proposal-decide', { threadId: r.threadId, proposalId: planP.id, decision: 'confirm' });
  assert.equal(c1.proposal.status, 'confirmed');
  assert.equal(c1.planDoc.version, 1);
  assert.equal(c1.planDoc.plan.authoredPerDay, 6);
  const c2 = await s.call('strategy-proposal-decide', { threadId: r.threadId, proposalId: planP.id, decision: 'confirm' });
  assert.equal(c2.status, 409);
  assert.equal((await s.planStore.get('c1')).version, 1, 'applied exactly once');
  const th = await s.chatStore.getThread('c1', r.threadId);
  assert.deepEqual([th.proposals[planP.id].status, th.proposals[dismissP.id].status], ['confirmed', 'rejected']);
});

test('proposal-decide: concurrent confirms execute once', async () => {
  const s = chatSetup({ loopResult: twoProposals() });
  const r = await threadWith(s);
  const p = r.proposals[1];
  const [a, b] = await Promise.all([
    s.call('strategy-proposal-decide', { threadId: r.threadId, proposalId: p.id, decision: 'confirm' }),
    s.call('strategy-proposal-decide', { threadId: r.threadId, proposalId: p.id, decision: 'confirm' }),
  ]);
  assert.deepEqual([a.ok, b.ok].sort(), [false, true]);
  assert.equal(s.dailyCalls.length, 1);
  assert.equal(s.dailyCalls[0][0], 'daily-run-dismiss');
});

test('proposal-decide: stale plan-change -> failed:stale, plan doc unchanged', async () => {
  const s = chatSetup({ loopResult: twoProposals() });
  const r = await threadWith(s);
  await s.call('strategy-plan-apply', { changes: { authoredPerDay: 10 }, expectedVersion: 0 }); // moves past the proposal's expectedVersion 0
  const before = await s.planStore.get('c1');
  const out = await s.call('strategy-proposal-decide', { threadId: r.threadId, proposalId: r.proposals[0].id, decision: 'confirm' });
  assert.equal(out.ok, true);
  assert.equal(out.proposal.status, 'failed');
  assert.deepEqual([out.proposal.result.error, out.proposal.result.currentVersion], ['stale', 1]);
  assert.deepEqual(await s.planStore.get('c1'), before);
  assert.deepEqual(out.planDoc, before, 'response carries the current plan so the UI can refresh');
});

test('proposal-decide: executor failure -> failed; a proposal from another thread cannot be decided via this one', async () => {
  const s = chatSetup({ loopResult: twoProposals(), extra: { runDailyAction: async () => { throw Object.assign(new Error('No daily run to review yet'), { status: 404 }); } } });
  const t1 = await threadWith(s);
  const t2 = await threadWith(s);
  assert.notEqual(t1.threadId, t2.threadId);
  const cross = await s.call('strategy-proposal-decide', { threadId: t2.threadId, proposalId: t1.proposals[1].id, decision: 'confirm' });
  assert.deepEqual([cross.ok, cross.status], [false, 404]);
  const th1 = await s.chatStore.getThread('c1', t1.threadId);
  assert.equal(th1.proposals[t1.proposals[1].id].status, 'pending', 'untouched');
  const f = await s.call('strategy-proposal-decide', { threadId: t1.threadId, proposalId: t1.proposals[1].id, decision: 'confirm' });
  assert.equal(f.proposal.status, 'failed');
  assert.match(f.proposal.result.message, /No daily run/);
});

test('proposal-decide validation: decision, ids, unknown thread/proposal, client mismatch', async () => {
  const s = chatSetup({ loopResult: twoProposals() });
  const r = await threadWith(s);
  const id = r.proposals[0].id;
  assert.equal((await s.call('strategy-proposal-decide', { threadId: r.threadId, proposalId: id, decision: 'maybe' })).status, 400);
  assert.equal((await s.call('strategy-proposal-decide', { threadId: r.threadId, decision: 'confirm' })).status, 400);
  assert.equal((await s.call('strategy-proposal-decide', { proposalId: id, decision: 'confirm' })).status, 400);
  assert.equal((await s.call('strategy-proposal-decide', { threadId: 'ghost', proposalId: id, decision: 'confirm' })).status, 404);
  assert.equal((await s.call('strategy-proposal-decide', { threadId: r.threadId, proposalId: 'ghost', decision: 'confirm' })).status, 404);
  assert.equal((await s.call('strategy-proposal-decide', { threadId: r.threadId, proposalId: id, decision: 'confirm', clientId: 'other' })).status, 403);
  assert.equal((await s.planStore.get('c1')), null);
});

test('proposal-decide: item-story and benchmarks-change run their mapped capability', async () => {
  const s = chatSetup({ loopResult: { text: 't', proposals: [
    { kind: 'item-story', payload: { id: 'pkg9', story: 'owner said: shot on the ferry' }, summary: 's' },
    { kind: 'benchmarks-change', payload: { ownHandle: 'me_acct', benchmarkHandles: ['bench_a', 'bench_b'] }, summary: 's' },
  ] } });
  const r = await threadWith(s);
  const a = await s.call('strategy-proposal-decide', { threadId: r.threadId, proposalId: r.proposals[0].id, decision: 'confirm' });
  const b = await s.call('strategy-proposal-decide', { threadId: r.threadId, proposalId: r.proposals[1].id, decision: 'confirm' });
  assert.deepEqual([a.proposal.status, b.proposal.status], ['confirmed', 'confirmed']);
  assert.deepEqual(s.itemCalls, [{ id: 'pkg9', story: 'owner said: shot on the ferry' }]);
  assert.deepEqual(s.saved, [['c1', { ownHandle: 'me_acct', benchmarkHandles: ['bench_a', 'bench_b'] }]]);
});

test('profile-save: validation (9 benchmarks, bad chars, own in benchmarks, missing own) and success', async () => {
  const s = chatSetup();
  const base = { ownHandle: 'me_acct', benchmarkHandles: ['a'] };
  assert.equal((await s.call('strategy-profile-save', { ...base, benchmarkHandles: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] })).status, 400);
  assert.equal((await s.call('strategy-profile-save', { ...base, benchmarkHandles: ['bad handle!'] })).status, 400);
  assert.equal((await s.call('strategy-profile-save', { ownHandle: 'me_acct', benchmarkHandles: ['ME_acct'] })).status, 400);
  assert.equal((await s.call('strategy-profile-save', { benchmarkHandles: ['a'] })).status, 400);
  assert.equal((await s.call('strategy-profile-save', { ...base, clientId: 'other' })).status, 403);
  assert.equal(s.saved.length, 0);
  const ok = await s.call('strategy-profile-save', { ownHandle: '@me_acct', benchmarkHandles: ['@a', 'A', 'b'] });
  assert.equal(ok.ok, true);
  assert.deepEqual(s.saved, [['c1', { ownHandle: 'me_acct', benchmarkHandles: ['a', 'b'] }]]);
  const none = chatSetup({ extra: { saveXGrowthProfile: null } });
  assert.equal((await none.call('strategy-profile-save', base)).status, 501);
});

test('createXGrowthProfileSaver: merges into marketingBriefConfig.xGrowth without clobbering other fields', async () => {
  const store = { client_configs: { c1: { brand: 'keep', marketingBriefConfig: { weather: { on: true }, xGrowth: { enabled: true, mode: 'auto', ownHandle: 'old', benchmarkHandles: ['x'], lanes: ['web'], tierOverride: 2, timezone: 'America/Chicago' } } } } };
  const writes = [];
  const db = { collection: (c) => ({ doc: (id) => ({
    async get() { const d = store[c]?.[id]; return { exists: !!d, data: () => JSON.parse(JSON.stringify(d)) }; },
    async set(v, opts) { writes.push([c, id, v, opts]); },
  }) }) };
  const save = createXGrowthProfileSaver(db);
  const out = await save('c1', { ownHandle: 'me', benchmarkHandles: ['a', 'b'] });
  assert.deepEqual(out, { enabled: true, mode: 'auto', ownHandle: 'me', benchmarkHandles: ['a', 'b'], lanes: ['web'], tierOverride: 2, timezone: 'America/Chicago' });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].slice(0, 2), ['client_configs', 'c1']);
  assert.deepEqual(writes[0][3], { merge: true });
  assert.deepEqual(Object.keys(writes[0][2]), ['marketingBriefConfig']);
  assert.deepEqual(Object.keys(writes[0][2].marketingBriefConfig), ['xGrowth'], 'only xGrowth is written');
  // benchmarks-only save leaves ownHandle alone; absent doc starts from defaults
  const out2 = await save('c1', { benchmarkHandles: ['z'] });
  assert.equal(out2.ownHandle, 'old');
  const out3 = await save('new-client', { ownHandle: 'me', benchmarkHandles: [] });
  assert.deepEqual([out3.enabled, out3.mode, out3.ownHandle], [false, 'approval', 'me']);
});

test('createStrategyHandlersFromDb passes loadCommitted to its corpus store (no fs for committed corpora)', async () => {
  const emptyDoc = { get: async () => ({ exists: false, data: () => undefined }), collection: () => emptyCol };
  const emptyCol = { doc: () => emptyDoc, get: async () => ({ forEach: () => {} }) };
  const db = { collection: () => emptyCol };
  const seen = [];
  const h = createStrategyHandlersFromDb(db, {
    env: {}, readPackages: async () => [],
    loadCommitted: (handle) => { seen.push(handle); return handle === 'bai_ee' ? rowsFor(4) : null; },
  });
  const r = await h.handle('strategy-get', { clientId: 'c1' }, CTX, AUTH);
  assert.ok(seen.includes('bai_ee'), 'injected loader was consulted for the default own handle');
  const own = r.rowsMeta.find((m) => m.handle === 'bai_ee');
  assert.equal(own.source, 'committed-json');
  assert.equal(own.rowsMeta.rowCount, 4);
});

test('chat-send resolves `selected` only for its own client and passes a labelled selectedContext', async () => {
  const readCalls = [];
  const s = chatSetup({ extra: {
    readPost: async (cid, id) => { readCalls.push([cid, id]); return id === 'p1' ? { id, status: 'draft', content: 'my draft' } : null; },
    readQueueSummary: async (cid) => ({ cid, counts: {}, posts: [] }),
  } });
  await s.call('strategy-chat-send', { text: 'hi', selected: { kind: 'post', id: 'p1' } });
  assert.match(s.loopCalls[0].selectedContext, /SAVED POST \(draft/);
  assert.deepEqual(readCalls[0], ['c1', 'p1']);
  await s.call('strategy-chat-send', { text: 'hi', selected: { kind: 'suggestion', id: 's1' } });
  assert.match(s.loopCalls[1].selectedContext, /RECOMMENDATION/);
  await s.call('strategy-chat-send', { text: 'hi', selected: { kind: 'post', id: 'nope' } });
  assert.match(s.loopCalls[2].selectedContext, /could not be found/);
  await s.call('strategy-chat-send', { text: 'hi', selected: { kind: 'weird', id: 'p1' } });
  assert.ok(!('selectedContext' in s.loopCalls[3]));
  // toolDeps are closed over the request client: readers are called with c1 and take no client from the model
  const deps = s.toolsSeen[0];
  assert.equal(typeof deps.readQueueSummary, 'function');
  assert.equal((await deps.readQueueSummary()).cid, 'c1');
  assert.equal(deps.readOpportunities, undefined);
});

test('searchInventory: hasStory is false for placeholder stories, finds a mix by artist (accept. 9)', async () => {
  const pkgs = [
    { id: 'rv-1', title: 'ACIDMAN – Night Set', story: '[add your memory]', searchTokens: ['acidman'], bucketId: 'ue' },
    { id: 'p2', title: 'Real', story: 'A real memory of the night we pressed the first run of this record.', searchTokens: ['acidman'] },
    { id: 'p3', title: 'Seed', story: 'TODO — write this', searchTokens: ['acidman'] },
  ];
  let deps;
  const s = chatSetup({ packages: pkgs, loopResult: (a, d) => { deps = d; return { text: 'ok', proposals: [] }; } });
  await s.call('strategy-chat-send', { text: 'q' });
  const hits = await deps.searchInventory({ query: 'acidman', limit: 5 });
  assert.deepEqual(hits.map((p) => [p.id, p.hasStory]).sort(), [['p2', true], ['p3', false], ['rv-1', false]]);
});

// ---- tracks are the source of truth for xGrowth.benchmarkHandles ----

function mirrorSetup({ saveFails = false } = {}) {
  const saves = [];
  const queueStore = createMemoryRefreshQueue();
  let n = 0;
  const corpusStore = createMemoryCorpusStore({ loadCommitted: () => null });
  const planStore = createMemoryPlanStore();
  const h = createStrategyHandlers({
    corpusStore, planStore, clock: () => NOW,
    refreshService: createRefreshService({ store: corpusStore, queueStore, now: () => NOW, enabled: false, idGen: () => `req-${++n}` }),
    readXGrowthConfig: async () => ({ ownHandle: 'bai_ee', benchmarkHandles: ['seb__design', 'toshioueki'] }),
    saveXGrowthProfile: async (clientId, p) => { if (saveFails) throw new Error('config write denied'); saves.push({ clientId, ...p }); return { ownHandle: 'bai_ee', ...p }; },
  });
  const call = (a, b) => h.handle(a, { clientId: 'c1', ...b }, CTX, AUTH);
  return { saves, queueStore, planStore, call };
}
const musicTracks = (benchmarks) => [
  { id: 'design', label: 'Design', engines: ['client', 'identity'], benchmarks: ['seb__design'], share: 0.5 },
  { id: 'music', label: 'Music', engines: ['ue', 'record'], benchmarks, share: 0.5 },
];

test('track save mirrors [pace benchmark, ...track benchmarks] into the xGrowth profile', async () => {
  const s = mirrorSetup();
  const res = await s.call('strategy-plan-apply', { changes: { contentTracks: musicTracks(['dorksirjur', 'discogs', 'toshioueki']) }, expectedVersion: 0, reason: '' });
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(s.saves, [{ clientId: 'c1', benchmarkHandles: ['seb__design', 'dorksirjur', 'discogs', 'toshioueki'] }]);
  assert.deepEqual(res.profileSync.benchmarkHandles, ['seb__design', 'dorksirjur', 'discogs', 'toshioueki']);
  // a plan write that leaves tracks + pace alone does not touch the profile
  await s.call('strategy-plan-apply', { changes: { authoredPerDay: 6 }, expectedVersion: 1, reason: '' });
  assert.equal(s.saves.length, 1);
  // revert back past the tracks: plan has no explicit tracks => profile is left as its own source
  await s.call('strategy-plan-apply', { changes: { contentTracks: musicTracks(['dorksirjur']) }, expectedVersion: 2, reason: '' });
  assert.deepEqual(s.saves.at(-1).benchmarkHandles, ['seb__design', 'dorksirjur']);
  const rev = await s.call('strategy-plan-revert', { version: 1 });
  assert.equal(rev.ok, true, rev.error);
  assert.deepEqual(s.saves.at(-1).benchmarkHandles, ['seb__design', 'dorksirjur', 'discogs', 'toshioueki']);
});

test('a profile mirror failure never fails the plan save; it is reported', async () => {
  const s = mirrorSetup({ saveFails: true });
  const res = await s.call('strategy-plan-apply', { changes: { contentTracks: musicTracks(['dorksirjur']) }, expectedVersion: 0, reason: '' });
  assert.equal(res.ok, true);
  assert.equal(res.plan.version, 1);
  assert.match(res.profileSync.error, /denied/);
});

test('track save: new handles queue ONE refresh; a second save merges into it', async () => {
  const s = mirrorSetup();
  const a = await s.call('strategy-plan-apply', { changes: { contentTracks: musicTracks(['toshioueki']) }, expectedVersion: 0, reason: '' });
  const b = await s.call('strategy-plan-apply', { changes: { contentTracks: musicTracks(['toshioueki', 'dorksirjur', 'discogs']) }, expectedVersion: 1, reason: '' });
  assert.equal(b.refresh.requestId, a.refresh.requestId);
  assert.deepEqual((await s.queueStore.get(a.refresh.requestId)).handles, ['toshioueki', 'dorksirjur', 'discogs']);
  assert.equal(await s.queueStore.get('req-2'), null);
});
