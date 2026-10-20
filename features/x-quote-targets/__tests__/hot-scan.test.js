import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expandQueries, scoreHotPost, buildCandidates, momentumOf, selectPicks, countQuotesToday, quotesLeftToday,
  accountMedianEngagement, pruneShown, updateSnapshots, alreadyQuotedIds, toPick, buildHotQuotesPayload, median,
} from '../hot-scan.js';
import { HOT_QUERIES, HOT_PICKS_PER_REFRESH, LANE_MIX } from '../hot-config.js';

const NOW = Date.parse('2026-10-20T18:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();
const vid = [{ type: 'video', url: 'https://pbs.twimg.com/a.jpg' }];
const post = (id, o = {}) => ({ id, text: `post ${id}`, createdAt: hoursAgo(o.age ?? 10), likeCount: o.likes ?? 800, retweetCount: 50, replyCount: 20, media: o.media ?? vid, author: { username: o.author ?? `u${id}`, name: 'N' }, ...(o.reply ? { inReplyToStatusId: '9' } : {}) });

test('config: one allowance value drives picks per refresh and the lane mix sums to it', () => {
  assert.equal(HOT_PICKS_PER_REFRESH, 4);
  assert.equal(LANE_MIX.design + LANE_MIX.music, HOT_PICKS_PER_REFRESH);
});

test('expandQueries: {since} is filled per lane window (design 36h, music 72h) and the reference query is included', () => {
  const d = expandQueries('design', NOW);
  const m = expandQueries('music', NOW);
  assert.ok(d.every((q) => !q.includes('{since}')));
  assert.ok(d[0].includes('since:2026-10-19') && d[0].includes('min_faves:2000 filter:videos'));
  assert.ok(m[0].includes('since:2026-10-17'));
  assert.equal(d.length, HOT_QUERIES.design.length);
});

test('design breakout: media required, window 36h, engagement floor, replies and RTs out', () => {
  assert.equal(scoreHotPost(post('1'), 'design', { now: NOW }).qualifies, true);
  assert.equal(scoreHotPost(post('2', { media: [] }), 'design', { now: NOW }).qualifies, false);
  assert.equal(scoreHotPost(post('3', { age: 40 }), 'design', { now: NOW }).qualifies, false);
  assert.equal(scoreHotPost(post('4', { likes: 30 }), 'design', { now: NOW }).qualifies, false);
  assert.equal(scoreHotPost(post('5', { reply: true }), 'design', { now: NOW }).qualifies, false);
});

test('music breakout: 5x the account median within 72h; a search hit needs the absolute floor', () => {
  const p = post('1', { age: 60, likes: 300 });
  assert.equal(scoreHotPost(p, 'music', { now: NOW, accountMedian: 40 }).qualifies, true, '370 >= 5x40');
  assert.equal(scoreHotPost(p, 'music', { now: NOW, accountMedian: 200 }).qualifies, false, 'only 1.85x');
  assert.equal(scoreHotPost(p, 'music', { now: NOW }).qualifies, true, 'search floor 100');
  assert.equal(scoreHotPost(post('2', { age: 60, likes: 20 }), 'music', { now: NOW }).qualifies, false);
  assert.equal(scoreHotPost(post('3', { age: 80, likes: 900 }), 'music', { now: NOW, accountMedian: 5 }).qualifies, false, 'older than 72h');
});

test('accountMedianEngagement ignores replies, RTs and the post itself', () => {
  const posts = [post('a', { likes: 10 }), post('b', { likes: 30 }), post('c', { likes: 50 }), post('d', { reply: true, likes: 9999 })];
  assert.equal(accountMedianEngagement(posts, { excludeId: 'c' }), 90, 'median of 80 and 100');
});

test('buildCandidates: dedupes by id, drops excluded ids and the owner, sorts by score', () => {
  const entries = [
    { post: post('1', { likes: 500 }) }, { post: post('1', { likes: 500 }), via: 'account' },
    { post: post('2', { likes: 5000 }) }, { post: post('3', { author: 'bai_ee' }) }, { post: post('4') },
  ];
  const c = buildCandidates('design', entries, { now: NOW, excludeIds: new Set(['4']), ownHandle: 'Bai_Ee' });
  assert.deepEqual(c.map((x) => x.id), ['2', '1']);
  assert.equal(c[0].url, 'https://x.com/u2/status/2');
});

test('momentum: first sighting = new; recent pace vs own average = climbing | flat | fading', () => {
  const cur = { engagement: 1000, ageHours: 10 }; // average 100/h
  assert.equal(momentumOf(undefined, cur, NOW), 'new');
  assert.equal(momentumOf({ at: new Date(NOW - 5 * 60_000).toISOString(), engagement: 990 }, cur, NOW), 'new', 'too fresh to compare');
  assert.equal(momentumOf({ at: hoursAgo(2), engagement: 700 }, cur, NOW), 'climbing', '150/h');
  assert.equal(momentumOf({ at: hoursAgo(2), engagement: 960 }, cur, NOW), 'fading', '20/h');
  assert.equal(momentumOf({ at: hoursAgo(2), engagement: 880 }, cur, NOW), 'flat', '60/h');
});

const J = (id, lane, fit, o = {}) => ({ id, lane, fit, angle: 'craft', why: 'w', score: 0.5, momentum: 'new', ...o });

test('selectPicks: 3 design + 1 music, never repeats a shown post, rejects and low fit never picked', () => {
  const judged = [J('d1', 'design', 0.9), J('d2', 'design', 0.8), J('d3', 'design', 0.7), J('d4', 'design', 0.95, { reject: 'news' }), J('d5', 'design', 0.9), J('m1', 'music', 0.7), J('m2', 'music', 0.9)];
  const r = selectPicks(judged, { shownIds: new Set(['d5']) });
  assert.deepEqual(r.design.map((c) => c.id).sort(), ['d1', 'd2', 'd3']);
  assert.deepEqual(r.music.map((c) => c.id), ['m2']);
  assert.equal(r.all.length, 4);
});

test('selectPicks: an empty lane is filled from the other; fewer than N pass => fewer picks, never padded', () => {
  const designOnly = [1, 2, 3, 4, 5].map((n) => J(`d${n}`, 'design', 0.9 - n / 100));
  assert.equal(selectPicks(designOnly).all.length, 4, 'music empty -> 4th from design');
  const weak = [J('d1', 'design', 0.9), J('d2', 'design', 0.5), J('m1', 'music', 0.59), J('m2', 'music', 0.8, { angle: 'none' })];
  assert.deepEqual(selectPicks(weak).all.map((c) => c.id), ['d1']);
});

test('selectPicks: climbing outranks flat at equal fit', () => {
  const r = selectPicks([J('a', 'design', 0.8, { momentum: 'flat' }), J('b', 'design', 0.8, { momentum: 'climbing' })], { total: 1, mix: { design: 1, music: 0 } });
  assert.equal(r.all[0].id, 'b');
});

test('countQuotesToday: owner quote-tweets on the CT day only; quotesLeft = 4 - posted', () => {
  const t = (iso, o = {}) => ({ createdAt: iso, ...o });
  const tweets = [
    t('2026-10-20T13:00:00Z', { quotedTweet: { id: '1' } }), // 08:00 CT today
    t('2026-10-20T14:00:00Z'), // plain post
    t('2026-10-20T03:00:00Z', { quotedTweet: { id: '2' } }), // 22:00 CT yesterday
    t('2026-10-20T15:00:00Z', { quotedTweet: { id: '3' }, inReplyToStatusId: '9' }), // reply
  ];
  assert.equal(countQuotesToday(tweets, NOW), 1);
  assert.equal(quotesLeftToday(1), 3);
  assert.equal(quotesLeftToday(9), 0);
  assert.deepEqual([...alreadyQuotedIds(tweets)].sort(), ['1', '2', '3']);
});

test('history helpers: shown pruned at 7d, snapshots age out and are replaced by the newest read', () => {
  const shown = { old: { shownAt: hoursAgo(24 * 8) }, fresh: { shownAt: hoursAgo(24) } };
  assert.deepEqual(Object.keys(pruneShown(shown, NOW)), ['fresh']);
  const snaps = updateSnapshots({ a: { at: hoursAgo(100), engagement: 1 }, b: { at: hoursAgo(5), engagement: 2 } }, [{ id: 'b', engagement: 9 }, { id: 'c', engagement: 3 }], NOW);
  assert.deepEqual(Object.keys(snaps).sort(), ['b', 'c']);
  assert.equal(snaps.b.engagement, 9);
});

test('payload: picks by lane, quotesLeftToday, cost, no undefined values (Firestore rejects them)', () => {
  const [ranked] = selectPicks([{ ...J('d1', 'design', 0.9), windowHours: 36, url: 'u', author: 'a', authorName: null, text: 't', createdAt: 'c', ageHours: 1, likes: 1, reposts: 1, replies: 1, engagement: 3, velocity: 3 }]).all;
  const pick = toPick(ranked, NOW);
  const p = buildHotQuotesPayload({ scannedAt: 's', picks: { design: [pick], music: [] }, postedToday: 3, costUsd: 0.001234567, shown: {}, snapshots: {}, rotation: { design: 0, music: 0 } });
  assert.equal(p.quotesLeftToday, 1);
  assert.equal(p.costUsd, 0.00123);
  assert.ok(!JSON.stringify(p, (k, v) => (v === undefined ? '__undef__' : v)).includes('__undef__'));
});
