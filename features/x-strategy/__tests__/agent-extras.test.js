// Extras: memory-suggest (editable suggested memory lines) and media-tasks ("to film" reminders).
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProposal, buildExecutors, decideProposal, assignProposal } from '../agent/proposals.js';
import { prepareProposal, PROPOSE_TOOL_BY_KIND } from '../agent/tools.js';
import { memorySuggestModel, proposalPayloadPreview, proposalStatusText, proposalKindLabel } from '../ui-model.js';
import { BULK_PROPOSAL_KINDS, PROPOSAL_KIND_ACTIONS } from '../contracts.js';
import { createMemoryPlanStore } from '../plan-store.js';
import { createStrategyHandlers } from '../route-handlers.js';
import { createMemoryCorpusStore } from '../corpus-store.js';
import { createMemoryChatStore } from '../agent/chat-store.js';
import { createRefreshService, createMemoryRefreshQueue } from '../refresh.js';

const common = { summary: 's', rationale: 'r', evidence: [{ source: 'x', figure: '1' }] };
const v = (kind, payload) => validateProposal({ kind, payload });
const rows = [
  { postId: 'p1', expectedUpdatedAt: 'u1', title: 'Tom Waits', currentText: 'Head\n\n[add your memory]', suggestion: 'Still one I come back to: Tom Waits, 1949.', source: 'facts' },
  { postId: 'p2', expectedUpdatedAt: 'u2', title: 'Other', currentText: 'Head2\n\n[add your memory]', suggestion: 'Line two.', source: 'agent' },
];

test('kinds are registered, bulk, labelled, with an action', () => {
  for (const k of ['memory-suggest', 'media-tasks']) {
    assert.ok(BULK_PROPOSAL_KINDS.includes(k));
    assert.ok(PROPOSE_TOOL_BY_KIND[k] && PROPOSAL_KIND_ACTIONS[k]);
    assert.notEqual(proposalKindLabel(k), k);
  }
  assert.equal(PROPOSE_TOOL_BY_KIND['memory-suggest'], 'propose_memory_suggestions');
  assert.equal(PROPOSE_TOOL_BY_KIND['media-tasks'], 'propose_media_tasks');
});

test('validate memory-suggest: rows needed, <=30, lines checked, deduped', () => {
  assert.equal(v('memory-suggest', { rows }).ok, true);
  assert.equal(v('memory-suggest', { rows: [] }).ok, false);
  assert.equal(v('memory-suggest', { rows: Array.from({ length: 31 }, (_, i) => ({ ...rows[0], postId: `p${i}` })) }).ok, false);
  assert.equal(v('memory-suggest', { rows: [{ ...rows[0], suggestion: 'x [add your memory]' }] }).ok, false);
  assert.equal(v('memory-suggest', { rows: [rows[0], rows[0]] }).proposal.payload.rows.length, 1);
});

test('validate media-tasks', () => {
  const ok = { rows: [{ postId: 'p1', packageId: 'k1', title: 'T', kind: 'film', dueOn: '2026-10-27', reviewOn: '2026-10-30' }] };
  assert.equal(v('media-tasks', ok).ok, true);
  assert.equal(v('media-tasks', { rows: [{ ...ok.rows[0], dueOn: 'soon' }] }).ok, false);
  assert.equal(v('media-tasks', { rows: [] }).ok, false);
});

test('propose_memory_suggestions: needs postIds or filter and the dep; drops problems, fails with none', async () => {
  const input = { ...common, postIds: ['p1', 'p2'], suggestions: { p2: 'Line two.' } };
  assert.equal((await prepareProposal('propose_memory_suggestions', input, { toolDeps: {} })).ok, false);
  assert.equal((await prepareProposal('propose_memory_suggestions', { ...common }, { toolDeps: { previewMemorySuggestions: async () => ({ ok: true, rows }) } })).ok, false);
  const seen = [];
  const deps = { previewMemorySuggestions: async (a) => { seen.push(a); return { ok: true, rows, problems: [] }; } };
  const r = await prepareProposal('propose_memory_suggestions', input, { toolDeps: deps });
  assert.equal(r.ok, true);
  assert.equal(r.proposal.kind, 'memory-suggest');
  assert.deepEqual(seen[0].suggestions, { p2: 'Line two.' });
  const none = await prepareProposal('propose_memory_suggestions', input, { toolDeps: { previewMemorySuggestions: async () => ({ ok: true, rows: [], problems: ['p1: x'] }) } });
  assert.equal(none.ok, false);
});

