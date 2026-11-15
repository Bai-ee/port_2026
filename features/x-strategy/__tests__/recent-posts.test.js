// get_recent_posts: fake bird output (shaped like real `bird user-tweets --json-full`), no network, no Firestore.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertReadOnlyBird, birdArgsFor, buildSnapshot, createMemoryRecentPostsStore, createRecentPostsReader, normalizeRecentPost,
  parseTimeline, shapeRecentPosts, snapshotFromMonitor, RECENT_CACHE_TTL_MS, RATE_LIMIT_COOLDOWN_MS,
  recentPullDue, SCHEDULED_PULL_MS, REFRESH_REQUEST_COOLDOWN_MS,
} from '../recent-posts.js';
import { runReadTool, READ_TOOL_NAMES, READ_TOOLS } from '../agent/tools.js';
import { createStrategyHandlers } from '../route-handlers.js';
import { createMemoryCorpusStore } from '../corpus-store.js';
import { createMemoryPlanStore } from '../plan-store.js';
import { createRefreshService, createMemoryRefreshQueue } from '../refresh.js';
import { createMemoryChatStore } from '../agent/chat-store.js';

const NOW = Date.parse('2026-10-20T03:00:00.000Z');
const H = 3_600_000;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n) => String(n).padStart(2, '0');
/** "Mon Oct 19 22:14:37 +0000 2026" - the timestamp format bird prints. */
const bird = (iso) => { const d = new Date(iso); return `${DAY_NAMES[d.getUTCDay()]} ${MONTH_NAMES[d.getUTCMonth()]} ${two(d.getUTCDate())} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())} +0000 ${d.getUTCFullYear()}`; };

const ago = (hours) => new Date(NOW - hours * H).toISOString();
const view = (n) => ({ count: String(n), state: 'EnabledWithCount' });

/** An own original with a video. */
const original = (id, hoursAgo, views, over = {}) => ({
  id, text: `post ${id}`, createdAt: bird(ago(hoursAgo)), replyCount: 1, retweetCount: 0, likeCount: 2, conversationId: id,
  author: { username: 'me_acct', name: 'Me' }, authorId: '1',
  media: [{ type: 'video', durationMs: 22507 }],
  _raw: { rest_id: id, views: view(views), legacy: { bookmark_count: 3, quote_count: 0 } },
  ...over,
});

/** A quote-tweet: OWN numbers at the top level, the ORIGINAL's under quotedTweet and _raw.quoted_status_result. */
const quoteOf = (id, hoursAgo, ownViews, { text = 'Not to detract, but a lill digging reveals a very talented brother.' } = {}) => ({
  id, text, createdAt: bird(ago(hoursAgo)), replyCount: 0, retweetCount: 0, likeCount: 97, conversationId: id,
  author: { username: 'me_acct', name: 'Me' }, authorId: '1',
  quotedTweet: { id: 'q1', text: 'DESIGN IS DEAD, my film', createdAt: bird(ago(40)), replyCount: 945, retweetCount: 1773, likeCount: 25581, author: { username: '_darshi', name: 'D' }, media: [{ type: 'video' }] },
  _raw: {
    rest_id: id, views: view(ownViews), legacy: { bookmark_count: 23, quote_count: 0, favorite_count: 97, is_quote_status: true },
    quoted_status_result: { result: { rest_id: 'q1', views: view(2_959_316), legacy: { favorite_count: 25581 } } },
  },
});

const retweet = (id, hoursAgo) => ({
  id, text: 'RT @someone: a thing', createdAt: bird(ago(hoursAgo)), replyCount: 0, retweetCount: 0, likeCount: 0, conversationId: id,
  author: { username: 'me_acct' }, _raw: { rest_id: id, views: view(500_000), legacy: {} },
});

const reply = (id, hoursAgo, views) => ({ ...original(id, hoursAgo, views), inReplyToStatusId: 'other' });

const timeline = (tweets) => `banner line\n${JSON.stringify({ tweets, nextCursor: 'C' })}\n`;
const fixtureTimeline = () => timeline([
  original('10', 3, 36),
  quoteOf('9', 13, 10527),
  original('8', 30, 60),
  retweet('7', 40),
  reply('6', 5, 15),
  original('5', 100, 47),
  original('4', 200, 70),
  original('3', 220, 62),
  original('2', 250, 80),
]);

