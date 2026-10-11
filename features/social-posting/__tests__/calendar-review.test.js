import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { createRequire } from 'node:module';

// Calendar review actions: rejectDraft + approveAndSchedule. No X calls are
// possible here — neither function publishes; the sweeper is never invoked.

const require = createRequire(import.meta.url);
const fb = require('../../../api/_lib/firebase-admin.cjs');
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');
const svc = await import('../twitter-service.js');

let ctx;
let originalDbDescriptor;
const raw = (id) => ctx.adminDb._raw('social_posts', id);
const FUTURE = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

beforeEach(() => {
  originalDbDescriptor = Object.getOwnPropertyDescriptor(fb, 'adminDb');
  ctx = makeFakeContext();
  Object.defineProperty(fb, 'adminDb', { configurable: true, get: () => ctx.adminDb });
});

afterEach(() => {
  Object.defineProperty(fb, 'adminDb', originalDbDescriptor);
});

const draft = (content = 'A draft worth posting.', extra = {}) => svc.createSocialPost('c1', { content, status: 'draft', ...extra });

test('rejectDraft moves a draft to rejected and is idempotent', async () => {
  const post = await draft();
  const out = await svc.rejectDraft('c1', post.id, { reviewedBy: 'me@x.com' });
  assert.equal(out.status, 'rejected');
  assert.equal(raw(post.id).status, 'rejected');
  assert.ok(raw(post.id).rejectedAt);
  assert.equal((await svc.rejectDraft('c1', post.id)).status, 'rejected');
});

test('rejectDraft refuses scheduled/posted rows and foreign clients', async () => {
  const sched = await svc.createSocialPost('c1', { content: 'Scheduled.', status: 'scheduled', scheduledAt: FUTURE() });
  await assert.rejects(() => svc.rejectDraft('c1', sched.id), (e) => e.status === 409);
  ctx.adminDb._patch('social_posts', sched.id, { status: 'posted' });
  await assert.rejects(() => svc.rejectDraft('c1', sched.id), (e) => e.status === 409);
  const mine = await draft();
  await assert.rejects(() => svc.rejectDraft('other', mine.id), (e) => e.status === 404);
});

test('approveAndSchedule approves and schedules in one call, applying a text edit first', async () => {
  const post = await draft('Original text.');
  const when = FUTURE();
  const out = await svc.approveAndSchedule('c1', post.id, { scheduledAt: when, content: 'Edited text.', reviewedBy: 'me@x.com' });
  assert.equal(out.status, 'scheduled');
  assert.equal(out.scheduledAt, new Date(when).toISOString());
  assert.equal(out.content, 'Edited text.');
  assert.ok(out.reviewedAt, 'approval stamp survives scheduling');
  assert.equal(raw(post.id).status, 'scheduled');
});

test('approveAndSchedule refuses past times without touching the draft', async () => {
  const post = await draft();
  await assert.rejects(
    () => svc.approveAndSchedule('c1', post.id, { scheduledAt: new Date(Date.now() - 60_000).toISOString() }),
    (e) => e.status === 400,
  );
  assert.equal(raw(post.id).status, 'draft');
  assert.equal(raw(post.id).reviewedAt ?? null, null);
});

test('approveAndSchedule refuses a needs-story draft and leaves it a draft', async () => {
  const post = await draft('Needs a story.', { needsStory: true });
  await assert.rejects(() => svc.approveAndSchedule('c1', post.id, { scheduledAt: FUTURE() }), (e) => e.code === 'needs-story');
  assert.equal(raw(post.id).status, 'draft');
});
