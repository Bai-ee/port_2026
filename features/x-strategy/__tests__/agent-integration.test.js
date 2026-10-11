// T4 integration: REAL agent loop + REAL tools/proposals/chat-store/plan-store (memory) + REAL evaluate,
// driven by a scripted fake callModel (Anthropic Messages shape). No network, no model, no Firestore.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStrategyHandlers, summarizeTodayRun } from '../route-handlers.js';
import { createMemoryCorpusStore } from '../corpus-store.js';
import { createMemoryPlanStore } from '../plan-store.js';
import { createRefreshService, createMemoryRefreshQueue } from '../refresh.js';
import { createMemoryChatStore } from '../agent/chat-store.js';
import { AgentError } from '../agent/loop.js';

const NOW = Date.parse('2026-10-11T12:00:00.000Z');
const CTX = { clientId: 'c1' };
const AUTH = { decoded: { email: 'admin@x.test', uid: 'u1' } };

// ---- scripted model -------------------------------------------------------------------------------
const usage = { input_tokens: 10, output_tokens: 5 };
const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage });
const useTool = (name, input, id = `tu_${name}`) => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use', usage });
/** Each step: a response object, or (request) => response. Throws if the loop asks for more calls than scripted. */
function scripted(steps) {
  const requests = [];
  const callModel = async (req) => {
    requests.push(JSON.parse(JSON.stringify(req)));
    const step = steps[requests.length - 1];
    if (!step) throw new Error(`unscripted model call #${requests.length}`);
    return typeof step === 'function' ? step(req) : step;
  };
  return { callModel, requests };
}
const lastToolResult = (req) => {
  const m = req.messages[req.messages.length - 1];
  return m.content.find((b) => b.type === 'tool_result');
};

// ---- fixtures -------------------------------------------------------------------------------------
const mkRow = (i, over = {}) => ({
  id: String(i), utc: new Date(Date.parse('2026-09-01T10:00:00Z') + i * 3600000).toISOString(),
  dateLocal: `2026-09-${String(1 + (i % 25)).padStart(2, '0')}`, hourLocal: 10 + (i % 8),
  type: i % 3 ? 'original-text' : 'original-showcase', media: 'none', topics: [], chars: 80 + i,
  likes: i % 7, reposts: 0, replies: 0, text: `post ${i}`, ...over,
});
const rows = (n, over, start = 0) => Array.from({ length: n }, (_, i) => mkRow(start + i, over));

async function build({ cap = 60, callModel, logUsage, env = {}, todayRun, packages = [], planSeed, runDailyAction } = {}) {
  const corpusStore = createMemoryCorpusStore({ loadCommitted: () => null });
  // own account: NO views at all => likes-only caveat. benchmark has views and some quote-reacts.
  await corpusStore.writeMergedRows('me_acct', rows(80, { views: null }), { pulledAt: '2026-10-10T12:00:00.000Z' });
  await corpusStore.writeMergedRows('bench_a', [...rows(70, { views: 500 }), ...rows(10, { views: 900, type: 'quote-react' }, 200)], { pulledAt: '2026-10-10T12:00:00.000Z' });
  const planStore = createMemoryPlanStore();
  if (planSeed) await planStore.apply('c1', { ...planSeed, by: 'seed', source: 'manual', now: NOW });
  const chatStore = createMemoryChatStore({ cap });
  const refreshService = createRefreshService({ store: corpusStore, queueStore: createMemoryRefreshQueue(), now: () => NOW, enabled: false, detectBird: async () => ({ available: false }), idGen: () => 'req-1', ingest: async () => ({ rows: [], pull: {} }), runBirdFor: () => () => '' });
  const dailyCalls = [];
  const itemCalls = [];
  const previews = [];
  const h = createStrategyHandlers({
    corpusStore, planStore, refreshService, chatStore, clock: () => NOW, env,
    // REAL evaluate (default). Preview builder is a spy so we can see the post count it was given.
    buildPreviewPlan: (input) => { previews.push(input); return { slots: [], posts: input.posts }; },
    readXGrowthConfig: async () => ({ ownHandle: 'me_acct', benchmarkHandles: ['bench_a'], timezone: 'America/Chicago' }),
    readPackages: async () => packages,
    callModel, logUsage: logUsage ?? (async () => ({ costUsd: 0 })), // never the real usage-logger (it would try Firestore)
    runDailyAction: runDailyAction ?? (async (ctx, action, body) => { dailyCalls.push([action, body]); return { ok: true, run: { localDate: '2026-10-11' } }; }),
    runUpdateItemFacets: async (ctx, body) => { itemCalls.push(body); return { ok: true, pkg: { id: body.id } }; },
    readTodayRun: async () => todayRun ?? null,
    saveXGrowthProfile: async (id, p) => p,
  });
  const call = (action, body) => h.handle(action, { clientId: 'c1', ...body }, CTX, AUTH);
  return { h, call, planStore, chatStore, dailyCalls, itemCalls, previews };
}

