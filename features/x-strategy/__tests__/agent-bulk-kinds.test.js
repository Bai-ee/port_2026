// Admin-level bulk proposal kinds: daily-fill, refresh, queue-bulk, bucket-edit (+ per-turn cap exemption).
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProposal, buildExecutors, decideProposal, assignProposal } from '../agent/proposals.js';
import { prepareProposal, PROPOSE_TOOL_BY_KIND } from '../agent/tools.js';
import { createAgentLoop } from '../agent/loop.js';
import { proposalPayloadPreview, proposalKindLabel, proposalStatusText } from '../ui-model.js';
import { REFRESH_GROUP_IDS, BULK_PROPOSAL_KINDS, PROPOSAL_KINDS } from '../contracts.js';
import { REFRESH_GROUPS } from '../../../components/dashboard/marketing/refresh-groups.js';
import { createMemoryPlanStore } from '../plan-store.js';

const v = (kind, payload) => validateProposal({ kind, payload });
const common = { summary: 's', rationale: 'r', evidence: [{ source: 'x', figure: '1' }] };

test('REFRESH_GROUP_IDS mirrors refresh-groups.js', () => {
  assert.deepEqual([...REFRESH_GROUP_IDS], REFRESH_GROUPS.map((g) => g.id));
  for (const k of ['daily-fill', 'refresh', 'queue-bulk', 'bucket-edit']) assert.ok(PROPOSAL_KINDS.includes(k) && PROPOSE_TOOL_BY_KIND[k]);
});

test('validate daily-fill', () => {
  assert.equal(v('daily-fill', { from: '2026-10-20', days: 7 }).proposal.payload.include.length, 4);
  assert.deepEqual(v('daily-fill', { from: '2026-10-20', days: 7, include: ['quotes', 'quotes'] }).proposal.payload.include, ['quotes']);
  for (const bad of [{ from: 'tomorrow', days: 3 }, { from: '2026-10-20', days: 0 }, { from: '2026-10-20', days: 32 }, { from: '2026-10-20', days: 3, include: ['nope'] }]) assert.equal(v('daily-fill', bad).ok, false);
});

test('validate refresh: only known group ids', () => {
  assert.deepEqual(v('refresh', { groups: ['analysis', 'analysis', 'renders'], reason: 'stale' }).proposal.payload.groups, ['analysis', 'renders']);
  assert.equal(v('refresh', { groups: ['bogus'] }).ok, false);
  assert.equal(v('refresh', { groups: [] }).ok, false);
});

test('validate queue-bulk', () => {
  assert.equal(v('queue-bulk', { action: 'approve', postIds: ['a', 'b'] }).ok, true);
  assert.equal(v('queue-bulk', { action: 'publish', postIds: ['a'] }).ok, false);
  assert.equal(v('queue-bulk', { action: 'approve', postIds: Array.from({ length: 51 }, (_, i) => `p${i}`) }).ok, false);
  assert.equal(v('queue-bulk', { action: 'set-review-date', postIds: ['a'] }).ok, false);
  assert.equal(v('queue-bulk', { action: 'set-review-date', postIds: ['a'], date: '2026-11-01' }).proposal.payload.date, '2026-11-01');
});

test('validate bucket-edit', () => {
  assert.equal(v('bucket-edit', { op: 'upsert', bucket: { name: 'Throwbacks', sourceKind: 'manual', color: '#112233' } }).ok, true);
  assert.equal(v('bucket-edit', { op: 'upsert', bucket: { name: 'x', sourceKind: 'nope' } }).ok, false);
  assert.equal(v('bucket-edit', { op: 'upsert', bucket: { name: 'x', share: { bogus: 1 } } }).ok, false);
  assert.equal(v('bucket-edit', { op: 'delete', bucket: {} }).ok, false);
  assert.deepEqual(v('bucket-edit', { op: 'delete', bucket: { id: 'old' }, reassignTo: 'ideas' }).proposal.payload, { op: 'delete', bucket: { id: 'old' }, reassignTo: 'ideas' });
});