test('propose_media_tasks: only new tasks go on the card', async () => {
  const planned = [{ postId: 'a', title: 'A', kind: 'film', dueOn: '2026-10-27', existing: true }, { postId: 'b', title: 'B', kind: 'film', dueOn: '2026-10-28', existing: false }];
  const deps = { previewMediaTasks: async () => ({ ok: true, rows: planned, skipped: {} }) };
  const r = await prepareProposal('propose_media_tasks', { ...common, filter: { from: '2026-10-20' } }, { toolDeps: deps });
  assert.deepEqual(r.proposal.payload.rows.map((x) => x.postId), ['b']);
  const all = await prepareProposal('propose_media_tasks', { ...common, postIds: ['a'] }, { toolDeps: { previewMediaTasks: async () => ({ ok: true, rows: [planned[0]], skipped: {} }) } });
  assert.equal(all.ok, false);
});

function postsStore(seed) {
  const map = new Map(seed.map((p) => [p.id, { clientId: 'c1', revision: 1, status: 'draft', ...p }]));
  const edits = [];
  return {
    map, edits,
    readPost: async (clientId, id) => map.get(id) ?? null,
    editPost: async (a) => { edits.push(a); const cur = map.get(a.postId); const next = { ...cur, content: a.content, revision: cur.revision + 1 }; map.set(a.postId, next); return next; },
  };
}
const exec = async (executors, payload, options) => {
  const p = assignProposal({ kind: 'memory-suggest', payload: v('memory-suggest', payload).proposal.payload, ...common }, { threadId: 't' });
  return (await decideProposal({ proposal: p, decision: 'confirm', executors, clientId: 'c1', by: 'me', options })).proposal;
};

test('memory-suggest executor: owner edit wins, skip is honored, needsStory cleared, revision-checked', async () => {
  const s = postsStore([{ id: 'p1', content: 'Head\n\n[add your memory]', updatedAt: 'u1' }, { id: 'p2', content: 'Head2\n\n[add your memory]', updatedAt: 'u2' }]);
  const ex = buildExecutors({ planStore: createMemoryPlanStore(), readPost: s.readPost, editPost: s.editPost });
  const done = await exec(ex, { rows }, { edits: { p1: 'My own words.' }, skip: ['p2'] });
  assert.equal(done.status, 'confirmed');
  assert.deepEqual(done.result, { updated: 1, skipped: 1, failed: 0, results: [] });
  assert.deepEqual(s.edits, [{ clientId: 'c1', postId: 'p1', content: 'Head\n\nMy own words.', needsStory: false, expectedRevision: 1 }]);
  assert.match(proposalStatusText(done).detail, /1 draft updated, 1 skipped.*still need your approval/);
});

test('memory-suggest executor: suggestion used without an edit; stale, filled and foreign posts fail alone', async () => {
  const s = postsStore([{ id: 'p1', content: 'Head\n\n[add your memory]', updatedAt: 'CHANGED' }, { id: 'p2', content: 'Already filled', updatedAt: 'u2' }]);
  const ex = buildExecutors({ planStore: createMemoryPlanStore(), readPost: s.readPost, editPost: s.editPost });
  const failed = await exec(ex, { rows }, {});
  assert.equal(failed.status, 'failed');
  assert.equal(failed.result.results.length, 2);
  assert.deepEqual(failed.result.results.map((r) => r.error), ['stale', 'cannot-apply']);
  assert.equal(s.edits.length, 0);

  const s2 = postsStore([{ id: 'p1', content: 'Head\n\n[add your memory]', updatedAt: 'u1' }, { id: 'p2', content: 'Gone', updatedAt: 'u2', status: 'approved' }]);
  const ok = await exec(buildExecutors({ planStore: createMemoryPlanStore(), readPost: s2.readPost, editPost: s2.editPost }), { rows }, {});
  assert.equal(ok.status, 'confirmed');
  assert.equal(ok.result.updated, 1);
  assert.equal(ok.result.failed, 1);
  assert.equal(s2.edits[0].content, 'Head\n\nStill one I come back to: Tom Waits, 1949.');
});

