import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateProposal, assignProposal, decideProposal, buildExecutors, normalizeHandleInput, ProposalExecutionError,
} from '../agent/proposals.js';
import { PROPOSAL_KINDS } from '../contracts.js';
import { createMemoryPlanStore } from '../plan-store.js';

const NOW = Date.parse('2026-10-11T12:00:00.000Z');
const CTX = { clientId: 'c1' };
const spyExecutors = () => {
  const calls = [];
  const ex = Object.fromEntries(PROPOSAL_KINDS.map((k) => [k, async (a) => { calls.push([k, a]); return { done: k }; }]));
  return { ex, calls };
};
const pending = (kind, payload, extra = {}) => assignProposal({ kind, payload, summary: 's', rationale: 'r', evidence: [{ source: 'eval', figure: '1' }], ...extra }, { threadId: 't1', now: NOW });

test('assignProposal: uuid id, pending, trimmed fields, evidence capped', () => {
  const a = assignProposal({ kind: 'refresh-handles', payload: { handles: ['x'] }, summary: ` ${'s'.repeat(500)} `, rationale: 'r', evidence: Array.from({ length: 20 }, () => ({ source: 'a', figure: 'b' })) }, { threadId: 't1', now: NOW });
  assert.match(a.id, /^[0-9a-f-]{36}$/);
  assert.equal(a.status, 'pending');
  assert.equal(a.threadId, 't1');
  assert.equal(a.summary.length, 200);
  assert.equal(a.evidence.length, 8);
  assert.equal(a.createdAt, '2026-10-11T12:00:00.000Z');
  assert.notEqual(a.id, assignProposal({ kind: 'refresh-handles', payload: { handles: ['x'] } }, { threadId: 't1' }).id);
});

test('validateProposal: unknown kind and bad payloads are rejected, per kind', () => {
  assert.equal(validateProposal({ kind: 'delete-everything', payload: {} }).ok, false);
  assert.equal(validateProposal({ kind: 'plan-change' }).ok, false);
  assert.equal(validateProposal({ kind: 'plan-change', payload: { changes: {}, expectedVersion: 0 } }).ok, false);
  assert.equal(validateProposal({ kind: 'plan-change', payload: { changes: { authoredPerDay: 6 } } }).ok, false, 'expectedVersion required');
  assert.equal(validateProposal({ kind: 'plan-change', payload: { changes: { tier: 2 }, expectedVersion: 0 } }).ok, false);
  const bad = validateProposal({ kind: 'plan-change', payload: { changes: { authoredPerDay: 99 }, expectedVersion: 0 } });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(' '), /authoredPerDay/);
  const bad2 = validateProposal({ kind: 'plan-change', payload: { changes: { typeFloors: { reply: 1 } }, expectedVersion: 0 } });
  assert.equal(bad2.ok, false, 'validatePlan on the MERGED plan rejects unplannable types');
  const ok = validateProposal({ kind: 'plan-change', payload: { changes: { authoredPerDay: 6 }, expectedVersion: 2, junk: 1 } });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.proposal.payload, { changes: { authoredPerDay: 6 }, expectedVersion: 2 });
  assert.equal(validateProposal({ kind: 'suggestion-edit', payload: { suggestionId: 's1' } }).ok, false);
  assert.equal(validateProposal({ kind: 'suggestion-dismiss', payload: {} }).ok, false);
  assert.equal(validateProposal({ kind: 'suggestion-save-draft', payload: { suggestionId: 's1' } }).ok, true);
  assert.equal(validateProposal({ kind: 'refresh-handles', payload: { handles: [] } }).ok, false);
  assert.equal(validateProposal({ kind: 'refresh-handles', payload: { handles: ['a b'] } }).ok, false);
  assert.equal(validateProposal({ kind: 'refresh-handles', payload: { handles: Array.from({ length: 7 }, (_, i) => `h${i}`) } }).ok, false);
});

test('item-story validation: story only, required, bounded; extra humanEdits are stripped', () => {
  assert.equal(validateProposal({ kind: 'item-story', payload: { id: 'pkg1', story: '' } }).ok, false);
  assert.equal(validateProposal({ kind: 'item-story', payload: { id: 'pkg1', story: 'x'.repeat(1001) } }).ok, false);
  assert.equal(validateProposal({ kind: 'item-story', payload: { story: 'hi' } }).ok, false);
  const v = validateProposal({ kind: 'item-story', payload: { id: 'pkg1', story: ' shot at the pier ', humanEdits: { mood: 'x' }, facets: {} } });
  assert.deepEqual(v.proposal.payload, { id: 'pkg1', story: 'shot at the pier' });
});