const run = async (executors, kind, payload) => {
  const p = assignProposal({ kind, payload: v(kind, payload).proposal.payload, ...common }, { threadId: 't' });
  return (await decideProposal({ proposal: p, decision: 'confirm', executors, clientId: 'c1', by: 'me' })).proposal;
};

test('executor daily-fill needs its dep, then creates drafts through it', async () => {
  const missing = await run(buildExecutors({ planStore: createMemoryPlanStore() }), 'daily-fill', { from: '2026-10-20', days: 2 });
  assert.equal(missing.status, 'failed');
  assert.match(missing.result.message, /daily fill is not available/);
  const seen = [];
  const ex = buildExecutors({ planStore: createMemoryPlanStore(), runDailyFill: async (a) => { seen.push(a); return { ok: true, created: 3, existing: 1, placed: 0, failed: [] }; } });
  const ok = await run(ex, 'daily-fill', { from: '2026-10-20', days: 2, include: ['quotes'] });
  assert.equal(ok.status, 'confirmed');
  assert.equal(ok.result.created, 3);
  assert.deepEqual(seen[0].spec, { from: '2026-10-20', days: 2, include: ['quotes'] });
});

test('executor refresh runs nothing and returns the client action', async () => {
  const ok = await run(buildExecutors({ planStore: createMemoryPlanStore() }), 'refresh', { groups: ['analysis'], reason: 'stale' });
  assert.equal(ok.status, 'confirmed');
  assert.deepEqual(ok.result, { clientAction: 'marketing-refresh', groups: ['analysis'] });
  assert.equal(proposalStatusText(ok).detail, 'Running in Refresh panel');
});

test('executor queue-bulk: per-post results, approve respects the story gate, never publishes', async () => {
  const posts = { a: { id: 'a', status: 'draft', revision: 1 }, b: { id: 'b', status: 'draft', revision: 1 }, c: { id: 'c', status: 'scheduled', revision: 2 } };
  const approved = [];
  const approvePost = async (cid, id) => {
    if (id === 'b') throw Object.assign(new Error('needs story'), { code: 'needs-story' });
    approved.push(id); return { status: 'approved' };
  };
  const ex = buildExecutors({ planStore: createMemoryPlanStore(), readPost: async (_c, id) => posts[id] || null, approvePost });
  const r = await run(ex, 'queue-bulk', { action: 'approve', postIds: ['a', 'b', 'c', 'zz'] });
  assert.equal(r.status, 'confirmed');
  assert.deepEqual(approved, ['a']);
  assert.equal(r.result.done, 1);
  assert.equal(r.result.failed, 3);
  assert.match(r.result.results.find((x) => x.postId === 'b').reason, /story/);
  const none = await run(ex, 'queue-bulk', { action: 'unschedule', postIds: ['a'] });
  assert.equal(none.status, 'failed');
});

test('executor queue-bulk: unschedule, delete-draft (reject), set-review-date', async () => {
  const posts = { s: { id: 's', status: 'scheduled', revision: 3 }, d: { id: 'd', status: 'draft', revision: 1 } };
  const edits = []; const rejected = []; const placed = [];
  const ex = buildExecutors({
    planStore: createMemoryPlanStore(), readPost: async (_c, id) => posts[id] || null,
    editPost: async (a) => { edits.push(a); return { status: 'approved' }; },
    rejectPost: async (c, id) => { rejected.push(id); return { status: 'rejected' }; },
    placeDraft: async (c, id, patch) => { placed.push([id, patch]); return true; },
  });
  assert.equal((await run(ex, 'queue-bulk', { action: 'unschedule', postIds: ['s'] })).result.done, 1);
  assert.deepEqual(edits[0], { clientId: 'c1', postId: 's', scheduledAt: '', expectedRevision: 3 });
  assert.equal((await run(ex, 'queue-bulk', { action: 'delete-draft', postIds: ['d'] })).result.done, 1);
  assert.deepEqual(rejected, ['d']);
  assert.equal((await run(ex, 'queue-bulk', { action: 'set-review-date', postIds: ['d'], date: '2026-11-02' })).result.done, 1);
  assert.deepEqual(placed[0], ['d', { reviewOn: '2026-11-02' }]);
});

