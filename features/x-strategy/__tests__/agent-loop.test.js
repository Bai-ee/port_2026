import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentLoop, AgentError, STRATEGY_AGENT_MODEL } from '../agent/loop.js';
import { PROPOSAL_KINDS } from '../contracts.js';
import { defaultPlanDoc } from '../plan-state.js';

const tu = (id, name, input) => ({ type: 'tool_use', id, name, input });
const text = (t) => ({ type: 'text', text: t });
const resp = (content, stop = 'end_turn', u = { input_tokens: 100, output_tokens: 10 }) => ({ content, stop_reason: stop, usage: u });
const toolResp = (...uses) => resp(uses, 'tool_use');

function fakeModel(script) {
  const calls = [];
  const fn = async (args) => {
    calls.push(JSON.parse(JSON.stringify(args)));
    const next = typeof script === 'function' ? script(calls.length - 1, args) : script[calls.length - 1];
    if (next instanceof Error) throw next;
    return next ?? resp([text('done')]);
  };
  fn.calls = calls;
  return fn;
}

const EVAL = { own: { handle: 'me', rows: 212, range: { from: '2026-07-01', to: '2026-09-30' } }, caveats: [{ code: 'likes-only', message: 'likes-only lift' }] };
const planDoc = () => ({ ...defaultPlanDoc(), version: 3 });
const RUN = { suggestions: [{ id: 's1', slot: 'A', type: 'quote-react', status: 'pending', text: 'hi' }, { id: 's2', slot: 'B', type: 'original-text', status: 'pending', text: 'yo' }] };

function deps(over = {}) {
  return {
    getEvaluation: async () => EVAL,
    getPlan: async () => planDoc(),
    getTodayRun: async () => RUN,
    searchInventory: async () => Array.from({ length: 50 }, (_, i) => ({ id: `i${i}` })),
    topPosts: async () => ({ rows: Array.from({ length: 30 }, (_, i) => ({ id: `p${i}` })) }),
    ...over,
  };
}
const logs = [];
const logUsage = async (a) => { logs.push(a); return { costUsd: 0.01 }; };
const mk = (script, d = deps(), extra = {}) => {
  logs.length = 0;
  const callModel = fakeModel(script);
  return { callModel, agent: createAgentLoop({ callModel, toolDeps: d, logUsage, ...extra }) };
};
const turn = (agent, userText = 'hello', history = []) => agent.runTurn({ clientId: 'c1', threadId: 't1', history, userText });
const lastToolResults = (callModel) => callModel.calls.at(-1).messages.at(-1).content;

test('read tool round trip passes figures through to the model', async () => {
  const { agent, callModel } = mk([toolResp(tu('a', 'get_evaluation', {})), resp([text('You posted 212 rows.')])]);
  const r = await turn(agent, 'how am I doing');
  assert.equal(r.text, 'You posted 212 rows.');
  assert.equal(r.stopped, 'end');
  assert.equal(r.rounds, 1);
  const tr = lastToolResults(callModel)[0];
  assert.equal(tr.type, 'tool_result');
  assert.equal(tr.tool_use_id, 'a');
  assert.ok(tr.content.includes('"rows":212') && tr.content.includes('2026-09-30'));
  assert.equal(callModel.calls[0].model, STRATEGY_AGENT_MODEL);
  assert.ok(callModel.calls[0].tools.length >= 13);
});

test('search_inventory caps at 20 and top_posts at 10', async () => {
  const seen = {};
  const d = deps({
    searchInventory: async (a) => { seen.s = a; return Array.from({ length: 50 }, (_, i) => ({ id: i })); },
    topPosts: async (a) => { seen.t = a; return Array.from({ length: 30 }, (_, i) => ({ id: i })); },
  });
  const { agent, callModel } = mk([toolResp(tu('a', 'search_inventory', { query: 'x', limit: 99 }), tu('b', 'top_posts', { handle: '@seb__design', limit: 99 })), resp([text('ok')])], d);
  await turn(agent);
  assert.equal(seen.s.limit, 20);
  assert.equal(seen.t.limit, 10);
  assert.equal(seen.t.handle, 'seb__design');
  const [a, b] = lastToolResults(callModel);
  assert.equal(JSON.parse(b.content).length, 10);
});