const fakeBird = (stdout, { fail } = {}) => {
  const calls = [];
  const run = (args) => { calls.push(args); if (fail) throw Object.assign(new Error('Command failed'), { stderr: fail }); return stdout; };
  run.calls = calls;
  return run;
};

// ---- quoted stats are not the owner's ------------------------------------------------------------------------------

test('quote-tweet: own views/likes/bookmarks are the account\'s; the quoted post\'s stats sit apart under `quoted`', () => {
  const row = normalizeRecentPost(quoteOf('9', 13, 10527), { handle: 'me_acct' });
  assert.equal(row.views, 10527);
  assert.equal(row.likes, 97);
  assert.equal(row.bookmarks, 23);
  assert.equal(row.type, 'quote-react');
  assert.deepEqual(
    { author: row.quoted.author, likes: row.quoted.likes, reposts: row.quoted.reposts, replies: row.quoted.replies, views: row.quoted.views },
    { author: '_darshi', likes: 25581, reposts: 1773, replies: 945, views: 2_959_316 },
  );
  assert.match(row.quoted.note, /QUOTED post's stats, not the account's own/);
  // Nothing the quoted post owns leaks into the own fields.
  for (const own of [row.views, row.likes, row.reposts, row.replies, row.bookmarks, row.quotes]) {
    assert.ok(![2_959_316, 25581, 1773, 945].includes(own), `own field leaked a quoted number: ${own}`);
  }
});

test('views come only from a `_raw` that is this very post; a mismatched or missing `_raw` gives null, never a guess', () => {
  const wrong = original('1', 2, 99);
  wrong._raw.rest_id = 'something-else';
  assert.equal(normalizeRecentPost(wrong, { handle: 'me_acct' }).views, null);
  const none = original('2', 2, 99);
  delete none._raw;
  assert.equal(normalizeRecentPost(none, { handle: 'me_acct' }).views, null);
  // a quote whose nested original does not match its quotedTweet id: quoted views unknown, own views intact
  const q = quoteOf('3', 2, 40);
  q._raw.quoted_status_result.result.rest_id = 'other';
  const row = normalizeRecentPost(q, { handle: 'me_acct' });
  assert.equal(row.views, 40);
  assert.equal(row.quoted.views, null);
});

test('a retweet carries no views (they belong to the original) and stays out of the median', () => {
  const snap = buildSnapshot({ raws: [retweet('7', 2), original('1', 2, 50), original('2', 3, 70)], handle: 'me_acct', pulledAt: NOW });
  const rt = snap.rows.find((r) => r.id === '7');
  assert.equal(rt.type, 'retweet');
  assert.equal(rt.views, null);
  const res = shapeRecentPosts(snap, { now: NOW, source: 'bird-live' });
  assert.equal(res.medianViews.n, 2);
  assert.equal(res.medianViews.value, 60);
});

// ---- the result: window, median, outlier, provenance ---------------------------------------------------------------

test('shape: window filter, owner median over originals + quotes, outlier >= 10x, provenance on the figures', () => {
  const snap = buildSnapshot({ raws: parseTimeline(fixtureTimeline()), handle: 'me_acct', pulledAt: NOW });
  const res = shapeRecentPosts(snap, { hours: 48, now: NOW, source: 'bird-live' });
  assert.equal(res.available, true);
  assert.equal(res.source, 'bird-live');
  assert.equal(res.asOf, new Date(NOW).toISOString());
  assert.equal(res.ageMinutes, 0);
  assert.equal(res.stale, false);
  assert.deepEqual(res.posts.map((p) => p.id), ['10', '6', '9', '8', '7']); // newest first, only the last 48h
  assert.equal(res.count, 5);
  // median of originals + quotes with views in 14d: 36, 10527, 60, 47, 70, 62, 80 (reply 6 + retweet 7 excluded)
  assert.equal(res.medianViews.value, 62);
  assert.equal(res.medianViews.n, 7);
  assert.match(res.medianViews.basis, /originals \+ quotes/);
  const quote = res.posts.find((p) => p.id === '9');
  assert.equal(quote.outlier, true);
  assert.ok(quote.vsMedian > 150);
  assert.equal(quote.viewsSource, 'bird');
  assert.equal(quote.viewsAsOf, new Date(NOW).toISOString());
  for (const p of res.posts.filter((x) => x.id !== '9')) assert.equal(p.outlier, false, p.id);
  assert.equal(res.posts.find((p) => p.id === '6').vsMedian, null, 'a reply is not judged against the originals median');
  assert.equal(res.posts[0].atCT, '2026-10-19 19:00'); // 00:00Z on Oct 20 is 19:00 CDT on Oct 19
  assert.equal(res.posts[0].videoSeconds, 22.5);
});

