// Fillers for showcase / text / self-quote / reply slots and the brand-fit scope.
// Real shapes: fixtures/daily-loop-real-shapes.json packages + the committed own corpus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fillShowcaseSlot, fillTextSlot, fillSelfQuoteSlot } from '../daily-loop/fill-original.js';
import { fillReplySlot } from '../daily-loop/fill-reply.js';
import { brandFitApplies } from '../daily-loop/brand.js';
import { groupNarratives, conversationPostsFrom } from '../daily-loop/conversations.js';
import { REPLY_WINDOW_HOURS } from '../daily-loop/config.js';
import { MIN_RESURRECTION_AGE_DAYS, MAX_RESURRECTION_AGE_DAYS } from '../ledger.js';

const FX = JSON.parse(readFileSync(new URL('./fixtures/daily-loop-real-shapes.json', import.meta.url), 'utf8'));
const CORPUS = JSON.parse(readFileSync(new URL('../../../docs/audits/bai-ee-x-corpus.json', import.meta.url), 'utf8'));
const NOW = Date.parse(FX.now);
const DAY = 86_400_000;
const slot = (letter, type, over = {}) => ({ letter, type, lane: null, engine: null, ...over });
const discogs = FX.packages.find((p) => p.source?.kind === 'discogs');
const STORY = 'I found this pressing in a Chicago crate in 2009 and played it at every house party for a year afterwards.';

// --- showcase ---

test('showcase takes the package matchDay chose', () => {
  const r = fillShowcaseSlot({ slot: slot('A', 'original-showcase'), matchedSlot: { packageId: discogs.id, matchScore: 0.9, matchReason: 'never posted' }, packages: FX.packages, now: NOW });
  assert.equal(r.packageId, discogs.id);
  assert.equal(r.basis, 'facts');
  assert.equal(r.whyNow, null);
  assert.equal(r.gap, undefined);
});

test('showcase gap carries matchDay\'s reason and the slot-unfilled code', () => {
  const r = fillShowcaseSlot({ slot: slot('A', 'original-showcase'), matchedSlot: { matchReason: 'no eligible package' }, packages: FX.packages, now: NOW });
  assert.deepEqual(r.gap, { code: 'slot-unfilled:A', reason: 'no eligible package' });
});

test('showcase optional whyNow is carried, not required', () => {
  const r = fillShowcaseSlot({ slot: slot('A', 'original-showcase'), matchedSlot: { packageId: discogs.id }, packages: FX.packages, whyNow: 'Glenn Underground is trending', now: NOW });
  assert.equal(r.whyNow, 'Glenn Underground is trending');
});

// --- text ---

// Text slots only accept C3/C7 series, so the real C3 flyer (facts-only) is the base.
// The saved row still carries the "[add your memory]" placeholder, which must never fill a slot.
const savedFlyer = FX.packages.find((p) => p.id === 'nas-05b332d72c9e34c8');
const flyer = { ...savedFlyer, story: '' };

test('text slot: a real story beats facts-only; facts-only still fills; none is a gap', () => {
  const withStory = { ...flyer, id: 'flyer-with-story', story: STORY };
  const s = slot('B', 'original-text');
  const both = fillTextSlot({ slot: s, packages: [flyer, withStory], now: NOW });
  assert.equal(both.packageId, withStory.id);
  assert.equal(both.basis, 'story');
  const onlyFacts = fillTextSlot({ slot: s, packages: [flyer], now: NOW });
  assert.equal(onlyFacts.basis, 'facts');
  assert.ok(onlyFacts.facts.length > 0);
  assert.equal(fillTextSlot({ slot: s, packages: [savedFlyer], now: NOW }).gap.code, 'slot-unfilled:B');
  const none = fillTextSlot({ slot: s, packages: [{ ...flyer, story: '', facets: {} }], now: NOW });
  assert.deepEqual(none.gap, { code: 'slot-unfilled:B', reason: 'no story/facts for this slot' });
});

test('text slot skips the package the showcase already took', () => {
  const r = fillTextSlot({ slot: slot('B', 'original-text'), packages: [flyer], now: NOW, usedIds: [flyer.id] });
  assert.equal(r.gap.code, 'slot-unfilled:B');
});

// --- self-quote ---