test('proposal is collected with evidence and acknowledged', async () => {
  const ev = [{ source: '@me, 212 rows, Jul-Sep', figure: 'quote-react 0.4/day' }];
  const { agent, callModel } = mk([
    toolResp(tu('p', 'propose_plan_change', { changes: { authoredPerDay: 6 }, expectedVersion: 3, summary: 'Go to 6/day', rationale: 'Under cadence', evidence: ev })),
    resp([text('Proposed; confirm to apply.')]),
  ]);
  const r = await turn(agent, 'make it 6/day');
  assert.equal(r.proposals.length, 1);
  const p = r.proposals[0];
  assert.deepEqual(Object.keys(p).sort(), ['evidence', 'kind', 'payload', 'rationale', 'summary']);
  assert.ok(PROPOSAL_KINDS.includes(p.kind));
  assert.deepEqual(p.evidence, ev);
  assert.deepEqual(p.payload, { changes: { authoredPerDay: 6 }, expectedVersion: 3 });
  assert.match(lastToolResults(callModel)[0].content, /recorded/);
});

test('3rd proposal is rejected with a tool error', async () => {
  const base = { summary: 's', rationale: 'r', evidence: [] };
  const { agent, callModel } = mk([
    toolResp(
      tu('1', 'propose_suggestion_dismiss', { suggestionId: 's1', ...base }),
      tu('2', 'propose_suggestion_save_draft', { suggestionId: 's2', ...base }),
      tu('3', 'propose_regenerate_today', { ...base }),
    ),
    resp([text('ok')]),
  ]);
  const r = await turn(agent);
  assert.equal(r.proposals.length, 2);
  const res = lastToolResults(callModel);
  assert.equal(res[2].is_error, true);
  assert.match(res[2].content, /limit/i);
  assert.equal(res[0].is_error, undefined);
});

test('round cap forces a final text answer', async () => {
  const { agent, callModel } = mk(() => toolResp(tu(`x${Math.random()}`, 'get_plan', {})));
  const r = await turn(agent);
  assert.equal(r.stopped, 'round-cap');
  assert.equal(r.rounds, 4);
  assert.equal(callModel.calls.length, 5);
  assert.ok(r.text.length > 0);
  const finalMsg = callModel.calls.at(-1).messages.at(-1).content;
  assert.ok(finalMsg.some((b) => b.type === 'text' && /Tool limit/.test(b.text)));
});

test('round cap uses the final text when the model complies', async () => {
  const script = (i) => (i < 2 ? toolResp(tu(`t${i}`, 'get_plan', {})) : resp([text('wrapped up')]));
  const { agent } = mk(script, deps(), { maxRounds: 2 });
  const r = await turn(agent);
  assert.equal(r.stopped, 'round-cap');
  assert.equal(r.text, 'wrapped up');
});

test('bad tool args, unknown tool and failing deps become is_error and the loop continues', async () => {
  const d = deps({ getEvaluation: async () => { throw new Error('boom'); } });
  const { agent, callModel } = mk([
    toolResp(tu('a', 'nope', {}), tu('b', 'get_plan', '{not json'), tu('c', 'get_evaluation', {}), tu('d', 'search_inventory', {}), tu('e', 'propose_suggestion_edit', { summary: 's' })),
    resp([text('recovered')]),
  ], d);
  const r = await turn(agent);
  assert.equal(r.text, 'recovered');
  const res = lastToolResults(agent && callModel);
  assert.equal(res.length, 5);
  for (const x of res) assert.equal(x.is_error, true);
  assert.match(res[0].content, /Unknown tool/);
  assert.match(res[1].content, /JSON object/);
  assert.match(res[2].content, /boom/);
});

