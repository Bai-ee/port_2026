// Coaching cards: propose_self_reply (validate / prepare / execute with in-memory deps) and the pass / move cards the
// bot reuses (propose_calendar_decide, propose_queue_bulk, propose_post_edit). Nothing here touches a real store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProposal, buildExecutors, decideProposal, assignProposal } from '../agent/proposals.js';
import { prepareProposal, PROPOSE_TOOL_BY_KIND, PROPOSE_TOOLS, TOOL_SCHEMAS } from '../agent/tools.js';
import { proposalPayloadPreview, proposalKindLabel } from '../ui-model.js';
import { PROPOSAL_KINDS, BULK_PROPOSAL_KINDS } from '../contracts.js';
import { createMemoryPlanStore } from '../plan-store.js';
import { strategyTools } from '../../mcp/tools/strategy.js';

const URL_OK = 'https://x.com/me_acct/status/2112185345882141082';
const common = { summary: 'Reply under the quote that took off', rationale: 'Within the hour', evidence: [{ source: 'get_recent_posts', figure: 'outlier quote' }] };
const toolDeps = (over = {}) => ({
  getProfileHandles: async () => ['me_acct', 'bench_a'],
  readItemFull: async (id) => (id === 'vid1' ? { item: { id, title: 'Shipped a build', assetRefs: ['ev:clips/clip.mp4'] } } : id === 'txt1' ? { item: { id, title: 'No media', assetRefs: [] } } : null),
  ...over,
});
const prep = (input, deps = toolDeps()) => prepareProposal('propose_self_reply', { summary: 's', rationale: 'r', evidence: [], ...input }, { toolDeps: deps });

test('propose_self_reply is a registered single-item card, over chat and MCP', () => {
  assert.equal(PROPOSE_TOOL_BY_KIND['self-reply'], 'propose_self_reply');
  assert.ok(PROPOSAL_KINDS.includes('self-reply'));
  assert.ok(!BULK_PROPOSAL_KINDS.includes('self-reply'), 'counts toward the per-turn single-item cap');
  assert.ok(PROPOSE_TOOLS.some((t) => t.name === 'propose_self_reply'));
  assert.ok(strategyTools.some((t) => t.name === 'strategy_propose_self_reply'));
  assert.ok(!('clientId' in TOOL_SCHEMAS.find((t) => t.name === 'propose_self_reply').input_schema.properties));
  assert.equal(proposalKindLabel('self-reply'), 'Reply under your own post');
});

test('propose_calendar_decide (pass) is available to the chat agent and over MCP', () => {
  assert.equal(PROPOSE_TOOL_BY_KIND['calendar-decide'], 'propose_calendar_decide');
  assert.ok(TOOL_SCHEMAS.some((t) => t.name === 'propose_calendar_decide'));
  assert.ok(strategyTools.some((t) => t.name === 'strategy_propose_calendar_decide'));
  for (const kind of ['queue-bulk', 'post-edit', 'post-schedule']) assert.ok(PROPOSE_TOOL_BY_KIND[kind], kind);
});

test('prepare: valid own-post url + item with media builds the payload', async () => {
  const r = await prep({ tweetUrl: URL_OK, itemId: 'vid1', text: 'Here is how it was made.' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.proposal.payload, {
    tweetUrl: URL_OK, tweetId: '2112185345882141082', ownerHandle: 'me_acct', text: 'Here is how it was made.', itemId: 'vid1', itemTitle: 'Shipped a build', mediaKind: 'video',
  });
});

test('prepare refuses: someone else\'s post, no media, unknown item, placeholder, too long, bad url', async () => {
  const bad = async (input, re) => { const r = await prep(input); assert.equal(r.ok, false, JSON.stringify(input)); assert.match(r.error, re); };
  await bad({ tweetUrl: 'https://x.com/_darshi/status/2112068761176121674', itemId: 'vid1', text: 'hi' }, /OWN post/);
  await bad({ tweetUrl: URL_OK, itemId: 'txt1', text: 'hi' }, /no usable video or image/);
  await bad({ tweetUrl: URL_OK, itemId: 'nope', text: 'hi' }, /unknown item/);
  await bad({ tweetUrl: URL_OK, itemId: 'vid1', text: 'Memory: [add your memory]' }, /placeholder/);
  await bad({ tweetUrl: URL_OK, itemId: 'vid1', text: 'x'.repeat(281) }, /at most 280/);
  await bad({ tweetUrl: 'not a url', itemId: 'vid1', text: 'hi' }, /x\.com status URL/);
  const noDeps = await prepareProposal('propose_self_reply', { summary: 's', rationale: 'r', evidence: [], tweetUrl: URL_OK, itemId: 'vid1', text: 'hi' }, { toolDeps: {} });
  assert.equal(noDeps.ok, false);
});

test('validate: only an https x.com status url, text up to 280, itemId required', () => {
  const v = (p) => validateProposal({ kind: 'self-reply', payload: p, ...common });
  assert.equal(v({ tweetUrl: URL_OK, text: 'ok', itemId: 'vid1' }).ok, true);
  assert.equal(v({ tweetUrl: 'http://x.com/me/status/1', text: 'ok', itemId: 'a' }).ok, false);
  assert.equal(v({ tweetUrl: URL_OK, text: '', itemId: 'a' }).ok, false);
  assert.equal(v({ tweetUrl: URL_OK, text: 'ok' }).ok, false);
  assert.equal(v({ tweetUrl: URL_OK, text: 'x'.repeat(281), itemId: 'a' }).ok, false);
});

const confirm = async (executors, payload) => {
  const p = assignProposal({ kind: 'self-reply', payload: validateProposal({ kind: 'self-reply', payload, ...common }).proposal.payload, ...common }, { threadId: 't' });
  return (await decideProposal({ proposal: p, decision: 'confirm', executors, clientId: 'c1', by: 'me' })).proposal;
};
const payload = { tweetUrl: URL_OK, tweetId: '2112185345882141082', ownerHandle: 'me_acct', text: 'Made like this.', itemId: 'vid1', itemTitle: 'Shipped a build', mediaKind: 'video' };

test('proposing writes nothing; confirm calls only the injected draft creator, once, with the payload', async () => {
  const calls = [];
  const ex = buildExecutors({ planStore: createMemoryPlanStore(), runSelfReply: async (a) => { calls.push(a); return { ok: true, postId: 'social_1', existing: false, status: 'draft' }; } });
  const proposed = await prep({ tweetUrl: URL_OK, itemId: 'vid1', text: 'Made like this.' });
  assert.equal(proposed.ok, true);
  assert.equal(calls.length, 0, 'prepare/propose never runs the executor');
  const done = await confirm(ex, payload);
  assert.equal(done.status, 'confirmed');
  assert.equal(done.result.postId, 'social_1');
  assert.equal(done.result.status, 'draft');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].clientId, 'c1');
  assert.equal(calls[0].payload.tweetId, '2112185345882141082');
});

