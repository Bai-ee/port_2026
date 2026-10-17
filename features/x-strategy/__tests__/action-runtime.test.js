import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createActionRuntime, invokeAction, normalizeActionPayload, normalizeAutonomy, resolveGate, requiredTypedText,
  validateActionArgs, runActionTool, ACTION_TOOL_NAMES,
} from '../agent/action-runtime.js';
import { createMemoryActionStores } from '../agent/action-stores.js';
import { validateProposal, decideProposal, buildExecutors } from '../agent/proposals.js';
import { createAgentLoop } from '../agent/loop.js';
import { createStrategyHandlers } from '../route-handlers.js';
import { createMemoryChatStore } from '../agent/chat-store.js';
import { createMemoryPlanStore } from '../plan-store.js';
import { createMemoryCorpusStore } from '../corpus-store.js';
import { createRefreshService, createMemoryRefreshQueue } from '../refresh.js';

const CLIENT = 'c1';
const CTX = { clientId: CLIENT, authorization: 'Bearer owner', impersonating: false, by: 'owner@x.com' };
const props = (o, req = []) => ({ type: 'object', properties: o, required: req });
const ENTRIES = [
  { id: 'q.list', group: 'queue', title: 'List posts', description: 'read', route: 'r', method: 'POST', action: 'list', args: props({}), tier: 0 },
  { id: 'q.update', group: 'queue', title: 'Edit a post', description: 'edit', route: 'r', method: 'POST', action: 'update', args: props({ postId: { type: 'string' }, content: { type: 'string' } }, ['postId']), tier: 1, snapshot: [{ collection: 'social_posts', idArg: 'postId' }] },
  { id: 'q.cfg', group: 'queue', title: 'Save config', description: 'cfg', route: 'r', method: 'POST', action: 'cfg', args: props({ v: { type: 'integer' } }, ['v']), tier: 1, snapshot: [{ path: 'dashboard_state/{clientId}', field: 'marketingBrief.x' }] },
  { id: 'q.nosnap', group: 'queue', title: 'No snapshot', description: 'x', route: 'r', method: 'POST', action: 'ns', args: props({}), tier: 1 },
  { id: 'q.reject', group: 'queue', title: 'Reject a draft', description: 'del', route: 'r', method: 'POST', action: 'reject', args: props({ postId: { type: 'string' } }, ['postId']), tier: 2, snapshot: [{ collection: 'social_posts', idArg: 'postId' }] },
  { id: 'q.schedule', group: 'queue', title: 'Schedule', description: 'x pub', route: 'r', method: 'POST', action: 'sched', args: props({ postId: { type: 'string' } }, ['postId']), tier: 3, external: 'x', cost: '1 write' },
  { id: 'm.sync', group: 'xmonitor', title: 'Sync', description: 'paid', route: 'r', method: 'POST', action: 'sync', args: props({}), tier: 3, external: 'paid', cost: '3 calls', irreversible: true },
  { id: 'q.native', group: 'queue', title: 'Native undo', description: 'n', route: 'r', method: 'POST', action: 'nat', args: props({ n: { type: 'integer' } }, ['n']), tier: 1, undo: { actionId: 'q.native.revert', argsFrom: { n: 'args.n', was: 'result.was' } } },
  { id: 'q.native.revert', group: 'queue', title: 'Revert native', description: 'r', route: 'r', method: 'POST', action: 'natrev', args: props({ n: { type: 'integer' }, was: { type: 'integer' } }), tier: 1 },
];
const registry = {
  ACTIONS: ENTRIES,
  getAction: (id) => ENTRIES.find((e) => e.id === id) ?? null,
  findActions: (q) => ENTRIES.filter((e) => `${e.id} ${e.title}`.toLowerCase().includes(String(q).toLowerCase().split(' ')[0])).map((e) => ({ id: e.id, title: e.title, tier: e.tier, group: e.group })),
};