test('benchmarks validation: <=8, regex, dedupe, own not in benchmarks', () => {
  assert.equal(normalizeHandleInput({ benchmarkHandles: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] }).ok, false);
  assert.equal(normalizeHandleInput({ benchmarkHandles: ['bad handle'] }).ok, false);
  assert.equal(normalizeHandleInput({ benchmarkHandles: ['waytoolonghandle_12345'] }).ok, false);
  assert.equal(normalizeHandleInput({ ownHandle: 'me', benchmarkHandles: ['Me'] }).ok, false);
  assert.equal(normalizeHandleInput({ benchmarkHandles: 'a,b' }).ok, false);
  assert.equal(normalizeHandleInput({ benchmarkHandles: [] }, { requireOwn: true }).ok, false);
  const ok = normalizeHandleInput({ ownHandle: '@me', benchmarkHandles: ['@a', 'A', 'b'] });
  assert.deepEqual(ok, { ok: true, ownHandle: 'me', benchmarkHandles: ['a', 'b'] });
  assert.equal(validateProposal({ kind: 'benchmarks-change', payload: { benchmarkHandles: ['a b'] } }).ok, false);
});

test('reject executes NOTHING', async () => {
  const { ex, calls } = spyExecutors();
  const out = await decideProposal({ proposal: pending('suggestion-dismiss', { suggestionId: 's1' }), decision: 'reject', executors: ex, context: CTX, clientId: 'c1', now: NOW });
  assert.equal(out.ok, true);
  assert.equal(out.proposal.status, 'rejected');
  assert.equal(calls.length, 0);
});

