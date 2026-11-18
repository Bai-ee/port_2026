import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fb = require('../../../api/_lib/firebase-admin.cjs');
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');
const { __setXAdapterDepsForTest } = await import('../adapters/x.js');
const svc = await import('../twitter-service.js');

const BAD = 'Public copy.\n\nINTERNAL VIDEO BRIEF: Capture map; 15s.';
let ctx; let tweets; let restoreDeps; let originalDbDescriptor;
const FUTURE = () => new Date(Date.now() + 24 * 3600 * 1000).toISOString();

beforeEach(() => {
  tweets = [];
  originalDbDescriptor = Object.getOwnPropertyDescriptor(fb, 'adminDb');
  ctx = makeFakeContext();
  ctx.adminDb.batch = () => ({ set() {}, delete() {}, commit: async () => {} });
  Object.defineProperty(fb, 'adminDb', { configurable: true, get: () => ctx.adminDb });
  restoreDeps = __setXAdapterDepsForTest({
    getClient: async () => ({ authMode: 'oauth2', client: { v1: { uploadMedia: async () => 'm1' }, v2: { tweet: async (p) => { tweets.push(p); return { data: { id: 't1' } }; } } } }),
    fetchMedia: async () => { throw new Error('no media'); },
  });
});
afterEach(() => { restoreDeps(); Object.defineProperty(fb, 'adminDb', originalDbDescriptor); });

const seed = (id, content) => ctx.adminDb.collection('social_posts').doc(id).set({ id, clientId: 'c1', platform: 'x', status: 'draft', content, revision: 1, createdAt: new Date().toISOString() });
const refuses = (p) => assert.rejects(p, (e) => e.status === 409 && e.code === 'internal-brief-present');

test('postToTwitter refuses internal-brief content without calling X', async () => {
  await refuses(svc.postToTwitter(BAD, null, { clientId: 'c1' }));
  await refuses(svc.postToTwitter('ok', null, { clientId: 'c1', selfReply: { text: BAD } }));
  assert.equal(tweets.length, 0);
});

test('approveDraft, approveAndSchedule and approveAndPostNow refuse a draft carrying the brief', async () => {
  await seed('p1', BAD);
  await refuses(svc.approveDraft('c1', 'p1'));
  await refuses(svc.approveAndSchedule('c1', 'p1', { scheduledAt: FUTURE() }));
  await refuses(svc.approveAndPostNow('c1', 'p1'));
  await refuses(svc.postNow('c1', { content: BAD }));
  assert.equal(ctx.adminDb._raw('social_posts', 'p1').status, 'draft');
  assert.equal(tweets.length, 0);
});

test('a draft whose brief was stripped still approves', async () => {
  await seed('p2', 'Public copy.');
  const post = await svc.approveDraft('c1', 'p2');
  assert.equal(post.status, 'approved');
});

test('due sweep parks a scheduled row carrying the brief as a draft, without calling X', async () => {
  await ctx.adminDb.collection('social_posts').doc('p3').set({
    id: 'p3', clientId: 'c1', platform: 'x', status: 'scheduled', content: BAD, revision: 1, lifecycleVersion: 1,
    scheduledAt: new Date(Date.now() - 3600 * 1000).toISOString(), createdAt: new Date().toISOString(),
  });
  await svc.processDuePosts('c1');
  const row = ctx.adminDb._raw('social_posts', 'p3');
  assert.equal(row.status, 'draft');
  assert.equal(row.errorClass, 'internal-brief-present');
  assert.match(row.error, /internal-brief-present/);
  assert.equal(tweets.length, 0);
});
