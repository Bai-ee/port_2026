// CHARACTERIZATION tests: pin what the social_posts lifecycle does TODAY, not
// what it should do. Cases already pinned by publish-claim.test.js (concurrent
// sweeps, claim refusal, 402/4xx no-retry, 429 cap, stale claim, expiry, maxPerRun,
// approval gates, package write-back) are intentionally not repeated here.
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fb = require('../../../api/_lib/firebase-admin.cjs');
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');

const { __setXAdapterDepsForTest } = await import('../adapters/x.js');
const svc = await import('../twitter-service.js');

let ctx;
let tweets;
let tweetError;
let restoreDeps;
let originalDbDescriptor;

const PAST = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();
const FUTURE = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const raw = (id) => ctx.adminDb._raw('social_posts', id);

beforeEach(() => {
  tweets = [];
  tweetError = null;
  originalDbDescriptor = Object.getOwnPropertyDescriptor(fb, 'adminDb');
  ctx = makeFakeContext();
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

test('createSocialPost: draft defaults, random social_ id, clientId stamped, persisted', async () => {
  const p = await svc.createSocialPost('c1', { content: 'Hello  world' });
  assert.match(p.id, /^social_/);
  assert.equal(p.clientId, 'c1');
  assert.equal(p.status, 'draft');
  assert.equal(p.platform, 'x');
  assert.equal(p.source, 'manual');
  assert.equal(p.scheduledAt, null);
  assert.equal(p.replyTo, null);
  assert.equal(p.twitterId, null);
  assert.equal(p.attempts, 0);
  assert.equal(p.needsApproval, false);
  assert.equal(p.needsStory, false);
  assert.equal(p.performance, null);
  assert.deepEqual(raw(p.id), p);
});

test('CURRENT: createSocialPost has no idempotency - same payload twice yields two rows with different ids', async () => {
  const a = await svc.createSocialPost('c1', { content: 'Same text.' });
  const b = await svc.createSocialPost('c1', { content: 'Same text.' });
  assert.notEqual(a.id, b.id);
  assert.equal((await svc.readSocialQueue('c1')).length, 2);
});

test('createSocialPost rejects empty and >280 content with status 400', async () => {
  await assert.rejects(svc.createSocialPost('c1', { content: '   ' }), { status: 400 });
  await assert.rejects(svc.createSocialPost('c1', { content: 'x'.repeat(281) }), { status: 400 });
});

test('createDraftPostOnce: second call returns the existing row, one row only, status forced to draft', async () => {
  // The shared fake has no DocumentReference.create(); shim it with Firestore's semantics (6 = ALREADY_EXISTS).
  const origCollection = ctx.adminDb.collection.bind(ctx.adminDb);
  ctx.adminDb.collection = (name) => {
    const col = origCollection(name);
    const origDoc = col.doc.bind(col);
    col.doc = (docId) => {
      const ref = origDoc(docId);
      ref.create = async (data) => {
        if ((await ref.get()).exists) throw Object.assign(new Error('already exists'), { code: 6 });
        await ref.set(data);
      };
      return ref;
    };
    return col;
  };
  const id = 'social_charlifecycle01';
  const first = await svc.createDraftPostOnce('c1', id, { content: 'First.', status: 'scheduled', scheduledAt: FUTURE() });
  assert.equal(first.existing, false);
  assert.equal(first.post.status, 'draft');
  assert.equal(first.post.scheduledAt, null);
  const second = await svc.createDraftPostOnce('c1', id, { content: 'Different text.' });
  assert.equal(second.existing, true);
  assert.equal(second.post.content, 'First.');
  assert.equal((await svc.readSocialQueue('c1')).length, 1);
  await assert.rejects(svc.createDraftPostOnce('c1', 'bad id', { content: 'x' }), { status: 400 });
});

test('approveDraft blocks needsStory (code needs-story) and the [add your memory] placeholder', async () => {
  const flagged = await svc.createSocialPost('c1', { content: 'Flagged.', needsStory: true });
  await assert.rejects(svc.approveDraft('c1', flagged.id), { status: 409, code: 'needs-story' });
  assert.equal(raw(flagged.id).status, 'draft');
  const ph = await svc.createSocialPost('c1', { content: 'Story [add your memory]' });
  await assert.rejects(svc.approveDraft('c1', ph.id));
  assert.equal(raw(ph.id).status, 'draft');
});

test('approveDraft is idempotent on an approved row and rejects other statuses with not-draft', async () => {
  const d = await svc.createSocialPost('c1', { content: 'Approve me.' });
  const a = await svc.approveDraft('c1', d.id, { reviewedBy: 'me' });
  const again = await svc.approveDraft('c1', d.id, { reviewedBy: 'someone-else' });
  assert.equal(again.reviewedAt, a.reviewedAt);
  assert.equal(again.reviewedBy, 'me');
  const s = await due('Scheduled.');
  await assert.rejects(svc.approveDraft('c1', s.id), { status: 409, code: 'not-draft' });
});

test('updateSocialPost: editing content of an approved row returns it to draft and clears review stamps', async () => {
  const d = await svc.createSocialPost('c1', { content: 'Original.' });
  await svc.approveDraft('c1', d.id, { reviewedBy: 'me' });
  const u = await svc.updateSocialPost('c1', d.id, { content: 'Edited.' });
  assert.equal(u.status, 'draft');
  assert.equal(u.reviewedAt, null);
  assert.equal(u.reviewedBy, null);
  assert.equal(raw(d.id).content, 'Edited.');
});

test('CURRENT: editing content of an approved row with identical text keeps it approved', async () => {
  const d = await svc.createSocialPost('c1', { content: 'Same.' });
  await svc.approveDraft('c1', d.id);
  const u = await svc.updateSocialPost('c1', d.id, { content: 'Same.' });
  assert.equal(u.status, 'approved');
  assert.ok(u.reviewedAt);
});

test('CURRENT: editing content of a scheduled row keeps status scheduled and the schedule', async () => {
  const p = await svc.createSocialPost('c1', { content: 'Orig.', status: 'scheduled', scheduledAt: FUTURE() });
  const u = await svc.updateSocialPost('c1', p.id, { content: 'Changed after scheduling.' });
  assert.equal(u.status, 'scheduled');
  assert.equal(u.scheduledAt, p.scheduledAt);
  assert.equal(u.content, 'Changed after scheduling.');
});

test('CURRENT: editing content of a queued row keeps status queued', async () => {
  const p = await due('Orig.', { status: 'queued' });
  const u = await svc.updateSocialPost('c1', p.id, { content: 'Changed while queued.' });
  assert.equal(u.status, 'queued');
});

test('CURRENT: editing content of an awaiting_approval row keeps status awaiting_approval', async () => {
  const p = await svc.createSocialPost('c1', { content: 'Orig.', status: 'awaiting_approval' });
  const u = await svc.updateSocialPost('c1', p.id, { content: 'Changed while awaiting approval.' });
  assert.equal(u.status, 'awaiting_approval');
  assert.equal(raw(p.id).content, 'Changed while awaiting approval.');
});

test('updateSocialPost refuses posted/posting rows (409) and missing rows (404)', async () => {
  const posting = await svc.createSocialPost('c1', { content: 'P', status: 'posting' });
  await assert.rejects(svc.updateSocialPost('c1', posting.id, { content: 'Q' }), { status: 409 });
  await assert.rejects(svc.updateSocialPost('c1', 'nope', { content: 'Q' }), { status: 404 });
  await assert.rejects(svc.updateSocialPost('c1', '', { content: 'Q' }), { status: 400 });
});

test('assertSchedulable: unapproved draft needing approval is refused, approved row schedules to scheduled', async () => {
  const d = await svc.createSocialPost('c1', { content: 'Needs sign-off.', needsApproval: true });
  await assert.rejects(svc.updateSocialPost('c1', d.id, { scheduledAt: FUTURE() }), { status: 409, code: 'approval-required' });
  assert.equal(raw(d.id).status, 'draft');
  await svc.approveDraft('c1', d.id);
  const u = await svc.updateSocialPost('c1', d.id, { scheduledAt: FUTURE() });
  assert.equal(u.status, 'scheduled');
});

test('an approved row with a past scheduledAt becomes queued, not scheduled', async () => {
  const d = await svc.createSocialPost('c1', { content: 'Already due.', needsApproval: true });
  await svc.approveDraft('c1', d.id);
  const u = await svc.updateSocialPost('c1', d.id, { scheduledAt: PAST() });
  assert.equal(u.status, 'queued');
});

test('schedulePost: future -> scheduled, past -> queued, missing/invalid time -> 400', async () => {
  const f = await svc.schedulePost('c1', { content: 'Future.', scheduledAt: FUTURE() });
  assert.equal(f.status, 'scheduled');
  const p = await svc.schedulePost('c1', { content: 'Past.', scheduledAt: PAST() });
  assert.equal(p.status, 'queued');
  await assert.rejects(svc.schedulePost('c1', { content: 'No time.' }), { status: 400 });
  await assert.rejects(svc.schedulePost('c1', { content: 'Bad time.', scheduledAt: 'garbage' }), { status: 400 });
});

test('CURRENT: schedulePost always creates a NEW row (no dedupe, no link to an existing draft)', async () => {
  const when = FUTURE();
  const a = await svc.schedulePost('c1', { content: 'Same schedule.', scheduledAt: when });
  const b = await svc.schedulePost('c1', { content: 'Same schedule.', scheduledAt: when });
  assert.notEqual(a.id, b.id);
  assert.equal((await svc.readSocialQueue('c1')).length, 2);
});

test('processDuePosts: a due row publishes through the mock publisher and is stored posted with twitterId', async () => {
  const p = await due('Ship it.');
  const r = await svc.processDuePosts('c1');
  assert.equal(r.posted.length, 1);
  assert.equal(tweets.length, 1);
  assert.equal(tweets[0].text, 'Ship it.');
  const s = raw(p.id);
  assert.equal(s.status, 'posted');
  assert.equal(s.twitterId, 'main-1');
  assert.equal(s.error, null);
  assert.equal(s.retryable, false);
  assert.ok(s.postedAt);
});

test('processDuePosts(clientId) only sweeps that client', async () => {
  await due('Mine.');
  await svc.createSocialPost('other', { content: 'Theirs.', status: 'scheduled', scheduledAt: PAST() });
  const r = await svc.processDuePosts('c1');
  assert.equal(r.posted.length, 1);
  assert.equal(tweets.length, 1);
  assert.equal(tweets[0].text, 'Mine.');
});

test('failed publish with retryable=false stays failed and is NOT re-posted on the next sweep', async () => {
  const p = await due('Rejected.');
  tweetError = Object.assign(new Error('bad request'), { code: 400 });
  const first = await svc.processDuePostsForAllClients();
  assert.equal(first.failed.length, 1);
  assert.equal(raw(p.id).status, 'failed');
  assert.equal(raw(p.id).retryable, false);
  assert.equal(raw(p.id).errorClass, 'client-error');
  tweetError = null;
  const second = await svc.processDuePostsForAllClients();
  assert.equal(second.posted.length, 0);
  assert.equal(second.failed.length, 0);
  assert.equal(tweets.length, 0);
  assert.equal(raw(p.id).attempts, 1);
});

test('a retryable (429) failure is retried on the next sweep and posts when X recovers', async () => {
  const p = await due('Rate limited once.');
  tweetError = Object.assign(new Error('slow down'), { code: 429 });
  await svc.processDuePostsForAllClients();
  assert.equal(raw(p.id).status, 'failed');
  assert.equal(raw(p.id).retryable, true);
  tweetError = null;
  const r = await svc.processDuePostsForAllClients();
  assert.equal(r.posted.length, 1);
  assert.equal(raw(p.id).status, 'posted');
  assert.equal(raw(p.id).attempts, 2);
});

test('a row more than 26h late becomes expired and is never published (boundary: 25h still posts)', async () => {
  const old = await due('Too old.', { scheduledAt: new Date(Date.now() - 27 * 3600 * 1000).toISOString() });
  const edge = await due('Late but ok.', { scheduledAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString() });
  await svc.processDuePostsForAllClients();
  assert.equal(raw(old.id).status, 'expired');
  assert.equal(raw(edge.id).status, 'posted');
  assert.deepEqual(tweets.map((t) => t.text), ['Late but ok.']);
});

test('a posting claim stale by >15min becomes needs_review and is not re-posted', async () => {
  const p = await due('Stuck.');
  ctx.adminDb._patch('social_posts', p.id, { status: 'posting', claimedAt: new Date(Date.now() - 16 * 60000).toISOString(), attempts: 1 });
  const r = await svc.processDuePostsForAllClients();
  assert.equal(r.needsReview.length, 1);
  assert.equal(raw(p.id).status, 'needs_review');
  assert.equal(tweets.length, 0);
});

test('claimDuePost: first claim wins (status posting, attempts+1), second returns null', async () => {
  const p = await due('Claim race.');
  const first = await svc.claimDuePost(p.id);
  assert.equal(first.status, 'posting');
  assert.equal(first.attempts, 1);
  assert.equal(await svc.claimDuePost(p.id), null);
  assert.equal(raw(p.id).attempts, 1);
});

test('CURRENT (known gap): replyTo publishes standalone', async () => {
  const p = await due('Replying to someone.', {
    replyTo: { author: '@them', url: 'https://x.com/them/status/123', text: 'orig', source: 'reply-targets' },
  });
  assert.equal(p.replyTo.url, 'https://x.com/them/status/123');
  await svc.processDuePostsForAllClients();
  assert.equal(tweets.length, 1);
  assert.equal(tweets[0].text, 'Replying to someone.');
  assert.equal(tweets[0].reply, undefined);
  assert.equal('inReplyTo' in tweets[0], false);
  assert.equal(raw(p.id).status, 'posted');
  assert.equal(raw(p.id).replyTo.url, 'https://x.com/them/status/123'); // target kept as data only
});

test('getSocialPost: wrong clientId returns null; missing id returns null; falsy clientId skips the ownership check', async () => {
  const p = await svc.createSocialPost('c1', { content: 'Mine.' });
  assert.equal((await svc.getSocialPost('c1', p.id)).id, p.id);
  assert.equal(await svc.getSocialPost('c2', p.id), null);
  assert.equal(await svc.getSocialPost('c1', 'missing'), null);
  assert.equal(await svc.getSocialPost('c1', ''), null);
  assert.equal((await svc.getSocialPost(null, p.id)).id, p.id); // CURRENT: no isolation without a clientId
  await assert.rejects(svc.updateSocialPost('c2', p.id, { content: 'hijack' }), { status: 404 });
});

test('postNow: success stores a posted row with twitterId and publishes immediately', async () => {
  const p = await svc.postNow('c1', { content: 'Right now.' });
  assert.equal(p.status, 'posted');
  assert.equal(p.twitterId, 'main-1');
  assert.equal(p.apiVersion, 'v2');
  assert.equal(raw(p.id).status, 'posted');
  assert.equal(tweets[0].text, 'Right now.');
});

test('postNow: failure stores status failed (without retryable/errorClass) and rethrows', async () => {
  tweetError = Object.assign(new Error('nope'), { code: 400 });
  await assert.rejects(svc.postNow('c1', { content: 'Will fail.' }));
  const [row] = await svc.readSocialQueue('c1');
  assert.equal(row.status, 'failed');
  assert.equal(row.error, 'X rejected the request as invalid.');
  assert.equal('retryable' in row, false);
  assert.equal('errorClass' in row, false);
});

test('CURRENT: postNow skips assertSchedulable - a needsApproval post publishes immediately; placeholder is still blocked', async () => {
  const p = await svc.postNow('c1', { content: 'Unapproved but live.', needsApproval: true });
  assert.equal(p.status, 'posted');
  await assert.rejects(svc.postNow('c1', { content: 'Story [add your memory]' }));
  assert.equal(tweets.length, 1);
});

test('publishApprovedPost: awaiting_approval publishes to posted with approvalSource; second call is 409 not-pending', async () => {
  const p = await svc.createSocialPost('c1', { content: 'Approve by email.', status: 'awaiting_approval' });
  const out = await svc.publishApprovedPost('c1', p.id, { source: 'email' });
  assert.equal(out.status, 'posted');
  assert.equal(out.approvalSource, 'email');
  assert.equal(out.twitterId, 'main-1');
  await assert.rejects(svc.publishApprovedPost('c1', p.id), { status: 409, code: 'not-pending' });
  assert.equal(tweets.length, 1);
  await assert.rejects(svc.publishApprovedPost('c1', 'missing'), { status: 404 });
  await assert.rejects(svc.publishApprovedPost('c2', p.id), { status: 404 });
});

test('publishApprovedPost: failed publish stores failed (no retryable/errorClass) and rethrows', async () => {
  const p = await svc.createSocialPost('c1', { content: 'Will fail.', status: 'awaiting_approval' });
  tweetError = Object.assign(new Error('x down'), { code: 400 });
  await assert.rejects(svc.publishApprovedPost('c1', p.id));
  assert.equal(raw(p.id).status, 'failed');
  assert.equal(raw(p.id).error, 'X rejected the request as invalid.');
  assert.equal('retryable' in raw(p.id), false);
});

test('CURRENT: publishApprovedPost does not run assertSchedulable - needsApproval flag does not block it', async () => {
  const p = await svc.createSocialPost('c1', { content: 'Flagged but pending.', status: 'awaiting_approval', needsApproval: true });
  const out = await svc.publishApprovedPost('c1', p.id);
  assert.equal(out.status, 'posted');
});