test('confirm executes exactly the mapped action once and stores the result', async () => {
  const { ex, calls } = spyExecutors();
  const p = pending('suggestion-dismiss', { suggestionId: 's1' });
  const out = await decideProposal({ proposal: p, decision: 'confirm', executors: ex, context: CTX, clientId: 'c1', by: 'me@x', now: NOW });
  assert.equal(out.proposal.status, 'confirmed');
  assert.deepEqual(out.proposal.result, { done: 'suggestion-dismiss' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'suggestion-dismiss');
  assert.equal(calls[0][1].proposalId, p.id);
  assert.equal(calls[0][1].by, 'me@x');
  assert.deepEqual(calls[0][1].payload, { suggestionId: 's1' });
});

test('already-decided proposal -> 409 and nothing runs again (confirm twice executes once)', async () => {
  const { ex, calls } = spyExecutors();
  const first = await decideProposal({ proposal: pending('refresh-handles', { handles: ['a'] }), decision: 'confirm', executors: ex, context: CTX, clientId: 'c1' });
  const second = await decideProposal({ proposal: first.proposal, decision: 'confirm', executors: ex, context: CTX, clientId: 'c1' });
  assert.equal(second.ok, false);
  assert.equal(second.status, 409);
  const third = await decideProposal({ proposal: first.proposal, decision: 'reject', executors: ex, context: CTX, clientId: 'c1' });
  assert.equal(third.status, 409);
  assert.equal(calls.length, 1);
});

test('executor throw -> failed with message, never confirmed', async () => {
  const ex = { 'suggestion-edit': async () => { throw new Error('suggestion already saved'); } };
  const out = await decideProposal({ proposal: pending('suggestion-edit', { suggestionId: 's', text: 't' }), decision: 'confirm', executors: ex, context: CTX, clientId: 'c1' });
  assert.equal(out.ok, true);
  assert.equal(out.proposal.status, 'failed');
  assert.match(out.proposal.result.message, /already saved/);
  const missing = await decideProposal({ proposal: pending('item-story', { id: 'p', story: 's' }), decision: 'confirm', executors: {}, context: CTX, clientId: 'c1' });
  assert.equal(missing.proposal.status, 'failed');
});

test('bad decision value -> 400', async () => {
  const out = await decideProposal({ proposal: pending('refresh-handles', { handles: ['a'] }), decision: 'maybe', executors: {}, context: CTX, clientId: 'c1' });
  assert.deepEqual([out.ok, out.status], [false, 400]);
});

// ---- real executors over memory stores + fakes ----
async function withPlan() {
  const planStore = createMemoryPlanStore();
  await planStore.apply('c1', { changes: { authoredPerDay: 6 }, expectedVersion: 0, by: 'm', source: 'manual', now: NOW });
  return planStore;
}

test('plan-change confirm applies through planStore with source chat + proposalId', async () => {
  const planStore = await withPlan();
  const executors = buildExecutors({ planStore, clock: () => NOW });
  const p = pending('plan-change', { changes: { authoredPerDay: 8 }, expectedVersion: 1 });
  const out = await decideProposal({ proposal: p, decision: 'confirm', executors, context: CTX, clientId: 'c1', by: 'me@x', now: NOW });
  assert.equal(out.proposal.status, 'confirmed');
  const doc = await planStore.get('c1');
  assert.equal(doc.version, 2);
  assert.equal(doc.plan.authoredPerDay, 8);
  const h = doc.history.at(-1);
  assert.deepEqual([h.source, h.proposalId, h.by], ['chat', p.id, 'me@x']);
});

test('stale plan-change -> failed:stale with currentVersion, plan doc unchanged', async () => {
  const planStore = await withPlan();
  const executors = buildExecutors({ planStore, clock: () => NOW });
  await planStore.apply('c1', { changes: { authoredPerDay: 10 }, expectedVersion: 1, by: 'm', source: 'manual', now: NOW }); // v2
  const before = await planStore.get('c1');
  const out = await decideProposal({ proposal: pending('plan-change', { changes: { authoredPerDay: 8 }, expectedVersion: 1 }), decision: 'confirm', executors, context: CTX, clientId: 'c1' });
  assert.equal(out.proposal.status, 'failed');
  assert.equal(out.proposal.result.error, 'stale');
  assert.equal(out.proposal.result.currentVersion, 2);
  assert.deepEqual(await planStore.get('c1'), before);
});

test('plan-change on an absent plan doc needs expectedVersion 0', async () => {
  const planStore = createMemoryPlanStore();
  const executors = buildExecutors({ planStore, clock: () => NOW });
  const stale = await decideProposal({ proposal: pending('plan-change', { changes: { authoredPerDay: 8 }, expectedVersion: 3 }), decision: 'confirm', executors, context: CTX, clientId: 'c1' });
  assert.equal(stale.proposal.result.error, 'stale');
  assert.equal(await planStore.get('c1'), null);
  const ok = await decideProposal({ proposal: pending('plan-change', { changes: { authoredPerDay: 8 }, expectedVersion: 0 }), decision: 'confirm', executors, context: CTX, clientId: 'c1' });
  assert.equal(ok.proposal.status, 'confirmed');
  assert.equal((await planStore.get('c1')).version, 1);
});

test('executors map to the right daily/item/refresh actions; item-story sends story only; regenerate model is off unless ticked', async () => {
  const planStore = createMemoryPlanStore();
  const daily = [];
  const item = [];
  const refresh = [];
  const executors = buildExecutors({
    planStore,
    runDailyAction: async (ctx, action, body) => { daily.push([action, body, ctx]); return { ok: true, run: { localDate: '2026-10-11', big: 'x'.repeat(9000) }, suggestion: { id: body.suggestionId } }; },
    runUpdateItemFacets: async (ctx, body) => { item.push(body); return { ok: true, pkg: { id: body.id, story: body.story } }; },
    refreshHandles: async (a) => { refresh.push(a.handles); return { ok: true, requestId: 'r1', status: 'queued' }; },
  });
  const run = async (kind, payload) => (await decideProposal({ proposal: pending(kind, payload), decision: 'confirm', executors, context: CTX, clientId: 'c1' })).proposal;
  const e = await run('suggestion-edit', { suggestionId: 's1', text: 'new' });
  assert.deepEqual(daily[0].slice(0, 2), ['daily-run-edit', { suggestionId: 's1', text: 'new' }]);
  assert.equal(daily[0][2], CTX);
  assert.equal(e.status, 'confirmed');
  assert.equal(e.result.run, undefined, 'the run doc is not stored on the proposal');
  assert.equal(e.result.runDate, '2026-10-11');
  await run('suggestion-dismiss', { suggestionId: 's2' });
  assert.deepEqual(daily[1].slice(0, 2), ['daily-run-dismiss', { suggestionId: 's2' }]);
  await run('suggestion-save-draft', { suggestionId: 's3' });
  assert.deepEqual(daily[2].slice(0, 2), ['daily-run-save-draft', { suggestionId: 's3' }]);
  await run('regenerate-today', {});
  assert.deepEqual(daily[3].slice(0, 2), ['daily-run-generate', { draftWithModel: false, force: false }]);
  await run('regenerate-today', { useModel: 'yes' });
  assert.equal(daily[4][1].draftWithModel, false, 'only boolean true turns the model on');
  await run('regenerate-today', { useModel: true, force: true });
  assert.deepEqual(daily[5].slice(0, 2), ['daily-run-generate', { draftWithModel: false, force: true }], 'payload.useModel is ignored');
  const owner = async (kind, payload, options) => (await decideProposal({ proposal: pending(kind, payload), decision: 'confirm', executors, context: CTX, clientId: 'c1', options })).proposal;
  await owner('regenerate-today', {}, { useModel: true });
  assert.equal(daily[6][1].draftWithModel, true, 'owner option honored');
  await owner('regenerate-today', {}, { useModel: 'yes' });
  assert.equal(daily[7][1].draftWithModel, false, 'only boolean true');
  await owner('suggestion-dismiss', { suggestionId: 's9' }, { useModel: true });
  assert.deepEqual(daily[8].slice(0, 2), ['daily-run-dismiss', { suggestionId: 's9' }], 'other kinds ignore options');
  const s = await run('item-story', { id: 'pkg1', story: 'real story' });
  assert.deepEqual(item, [{ id: 'pkg1', story: 'real story' }]);
  assert.equal(s.status, 'confirmed');
  const r = await run('refresh-handles', { handles: ['a', 'b'] });
  assert.deepEqual(refresh, [['a', 'b']]);
  assert.equal(r.status, 'confirmed');
});

test('a refused daily action ({ok:false}) and a thrown one both land as failed; missing capability fails cleanly', async () => {
  const planStore = createMemoryPlanStore();
  const executors = buildExecutors({
    planStore,
    runDailyAction: async (ctx, action) => (action === 'daily-run-save-draft' ? { ok: false, error: 'guard refused', checks: ['x'], status: 422 } : (() => { throw Object.assign(new Error('already saved'), { status: 409 }); })()),
  });
  const a = (await decideProposal({ proposal: pending('suggestion-save-draft', { suggestionId: 's' }), decision: 'confirm', executors, context: CTX, clientId: 'c1' })).proposal;
  assert.equal(a.status, 'failed');
  assert.match(a.result.message, /guard refused/);
  const b = (await decideProposal({ proposal: pending('suggestion-edit', { suggestionId: 's', text: 't' }), decision: 'confirm', executors, context: CTX, clientId: 'c1' })).proposal;
  assert.equal(b.status, 'failed');
  assert.match(b.result.message, /already saved/);
  const c = (await decideProposal({ proposal: pending('item-story', { id: 'p', story: 's' }), decision: 'confirm', executors, context: CTX, clientId: 'c1' })).proposal;
  assert.equal(c.status, 'failed');
  assert.match(c.result.message, /not available/);
});

test('benchmarks-change calls the injected saver with normalized handles; failure -> failed', async () => {
  const saved = [];
  const planStore = createMemoryPlanStore();
  const executors = buildExecutors({ planStore, saveXGrowthProfile: async (id, prof) => { saved.push([id, prof]); return { ...prof, enabled: false }; } });
  const out = (await decideProposal({ proposal: pending('benchmarks-change', { ownHandle: 'me', benchmarkHandles: ['a', 'b'] }), decision: 'confirm', executors, context: CTX, clientId: 'c1' })).proposal;
  assert.equal(out.status, 'confirmed');
  assert.deepEqual(saved, [['c1', { ownHandle: 'me', benchmarkHandles: ['a', 'b'] }]]);
  const bad = (await decideProposal({ proposal: pending('benchmarks-change', { benchmarkHandles: Array.from({ length: 9 }, (_, i) => `h${i}`) }), decision: 'confirm', executors, context: CTX, clientId: 'c1' })).proposal;
  assert.equal(bad.status, 'failed', 'executor re-validates even if a bad payload slipped past assignment');
  assert.equal(saved.length, 1);
});

test('ProposalExecutionError carries a structured result', () => {
  const e = new ProposalExecutionError('m', { error: 'stale', currentVersion: 4 });
  assert.equal(e.result.currentVersion, 4);
});
