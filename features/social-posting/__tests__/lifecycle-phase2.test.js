// Phase 2 lifecycle rules (content-management normalization). Real failure cases against the shared service;
// all publishing goes through the injected mock X client. Legacy compatibility is pinned in characterization-*.test.js.
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fb = require('../../../api/_lib/firebase-admin.cjs');
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');

const { __setXAdapterDepsForTest } = await import('../adapters/x.js');
const svc = await import('../twitter-service.js');
const { upsertPackage, getPackage } = await import('../../x-content-inventory/store.js');
const { default: seedRows } = await import('../../x-content-inventory/content-packages.json', { with: { type: 'json' } });

let ctx;
let tweets;
let restoreDeps;
let originalDbDescriptor;

const PAST = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();
const FUTURE = (h = 24) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
const raw = (id) => ctx.adminDb._raw('social_posts', id);

const PKG = (id, extra = {}) => ({ ...seedRows[1], id, status: 'idea', rights: 'owned', ...extra });

beforeEach(() => {
  tweets = [];
  originalDbDescriptor = Object.getOwnPropertyDescriptor(fb, 'adminDb');
  ctx = makeFakeContext();
  ctx.adminDb.batch = () => {
    const ops = [];
    return { set: (ref, data, o) => ops.push(() => ref.set(data, o)), delete: (ref) => ops.push(() => ref.delete()), commit: async () => { for (const op of ops) await op(); } };
  };
  // Firestore DocumentReference.create() semantics for createDraftPostOnce / ensureDraftPost (6 = ALREADY_EXISTS).
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
  Object.defineProperty(fb, 'adminDb', { configurable: true, get: () => ctx.adminDb });
  restoreDeps = __setXAdapterDepsForTest({
    getClient: async () => ({
      authMode: 'oauth2',
      client: {
        v1: { uploadMedia: async () => 'm1' },
        v2: { tweet: async (payload) => { tweets.push(payload); return { data: { id: `main-${tweets.length}` } }; } },
      },
    }),
    fetchMedia: async () => { throw new Error('no media'); },
  });
});

afterEach(() => {
  restoreDeps();
  Object.defineProperty(fb, 'adminDb', originalDbDescriptor);
});

const v2 = (content, extra = {}) => svc.createSocialPost('c1', { content, lifecycleVersion: 2, ...extra });

// --- idempotent save --------------------------------------------------------

test('ensureDraftPost: repeated save with one key yields ONE row and the same id; provenance persisted', async () => {
  const a = await svc.ensureDraftPost('c1', { idempotencyKey: 'item:pkg-1', content: 'Draft one.', packageId: 'pkg-1', runId: 'run-9', suggestionId: 's-1', strategyVersion: 4, channel: 'x' });
  const b = await svc.ensureDraftPost('c1', { idempotencyKey: 'item:pkg-1', content: 'Different text.', packageId: 'pkg-1' });
  assert.equal(a.existing, false);
  assert.equal(b.existing, true);
  assert.equal(a.post.id, b.post.id);
  assert.equal((await svc.readSocialQueue('c1')).length, 1);
  assert.equal(raw(a.post.id).content, 'Draft one.', 'second save must not overwrite');
  assert.equal(raw(a.post.id).lifecycleVersion, 2);
  assert.equal(raw(a.post.id).strategyVersion, 4);
  assert.equal(raw(a.post.id).runId, 'run-9');
  assert.equal(raw(a.post.id).status, 'draft');
});

test('ensureDraftPost: same key under another client is a different post (no cross-client collision)', async () => {
  const a = await svc.ensureDraftPost('c1', { idempotencyKey: 'k', content: 'A.' });
  const b = await svc.ensureDraftPost('c2', { idempotencyKey: 'k', content: 'B.' });
  assert.notEqual(a.post.id, b.post.id);
  await assert.rejects(svc.ensureDraftPost('c1', { content: 'no key' }), { status: 400 });
});

