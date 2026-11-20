// Owner feedback loop on an attached storyboard episode video: approve / request changes / new version / restore.
// No network: Storage is an in-memory bucket; Firestore is the shared fake with deep-merge (same as storyboard-episode-attach.test.js).
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { createRequire } from 'node:module';
import '../../../app/api/archive/__tests__/esm-next-server-shim.mjs';

const require = createRequire(import.meta.url);
const fb = require('../../../api/_lib/firebase-admin.cjs');
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');
const CQ = 'paradice-dbBQCHUX';
const svc = await import('../twitter-service.js');
const { outlineHashOf, episodeAlreadyAttached } = await import('../../brief-video/attach.js');
const { mergeVideoBrief, videoBriefView } = await import('../../brief-video/brief-fields.js');
const { applyStoryboardSet } = await import('../../brief-video/brief-v2.js');
const { classifyVideoProcessing } = await import('../../brief-video/videoStatus.js');
const { listRevisionRequests, applyVideoReview } = await import('../../brief-video/video-review.js');

const EP = (n) => {
  const outline = { schema: 'cq-episode-outline/v0', id: 'cal-x', beats: [{ b: n }] };
  return {
    outlineHash: outlineHashOf(outline), outlineJson: JSON.stringify(outline), episodeId: 'cal-x', kit: 'gravitax',
    storagePath: `clients/${CQ}/brief-videos/2026-11-21_cal-x-v0${n}.mp4`, posterStoragePath: `clients/${CQ}/brief-videos/2026-11-21_cal-x-v0${n}.jpg`,
    width: 1080, height: 1080, durationInFrames: 758, fps: 30, qa: { ok: true, bad: 0 },
  };
};
const VERSION = (n) => ({ v: n, outlineHash: EP(n).outlineHash, episode: EP(n), notes: `what changed ${n}`, createdAt: `2026-11-2${n}T00:00:00Z`, createdBy: 'cq-director' });
const META = (n, versions, status = 'ready') => ({ briefVersion: 2, v2: { format: 'feature' }, status: 'approved', creative: 'c', storyboard: { status, frames: [], episode: EP(n), versions, updatedAt: 'n', updatedBy: 'cq-director' } });

let ctx; let objects; let origDb; let origStorage;
const bucket = () => ({
  name: 'test-bucket',
  file: (path) => ({ exists: async () => [objects.has(path)], getMetadata: async () => [objects.get(path)], setMetadata: async () => [objects.get(path)] }),
});
beforeEach(() => {
  ctx = makeFakeContext({ deepMerge: true });
  objects = new Map();
  for (const n of [1, 2]) {
    objects.set(EP(n).storagePath, { contentType: 'video/mp4', metadata: { firebaseStorageDownloadTokens: `tok${n}` } });
    objects.set(EP(n).posterStoragePath, { contentType: 'image/jpeg', metadata: { firebaseStorageDownloadTokens: `ptok${n}` } });
  }
  origDb = Object.getOwnPropertyDescriptor(fb, 'adminDb'); origStorage = Object.getOwnPropertyDescriptor(fb, 'adminStorage');
  Object.defineProperty(fb, 'adminDb', { configurable: true, get: () => ctx.adminDb });
  Object.defineProperty(fb, 'adminStorage', { configurable: true, get: () => ({ bucket }) });
});
afterEach(() => { Object.defineProperty(fb, 'adminDb', origDb); Object.defineProperty(fb, 'adminStorage', origStorage); });

const raw = (id) => ctx.adminDb._raw('social_posts', id);
const rev = (id) => raw(id).revision || 0;
async function seed(post = {}) {
  const d = await svc.createSocialPost(CQ, { content: 'Your critter has a job.', status: 'draft', reviewOn: '2026-11-21' });
  ctx.adminDb._patch('social_posts', d.id, { reviewOn: '2026-11-21', videoBriefMeta: META(1, [VERSION(1)]), ...post });
  return d.id;
}
const approveSb = (id) => svc.reviewVideoBriefStoryboard(CQ, id, { decision: 'approve' }, { by: 'owner', expectedRevision: rev(id) });
const vreview = (id, input, o = {}) => svc.reviewVideoBriefVideo(CQ, id, input, { by: 'owner', expectedRevision: rev(id), ...o });
const h = (n) => EP(n).outlineHash;
// Director publishes version 2 (direct write: whole storyboard map, status ready, new episode, versions appended).
const directorPublishesV2 = (id) => {
  const m = raw(id).videoBriefMeta;
  ctx.adminDb._patch('social_posts', id, { videoBriefMeta: { ...m, storyboard: { ...m.storyboard, status: 'ready', episode: EP(2), versions: [VERSION(1), VERSION(2)] } } });
};