const PLAN_PROPOSAL = (over = {}) => ({
  changes: { authoredPerDay: 3, typeFloors: { 'quote-react': 1 } }, expectedVersion: 1,
  summary: 'Go to 3 posts a day, keep one quote-react', rationale: 'Owner asked for it.',
  evidence: [{ source: 'owner', figure: 'asked for 3/day' }], ...over,
});
const RUN = { localDate: '2026-10-11', suggestions: [
  { id: 'sg1', type: 'original', slot: { letter: 'A', timeCT: '09:00' }, reviewState: 'edited', edit: { text: 'old text' } },
  { id: 'sg2', type: 'quote', proposedSlot: { localTime: '14:00' }, draft: { text: 'drafted' } },
] };

// ---- 1. question -> get_evaluation -> cited figure; likes-only caveat is in the tool result --------------
test('1: question -> get_evaluation -> answer cites a figure from the tool result (likes-only caveat fed back)', async () => {
  let cited;
  const m = scripted([
    useTool('get_evaluation', {}),
    (req) => {
      const tr = lastToolResult(req);
      const ev = JSON.parse(tr.content).evaluation;
      cited = ev.own.rows;
      return say(`Your account has ${cited} rows in the data (likes-only lift).`);
    },
  ]);
  const logged = [];
  const s = await build({ callModel: m.callModel, logUsage: async (a) => { logged.push(a); return { costUsd: 0.001 }; } });
  const r = await s.call('strategy-chat-send', { text: 'how am I doing vs bench_a?' });
  assert.equal(r.ok, true);
  assert.equal(cited, 80);
  assert.match(r.text, /80 rows/);
  assert.deepEqual(r.proposals, []);
  // The evaluation the model saw carries the likes-only caveat for the owner's own account.
  const fed = JSON.parse(lastToolResult(m.requests[1]).content);
  assert.ok(fed.evaluation.caveats.some((c) => c.code === 'likes-only' && c.handle === 'me_acct'));
  // usage: one logUsage per model call, with clientId + purpose, and totals returned
  assert.equal(logged.length, 2);
  for (const l of logged) {
    assert.equal(l.clientId, 'c1');
    assert.equal(l.purpose, 'x-strategy-chat');
    assert.equal(l.threadId, r.threadId);
    assert.deepEqual(l.usage, { input_tokens: 10, output_tokens: 5 });
  }
  assert.deepEqual([r.usage.calls, r.usage.inputTokens, r.usage.outputTokens], [2, 20, 10]);
  assert.equal(r.usage.costUsd, 0.002);
  assert.equal(r.rounds, 1);
  assert.equal(r.turnsUsedToday, 1);
});