function setup({ autonomy, files = {} } = {}) {
  const stores = createMemoryActionStores();
  for (const [k, v] of Object.entries(files)) stores.files.set(k, v);
  if (autonomy) stores.autonomy.save(CLIENT, autonomy);
  const calls = [];
  const invoke = async (entry, args, ctx) => {
    calls.push({ id: entry.id, args, ctx });
    if (args.__fail) return { ok: false, status: 500, json: { error: 'boom' } };
    if (entry.id === 'q.update') stores.files.set(`social_posts/${args.postId}`, { ...stores.files.get(`social_posts/${args.postId}`), content: args.content });
    if (entry.id === 'q.reject') stores.files.set(`social_posts/${args.postId}`, { ...stores.files.get(`social_posts/${args.postId}`), status: 'rejected' });
    if (entry.id === 'q.cfg') { const d = stores.files.get(`dashboard_state/${CLIENT}`) ?? {}; stores.files.set(`dashboard_state/${CLIENT}`, { ...d, marketingBrief: { ...(d.marketingBrief || {}), x: args.v } }); }
    return { ok: true, status: 200, json: { ok: true, was: 7, rows: [1, 2] } };
  };
  let n = 0; let t = 1000;
  const rt = createActionRuntime({ ...stores, invoke, registry, clock: () => (t += 1000), idGen: () => `u${++n}` });
  return { rt, stores, calls };
}
const post = (over = {}) => ({ clientId: CLIENT, content: 'old', status: 'draft', ...over });

test('gates: tier resolution, X floor can never drop below typed', () => {
  const e = (id) => registry.getAction(id);
  assert.equal(resolveGate(e('q.list'), {}), 'run');
  assert.equal(resolveGate(e('q.update'), {}), 'run');
  assert.equal(resolveGate(e('q.update'), { tier1: 'confirm' }), 'confirm');
  assert.equal(resolveGate(e('q.update'), {}, { itemCount: 11 }), 'confirm', 'big tier-1 batch asks even on auto');
  assert.equal(resolveGate(e('q.reject'), { tier2: 'auto' }), 'confirm');
  assert.equal(resolveGate(e('m.sync'), {}), 'confirm');
  assert.equal(resolveGate(e('m.sync'), { tier3: 'typed' }), 'typed');
  assert.equal(resolveGate(e('q.schedule'), { tier3: 'confirm' }), 'typed');
  assert.deepEqual(normalizeAutonomy({ tier1: 'x', tier2: 'auto', tier3: 'auto' }), { tier1: 'auto', tier2: 'confirm', tier3: 'confirm' });
});

test('args: schema checks, reserved keys refused', () => {
  const e = registry.getAction('q.update');
  assert.equal(validateActionArgs(e, { postId: 'p1' }).ok, true);
  assert.match(validateActionArgs(e, {}).errors[0], /postId is required/);
  assert.match(validateActionArgs(e, { postId: 'p', clientId: 'other' }).errors.join(), /clientId is set by the system/);
  assert.match(validateActionArgs(e, { postId: 'p', nope: 1 }).errors.join(), /unknown argument/);
  assert.match(validateActionArgs(e, { postId: 5 }).errors.join(), /must be string/);
});

test('tier 0 runs and returns data; unknown action and bad args are errors', async () => {
  const { rt, calls } = setup();
  const out = await rt.run(CTX, { actionId: 'q.list' });
  assert.equal(out.kind, 'result');
  assert.deepEqual(out.result.data.rows, [1, 2]);
  assert.equal(calls[0].ctx.authorization, 'Bearer owner');
  assert.equal((await rt.run(CTX, { actionId: 'nope' })).kind, 'error');
  assert.equal((await rt.run(CTX, { actionId: 'q.update', args: {} })).kind, 'error');
  assert.equal(calls.length, 1);
});

test('tier 1 auto: snapshot, run, audit row, undoId; undo restores; second undo refused', async () => {
  const { rt, stores } = setup({ files: { 'social_posts/p1': post() } });
  const out = await rt.run(CTX, { actionId: 'q.update', args: { postId: 'p1', content: 'new' } });
  assert.equal(out.kind, 'result');
  assert.equal(out.result.status, 'ok');
  assert.ok(out.result.undoId);
  assert.equal(stores.files.get('social_posts/p1').content, 'new');
  const row = await stores.audit.get(CLIENT, out.result.undoId);
  assert.equal(row.actionId, 'q.update');
  assert.equal(row.by, 'owner@x.com');
  assert.equal(row.items[0].snapshots[0].before.content, 'old');
  const u = await rt.undo(CTX, out.result.undoId);
  assert.equal(u.ok, true);
  assert.equal(stores.files.get('social_posts/p1').content, 'old');
  assert.equal((await stores.audit.get(CLIENT, out.result.undoId)).undoneAt.length > 0, true);
  assert.match((await rt.undo(CTX, out.result.undoId)).error, /Already undone/);
});