test('hours is clamped to 1..168 and defaults to 48', () => {
  const snap = buildSnapshot({ raws: parseTimeline(fixtureTimeline()), handle: 'me_acct', pulledAt: NOW });
  assert.equal(shapeRecentPosts(snap, { now: NOW, source: 'x' }).windowHours, 48);
  assert.equal(shapeRecentPosts(snap, { hours: 9999, now: NOW, source: 'x' }).windowHours, 168);
  assert.equal(shapeRecentPosts(snap, { hours: 0, now: NOW, source: 'x' }).windowHours, 1);
  assert.deepEqual(shapeRecentPosts(snap, { hours: 168, now: NOW, source: 'x' }).posts.map((p) => p.id).includes('5'), true);
});

test('reconcile: the later capture wins - X Monitor only when synced after the bird pull and not lower', () => {
  const snap = buildSnapshot({ raws: [original('1', 2, 100), original('2', 2, 200)], handle: 'me_acct', pulledAt: NOW - 3 * H });
  const monitor = { asOf: NOW - H, byId: new Map([['1', 150], ['2', 150]]) };
  const res = shapeRecentPosts(snap, { now: NOW, source: 'bird-snapshot', monitor });
  const p1 = res.posts.find((p) => p.id === '1');
  const p2 = res.posts.find((p) => p.id === '2');
  assert.equal(p1.views, 150);
  assert.equal(p1.viewsSource, 'x-monitor');
  assert.equal(p1.viewsAsOf, new Date(NOW - H).toISOString());
  assert.equal(p2.views, 200, 'a lower monitor figure never replaces a higher bird one');
  assert.equal(p2.viewsSource, 'bird');
  // an older monitor sync never overrides a newer bird pull
  const older = shapeRecentPosts(snap, { now: NOW, source: 'x', monitor: { asOf: NOW - 5 * H, byId: new Map([['1', 999]]) } });
  assert.equal(older.posts.find((p) => p.id === '1').views, 100);
});

// ---- bird safety ---------------------------------------------------------------------------------------------------

test('only read-only bird verbs can run; tweet / reply / follow are refused before any process starts', () => {
  for (const verb of ['tweet', 'reply', 'follow', 'unfollow', 'like', 'retweet', 'delete', '']) {
    assert.throws(() => assertReadOnlyBird([verb, 'x']), /read-only verbs only/, verb);
  }
  for (const verb of ['read', 'user-tweets', 'replies', 'thread', 'search', 'user', 'whoami']) assert.doesNotThrow(() => assertReadOnlyBird([verb]));
  assert.equal(birdArgsFor('me_acct')[0], 'user-tweets');
  assert.ok(birdArgsFor('me_acct').includes('--json-full'));
});

// ---- the reader: cache, cooldown, no-bird paths -------------------------------------------------------------------

test('live pull once, then served from the 15 min cache; refreshed after the TTL; one bird call each time', async () => {
  const run = fakeBird(fixtureTimeline());
  let t = NOW;
  const store = createMemoryRecentPostsStore();
  const reader = createRecentPostsReader({ runBird: run, store, now: () => t });
  const a = await reader({ clientId: 'c1', handle: '@Me_Acct' });
  assert.equal(a.source, 'bird-live');
  assert.equal(run.calls.length, 1);
  assert.deepEqual(run.calls[0].slice(0, 2), ['user-tweets', '@me_acct']);
  assert.ok(run.calls.every((args) => ['read', 'user-tweets'].includes(args[0])), 'only read verbs are ever sent to bird');
  t += 10 * 60_000;
  const b = await reader({ clientId: 'c1', handle: 'me_acct', hours: 24 });
  assert.equal(b.source, 'bird-cache');
  assert.equal(b.ageMinutes, 10);
  assert.equal(run.calls.length, 1, 'inside the TTL no bird call');
  t += RECENT_CACHE_TTL_MS;
  const c = await reader({ clientId: 'c1', handle: 'me_acct' });
  assert.equal(c.source, 'bird-live');
  assert.equal(run.calls.length, 2);
  assert.ok(await store.get('c1__me_acct'), 'snapshot persisted for deployments where bird cannot run');
});