// ---- 2. plan change: propose -> nothing written -> confirm -> v+1, source chat -> preview uses 3 ----------
test('2: propose_plan_change -> pending, nothing written -> confirm -> version+1 (source chat, proposalId) -> preview posts 3', async () => {
  const m = scripted([
    useTool('get_plan', {}),
    (req) => {
      const plan = JSON.parse(lastToolResult(req).content).plan;
      return useTool('propose_plan_change', PLAN_PROPOSAL({ expectedVersion: plan.version }), 'tu_prop');
    },
    say('I have put a proposal card up; confirm it to apply.'),
  ]);
  const s = await build({ callModel: m.callModel, planSeed: { changes: { authoredPerDay: 2 }, expectedVersion: 0 } });
  assert.equal((await s.planStore.get('c1')).version, 1);

  const r = await s.call('strategy-chat-send', { text: 'make it 3 posts a day and keep one quote-react' });
  assert.equal(r.ok, true);
  assert.equal(r.proposals.length, 1);
  const p = r.proposals[0];
  assert.match(p.id, /^[0-9a-f-]{36}$/);
  assert.equal(p.threadId, r.threadId);
  assert.equal(p.status, 'pending');
  assert.equal(p.kind, 'plan-change');
  assert.deepEqual(p.payload, { changes: { authoredPerDay: 3, typeFloors: { 'quote-react': 1 } }, expectedVersion: 1 });
  assert.deepEqual(p.evidence, [{ source: 'owner', figure: 'asked for 3/day' }]);
  // pending only: plan untouched
  assert.equal((await s.planStore.get('c1')).version, 1);
  assert.equal((await s.planStore.get('c1')).plan.authoredPerDay, 2);

  const d = await s.call('strategy-proposal-decide', { threadId: r.threadId, proposalId: p.id, decision: 'confirm' });
  assert.equal(d.ok, true, JSON.stringify(d));
  assert.equal(d.proposal.status, 'confirmed');
  assert.equal(d.planDoc.version, 2);
  const last = d.planDoc.history.at(-1);
  assert.equal(last.source, 'chat');
  assert.equal(last.proposalId, p.id);
  assert.equal(last.by, 'admin@x.test');
  assert.deepEqual(d.planDoc.plan.typeFloors, { 'quote-react': 1 });

  const g = await s.call('strategy-get', {});
  assert.equal(g.todayPlanPreview.posts, 3);
  assert.equal(s.previews.at(-1).posts, 3);
});

// ---- 3 + 4. suggestion edit confirm hits daily-run-edit with {suggestionId,text}; reject runs nothing ---
test('3: propose_suggestion_edit -> confirm -> daily-run-edit body is exactly {suggestionId, text}', async () => {
  const m = scripted([
    useTool('get_today_run', {}),
    (req) => {
      const ids = JSON.parse(lastToolResult(req).content).suggestions.map((x) => x.id);
      assert.deepEqual(ids, ['sg1', 'sg2']);
      return useTool('propose_suggestion_edit', { suggestionId: 'sg2', text: 'Shorter and sharper.', summary: 'Tighten sg2', rationale: 'Quote captions stay short.', evidence: [] }, 'tu_edit');
    },
    say('Proposal is up.'),
  ]);
  const s = await build({ callModel: m.callModel, todayRun: RUN });
  const r = await s.call('strategy-chat-send', { text: 'tighten the second suggestion' });
  assert.equal(r.proposals.length, 1);
  assert.deepEqual(r.proposals[0].payload, { suggestionId: 'sg2', text: 'Shorter and sharper.' });
  assert.deepEqual(s.dailyCalls, [], 'nothing runs before confirm');
  const d = await s.call('strategy-proposal-decide', { threadId: r.threadId, proposalId: r.proposals[0].id, decision: 'confirm' });
  assert.equal(d.proposal.status, 'confirmed');
  assert.deepEqual(s.dailyCalls, [['daily-run-edit', { suggestionId: 'sg2', text: 'Shorter and sharper.' }]]);
});

test('3b: a suggestionId not in today\'s run is rejected back to the model (no proposal)', async () => {
  const m = scripted([
    useTool('propose_suggestion_dismiss', { suggestionId: 'ghost', summary: 's', rationale: 'r', evidence: [] }),
    (req) => { assert.equal(lastToolResult(req).is_error, true); return say('That id does not exist.'); },
  ]);
  const s = await build({ callModel: m.callModel, todayRun: RUN });
  const r = await s.call('strategy-chat-send', { text: 'dismiss ghost' });
  assert.deepEqual(r.proposals, []);
});

test('4: reject -> executors never called, plan unchanged', async () => {
  const m = scripted([
    useTool('propose_plan_change', PLAN_PROPOSAL({ expectedVersion: 0, changes: { authoredPerDay: 5 } })),
    useTool('propose_suggestion_dismiss', { suggestionId: 'sg1', summary: 'd', rationale: 'r', evidence: [] }, 'tu_2'),
    say('Two proposals are up.'),
  ]);
  const s = await build({ callModel: m.callModel, todayRun: RUN });
  const r = await s.call('strategy-chat-send', { text: 'do both' });
  assert.equal(r.proposals.length, 2);
  for (const p of r.proposals) {
    const d = await s.call('strategy-proposal-decide', { threadId: r.threadId, proposalId: p.id, decision: 'reject' });
    assert.equal(d.proposal.status, 'rejected');
  }
  assert.deepEqual(s.dailyCalls, []);
  assert.deepEqual(s.itemCalls, []);
  assert.equal(await s.planStore.get('c1'), null);
  // already decided -> 409, still nothing run
  const again = await s.call('strategy-proposal-decide', { threadId: r.threadId, proposalId: r.proposals[0].id, decision: 'confirm' });
  assert.equal(again.status, 409);
  assert.equal(await s.planStore.get('c1'), null);
});