test('executor bucket-edit: upsert/delete through the deps, then syncTracks', async () => {
  const log = [];
  const ex = buildExecutors({
    planStore: createMemoryPlanStore(),
    upsertBucket: async (c, b) => { log.push(['up', b]); return { bucket: { ...b, id: 'throwbacks' }, created: true }; },
    deleteBucket: async (c, id, o) => { log.push(['del', id, o]); return { deleted: id }; },
    syncTracks: async () => { log.push(['sync']); return { changed: true }; },
  });
  const up = await run(ex, 'bucket-edit', { op: 'upsert', bucket: { name: 'Throwbacks', sourceKind: 'manual' } });
  assert.deepEqual(up.result, { op: 'upsert', bucketId: 'throwbacks', created: true, tracksSynced: true });
  const del = await run(ex, 'bucket-edit', { op: 'delete', bucket: { id: 'old' }, reassignTo: 'ideas' });
  assert.equal(del.status, 'confirmed');
  assert.deepEqual(log.map((l) => l[0]), ['up', 'sync', 'del', 'sync']);
  assert.deepEqual(log[2], ['del', 'old', { reassignTo: 'ideas' }]);
  const no = await run(buildExecutors({ planStore: createMemoryPlanStore() }), 'bucket-edit', { op: 'delete', bucket: { id: 'old' } });
  assert.equal(no.status, 'failed');
});

test('tools: daily-fill uses previewDailyFill; refresh adds the estimate; queue-bulk flags story-blocked posts', async () => {
  const toolDeps = {
    previewDailyFill: async (spec) => ({ ok: true, rows: [{ date: spec.from, kind: 'quote', text: 'a quote' }, { date: spec.from, kind: 'baseline', text: 'rec', packageId: 'pk1' }], counts: { n: 2 }, skipped: [] }),
    readPost: async (id) => ({ a: { id: 'a', status: 'draft', content: '[add your memory]', updatedAt: 'u' }, b: { id: 'b', status: 'draft', content: 'ok', updatedAt: 'u' } }[id] || null),
  };
  const d = await prepareProposal('propose_daily_fill', { ...common, from: '2026-10-20', days: 3 }, { toolDeps });
  assert.equal(d.ok, true);
  assert.deepEqual(d.proposal.payload.preview.byKind, { quote: 1, baseline: 1 });
  assert.equal((await prepareProposal('propose_daily_fill', { ...common, from: '2026-10-20', days: 3 }, { toolDeps: {} })).ok, false);
  const r = await prepareProposal('propose_refresh', { ...common, groups: ['strategy-accounts', 'analysis'], reason: 'stale' }, { toolDeps });
  assert.equal(r.proposal.payload.estimate.length, 2);
  assert.equal(r.proposal.payload.estimate[0].paid, false);
  const q = await prepareProposal('propose_queue_bulk', { ...common, action: 'approve', postIds: ['a', 'b'] }, { toolDeps });
  assert.equal(q.ok, true);
  assert.equal(q.proposal.payload.rows[0].blocked, 'needs its story');
  assert.equal((await prepareProposal('propose_queue_bulk', { ...common, action: 'approve', postIds: ['a', 'nope'] }, { toolDeps })).ok, false);
  const be = await prepareProposal('propose_bucket_edit', { ...common, op: 'upsert', bucket: { name: 'X' } }, { toolDeps });
  assert.equal(be.proposal.payload.bucket.sourceKind, 'manual');
});

