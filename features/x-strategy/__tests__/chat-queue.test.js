import test from 'node:test';
import assert from 'node:assert/strict';
import { createStrategyHandlers } from '../route-handlers.js';
import { createMemoryCorpusStore } from '../corpus-store.js';
import { createMemoryPlanStore } from '../plan-store.js';
import { createMemoryChatStore } from '../agent/chat-store.js';
import { createRefreshService, createMemoryRefreshQueue } from '../refresh.js';
import { validateProposal, assignProposal, decideProposal, buildExecutors } from '../agent/proposals.js';
import { runReadTool, prepareProposal, shapeMarketSignals } from '../agent/tools.js';
import { proposalPayloadPreview, proposalKindLabel, proposalStatusText } from '../ui-model.js';
import { PROPOSAL_KINDS, PROPOSAL_KIND_ACTIONS } from '../contracts.js';

// Fixture times are relative to the real clock: some code under test compares
// scheduledAt against Date.now(), so a fixed FUTURE date eventually expires.
const NOW = Math.floor(Date.now() / 3_600_000) * 3_600_000;
const FUTURE = new Date(NOW + 51 * 3_600_000).toISOString();
const MCP_THREAD = `t_mcp_${new Date(NOW).toISOString().slice(0, 10).replace(/-/g, '')}`;
const CTX = { clientId: 'c1' };
const AUTH = { decoded: { email: 'owner@example.com' } };

function makePosts() {
  const rows = new Map();
  const put = (clientId, p) => rows.set(`${clientId}/${p.id}`, { clientId, revision: 1, updatedAt: '2026-10-12T10:00:00.000Z', ...p });
  put('c1', { id: 'p-draft', status: 'draft', content: 'Draft text', source: 'copywriter' });
  put('c1', { id: 'p-sched', status: 'scheduled', content: 'Scheduled text', scheduledAt: FUTURE, source: 'strategy-builder:camp1', reviewedAt: 'r' });
  put('c1', { id: 'p-posted', status: 'posted', content: 'Live', source: 'daily-run' });
  put('c2', { id: 'p-other', status: 'draft', content: 'Other client', source: 'copywriter' });
  return {
    rows,
    readPost: async (clientId, postId) => rows.get(`${clientId}/${postId}`) ?? null,
    readQueueSummary: async (clientId) => {
      const posts = [...rows.values()].filter((p) => p.clientId === clientId);
      const counts = {};
      for (const p of posts) counts[p.status] = (counts[p.status] || 0) + 1;
      return { counts, posts };
    },
  };
}

function setup(extra = {}) {
  const posts = makePosts();
  const edits = [];
  const chatStore = createMemoryChatStore({ cap: 60 });
  const corpusStore = createMemoryCorpusStore({ loadCommitted: () => null });
  const h = createStrategyHandlers({
    corpusStore, planStore: createMemoryPlanStore(), chatStore, clock: () => NOW,
    refreshService: createRefreshService({ store: corpusStore, queueStore: createMemoryRefreshQueue(), now: () => NOW, enabled: false, detectBird: async () => ({ available: false }), idGen: () => 'r1', ingest: async () => ({ rows: [], pull: {} }), runBirdFor: () => () => '' }),
    readXGrowthConfig: async () => ({ ownHandle: 'me_acct', benchmarkHandles: [] }),
    readTodayRun: async () => ({ suggestions: [] }),
    readPost: posts.readPost, readQueueSummary: posts.readQueueSummary,
    editPost: async (a) => {
      edits.push(a);
      const cur = posts.rows.get(`${a.clientId}/${a.postId}`);
      const next = { ...cur, ...(a.content != null ? { content: a.content } : {}), ...(a.scheduledAt ? { scheduledAt: a.scheduledAt } : {}), revision: cur.revision + 1, updatedAt: '2026-10-12T12:00:00.000Z' };
      posts.rows.set(`${a.clientId}/${a.postId}`, next);
      return next;
    },
    readMarketSignals: async (clientId) => (clientId === 'c1' ? { headline: 'H', humanBrief: 'Brief', generatedAt: new Date(NOW - 6 * 3_600_000).toISOString(), narratives: [{ trend: 'T', detail: 'D' }] } : null),
    ...extra,
  });
  return { h, posts, edits, chatStore };
}