test('media-tasks executor writes through runMediaTasks; missing dep fails clearly', async () => {
  const payload = { rows: [{ postId: 'a', packageId: 'k', title: 'T', kind: 'film', dueOn: '2026-10-27' }] };
  const run = async (executors) => {
    const p = assignProposal({ kind: 'media-tasks', payload: v('media-tasks', payload).proposal.payload, ...common }, { threadId: 't' });
    return (await decideProposal({ proposal: p, decision: 'confirm', executors, clientId: 'c1', by: 'me' })).proposal;
  };
  assert.match((await run(buildExecutors({ planStore: createMemoryPlanStore() }))).result.message, /media tasks is not available/);
  const seen = [];
  const ok = await run(buildExecutors({ planStore: createMemoryPlanStore(), runMediaTasks: async (a) => { seen.push(a); return { created: 1, existing: 0 }; } }));
  assert.equal(ok.status, 'confirmed');
  assert.equal(seen[0].rows[0].postId, 'a');
  assert.match(proposalStatusText(ok).detail, /1 reminder added/);
});

test('ui model: memorySuggestModel merges edits/skips; previews say suggestions', () => {
  const proposal = { payload: { rows } };
  const m = memorySuggestModel(proposal, { edits: { p1: 'Mine', p2: '  ' }, skip: [] });
  assert.deepEqual(m.edits, { p1: 'Mine' });
  assert.deepEqual(m.skip, ['p2']);
  assert.equal(m.active, 1);
  assert.match(proposalPayloadPreview('memory-suggest', { rows })[0], /SUGGESTIONS/);
  assert.match(proposalPayloadPreview('media-tasks', { rows: [{ dueOn: '2026-10-27', title: 'T' }] }).join('\n'), /Reminders only/);
});

test('decide route passes edits/skip (only for this proposal rows) to the executor and previews read the queue', async () => {
  const s = postsStore([{ id: 'p1', content: 'Head\n\n[add your memory]', updatedAt: 'u1', packageId: 'k1', reviewOn: '2026-10-30' }, { id: 'p2', content: 'Head2\n\n[add your memory]', updatedAt: 'u2' }]);
  const NOW = Date.parse('2026-10-17T15:00:00Z');
  const corpusStore = createMemoryCorpusStore({ loadCommitted: () => null });
  const h = createStrategyHandlers({
    corpusStore, planStore: createMemoryPlanStore(), chatStore: createMemoryChatStore({ cap: 60 }), clock: () => NOW,
    refreshService: createRefreshService({ store: corpusStore, queueStore: createMemoryRefreshQueue(), now: () => NOW, enabled: false, detectBird: async () => ({ available: false }), idGen: () => 'r1', ingest: async () => ({}) }),
    readXGrowthConfig: async () => ({ ownHandle: 'me_acct', benchmarkHandles: [] }),
    readPost: s.readPost, editPost: s.editPost,
    readQueuePosts: async () => [...s.map.values()],
    readPackages: async () => [{ id: 'k1', title: 'Tom Waits', facets: { eventDate: '1949-12-07' } }],
    listMediaTaskIds: async () => new Set(),
  });
  const deps = h.toolDepsFor('c1');
  const pre = await deps.previewMemorySuggestions({ postIds: ['p1', 'nope'], suggestions: {} });
  assert.equal(pre.rows.length, 1);
  assert.match(pre.problems.join(), /nope/);
  const tasks = await deps.previewMediaTasks({ postIds: [], filter: { from: '2026-10-20' }, kind: 'film' });
  assert.deepEqual(tasks.rows.map((r) => [r.postId, r.dueOn]), [['p1', '2026-10-27']]);

  const created = await h.createProposalInThread({ clientId: 'c1', proposals: [{ kind: 'memory-suggest', payload: { rows }, summary: 's', rationale: 'r', evidence: [] }] });
  const out = await h.handle('strategy-proposal-decide', { clientId: 'c1', threadId: created.threadId, proposalId: created.proposals[0].id, decision: 'confirm', edits: { p1: 'Mine', zzz: 'ignored' }, skip: ['p2', 'zzz'] }, { clientId: 'c1' }, { decoded: { email: 'o@example.com' } });
  assert.equal(out.proposal.status, 'confirmed');
  assert.equal(out.proposal.result.updated, 1);
  assert.equal(s.edits.length, 1);
  assert.equal(s.edits[0].content, 'Head\n\nMine');
});