// ---- 5. nonexistent figure -> 'no data', no proposal ---------------------------------------------------
test('5: a question with no backing data -> scripted "no data" answer, no proposal', async () => {
  const m = scripted([
    useTool('top_posts', { type: 'podcast-clip', topic: 'zzz' }),
    (req) => {
      assert.deepEqual(JSON.parse(lastToolResult(req).content).rows, []);
      return say('No data: there are no podcast-clip posts in the corpus.');
    },
  ]);
  const s = await build({ callModel: m.callModel });
  const r = await s.call('strategy-chat-send', { text: 'what was my best podcast-clip?' });
  assert.match(r.text, /^No data/);
  assert.deepEqual(r.proposals, []);
});

// ---- item-story: sourceQuote enforcement and field mapping -----------------------------------------------
test('item-story without a sourceQuote from the owner is dropped (tool error to the model, no proposal)', async () => {
  const m = scripted([
    useTool('propose_item_story', { itemId: 'p1', story: 'Shot at dawn on the pier.', sourceQuote: 'I shot it at dawn on the pier', summary: 's', rationale: 'r', evidence: [] }),
    (req) => { const tr = lastToolResult(req); assert.equal(tr.is_error, true); assert.match(tr.content, /sourceQuote/); return say('Tell me where this was shot first.'); },
  ]);
  const s = await build({ callModel: m.callModel });
  const r = await s.call('strategy-chat-send', { text: 'write a story for p1' });
  assert.deepEqual(r.proposals, []);
  assert.equal(r.droppedProposals, undefined);
  assert.deepEqual(s.itemCalls, []);
});

test('item-story with the owner\'s own words -> proposal; confirm sends {id, story} to update-item-facets', async () => {
  const m = scripted([
    useTool('propose_item_story', { itemId: 'p1', story: 'Shot at dawn on the pier.', sourceQuote: 'shot it at dawn on the pier', summary: 'Story for p1', rationale: 'Owner stated it.', evidence: [] }),
    say('Proposal is up.'),
  ]);
  const s = await build({ callModel: m.callModel });
  const r = await s.call('strategy-chat-send', { text: 'I shot it at dawn on the pier, write the story for p1' });
  assert.equal(r.proposals.length, 1, JSON.stringify(r));
  assert.deepEqual(r.proposals[0].payload, { id: 'p1', story: 'Shot at dawn on the pier.', sourceQuote: 'shot it at dawn on the pier' });
  const d = await s.call('strategy-proposal-decide', { threadId: r.threadId, proposalId: r.proposals[0].id, decision: 'confirm' });
  assert.equal(d.proposal.status, 'confirmed');
  assert.deepEqual(s.itemCalls, [{ id: 'p1', story: 'Shot at dawn on the pier.' }]);
});

