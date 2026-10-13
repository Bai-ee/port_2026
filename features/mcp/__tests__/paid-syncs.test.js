import test from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../registry.js';
import { handleRpc } from '../jsonrpc.js';
import { createStrategyHandlers } from '../../x-strategy/route-handlers.js';
import { createMemoryCorpusStore } from '../../x-strategy/corpus-store.js';
import { createMemoryPlanStore } from '../../x-strategy/plan-store.js';
import { createMemoryChatStore } from '../../x-strategy/agent/chat-store.js';
import { createRefreshService, createMemoryRefreshQueue } from '../../x-strategy/refresh.js';
import { validateProposal } from '../../x-strategy/agent/proposals.js';
import { proposalPayloadPreview, proposalKindLabel, proposalStatusText } from '../../x-strategy/ui-model.js';
import { describePaidSync, executePaidSync, normalizeParams, PaidSyncError } from '../paid-syncs.js';
import { createMemoryCounters, DAILY_PAID_CAP } from '../limits.js';
import { createFakeDb } from './fake-db.js';

const NOW = Date.parse('2026-10-12T12:00:00Z');
const OWNER = 'bryan-balli-WUoltG84';
const AUTH = { decoded: { email: 'owner@example.com' } };

// One shared world: the MCP side (request_sync) and the dashboard side (strategy-proposal-decide + runPaidSync) over the SAME chat store.
function world({ withExecutor = true } = {}) {
  const ran = [];
  const counters = createMemoryCounters();
  const chat = createMemoryChatStore({ cap: 200 });
  const corpusStore = createMemoryCorpusStore({ loadCommitted: () => null });
  const execServices = {
    counters: () => counters,
    strategyHandlers: () => ({ handle: async (action, body, context) => { ran.push(['review', action, body, context]); return { ok: true, threadId: 'review-thread', proposals: [{ id: 'p', kind: 'plan-change', summary: 's' }], lastReview: { at: 'now' } }; } }),
    xMonitor: async () => ({
      status: async () => ({ accountId: '1' }), estimateAudienceCalls: async () => ({ pages: 2 }),
      syncProfile: async () => { ran.push(['xprofile']); return { callsMade: 1 }; }, syncPosts: async () => { ran.push(['xposts']); return { callsMade: 2 }; }, syncAudience: async () => { ran.push(['xaudience']); return { callsMade: 2 }; },
    }),
    nas: async (action, body, email) => { ran.push(['nas', action, body, email]); return { ok: true, jobId: 'j1' }; },
  };
  const h = createStrategyHandlers({
    corpusStore, planStore: createMemoryPlanStore(), chatStore: chat, clock: () => NOW,
    refreshService: createRefreshService({ store: corpusStore, queueStore: createMemoryRefreshQueue(), now: () => NOW, enabled: false, detectBird: async () => ({ available: false }), idGen: () => 'r1', ingest: async () => ({ rows: [], pull: {} }), runBirdFor: () => () => '' }),
    readXGrowthConfig: async () => ({ ownHandle: 'me_acct', benchmarkHandles: [] }),
    readTodayRun: async () => ({ suggestions: [] }),
    ...(withExecutor ? { runPaidSync: ({ clientId, kind, params, auth }) => executePaidSync({ kind, params, ctx: { email: auth.decoded.email, clientId, auth, now: () => NOW, services: execServices } }) } : {}),
  });
  // What the MCP server sees: it can price and create cards, and it has NO counters-backed executor and no sync functions.
  const mcpServices = {
    strategyHandlers: () => h,
    xMonitor: () => ({ status: async () => ({ accountId: '1' }), estimateAudienceCalls: async () => ({ pages: 2 }) }),
  };
  const ctx = { db: createFakeDb({ [`clients/${OWNER}`]: { name: 'Bryan' } }), email: 'bryanballi@gmail.com', clientId: OWNER, now: () => NOW, services: mcpServices };
  const call = async (name, args) => {
    const { body } = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { registry, ctx, instructions: '' });
    return body.result ?? { isError: true, content: [{ type: 'text', text: body.error.message }] }; // unknown tool = JSON-RPC error
  };
  const decide = (threadId, proposalId, decision = 'confirm') => h.handle('strategy-proposal-decide', { clientId: OWNER, threadId, proposalId, decision }, { clientId: OWNER }, AUTH);
  return { ran, h, chat, call, decide, counters };
}
const textOf = (r) => JSON.parse(r.content[0].text);

