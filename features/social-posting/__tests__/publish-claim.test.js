import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { createRequire } from 'node:module';
import seedRows from '../../x-content-inventory/content-packages.json' with { type: 'json' };

const require = createRequire(import.meta.url);
const fb = require('../../../api/_lib/firebase-admin.cjs');
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');

const { __setXAdapterDepsForTest } = await import('../adapters/x.js');
const svc = await import('../twitter-service.js');
const { upsertPackage } = await import('../../x-content-inventory/store.js');

let ctx;
let tweets;
let tweetError;
let restoreDeps;
let originalDbDescriptor;

const PAST = () => new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h late: due, not stale
const FUTURE = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const MIN_AGO = (n) => new Date(Date.now() - n * 60 * 1000).toISOString();
const raw = (id) => ctx.adminDb._raw('social_posts', id);

beforeEach(() => {
  tweets = [];
  tweetError = null;
  originalDbDescriptor = Object.getOwnPropertyDescriptor(fb, 'adminDb');
  ctx = makeFakeContext();
  // The package store batches its writes; the shared fake has no batch().
  ctx.adminDb.batch = () => {
    const ops = [];
    return { set: (ref, data, o) => ops.push(() => ref.set(data, o)), delete: (ref) => ops.push(() => ref.delete()), commit: async () => { for (const op of ops) await op(); } };
  };
  Object.defineProperty(fb, 'adminDb', { configurable: true, get: () => ctx.adminDb });
  restoreDeps = __setXAdapterDepsForTest({
    getClient: async () => ({
      authMode: 'oauth2',
      client: {
        v1: { uploadMedia: async () => 'm1' },
        v2: {
          tweet: async (payload) => {
            // Yield so two concurrent sweeps genuinely interleave.
            await new Promise((r) => setImmediate(r));
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
  restoreDeps();
  Object.defineProperty(fb, 'adminDb', originalDbDescriptor);
});

const due = (content, extra = {}) => svc.createSocialPost('c1', { content, status: 'scheduled', scheduledAt: PAST(), ...extra });
const pkgRow = (extra = {}) => ({ ...seedRows[1], id: 'pkg-1', status: 'idea', rights: 'owned', ...extra });

test('two concurrent sweeps over the same due post publish exactly once', async () => {
  const post = await due('Only once.');
  const [a, b] = await Promise.all([svc.processDuePostsForAllClients(), svc.processDuePostsForAllClients()]);
  assert.equal(tweets.length, 1);
  assert.equal(a.posted.length + b.posted.length, 1);
  assert.equal(a.skipped.length + b.skipped.length, 1);
  const stored = raw(post.id);
  assert.equal(stored.status, 'posted');
  assert.equal(stored.attempts, 1);
  assert.ok(stored.claimedAt);
  assert.equal(stored.idempotencyKey, post.id);
});

test('claimDuePost refuses a doc that is no longer claimable', async () => {
  const post = await due('Claim me.');
  assert.ok(await svc.claimDuePost(post.id));
  assert.equal(await svc.claimDuePost(post.id), null); // now 'posting'
  assert.equal(await svc.claimDuePost('missing'), null);
});

test('402 CreditsDepleted fails without retry, even on later sweeps', async () => {
  const post = await due('No credits.');
  tweetError = Object.assign(new Error('Payment required'), { code: 402 });
  const first = await svc.processDuePostsForAllClients();
  assert.equal(first.failed.length, 1);
  assert.equal(raw(post.id).retryable, false);
  assert.equal(raw(post.id).errorClass, 'credits-depleted');
  tweetError = null;
  const second = await svc.processDuePostsForAllClients();
  assert.equal(second.posted.length, 0);
  assert.equal(tweets.length, 0);
  assert.equal(raw(post.id).status, 'failed');
});

test('4xx content errors and legacy failed rows are not retried', async () => {
  const post = await due('Bad content.');
  tweetError = Object.assign(new Error('bad'), { code: 400, data: { detail: 'nope' } });
  await svc.processDuePostsForAllClients();
  assert.equal(raw(post.id).retryable, false);
  const legacy = await due('Legacy failure.');
  ctx.adminDb._patch('social_posts', legacy.id, { status: 'failed', error: 'old' }); // no retryable field
  tweetError = null;
  const result = await svc.processDuePostsForAllClients();
  assert.equal(result.posted.length, 0);
  assert.equal(tweets.length, 0);
});

test('only failures that prove X rejected the post retry, capped at 3 attempts', async () => {
  for (const err of [
    Object.assign(new Error('rate'), { code: 429 }),
    new Error('getaddrinfo ENOTFOUND api.x.com'),
  ]) {
    const post = await due(`Transient ${err.message}`);
    tweetError = err;
    await svc.processDuePostsForAllClients({ maxPerRun: 10 });
    assert.equal(raw(post.id).status, 'failed');
    assert.equal(raw(post.id).retryable, true, err.message);
    ctx.adminDb._patch('social_posts', post.id, { status: 'posted' }); // park so the next case is isolated
  }

  // Ambiguous: X may have accepted the post — never auto-retried.
  for (const err of [
    Object.assign(new Error('boom'), { code: 503 }),
    new Error('read ECONNRESET'),
    new Error('ETIMEDOUT'),
  ]) {
    const post = await due(`Ambiguous ${err.message}`);
    tweetError = err;
    await svc.processDuePostsForAllClients({ maxPerRun: 10 });
    await svc.processDuePostsForAllClients({ maxPerRun: 10 });
    assert.equal(raw(post.id).status, 'failed');
    assert.equal(raw(post.id).retryable, false, err.message);
    assert.equal(raw(post.id).attempts, 1, err.message);
    ctx.adminDb._patch('social_posts', post.id, { status: 'posted' });
  }

  const post = await due('Retry until the cap.');
  tweetError = Object.assign(new Error('rate'), { code: 429 });
  for (let i = 0; i < 5; i += 1) await svc.processDuePostsForAllClients({ maxPerRun: 10 });
  assert.equal(raw(post.id).attempts, 3);
  assert.equal(raw(post.id).status, 'failed');

  // A retry that finally works clears the failure.
  const ok = await due('Recovers.');
  tweetError = Object.assign(new Error('rate'), { code: 429 });
  await svc.processDuePostsForAllClients({ maxPerRun: 10 });
  const before = tweets.length;
  tweetError = null;
  await svc.processDuePostsForAllClients({ maxPerRun: 10 });
  assert.equal(raw(ok.id).status, 'posted');
  assert.equal(raw(ok.id).attempts, 2);
  assert.ok(tweets.length > before);
});

test('stale posting claim is marked needs_review and never republished', async () => {
  const post = await due('Maybe live already.');
  ctx.adminDb._patch('social_posts', post.id, { status: 'posting', claimedAt: MIN_AGO(20), attempts: 1 });
  const fresh = await due('Being published right now.');
  ctx.adminDb._patch('social_posts', fresh.id, { status: 'posting', claimedAt: MIN_AGO(2), attempts: 1 });
  const result = await svc.processDuePostsForAllClients();
  assert.equal(tweets.length, 0);
  assert.deepEqual(result.needsReview.map((p) => p.id), [post.id]);
  assert.equal(raw(post.id).status, 'needs_review');
  assert.match(raw(post.id).error, /may already be live/);
  assert.equal(raw(fresh.id).status, 'posting');
  const again = await svc.processDuePostsForAllClients();
  assert.equal(tweets.length, 0);
  assert.equal(again.needsReview.length, 0);
});

test('maxPerRun is honored and the rest stay due', async () => {
  for (let i = 0; i < 5; i += 1) await due(`Post ${i}`, { scheduledAt: new Date(Date.now() - (90 - i) * 60000).toISOString() });
  const first = await svc.processDuePostsForAllClients(); // default cap = 3
  assert.equal(first.posted.length, 3);
  assert.equal(first.deferred, 2);
  assert.equal(tweets.length, 3);
  assert.deepEqual(tweets.map((t) => t.text), ['Post 0', 'Post 1', 'Post 2']); // oldest first
  const second = await svc.processDuePostsForAllClients({ maxPerRun: 1 });
  assert.equal(second.posted.length, 1);
  assert.equal(second.deferred, 1);
});

test('drafts and approved posts with scheduledAt:null are never picked up', async () => {
  const draft = await svc.createSocialPost('c1', { content: 'Seeded draft.', status: 'draft' });
  const approved = await svc.approveDraft('c1', (await svc.createSocialPost('c1', { content: 'Approved, unscheduled.', status: 'draft' })).id);
  assert.equal(draft.scheduledAt, null);
  const result = await svc.processDuePostsForAllClients();
  assert.equal(tweets.length, 0);
  assert.equal(result.posted.length + result.failed.length + result.skipped.length, 0);
  assert.equal(raw(draft.id).status, 'draft');
  assert.equal(raw(approved.id).status, 'approved');
});

test('approve-draft stamps reviewedAt/reviewedBy, is idempotent, and only accepts drafts', async () => {
  const d = await svc.createSocialPost('c1', { content: 'Ready for review.', status: 'draft', packageId: 'p', engine: 'record', campaign: 'c', priority: 'timely' });
  assert.equal(d.packageId, 'p');
  assert.equal(d.engine, 'record');
  assert.equal(d.campaign, 'c');
  assert.equal(d.priority, 'timely');
  const a = await svc.approveDraft('c1', d.id, { reviewedBy: 'owner@test' });
  assert.equal(a.status, 'approved');
  assert.equal(a.reviewedBy, 'owner@test');
  assert.ok(a.reviewedAt);
  assert.equal((await svc.approveDraft('c1', d.id)).reviewedAt, a.reviewedAt);
  const scheduled = await due('Already scheduled.');
  await assert.rejects(svc.approveDraft('c1', scheduled.id), { status: 409 });
  const story = await svc.createSocialPost('c1', { content: 'Needs the story [add your memory]', status: 'draft' });
  await assert.rejects(svc.approveDraft('c1', story.id));
  await assert.rejects(svc.approveDraft('c1', 'nope'), { status: 404 });
});

test('a draft can still be scheduled directly (backward compatible) when no approval is required', async () => {
  const d = await svc.createSocialPost('c1', { content: 'Plain draft.', status: 'draft' });
  const u = await svc.updateSocialPost('c1', d.id, { content: 'Plain draft.', scheduledAt: FUTURE() });
  assert.equal(u.status, 'scheduled');
  const s = await svc.schedulePost('c1', { content: 'Direct schedule.', scheduledAt: FUTURE() });
  assert.equal(s.status, 'scheduled');
});

test('a post whose package needs client approval cannot be scheduled until approved', async () => {
  await upsertPackage(pkgRow({ id: 'pkg-client', rights: 'client-approval-needed' }), { returnPackages: false });
  const d = await svc.createSocialPost('c1', { content: 'Client story.', status: 'draft', packageId: 'pkg-client' });
  await assert.rejects(svc.updateSocialPost('c1', d.id, { scheduledAt: FUTURE() }), { status: 409, code: 'approval-required' });
  await assert.rejects(svc.schedulePost('c1', { content: 'Direct.', packageId: 'pkg-client', scheduledAt: FUTURE() }), { code: 'approval-required' });
  assert.equal(raw(d.id).status, 'draft');

  await svc.approveDraft('c1', d.id, { reviewedBy: 'owner' });
  const u = await svc.updateSocialPost('c1', d.id, { scheduledAt: FUTURE() });
  assert.equal(u.status, 'scheduled');
  // Unscheduling returns it to approved, not to an unreviewed draft.
  const back = await svc.updateSocialPost('c1', d.id, { scheduledAt: null });
  assert.equal(back.status, 'approved');
  // Editing the text voids the approval.
  const edited = await svc.updateSocialPost('c1', d.id, { content: 'Client story, reworded.' });
  assert.equal(edited.status, 'draft');
  assert.equal(edited.reviewedAt, null);
});

test('post-level needsApproval blocks scheduling the same way', async () => {
  const d = await svc.createSocialPost('c1', { content: 'Flagged.', status: 'draft', needsApproval: true });
  await assert.rejects(svc.updateSocialPost('c1', d.id, { scheduledAt: FUTURE() }), { code: 'approval-required' });
});

test('an approved package (approval.state) no longer blocks scheduling', async () => {
  await upsertPackage(pkgRow({ id: 'pkg-ok', rights: 'client-approval-needed', approval: { state: 'approved' } }), { returnPackages: false });
  const d = await svc.createSocialPost('c1', { content: 'Cleared.', status: 'draft', packageId: 'pkg-ok' });
  const u = await svc.updateSocialPost('c1', d.id, { scheduledAt: FUTURE() });
  assert.equal(u.status, 'scheduled');
});

test('publishing stamps the linked package (lastPostedAt, postCount, lastTwitterId, status)', async () => {
  await upsertPackage(pkgRow({ id: 'pkg-wb' }), { returnPackages: false });
  const post = await due('Write-back.', { packageId: 'pkg-wb' });
  await svc.processDuePostsForAllClients();
  const pkg = ctx.adminDb._raw('x_content_packages', 'pkg-wb');
  assert.equal(pkg.status, 'posted');
  assert.equal(pkg.postCount, 1);
  assert.equal(pkg.lastTwitterId, raw(post.id).twitterId);
  assert.equal(pkg.lastPostedAt, raw(post.id).postedAt);
});

test('a missing package never fails the publish', async () => {
  const post = await due('Orphan link.', { packageId: 'does-not-exist' });
  const result = await svc.processDuePostsForAllClients();
  assert.equal(result.posted.length, 1);
  assert.equal(raw(post.id).status, 'posted');
});

test('stale due posts expire with the 26h wording', async () => {
  const post = await due('Way too old.', { scheduledAt: new Date(Date.now() - 30 * 3600 * 1000).toISOString() });
  await svc.processDuePostsForAllClients();
  assert.equal(tweets.length, 0);
  assert.equal(raw(post.id).status, 'expired');
  assert.match(raw(post.id).error, /26h/);
});
