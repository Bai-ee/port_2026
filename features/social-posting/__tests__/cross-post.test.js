import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { createRequire } from 'node:module';
import {
  postTargets, normalizeTargets, instagramBlockReason, instagramPayloadFor, deliverInstagram,
} from '../cross-post.js';

const require = createRequire(import.meta.url);
const fb = require('../../../api/_lib/firebase-admin.cjs');
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');

const { __setXAdapterDepsForTest } = await import('../adapters/x.js');
const svc = await import('../twitter-service.js');

const ACCOUNT = { accessToken: 'ig-token', userId: '1784', username: 'bai__ee', expiresAt: Date.now() + 30 * 86_400_000 };
const IMG = { mediaUrl: 'https://cdn.example/a.jpg', mediaType: 'image', mediaContentType: 'image/jpeg' };

// ── pure ─────────────────────────────────────────────────────────────────────
test('postTargets: legacy rows are X only; stored targets are honoured', () => {
  assert.deepEqual(postTargets({}), { x: true, instagram: false });
  assert.deepEqual(postTargets({ targets: { x: false, instagram: true } }), { x: false, instagram: true });
  assert.deepEqual(postTargets({ targets: { instagram: true } }), { x: true, instagram: true });
});

test('normalizeTargets refuses an empty selection', () => {
  assert.throws(() => normalizeTargets({ x: false, instagram: false }), /at least one network/);
  assert.throws(() => normalizeTargets(null), /targets must be an object/);
  assert.deepEqual(normalizeTargets({ x: true, instagram: 'yes' }), { x: true, instagram: false });
});

test('instagramBlockReason: not enabled, no account, expired, text-only, repost', () => {
  const post = { ...IMG, content: 'hi' };
  assert.match(instagramBlockReason(post, ACCOUNT, { live: false }), /not live/);
  assert.match(instagramBlockReason(post, null, { live: true }), /Connect this client/);
  assert.match(instagramBlockReason(post, { ...ACCOUNT, expiresAt: Date.now() - 1 }, { live: true }), /expired/);
  assert.match(instagramBlockReason({ content: 'text only' }, ACCOUNT, { live: true }), /image or video/);
  assert.match(instagramBlockReason({ ...post, kind: 'repost' }, ACCOUNT, { live: true }), /repost/);
  assert.equal(instagramBlockReason(post, ACCOUNT, { live: true }), '');
});

test('instagramPayloadFor: video -> reel, image -> image, caption = post text', () => {
  assert.deepEqual(instagramPayloadFor({ content: 'c' }, { mediaUrl: 'https://v.mp4', mediaType: 'video' }), { mediaType: 'reel', mediaUrl: 'https://v.mp4', caption: 'c' });
  assert.deepEqual(instagramPayloadFor({ content: 'c' }, { mediaUrl: 'https://v', mediaContentType: 'video/mp4' }).mediaType, 'reel');
  assert.deepEqual(instagramPayloadFor({ content: 'c' }, IMG), { mediaType: 'image', mediaUrl: IMG.mediaUrl, caption: 'c' });
});

test('deliverInstagram: posted, idempotent, blocked, failed, ambiguous', async () => {
  const post = { clientId: 'c1', content: 'hi', ...IMG };
  const getAccount = async () => ACCOUNT;
  const calls = [];
  const ok = await deliverInstagram(post, { getAccount, live: true, publish: async (p, o) => { calls.push([p, o]); return { instagramMediaId: '999', containerId: '888' }; } });
  assert.equal(ok.status, 'posted');
  assert.equal(ok.mediaId, '999');
  assert.equal(calls[0][1].igUserId, '1784');
  assert.equal(calls[0][1].allowNotLive, true);

  const again = await deliverInstagram({ ...post, instagramDelivery: ok }, { getAccount, live: true, publish: async () => { throw new Error('must not publish twice'); } });
  assert.equal(again.mediaId, '999');

  const blocked = await deliverInstagram({ clientId: 'c1', content: 'text' }, { getAccount, live: true, publish: async () => { throw new Error('nope'); } });
  assert.equal(blocked.status, 'blocked');

  const failed = await deliverInstagram(post, { getAccount, live: true, publish: async () => { throw Object.assign(new Error('bad media'), { code: 'ig-rejected' }); } });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.errorCode, 'ig-rejected');

  const unknown = await deliverInstagram(post, { getAccount, live: true, publish: async () => { throw Object.assign(new Error('timeout'), { ambiguous: true }); } });
  assert.equal(unknown.status, 'needs_review');
  assert.match(unknown.error, /Check @bai__ee/);
});

// ── sweep integration (fake Firestore) ───────────────────────────────────────
let ctx;
let tweets;
let igCalls;
let igResult;
let account;
let restoreX;
let originalDb;
const PAST = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();
const raw = (id) => ctx.adminDb._raw('social_posts', id);