test('a burst of simultaneous calls shares one bird pull', async () => {
  const run = fakeBird(fixtureTimeline());
  const reader = createRecentPostsReader({ runBird: run, now: () => NOW });
  await Promise.all([reader({ clientId: 'c1', handle: 'me_acct' }), reader({ clientId: 'c1', handle: 'me_acct' }), reader({ clientId: 'c1', handle: 'me_acct' })]);
  assert.equal(run.calls.length, 1);
});

test('HTTP 429: serves the stale snapshot, flags it, and does not call bird again during the cooldown', async () => {
  const store = createMemoryRecentPostsStore();
  await store.put('c1__me_acct', buildSnapshot({ raws: parseTimeline(fixtureTimeline()), handle: 'me_acct', pulledAt: NOW - 2 * H, clientId: 'c1' }));
  const run = fakeBird('', { fail: 'HTTP 429 Too Many Requests' });
  let t = NOW;
  const reader = createRecentPostsReader({ runBird: run, store, now: () => t });
  const a = await reader({ clientId: 'c1', handle: 'me_acct' });
  assert.equal(a.stale, true);
  assert.equal(a.ageMinutes, 120);
  assert.match(a.caveats.join(' '), /rate-limited/);
  t += 60_000;
  const b = await reader({ clientId: 'c1', handle: 'me_acct' });
  assert.equal(run.calls.length, 1, 'cooldown: no second bird call');
  assert.match(b.caveats.join(' '), /rate-limited/);
  t += RATE_LIMIT_COOLDOWN_MS;
  await reader({ clientId: 'c1', handle: 'me_acct' });
  assert.equal(run.calls.length, 2, 'after the cooldown bird is tried again');
});

test('no bird (Vercel): serves the Mac-written snapshot, marked stale with its as-of and how to refresh', async () => {
  const store = createMemoryRecentPostsStore();
  await store.put('c1__me_acct', buildSnapshot({ raws: parseTimeline(fixtureTimeline()), handle: 'me_acct', pulledAt: NOW - 6 * H, clientId: 'c1' }));
  const reader = createRecentPostsReader({ runBird: null, store, now: () => NOW });
  const r = await reader({ clientId: 'c1', handle: 'me_acct' });
  assert.equal(r.source, 'bird-snapshot');
  assert.equal(r.stale, true);
  assert.equal(r.asOf, new Date(NOW - 6 * H).toISOString());
  assert.match(r.caveats.join(' '), /re-pulls hourly/);
});

test('no bird and no snapshot: falls back to X Monitor impressions, labelled with their source and sync time', async () => {
  const syncedAt = NOW - 5 * H;
  const audience = { account: { sync: { postsAt: syncedAt } }, posts: [{ id: 'm1', createdAt: ago(10), kind: 'quote', text: 'q', metrics: { impressions: 9400, likes: 90 } }, { id: 'm2', createdAt: ago(20), text: 'o', metrics: { impressions: 40 } }] };
  const reader = createRecentPostsReader({ runBird: null, readMonitor: async () => audience, now: () => NOW });
  const r = await reader({ clientId: 'c1', handle: 'me_acct' });
  assert.equal(r.source, 'x-monitor');
  assert.equal(r.asOf, new Date(syncedAt).toISOString());
  assert.equal(r.posts[0].views, 9400);
  assert.equal(r.posts[0].viewsSource, 'x-monitor');
  assert.match(r.caveats.join(' '), /X Monitor impressions/);
  assert.equal(snapshotFromMonitor({ account: {}, posts: [] }, { handle: 'x' }), null);
});

test('nothing available says so instead of inventing numbers', async () => {
  const reader = createRecentPostsReader({ runBird: null, now: () => NOW });
  const r = await reader({ clientId: 'c1', handle: 'me_acct' });
  assert.equal(r.available, false);
  assert.match(r.reason, /pull-recent-posts\.mjs/);
});

