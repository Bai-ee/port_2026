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
  assert.deepEqual([...STRATEGY_ROUTE_ACTIONS].sort(), ['hot-quotes-find', 'quote-scan-refresh', 'quote-scan-status', 'strategy-action-log', 'strategy-action-undo', 'strategy-autonomy-get', 'strategy-autonomy-save', 'strategy-calendar-batch-create', 'strategy-calendar-batch-preview', 'strategy-chat-history', 'strategy-chat-send', 'strategy-daily-fill-create', 'strategy-daily-fill-preview', 'strategy-doc-get', 'strategy-doc-revert', 'strategy-doc-save', 'strategy-evaluate-handle', 'strategy-freshness', 'strategy-get', 'strategy-plan-apply', 'strategy-plan-revert', 'strategy-profile-save', 'strategy-proposal-decide', 'strategy-refresh', 'strategy-refresh-status', 'strategy-reply-style-get', 'strategy-reply-style-save', 'strategy-review', 'strategy-unmet-list', 'strategy-unmet-status', 'x-data-sources-get', 'x-data-sources-save']);
});

test('the factory exposes dailyFill for the daily-loop cron (a missing export silently skipped every fill)', async () => {
  const { h } = setup();
  assert.equal(typeof h.dailyFill, 'function');
  assert.equal(typeof h.dailyFillDeps, 'object');
  // No ensureDraft wired: execute reports a failure instead of pretending it ran.
  const r = await h.dailyFill('c1', { days: 1 }, { execute: true });
  assert.equal(r.ok, false);
});

