// Strategy document x agent: REAL loop + tools + proposals + chat/doc/plan stores (memory), scripted model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStrategyHandlers, REVIEW_DISPLAY_TEXT, buildReviewBrief } from '../route-handlers.js';
import { createMemoryCorpusStore } from '../corpus-store.js';
import { createMemoryPlanStore } from '../plan-store.js';
import { createRefreshService, createMemoryRefreshQueue } from '../refresh.js';
import { createMemoryChatStore } from '../agent/chat-store.js';
import { createMemoryStrategyDocStore } from '../strategy-doc-store.js';
import { SEED_STRATEGY_SECTIONS } from '../strategy-doc-seed.js';
import { validateProposal } from '../agent/proposals.js';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const CTX = { clientId: 'c1' };
const AUTH = { decoded: { email: 'owner@x.test' } };
const usage = { input_tokens: 10, output_tokens: 5 };
const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage });
const useTools = (...calls) => ({ content: calls.map(([name, input], i) => ({ type: 'tool_use', id: `tu_${name}_${i}`, name, input })), stop_reason: 'tool_use', usage });
function scripted(steps) {
  const requests = [];
  return {
    requests,
    callModel: async (req) => {
      requests.push(JSON.parse(JSON.stringify(req)));
      const step = steps[requests.length - 1];
      if (!step) throw new Error(`unscripted model call #${requests.length}`);
      return typeof step === 'function' ? step(req) : step;
    },
  };
}
const toolResults = (req) => req.messages[req.messages.length - 1].content.filter((b) => b.type === 'tool_result');

const row = (i, over = {}) => ({
  id: String(i), utc: new Date(NOW - (i + 1) * 3600000 * 6).toISOString(), type: i % 2 ? 'original-showcase' : 'quote-react',
  media: i % 2 ? 'video' : 'none', text: i % 4 === 1 ? `shipped a new build #design ${i}` : `post ${i} about the work`, likes: i % 5, views: 100 + i * 10, ...over,
});

async function build({ steps, withDoc = true, audience } = {}) {
  const corpusStore = createMemoryCorpusStore({ loadCommitted: () => null });
  await corpusStore.writeMergedRows('me_acct', Array.from({ length: 30 }, (_, i) => row(i)), { pulledAt: '2026-10-11T12:00:00.000Z' });
  await corpusStore.writeMergedRows('bench_a', Array.from({ length: 30 }, (_, i) => row(i + 100)), { pulledAt: '2026-10-12T08:00:00.000Z' });
  const docStore = withDoc ? createMemoryStrategyDocStore() : null;
  const model = scripted(steps || []);
  const h = createStrategyHandlers({
    corpusStore, planStore: createMemoryPlanStore(), chatStore: createMemoryChatStore({ cap: 60 }), docStore, clock: () => NOW,
    refreshService: createRefreshService({ store: corpusStore, queueStore: createMemoryRefreshQueue(), now: () => NOW, enabled: false, detectBird: async () => ({ available: false }), idGen: () => 'r1', ingest: async () => ({ rows: [], pull: {} }), runBirdFor: () => () => '' }),
    readXGrowthConfig: async () => ({ ownHandle: 'me_acct', benchmarkHandles: ['bench_a'] }),
    callModel: model.callModel, logUsage: async () => ({ costUsd: 0.001 }),
    ...(audience ? { readAudience: async () => audience } : {}),
  });
  return { h, docStore, model, call: (a, b = {}) => h.handle(a, { clientId: 'c1', ...b }, CTX, AUTH) };
}

