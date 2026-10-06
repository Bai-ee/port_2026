import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fb = require('../../../api/_lib/firebase-admin.cjs');
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');

const { __setXAdapterDepsForTest } = await import('../adapters/x.js');
const svc = await import('../twitter-service.js');

const VIDEO = { mediaUrl: 'https://cdn.test/main.mp4', mediaType: 'video', mediaContentType: 'video/mp4' };
const REPLY = { text: 'On Discogs: https://www.discogs.com/release/1', mediaUrl: 'https://cdn.test/label.jpg', mediaType: 'image', mediaContentType: 'image/jpeg' };

let calls;
let failReplyTweets;
let restoreDeps;
let originalDbDescriptor;

function makeMockClient() {
  let n = 0;
  return {
    v1: { uploadMedia: async (buf, opts) => { calls.uploads.push({ via: 'v1', mimeType: opts.mimeType, size: buf.length }); return `m${++n}`; } },
    v2: {
      uploadMedia: async (buf, opts) => { calls.uploads.push({ via: 'v2', mimeType: opts.media_type, category: opts.media_category, size: buf.length }); return `m${++n}`; },
      tweet: async (payload) => {
        if (payload.reply && failReplyTweets) throw Object.assign(new Error('Request failed with code 403'), { code: 403, data: { detail: 'reply denied' } });
        calls.tweets.push(payload);
        return { data: { id: payload.reply ? `reply-${calls.tweets.length}` : `main-${calls.tweets.length}` } };
      },
    },
  };
}

beforeEach(() => {
  calls = { uploads: [], tweets: [] };
  failReplyTweets = false;
  originalDbDescriptor = Object.getOwnPropertyDescriptor(fb, 'adminDb');
  const ctx = makeFakeContext();
  Object.defineProperty(fb, 'adminDb', { configurable: true, get: () => ctx.adminDb });
  restoreDeps = __setXAdapterDepsForTest({
    getClient: async () => ({ client: makeMockClient(), authMode: process.env.TEST_AUTH_MODE || 'oauth2' }),
    fetchMedia: async (media) => {
      const isVideo = String(media.mediaContentType).startsWith('video/');
      return { buffer: Buffer.alloc(isVideo ? 2048 : 16), mimeType: media.mediaContentType, isVideo };
    },
  });
});

afterEach(() => {
  restoreDeps();
  Object.defineProperty(fb, 'adminDb', originalDbDescriptor);
  delete process.env.TEST_AUTH_MODE;
});

const payload = (extra = {}) => ({ content: 'Artist - Title\nLabel - CAT - 1999\nA real memory.', ...VIDEO, selfReply: REPLY, ...extra });

test('post-now posts main with video then reply with image under the main id', async () => {
  const post = await svc.postNow('c1', payload());
  assert.equal(calls.tweets.length, 2);
  assert.deepEqual(calls.tweets[0].media.media_ids.length, 1);
  assert.equal(calls.tweets[0].reply, undefined);
  assert.equal(calls.tweets[1].reply.in_reply_to_tweet_id, 'main-1');
  assert.equal(calls.tweets[1].text, REPLY.text);
  assert.equal(post.status, 'posted');
  assert.equal(post.twitterId, 'main-1');
  assert.equal(post.selfReplyTwitterId, 'reply-2');
  assert.ok(post.selfReplyPostedAt);
  assert.equal(post.selfReplyError, null);
});

test('media routing: video main uses tweet_video, image reply uses tweet_image', async () => {
  await svc.postNow('c1', payload());
  assert.deepEqual(calls.uploads.map((u) => [u.mimeType, u.category]), [['video/mp4', 'tweet_video'], ['image/jpeg', 'tweet_image']]);
});

test('media routing on oauth1 goes through v1 with the right mime types', async () => {
  process.env.TEST_AUTH_MODE = 'oauth1';
  await svc.postNow('c1', payload());
  assert.deepEqual(calls.uploads.map((u) => [u.via, u.mimeType]), [['v1', 'video/mp4'], ['v1', 'image/jpeg']]);
});

