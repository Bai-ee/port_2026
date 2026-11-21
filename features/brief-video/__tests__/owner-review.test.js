import test from 'node:test';
import assert from 'node:assert/strict';
import { briefHashOf, directorAcceptedCurrent } from '../director-notes.js';
import { checkOwnerReview, attachedVideoOf } from '../owner-review.js';

const V2 = { title: 'Keeps moving', format: 'episode' };
const ep = { episodeId: 'e1', storagePath: 'clients/c/ep-v02.mp4', posterStoragePath: 'p.jpg', outlineHash: 'oh1' };
const row = (over = {}, metaOver = {}) => ({
  id: 'p1', status: 'draft', revision: 7,
  videoBriefMeta: { briefVersion: 2, v2: V2, status: 'ready', directorNotes: { status: 'accepted', briefHash: briefHashOf(V2) }, ...metaOver },
  ...over,
});
const code = (fn) => { try { fn(); return 'ok'; } catch (e) { return e.code; } };

test('directorAcceptedCurrent: accepted + matching hash only', () => {
  assert.equal(directorAcceptedCurrent(row()), true);
  assert.equal(directorAcceptedCurrent(row({}, { directorNotes: { status: 'accepted', briefHash: null } })), false, 'null hash never passes');
  assert.equal(directorAcceptedCurrent(row({}, { directorNotes: { status: 'accepted', briefHash: 'deadbeef' } })), false, 'stale');
  assert.equal(directorAcceptedCurrent(row({}, { directorNotes: { status: 'pending', briefHash: briefHashOf(V2) } })), false);
  assert.equal(directorAcceptedCurrent(row({}, { directorNotes: { status: 'revise', briefHash: briefHashOf(V2) } })), false);
  assert.equal(directorAcceptedCurrent(row({}, { briefVersion: 1 })), false);
});

test('checkOwnerReview: revision is required and pinned', () => {
  assert.equal(code(() => checkOwnerReview(row(), { step: 'brief', decision: 'approve' })), 'revision-required');
  assert.equal(code(() => checkOwnerReview(row(), { step: 'brief', decision: 'approve', expectedRevision: 6 })), 'revision-conflict');
  assert.equal(code(() => checkOwnerReview(row(), { step: 'brief', decision: 'approve', expectedRevision: 7 })), 'ok');
});

test('checkOwnerReview: approves need the Director on the current version; changes do not', () => {
  const stale = row({}, { directorNotes: { status: 'accepted', briefHash: 'x' } });
  assert.equal(code(() => checkOwnerReview(stale, { step: 'brief', decision: 'approve', expectedRevision: 7 })), 'director-not-accepted');
  const sb = { status: 'ready', frames: [], episode: null };
  assert.equal(code(() => checkOwnerReview(row({}, { directorNotes: { status: 'pending' }, storyboard: sb }), { step: 'storyboard', decision: 'changes', notes: 'x', expectedRevision: 7 })), 'ok');
  assert.equal(code(() => checkOwnerReview(row(), { step: 'brief', decision: 'changes', expectedRevision: 7 })), 'brief-changes-unsupported');
});

test('checkOwnerReview: storyboard approve needs a ready storyboard with the episode shown', () => {
  const opts = { step: 'storyboard', decision: 'approve', expectedRevision: 7, outlineHash: 'oh1', storagePath: ep.storagePath };
  assert.equal(code(() => checkOwnerReview(row({}, { storyboard: { status: 'pending' } }), opts)), 'storyboard-not-ready');
  assert.equal(code(() => checkOwnerReview(row({}, { storyboard: { status: 'ready', episode: null } }), opts)), 'no-episode');
  assert.equal(code(() => checkOwnerReview(row({}, { storyboard: { status: 'ready', episode: ep } }), { ...opts, storagePath: 'clients/c/ep-v01.mp4' })), 'episode-changed');
  assert.equal(code(() => checkOwnerReview(row({}, { storyboard: { status: 'ready', episode: ep } }), { ...opts, outlineHash: undefined })), 'episode-changed');
  assert.equal(code(() => checkOwnerReview(row({}, { storyboard: { status: 'ready', episode: ep } }), opts)), 'ok');
});

test('checkOwnerReview: drafts and v2 only; bad step/decision is 400', () => {
  assert.equal(code(() => checkOwnerReview(row({ status: 'scheduled' }), { step: 'brief', decision: 'approve', expectedRevision: 7 })), 'not-draft');
  assert.equal(code(() => checkOwnerReview(row({}, { briefVersion: 1 }), { step: 'brief', decision: 'approve', expectedRevision: 7 })), 'not-v2');
  assert.equal(code(() => checkOwnerReview(row(), { step: 'post', decision: 'approve', expectedRevision: 7 })), 'invalid-step');
  assert.equal(code(() => checkOwnerReview(row(), { step: 'video', decision: 'ship', expectedRevision: 7 })), 'invalid-decision');
});

test('attachedVideoOf: server mediaUrl + version, null without a video', () => {
  assert.equal(attachedVideoOf(row()), null);
  const p = row({ mediaUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/ep-v02.mp4?alt=media&token=abc', mediaType: 'video', mediaJobId: 'cal_e1', mediaStoragePath: ep.storagePath, mediaMetadata: { outlineHash: 'oh1' } }, { storyboard: { status: 'approved', episode: ep } });
  const v = attachedVideoOf(p);
  assert.equal(v.downloadUrl, p.mediaUrl);
  assert.equal(v.outlineHash, 'oh1');
  assert.equal(v.storagePath, ep.storagePath);
  assert.equal(typeof v.v, 'number');
});