test('undo refuses when the doc changed after the action (nothing restored)', async () => {
  const { rt, stores } = setup({ files: { 'social_posts/p1': post() } });
  const out = await rt.run(CTX, { actionId: 'q.update', args: { postId: 'p1', content: 'new' } });
  stores.files.set('social_posts/p1', post({ content: 'owner edited later' }));
  const u = await rt.undo(CTX, out.result.undoId);
  assert.equal(u.ok, false);
  assert.match(u.error, /changed since/);
  assert.equal(stores.files.get('social_posts/p1').content, 'owner edited later');
});

test('undo of a created doc removes it; field snapshots restore only that field', async () => {
  const { rt, stores } = setup({ files: { 'dashboard_state/c1': { keep: 1, marketingBrief: { x: 1, other: 2 } } } });
  const out = await rt.run(CTX, { actionId: 'q.cfg', args: { v: 9 } });
  assert.equal(stores.files.get('dashboard_state/c1').marketingBrief.x, 9);
  assert.equal((await rt.undo(CTX, out.result.undoId)).ok, true);
  assert.deepEqual(stores.files.get('dashboard_state/c1'), { keep: 1, marketingBrief: { x: 1, other: 2 } });
});

test('a snapshot of another client\'s doc is not kept: no undo, action still audited', async () => {
  const { rt } = setup({ files: { 'social_posts/p9': post({ clientId: 'someone-else' }) } });
  const out = await rt.run(CTX, { actionId: 'q.update', args: { postId: 'p9', content: 'x' } });
  assert.equal(out.result.undoId, undefined);
  assert.equal(out.result.undoNote, 'not undoable');
});

test('native undo runs the revert action with mapped args', async () => {
  const { rt, calls, stores } = setup();
  const out = await rt.run(CTX, { actionId: 'q.native', args: { n: 4 } });
  assert.ok(out.result.undoId);
  const u = await rt.undo(CTX, out.result.undoId);
  assert.equal(u.ok, true);
  const rev = calls.find((c) => c.id === 'q.native.revert');
  assert.deepEqual(rev.args, { n: 4, was: 7 });
  assert.ok((await stores.audit.get(CLIENT, out.result.undoId)).undoneAt);
});

test('failed route call: audited as failed, no undoId, no snapshot claim', async () => {
  const { rt, stores } = setup({ files: { 'social_posts/p1': post() } });
  const out = await rt.run(CTX, { actionId: 'q.update', args: { postId: 'p1', __fail: true } }).catch((e) => e);
  // __fail is not in the schema, so it is refused before anything runs
  assert.equal(out.kind, 'error');
  const bad = await rt.run(CTX, { actionId: 'q.nosnap', args: {} });
  assert.equal(bad.result.status, 'ok');
  assert.equal(bad.result.undoId, undefined, 'no snapshot + no native undo => not undoable');
  assert.equal((await stores.audit.recent(CLIENT, 5)).length, 1);
});