test('full cycle: attach v1 -> request changes -> Director v2 (same episodeId) -> approve attaches v2 -> repeat approve is a no-op', async () => {
  const id = await seed();
  await approveSb(id);
  assert.equal(raw(id).mediaStoragePath, EP(1).storagePath);
  assert.deepEqual({ ...raw(id).videoBriefMeta.videoReview }, { status: 'pending', v: 1, outlineHash: h(1), notes: null, atSeconds: null, by: null, at: raw(id).videoBriefMeta.videoReview.at, requestedAt: null });

  const urlBefore = raw(id).mediaUrl;
  await vreview(id, { decision: 'changes', notes: 'cut the intro', atSeconds: 12, v: 1, outlineHash: h(1) });
  let m = raw(id).videoBriefMeta;
  assert.equal(m.storyboard.status, 'changes');
  assert.equal(m.videoReview.status, 'changes'); assert.equal(m.videoReview.atSeconds, 12); assert.equal(m.videoReview.notes, 'cut the intro');
  assert.equal(m.storyboard.feedback.length, 1); assert.equal(m.storyboard.feedback[0].v, 1);
  assert.equal(m.storyboard.versions.length, 1, 'versions survive');
  assert.equal(raw(id).mediaUrl, urlBefore, 'media untouched'); assert.equal(raw(id).status, 'draft');
  await vreview(id, { decision: 'changes', notes: 'and the outro', v: 1, outlineHash: h(1) });
  assert.equal(raw(id).videoBriefMeta.storyboard.feedback.length, 2);
  assert.equal(raw(id).videoBriefMeta.videoReview.atSeconds, null, 'stale timestamp not kept');

  directorPublishesV2(id);
  assert.equal(episodeAlreadyAttached(raw(id), EP(2)), false);
  await approveSb(id);
  const r = raw(id);
  assert.equal(r.mediaStoragePath, EP(2).storagePath);
  assert.equal(r.mediaMetadata.outlineHash, h(2));
  assert.match(r.mediaUrl, /tok2/);
  assert.equal(r.videoBriefMeta.storyboard.status, 'approved');
  assert.equal(r.videoBriefMeta.storyboard.versions.length, 2); assert.equal(r.videoBriefMeta.storyboard.feedback.length, 2);
  assert.deepEqual({ ...r.videoBriefMeta.videoReview }, { status: 'pending', v: 2, outlineHash: h(2), notes: null, atSeconds: null, by: null, at: r.videoBriefMeta.videoReview.at, requestedAt: null });
  const before = JSON.stringify(raw(id));
  await svc.reviewVideoBriefStoryboard(CQ, id, { decision: 'approve' }, { by: 'o' });
  assert.equal(JSON.stringify(raw(id)), before);
});

test('video approve: records v + hash, leaves media; closes an open change request', async () => {
  const id = await seed(); await approveSb(id);
  const mediaBefore = raw(id).mediaUrl;
  await vreview(id, { decision: 'approve', v: 1, outlineHash: h(1) });
  assert.equal(raw(id).videoBriefMeta.videoReview.status, 'approved'); assert.equal(raw(id).videoBriefMeta.videoReview.v, 1);
  assert.equal(raw(id).mediaUrl, mediaBefore);
  await vreview(id, { decision: 'changes', notes: 'x', v: 1, outlineHash: h(1) });
  await vreview(id, { decision: 'approve', v: 1, outlineHash: h(1) });
  assert.equal(raw(id).videoBriefMeta.storyboard.status, 'approved');
  assert.equal(raw(id).videoBriefMeta.videoReview.notes, null);
});

test('video review refusals: not draft, no/stale revision, no video, wrong v/hash, empty or long notes, bad atSeconds', async () => {
  const id = await seed();
  await assert.rejects(vreview(id, { decision: 'approve', v: 1, outlineHash: h(1) }), (e) => e.code === 'no-video');
  await approveSb(id);
  await assert.rejects(svc.reviewVideoBriefVideo(CQ, id, { decision: 'approve', v: 1, outlineHash: h(1) }, { by: 'o' }), (e) => e.code === 'revision-conflict');
  await assert.rejects(vreview(id, { decision: 'approve', v: 1, outlineHash: h(1) }, { expectedRevision: rev(id) + 3 }), (e) => e.code === 'revision-conflict');
  await assert.rejects(vreview(id, { decision: 'approve', v: 2, outlineHash: h(1) }), (e) => e.code === 'video-changed');
  await assert.rejects(vreview(id, { decision: 'approve', v: 1, outlineHash: h(2) }), (e) => e.code === 'video-changed');
  await assert.rejects(vreview(id, { decision: 'changes', notes: '  ', v: 1, outlineHash: h(1) }), (e) => e.status === 400);
  await assert.rejects(vreview(id, { decision: 'changes', notes: 'x'.repeat(2001), v: 1, outlineHash: h(1) }), (e) => e.status === 400);
  await assert.rejects(vreview(id, { decision: 'changes', notes: 'x', atSeconds: -3, v: 1, outlineHash: h(1) }), (e) => e.status === 400);
  await assert.rejects(vreview(id, { decision: 'maybe', v: 1, outlineHash: h(1) }), (e) => e.status === 400);
  ctx.adminDb._patch('social_posts', id, { status: 'approved' });
  await assert.rejects(vreview(id, { decision: 'approve', v: 1, outlineHash: h(1) }), (e) => e.code === 'not-draft');
  assert.throws(() => applyVideoReview({ videoBriefMeta: { storyboard: {} } }, { decision: 'approve' }), (e) => e.code === 'no-storyboard');
});

