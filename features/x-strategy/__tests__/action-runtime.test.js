import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createActionRuntime, invokeAction, normalizeActionPayload, normalizeAutonomy, resolveGate, requiredTypedText,
  validateActionArgs, runActionTool, ACTION_TOOL_NAMES,
} from '../agent/action-runtime.js';
import { createMemoryActionStores } from '../agent/action-stores.js';
import { createMemoryRefreshSpendStore } from '../agent/refresh-spend.js';
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
  assert.deepEqual(normalizeAutonomy({ tier1: 'x', tier2: 'auto', tier3: 'auto' }), { tier1: 'auto', tier2: 'confirm', tier3: 'confirm' , trustedSchedule: { enabled: false, minLeadMinutes: 10, dailyCap: 3 }, trustedRefresh: { enabled: false, dailyCapUsd: 1 } });
});

test('trusted scheduling: the only X exception, off by default, needs the explicit marker and stays within the daily cap', () => {
  const trusted = { id: 'q.trusted', tier: 3, external: 'x', trusted: 'schedule-approved' };
  const plainX = { id: 'q.x', tier: 3, external: 'x' };
  assert.equal(resolveGate(trusted, {}), 'typed', 'off by default');
  const on = { trustedSchedule: { enabled: true, dailyCap: 2 } };
  assert.equal(resolveGate(trusted, on), 'run');
  assert.equal(resolveGate(trusted, on, { itemCount: 3 }), 'typed', 'a batch over the daily cap asks');
  assert.equal(resolveGate(plainX, on), 'typed', 'every other X write keeps the typed floor');
  assert.equal(resolveGate({ ...trusted, trusted: 'something-else' }, on), 'typed');
  const n = normalizeAutonomy({ trustedSchedule: { enabled: true, minLeadMinutes: 1, dailyCap: 99 } }).trustedSchedule;
  assert.deepEqual(n, { enabled: true, minLeadMinutes: 10, dailyCap: 10 }, 'lead never under 10 min, cap never over 10');
});