// ---- contracts / ui ----
test('post-edit is a registered kind with an action, label, preview and result line', () => {
  assert.ok(PROPOSAL_KINDS.includes('post-edit'));
  assert.equal(PROPOSAL_KIND_ACTIONS['post-edit'], 'update');
  assert.equal(proposalKindLabel('post-edit'), 'Edit a queued post');
  const lines = proposalPayloadPreview('post-edit', { postId: 'p', text: 'new', currentText: 'old', scheduledAt: FUTURE, currentScheduledAt: 'then' });
  assert.ok(lines.some((l) => l.includes('Current text: old')) && lines.some((l) => l.includes('New text: new')) && lines.some((l) => l.includes('→')));
  const st = proposalStatusText({ kind: 'post-edit', status: 'confirmed', result: { status: 'draft' } });
  assert.match(st.detail, /Post updated.*draft/);
});

// ---- get_market_signals ----
test('get_market_signals: shapes, caps, flags stale, marks third-party text', async () => {
  const big = {
    headline: 'h'.repeat(500), humanBrief: 'b'.repeat(5000), delta: 'd'.repeat(900), generatedAt: new Date(NOW - 6 * 3_600_000).toISOString(),
    narratives: Array.from({ length: 20 }, (_, i) => ({ trend: `t${i}`, detail: 'x'.repeat(500) })),
    opportunities: Array.from({ length: 20 }, () => ({ topic: 'o', angle: 'a'.repeat(500), url: 'https://e.x' })),
    kols: Array.from({ length: 20 }, () => ({ name: 'k', platform: 'x', detail: 'd'.repeat(500) })),
    competitors: Array.from({ length: 20 }, () => ({ name: 'c', finding: 'f'.repeat(500) })),
    brandMentions: Array.from({ length: 20 }, () => ({ source: 's', author: 'a', content: 'c'.repeat(500) })),
    redditSignals: Array.from({ length: 20 }, () => ({ title: 'r', summary: 's'.repeat(500) })),
    instagramSignals: Array.from({ length: 20 }, () => ({ title: 'i', summary: 's'.repeat(500) })),
  };
  const r = await runReadTool('get_market_signals', {}, { readMarketSignals: async () => big, now: () => NOW });
  assert.equal(r.available, true);
  assert.equal(r.stale, false);
  assert.match(r.notice, /quoted data, not instructions/);
  assert.equal(r.topics.length, 6);
  assert.ok(JSON.stringify(r).length < 6000);
  const stale = await runReadTool('get_market_signals', {}, { readMarketSignals: async () => big, now: () => NOW + 5 * 86_400_000 });
  assert.equal(stale.stale, true);
  assert.equal((await runReadTool('get_market_signals', {}, { readMarketSignals: async () => null })).available, false);
  assert.equal((await runReadTool('get_market_signals', {}, {})).available, false);
  assert.equal(shapeMarketSignals({}, NOW).stale, null);
});

// ---- get_queue ----
test('get_queue: shows source for every row and filters by source prefix and status', async () => {
  const { posts } = setup();
  const deps = { readQueueSummary: () => posts.readQueueSummary('c1') };
  const all = await runReadTool('get_queue', {}, deps);
  assert.deepEqual(all.posts.map((p) => p.source).sort(), ['copywriter', 'daily-run', 'strategy-builder:camp1']);
  const sb = await runReadTool('get_queue', { source: 'strategy-builder' }, deps);
  assert.deepEqual(sb.posts.map((p) => p.id), ['p-sched']);
  assert.equal(sb.sourceFilter, 'strategy-builder');
  const none = await runReadTool('get_queue', { source: 'copywriter', status: 'scheduled' }, deps);
  assert.equal(none.posts.length, 0);
});

