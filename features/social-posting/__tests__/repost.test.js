import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fb = require('../../../api/_lib/firebase-admin.cjs');
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');

const { __setXAdapterDepsForTest } = await import('../adapters/x.js');
const { parseTweetRef, sanitizeRepostOf, repostLabel } = await import('../repost.js');
const svc = await import('../twitter-service.js');

let calls;
let restoreDeps;
let originalDbDescriptor;
let accountUserId;

function makeMockClient() {
  return {
    v2: {
      me: async () => { calls.me += 1; return { data: { id: 'me-1' } }; },
      retweet: async (userId, tweetId) => { calls.retweets.push([userId, tweetId]); return { data: { retweeted: true } }; },
      tweet: async (payload) => { calls.tweets.push(payload); return { data: { id: 'should-not-happen' } }; },
    },
  };
}

beforeEach(() => {
  calls = { retweets: [], tweets: [], me: 0 };
  accountUserId = 'u1';
  originalDbDescriptor = Object.getOwnPropertyDescriptor(fb, 'adminDb');
  const ctx = makeFakeContext();
  Object.defineProperty(fb, 'adminDb', { configurable: true, get: () => ctx.adminDb });
  restoreDeps = __setXAdapterDepsForTest({
    getClient: async () => ({ client: makeMockClient(), authMode: 'oauth2' }),
    getAccount: async () => ({ userId: accountUserId }),
  });
});

afterEach(() => {
  restoreDeps();
  Object.defineProperty(fb, 'adminDb', originalDbDescriptor);
});

test('parseTweetRef accepts status URLs and bare ids, rejects junk', () => {
  assert.deepEqual(parseTweetRef('https://x.com/seb__design/status/1234567890123'), { tweetId: '1234567890123', url: 'https://x.com/seb__design/status/1234567890123', author: 'seb__design' });
  assert.equal(parseTweetRef('https://twitter.com/bai_ee/statuses/9876543210?s=20').tweetId, '9876543210');
  assert.equal(parseTweetRef('https://x.com/i/status/555555555').author, null);
  assert.equal(parseTweetRef('1234567890').url, 'https://x.com/i/status/1234567890');
  assert.equal(parseTweetRef('https://x.com/bai_ee'), null);
  assert.equal(parseTweetRef('not a tweet'), null);
  assert.equal(parseTweetRef(''), null);
});

test('sanitizeRepostOf + repostLabel', () => {
  const ref = sanitizeRepostOf({ url: 'https://x.com/seb__design/status/1234567890123', text: 'hello' });
  assert.deepEqual(ref, { tweetId: '1234567890123', url: 'https://x.com/seb__design/status/1234567890123', author: 'seb__design', text: 'hello' });
  assert.equal(repostLabel(ref), 'Repost @seb__design https://x.com/seb__design/status/1234567890123');
  assert.equal(sanitizeRepostOf({ url: 'nope' }), null);
  assert.equal(sanitizeRepostOf(null), null);
});

test('post-now on a repost row retweets the target and never creates a tweet', async () => {
  const post = await svc.postNow('c1', { kind: 'repost', repostOf: { url: 'https://x.com/seb__design/status/1234567890123' }, source: 'manual' });
  assert.deepEqual(calls.retweets, [['u1', '1234567890123']]);
  assert.equal(calls.tweets.length, 0);
  assert.equal(calls.me, 0);
  assert.equal(post.kind, 'repost');
  assert.equal(post.status, 'posted');
  assert.equal(post.twitterId, '1234567890123');
  assert.equal(post.content, 'Repost @seb__design https://x.com/seb__design/status/1234567890123');
  assert.equal(post.repostOf.tweetId, '1234567890123');
});

test('repost resolves the user id via v2.me() only when the stored account has none', async () => {
  accountUserId = null;
  await svc.postNow('c1', { kind: 'repost', repostOf: { tweetId: '1234567890123' } });
  assert.equal(calls.me, 1);
  assert.deepEqual(calls.retweets, [['me-1', '1234567890123']]);
});

test('a repost without a valid target is rejected with 400 before any write', async () => {
  await assert.rejects(() => svc.postNow('c1', { kind: 'repost', repostOf: { url: 'https://x.com/bai_ee' } }), (err) => err.status === 400);
  await assert.rejects(() => svc.postNow('c1', { kind: 'repost' }), (err) => err.status === 400);
  assert.equal(calls.retweets.length, 0);
});

test('a plain post row keeps its exact legacy shape (no kind / repostOf keys)', async () => {
  const post = await svc.createSocialPost('c1', { content: 'plain text post' });
  assert.equal('kind' in post, false);
  assert.equal('repostOf' in post, false);
});

test('a scheduled repost is published by the due sweep through the retweet call', async () => {
  const past = new Date(Date.now() - 60 * 1000).toISOString();
  const row = await svc.schedulePost('c1', { kind: 'repost', repostOf: { tweetId: '1234567890123' }, scheduledAt: past });
  assert.equal(row.kind, 'repost');
  const result = await svc.processDuePosts('c1');
  assert.equal(calls.retweets.length, 1);
  assert.equal(calls.tweets.length, 0);
  const posted = (result.posted || []).find((p) => p.id === row.id);
  assert.ok(posted, 'repost row should be in posted');
  assert.equal(posted.twitterId, '1234567890123');
});