test('item-story without a matching sourceQuote is dropped; with one it is kept', async () => {
  const base = { itemId: 'it1', story: 'Built it in a weekend.', summary: 's', rationale: 'r', evidence: [] };
  const short = mk([toolResp(tu('a', 'propose_item_story', { ...base, sourceQuote: 'built it' })), resp([text('ok')])]);
  const rs = await turn(short.agent, 'I built it in a weekend, solo.');
  assert.equal(rs.proposals.length, 0, 'a quote under 20 chars is rejected even when it is a real substring');
  assert.match(lastToolResults(short.callModel)[0].content, /20 characters/);
  const { agent, callModel } = mk([
    toolResp(tu('a', 'propose_item_story', { ...base, sourceQuote: 'I built it over a long month' })),
    resp([text('asked for facts')]),
  ]);
  const r1 = await turn(agent, 'I built it in a weekend, solo.');
  assert.equal(r1.proposals.length, 0);
  assert.equal(lastToolResults(callModel)[0].is_error, true);
  assert.match(lastToolResults(callModel)[0].content, /sourceQuote/);

  const m2 = mk([
    toolResp(tu('a', 'propose_item_story', { ...base, sourceQuote: 'I  BUILT it in a weekend' })),
    resp([text('ok')]),
  ]);
  const r2 = await turn(m2.agent, 'ignored', [{ role: 'user', text: 'I built it in a weekend, solo.' }, { role: 'assistant', text: 'nice' }]);
  assert.equal(r2.proposals.length, 1);
  assert.equal(r2.proposals[0].kind, 'item-story');
  assert.equal(r2.proposals[0].payload.sourceQuote, 'I  BUILT it in a weekend', 'the quote stays on the proposal');

  const m3 = mk([toolResp(tu('a', 'propose_item_story', { ...base, sourceQuote: 'Built it in a weekend' })), resp([text('ok')])]);
  const r3 = await turn(m3.agent, 'x', [{ role: 'assistant', text: 'Did you build it in a weekend? Built it in a weekend?' }]);
  assert.equal(r3.proposals.length, 0, 'assistant words do not count as the owner stating facts');
});

test('plan-change with an invalid payload is rejected and validation errors are fed back', async () => {
  const base = { summary: 's', rationale: 'r', evidence: [] };
  const { agent, callModel } = mk([
    toolResp(
      tu('a', 'propose_plan_change', { changes: { authoredPerDay: 99 }, expectedVersion: 3, ...base }),
      tu('b', 'propose_plan_change', { changes: { tier: 2 }, expectedVersion: 3, ...base }),
      tu('c', 'propose_plan_change', { changes: { authoredPerDay: 6 }, expectedVersion: 1, ...base }),
      tu('d', 'propose_plan_change', { changes: { typeFloors: { reply: 2 } }, expectedVersion: 3, ...base }),
    ),
    resp([text('ok')]),
  ]);
  const r = await turn(agent);
  assert.equal(r.proposals.length, 0);
  const res = lastToolResults(callModel);
  assert.match(res[0].content, /authoredPerDay must be an integer/);
  assert.match(res[1].content, /tier/);
  assert.match(res[2].content, /version 3/);
  assert.match(res[3].content, /not a calendar slot type/);
  res.forEach((x) => assert.equal(x.is_error, true));
});

test('unknown suggestionId and invalid handles are tool errors', async () => {
  const base = { summary: 's', rationale: 'r', evidence: [] };
  const { agent, callModel } = mk([
    toolResp(
      tu('a', 'propose_suggestion_dismiss', { suggestionId: 'zzz', ...base }),
      tu('b', 'propose_refresh_handles', { handles: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], ...base }),
      tu('c', 'propose_benchmarks_change', { benchmarkHandles: ['a', 'b', 'c', 'd', 'e', 'f'], ...base }),
      tu('d', 'propose_benchmarks_change', { ownHandle: 'bad handle!', ...base }),
    ),
    resp([text('ok')]),
  ]);
  const r = await turn(agent);
  assert.equal(r.proposals.length, 0);
  const res = lastToolResults(callModel);
  assert.match(res[0].content, /unknown suggestionId/);
  res.forEach((x) => assert.equal(x.is_error, true));
});

test('valid kinds produce normalized payloads', async () => {
  const base = { summary: 's', rationale: 'r', evidence: [{ source: 'a', figure: 'b' }, { bad: 1 }] };
  const { agent } = mk([
    toolResp(tu('a', 'propose_refresh_handles', { handles: ['@Seb__design', 'seb__design', 'me'], ...base }), tu('b', 'propose_regenerate_today', { ...base })),
    resp([text('ok')]),
  ]);
  const r = await turn(agent, 'please refresh @Seb__design and me');
  assert.deepEqual(r.proposals[0].payload, { handles: ['Seb__design', 'me'] });
  assert.deepEqual(r.proposals[0].evidence, [{ source: 'a', figure: 'b' }]);
  assert.deepEqual(r.proposals[1].payload, { useModel: false });
  // the model cannot switch model drafting on
  const m2 = mk([toolResp(tu('a', 'propose_regenerate_today', { ...base, useModel: true })), resp([text('ok')])]);
  assert.deepEqual((await turn(m2.agent)).proposals[0].payload, { useModel: false });
});