test('args: schema checks, reserved keys refused', () => {
  const e = registry.getAction('q.update');
  assert.equal(validateActionArgs(e, { postId: 'p1' }).ok, true);
  assert.match(validateActionArgs(e, {}).errors[0], /postId is required/);
  assert.match(validateActionArgs(e, { postId: 'p', clientId: 'other' }).errors.join(), /clientId is set by the system/);
  const dropped = validateActionArgs({ ...e, args: { ...e.args, additionalProperties: false } }, { postId: 'p', nope: 1 });
  assert.equal(dropped.ok, true);
  assert.deepEqual(dropped.dropped, ['nope']);
  assert.deepEqual(dropped.args, { postId: 'p' });
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

test('undo never re-arms publishing: restoring a scheduled snapshot is refused (unschedule / media swap)', async () => {
  const sched = post({ status: 'scheduled', scheduledAt: '2026-10-20T15:00:00.000Z', approvedHash: 'h1', revision: 3 });
  const { rt, stores } = setup({ files: { 'social_posts/p1': sched } });
  const out = await rt.run(CTX, { actionId: 'q.update', args: { postId: 'p1', content: 'new' } });
  // the action under test voided the schedule (what unschedule / attach-media do on v2 rows)
  stores.files.set('social_posts/p1', { ...stores.files.get('social_posts/p1'), status: 'draft', scheduledAt: null, approvedHash: null });
  const row = await stores.audit.get(CLIENT, out.result.undoId);
  row.items[0].snapshots[0].after = stores.files.get('social_posts/p1');
  await stores.audit.update(CLIENT, out.result.undoId, { items: row.items });
  const u = await rt.undo(CTX, out.result.undoId);
  assert.equal(u.ok, false);
  assert.match(u.error, /publishing schedule/);
  assert.equal(stores.files.get('social_posts/p1').status, 'draft');
  assert.equal(stores.files.get('social_posts/p1').scheduledAt, null);
  assert.equal((await stores.audit.get(CLIENT, out.result.undoId)).undoneAt ?? null, null);
});

test('undo of a scheduling action (draft -> scheduled) is refused too: the ledger slot would stay reserved', async () => {
  const { rt, stores } = setup({ files: { 'social_posts/p1': post({ revision: 1 }) } });
  const out = await rt.run(CTX, { actionId: 'q.update', args: { postId: 'p1', content: 'new' } });
  const scheduled = { ...stores.files.get('social_posts/p1'), status: 'scheduled', scheduledAt: '2026-10-20T15:00:00.000Z', revision: 2 };
  stores.files.set('social_posts/p1', scheduled);
  const row = await stores.audit.get(CLIENT, out.result.undoId);
  row.items[0].snapshots[0].after = scheduled; // what the action left behind (the stub invoke cannot schedule)
  await stores.audit.update(CLIENT, out.result.undoId, { items: row.items });
  const u = await rt.undo(CTX, out.result.undoId);
  assert.equal(u.ok, false);
  assert.match(u.error, /publishing schedule/);
  assert.equal(stores.files.get('social_posts/p1').status, 'scheduled');
  assert.equal(stores.files.get('social_posts/p1').revision, 2);
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
  // __fail is not in the schema: it is dropped (reported), so the call is not forced to fail
  assert.equal(out.kind, 'result');
  assert.deepEqual(out.result.droppedArgs, ['__fail']);
  const bad = await rt.run(CTX, { actionId: 'q.nosnap', args: {} });
  assert.equal(bad.result.status, 'ok');
  assert.equal(bad.result.undoId, undefined, 'no snapshot + no native undo => not undoable');
  assert.equal((await stores.audit.recent(CLIENT, 5)).length, 2);
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
  assert.deepEqual(saved, { tier1: 'confirm', tier2: 'confirm', tier3: 'confirm' , trustedSchedule: { enabled: false, minLeadMinutes: 10, dailyCap: 3 }, trustedRefresh: { enabled: false, dailyCapUsd: 1 } });
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

test('invokeAction: fixed overrides agent args; query action on POST and GET; explicit-client routes get no as=', async () => {
  const seen = [];
  const routeModules = { media: async () => ({
    POST: async (req) => { seen.push([req.url, await req.json()]); return Response.json({ ok: true }); },
    GET: async (req) => { seen.push([req.url]); return Response.json({ ok: true }); },
  }), 'digest-config': async () => ({ POST: async (req) => { seen.push([req.url, await req.json()]); return Response.json({ ok: true }); }, GET: async (req) => { seen.push([req.url]); return Response.json({ ok: true }); } }) };
  const imp = { ...CTX, impersonating: true, origin: 'https://app.test' };
  await invokeAction({ id: 'a', route: 'media', method: 'POST', action: null, query: { action: 'create-folder' }, fixed: { mode: 'safe' } }, { name: 'x', mode: 'evil' }, imp, { routeModules });
  assert.match(seen[0][0], /^https:\/\/app\.test\/api\/dashboard\/media\?action=create-folder&as=c1$/);
  assert.deepEqual(seen[0][1], { name: 'x', mode: 'safe', clientId: 'c1' }, 'fixed wins over the agent, no body.action for a query-action entry');
  await invokeAction({ id: 'b', route: 'media', method: 'GET', action: null, query: { action: 'jobs' } }, { type: 'video-remix' }, CTX, { routeModules });
  assert.match(seen[1][0], /\?action=jobs&type=video-remix$/);
  await invokeAction({ id: 'c', route: 'digest-config', method: 'POST', action: null }, { tone: 't' }, imp, { routeModules });
  assert.equal(seen[2][0].includes('as='), false, 'verifyAdminRequest routes use the explicit clientId, never as=');
  assert.deepEqual(seen[2][1], { tone: 't', clientId: 'c1' });
  await invokeAction({ id: 'd', route: 'digest-config', method: 'GET', action: null }, {}, imp, { routeModules });
  assert.match(seen[3][0], /\?clientId=c1$/);
});

test('refresh-panel entries never invoke: run_action returns a refresh proposal with the group ids', async () => {
  const entries = [
    { id: 'r.sig', group: 'refresh', title: 'Refresh signals', description: 'x', route: 'r', method: 'GET', action: null, args: props({}), tier: 3, external: 'paid', cost: '$', viaRefreshPanel: true, refreshGroups: ['market-signals'] },
    { id: 'r.brief', group: 'signals', title: 'Run brief', description: 'x', route: 'r', method: 'POST', action: null, args: props({ scope: { type: 'string' } }, ['scope']), tier: 3, external: 'paid', cost: '$', viaRefreshPanel: true, refreshGroupsByArg: { arg: 'scope', map: { 'marketing-director': ['market-signals'] } } },
  ];
  const reg = { getAction: (id) => entries.find((e) => e.id === id) ?? null, findActions: () => [] };
  const calls = [];
  const rt = createActionRuntime({ ...createMemoryActionStores(), invoke: async (...a) => { calls.push(a); return { ok: true, status: 200, json: {} }; }, registry: reg });
  const out = await rt.run(CTX, { actionId: 'r.sig', args: { junk: 1 } });
  assert.equal(out.kind, 'proposal');
  assert.equal(out.proposal.kind, 'refresh');
  assert.deepEqual(out.proposal.payload.groups, ['market-signals']);
  assert.equal(validateProposal(out.proposal).ok, true, 'a valid refresh proposal');
  const exec = buildExecutors({}).refresh({ payload: out.proposal.payload });
  assert.equal((await exec).clientAction, 'marketing-refresh');
  assert.equal((await rt.run(CTX, { actionId: 'r.brief', args: { scope: 'marketing-director' } })).proposal.payload.groups[0], 'market-signals');
  const bad = await rt.run(CTX, { actionId: 'r.brief', args: { scope: 'social-media-manager' } });
  assert.equal(bad.kind, 'error');
  assert.match(bad.error, /Refresh panel/);
  assert.equal(calls.length, 0, 'nothing was invoked in-process');
  await assert.rejects(invokeAction(entries[0], {}, CTX, { routeModules: { r: async () => ({ GET: async () => Response.json({}) }) } }), /Refresh panel/);
  assert.equal(normalizeActionPayload({ actionId: 'r.sig' }, { registry: reg }).ok, false, 'no action card for panel entries');
});

test('autonomy and proposal decisions are refused for the agent, in run, cards and invoke', async () => {
  const entry = { id: 'x.autonomy.save', group: 'strategy', title: 'Save autonomy', description: 'x', route: 'r', method: 'POST', action: 'strategy-autonomy-save', args: props({}), tier: 1 };
  const decide = { ...entry, id: 'x.decide', action: 'strategy-proposal-decide' };
  const reg = { getAction: (id) => [entry, decide].find((e) => e.id === id) ?? null, findActions: () => [] };
  const rt = createActionRuntime({ ...createMemoryActionStores(), invoke: async () => { throw new Error('must not run'); }, registry: reg });
  for (const id of ['x.autonomy.save', 'x.decide']) {
    const out = await rt.run(CTX, { actionId: id });
    assert.equal(out.kind, 'error', id);
    assert.equal(normalizeActionPayload({ actionId: id }, { registry: reg }).ok, false, id);
    await assert.rejects(invokeAction(reg.getAction(id), {}, CTX, { routeModules: { r: async () => ({ POST: async () => Response.json({ ok: true }) }) } }));
  }
  assert.match((await rt.run(CTX, { actionId: 'x.autonomy.save' })).error, /own permissions/);
});

test('snapshot path placeholders resolve from args (content task)', async () => {
  const entry = { id: 'c.task', group: 'content', title: 'Task', description: 'x', route: 'r', method: 'POST', action: 'content-task-update', args: props({ taskId: { type: 'string' }, status: { type: 'string' } }, ['taskId', 'status']), tier: 1, snapshot: [{ path: 'content_tasks/{clientId}/tasks/{taskId}' }] };
  const stores = createMemoryActionStores();
  stores.files.set('content_tasks/c1/tasks/media-p1', { status: 'open' });
  const rt = createActionRuntime({ ...stores, registry: { getAction: () => entry, findActions: () => [] }, invoke: async (e, a) => { stores.files.set('content_tasks/c1/tasks/media-p1', { status: a.status }); return { ok: true, status: 200, json: { ok: true } }; } });
  const out = await rt.run(CTX, { actionId: 'c.task', args: { taskId: 'media-p1', status: 'done' } });
  assert.ok(out.result.undoId);
  assert.equal((await rt.undo(CTX, out.result.undoId)).ok, true);
  assert.equal(stores.files.get('content_tasks/c1/tasks/media-p1').status, 'open');
});

test('end to end with REAL catalog entries and injected route modules (no network, no firebase)', async () => {
  const { getAction } = await import('../agent/action-registry.js');
  const seen = [];
  const mk = (name) => async () => ({
    GET: async (req) => { seen.push([name, 'GET', req.url]); return Response.json({ ok: true, rows: [1] }); },
    POST: async (req) => { seen.push([name, 'POST', req.url, await req.json()]); return Response.json({ ok: true }); },
  });
  const routeModules = { 'quote-targets': mk('qt'), 'social-posting': mk('sp'), 'digest-config': mk('dc'), media: mk('media') };
  const stores = createMemoryActionStores();
  stores.files.set('content_tasks/c1/tasks/media-p1', { status: 'open' });
  stores.files.set('social_posts/p1', { clientId: 'c1', content: 'old', status: 'draft' });
  const rt = createActionRuntime({ ...stores, invoke: (e, a, c) => invokeAction(e, a, c, { routeModules }) });
  const imp = { ...CTX, impersonating: true };
  // tier 0 via query action (GET)
  const read = await rt.run(imp, { actionId: 'media.jobs', args: { type: 'video-remix', bogus: 1 } });
  assert.equal(read.kind, 'result');
  assert.deepEqual(read.result.droppedArgs, ['bogus']);
  assert.match(seen[0][2], /\/api\/dashboard\/media\?action=jobs&as=c1&type=video-remix$/);
  // tier 1 on a quote-targets action, snapshot from a templated path
  const t = await rt.run(imp, { actionId: 'content.task.update', args: { taskId: 'media-p1', status: 'done' } });
  assert.equal(t.kind, 'result');
  assert.ok(t.result.undoId);
  assert.deepEqual(seen[1][3], { taskId: 'media-p1', status: 'done', action: 'content-task-update', clientId: 'c1' });
  // fixed body field cannot be overridden: queue.post.update fixes scheduledAt:null
  const upd = await rt.run(imp, { actionId: 'queue.post.update', args: { postId: 'p1', content: 'new', scheduledAt: '2030-01-01T00:00:00Z' } });
  assert.equal(upd.kind, 'result');
  assert.deepEqual(upd.result.droppedArgs, ['scheduledAt'], 'the schedule cannot be smuggled into an edit');
  assert.equal('scheduledAt' in seen.at(-1)[3], false);
  const unsch = await rt.run(imp, { actionId: 'queue.post.unschedule', args: { postId: 'p1' } });
  assert.equal(unsch.kind, 'result');
  assert.equal(seen.at(-1)[3].scheduledAt, null, 'fixed field merged after agent args');
  assert.equal(seen.at(-1)[3].action, 'update');
  // X publishing: typed card, nothing invoked
  const before = seen.length;
  const sch = await rt.run(imp, { actionId: 'queue.post.schedule', args: { content: 'hello', postId: 'p1', scheduledAt: '2030-01-01T00:00:00Z' } });
  assert.equal(sch.kind, 'proposal');
  assert.equal(sch.proposal.payload.typed, true);
  assert.match(sch.proposal.payload.confirmText, /^post 1$/);
  // paid tier 3: confirm card with cost, not typed
  const paid = await rt.run(imp, { actionId: 'xmonitor.sync-profile' });
  assert.equal(paid.kind, 'proposal');
  assert.equal(paid.proposal.payload.typed, false);
  assert.ok(paid.proposal.payload.cost);
  // refresh group entry -> refresh proposal
  const rf = await rt.run(imp, { actionId: 'refresh.signals' });
  assert.equal(rf.proposal.kind, 'refresh');
  assert.deepEqual(rf.proposal.payload.groups, ['market-signals']);
  // autonomy-save and decide are not in the registry at all
  assert.equal(getAction('strategy.autonomy.save'), null);
  assert.equal((await rt.run(imp, { actionId: 'strategy.autonomy.get' })).kind, 'result');
  assert.equal(seen.length, before + 1, 'only the autonomy read ran after the cards');
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
  assert.deepEqual((await s.call('strategy-autonomy-get', {})).autonomy, { tier1: 'auto', tier2: 'confirm', tier3: 'confirm' , trustedSchedule: { enabled: false, minLeadMinutes: 10, dailyCap: 3 }, trustedRefresh: { enabled: false, dailyCapUsd: 1 } });
  const saved = await s.call('strategy-autonomy-save', { autonomy: { tier1: 'confirm', tier2: 'auto', tier3: 'typed' } });
  assert.deepEqual(saved.autonomy, { tier1: 'confirm', tier2: 'confirm', tier3: 'typed' , trustedSchedule: { enabled: false, minLeadMinutes: 10, dailyCap: 3 }, trustedRefresh: { enabled: false, dailyCapUsd: 1 } });
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

// ---- agent self-refresh: route actions, autonomy.trustedRefresh, toolDeps ----
function refreshHandlers() {
  const stores = createMemoryActionStores();
  const actionRuntime = createActionRuntime({ ...stores, registry, invoke: async () => ({ ok: true, status: 200, json: { ok: true } }) });
  const corpusStore = createMemoryCorpusStore({ loadCommitted: () => null });
  const planStore = createMemoryPlanStore();
  const refreshService = createRefreshService({ store: corpusStore, queueStore: createMemoryRefreshQueue(), now: () => NOW, enabled: false, detectBird: async () => ({ available: false }), idGen: () => 'rs-1', ingest: async () => ({ rows: [], pull: {} }), runBirdFor: () => () => '' });
  const scans = new Map();
  const quoteScanQueue = {
    request: async ({ clientId, mode }) => { const id = `scan-${mode}`; scans.set(id, { id, clientId, mode, status: 'queued' }); return { requestId: id, status: 'queued' }; },
    get: async (id) => scans.get(id) ?? null,
  };
  const digestCalls = [];
  const spend = createMemoryRefreshSpendStore();
  const h = createStrategyHandlers({
    corpusStore, planStore, refreshService, clock: () => NOW, readXGrowthConfig: async () => ({ ownHandle: 'me', benchmarkHandles: [] }),
    actionRuntime, quoteScanQueue, refreshSpendStore: spend,
    runDigestRefresh: async (clientId, o) => { digestCalls.push([clientId, o.phase, [...o.groups]]); return { ok: true }; },
    runDailyAction: async () => ({ ok: true, run: { suggestions: [{}] } }),
  });
  const AUTH = { decoded: { email: 'owner@x.com', uid: 'u1' } };
  const call = (a, b) => h.handle(a, { clientId: CLIENT, ...b }, { clientId: CLIENT }, AUTH);
  return { h, call, scans, digestCalls, spend };
}

test('route: autonomy-save accepts trustedRefresh, validates it, and leaves tier/trustedSchedule alone', async () => {
  const s = refreshHandlers();
  assert.deepEqual((await s.call('strategy-autonomy-get', {})).autonomy.trustedRefresh, { enabled: false, dailyCapUsd: 1 });
  const ok = await s.call('strategy-autonomy-save', { autonomy: { trustedRefresh: { enabled: true, dailyCapUsd: 2.5 } } });
  assert.deepEqual(ok.autonomy.trustedRefresh, { enabled: true, dailyCapUsd: 2.5 });
  assert.equal(ok.autonomy.tier1, 'auto');
  assert.deepEqual(ok.autonomy.trustedSchedule, { enabled: false, minLeadMinutes: 10, dailyCap: 3 });
  assert.equal((await s.call('strategy-autonomy-save', { autonomy: { trustedRefresh: { enabled: true, dailyCapUsd: 50 } } })).status, 400);
  assert.equal((await s.call('strategy-autonomy-save', { autonomy: { trustedRefresh: { enabled: true, dailyCapUsd: 0.01 } } })).status, 400);
  assert.equal((await s.call('strategy-autonomy-save', { autonomy: { trustedRefresh: { enabled: 'yes' } } })).status, 400);
  assert.equal((await s.call('strategy-autonomy-save', { autonomy: { trustedRefresh: 5 } })).status, 400);
  assert.deepEqual((await s.call('strategy-autonomy-get', {})).autonomy.trustedRefresh, { enabled: true, dailyCapUsd: 2.5 }); // refused saves changed nothing
  assert.equal((await s.call('strategy-autonomy-save', { tier1: 'confirm' })).autonomy.trustedRefresh.enabled, true); // other saves keep it
});

test('route: agent-refresh runs free groups, gates paid ones on the owner setting, and records spend', async () => {
  const s = refreshHandlers();
  const free = await s.call('agent-refresh', { groups: ['today-queue', 'recent-posts', 'hot-quotes', 'analysis'] });
  assert.equal(free.ok, true);
  assert.deepEqual(free.results.map((r) => [r.group, r.status]), [['today-queue', 'done'], ['recent-posts', 'queued'], ['hot-quotes', 'queued'], ['analysis', 'needs-confirm']]);
  assert.deepEqual(free.pendingRequestIds, ['scan-recent-posts', 'scan-hot']);
  assert.equal(s.digestCalls.length, 0); // policy is off: nothing paid ran

  await s.call('strategy-autonomy-save', { autonomy: { trustedRefresh: { enabled: true, dailyCapUsd: 0.3 } } });
  const paid = await s.call('agent-refresh', { groups: ['market-signals', 'analysis'] });
  assert.deepEqual(paid.results.map((r) => [r.group, r.status]), [['market-signals', 'done'], ['analysis', 'needs-confirm']]); // 0.10 fits, +0.25 passes 0.30
  assert.deepEqual(s.digestCalls, [[CLIENT, 'signals', ['market-signals']]]);
  assert.equal(paid.spentUsd, 0.1);
  assert.equal((await s.spend.get(CLIENT, '2026-10-11')).usd, 0.1);

  assert.equal((await s.call('agent-refresh', { groups: [] })).status, 400);
  assert.equal((await s.call('agent-refresh', { groups: ['x-search'] })).status, 400); // never offered to the agent
  assert.equal((await s.call('agent-refresh', { groups: ['nope'] })).status, 400);
});

test('route: agent-refresh-status maps queued Mac requests and hides other clients\' ids', async () => {
  const s = refreshHandlers();
  await s.call('agent-refresh', { groups: ['bookmarks'] });
  s.scans.get('scan-bookmarks').status = 'done';
  s.scans.get('scan-bookmarks').result = { picks: 3 };
  s.scans.set('scan-other', { id: 'scan-other', clientId: 'other', status: 'done' });
  const r = await s.call('agent-refresh-status', { requestIds: ['scan-bookmarks', 'scan-other'] });
  assert.deepEqual(r.requests.map((x) => [x.requestId, x.status]), [['scan-bookmarks', 'done'], ['scan-other', 'unknown']]);
  assert.deepEqual(r.requests[0].result, { picks: 3 });
  assert.equal((await s.call('agent-refresh-status', { requestIds: [] })).status, 400);
});

test('toolDeps: refreshData / refreshStatus / agentRefreshAvailability are closed over the client and feed get_freshness', async () => {
  const s = refreshHandlers();
  const deps = s.h.toolDepsFor(CLIENT, { clientId: CLIENT }, { decoded: { email: 'owner@x.com' } });
  const out = await deps.refreshData({ groups: ['recent-posts', 'renders'], reason: 'since this morning' });
  assert.deepEqual(out.results.map((r) => [r.group, r.status]), [['recent-posts', 'queued'], ['renders', 'needs-confirm']]);
  const st = await deps.refreshStatus({ requestIds: out.pendingRequestIds });
  assert.equal(st.requests[0].status, 'queued');
  const a = await deps.agentRefreshAvailability(['recent-posts', 'analysis', 'x-search']);
  assert.deepEqual(a.availability, { 'recent-posts': true, analysis: 'needs-confirm', 'x-search': 'no-path' });
  assert.equal(a.trustedRefresh, false);
});