test('tools: refresh shows the X API estimate when the client source is x-api, static text otherwise', async () => {
  const xs = { dataSources: { strategyAccounts: 'x-api', quoteTargets: 'mac' }, estimates: { strategyAccounts: { calls: 6, maxPosts: 600 }, quoteTargets: { calls: 15, maxPosts: 300 } } };
  const r = await prepareProposal('propose_refresh', { ...common, groups: ['strategy-accounts', 'quote-targets'], reason: 'stale' }, { toolDeps: { getXDataSources: async () => xs } });
  const [a, q] = r.proposal.payload.estimate;
  assert.equal(a.paid, true);
  assert.match(a.text, /Paid X API — 6 calls, up to 600 posts/);
  assert.equal(q.paid, false);
  const none = await prepareProposal('propose_refresh', { ...common, groups: ['strategy-accounts'], reason: 'stale' }, { toolDeps: {} });
  assert.equal(none.ok, true);
});

test('ui-model: labels and previews', () => {
  assert.equal(proposalKindLabel('daily-fill'), 'Fill the calendar with drafts');
  const lines = proposalPayloadPreview('daily-fill', { from: '2026-10-20', days: 2, include: ['quotes'], preview: { total: 2, byKind: { quote: 1, baseline: 1 }, sample: [{ date: '2026-10-20', kind: 'quote', text: 'hi' }] } });
  assert.ok(lines.some((l) => l.includes('1 quote, 1 baseline')));
  assert.ok(lines.some((l) => l.startsWith('2026-10-20 · quote')));
  assert.ok(proposalPayloadPreview('refresh', { groups: ['analysis'], estimate: [{ id: 'analysis', label: 'Analysis', paid: true, text: 'Model calls' }] }).some((l) => l.includes('(paid)')));
  assert.ok(proposalPayloadPreview('queue-bulk', { action: 'approve', postIds: ['a'], rows: [{ status: 'draft', text: 't', blocked: 'needs its story' }] }).some((l) => l.includes('needs its story')));
});

test('loop: bulk kinds do not use the per-turn proposal cap', async () => {
  const toolDeps = {
    previewDailyFill: async (s) => ({ ok: true, rows: [{ date: s.from, kind: 'quote', text: 't' }], counts: {}, skipped: [] }),
    readPost: async (id) => ({ id, status: 'draft', content: 'c', updatedAt: 'u' }),
  };
  const tu = (id, name, input) => ({ type: 'tool_use', id, name, input });
  const mine = { summary: 's', rationale: 'r', evidence: [{ source: 'x', figure: '1' }] };
  const script = [
    { content: [
      tu('1', 'propose_daily_fill', { ...mine, from: '2026-10-20', days: 2 }),
      tu('2', 'propose_refresh', { ...mine, groups: ['analysis'], reason: 'r' }),
      tu('3', 'propose_queue_bulk', { ...mine, action: 'approve', postIds: ['a'] }),
      tu('4', 'propose_bucket_edit', { ...mine, op: 'upsert', bucket: { name: 'A' } }),
      tu('5', 'propose_bucket_edit', { ...mine, op: 'upsert', bucket: { name: 'B' } }),
      tu('6', 'propose_bucket_edit', { ...mine, op: 'upsert', bucket: { name: 'C' } }),
    ], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } },
    { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } },
  ];
  let i = 0;
  const agent = createAgentLoop({ callModel: async () => script[i++], toolDeps, logUsage: async () => ({ costUsd: 0 }) });
  const r = await agent.runTurn({ clientId: 'c1', threadId: 't', history: [], userText: 'fill' });
  // 3 bulk (daily-fill, refresh, queue-bulk) + 2 bucket-edit (cap 2); the third bucket-edit is refused.
  assert.deepEqual(r.proposals.map((p) => p.kind), ['daily-fill', 'refresh', 'queue-bulk', 'bucket-edit', 'bucket-edit']);
  assert.ok(BULK_PROPOSAL_KINDS.includes('refresh') && !BULK_PROPOSAL_KINDS.includes('bucket-edit'));
});