// ---- the tool + the handler wiring ---------------------------------------------------------------------------------

test('get_recent_posts is a registered read tool (so it is also exposed over MCP as strategy_get_recent_posts) and passes clean args', async () => {
  assert.ok(READ_TOOL_NAMES.includes('get_recent_posts'));
  const t = READ_TOOLS.find((x) => x.name === 'get_recent_posts');
  assert.equal(t.input_schema.properties.hours.maximum, 168);
  assert.ok(!('clientId' in t.input_schema.properties));
  let seen = null;
  await runReadTool('get_recent_posts', { handle: '@Seb', hours: 9999 }, { getRecentPosts: async (a) => { seen = a; return { ok: 1 }; } });
  assert.deepEqual(seen, { handle: 'Seb', hours: 168 });
  await runReadTool('get_recent_posts', {}, { getRecentPosts: async (a) => { seen = a; return {}; } });
  assert.deepEqual(seen, { handle: undefined, hours: undefined });
  await assert.rejects(() => runReadTool('get_recent_posts', {}, {}), /getRecentPosts is not available/);
});

async function handlers(extra = {}) {
  const corpusStore = createMemoryCorpusStore({ loadCommitted: () => null });
  return createStrategyHandlers({
    corpusStore, planStore: createMemoryPlanStore(), chatStore: createMemoryChatStore({ cap: 60 }), clock: () => NOW,
    refreshService: createRefreshService({ store: corpusStore, queueStore: createMemoryRefreshQueue(), now: () => NOW, enabled: false, detectBird: async () => ({ available: false }), idGen: () => 'r1', ingest: async () => ({ rows: [], pull: {} }), runBirdFor: () => () => '' }),
    readXGrowthConfig: async () => ({ ownHandle: 'me_acct', benchmarkHandles: ['bench_a'] }),
    ...extra,
  });
}

test('handler: defaults to the owner, accepts a benchmark, refuses any other handle, resolves by the request client', async () => {
  const calls = [];
  const h = await handlers({ readRecentPosts: async (a) => { calls.push(a); return { available: true, handle: a.handle }; } });
  const deps = h.toolDepsFor('c1', { clientId: 'c1' });
  assert.equal((await deps.getRecentPosts({})).handle, 'me_acct');
  assert.equal((await deps.getRecentPosts({ handle: '@Bench_A', hours: 24 })).handle, 'bench_a');
  const denied = await deps.getRecentPosts({ handle: 'stranger' });
  assert.match(denied.error, /own or a benchmark handle/);
  assert.deepEqual(calls.map((c) => [c.clientId, c.handle, c.hours]), [['c1', 'me_acct', undefined], ['c1', 'bench_a', 24]]);
});

test('handler without a reader says it is not available', async () => {
  const h = await handlers();
  const r = await h.toolDepsFor('c1', { clientId: 'c1' }).getRecentPosts({});
  assert.equal(r.available, false);
});

// ---- Phase 2: hourly pulls, checkpoints, on-demand refresh -----------------------------------------------------------

test('checkpoints: each mark is frozen at the first pull past it and carried forward; later pulls never overwrite it', () => {
  const first = buildSnapshot({ raws: parseTimeline(timeline([original('10', 3, 36), original('8', 30, 60)])), handle: 'me_acct', pulledAt: NOW });
  assert.deepEqual(Object.keys(first.checkpoints['10']).filter((k) => k !== 'utc'), ['h2']); // 3h old: h2 only
  assert.equal(first.checkpoints['10'].h2.views, 36);
  assert.equal(first.checkpoints['10'].h2.ageHours, 3); // captured late, and says so
  assert.deepEqual(Object.keys(first.checkpoints['8']).filter((k) => k !== 'utc').sort(), ['h2', 'h24']);
  // 22h later the same posts have grown: post 10 crosses 24h, post 8 keeps its earlier h2/h24 and gains nothing new (52h < 72h)
  const later = NOW + 22 * H;
  const raws = parseTimeline(timeline([original('10', 3, 400), original('8', 30, 90)])).map((r) => ({ ...r, createdAt: r.createdAt }));
  const second = buildSnapshot({ raws, handle: 'me_acct', pulledAt: later, prev: first });
  assert.equal(second.checkpoints['10'].h2.views, 36, 'h2 is not overwritten');
  assert.equal(second.checkpoints['10'].h24.views, 400);
  assert.equal(second.checkpoints['8'].h24.views, 60);
  assert.equal(second.checkpoints['8'].h72, undefined);
});

