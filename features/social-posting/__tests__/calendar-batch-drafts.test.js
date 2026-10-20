// Calendar-batch drafts through the real social-posting service on a fake Firestore: `reviewOn` is stored, the story
// gate follows the text (writing the memory over the placeholder unblocks approval), and nothing is scheduled.
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fb = require('../../../api/_lib/firebase-admin.cjs');
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');
const svc = await import('../twitter-service.js');

let ctx;
let originalDb;
beforeEach(() => {
  originalDb = Object.getOwnPropertyDescriptor(fb, 'adminDb');
  ctx = makeFakeContext();
  Object.defineProperty(fb, 'adminDb', { configurable: true, get: () => ctx.adminDb });
});
afterEach(() => { Object.defineProperty(fb, 'adminDb', originalDb); });

const batchDraft = () => svc.ensureDraftPost('c1', {
  idempotencyKey: 'calendar-batch:nas-a', source: 'calendar-batch', packageId: 'nas-a', engine: 'record',
  content: 'Dec 17, 2014 · An Evening of Deep Rhythms\n\n[add your memory]', needsStory: true, reviewOn: '2026-12-17',
});

test('a calendar-batch draft stores reviewOn, stays an unscheduled draft, and re-running returns the same row', async () => {
  const { post, existing } = await batchDraft();
  assert.equal(existing, false);
  assert.equal(post.status, 'draft');
  assert.equal(post.scheduledAt, null);
  assert.equal(post.reviewOn, '2026-12-17');
  assert.equal(post.needsStory, true);
  const again = await batchDraft();
  assert.equal(again.existing, true);
  assert.equal(again.post.id, post.id);
  // The memory line never blocks approval: it is stripped.
  const ok = await svc.approveDraft('c1', post.id, { reviewedBy: 'owner' });
  assert.equal(ok.status, 'approved');
  assert.equal(ok.needsStory, false);
  assert.ok(!/add your memory/i.test(ok.content));
  assert.ok(ok.content.length > 0);
});

test('writing the memory over the placeholder clears needsStory so the draft can be approved; leaving it keeps the gate', async () => {
  const { post } = await batchDraft();
  const still = await svc.updateSocialPost('c1', post.id, { content: 'Dec 17, 2014 · Deep Rhythms\n\n[add your memory]' });
  assert.equal(still.needsStory, true);
  const done = await svc.updateSocialPost('c1', post.id, { content: 'Dec 17, 2014 · Deep Rhythms\n\nJohn Tejada closed with three hours of Detroit records.' });
  assert.equal(done.needsStory, false);
  assert.equal(done.status, 'draft');
  const approved = await svc.approveDraft('c1', post.id, { reviewedBy: 'owner' });
  assert.equal(approved.status, 'approved');
  assert.equal(approved.scheduledAt, null);
});

// Daily-fill drafts: the fill fields persist, "[add your take]" blocks approval like "[add your memory]", and the gate follows the text.
const fillDraft = () => svc.ensureDraftPost('c1', {
  idempotencyKey: 'daily-fill:2026-10-17:quote:111', source: 'daily-fill', fillKind: 'quote', reviewOn: '2026-10-17', bucketId: 'record',
  expiresAt: '2026-10-18T12:00:00.000Z', fillSource: { type: 'quote-target', id: '111', asOf: '2026-10-17T06:00:00Z' },
  content: '@h on this: [add your take]\n\nhttps://x.com/h/status/111', needsStory: true,
});

test('a daily-fill draft keeps fillKind / fillSource / expiresAt and approving strips [add your take] instead of blocking', async () => {
  const { post } = await fillDraft();
  assert.equal(post.fillKind, 'quote');
  assert.deepEqual(post.fillSource, { type: 'quote-target', id: '111', asOf: '2026-10-17T06:00:00Z' });
  assert.equal(post.expiresAt, '2026-10-18T12:00:00.000Z');
  assert.equal(post.status, 'draft');
  const approvedNow = await svc.approveDraft('c1', post.id, { reviewedBy: 'owner' });
  assert.equal(approvedNow.status, 'approved');
  assert.ok(!/add your take/i.test(approvedNow.content));
  assert.ok(approvedNow.content.includes('https://x.com/h/status/111'));
});