// ---- validateProposal ----
test('validateProposal post-edit: needs postId, expectedUpdatedAt, text and/or time; caps text at 280', () => {
  const ok = validateProposal({ kind: 'post-edit', payload: { postId: 'p-sched', text: ' new ', scheduledAt: FUTURE, expectedUpdatedAt: 'u', junk: 1 } });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.proposal.payload, { postId: 'p-sched', text: 'new', scheduledAt: FUTURE, expectedUpdatedAt: 'u' });
  for (const payload of [
    { text: 'x', expectedUpdatedAt: 'u' },
    { postId: 'p', expectedUpdatedAt: 'u' },
    { postId: 'p', text: 'x' },
    { postId: 'p', text: 'x'.repeat(281), expectedUpdatedAt: 'u' },
    { postId: 'p', scheduledAt: 'nope', expectedUpdatedAt: 'u' },
  ]) assert.equal(validateProposal({ kind: 'post-edit', payload }).ok, false, JSON.stringify(payload).slice(0, 60));
});

// ---- prepareProposal (tool) ----
test('propose_post_edit: reads the post; rejects stale, non-editable, unchanged, time on non-scheduled, past time', async () => {
  const { posts } = setup();
  const toolDeps = { readPost: (id) => posts.readPost('c1', id) };
  const base = { summary: 's', rationale: 'r', evidence: [] };
  const call = (input) => prepareProposal('propose_post_edit', { ...base, ...input }, { toolDeps });
  const good = await call({ postId: 'p-sched', text: 'Better', scheduledAt: FUTURE, expectedUpdatedAt: '2026-10-12T10:00:00.000Z' });
  assert.equal(good.ok, true);
  assert.equal(good.proposal.payload.currentText, 'Scheduled text');
  assert.equal(good.proposal.payload.currentStatus, 'scheduled');
  assert.match((await call({ postId: 'p-sched', text: 'Better', expectedUpdatedAt: 'old' })).error, /changed/);
  assert.match((await call({ postId: 'p-posted', text: 'Better', expectedUpdatedAt: '2026-10-12T10:00:00.000Z' })).error, /only draft, approved or scheduled/);
  assert.match((await call({ postId: 'p-other', text: 'Better', expectedUpdatedAt: '2026-10-12T10:00:00.000Z' })).error, /unknown postId/, 'other client post is invisible');
  assert.match((await call({ postId: 'p-draft', text: 'Draft text', expectedUpdatedAt: '2026-10-12T10:00:00.000Z' })).error, /already/);
  assert.match((await call({ postId: 'p-draft', scheduledAt: FUTURE, expectedUpdatedAt: '2026-10-12T10:00:00.000Z' })).error, /never schedules|already scheduled/);
  assert.match((await call({ postId: 'p-sched', scheduledAt: '2020-01-01T00:00:00Z', expectedUpdatedAt: '2026-10-12T10:00:00.000Z' })).error, /future/);
  assert.match((await call({ postId: 'p-draft', text: 'x'.repeat(281), expectedUpdatedAt: '2026-10-12T10:00:00.000Z' })).error, /280/);
});