test('tier 1 with autonomy confirm, tier 2 and tier 3 produce cards and run nothing', async () => {
  const { rt, calls } = setup({ autonomy: { tier1: 'confirm' } });
  const t1 = await rt.run(CTX, { actionId: 'q.update', args: { postId: 'p1' } });
  assert.equal(t1.kind, 'proposal');
  assert.equal(t1.proposal.kind, 'action');
  assert.equal(t1.proposal.payload.typed, false);
  const t2 = await rt.run(CTX, { actionId: 'q.reject', args: { postId: 'p1' } });
  assert.equal(t2.proposal.payload.tier, 2);
  assert.match(t2.proposal.payload.warning, /changes or removes 1 item/);
  const t3 = await rt.run(CTX, { actionId: 'm.sync' });
  assert.equal(t3.proposal.payload.typed, false);
  assert.equal(t3.proposal.payload.irreversible, true);
  assert.equal(t3.proposal.payload.confirmText, 'spend 1');
  assert.match(t3.proposal.payload.warning, /Cost: 3 calls.*can't be undone/);
  const x = await rt.run(CTX, { actionId: 'q.schedule', args: { postId: 'p1' } });
  assert.equal(x.proposal.payload.typed, true);
  assert.equal(x.proposal.payload.confirmText, 'post 1');
  assert.equal(calls.length, 0, 'nothing ran');
  assert.match(x.result.note, /Nothing has run/);
});

test('autonomy tier3=typed makes non-X spend typed; X stays typed with tier3=confirm', async () => {
  const typed = setup({ autonomy: { tier3: 'typed' } });
  assert.equal((await typed.rt.run(CTX, { actionId: 'm.sync' })).proposal.payload.typed, true);
  const loose = setup({ autonomy: { tier3: 'confirm' } });
  assert.equal((await loose.rt.run(CTX, { actionId: 'q.schedule', args: { postId: 'p' } })).proposal.payload.typed, true);
  const saved = await loose.rt.saveAutonomy(CLIENT, { tier1: 'confirm', tier3: 'bogus' });
  assert.deepEqual(saved, { tier1: 'confirm', tier2: 'confirm', tier3: 'confirm' });
});

test('bulk: items => one card with count; >50 refused; tier-1 batch runs as ONE audit row with one undo', async () => {
  const { rt, stores } = setup({ files: { 'social_posts/a': post(), 'social_posts/b': post() } });
  const card = await rt.run(CTX, { actionId: 'q.reject', items: [{ postId: 'a' }, { postId: 'b' }, { postId: 'c' }] });
  assert.equal(card.proposal.payload.affected, 3);
  assert.equal(card.proposal.payload.items.length, 3);
  assert.equal((await rt.run(CTX, { actionId: 'q.reject', items: Array.from({ length: 51 }, () => ({ postId: 'a' })) })).kind, 'error');
  const batch = await rt.run(CTX, { actionId: 'q.update', items: [{ postId: 'a', content: 'A' }, { postId: 'b', content: 'B' }] });
  assert.equal(batch.result.of, 2);
  assert.equal((await stores.audit.recent(CLIENT, 10)).length, 1);
  assert.equal((await rt.undo(CTX, batch.result.undoId)).ok, true);
  assert.equal(stores.files.get('social_posts/a').content, 'old');
  assert.equal(stores.files.get('social_posts/b').content, 'old');
  const big = await rt.run(CTX, { actionId: 'q.update', items: Array.from({ length: 11 }, (_, i) => ({ postId: `p${i}` })) });
  assert.equal(big.kind, 'proposal', 'a tier-1 batch over the auto limit asks first');
});

test('validateProposal(action): rebuilds payload from the registry; X typed cannot be dropped; tier 0 refused', () => {
  const v = (payload) => validateProposal({ kind: 'action', payload }, { registry });
  const ok = v({ actionId: 'q.schedule', items: [{ postId: 'p' }], typed: false, confirmText: 'whatever', warning: 'nothing to see' });
  assert.equal(ok.ok, true);
  assert.equal(ok.proposal.payload.typed, true);
  assert.equal(ok.proposal.payload.confirmText, 'post 1');
  assert.match(ok.proposal.payload.warning, /live X account/);
  assert.equal(v({ actionId: 'q.list' }).ok, false);
  assert.equal(v({ actionId: 'ghost' }).ok, false);
  assert.equal(v({ actionId: 'q.reject', items: [{}] }).ok, false);
  assert.equal(requiredTypedText(ok.proposal.payload, { registry }), 'post 1');
  assert.equal(requiredTypedText(v({ actionId: 'q.reject', items: [{ postId: 'a' }] }).proposal.payload, { registry }), null);
});

function decide(rt, payload, typed) {
  const executors = buildExecutors({ runAction: ({ clientId, payload: p, by, proposalId }) => rt.executeApproved({ ...CTX, clientId, by }, p, { proposalId }) });
  const proposal = { id: 'pr1', kind: 'action', status: 'pending', payload };
  return decideProposal({ proposal, decision: 'confirm', executors, clientId: CLIENT, by: 'owner@x.com', options: { typed } });
}

test('decide: typed mismatch rejected (nothing runs); exact text runs once; non-typed needs none', async () => {
  const { rt, calls } = setup();
  const card = (await rt.run(CTX, { actionId: 'q.schedule', items: [{ postId: 'a' }, { postId: 'b' }, { postId: 'c' }] })).proposal.payload;
  assert.equal(card.confirmText, 'post 3');
  for (const bad of [undefined, '', 'post 1', 'yes', 'post 33']) {
    const r = await decide(rt, card, bad);
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
    assert.equal(r.code, 'typed-mismatch');
  }
  assert.equal(calls.length, 0);
  const good = await decide(rt, card, '  Post   3 ');
  assert.equal(good.ok, true);
  assert.equal(good.proposal.status, 'confirmed');
  assert.equal(calls.length, 3);
  assert.match(good.proposal.result.message, /Schedule: done/);
  const del = (await rt.run(CTX, { actionId: 'q.reject', args: { postId: 'a' } })).proposal.payload;
  assert.equal((await decide(rt, del, undefined)).proposal.status, 'confirmed');
});

test('decide: a failing action marks the proposal failed with an error message and writes a failed audit row', async () => {
  const stores = createMemoryActionStores();
  const rt = createActionRuntime({ ...stores, registry, invoke: async () => ({ ok: false, status: 500, json: { error: 'boom' } }) });
  const card = (await rt.run(CTX, { actionId: 'm.sync' })).proposal.payload;
  const r = await decide(rt, card, undefined);
  assert.equal(r.proposal.status, 'failed');
  assert.ok(r.proposal.error);
  const [row] = await stores.audit.recent(CLIENT, 5);
  assert.equal(row.status, 'failed');
  assert.equal(row.undoable, false);
});

test('executor re-validates: a tampered payload is refused', async () => {
  const { rt, calls } = setup();
  const r = await decide(rt, { actionId: 'q.reject', items: [{ postId: 'a', clientId: 'victim' }] }, undefined);
  assert.equal(r.proposal.status, 'failed');
  assert.equal(calls.length, 0);
});

test('find + log + tools: find_actions summarizes args; get_action_log lists; absent runtime is not available', async () => {
  const { rt } = setup({ files: { 'social_posts/p1': post() } });
  const deps = { actions: { runtime: rt, ctx: CTX } };
  const f = await runActionTool('find_actions', { query: 'edit' }, deps);
  assert.deepEqual(f.result.actions[0].args, { postId: 'string*', content: 'string' });
  const run = await runActionTool('run_action', { actionId: 'q.update', args: { postId: 'p1', content: 'z' } }, deps);
  assert.ok(run.result.undoId);
  const log = await runActionTool('get_action_log', {}, deps);
  assert.equal(log.result.actions[0].undoable, true);
  assert.equal(log.result.actions[0].undoId, run.result.undoId);
  assert.equal(log.result.actions[0].title, 'Edit a post');
  const un = await runActionTool('undo_action', { undoId: run.result.undoId }, deps);
  assert.equal(un.result.ok, true);
  assert.equal((await runActionTool('run_action', { actionId: 'q.list' }, {})).isError, true);
  assert.deepEqual([...ACTION_TOOL_NAMES], ['find_actions', 'run_action', 'undo_action', 'get_action_log']);
});

test('invokeAction: builds an authorized in-process Request (body, as=, GET query); refuses without authorization', async () => {
  const seen = [];
  const routeModules = { r: async () => ({ POST: async (req) => { seen.push([req.method, req.url, req.headers.get('authorization'), await req.json()]); return Response.json({ ok: true }); }, GET: async (req) => { seen.push([req.method, req.url]); return Response.json({ rows: [] }); } }) };
  const entry = { id: 'x', route: 'r', method: 'POST', action: 'update', query: { v: '2' } };
  const out = await invokeAction(entry, { postId: 'p', clientId: 'evil' }, { ...CTX, impersonating: true }, { routeModules });
  assert.equal(out.ok, true);
  assert.equal(seen[0][2], 'Bearer owner');
  assert.match(seen[0][1], /\?v=2&as=c1$/);
  assert.deepEqual(seen[0][3], { postId: 'p', action: 'update', clientId: 'c1' }, 'clientId always the server-resolved one');
  await invokeAction({ id: 'g', route: 'r', method: 'GET', action: 'list' }, { q: 'a' }, CTX, { routeModules });
  assert.match(seen[1][1], /\?q=a&action=list$/);
  await assert.rejects(invokeAction(entry, {}, { clientId: 'c1' }, { routeModules }), /no authorization/);
  const failing = { r: async () => ({ POST: async () => Response.json({ error: 'nope' }, { status: 403 }) }) };
  assert.equal((await invokeAction(entry, {}, CTX, { routeModules: failing })).ok, false);
});

test('loop: run_action card counts as bulk, tier-1 undoIds are reported in toolResults', async () => {
  const { rt } = setup({ files: { 'social_posts/p1': post() } });
  const script = [
    { content: [{ type: 'tool_use', id: 't1', name: 'run_action', input: { actionId: 'q.update', args: { postId: 'p1', content: 'n' } } }, { type: 'tool_use', id: 't2', name: 'run_action', input: { actionId: 'q.schedule', args: { postId: 'p1' } } }], stop_reason: 'tool_use', usage: {} },
    { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: {} },
  ];
  let i = 0;
  const loop = createAgentLoop({ callModel: async () => script[i++], toolDeps: { actions: { runtime: rt, ctx: CTX } }, logUsage: async () => ({ costUsd: 0 }) });
  const r = await loop.runTurn({ clientId: CLIENT, userText: 'do it' });
  assert.equal(r.proposals.length, 1);
  assert.equal(r.proposals[0].kind, 'action');
  assert.equal(r.toolResults.length, 2);
  assert.ok(r.toolResults[0].undoId);
});

// ---- route level ----
const NOW = Date.parse('2026-10-11T12:00:00Z');
function handlers(extra = {}) {
  const stores = createMemoryActionStores();
  const actionRuntime = createActionRuntime({ ...stores, registry, invoke: async () => ({ ok: true, status: 200, json: { ok: true } }) });
  const chatStore = createMemoryChatStore({ cap: 60 });
  const corpusStore = createMemoryCorpusStore({ loadCommitted: () => null });
  const planStore = createMemoryPlanStore();
  const refreshService = createRefreshService({ store: corpusStore, queueStore: createMemoryRefreshQueue(), now: () => NOW, enabled: false, detectBird: async () => ({ available: false }), idGen: () => 'r', ingest: async () => ({ rows: [], pull: {} }), runBirdFor: () => () => '' });
  const toolsSeen = [];
  const agentLoopFactory = ({ toolDeps }) => ({ runTurn: async () => { toolsSeen.push(toolDeps); return { text: 'hi', proposals: [], toolResults: [{ tool: 'run_action', undoId: 'u9' }], usage: null, rounds: 1, stopped: 'end' }; } });
  const h = createStrategyHandlers({ corpusStore, planStore, refreshService, clock: () => NOW, readXGrowthConfig: async () => ({ ownHandle: 'me', benchmarkHandles: [] }), chatStore, agentLoopFactory, actionRuntime, ...extra });
  const AUTH = { decoded: { email: 'owner@x.com' }, authorization: 'Bearer owner', impersonating: false };
  const call = (a, b) => h.handle(a, { clientId: CLIENT, ...b }, { clientId: CLIENT }, AUTH);
  return { h, call, stores, toolsSeen, chatStore };
}

test('route: autonomy get/save (X floor stays), log, undo, 503 without a runtime', async () => {
  const s = handlers();
  assert.deepEqual((await s.call('strategy-autonomy-get', {})).autonomy, { tier1: 'auto', tier2: 'confirm', tier3: 'confirm' });
  const saved = await s.call('strategy-autonomy-save', { autonomy: { tier1: 'confirm', tier2: 'auto', tier3: 'typed' } });
  assert.deepEqual(saved.autonomy, { tier1: 'confirm', tier2: 'confirm', tier3: 'typed' });
  assert.equal((await s.call('strategy-autonomy-save', { tier3: 'auto' })).status, 400);
  await s.stores.audit.append(CLIENT, 'u1', { at: '2026-10-11T00:00:00Z', by: 'o', actionId: 'q.update', tier: 1, status: 'ok', undoable: false, items: [{}] });
  const log = await s.call('strategy-action-log', {});
  assert.equal(log.log[0].undoId, 'u1');
  assert.equal(log.log[0].title, 'Edit a post');
  assert.equal((await s.call('strategy-action-undo', {})).status, 400);
  const un = await s.call('strategy-action-undo', { undoId: 'u1' });
  assert.equal(un.status, 409);
  const bare = createStrategyHandlers({ corpusStore: {}, planStore: {}, refreshService: {}, readXGrowthConfig: async () => null });
  assert.equal((await bare.handle('strategy-action-log', { clientId: CLIENT }, { clientId: CLIENT }, {})).status, 503);
});

test('route: chat-send forwards the owner authorization to the tools, persists undoIds, returns toolResults', async () => {
  const s = handlers();
  const r = await s.call('strategy-chat-send', { text: 'hello' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.undoIds, ['u9']);
  assert.deepEqual(r.toolResults, [{ tool: 'run_action', undoId: 'u9' }]);
  assert.equal(s.toolsSeen[0].actions.ctx.authorization, 'Bearer owner');
  assert.equal(s.toolsSeen[0].actions.ctx.clientId, CLIENT);
  const hist = await s.call('strategy-chat-history', { threadId: r.threadId });
  assert.deepEqual(hist.thread.messages.at(-1).undoIds, ['u9']);
});

test('route: decide enforces typed confirm for an X action, then runs it', async () => {
  const s = handlers();
  const payload = normalizeActionPayload({ actionId: 'q.schedule', items: [{ postId: 'a' }] }, { registry }).payload;
  const thread = await s.chatStore.appendTurn({ clientId: CLIENT, threadId: 't_1', userText: 'u', assistantText: 'a', proposals: [{ id: 'pr1', threadId: 't_1', kind: 'action', payload, summary: 's', rationale: '', evidence: [], status: 'pending', createdAt: new Date(NOW).toISOString() }], now: NOW });
  assert.equal(thread.proposals.pr1.status, 'pending');
  const miss = await s.call('strategy-proposal-decide', { threadId: 't_1', proposalId: 'pr1', decision: 'confirm', typed: 'post 2' });
  assert.equal(miss.ok, false);
  assert.equal(miss.status, 400);
  assert.equal(miss.code, 'typed-mismatch');
  const ok = await s.call('strategy-proposal-decide', { threadId: 't_1', proposalId: 'pr1', decision: 'confirm', typed: 'post 1' });
  assert.equal(ok.ok, true);
  assert.equal(ok.proposal.status, 'confirmed');
});

test('ui-model: actionCardModel tones/typed gate and undoChipModel', async () => {
  const { actionCardModel, undoChipModel, proposalStatusText } = await import('../ui-model.js');
  const mk = (id, items) => ({ summary: 's', payload: normalizeActionPayload({ actionId: id, items }, { registry }).payload });
  const danger = actionCardModel(mk('q.reject', [{ postId: 'a' }, { postId: 'b' }]));
  assert.equal(danger.tone, 'danger');
  assert.equal(danger.count, 2);
  assert.equal(danger.needsTyped, false);
  assert.match(danger.warningLines[0], /2 items/);
  const x = actionCardModel(mk('q.schedule', [{ postId: 'a' }]));
  assert.equal(x.tone, 'warn');
  assert.equal(x.needsTyped, true);
  assert.equal(x.confirmText, 'post 1');
  assert.equal(actionCardModel(mk('m.sync', [{}])).irreversible, true);
  assert.deepEqual(undoChipModel({ undoId: 'u1' }).undoId, 'u1');
  assert.equal(undoChipModel({ ok: true }), null);
  assert.equal(proposalStatusText({ kind: 'action', status: 'confirmed', result: { message: 'Edit: done.' } }).detail, 'Edit: done.');
});