test('findOpenPostForPackage is client-scoped and finds approved/scheduled rows, ignores posted', async () => {
  const mine = await v2('Mine.', { packageId: 'pkg-x', status: 'approved' });
  await svc.createSocialPost('c2', { content: 'Theirs.', packageId: 'pkg-x', status: 'draft' });
  await svc.createSocialPost('c1', { content: 'Old.', packageId: 'pkg-y', status: 'posted' });
  assert.equal((await svc.findOpenPostForPackage('c1', 'pkg-x')).id, mine.id);
  assert.equal(await svc.findOpenPostForPackage('c1', 'pkg-y'), null);
  assert.equal((await svc.findOpenPostForPackage('c2', 'pkg-x')).clientId, 'c2');
});

// --- approval invalidation --------------------------------------------------

test('v2: editing text of a SCHEDULED row voids approval and the schedule (back to draft)', async () => {
  const p = await v2('Original.', { status: 'approved', reviewedAt: new Date().toISOString() });
  await svc.updateSocialPost('c1', p.id, { scheduledAt: FUTURE() });
  assert.equal(raw(p.id).status, 'scheduled');
  await svc.updateSocialPost('c1', p.id, { content: 'Edited after approval.' });
  const row = raw(p.id);
  assert.equal(row.status, 'draft');
  assert.equal(row.scheduledAt, null);
  assert.equal(row.reviewedAt, null);
});

test('v2: editing the self-reply of an approved row voids approval; an identical re-save keeps it', async () => {
  const p = await v2('Body.', { status: 'approved', reviewedAt: new Date().toISOString(), selfReply: { text: 'first' } });
  await svc.updateSocialPost('c1', p.id, { content: 'Body.' });
  assert.equal(raw(p.id).status, 'approved');
  await svc.updateSocialPost('c1', p.id, { selfReply: { text: 'changed reply' } });
  assert.equal(raw(p.id).status, 'draft');
  assert.equal(raw(p.id).reviewedAt, null);
});

test('legacy row (no lifecycleVersion): scheduled text edit keeps status (compat)', async () => {
  const p = await svc.createSocialPost('c1', { content: 'Legacy.', status: 'scheduled', scheduledAt: FUTURE(), reviewedAt: new Date().toISOString() });
  await svc.updateSocialPost('c1', p.id, { content: 'Legacy edited.' });
  assert.equal(raw(p.id).status, 'scheduled');
});

test('wrong client cannot edit or approve another client post', async () => {
  const p = await v2('Private.');
  await assert.rejects(svc.updateSocialPost('c2', p.id, { content: 'hijack' }), { status: 404 });
  await assert.rejects(svc.approveDraft('c2', p.id), { status: 404 });
  assert.equal(raw(p.id).content, 'Private.');
});

// --- clearance --------------------------------------------------------------

test('clearance revoked BEFORE schedule: an approved row cannot be scheduled once the package is rejected', async () => {
  await upsertPackage(PKG('pkg-c'), { returnPackages: false });
  const p = await v2('Cleared once.', { status: 'approved', reviewedAt: new Date().toISOString(), packageId: 'pkg-c' });
  await upsertPackage(PKG('pkg-c', { approval: { state: 'rejected' } }), { returnPackages: false });
  await assert.rejects(svc.updateSocialPost('c1', p.id, { scheduledAt: FUTURE() }), { code: 'clearance-revoked', status: 409 });
  assert.equal(raw(p.id).status, 'approved');
});

test('never-public package is refused at schedule even for a brand-new post', async () => {
  await upsertPackage(PKG('pkg-n', { rights: 'never-public' }), { returnPackages: false });
  await assert.rejects(svc.schedulePost('c1', { content: 'No.', packageId: 'pkg-n', scheduledAt: FUTURE() }), { code: 'clearance-revoked' });
});

test('clearance revoked AFTER scheduling: v2 row is parked needs_review at delivery and never published', async () => {
  await upsertPackage(PKG('pkg-d'), { returnPackages: false });
  const p = await v2('Scheduled then revoked.', { status: 'scheduled', scheduledAt: PAST(), packageId: 'pkg-d' });
  await upsertPackage(PKG('pkg-d', { approval: { state: 'rejected' } }), { returnPackages: false });
  await svc.processDuePosts('c1');
  assert.equal(tweets.length, 0);
  assert.equal(raw(p.id).status, 'needs_review');
  assert.equal(raw(p.id).errorClass, 'clearance-revoked');
});

