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
  await assert.rejects(() => svc.approveDraft('c1', post.id, { reviewedBy: 'owner' }), /needs its story/);
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