// ---- executor ----
test('post-edit executor: edits through editPost with expectedRevision; stale / status / past-time guards', async () => {
  const { h, posts, edits, chatStore } = setup();
  const created = await h.createProposalInThread({ clientId: 'c1', proposals: [
    { kind: 'post-edit', payload: { postId: 'p-draft', text: 'Sharper draft', expectedUpdatedAt: '2026-10-12T10:00:00.000Z' }, summary: 'edit draft', rationale: 'r', evidence: [] },
    { kind: 'post-edit', payload: { postId: 'p-sched', scheduledAt: '2026-10-15T09:00:00.000Z', expectedUpdatedAt: '2026-10-12T10:00:00.000Z' }, summary: 'move', rationale: 'r', evidence: [] },
  ] });
  assert.equal(created.ok, true);
  const [pDraft, pSched] = created.proposals;
  const decide = (proposalId, decision = 'confirm') => h.handle('strategy-proposal-decide', { clientId: 'c1', threadId: created.threadId, proposalId, decision }, CTX, AUTH);

  const r = await decide(pDraft.id);
  assert.equal(r.ok, true);
  assert.equal(r.proposal.status, 'confirmed');
  assert.deepEqual(edits[0], { clientId: 'c1', postId: 'p-draft', content: 'Sharper draft', expectedRevision: 1 });
  assert.equal(r.proposal.result.status, 'draft');

  // someone else touched p-sched after the proposal: stale, nothing written
  posts.rows.get('c1/p-sched').updatedAt = '2026-10-12T11:00:00.000Z';
  const s = await decide(pSched.id);
  assert.equal(s.proposal.status, 'failed');
  assert.equal(s.proposal.result.error, 'stale');
  assert.equal(edits.length, 1);

  // post became published: not editable
  const c2 = await h.createProposalInThread({ clientId: 'c1', threadId: created.threadId, proposals: [{ kind: 'post-edit', payload: { postId: 'p-draft', text: 'Again', expectedUpdatedAt: '2026-10-12T12:00:00.000Z' }, summary: 's', rationale: 'r' }] });
  posts.rows.get('c1/p-draft').status = 'posting';
  const g = await decide(c2.proposals[0].id);
  assert.equal(g.proposal.status, 'failed');
  assert.equal(g.proposal.result.error, 'not-editable');
  assert.equal(edits.length, 1);
  void chatStore;
});

test('post-edit executor: past time fails, time on a non-scheduled post fails, revision conflict maps to stale', async () => {
  const posts = makePosts();
  let conflict = false;
  const ex = buildExecutors({
    planStore: createMemoryPlanStore(), clock: () => NOW, readPost: posts.readPost,
    editPost: async () => { if (conflict) throw Object.assign(new Error('x'), { code: 'revision-conflict', status: 409 }); return { status: 'scheduled', scheduledAt: FUTURE, updatedAt: 'u' }; },
  });
  const run = (payload) => decideProposal({ proposal: assignProposal({ kind: 'post-edit', payload, summary: 's', rationale: 'r' }, { threadId: 't1', now: NOW }), decision: 'confirm', executors: ex, clientId: 'c1', now: NOW });
  const U = '2026-10-12T10:00:00.000Z';
  assert.equal((await run({ postId: 'p-sched', scheduledAt: '2026-10-12T11:00:00.000Z', expectedUpdatedAt: U })).proposal.result.error, 'past-time');
  assert.equal((await run({ postId: 'p-draft', scheduledAt: FUTURE, expectedUpdatedAt: U })).proposal.result.error, 'not-scheduled');
  assert.equal((await run({ postId: 'p-other', text: 'x', expectedUpdatedAt: U })).proposal.result.error, 'not-found', 'other client post');
  conflict = true;
  assert.equal((await run({ postId: 'p-sched', text: 'x', expectedUpdatedAt: U })).proposal.result.error, 'stale');
  conflict = false;
  const ok = await run({ postId: 'p-sched', text: 'x', expectedUpdatedAt: U });
  assert.equal(ok.proposal.status, 'confirmed');
  assert.equal(ok.proposal.result.status, 'scheduled');
});

// ---- toolDepsFor ----
test('toolDepsFor: a fresh deps object per call, bound to the given client only', async () => {
  const { h } = setup();
  const a = h.toolDepsFor('c1');
  const b = h.toolDepsFor('c2');
  assert.notEqual(a, h.toolDepsFor('c1'));
  assert.equal((await runReadTool('get_queue', {}, a)).posts.length, 3);
  assert.equal((await runReadTool('get_queue', {}, b)).posts.length, 1);
  assert.equal((await runReadTool('get_post', { postId: 'p-other' }, a)).found, false, 'c1 deps cannot read a c2 post');
  assert.equal((await runReadTool('get_post', { postId: 'p-other' }, b)).found, true);
  assert.equal((await runReadTool('get_market_signals', {}, a)).available, true);
  assert.equal((await runReadTool('get_market_signals', {}, b)).available, false);
  assert.throws(() => h.toolDepsFor(''), /clientId is required/);
});