test('legacy due row still publishes (delivery recheck is v2-only)', async () => {
  await upsertPackage(PKG('pkg-l', { approval: { state: 'rejected' } }), { returnPackages: false });
  const p = await svc.createSocialPost('c1', { content: 'Legacy goes out.', status: 'scheduled', scheduledAt: PAST(), packageId: 'pkg-l' });
  await svc.processDuePosts('c1');
  assert.equal(raw(p.id).status, 'posted');
});

// --- replies ----------------------------------------------------------------

const REPLY = { author: 'someone', url: 'https://x.com/someone/status/1', text: 'their post', source: 'reply-targets' };

test('reply without threading support cannot be scheduled (new action) via schedulePost or updateSocialPost', async () => {
  await assert.rejects(svc.schedulePost('c1', { content: 'Reply text.', replyTo: REPLY, scheduledAt: FUTURE() }), { code: 'reply-threading-unsupported' });
  const p = await v2('Reply draft.', { replyTo: REPLY });
  await svc.approveDraft('c1', p.id);
  await assert.rejects(svc.updateSocialPost('c1', p.id, { scheduledAt: FUTURE() }), { code: 'reply-threading-unsupported' });
  assert.equal(raw(p.id).status, 'approved');
});

test('v2 reply row that reached the queue is parked at delivery, not posted standalone', async () => {
  const p = await v2('Reply text.', { replyTo: REPLY, status: 'scheduled', scheduledAt: PAST() });
  await svc.processDuePosts('c1');
  assert.equal(tweets.length, 0);
  assert.equal(raw(p.id).status, 'needs_review');
  assert.equal(raw(p.id).errorClass, 'reply-threading-unsupported');
});

// --- double booking ---------------------------------------------------------

test('two producers cannot double-book one package: second schedule is refused, same row may reschedule', async () => {
  await upsertPackage(PKG('pkg-dup'), { returnPackages: false });
  const a = await v2('Copy A.', { packageId: 'pkg-dup' });
  await svc.approveDraft('c1', a.id);
  const b = await svc.createSocialPost('c1', { content: 'Copy B.', packageId: 'pkg-dup' });
  await svc.updateSocialPost('c1', a.id, { scheduledAt: FUTURE(24) });
  await assert.rejects(svc.updateSocialPost('c1', b.id, { scheduledAt: FUTURE(30) }), { code: 'package-already-pending', status: 409 });
  await assert.rejects(svc.schedulePost('c1', { content: 'Copy C.', packageId: 'pkg-dup', scheduledAt: FUTURE(40) }), { code: 'package-already-pending' });
  await svc.updateSocialPost('c1', a.id, { scheduledAt: FUTURE(48) });
  assert.equal(raw(a.id).status, 'scheduled');
  assert.equal(raw(b.id).status, 'draft');
});

test('collision is per client: another client scheduling the same package id is not blocked', async () => {
  await upsertPackage(PKG('pkg-shared'), { returnPackages: false });
  await svc.schedulePost('c1', { content: 'Client one.', packageId: 'pkg-shared', scheduledAt: FUTURE() });
  const other = await svc.schedulePost('c2', { content: 'Client two.', packageId: 'pkg-shared', scheduledAt: FUTURE() });
  assert.equal(other.status, 'scheduled');
});

// --- expiry -----------------------------------------------------------------

test('expired timely opportunity: v2 row parked needs_review at delivery; unexpired posts normally', async () => {
  const expired = await v2('Timely, too late.', { status: 'scheduled', scheduledAt: PAST(), expiresAt: new Date(Date.now() - 1000).toISOString() });
  const live = await v2('Timely, still open.', { status: 'scheduled', scheduledAt: PAST(), expiresAt: FUTURE() });
  await svc.processDuePosts('c1');
  assert.equal(raw(expired.id).status, 'needs_review');
  assert.equal(raw(expired.id).errorClass, 'opportunity-expired');
  assert.equal(raw(live.id).status, 'posted');
  assert.equal(tweets.length, 1);
});

// --- failed publish is not blindly retried ----------------------------------

