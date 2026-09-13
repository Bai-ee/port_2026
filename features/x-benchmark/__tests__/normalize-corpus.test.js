import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTweet, normalizeTimeline, classifyType, mediaKind } from '../normalize-corpus.js';
import { tagTopics, tagLanes, UNTAGGED, SHARED_TOPIC_LABELS } from '../taxonomy.js';

const raw = (over = {}) => ({
  id: '100',
  text: 'a poster i made',
  createdAt: '2026-09-10T20:26:01.000Z',
  likeCount: 10,
  retweetCount: 2,
  replyCount: 1,
  media: [],
  ...over,
});

test('a self-quote is distinguished from quoting someone else', () => {
  const own = raw({ quotedTweet: { author: { username: 'bai_ee' }, text: 'x' } });
  assert.equal(classifyType(own, 'bai_ee'), 'self-quote');
  assert.equal(classifyType(own, 'seb__design'), 'quote-react');
});

test('caption length splits a quote-react from commentary', () => {
  const quoted = { author: { username: 'someone' }, text: 'x' };
  assert.equal(classifyType(raw({ quotedTweet: quoted, text: 'short take' }), 'me'), 'quote-react');
  assert.equal(classifyType(raw({ quotedTweet: quoted, text: 'x'.repeat(120) }), 'me'), 'quote-commentary');
});

test('retweets and replies are classified before anything else', () => {
  assert.equal(classifyType(raw({ text: 'RT @someone: hello' }), 'me'), 'retweet');
  assert.equal(classifyType(raw({ inReplyToStatusId: '5' }), 'me'), 'reply');
});

test('media falls to the richest kind present', () => {
  assert.equal(mediaKind(raw({ media: [{ type: 'photo' }, { type: 'video' }] })), 'video');
  assert.equal(mediaKind(raw({ media: [{ type: 'animated_gif' }] })), 'gif');
  assert.equal(mediaKind(raw({ media: [{ type: 'photo' }] })), 'image');
  assert.equal(mediaKind(raw()), 'none');
});

test('local date and hour follow the account\'s own offset', () => {
  const utcRow = normalizeTweet(raw(), { handle: 'x', tzOffsetHours: 0 });
  const plus2 = normalizeTweet(raw(), { handle: 'x', tzOffsetHours: 2 });
  const minus7 = normalizeTweet(raw(), { handle: 'x', tzOffsetHours: -7 });
  assert.equal(utcRow.hourLocal, 20);
  assert.equal(plus2.hourLocal, 22);
  assert.equal(minus7.hourLocal, 13);
  assert.equal(plus2.timeLocal, '22:26');
  // Crossing midnight must move the date, not just the clock.
  assert.equal(minus7.dateLocal, '2026-09-10');
  assert.equal(normalizeTweet(raw({ createdAt: '2026-09-10T02:00:00.000Z' }), { handle: 'x', tzOffsetHours: -7 }).dateLocal, '2026-09-09');
});

test('a post that cannot be placed in time is dropped, not defaulted', () => {
  assert.equal(normalizeTweet(raw({ createdAt: 'nonsense' }), { handle: 'x' }), null);
  assert.equal(normalizeTweet(raw({ id: '' }), { handle: 'x' }), null);
  assert.equal(normalizeTweet(null, { handle: 'x' }), null);
});

test('engagement rate is null when views are unknown, never zero', () => {
  const noViews = normalizeTweet(raw(), { handle: 'x' });
  assert.equal(noViews.views, null);
  assert.equal(noViews.engagementRate, null);
  const withViews = normalizeTweet(raw(), { handle: 'x', views: { 100: 1000 } });
  assert.equal(withViews.views, 1000);
  assert.equal(withViews.engagementRate, 13 / 1000);
});

test('a timeline is deduped, windowed and newest-first', () => {
  const { rows, dropped } = normalizeTimeline([
    raw({ id: '1', createdAt: '2026-09-01T00:00:00Z' }),
    raw({ id: '1', createdAt: '2026-09-01T00:00:00Z' }),
    raw({ id: '2', createdAt: '2026-09-05T00:00:00Z' }),
    raw({ id: '3', createdAt: '2026-01-01T00:00:00Z' }),
  ], { handle: 'x', since: '2026-08-01T00:00:00Z' });
  assert.deepEqual(rows.map((r) => r.id), ['2', '1']);
  assert.equal(dropped, 2, 'one duplicate and one out-of-window');
});

test('the shared taxonomy reads the quoted post, not just the caption', () => {
  // A quote-react's subject usually lives in the post it quotes.
  assert.deepEqual(tagTopics('this is beautiful'), [UNTAGGED]);
  assert.ok(tagTopics('this is beautiful', { quotedText: 'japanese poster archive' }).includes('japanese-asian-design'));
});

test('client lanes are tagged separately from the shared taxonomy', () => {
  // The whole point: a benchmark account will always score 0% on a client's
  // project names, which is the artifact that broke topic comparison.
  const row = normalizeTweet(raw({ text: 'new crittersquest drop' }), { handle: 'x', lanes: ['crittersquest'] });
  assert.deepEqual(row.lanes, ['crittersquest']);
  assert.ok(!row.topics.includes('crittersquest'));
  assert.equal(tagLanes('nothing here', ['crittersquest']).length, 0);
});

test('lane matching ignores fragments too short to be meaningful', () => {
  assert.deepEqual(tagLanes('a big design', ['ai', 'de']), []);
});

test('every shared label is account-agnostic', () => {
  // No label may name a specific product, client or person — that is what
  // made the two original taggers incomparable.
  for (const label of SHARED_TOPIC_LABELS) {
    assert.ok(!/critters|edittrax|hitloop|seb|bai/i.test(label), `${label} names something account-specific`);
  }
});

test('never throws on junk', () => {
  assert.deepEqual(normalizeTimeline(null, { handle: 'x' }), { rows: [], dropped: 0 });
  assert.deepEqual(normalizeTimeline('x', {}), { rows: [], dropped: 0 });
  assert.deepEqual(tagTopics(undefined), [UNTAGGED]);
});