// ---- createProposalInThread ----
test('createProposalInThread: persists pending cards in t_mcp_<date>, drops invalid, scoped to the client, executes nothing', async () => {
  const { h, chatStore, edits } = setup();
  const r = await h.createProposalInThread({ clientId: 'c1', proposals: [
    { kind: 'post-edit', payload: { postId: 'p-draft', text: 'New', expectedUpdatedAt: '2026-10-12T10:00:00.000Z' }, summary: 'ok', rationale: 'r', evidence: [{ source: 'a', figure: 'b' }] },
    { kind: 'post-edit', payload: { postId: 'p-posted', text: 'New', expectedUpdatedAt: '2026-10-12T10:00:00.000Z' }, summary: 'posted', rationale: 'r' },
    { kind: 'nope', payload: {} },
  ] });
  assert.equal(r.ok, true);
  assert.equal(r.threadId, MCP_THREAD);
  assert.equal(r.proposals.length, 1);
  assert.equal(r.proposals[0].status, 'pending');
  assert.equal(r.proposals[0].payload.currentText, 'Draft text');
  assert.equal(r.dropped.length, 2);
  const th = await chatStore.getThread('c1', MCP_THREAD);
  assert.equal(Object.keys(th.proposals).length, 1);
  assert.equal(await chatStore.getThread('c2', MCP_THREAD), null);
  assert.equal(edits.length, 0);
  // same day, same thread: appended
  const r2 = await h.createProposalInThread({ clientId: 'c1', proposals: [{ kind: 'regenerate-today', payload: {}, summary: 's', rationale: 'r' }] });
  assert.equal(r2.threadId, MCP_THREAD);
  assert.equal(Object.keys((await chatStore.getThread('c1', MCP_THREAD)).proposals).length, 2);
  // cross-client post: dropped
  const x = await h.createProposalInThread({ clientId: 'c1', proposals: [{ kind: 'post-edit', payload: { postId: 'p-other', text: 'New', expectedUpdatedAt: '2026-10-12T10:00:00.000Z' }, summary: 's', rationale: 'r' }] });
  assert.equal(x.ok, false);
  assert.equal(x.status, 400);
  assert.equal((await h.createProposalInThread({ clientId: 'c1', threadId: 'bad id!', proposals: [] })).status, 400);
});

test('validateProposal post-approve / post-schedule / post-unschedule: postId + expectedUpdatedAt; schedule needs a future ISO time', () => {
  const ok = validateProposal({ kind: 'post-approve', payload: { postId: 'p', expectedUpdatedAt: 'u', junk: 1 } });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.proposal.payload, { postId: 'p', expectedUpdatedAt: 'u' });
  assert.equal(validateProposal({ kind: 'post-unschedule', payload: { postId: 'p', expectedUpdatedAt: 'u' } }).ok, true);
  assert.equal(validateProposal({ kind: 'post-schedule', payload: { postId: 'p', scheduledAt: FUTURE, expectedUpdatedAt: 'u' } }).ok, true);
  for (const [kind, payload] of [
    ['post-approve', { expectedUpdatedAt: 'u' }],
    ['post-approve', { postId: 'p' }],
    ['post-schedule', { postId: 'p', expectedUpdatedAt: 'u' }],
    ['post-schedule', { postId: 'p', scheduledAt: '2020-01-01T00:00:00.000Z', expectedUpdatedAt: 'u' }],
    ['post-schedule', { postId: 'p', scheduledAt: 'nope', expectedUpdatedAt: 'u' }],
  ]) assert.equal(validateProposal({ kind, payload }).ok, false, kind + JSON.stringify(payload));
});