test('reply failure keeps main posted, records selfReplyError, never throws', async () => {
  failReplyTweets = true;
  const post = await svc.postNow('c1', payload());
  assert.equal(post.status, 'posted');
  assert.equal(post.twitterId, 'main-1');
  assert.equal(post.selfReplyTwitterId, null);
  assert.ok(post.selfReplyError);
  assert.equal(calls.tweets.length, 1);
});

test('retry-self-reply posts only the reply; second retry is a no-op', async () => {
  failReplyTweets = true;
  const post = await svc.postNow('c1', payload());
  failReplyTweets = false;
  const retried = await svc.retrySelfReply('c1', post.id);
  assert.equal(calls.tweets.length, 2);
  assert.equal(calls.tweets[1].reply.in_reply_to_tweet_id, 'main-1');
  assert.equal(retried.twitterId, 'main-1');
  assert.equal(retried.selfReplyTwitterId, 'reply-2');
  assert.equal(retried.selfReplyError, null);
  const again = await svc.retrySelfReply('c1', post.id);
  assert.equal(calls.tweets.length, 2);
  assert.equal(again.selfReplyTwitterId, 'reply-2');
});

test('failed retry records the error and keeps status posted', async () => {
  failReplyTweets = true;
  const post = await svc.postNow('c1', payload());
  await assert.rejects(() => svc.retrySelfReply('c1', post.id));
  const stored = await svc.getSocialPost('c1', post.id);
  assert.equal(stored.status, 'posted');
  assert.ok(stored.selfReplyError);
  assert.equal(stored.selfReplyTwitterId, null);
});

test('retry refuses when the main post is not live', async () => {
  const draft = await svc.createSocialPost('c1', payload({ status: 'draft' }));
  await assert.rejects(() => svc.retrySelfReply('c1', draft.id), (e) => e.status === 409);
  assert.equal(calls.tweets.length, 0);
});

test('placeholder guard blocks post-now and schedule with 409 and no X call', async () => {
  const content = 'Artist - Title\n[add your memory]';
  await assert.rejects(() => svc.postNow('c1', payload({ content })), (e) => e.status === 409);
  await assert.rejects(() => svc.schedulePost('c1', payload({ content, scheduledAt: new Date(Date.now() + 3600e3).toISOString() })), (e) => e.status === 409);
  assert.equal(calls.tweets.length, 0);
});

test('process-due skips and parks placeholder posts, posts clean ones with reply, and never re-posts main', async () => {
  const past = new Date(Date.now() - 60e3).toISOString();
  const bad = await svc.createSocialPost('c1', payload({ content: 'x\n[add your memory]', status: 'scheduled', scheduledAt: past }));
  const good = await svc.createSocialPost('c1', payload({ status: 'scheduled', scheduledAt: past }));
  const out = await svc.processDuePosts('c1');
  assert.equal(out.posted.length, 1);
  assert.equal(out.posted[0].id, good.id);
  assert.equal(out.posted[0].selfReplyTwitterId, 'reply-2');
  const parked = await svc.getSocialPost('c1', bad.id);
  assert.equal(parked.status, 'draft');
  assert.match(parked.error, /add your memory/);
  assert.equal(calls.tweets.length, 2);
  // a second sweep finds nothing due: no double main, no double reply
  const second = await svc.processDuePosts('c1');
  assert.equal(second.posted.length + second.failed.length, 0);
  assert.equal(calls.tweets.length, 2);
});

test('due-sweep retry of a partial post with a main id posts only the reply', async () => {
  failReplyTweets = true;
  const past = new Date(Date.now() - 60e3).toISOString();
  const p = await svc.createSocialPost('c1', payload({ status: 'scheduled', scheduledAt: past }));
  await svc.processDuePosts('c1');
  assert.equal(calls.tweets.length, 1);
  failReplyTweets = false;
  const r = await svc.retrySelfReply('c1', p.id);
  assert.equal(r.selfReplyTwitterId, 'reply-2');
  assert.equal(calls.tweets.filter((t) => !t.reply).length, 1);
});

test('plain post without selfReply is unchanged (no reply fields added)', async () => {
  const post = await svc.postNow('c1', { content: 'hello world', ...VIDEO });
  assert.equal(calls.tweets.length, 1);
  assert.equal('selfReplyTwitterId' in post, false);
});