beforeEach(() => {
  tweets = [];
  igCalls = [];
  igResult = async () => ({ instagramMediaId: 'ig-1', containerId: 'ct-1' });
  account = ACCOUNT;
  originalDb = Object.getOwnPropertyDescriptor(fb, 'adminDb');
  ctx = makeFakeContext();
  Object.defineProperty(fb, 'adminDb', { configurable: true, get: () => ctx.adminDb });
  restoreX = __setXAdapterDepsForTest({
    getClient: async () => ({
      authMode: 'oauth2',
      client: {
        v1: { uploadMedia: async () => 'm1' },
        v2: { uploadMedia: async () => 'm1', tweet: async (payload) => { tweets.push(payload); return { data: { id: `x-${tweets.length}` } }; } },
      },
    }),
    fetchMedia: async () => ({ buffer: Buffer.alloc(16), mimeType: 'image/jpeg', isVideo: false }),
  });
  svc.__setInstagramLegDepsForTest({
    getAccount: async () => account,
    publish: async (payload, opts) => { igCalls.push({ payload, opts }); return igResult(); },
  });
});

afterEach(() => {
  restoreX();
  svc.__setInstagramLegDepsForTest(null);
  Object.defineProperty(fb, 'adminDb', originalDb);
});

const due = (extra = {}) => svc.createSocialPost('c1', { content: 'Hello', status: 'scheduled', scheduledAt: PAST(), ...extra });

test('sweep: a legacy row (no targets) posts to X only', async () => {
  const post = await due(IMG);
  await svc.processDuePostsForAllClients();
  assert.equal(tweets.length, 1);
  assert.equal(igCalls.length, 0);
  assert.equal(raw(post.id).status, 'posted');
  assert.equal(raw(post.id).instagramDelivery, undefined);
});

test('sweep: X + Instagram posts both and records the Instagram leg', async () => {
  const post = await due(IMG);
  await svc.setPostTargets('c1', post.id, { x: true, instagram: true });
  await svc.processDuePostsForAllClients();
  const row = raw(post.id);
  assert.equal(tweets.length, 1);
  assert.equal(igCalls.length, 1);
  assert.equal(igCalls[0].payload.caption, 'Hello');
  assert.equal(row.status, 'posted');
  assert.equal(row.twitterId, 'x-1');
  assert.equal(row.instagramDelivery.status, 'posted');
  assert.equal(row.instagramDelivery.mediaId, 'ig-1');
});

test('sweep: Instagram only never calls X and the row is posted', async () => {
  const post = await due(IMG);
  await svc.setPostTargets('c1', post.id, { x: false, instagram: true });
  await svc.processDuePostsForAllClients();
  const row = raw(post.id);
  assert.equal(tweets.length, 0);
  assert.equal(igCalls.length, 1);
  assert.equal(row.status, 'posted');
  assert.equal(row.twitterId ?? null, null);
});

test('sweep: an Instagram failure never fails a published X post', async () => {
  igResult = async () => { throw Object.assign(new Error('Media URL not reachable'), { code: 'ig-rejected' }); };
  const post = await due(IMG);
  await svc.setPostTargets('c1', post.id, { x: true, instagram: true });
  await svc.processDuePostsForAllClients();
  const row = raw(post.id);
  assert.equal(row.status, 'posted');
  assert.equal(row.instagramDelivery.status, 'failed');
  assert.match(row.instagramDelivery.error, /not reachable/);
});

test('sweep: Instagram-only with an unknown outcome parks the row for review', async () => {
  igResult = async () => { throw Object.assign(new Error('timeout'), { ambiguous: true }); };
  const post = await due(IMG);
  await svc.setPostTargets('c1', post.id, { x: false, instagram: true });
  await svc.processDuePostsForAllClients();
  const row = raw(post.id);
  assert.equal(row.status, 'needs_review');
  assert.equal(row.errorClass, 'instagram-needs_review');
});

test('setPostTargets: refuses Instagram for text-only posts or without a connected account; keeps the schedule', async () => {
  const text = await due();
  await assert.rejects(() => svc.setPostTargets('c1', text.id, { x: true, instagram: true }), /image or video/);
  account = null;
  const img = await due(IMG);
  await assert.rejects(() => svc.setPostTargets('c1', img.id, { x: true, instagram: true }), /Connect this client/);
  account = ACCOUNT;
  const saved = await svc.setPostTargets('c1', img.id, { x: true, instagram: true });
  assert.deepEqual(saved.targets, { x: true, instagram: true });
  assert.equal(saved.status, 'scheduled');
  assert.equal(saved.scheduledAt, img.scheduledAt);
  await assert.rejects(() => svc.setPostTargets('c1', img.id, { x: false, instagram: false }), /at least one network/);
});

test('getPostTargetOptions reports availability and the reason', async () => {
  const text = await due();
  const opts = await svc.getPostTargetOptions('c1', text.id);
  assert.deepEqual(opts.targets, { x: true, instagram: false });
  assert.equal(opts.instagram.available, false);
  assert.match(opts.instagram.reason, /image or video/);
  const img = await due(IMG);
  const ok = await svc.getPostTargetOptions('c1', img.id);
  assert.equal(ok.instagram.available, true);
  assert.equal(ok.instagram.username, 'bai__ee');
});