test('failed post-now is stored non-retryable and a later sweep does not re-send it', async () => {
  restoreDeps();
  restoreDeps = __setXAdapterDepsForTest({
    getClient: async () => ({ authMode: 'oauth2', client: { v1: { uploadMedia: async () => 'm1' }, v2: { tweet: async () => { throw Object.assign(new Error('x'), { code: 429 }); } } } }),
    fetchMedia: async () => { throw new Error('no media'); },
  });
  await assert.rejects(svc.postNow('c1', { content: 'Will fail.' }));
  const [row] = await svc.readSocialQueue('c1');
  assert.equal(row.status, 'failed');
  assert.equal(row.retryable, false);
  assert.equal(row.errorClass, 'rate-limited');
  await svc.processDuePosts('c1');
  assert.equal((await svc.getSocialPost('c1', row.id)).status, 'failed');
  assert.equal(tweets.length, 0);
});

// --- review fixes -----------------------------------------------------------

test('ensureDraftPost after the prior row is posted/failed makes a NEW draft (key generation), open rows are still reused', async () => {
  const first = await svc.ensureDraftPost('c1', { idempotencyKey: 'item:p1', content: 'Round one.' });
  const again = await svc.ensureDraftPost('c1', { idempotencyKey: 'item:p1', content: 'ignored' });
  assert.equal(again.post.id, first.post.id);
  await svc.updateSocialPost('c1', first.post.id, { content: 'Round one.' });
  ctx.adminDb._raw('social_posts', first.post.id).status = 'posted';
  const next = await svc.ensureDraftPost('c1', { idempotencyKey: 'item:p1', content: 'Round two.' });
  assert.notEqual(next.post.id, first.post.id);
  assert.equal(next.existing, false);
  assert.equal(next.post.status, 'draft');
  ctx.adminDb._raw('social_posts', next.post.id).status = 'failed';
  const third = await svc.ensureDraftPost('c1', { idempotencyKey: 'item:p1', content: 'Round three.' });
  assert.notEqual(third.post.id, next.post.id);
});

test('v2 draft cannot be scheduled without approval; approval is its own step', async () => {
  const p = await v2('Needs approval first.');
  await assert.rejects(svc.updateSocialPost('c1', p.id, { scheduledAt: FUTURE() }), { code: 'approval-required' });
  await svc.approveDraft('c1', p.id);
  const u = await svc.updateSocialPost('c1', p.id, { scheduledAt: FUTURE() });
  assert.equal(u.status, 'scheduled');
});

test('editing a scheduled v2 post while re-sending its schedule time stays a draft (approval voided, not silently re-armed)', async () => {
  const when = FUTURE();
  const p = await v2('Body one.');
  await svc.approveDraft('c1', p.id);
  await svc.updateSocialPost('c1', p.id, { scheduledAt: when });
  const u = await svc.updateSocialPost('c1', p.id, { content: 'Body two.', scheduledAt: when });
  assert.equal(u.status, 'draft');
  assert.equal(u.scheduledAt, null);
  assert.equal(u.reviewedAt, null);
});

test('package with approval.state needed does not block an already-approved post (post approval is that gate)', async () => {
  await upsertPackage(PKG('pkg-need', { rights: 'client-approval-needed', approval: { state: 'needed' } }), { returnPackages: false });
  const p = await v2('Approved by the owner.', { packageId: 'pkg-need' });
  await svc.approveDraft('c1', p.id);
  const u = await svc.updateSocialPost('c1', p.id, { scheduledAt: FUTURE() });
  assert.equal(u.status, 'scheduled');
});

test('a needs_review row does not wedge its package: another copy can be scheduled', async () => {
  await upsertPackage(PKG('pkg-nr'), { returnPackages: false });
  await v2('Parked.', { packageId: 'pkg-nr', status: 'needs_review' });
  const next = await svc.schedulePost('c1', { content: 'Fresh copy.', packageId: 'pkg-nr', scheduledAt: FUTURE() });
  assert.equal(next.status, 'scheduled');
});

test('getPackage sanity: fixtures used above are real store rows', async () => {
  await upsertPackage(PKG('pkg-z'), { returnPackages: false });
  assert.equal((await getPackage('pkg-z')).id, 'pkg-z');
});