test('the system prompt carries the strategy document (draft-labelled) and its rules', async () => {
  const { call, model } = await build({ steps: [say('ok')] });
  const r = await call('strategy-chat-send', { text: 'what is my strategy?' });
  assert.equal(r.ok, true);
  const sys = model.requests[0].system;
  assert.match(sys, /THE STRATEGY DOCUMENT/);
  assert.match(sys, /STRATEGY DOCUMENT \(DRAFT/);
  assert.match(sys, /Show the work, not the casino/);
  assert.match(sys, /propose_strategy_doc_edit/);
});

test('chat proposes a section edit; confirm writes the doc as source chat without confirming the draft', async () => {
  const { call, docStore, model } = await build({
    steps: [
      useTools(['get_strategy_doc', {}]),
      (req) => {
        const doc = JSON.parse(toolResults(req)[0].content);
        assert.equal(doc.version, 0);
        assert.equal(doc.confirmed, false);
        assert.equal(doc.sections.rules, SEED_STRATEGY_SECTIONS.rules);
        return useTools(['propose_strategy_doc_edit', { section: 'rules', text: '- No hashtags.\n- Video over image.', expectedVersion: 0, summary: 'Tighten rules', rationale: 'Owner asked for two rules only.', evidence: [] }]);
      },
      say("I've put a proposal card up; confirm it to apply."),
    ],
  });
  const sent = await call('strategy-chat-send', { text: 'cut my rules down to two' });
  assert.equal(sent.proposals.length, 1);
  const p = sent.proposals[0];
  assert.equal(p.kind, 'strategy-doc-edit');
  assert.deepEqual(p.payload, { section: 'rules', text: '- No hashtags.\n- Video over image.', expectedVersion: 0 });
  assert.equal(await docStore.get('c1'), null, 'proposing writes nothing');

  const d = await call('strategy-proposal-decide', { threadId: sent.threadId, proposalId: p.id, decision: 'confirm' });
  assert.equal(d.ok, true);
  assert.equal(d.proposal.status, 'confirmed');
  assert.equal(d.proposal.result.version, 1);
  const doc = await docStore.get('c1');
  assert.equal(doc.sections.rules, '- No hashtags.\n- Video over image.');
  assert.equal(doc.sections.thesis, SEED_STRATEGY_SECTIONS.thesis, 'other drafted sections kept');
  assert.equal(doc.confirmed, false, 'a chat edit never confirms the draft');
  assert.equal(doc.history[0].source, 'chat');
  assert.equal(doc.history[0].proposalId, p.id);
  assert.equal(d.strategyDoc.version, 1);
  assert.equal(model.requests.length, 3);
});

test('a doc-edit proposal goes stale when the owner edits the doc first', async () => {
  const { call } = await build({
    steps: [useTools(['propose_strategy_doc_edit', { section: 'open', text: 'Which music benchmark?', expectedVersion: 0, summary: 's', rationale: 'r', evidence: [] }]), say('card up')],
  });
  const sent = await call('strategy-chat-send', { text: 'add an open question' });
  await call('strategy-doc-save', { sections: { open: 'mine' }, expectedVersion: 0 });
  const d = await call('strategy-proposal-decide', { threadId: sent.threadId, proposalId: sent.proposals[0].id, decision: 'confirm' });
  assert.equal(d.proposal.status, 'failed');
  assert.equal(d.proposal.result.error, 'stale');
  assert.equal(d.proposal.result.currentVersion, 1);
});

test('propose_strategy_doc_edit rejects bad sections, wrong versions and no-op text', async () => {
  const { call, model } = await build({
    steps: [
      useTools(
        ['propose_strategy_doc_edit', { section: 'vibes', text: 'x', expectedVersion: 0, summary: 's', rationale: 'r', evidence: [] }],
        ['propose_strategy_doc_edit', { section: 'rules', text: 'x', expectedVersion: 3, summary: 's', rationale: 'r', evidence: [] }],
      ),
      (req) => {
        const [a, b] = toolResults(req);
        assert.match(a.content, /section must be one of/);
        assert.match(b.content, /version 0, not 3/);
        return useTools(['propose_strategy_doc_edit', { section: 'thesis', text: SEED_STRATEGY_SECTIONS.thesis, expectedVersion: 0, summary: 's', rationale: 'r', evidence: [] }]);
      },
      (req) => { assert.match(toolResults(req)[0].content, /already the current section/); return say('nothing to change'); },
    ],
  });
  const r = await call('strategy-chat-send', { text: 'edit' });
  assert.equal(r.proposals.length, 0);
  assert.equal(model.requests.length, 3);
});

test('validateProposal: strategy-doc-edit shape', () => {
  assert.equal(validateProposal({ kind: 'strategy-doc-edit', payload: { section: 'rules', text: ' a ', expectedVersion: 2 } }).proposal.payload.text, 'a');
  assert.equal(validateProposal({ kind: 'strategy-doc-edit', payload: { section: 'nope', text: 'a', expectedVersion: 0 } }).ok, false);
  assert.equal(validateProposal({ kind: 'strategy-doc-edit', payload: { section: 'rules', text: 'a', expectedVersion: -1 } }).ok, false);
});

test('algorithm, score, rule-check and audience tools return shaped data', async () => {
  const audience = {
    account: { profile: { username: 'me_acct', followers: 1726 }, sync: { postsAt: NOW - 3600000 } },
    snapshots: [{ date: '2026-09-11', followers: 1700 }, { date: '2026-10-11', followers: 1726 }],
    events: [{ type: 'gained' }, { type: 'gained' }, { type: 'lost' }],
    posts: [{ id: 'p1', createdAt: new Date(NOW - 86400000).toISOString(), text: 'hello', metrics: { impressions: 300, likes: 2 } }],
  };
  const { call } = await build({
    audience,
    steps: [
      useTools(['get_algorithm', {}], ['score_posts', {}], ['get_rule_check', { days: 30 }], ['get_audience', {}], ['score_posts', { handle: 'stranger' }]),
      (req) => {
        const [algo, scored, rules, aud, stranger] = toolResults(req).map((r) => JSON.parse(r.content));
        assert.equal(algo.profileId, 'x-2026-10-03');
        assert.ok(algo.positive.some((x) => x.signal === 'reply' && x.weight === 5));
        assert.ok(algo.negative.some((x) => x.signal === 'report'));
        assert.equal(scored.handle, 'me_acct');
        assert.ok(scored.originalsScored > 0);
        assert.ok(scored.skipped > 0, 'quote-reacts skipped');
        assert.ok(scored.best.every((b) => b.type !== 'quote-react'));
        assert.ok(rules.authored > 0);
        assert.ok(rules.flagCounts['mech-hashtag'] > 0);
        assert.equal(aud.followerTrend.change, 26);
        assert.deepEqual(aud.audienceEvents, { gained: 2, lost: 1, total: 3 });
        assert.equal(aud.impressions.median, 300);
        assert.match(stranger.error, /own or a benchmark/);
        return say('done');
      },
    ],
  });
  assert.equal((await call('strategy-chat-send', { text: 'read it all' })).ok, true);
});

test('get_audience without X Monitor data says so instead of inventing numbers', async () => {
  const { call } = await build({
    steps: [useTools(['get_audience', {}]), (req) => { assert.match(toolResults(req)[0].content, /not available/); return say('no audience data'); }],
  });
  assert.equal((await call('strategy-chat-send', { text: 'audience?' })).ok, true);
});

test('strategy-review: stores a short line, sends the brief with a bigger budget, stamps lastReview', async () => {
  const { call, docStore, model } = await build({ steps: [(req) => { assert.equal(req.maxTokens, 2500); return say('Review: rules hold.'); }] });
  await call('strategy-doc-save', { sections: { thesis: 'Show the work.' }, expectedVersion: 0 });
  const r = await call('strategy-review');
  assert.equal(r.ok, true);
  assert.equal(r.text, 'Review: rules hold.');
  const sent = model.requests[0].messages.at(-1).content;
  assert.match(sent, /STRATEGY REVIEW/);
  assert.doesNotMatch(sent, /still a DRAFT/, 'confirmed doc');
  const hist = await call('strategy-chat-history', { threadId: r.threadId });
  assert.equal(hist.thread.messages[0].text, REVIEW_DISPLAY_TEXT);
  const doc = await docStore.get('c1');
  assert.equal(doc.version, 1, 'a review is not a content change');
  assert.equal(doc.lastReview.threadId, r.threadId);
  assert.equal(doc.lastReview.docVersion, 1);
  assert.equal(doc.lastReview.dataAsOf, '2026-10-12T08:00:00.000Z');
  assert.deepEqual(r.lastReview, doc.lastReview);
});

test('review brief flags a draft document', () => {
  assert.match(buildReviewBrief({ confirmed: false }), /still a DRAFT/);
  assert.doesNotMatch(buildReviewBrief({ confirmed: true }), /DRAFT/);
});
