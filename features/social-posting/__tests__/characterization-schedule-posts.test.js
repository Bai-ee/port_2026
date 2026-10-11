// CHARACTERIZATION: pins CURRENT behaviour of the Schedule Posts paths
// (route actions `schedule`, `post-now`, default draft; schedulePost, postNow,
// the due sweep). The X client is the existing __setXAdapterDepsForTest seam;
// global fetch is a recorder that rejects anything unexpected (the route's
// knowledge-base lookup is caught and non-fatal). Auth is stubbed by patching
// the CJS exports BEFORE the route is imported.
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { createRequire } from 'node:module';
import '../../../app/api/archive/__tests__/esm-next-server-shim.mjs';

const require = createRequire(import.meta.url);
const fb = require('../../../api/_lib/firebase-admin.cjs');
const auth = require('../../../api/_lib/auth.cjs');
const provisioning = require('../../../api/_lib/client-provisioning.cjs');
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');

auth.verifyRequestUser = async () => ({ uid: 'u1', email: 'u@test.dev' });
provisioning.getEffectiveClientContext = async () => ({ clientId: 'c1' });

const { __setXAdapterDepsForTest } = await import('../adapters/x.js');
const svc = await import('../twitter-service.js');
const route = await import('../../../app/api/social-posting/route.js');

let ctx;
let tweets;
let tweetError;
let restoreDeps;
let originalDbDescriptor;
const realFetch = globalThis.fetch;
const raw = (id) => ctx.adminDb._raw('social_posts', id);
const IN_1D = () => new Date(Date.now() + 86_400_000).toISOString();
const AGO_1H = () => new Date(Date.now() - 3_600_000).toISOString();

