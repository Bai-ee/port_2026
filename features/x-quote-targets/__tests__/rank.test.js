import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreQuoteTarget, rankQuoteTargets, DEFAULT_WINDOW_HOURS } from '../rank.js';

const NOW = Date.parse('2026-09-10T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();

const base = {
  id: '1',
  text: 'a striking poster',
  author: { username: 'rare_jpg' },
  media: [{ type: 'photo' }],
  likeCount: 500,
  retweetCount: 20,
  replyCount: 5,
};

test('the window is 36h, not the 6h reply window', () => {
  // Measured: median quote target is 17.8h old; only 13% are quoted within 6h.
  assert.equal(DEFAULT_WINDOW_HOURS, 36);
  const at18h = scoreQuoteTarget({ ...base, createdAt: hoursAgo(18) }, { now: NOW });
  assert.equal(at18h.windowOpen, true);
  assert.ok(at18h.score > 0, 'an 18h-old post is the median case and must score');
});

test('velocity outranks raw totals', () => {
  const fast = scoreQuoteTarget({ ...base, likeCount: 800, createdAt: hoursAgo(2) }, { now: NOW });
  const slow = scoreQuoteTarget({ ...base, likeCount: 900, createdAt: hoursAgo(30) }, { now: NOW });
  assert.ok(fast.velocity > slow.velocity);
  assert.ok(fast.score > slow.score, 'the faster-climbing post wins despite fewer likes');
});

test('a stale post falls out of the window', () => {
  const r = scoreQuoteTarget({ ...base, createdAt: hoursAgo(80) }, { now: NOW });
  assert.equal(r.windowOpen, false);
  assert.ok(r.penalties.some((p) => p.startsWith('stale')));
});

test('media beats no media, video beats image', () => {
  const video = scoreQuoteTarget({ ...base, media: [{ type: 'video' }], createdAt: hoursAgo(5) }, { now: NOW });
  const image = scoreQuoteTarget({ ...base, media: [{ type: 'photo' }], createdAt: hoursAgo(5) }, { now: NOW });
  const none = scoreQuoteTarget({ ...base, media: [], createdAt: hoursAgo(5) }, { now: NOW });
  assert.ok(video.score > image.score);
  assert.ok(image.score > none.score);
  assert.ok(none.penalties.includes('no media — little to react to'));
});

test('disqualifies replies, retweets and low-engagement posts outright', () => {
  const reply = scoreQuoteTarget({ ...base, createdAt: hoursAgo(3), inReplyToStatusId: '9' }, { now: NOW });
  const rt = scoreQuoteTarget({ ...base, createdAt: hoursAgo(3), text: 'RT @x: hello' }, { now: NOW });
  const quiet = scoreQuoteTarget({ ...base, createdAt: hoursAgo(3), likeCount: 3, retweetCount: 0, replyCount: 0 }, { now: NOW });
  assert.equal(reply.score, 0);
  assert.equal(rt.score, 0);
  assert.equal(quiet.score, 0);
});

test('refuses to rank an undatable post rather than guessing', () => {
  const r = scoreQuoteTarget({ ...base, createdAt: 'not a date' }, { now: NOW });
  assert.equal(r.score, 0);
  assert.equal(r.velocity, null);
  assert.deepEqual(r.penalties, ['no-timestamp']);
});

test('a known vein scores above an unknown account', () => {
  const known = scoreQuoteTarget({ ...base, createdAt: hoursAgo(6) }, { now: NOW });
  const unknown = scoreQuoteTarget({ ...base, author: { username: 'nobody_at_all' }, createdAt: hoursAgo(6) }, { now: NOW });
  assert.ok(known.score > unknown.score);
  assert.equal(known.vein, 'japanese-asian-design');
  assert.equal(unknown.vein, null);
});

test('one hot account cannot fill the slate', () => {
  const posts = Array.from({ length: 6 }, (_, i) => ({
    ...base,
    id: String(i),
    likeCount: 900 - i,
    createdAt: hoursAgo(2),
  }));
  const ranked = rankQuoteTargets(posts, { now: NOW, limit: 10 });
  assert.equal(ranked.length, 1, 'perAuthor defaults to 1');

  const mixed = [...posts, { ...base, id: 'x', author: { username: 'DesignReviewed' }, createdAt: hoursAgo(2) }];
  assert.equal(rankQuoteTargets(mixed, { now: NOW }).length, 2);
});

test('never throws on malformed input', () => {
  for (const bad of [undefined, null, {}, { likeCount: 'x' }, { author: null, media: 'nope' }]) {
    const r = scoreQuoteTarget(bad, { now: NOW });
    assert.equal(typeof r.score, 'number');
  }
  assert.deepEqual(rankQuoteTargets(null), []);
});