test('restore: puts v1 back (same guards), keeps versions/feedback, closes changes; repeat is a no-op', async () => {
  const id = await seed(); await approveSb(id);
  directorPublishesV2(id); await approveSb(id);
  await vreview(id, { decision: 'changes', notes: 'worse', v: 2, outlineHash: h(2) });
  await svc.restoreVideoBriefVersion(CQ, id, { v: 1 }, { by: 'o', expectedRevision: rev(id) });
  const r = raw(id);
  assert.equal(r.mediaStoragePath, EP(1).storagePath); assert.match(r.mediaUrl, /tok1/);
  assert.equal(r.videoBriefMeta.videoReview.status, 'pending'); assert.equal(r.videoBriefMeta.videoReview.v, 1); assert.equal(r.videoBriefMeta.videoReview.notes, null);
  assert.equal(r.videoBriefMeta.storyboard.status, 'approved');
  assert.equal(r.videoBriefMeta.storyboard.versions.length, 2); assert.equal(r.videoBriefMeta.storyboard.feedback.length, 1);
  assert.equal(r.status, 'draft'); assert.equal(r.mediaMetadata.outlineHash, h(1));
  const before = JSON.stringify(raw(id));
  await svc.restoreVideoBriefVersion(CQ, id, { v: 1 }, { by: 'o', expectedRevision: 0 });
  assert.equal(JSON.stringify(raw(id)), before);
  // storyboard.episode is still v2: it must not read as "already attached" once v1 is on the post
  assert.equal(episodeAlreadyAttached(raw(id), EP(2)), false);
  assert.equal(episodeAlreadyAttached(raw(id), EP(1)), true);
});

test('restore while a new version is ready leaves it pending; refuses bad versions, owner media, missing storage, non-draft, stale revision', async () => {
  const id = await seed(); await approveSb(id);
  directorPublishesV2(id);
  await svc.restoreVideoBriefVersion(CQ, id, { v: 1 }, { by: 'o', expectedRevision: rev(id) }); // already on post: no-op
  assert.equal(raw(id).videoBriefMeta.storyboard.status, 'ready');
  await assert.rejects(svc.restoreVideoBriefVersion(CQ, id, { v: 9 }, { by: 'o', expectedRevision: rev(id) }), (e) => e.code === 'no-such-version');
  await assert.rejects(svc.restoreVideoBriefVersion(CQ, id, { v: 0 }, { by: 'o', expectedRevision: rev(id) }), (e) => e.status === 400);
  await approveSb(id); // v2 on post
  await assert.rejects(svc.restoreVideoBriefVersion(CQ, id, { v: 1 }, { by: 'o', expectedRevision: rev(id) + 2 }), (e) => e.code === 'revision-conflict');
  await assert.rejects(svc.restoreVideoBriefVersion(CQ, id, { v: 1 }, { by: 'o' }), (e) => e.code === 'revision-conflict');
  objects.delete(EP(1).storagePath);
  await assert.rejects(svc.restoreVideoBriefVersion(CQ, id, { v: 1 }, { by: 'o', expectedRevision: rev(id) }), (e) => e.code === 'episode-media-missing');
  assert.equal(raw(id).mediaStoragePath, EP(2).storagePath);
  objects.set(EP(1).storagePath, { contentType: 'video/mp4', metadata: { firebaseStorageDownloadTokens: 'tok1' } });
  const own = await seed({ mediaUrl: 'https://owner/up.mp4', mediaJobId: 'howto_1' });
  await assert.rejects(svc.restoreVideoBriefVersion(CQ, own, { v: 1 }, { by: 'o', expectedRevision: rev(own) }), (e) => e.code === 'has-media');
  const bad = await seed({ videoBriefMeta: META(1, [{ ...VERSION(1), episode: { ...EP(1), qa: { ok: false } } }]) });
  await assert.rejects(svc.restoreVideoBriefVersion(CQ, bad, { v: 1 }, { by: 'o', expectedRevision: rev(bad) }), (e) => e.code === 'episode-qa-not-passed');
  ctx.adminDb._patch('social_posts', id, { status: 'approved' });
  await assert.rejects(svc.restoreVideoBriefVersion(CQ, id, { v: 1 }, { by: 'o', expectedRevision: rev(id) }), (e) => e.code === 'not-draft');
});