test('a plan save waits for the Brain write-back and runs the targets one at a time (serverless-safe)', async () => {
  const s = setup();
  const log = [];
  const h = createStrategyHandlers({
    corpusStore: createMemoryCorpusStore(), planStore: s.planStore, clock: () => NOW,
    refreshService: { requestRefresh: async () => ({ requestId: 'r', status: 'queued' }) },
    readXGrowthConfig: async () => ({ ownHandle: 'me_acct' }), readPackages: async () => [],
    onBrainOwnedSaved: async (clientId, target) => {
      log.push(`start:${target}`);
      await new Promise((r) => setTimeout(r, 15));
      log.push(`end:${target}`);
      if (target === 'trackTargets') throw new Error('brain down'); // never fails the save
    },
  });
  const tracks = [{ id: 'a', label: 'A', engines: ['record', 'ue', 'client', 'identity'], share: 1 }];
  const r = await h.handle('strategy-plan-apply', { clientId: 'c1', changes: { contentTracks: tracks, engineTargets: { engines: { record: { targetPerDay: 1 } } } }, expectedVersion: 0 }, CTX, AUTH);
  assert.equal(r.ok, true);
  assert.deepEqual(log, ['start:contentTracks', 'end:contentTracks', 'start:trackTargets', 'end:trackTargets']);
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

test('strategy-get: a client with no profile gets null handle / [] benchmarks, never bai_ee / seb__design', async () => {
  for (const config of [{}, null]) {
    const a = setup({ config, committed: { bai_ee: rowsFor(4), seb__design: rowsFor(2) } });
    const r = await a.call('strategy-get');
    assert.equal(r.ok, true);
    assert.equal(r.todayPlanPreview.available, false);
    assert.equal(r.profile.ownHandle, null);
    assert.deepEqual(r.profile.benchmarkHandles, []);
    assert.deepEqual(r.profile.unset, ['ownHandle', 'benchmarkHandles']);
    assert.deepEqual(r.profile.defaulted, ['timezone']);
    assert.equal(r.profile.timezone, 'America/Chicago');
    assert.deepEqual(r.rowsMeta, [], 'no handle is read at all');
    assert.doesNotMatch(JSON.stringify({ profile: r.profile, rowsMeta: r.rowsMeta, evaluation: r.evaluation, preview: r.todayPlanPreview }), /bai_ee|seb__design/);
    // No code-default tracks (4.7): a client with no plan doc has no tracks, so nothing is profiled.
    assert.deepEqual(r.trackProfiles, []);
    assert.doesNotMatch(JSON.stringify(r.trackProfiles), /seb__design/);
  }
});

test('strategy-get: a partial saved profile reports only the unset fields (no benchmark fallback)', async () => {
  const b = setup({ config: { ownHandle: 'me_acct', benchmarkHandles: [] } });
  const r = await b.call('strategy-get');
  assert.equal(r.profile.ownHandle, 'me_acct');
  assert.deepEqual(r.profile.benchmarkHandles, []);
  assert.deepEqual(r.profile.unset, ['benchmarkHandles']);
  assert.deepEqual(r.profile.defaulted, ['timezone']);
  assert.equal(b.evalCalls.length, 1);
  assert.deepEqual(b.evalCalls[0].benchmarks, []);
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

test('strategy-refresh with an empty profile is a 400 (nothing to refresh), never the owner pair', async () => {
  const s = setup({ config: {} });
  const r = await s.call('strategy-refresh');
  assert.equal(r.status, 400);
  assert.match(r.error, /no own or benchmark handle/);
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
  assert.deepEqual((await deps.searchInventory({ query: 'dawn pier', limit: 5 })).rows.map((p) => p.id), ['p1']);
  assert.equal((await deps.searchInventory({ query: '', limit: 999 })).rows.length, 2);
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
  // The home client stores its own handle (seed-home-priors.mjs); the committed rows are a handle-keyed cache.
  const cfgDoc = { get: async () => ({ exists: true, data: () => ({ marketingBriefConfig: { xGrowth: { ownHandle: 'bai_ee' } } }) }), collection: () => emptyCol };
  const db = { collection: (name) => (name === 'client_configs' ? { doc: () => cfgDoc } : emptyCol) };
  const seen = [];
  const h = createStrategyHandlersFromDb(db, {
    env: {}, readPackages: async () => [],
    loadCommitted: (handle) => { seen.push(handle); return handle === 'bai_ee' ? rowsFor(4) : null; },
  });
  const r = await h.handle('strategy-get', { clientId: 'c1' }, CTX, AUTH);
  assert.ok(seen.includes('bai_ee'), 'injected loader was consulted for the saved own handle');
  const own = r.rowsMeta.find((m) => m.handle === 'bai_ee');
  assert.equal(own.source, 'committed-json');
  assert.equal(own.rowsMeta.rowCount, 4);
});

test('createStrategyHandlersFromDb forwards route deps: a calendar batch drafts with the item media from mediaForItem', async () => {
  const chain = { where: () => chain, select: () => chain, limit: () => chain, get: async () => ({ docs: [], empty: true, forEach: () => {} }), doc: () => ({ get: async () => ({ exists: false, data: () => undefined }), collection: () => chain }) };
  const db = { collection: () => chain };
  const drafts = [];
  const h = createStrategyHandlersFromDb(db, {
    env: {},
    readPackages: async () => [{ id: 'birthday-x', clientId: 'c1', title: 'X birthday (12-31)', eventDate: '1970-12-31', engine: 'record', story: 'X was born 1970-12-31.' }],
    mediaForItem: async (cid, pkg) => ({ mediaUrl: `https://m/${cid}/${pkg.id}.mp4`, mediaType: 'video' }),
    ensureDraft: async (cid, payload) => { drafts.push(payload); return { post: payload, existing: false }; },
  });
  const r = await h.handle('strategy-calendar-batch-create', { clientId: 'c1', spec: { select: { ids: ['birthday-x'] }, dateRule: { kind: 'anniversary' } } }, CTX, AUTH);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.created, 1);
  assert.equal(drafts[0].mediaUrl, 'https://m/c1/birthday-x.mp4');
  assert.match(drafts[0].content, /\[add your memory\]$/);
  assert.equal(drafts[0].needsStory, true);
  assert.match(drafts[0].reviewOn, /-12-31$/);
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
  assert.deepEqual(hits.rows.map((p) => [p.id, p.hasStory]).sort(), [['p2', true], ['p3', false], ['rv-1', false]]);
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
  // No code-default tracks: the first save's design benchmark is new too, so it is queued with the music ones.
  assert.deepEqual((await s.queueStore.get(a.refresh.requestId)).handles, ['seb__design', 'toshioueki', 'dorksirjur', 'discogs']);
  assert.equal(await s.queueStore.get('req-2'), null);
});

test('with explicit tracks, a direct profile save keeps the track-derived benchmarks (own handle still changes)', async () => {
  const s = mirrorSetup();
  await s.call('strategy-plan-apply', { changes: { contentTracks: musicTracks(['dorksirjur']) }, expectedVersion: 0, reason: '' });
  const res = await s.call('strategy-profile-save', { ownHandle: 'new_me', benchmarkHandles: ['someone_else'] });
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(s.saves.at(-1), { clientId: 'c1', ownHandle: 'new_me', benchmarkHandles: ['seb__design', 'dorksirjur'] });
});

// --- readClientAudience: resolved by account id, never by handle, never another client's account ---------------
function audienceDb({ social = {}, monitors = {} } = {}) {
  const sub = (rows) => {
    const q = { orderBy: () => q, limit: () => q, get: async () => ({ docs: rows.map((r) => ({ data: () => r })) }) };
    return q;
  };
  const monitorSnap = (id) => {
    const m = monitors[id];
    return {
      id, exists: !!m, data: () => m?.root,
      ref: { collection: (name) => sub(m?.[name] ?? []) },
    };
  };
  const queries = [];
  return {
    queries,
    collection: (name) => {
      if (name === 'social_accounts') return { doc: (id) => ({ get: async () => ({ exists: !!social[id], data: () => social[id] }) }) };
      if (name === 'x_monitor') {
        return {
          doc: (id) => ({ get: async () => monitorSnap(id) }),
          where: (field, op, value) => ({
            limit: () => ({
              get: async () => {
                queries.push([field, op, value]);
                const ids = Object.keys(monitors).filter((id) => field === 'clientIds' && op === 'array-contains' && (monitors[id].root.clientIds || []).includes(value));
                return { docs: ids.slice(0, 1).map(monitorSnap) };
              },
            }),
          }),
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  };
}

test('readClientAudience: social_accounts userId -> x_monitor/{userId}; clientIds fallback; none -> {account:null}', async () => {
  const { readClientAudience } = await import('../route-handlers.js');
  const monitors = {
    111: { root: { profile: { username: 'bai_ee' }, clientIds: ['home'] }, snapshots: [{ date: '2026-10-01' }], audience_events: [], posts: [{ id: 'p' }] },
    222: { root: { profile: { username: 'client_b' }, clientIds: ['b'] }, snapshots: [], audience_events: [], posts: [] },
  };
  const db = audienceDb({ social: { home: { platforms: { x: { userId: '111' } } } }, monitors });

  const home = await readClientAudience(db, 'home');
  assert.equal(home.account.profile.username, 'bai_ee');
  assert.equal(home.posts.length, 1);
  assert.equal(db.queries.length, 0, 'id path wins: no fallback query');

  const b = await readClientAudience(db, 'b');
  assert.equal(b.account.profile.username, 'client_b', 'fallback by clientIds array-contains');

  const stranger = await readClientAudience(db, 'nobody');
  assert.deepEqual(stranger, { account: null }, 'no account => not available, never another client\'s (not even the only/home one)');

  // A social account pointing at a userId with no monitor doc falls back to clientIds, still never another client's.
  const dangling = audienceDb({ social: { c: { platforms: { x: { userId: '999' } } } }, monitors });
  assert.deepEqual(await readClientAudience(dangling, 'c'), { account: null });
  assert.deepEqual(await readClientAudience(db, ''), { account: null });
});

test('daily fill: preview plans without writing, create writes drafts through ensureDraft, dailyFillDeps is exposed for the cron', async () => {
  const chain = { where: () => chain, select: () => chain, limit: () => chain, get: async () => ({ docs: [], empty: true, forEach: () => {} }), doc: () => ({ get: async () => ({ exists: false, data: () => undefined }), collection: () => chain }) };
  const drafts = [];
  const h = createStrategyHandlersFromDb({ collection: () => chain }, {
    env: {},
    readPackages: async () => [{ id: 'rec-1', clientId: 'c1', bucketId: 'record', engine: 'record', title: 'A record', mediaState: 'video', effort: 'ready' }],
    readMarketSignals: async () => ({ generatedAt: '2026-10-17T00:00:00Z', narratives: [{ trend: 'Vinyl is back', detail: 'up' }] }),
    readQuoteTargets: async () => ({ generatedAt: null, targets: [] }),
    ensureDraft: async (cid, payload) => { drafts.push(payload); return { post: payload, existing: false }; },
  });
  assert.equal(typeof h.dailyFillDeps.loadInputs, 'function');
  const pre = await h.handle('strategy-daily-fill-preview', { clientId: 'c1', spec: { days: 1, include: ['narratives'] } }, CTX, AUTH);
  assert.equal(pre.ok, true, pre.error);
  assert.equal(pre.preview, true);
  assert.equal(drafts.length, 0);
  assert.equal((await h.handle('strategy-daily-fill-preview', { clientId: 'c1', spec: { days: 99 } }, CTX, AUTH)).ok, false);
  const r = await h.handle('strategy-daily-fill-create', { clientId: 'c1', spec: { days: 1, include: ['narratives'] } }, CTX, AUTH);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.created, 1);
  assert.equal(drafts[0].source, 'daily-fill');
  assert.equal(drafts[0].fillKind, 'narrative');
  assert.match(drafts[0].content, /\[add your take\]$/);
});

test('strategy-freshness: per-group oldest asOf + tightest max age from the brief bundle', async () => {
  const h = createStrategyHandlers({
    corpusStore: { get: async () => null }, planStore: { get: async () => null }, refreshService: {}, readXGrowthConfig: async () => null,
    readBriefRaw: async () => ({ marketingBrief: null }),
  });
  const r = await h.handle('strategy-freshness', { clientId: 'c1' }, CTX, AUTH);
  assert.equal(r.ok, true);
  assert.ok(r.parts && typeof r.parts === 'object');
  assert.equal(r.groups.staleAfterHours['market-signals'], 24);
  assert.equal(r.groups.serverAsOf['market-signals'], null);
  assert.ok(r.staleGroups.includes('market-signals'));
});

test('chat-send: the model sees what happened to earlier cards; a card-free reply gets no false "no card" note', async () => {
  let n = 0;
  const s = chatSetup({ loopResult: () => (n++ === 0
    ? { text: 'Card is up.', proposals: [{ kind: 'refresh', payload: { groups: ['today-queue'], reason: 'stale' }, summary: 'Refresh', rationale: 'stale', evidence: [] }] }
    : { text: 'Confirm the card to start it.', proposals: [] }) });
  const r1 = await s.call('strategy-chat-send', { text: 'refresh' });
  const d = await s.call('strategy-proposal-decide', { threadId: r1.threadId, proposalId: r1.proposals[0].id, decision: 'confirm' });
  assert.equal(d.ok, true, JSON.stringify(d));
  const r2 = await s.call('strategy-chat-send', { text: 'did it run?', threadId: r1.threadId });
  const prior = s.loopCalls[1].history.find((m) => m.role === 'assistant');
  assert.match(prior.text, /CARD OUTCOMES/);
  assert.match(prior.text, /refresh card: confirmed \(handed to the Refresh panel: today-queue\)/);
  assert.equal(r2.text, 'Confirm the card to start it.');
});

test('chat-send: a failed propose attempt with no card says so under the reply', async () => {
  const s = chatSetup({ loopResult: { text: 'Card is up.', proposals: [], proposalErrors: ['refresh: groups must be a non-empty list'] } });
  const r = await s.call('strategy-chat-send', { text: 'refresh' });
  assert.match(r.text, /No confirm card was created: refresh: groups must be a non-empty list/);
});