// ---- benchmarks-change: either field alone ------------------------------------------------------------
test('benchmarks-change with only benchmarkHandles / only ownHandle validates and saves just those fields', async () => {
  const saved = [];
  const m = scripted([
    useTool('propose_benchmarks_change', { benchmarkHandles: ['@seb__design', 'other_acct'], summary: 'b', rationale: 'r', evidence: [] }),
    say('ok'),
    useTool('propose_benchmarks_change', { ownHandle: 'new_me', summary: 'o', rationale: 'r', evidence: [] }),
    say('ok'),
  ]);
  const s = await build({ callModel: m.callModel });
  // rebuild handlers with a saver spy over the same plan/chat stores
  const corpusStore = createMemoryCorpusStore({ loadCommitted: () => null });
  const h = createStrategyHandlers({
    corpusStore, planStore: s.planStore, chatStore: s.chatStore, clock: () => NOW, callModel: m.callModel, logUsage: async () => ({ costUsd: 0 }),
    refreshService: { requestRefresh: async () => ({}), getRequestStatus: async () => null },
    readXGrowthConfig: async () => null,
    saveXGrowthProfile: async (id, p) => { saved.push(p); return p; },
  });
  const call = (a, b) => h.handle(a, { clientId: 'c1', ...b }, CTX, AUTH);
  const r1 = await call('strategy-chat-send', { text: 'swap benchmarks' });
  assert.deepEqual(r1.proposals[0].payload, { benchmarkHandles: ['seb__design', 'other_acct'] });
  await call('strategy-proposal-decide', { threadId: r1.threadId, proposalId: r1.proposals[0].id, decision: 'confirm' });
  const r2 = await call('strategy-chat-send', { text: 'change my handle', threadId: r1.threadId });
  assert.deepEqual(r2.proposals[0].payload, { ownHandle: 'new_me' });
  await call('strategy-proposal-decide', { threadId: r1.threadId, proposalId: r2.proposals[0].id, decision: 'confirm' });
  assert.deepEqual(saved, [{ benchmarkHandles: ['seb__design', 'other_acct'] }, { ownHandle: 'new_me' }]);
});

// ---- stale plan-change -----------------------------------------------------------------------------------
test('plan-change goes stale after another apply -> failed with error "stale", plan not overwritten', async () => {
  const m = scripted([
    useTool('propose_plan_change', PLAN_PROPOSAL({ expectedVersion: 0, changes: { authoredPerDay: 5 } })),
    say('Proposal is up.'),
  ]);
  const s = await build({ callModel: m.callModel });
  const r = await s.call('strategy-chat-send', { text: 'go to 5 a day' });
  await s.call('strategy-plan-apply', { changes: { authoredPerDay: 2 }, expectedVersion: 0 }); // someone else applies
  const d = await s.call('strategy-proposal-decide', { threadId: r.threadId, proposalId: r.proposals[0].id, decision: 'confirm' });
  assert.equal(d.proposal.status, 'failed');
  assert.equal(d.proposal.result.error, 'stale');
  assert.equal((await s.planStore.get('c1')).plan.authoredPerDay, 2);
  assert.equal((await s.planStore.get('c1')).version, 1);
});

// ---- cap / transport / config ------------------------------------------------------------------------------
test('daily cap hit -> 429 and the model is NOT called', async () => {
  const m = scripted([say('one'), say('two')]);
  const s = await build({ callModel: m.callModel, cap: 1 });
  assert.equal((await s.call('strategy-chat-send', { text: 'a' })).ok, true);
  const r = await s.call('strategy-chat-send', { text: 'b' });
  assert.deepEqual([r.ok, r.status, r.code, r.used, r.cap], [false, 429, 'chat-cap', 1, 1]);
  assert.equal(m.requests.length, 1);
});

test('transport AgentError -> 502 and the reserved turn still counts', async () => {
  const s = await build({ callModel: async () => { throw new AgentError('Could not reach the model service: down', { code: 'transport' }); } });
  const r = await s.call('strategy-chat-send', { text: 'hi' });
  assert.equal(r.status, 502);
  assert.match(r.error, /Could not reach the model service/);
  assert.equal(r.turnsUsedToday, 1);
  assert.equal(await s.chatStore.usedToday('c1', NOW), 1);
});

test('no callModel and no ANTHROPIC_API_KEY -> 503 "no model configured", no turn spent', async () => {
  const s = await build({ env: {} });
  const r = await s.call('strategy-chat-send', { text: 'hi' });
  assert.equal(r.status, 503);
  assert.match(r.error, /no model configured/);
  assert.equal(await s.chatStore.usedToday('c1', NOW), 0);
});