test('shape: posts carry their checkpoints; needsMetrics lists posts with no view count (never zero)', () => {
  const noViews = { ...original('11', 4, 0), _raw: undefined };
  const snap = buildSnapshot({ raws: parseTimeline(timeline([noViews, original('10', 3, 36)])), handle: 'me_acct', pulledAt: NOW });
  const r = shapeRecentPosts(snap, { now: NOW, source: 'bird-live' });
  assert.deepEqual(r.needsMetrics.map((p) => p.id), ['11']);
  assert.equal(r.posts.find((p) => p.id === '10').checkpoints.h2.views, 36);
  assert.equal(r.posts.find((p) => p.id === '11').checkpoints, undefined);
  assert.match(r.checkpointRule, /h2\/h24\/h72/);
});

test('recentPullDue: hourly, sooner when requested after the last pull, never when fresh', () => {
  assert.equal(recentPullDue(null, NOW), 'scheduled');
  assert.equal(recentPullDue({ pulledAt: NOW - 10 * 60_000 }, NOW), false);
  assert.equal(recentPullDue({ pulledAt: NOW - SCHEDULED_PULL_MS }, NOW), 'scheduled');
  assert.equal(recentPullDue({ pulledAt: NOW - 10 * 60_000, refreshRequestedAt: NOW - 60_000 }, NOW), 'requested');
  assert.equal(recentPullDue({ pulledAt: NOW - 60_000, refreshRequestedAt: NOW - 10 * 60_000 }, NOW), false, 'a request older than the pull is served');
});

test('no bird + stale snapshot: asks the Mac worker for a pull, at most once per cooldown; fresh snapshot asks nothing', async () => {
  const mem = createMemoryRecentPostsStore();
  const asked = [];
  const store = { ...mem, async requestRefresh(key, at) { asked.push([key, at]); const s = await mem.get(key); await mem.put(key, { ...s, refreshRequestedAt: at }); } };
  await store.put('c1__me_acct', buildSnapshot({ raws: parseTimeline(fixtureTimeline()), handle: 'me_acct', pulledAt: NOW - 2 * H, clientId: 'c1' }));
  let t = NOW;
  const reader = () => createRecentPostsReader({ runBird: null, store, now: () => t })({ clientId: 'c1', handle: 'me_acct' });
  const a = await reader();
  assert.equal(asked.length, 1);
  assert.match(a.caveats.join(' '), /Requested a fresh pull/);
  assert.equal(a.refreshRequestedAt, new Date(NOW).toISOString());
  t += 60_000;
  const b = await reader();
  assert.equal(asked.length, 1, 'cooldown: no second request');
  assert.match(b.caveats.join(' '), /already requested/);
  t += REFRESH_REQUEST_COOLDOWN_MS;
  await reader();
  assert.equal(asked.length, 2, 'after the cooldown a still-stale snapshot asks again');
  await store.put('c1__me_acct', buildSnapshot({ raws: parseTimeline(fixtureTimeline()), handle: 'me_acct', pulledAt: t - 60_000, clientId: 'c1' }));
  await reader();
  assert.equal(asked.length, 2, 'a fresh snapshot asks nothing');
});

test('live pull carries checkpoints forward from the stored snapshot', async () => {
  const store = createMemoryRecentPostsStore();
  await store.put('c1__me_acct', buildSnapshot({ raws: parseTimeline(timeline([original('8', 30, 60)])), handle: 'me_acct', pulledAt: NOW - 2 * H, clientId: 'c1' }));
  const reader = createRecentPostsReader({ runBird: async () => timeline([original('8', 30, 75)]), store, now: () => NOW, ttlMs: 0 });
  const r = await reader({ clientId: 'c1', handle: 'me_acct' });
  assert.equal(r.source, 'bird-live');
  assert.equal(r.posts[0].views, 75);
  assert.equal(r.posts[0].checkpoints.h24.views, 60, 'the earlier h24 capture survives the new pull');
});