test('request_sync creates a paid-sync PROPOSAL CARD: nothing runs, no confirm code ever reaches the model', async () => {
  const { ran, call, chat } = world();
  const res = await call('request_sync', { kind: 'x_monitor_sync', params: { include: ['profile', 'posts', 'audience'] } });
  assert.equal(res.isError, undefined, res.content[0].text);
  const out = textOf(res);
  assert.equal(out.status, 'pending');
  assert.match(out.threadId, /^t_mcp_20261012$/);
  assert.match(out.estimatedCost, /Up to 5 metered X API READ calls/);
  assert.match(out.next, /press Confirm/i);
  assert.ok(!JSON.stringify(out).match(/confirmCode|[A-Z2-9]{10}"/), 'no confirm code in the result');
  assert.equal(ran.length, 0, 'request_sync must not execute anything');
  const p = (await chat.getThread(OWNER, out.threadId)).proposals[out.proposalId];
  assert.equal(p.kind, 'paid-sync');
  assert.equal(p.status, 'pending');
  assert.deepEqual(p.payload.kind, 'x_monitor_sync');
  assert.deepEqual(p.payload.params, { include: ['profile', 'posts', 'audience'] });
  assert.match(p.payload.estimate, /metered X API READ/);
  assert.match(p.summary, /5 metered read calls/);
  // there is no tool that could confirm it
  assert.equal((await call('confirm_sync', { confirmCode: 'ABCDEFGHJK' })).isError, true);
});

test('the card runs ONLY when the owner confirms it in HITLOOP (strategy-proposal-decide); reject runs nothing; no double-run', async () => {
  const { ran, call, decide, chat } = world();
  const out = textOf(await call('request_sync', { kind: 'x_monitor_sync' }));
  assert.equal(ran.length, 0);
  const done = await decide(out.threadId, out.proposalId);
  assert.equal(done.ok, true);
  assert.equal(done.proposal.status, 'confirmed');
  assert.deepEqual(ran.map((r) => r[0]), ['xprofile', 'xposts']);
  assert.equal(done.proposal.result.calls, 3);
  assert.match(proposalStatusText(done.proposal).detail, /3 X API read calls/);
  const again = await decide(out.threadId, out.proposalId);
  assert.equal(again.ok, false);
  assert.equal(again.status, 409);
  assert.equal(ran.length, 2, 'a second confirm never re-runs it');
  // reject executes nothing
  const r2 = textOf(await call('request_sync', { kind: 'x_monitor_sync' }));
  const rej = await decide(r2.threadId, r2.proposalId, 'reject');
  assert.equal(rej.proposal.status, 'rejected');
  assert.equal(ran.length, 2);
  assert.equal((await chat.getThread(OWNER, r2.threadId)).proposals[r2.proposalId].status, 'rejected');
});

test('strategy_review card: runs the review for the card\'s client, not a client named in params', async () => {
  const { ran, call, decide } = world();
  const out = textOf(await call('request_sync', { kind: 'strategy_review', params: { clientId: OWNER } }));
  assert.match(out.estimatedCost, /\$0\.17/);
  const done = await decide(out.threadId, out.proposalId);
  assert.equal(done.proposal.status, 'confirmed');
  assert.equal(ran[0][1], 'strategy-review');
  assert.deepEqual(ran[0][2], { clientId: OWNER });
  assert.equal(done.proposal.result.threadId, 'review-thread');
});

test('nas_analyze card: batch mode forced, capUsd <= 2, cap shown on the card', async () => {
  const { ran, call, decide } = world();
  for (const params of [{}, { sourceId: 's', paths: [] }, { sourceId: 's', paths: ['a'], capUsd: 3 }, { sourceId: 's', paths: ['a'], capUsd: 0 }, { sourceId: 's', paths: [42] }]) {
    assert.equal((await call('request_sync', { kind: 'nas_analyze', params })).isError, true, JSON.stringify(params));
  }
  const out = textOf(await call('request_sync', { kind: 'nas_analyze', params: { sourceId: 's', paths: ['a/b.mp4'], capUsd: 1.5 } }));
  assert.match(out.estimatedCost, /\$1\.50/);
  assert.equal(ran.length, 0);
  await decide(out.threadId, out.proposalId);
  assert.deepEqual(ran.at(-1), ['nas', 'nas-process', { sourceId: 's', paths: ['a/b.mp4'], capUsd: 1.5, batch: true }, 'owner@example.com']);
  const lines = proposalPayloadPreview('paid-sync', { kind: 'nas_analyze', params: { sourceId: 's', paths: ['a', 'b'], capUsd: 1.5 }, estimate: 'e' });
  assert.ok(lines.some((l) => /Spend cap: \$1\.50/.test(l)));
});

test('x_monitor_sync: include is validated; the card names the metered call count', async () => {
  const { call } = world();
  assert.equal((await call('request_sync', { kind: 'x_monitor_sync', params: { include: ['post_tweet'] } })).isError, true);
  const base = textOf(await call('request_sync', { kind: 'x_monitor_sync' }));
  assert.match(base.estimatedCost, /Up to 3 metered X API READ calls/);
  const lines = proposalPayloadPreview('paid-sync', { kind: 'x_monitor_sync', params: { include: ['profile', 'posts'] }, estimate: base.estimatedCost });
  assert.ok(lines.some((l) => /Estimated cost: Up to 3 metered X API READ calls/.test(l)));
  assert.ok(lines.some((l) => /Nothing runs until you press Confirm/.test(l)));
});

test('market_signals_refresh is gone (paid X reads): not a valid kind anywhere', async () => {
  const { call } = world();
  const kinds = registry.find((t) => t.name === 'request_sync').inputSchema.properties.kind.enum;
  assert.ok(!kinds.includes('market_signals_refresh'));
  assert.equal((await call('request_sync', { kind: 'market_signals_refresh' })).isError, true);
  await assert.rejects(describePaidSync('market_signals_refresh', {}, {}), PaidSyncError);
  assert.throws(() => normalizeParams('market_signals_refresh', {}), PaidSyncError);
  assert.equal(validateProposal({ kind: 'paid-sync', payload: { kind: 'market_signals_refresh', params: {}, estimate: 'x' } }).ok, false);
  assert.match(registry.find((t) => t.name === 'request_sync').description, /Refresh button in the Marketing Director header/);
});

test('daily cap is enforced IN the executor, atomically: 12 concurrent confirms -> exactly 10 run', async () => {
  const { ran, call, decide, counters } = world();
  const cards = [];
  for (let i = 0; i < 12; i += 1) cards.push(textOf(await call('request_sync', { kind: 'x_monitor_sync', params: { include: ['profile'] } })));
  const results = await Promise.all(cards.map((c) => decide(c.threadId, c.proposalId)));
  const statuses = results.map((r) => r.proposal.status);
  assert.equal(statuses.filter((s) => s === 'confirmed').length, DAILY_PAID_CAP);
  const failed = results.filter((r) => r.proposal.status === 'failed');
  assert.equal(failed.length, 2);
  assert.ok(failed.every((r) => /Daily limit reached/.test(r.proposal.result.message)));
  assert.equal(ran.filter((r) => r[0] === 'xprofile').length, DAILY_PAID_CAP, 'the over-cap confirms never touched the X API');
  assert.equal([...counters._raw.values()][0], DAILY_PAID_CAP);
});

test('executor missing on this deployment: confirming fails closed with a clear message, nothing runs', async () => {
  const { ran, call, decide } = world({ withExecutor: false });
  const out = textOf(await call('request_sync', { kind: 'x_monitor_sync' }));
  const done = await decide(out.threadId, out.proposalId);
  assert.equal(done.proposal.status, 'failed');
  assert.match(done.proposal.result.message, /not available/);
  assert.equal(ran.length, 0);
});

test('executePaidSync re-validates params at confirm time (a tampered card cannot exceed the cap)', async () => {
  const counters = createMemoryCounters();
  const ctx = { email: 'o@x.test', clientId: OWNER, now: () => NOW, services: { counters: () => counters, nas: async () => ({ ok: true }) } };
  await assert.rejects(executePaidSync({ kind: 'nas_analyze', params: { sourceId: 's', paths: ['a'], capUsd: 50 }, ctx }), PaidSyncError);
  assert.equal(counters._raw.size, 0, 'a refused request does not burn a daily slot');
  await assert.rejects(executePaidSync({ kind: 'market_signals_refresh', params: {}, ctx }), PaidSyncError);
});

test('validateProposal paid-sync: kind, params object, estimate required, params size bounded', () => {
  const ok = validateProposal({ kind: 'paid-sync', payload: { kind: 'strategy_review', params: {}, estimate: ' ~$0.17 ', junk: 1 } });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.proposal.payload, { kind: 'strategy_review', params: {}, estimate: '~$0.17' });
  for (const payload of [
    { kind: 'nope', params: {}, estimate: 'e' }, { kind: 'strategy_review', estimate: 'e' }, { kind: 'strategy_review', params: [], estimate: 'e' },
    { kind: 'strategy_review', params: {}, estimate: '' }, { kind: 'nas_analyze', params: { paths: 'x'.repeat(5000) }, estimate: 'e' },
  ]) assert.equal(validateProposal({ kind: 'paid-sync', payload }).ok, false, JSON.stringify(payload).slice(0, 60));
});

test('ui-model: label, result lines and preview for paid-sync', () => {
  assert.equal(proposalKindLabel('paid-sync'), 'Run a paid sync');
  assert.match(proposalStatusText({ kind: 'paid-sync', status: 'confirmed', result: { kind: 'strategy_review' } }).detail, /Review done/);
  const lines = proposalPayloadPreview('paid-sync', { kind: 'strategy_review', params: {}, estimate: '~$0.17 Anthropic' });
  assert.ok(lines[0].match(/Strategy review/));
  assert.ok(lines.some((l) => l === 'Estimated cost: ~$0.17 Anthropic'));
});