test('versions/feedback survive a v2 brief edit, a storyboard re-set and the view; emptying a versioned brief is refused', async () => {
  const id = await seed(); await approveSb(id);
  await vreview(id, { decision: 'changes', notes: 'n', v: 1, outlineHash: h(1) });
  const post = raw(id);
  const full = { format: 'feature', angle: 'a', poster: { idea: 'i', banner: 'b' }, hero: 'h', theme: 't', beats: [{ purpose: 'p', screen: 's', camera: 'c', cursor: 'k', response: 'r', caption: 'c', transition: 't', seconds: 5 }], payoff: 'p', end: 'e', mustNot: '', voiceMode: 'caption-only', narrationLines: [], needs: [] };
  const edited = mergeVideoBrief(post, { v2: full, status: 'draft' }, { now: 'n', by: 'o' });
  const sb = edited.videoBriefMeta.storyboard;
  assert.equal(sb.status, 'pending'); assert.equal(sb.episode, null);
  assert.equal(sb.versions.length, 1); assert.equal(sb.feedback.length, 1);
  assert.equal(edited.videoBriefMeta.videoReview.status, 'pending'); assert.equal(edited.videoBriefMeta.videoReview.notes, null);
  await svc.saveVideoBrief(CQ, id, { v2: full, status: 'draft' }, { by: 'o', expectedRevision: rev(id) });
  assert.equal(raw(id).videoBriefMeta.storyboard.versions.length, 1);
  assert.equal(raw(id).videoBriefMeta.storyboard.feedback.length, 1);
  assert.equal(raw(id).videoBriefMeta.videoReview.status, 'pending'); assert.equal(raw(id).videoBriefMeta.videoReview.notes, null);
  assert.throws(() => mergeVideoBrief(post, { template: '', status: 'draft' }, { now: 'n' }), (e) => e.code === 'brief-has-versions');
  const set = applyStoryboardSet({ ...post.videoBriefMeta, status: 'approved' }, { outline: 'o' }, { now: 'n' });
  assert.equal(set.storyboard.versions.length, 1); assert.equal(set.storyboard.feedback.length, 1);
  const view = videoBriefView(post);
  assert.ok(view.meta.storyboard.versions.every((x) => !('outlineJson' in x.episode)));
  assert.ok('outlineJson' in post.videoBriefMeta.storyboard.versions[0].episode, 'stored row untouched');
});

test('calendar chip derives from videoReview + storyboard.status (never videoBriefStatus); inbox lists open requests newest first', async () => {
  const id = await seed({ videoBrief: 'c' }); await approveSb(id);
  assert.ok(!/^revision/.test(classifyVideoProcessing(raw(id), [])?.state || ''));
  await vreview(id, { decision: 'changes', notes: 'cut it', atSeconds: 5, v: 1, outlineHash: h(1) });
  assert.equal(classifyVideoProcessing(raw(id), []).state, 'revision-requested');
  assert.equal(raw(id).videoBriefStatus ?? null, null);
  directorPublishesV2(id);
  ctx.adminDb._patch('social_posts', id, { videoBriefMeta: { ...raw(id).videoBriefMeta, videoReview: { ...raw(id).videoBriefMeta.videoReview, status: 'pending' } } });
  assert.equal(classifyVideoProcessing(raw(id), []).state, 'revision-ready');
  const a = { id: 'a', status: 'draft', videoBriefMeta: { briefVersion: 2, v2: {}, storyboard: { status: 'changes', feedback: [{ v: 1, notes: 'old', at: '2026-11-20T00:00:00Z' }] } } };
  const b = { id: 'b', status: 'draft', videoBriefMeta: { briefVersion: 2, v2: {}, videoReview: { status: 'changes', v: 2, notes: 'newer', atSeconds: 3, requestedAt: '2026-11-21T00:00:00Z' }, storyboard: { status: 'changes' } } };
  const sent = { ...b, id: 'c', status: 'approved' };
  const ok = { id: 'd', status: 'draft', videoBriefMeta: { briefVersion: 2, v2: {}, storyboard: { status: 'approved' } } };
  const list = listRevisionRequests([a, ok, b, sent, null]);
  assert.deepEqual(list.map((x) => x.postId), ['b', 'a']);
  assert.equal(list[0].notes, 'newer'); assert.equal(list[0].atSeconds, 3); assert.equal(list[1].notes, 'old');
  assert.deepEqual(await svc.readRevisionRequests(CQ).then((r) => r.map((x) => x.postId)), [], 'a published new version is no longer an open request');
});