const own = (id, ageDays, likes, over = {}) => ({
  id, url: `https://x.com/bai_ee/status/${id}`, utc: new Date(NOW - ageDays * DAY).toISOString(),
  type: 'original-showcase', text: `post ${id}`, media: 'video', likes, views: likes * 50, engagement: likes, ...over,
});
const sq = (ownPosts, extra = {}) => fillSelfQuoteSlot({ slot: slot('C', 'self-quote'), ownPosts, ownHandle: 'bai_ee', now: NOW, ...extra });

test('self-quote picks the best own post inside the ledger window', () => {
  const posts = [own('1', 60, 5), own('2', 90, 40), own('3', 120, 10), own('4', 150, 1), own('5', 200, 2)];
  const r = sq(posts);
  assert.equal(r.quotedPost.id, '2');
  assert.ok(r.ageDays >= MIN_RESURRECTION_AGE_DAYS && r.ageDays <= MAX_RESURRECTION_AGE_DAYS);
});

test('self-quote works on the real own corpus', () => {
  const r = sq(CORPUS, { now: Date.parse('2026-09-20T12:00:00Z') });
  if (r.gap) assert.match(r.gap.reason, /window|own posts/);
  else assert.match(r.quotedPost.url, /x\.com\/bai_ee\//);
});

test('self-quote never uses an outside post, even a higher-scoring one', () => {
  const outsider = own('9', 90, 5000, { url: 'https://x.com/seb__design/status/9' });
  const r = sq([outsider, own('1', 60, 5), own('2', 90, 10), own('3', 120, 3), own('4', 150, 1), own('5', 200, 2)]);
  assert.equal(r.quotedPost.id, '2');
  const outsideOnly = sq([outsider, { ...own('8', 90, 900), author: 'someone_else' }]);
  assert.deepEqual(outsideOnly.gap.code, 'slot-unfilled:C');
  assert.match(outsideOnly.gap.reason, /no own posts/);
});

test('self-quote with no post old enough (or only too recent) is a gap', () => {
  const r = sq([own('1', 2, 100), own('2', 5, 80)]);
  assert.match(r.gap.reason, /window/);
  assert.equal(sq([own('1', 90, 5)], { windowDays: 30 }).gap.code, 'slot-unfilled:C');
});

test('self-quote needs an explicit owner handle', () => {
  const r = fillSelfQuoteSlot({ slot: slot('C', 'self-quote'), ownPosts: [own('1', 90, 5)], now: NOW });
  assert.match(r.gap.reason, /owner handle/);
});

// --- reply ---

const post = (id, ageH, likes, text) => ({ id, author: 'a', text, createdAt: new Date(NOW - ageH * 3_600_000).toISOString(), likes, reposts: 2, replies: 5, source: 'watchlist' });

test('reply slot takes the live narrative with the most momentum', () => {
  const narratives = groupNarratives(conversationPostsFrom({ scan: { candidates: [
    post('1', 2, 200, 'cajual records reissue announced today'), post('2', 30, 900, 'completely unrelated typography debate'),
  ] } }), { now: NOW });
  const r = fillReplySlot({ slot: slot('R', 'reply'), narratives, now: NOW });
  assert.equal(r.anchor.id, '1');
});

test('reply slot is a gap when nothing is inside the reply window', () => {
  const stale = groupNarratives(conversationPostsFrom({ scan: { candidates: [post('2', REPLY_WINDOW_HOURS + 10, 900, 'typography debate goes on')] } }), { now: NOW });
  assert.ok(stale.length > 0);
  assert.match(fillReplySlot({ slot: slot('R', 'reply'), narratives: stale, now: NOW }).gap.reason, /reply window/);
  assert.equal(fillReplySlot({ slot: slot('R', 'reply'), narratives: [], now: NOW }).gap.code, 'slot-unfilled:R');
});

// --- brand fit scope ---

test('library brand fit applies only to replies and conversation-linked originals', () => {
  assert.equal(brandFitApplies('reply'), true);
  assert.equal(brandFitApplies('original-showcase', { conversationLinked: true }), true);
  assert.equal(brandFitApplies('original-text', { conversationLinked: true }), true);
  for (const t of ['quote-react', 'quote-commentary', 'self-quote', 'retweet']) {
    assert.equal(brandFitApplies(t), false, t);
    assert.equal(brandFitApplies(t, { conversationLinked: true }), false, `${t} linked`);
  }
  assert.equal(brandFitApplies('original-showcase'), false);
  assert.equal(brandFitApplies('original-text'), false);
});