test('with ANTHROPIC_API_KEY the default caller is built from env (stubbed fetch, no network), loop module lazy-loaded', async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: 'hello' }], stop_reason: 'end_turn', usage }) };
  };
  try {
    const logged = [];
    const s = await build({ env: { ANTHROPIC_API_KEY: 'sk-ant-test-key' }, logUsage: async (a) => { logged.push(a); return { costUsd: 0 }; } });
    const r = await s.call('strategy-chat-send', { text: 'hi' });
    assert.equal(r.ok, true);
    assert.equal(r.text, 'hello');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, 'https://api.anthropic.com/v1/messages');
    assert.equal(seen[0].headers['x-api-key'], 'sk-ant-test-key');
    assert.equal(seen[0].body.messages[0].role, 'user');
    assert.ok(seen[0].body.tools.length >= 5);
    assert.equal(logged[0].clientId, 'c1');
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---- history format -----------------------------------------------------------------------------------------------
test('history: prior turns reach the model as user/assistant messages; a folded summaryNote becomes a leading note', async () => {
  const m = scripted([say('a1'), say('a2')]);
  const s = await build({ callModel: m.callModel });
  const first = await s.call('strategy-chat-send', { text: 'q1' });
  await s.call('strategy-chat-send', { text: 'q2', threadId: first.threadId });
  const msgs = m.requests[1].messages;
  assert.deepEqual(msgs.map((x) => x.role), ['user', 'assistant', 'user']);
  assert.match(msgs[0].content, /q1/);
  assert.match(msgs[2].content, /q2/);

  // 31 turns overflow the 60-message window -> summaryNote
  const m2 = scripted([say('late')]);
  const s2 = await build({ callModel: m2.callModel });
  for (let i = 0; i < 31; i += 1) await s2.chatStore.appendTurn({ clientId: 'c1', threadId: 'tbig', userText: `old question ${i}`, assistantText: `ans ${i}`, now: NOW });
  assert.ok((await s2.chatStore.getThread('c1', 'tbig')).summaryNote);
  const r = await s2.call('strategy-chat-send', { text: 'new one', threadId: 'tbig' });
  assert.equal(r.ok, true);
  const first2 = m2.requests[0].messages[0];
  assert.equal(first2.role, 'user');
  assert.match(first2.content, /^\[Earlier conversation, summarized\] Q: old question 0/);
});

test('summarizeTodayRun: compact shape {id, slot, type, status, text}', () => {
  assert.deepEqual(summarizeTodayRun(null), { suggestions: [] });
  assert.deepEqual(summarizeTodayRun(RUN).suggestions, [
    { id: 'sg1', slot: 'A 09:00', type: 'original', status: 'edited', text: 'old text' },
    { id: 'sg2', slot: '14:00', type: 'quote', status: 'pending', text: 'drafted' },
  ]);
});

// ---- confirm safety: claim never lapses, no re-execution, no stuck claim, owner-only useModel -------------------
async function seedProposal(s, kind, payload, id = 'px1') {
  const proposal = { id, threadId: 't1', kind, payload, summary: 's', rationale: 'r', evidence: [], status: 'pending', createdAt: '2026-10-11T12:00:00.000Z' };
  await s.chatStore.appendTurn({ clientId: 'c1', threadId: 't1', userText: 'q', assistantText: 'a', proposals: [proposal], now: NOW });
  return proposal;
}
const decide = (s, decision = 'confirm', extra = {}) => s.call('strategy-proposal-decide', { threadId: 't1', proposalId: 'px1', decision, ...extra });

test('slow executor + second confirm -> 409, executor ran once; a late confirm (>60s) is still refused', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  let ran = 0;
  const s = await build({ runDailyAction: async () => { ran += 1; await gate; return { ok: true, run: { localDate: '2026-10-11' } }; } });
  await seedProposal(s, 'regenerate-today', { useModel: false });
  const first = decide(s);
  await new Promise((r) => setImmediate(r));
  const second = await decide(s);
  assert.equal(second.ok, false);
  assert.equal(second.status, 409);
  release();
  assert.equal((await first).proposal.status, 'confirmed');
  assert.equal(ran, 1);
  assert.equal((await decide(s)).status, 409);
  assert.equal(ran, 1);
});

test('claim is never reclaimed after >60s (fake clock): a deciding proposal stays refused', async () => {
  const s = await build({});
  await seedProposal(s, 'regenerate-today', { useModel: false });
  assert.equal((await s.chatStore.claimProposal({ clientId: 'c1', threadId: 't1', proposalId: 'px1', now: NOW })).claimed, true);
  const late = await s.chatStore.claimProposal({ clientId: 'c1', threadId: 't1', proposalId: 'px1', now: NOW + 10 * 60000 });
  assert.equal(late.claimed, false);
  const r = await decide(s);
  assert.equal(r.status, 409);
  assert.match(r.error, /being applied|interrupted/);
  assert.equal(s.dailyCalls.length, 0);
});