test('executor failures are recorded, not thrown; no executor means a clear failure', async () => {
  const refused = await confirm(buildExecutors({ planStore: createMemoryPlanStore(), runSelfReply: async () => ({ ok: false, error: 'that item has no media' }) }), payload);
  assert.equal(refused.status, 'failed');
  const missing = await confirm(buildExecutors({ planStore: createMemoryPlanStore() }), payload);
  assert.equal(missing.status, 'failed');
});

test('card preview says it is a draft only', () => {
  const lines = proposalPayloadPreview('self-reply', payload);
  assert.ok(lines.some((l) => /DRAFT reply only/.test(l)));
  assert.ok(lines.some((l) => l.includes(URL_OK)));
});

// ---- end to end through the real handlers (memory stores, scripted model): propose -> confirm -> one reply draft ----

import { createStrategyHandlers } from '../route-handlers.js';
import { createMemoryCorpusStore } from '../corpus-store.js';
import { createRefreshService, createMemoryRefreshQueue } from '../refresh.js';
import { createMemoryChatStore } from '../agent/chat-store.js';

const NOW = Date.parse('2026-10-20T03:00:00.000Z');
const usage = { input_tokens: 10, output_tokens: 5 };
const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage });
const useTools = (...calls) => ({ content: calls.map(([name, input], i) => ({ type: 'tool_use', id: `tu_${i}`, name, input })), stop_reason: 'tool_use', usage });

test('handlers: the self-reply card creates ONE draft reply (no approval, no schedule, own media) only on confirm', async () => {
  const drafts = [];
  const corpusStore = createMemoryCorpusStore({ loadCommitted: () => null });
  const steps = [
    useTools(['propose_self_reply', { ...common, tweetUrl: URL_OK, itemId: 'vid1', text: 'Made like this.' }]),
    say("I've put a card up; confirm it to create the reply draft."),
  ];
  let n = 0;
  const h = createStrategyHandlers({
    corpusStore, planStore: createMemoryPlanStore(), chatStore: createMemoryChatStore({ cap: 60 }), clock: () => NOW,
    refreshService: createRefreshService({ store: corpusStore, queueStore: createMemoryRefreshQueue(), now: () => NOW, enabled: false, detectBird: async () => ({ available: false }), idGen: () => 'r1', ingest: async () => ({ rows: [], pull: {} }), runBirdFor: () => () => '' }),
    readXGrowthConfig: async () => ({ ownHandle: 'me_acct', benchmarkHandles: ['bench_a'] }),
    callModel: async () => steps[n++], logUsage: async () => ({ costUsd: 0.001 }),
    readPackages: async () => [{ id: 'vid1', title: 'Shipped a build', assetRefs: ['ev:clips/clip.mp4'] }],
    mediaForItem: async (_c, pkg) => ({ mediaUrl: `https://signed/${pkg.id}.mp4`, mediaType: 'video', mediaContentType: 'video/mp4', mediaStoragePath: 'ev:clips/clip.mp4' }),
    ensureDraft: async (clientId, payload) => { drafts.push({ clientId, payload }); return { existing: false, post: { id: 'social_abc', status: 'draft' } }; },
  });
  const ctx = { clientId: 'c1' };
  const auth = { decoded: { email: 'owner@x.test' } };
  const sent = await h.handle('strategy-chat-send', { clientId: 'c1', text: 'reply under my viral quote with a showcase' }, ctx, auth);
  assert.equal(sent.ok, true);
  assert.equal(sent.proposals.length, 1);
  assert.equal(sent.proposals[0].kind, 'self-reply');
  assert.equal(drafts.length, 0, 'proposing creates nothing');
  const d = await h.handle('strategy-proposal-decide', { clientId: 'c1', threadId: sent.threadId, proposalId: sent.proposals[0].id, decision: 'confirm' }, ctx, auth);
  assert.equal(d.proposal.status, 'confirmed');
  assert.equal(drafts.length, 1);
  const { payload: p } = drafts[0];
  assert.equal(p.content, 'Made like this.');
  assert.equal(p.source, 'self-reply');
  assert.equal(p.replyTo.url, URL_OK);
  assert.equal(p.replyTo.author, 'me_acct');
  assert.equal(p.mediaUrl, 'https://signed/vid1.mp4');
  assert.equal(p.idempotencyKey, 'self-reply:2112185345882141082:vid1');
  for (const k of ['status', 'scheduledAt', 'reviewedAt', 'approved']) assert.ok(!(k in p), `${k} must not be set`);
});