beforeEach(() => {
  tweets = [];
  tweetError = null;
  originalDbDescriptor = Object.getOwnPropertyDescriptor(fb, 'adminDb');
  ctx = makeFakeContext();
  Object.defineProperty(fb, 'adminDb', { configurable: true, get: () => ctx.adminDb });
  globalThis.fetch = async (url) => { throw new Error(`unexpected network call in test: ${url}`); };
  restoreDeps = __setXAdapterDepsForTest({
    getClient: async () => ({
      authMode: 'oauth2',
      client: {
        v1: { uploadMedia: async () => 'm1' },
        v2: {
          tweet: async (payload) => {
            if (tweetError) throw tweetError;
            tweets.push(payload);
            return { data: { id: `main-${tweets.length}` } };
          },
        },
      },
    }),
    fetchMedia: async () => { throw new Error('no media in these tests'); },
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  restoreDeps();
  Object.defineProperty(fb, 'adminDb', originalDbDescriptor);
});

const call = async (body) => {
  const res = await route.POST(new Request('http://localhost/api/social-posting', {
    method: 'POST',
    headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
};

// ── schedule ────────────────────────────────────────────────────────────────

test('schedule (route): future time => status scheduled, ISO scheduledAt, agents attached, nothing published', async () => {
  const at = IN_1D();
  const res = await call({ action: 'schedule', content: 'Later today.', scheduledAt: at });
  assert.equal(res.status, 200);
  const { post } = res.body;
  assert.equal(post.status, 'scheduled');
  assert.equal(post.scheduledAt, new Date(at).toISOString());
  assert.equal(post.clientId, 'c1');
  assert.equal(post.platform, 'x');
  assert.equal(post.source, 'manual');
  assert.ok(post.agents);
  assert.equal(tweets.length, 0);
  assert.equal(raw(post.id).status, 'scheduled');
});

test('schedule: a time already in the past is stored as queued (still not published until a sweep)', async () => {
  const post = await svc.schedulePost('c1', { content: 'Overdue.', scheduledAt: AGO_1H() });
  assert.equal(post.status, 'queued');
  assert.equal(tweets.length, 0);
});

test('schedule: missing or invalid scheduledAt is 400 and writes nothing', async () => {
  for (const scheduledAt of [undefined, '', 'nope']) {
    const res = await call({ action: 'schedule', content: 'No time.', scheduledAt });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /scheduled time/);
  }
  assert.equal((await svc.readSocialQueue('c1')).length, 0);
});

test('schedule: unreviewed post flagged needsApproval is 409 approval-required; a reviewed one schedules', async () => {
  const res = await call({ action: 'schedule', content: 'Needs review.', scheduledAt: IN_1D(), needsApproval: true });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'approval-required');
  const ok = await svc.schedulePost('c1', { content: 'Reviewed.', scheduledAt: IN_1D(), needsApproval: true, reviewedAt: new Date().toISOString() });
  assert.equal(ok.status, 'scheduled');
});

test('schedule: "[add your memory]" placeholder is refused; >280 chars is 400', async () => {
  await assert.rejects(() => svc.schedulePost('c1', { content: 'Story: [add your memory]', scheduledAt: IN_1D() }), (e) => e.status >= 400 && e.status < 500);
  const res = await call({ action: 'schedule', content: 'x'.repeat(281), scheduledAt: IN_1D() });
  assert.equal(res.status, 400);
});

test('CURRENT (known gap): schedule has no dedupe, spacing, or per-day cap -- identical content at the same instant creates two rows', async () => {
  const at = IN_1D();
  const a = await svc.schedulePost('c1', { content: 'Same text.', scheduledAt: at });
  const b = await svc.schedulePost('c1', { content: 'Same text.', scheduledAt: at });
  assert.notEqual(a.id, b.id);
  assert.equal((await svc.readSocialQueue('c1')).length, 2);
});

test('scheduled row is published by the due sweep only once its time has arrived', async () => {
  const future = await svc.schedulePost('c1', { content: 'Not yet.', scheduledAt: IN_1D() });
  const due = await svc.createSocialPost('c1', { content: 'Due now.', status: 'scheduled', scheduledAt: AGO_1H() });
  const result = await svc.processDuePostsForAllClients();
  assert.equal(result.posted.length, 1);
  assert.deepEqual(tweets.map((t) => t.text), ['Due now.']);
  assert.equal(raw(due.id).status, 'posted');
  assert.equal(raw(future.id).status, 'scheduled');
});

// ── post-now ────────────────────────────────────────────────────────────────

test('post-now (route): publishes via the mock X client and stores a posted row with twitterId + postedAt', async () => {
  const res = await call({ action: 'post-now', content: 'Live now.' });
  assert.equal(res.status, 200);
  assert.equal(res.body.post.status, 'posted');
  assert.equal(res.body.post.twitterId, 'main-1');
  assert.ok(res.body.post.postedAt);
  assert.deepEqual(tweets.map((t) => t.text), ['Live now.']);
  assert.equal(raw(res.body.post.id).status, 'posted');
  assert.equal((await svc.readSocialQueue('c1')).length, 1); // no stray draft row
});

test('post-now failure: row is persisted as failed with the error, and the route surfaces it', async () => {
  tweetError = Object.assign(new Error('bad'), { code: 400, data: { detail: 'nope' } });
  const res = await call({ action: 'post-now', content: 'Will fail.' });
  assert.ok(res.status >= 400);
  assert.ok(res.body.error);
  const rows = await svc.readSocialQueue('c1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'failed');
  assert.ok(rows[0].error);
  assert.equal(tweets.length, 0);
});

test('post-now validation: empty / >280 content rejected before any row or X call; placeholder refused', async () => {
  assert.equal((await call({ action: 'post-now', content: '   ' })).status, 400);
  assert.equal((await call({ action: 'post-now', content: 'x'.repeat(281) })).status, 400);
  await assert.rejects(() => svc.postNow('c1', { content: 'Hi [add your memory]' }), (e) => e.status >= 400 && e.status < 500);
  assert.equal((await svc.readSocialQueue('c1')).length, 0);
  assert.equal(tweets.length, 0);
});

test('CURRENT (known gap): post-now skips the approval gate -- needsApproval content publishes immediately', async () => {
  const post = await svc.postNow('c1', { content: 'No review needed here.', needsApproval: true });
  assert.equal(post.status, 'posted');
  assert.equal(tweets.length, 1);
});

test('CURRENT (known gap): post-now has no idempotency -- the same content posted twice creates two rows and two tweets', async () => {
  await svc.postNow('c1', { content: 'Twice.' });
  await svc.postNow('c1', { content: 'Twice.' });
  assert.equal(tweets.length, 2);
  assert.equal((await svc.readSocialQueue('c1')).length, 2);
});

test('CURRENT (known gap): post-now failure carries no retryable/errorClass classification (only the sweep path does)', async () => {
  tweetError = Object.assign(new Error('rate'), { code: 429 });
  await assert.rejects(() => svc.postNow('c1', { content: 'Rate limited.' }));
  const [row] = await svc.readSocialQueue('c1');
  assert.equal(row.status, 'failed');
  assert.equal(row.retryable, undefined);
  assert.equal(row.errorClass, undefined);
});

// ── default (draft) ─────────────────────────────────────────────────────────

test('default action saves a draft: status draft, no schedule, no X call', async () => {
  const res = await call({ content: 'Just saving.' });
  assert.equal(res.status, 200);
  assert.equal(res.body.post.status, 'draft');
  assert.equal(res.body.post.scheduledAt, null);
  assert.equal(tweets.length, 0);
});

test('default action ignores a client-supplied status (forced to draft)', async () => {
  const res = await call({ content: 'Sneaky.', status: 'posted' });
  assert.equal(res.body.post.status, 'draft');
});