test('usage is summed and logUsage is called once per model call', async () => {
  const { agent } = mk([
    toolResp(tu('a', 'get_plan', {})),
    resp([text('x')], 'end_turn', { input_tokens: 50, output_tokens: 7 }),
  ]);
  const r = await turn(agent);
  assert.equal(r.usage.calls, 2);
  assert.equal(r.usage.inputTokens, 150);
  assert.equal(r.usage.outputTokens, 17);
  assert.equal(r.usage.costUsd, 0.02);
  assert.equal(logs.length, 2);
  assert.deepEqual(logs[0], { model: STRATEGY_AGENT_MODEL, usage: { input_tokens: 100, output_tokens: 10 }, clientId: 'c1', purpose: 'x-strategy-chat', threadId: 't1' });
});

test('a failing logUsage does not break the turn', async () => {
  const callModel = fakeModel([resp([text('fine')])]);
  const agent = createAgentLoop({ callModel, toolDeps: deps(), logUsage: async () => { throw new Error('db down'); } });
  const r = await turn(agent);
  assert.equal(r.text, 'fine');
  assert.equal(r.usage.costUsd, 0);
});

test('model error throws AgentError; earlier completed calls were still logged', async () => {
  const { agent } = mk([toolResp(tu('a', 'get_plan', {})), new Error('socket hang up sk-ant-secret123')]);
  await assert.rejects(turn(agent), (err) => {
    assert.ok(err instanceof AgentError);
    assert.equal(err.code, 'model-error');
    assert.equal(err.usage.calls, 1);
    assert.ok(!/sk-ant-secret123/.test(err.message));
    return true;
  });
  assert.equal(logs.length, 1);
});

test('AgentError from the transport passes through unchanged', async () => {
  const e = new AgentError('rate limited', { code: 'rate-limited', status: 429 });
  const { agent } = mk([e]);
  await assert.rejects(turn(agent), (err) => err === e && err.usage.calls === 0);
});

test('history becomes messages: note folded, roles merged, starts with user', async () => {
  const { agent, callModel } = mk([resp([text('ok')])]);
  await turn(agent, 'now', [{ role: 'assistant', text: 'orphan' }, { role: 'note', text: 'summary' }, { role: 'user', text: 'q1' }, { role: 'assistant', text: 'a1' }]);
  const msgs = callModel.calls[0].messages;
  assert.equal(msgs[0].role, 'user');
  assert.match(msgs[0].content, /summary/);
  assert.deepEqual(msgs.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.equal(msgs.at(-1).content, 'now');
});

test('refresh-handles: only profile handles or handles the owner named (case-insensitive, with or without @)', async () => {
  const base = { summary: 's', rationale: 'r', evidence: [] };
  const withProfile = deps({ getProfileHandles: async () => ['Me_Acct', 'bench_a'] });
  const ok = mk([toolResp(tu('a', 'propose_refresh_handles', { handles: ['me_acct', '@BENCH_A'], ...base })), resp([text('ok')])], withProfile);
  assert.equal((await turn(ok.agent, 'refresh please')).proposals.length, 1, 'profile handles need no mention');

  const bad = mk([toolResp(tu('a', 'propose_refresh_handles', { handles: ['stranger_x'], ...base })), resp([text('ok')])], withProfile);
  const r = await turn(bad.agent, 'refresh please');
  assert.equal(r.proposals.length, 0);
  assert.equal(lastToolResults(bad.callModel)[0].is_error, true);
  assert.match(lastToolResults(bad.callModel)[0].content, /stranger_x/);

  const named = mk([toolResp(tu('a', 'propose_refresh_handles', { handles: ['stranger_x'], ...base })), resp([text('ok')])], withProfile);
  assert.equal((await turn(named.agent, 'also pull @Stranger_X')).proposals.length, 1);

  const sub = mk([toolResp(tu('a', 'propose_refresh_handles', { handles: ['str'], ...base })), resp([text('ok')])], withProfile);
  assert.equal((await turn(sub.agent, 'pull stranger_x')).proposals.length, 0, 'a substring of a longer word is not a mention');
});