test('executor succeeded but save keeps failing -> 500 "do not retry", stays deciding, never re-executed', async () => {
  const s = await build({});
  await seedProposal(s, 'regenerate-today', { useModel: false });
  let saves = 0;
  const real = s.chatStore.saveProposal;
  s.chatStore.saveProposal = async () => { saves += 1; throw new Error('firestore down'); };
  const r = await decide(s);
  assert.equal(r.ok, false);
  assert.equal(r.status, 500);
  assert.match(r.error, /do not retry/);
  assert.equal(saves, 3, 'three save attempts');
  assert.equal(s.dailyCalls.length, 1);
  s.chatStore.saveProposal = real;
  assert.equal((await decide(s)).status, 409);
  assert.equal(s.dailyCalls.length, 1, 'no re-execution');
  assert.equal((await s.chatStore.getThread('c1', 't1')).proposals.px1.status, 'deciding');
});

test('a save that fails once is retried and the result is recorded', async () => {
  const s = await build({});
  await seedProposal(s, 'regenerate-today', { useModel: false });
  const real = s.chatStore.saveProposal;
  let n = 0;
  s.chatStore.saveProposal = async (a) => { n += 1; if (n === 1) throw new Error('blip'); return real(a); };
  const r = await decide(s);
  assert.equal(r.ok, true);
  assert.equal(r.proposal.status, 'confirmed');
  assert.equal(s.dailyCalls.length, 1);
});

test('decideProposal !ok after the claim releases it back to pending (no stuck state)', async () => {
  const s = await build({});
  // A stored status the contract does not know makes decideProposal answer 404 AFTER the claim has moved it to deciding.
  const p = await seedProposal(s, 'regenerate-today', { useModel: false });
  const store = s.chatStore;
  const realClaim = store.claimProposal;
  store.claimProposal = async (a) => { const c = await realClaim(a); return { ...c, proposal: { ...c.proposal, status: 'weird' } }; };
  const r = await decide(s);
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  store.claimProposal = realClaim;
  assert.equal((await store.getThread('c1', 't1')).proposals[p.id].status, 'pending');
  assert.equal(s.dailyCalls.length, 0);
});

test('regenerate-today useModel comes only from the owner decide option', async () => {
  const s = await build({});
  await seedProposal(s, 'regenerate-today', { useModel: true }); // a model-set payload flag
  const r1 = await decide(s);
  assert.equal(r1.proposal.status, 'confirmed');
  assert.equal(s.dailyCalls.at(-1)[1].draftWithModel, false, 'payload.useModel ignored');
  await seedProposal(s, 'regenerate-today', { useModel: false }, 'px2');
  await s.call('strategy-proposal-decide', { threadId: 't1', proposalId: 'px2', decision: 'confirm', options: { useModel: true } });
  assert.equal(s.dailyCalls.at(-1)[1].draftWithModel, true, 'owner option honored');
  await seedProposal(s, 'suggestion-dismiss', { suggestionId: 'sg1' }, 'px3');
  await s.call('strategy-proposal-decide', { threadId: 't1', proposalId: 'px3', decision: 'confirm', options: { useModel: true } });
  assert.deepEqual(s.dailyCalls.at(-1), ['daily-run-dismiss', { suggestionId: 'sg1' }], 'other kinds ignore options');
});

test('refresh-handles through the route: profile handles pass without a mention, strangers are a tool error', async () => {
  const m = scripted([
    useTool('propose_refresh_handles', { handles: ['bench_a'], summary: 'r', rationale: 'r', evidence: [] }, 'tu1'),
    (req) => { assert.equal(lastToolResult(req).is_error, undefined); return useTool('propose_refresh_handles', { handles: ['stranger_x'], summary: 'r', rationale: 'r', evidence: [] }, 'tu2'); },
    (req) => { assert.equal(lastToolResult(req).is_error, true); return say('done'); },
  ]);
  const s = await build({ callModel: m.callModel });
  const r = await s.call('strategy-chat-send', { text: 'refresh my benchmark' });
  assert.equal(r.proposals.length, 1);
  assert.deepEqual(r.proposals[0].payload, { handles: ['bench_a'] });
});