test('the gate follows the text; approving a still-placeholdered draft strips it; publish guards stay', async () => {
  const { post } = await svc.ensureDraftPost('c1', { idempotencyKey: 'daily-fill:2026-10-18:quote:222', source: 'daily-fill', fillKind: 'quote', reviewOn: '2026-10-18',
    content: '@h on this: [add your take]\n\nhttps://x.com/h/status/222', needsStory: true });
  const still = await svc.updateSocialPost('c1', post.id, { content: '@h on this: [add your take] soon\n\nhttps://x.com/h/status/222' });
  assert.equal(still.needsStory, true);
  const done = await svc.updateSocialPost('c1', post.id, { content: '@h on this: real take.\n\nhttps://x.com/h/status/222' });
  assert.equal(done.needsStory, false);
  const { assertNoMemoryPlaceholder, stripBlockingPlaceholders } = await import('../self-reply.js');
  assert.throws(() => assertNoMemoryPlaceholder('x [add your take]'), (e) => e.status === 409);
  assert.equal(stripBlockingPlaceholders('A – B\n\n[add your memory]'), 'A – B');
  assert.equal(stripBlockingPlaceholders('clean'), 'clean');
  await assert.rejects(() => svc.schedulePost('c1', { content: 'x [add your memory]', scheduledAt: new Date(Date.now() + 3600e3).toISOString() }), (e) => e.status === 409);
});

test('the placeholder gate covers both placeholders, case-insensitively', async () => {
  const { assertNoMemoryPlaceholder, hasMemoryPlaceholder } = await import('../self-reply.js');
  assert.equal(hasMemoryPlaceholder('x [Add Your Take]'), true);
  assert.equal(hasMemoryPlaceholder('x [add your memory]'), true);
  assert.equal(hasMemoryPlaceholder('plain text'), false);
  assert.throws(() => assertNoMemoryPlaceholder('x [add your take]'), (e) => e.status === 409 && /add your take/.test(e.message));
  assert.throws(() => assertNoMemoryPlaceholder('x [add your memory]'), (e) => e.status === 409 && /memory/.test(e.message));
});

test('approve-and-schedule strips the placeholder too; unapprove returns an approved unscheduled post to draft; a scheduled one is refused', async () => {
  const { post } = await batchDraft();
  const when = new Date(Date.now() + 2 * 3600e3).toISOString();
  const scheduled = await svc.approveAndSchedule('c1', post.id, { scheduledAt: when, reviewedBy: 'owner' });
  assert.ok(['scheduled', 'queued'].includes(scheduled.status));
  assert.ok(!/add your memory/i.test(scheduled.content));
  await assert.rejects(() => svc.unapproveDraft('c1', post.id), (e) => e.status === 409);
});

test('unapprove: approved -> draft, clears the review stamp; draft is idempotent', async () => {
  const { post } = await svc.ensureDraftPost('c1', { idempotencyKey: 'k-unapprove', content: 'plain post', source: 'calendar-batch', reviewOn: '2026-12-01' });
  const approved = await svc.approveDraft('c1', post.id, { reviewedBy: 'owner' });
  assert.equal(approved.status, 'approved');
  const back = await svc.unapproveDraft('c1', post.id);
  assert.equal(back.status, 'draft');
  assert.equal(back.reviewedAt, null);
  assert.equal(back.approvedHash, null);
  assert.equal((await svc.unapproveDraft('c1', post.id)).status, 'draft');
});

test('approving strips a self-reply that is only a placeholder; a post that is only a placeholder is refused', async () => {
  const { post } = await svc.ensureDraftPost('c1', { idempotencyKey: 'k-sr', content: 'real text', source: 'daily-fill', reviewOn: '2026-12-02', selfReply: { text: '[add your memory]' }, needsStory: true });
  const a = await svc.approveDraft('c1', post.id, { reviewedBy: 'owner' });
  assert.equal(a.status, 'approved');
  assert.equal(a.selfReply ?? null, null);
  const { post: only } = await svc.ensureDraftPost('c1', { idempotencyKey: 'k-only', content: '[add your memory]', source: 'daily-fill', reviewOn: '2026-12-03', needsStory: true });
  await assert.rejects(() => svc.approveDraft('c1', only.id, { reviewedBy: 'owner' }), (e) => e.code === 'empty-after-strip');
});

test('a throwback fill draft stores its NAS asset link (nasSha) and no media; a malformed sha is dropped', async () => {
  const sha = 'ab'.repeat(32);
  const { post } = await svc.ensureDraftPost('c1', {
    idempotencyKey: 'daily-fill:2026-10-17:baseline:nas-1', source: 'daily-fill', fillKind: 'baseline', reviewOn: '2026-10-17', bucketId: 'nas',
    packageId: 'nas-1', nasSha: sha, content: 'Oct 17, 2009 · Warehouse night\n\n[add your memory]', needsStory: true,
  });
  assert.equal(post.nasSha, sha);
  assert.equal(post.packageId, 'nas-1');
  assert.equal(post.mediaUrl ?? null, null);
  const { post: bad } = await svc.ensureDraftPost('c1', { idempotencyKey: 'k-bad', source: 'daily-fill', content: 'x', nasSha: 'not-a-sha' });
  assert.equal('nasSha' in bad, false);
});
