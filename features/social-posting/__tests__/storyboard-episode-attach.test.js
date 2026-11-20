// Owner approves a v2 storyboard that carries a pre-rendered episode -> the video is attached to the draft in the same transaction.
// No network: Storage is a tiny in-memory bucket (exists / getMetadata / setMetadata); Firestore is the shared fake with deep-merge.
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { createRequire } from 'node:module';
import '../../../app/api/archive/__tests__/esm-next-server-shim.mjs';

const require = createRequire(import.meta.url);
const fb = require('../../../api/_lib/firebase-admin.cjs');
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');
const CQ = 'paradice-dbBQCHUX';
const svc = await import('../twitter-service.js');
const { planEpisodeAttach, validateEpisode, outlineHashOf, resolveEpisodeAudio } = await import('../../brief-video/attach.js');
const { mergeVideoBrief, videoBriefView } = await import('../../brief-video/brief-fields.js');

const OUTLINE = { schema: 'cq-episode-outline/v0', id: 'cal-2026-11-21-x', beats: [{ b: 1, a: 2 }] };
const EP = () => ({
  outlineHash: outlineHashOf(OUTLINE), outlineJson: JSON.stringify(OUTLINE), episodeId: 'cal-2026-11-21-x', kit: 'gravitax',
  storagePath: `clients/${CQ}/brief-videos/2026-11-21_x.mp4`, posterStoragePath: `clients/${CQ}/brief-videos/2026-11-21_x.jpg`,
  width: 1080, height: 1080, durationInFrames: 758, fps: 30, qa: { ok: true, bad: 0 },
});
const V2META = (episode, status = 'ready') => ({ briefVersion: 2, v2: { format: 'feature' }, status: 'approved', creative: 'c', storyboard: { status, frames: [], episode, updatedAt: 'n', updatedBy: 'cq-director' } });

let ctx; let objects; let setMetaCalls; let origDb; let origStorage;
const bucket = () => ({
  name: 'test-bucket',
  file: (path) => ({
    exists: async () => [objects.has(path)],
    getMetadata: async () => [objects.get(path)],
    setMetadata: async (m) => { setMetaCalls += 1; Object.assign(objects.get(path), { metadata: { ...objects.get(path).metadata, ...m.metadata } }); return [objects.get(path)]; },
  }),
});
beforeEach(() => {
  ctx = makeFakeContext({ deepMerge: true });
  objects = new Map(); setMetaCalls = 0;
  const ep = EP();
  objects.set(ep.storagePath, { contentType: 'video/mp4', metadata: { firebaseStorageDownloadTokens: 'tok-v' } });
  objects.set(ep.posterStoragePath, { contentType: 'image/jpeg', metadata: {} }); // no token: must be minted
  origDb = Object.getOwnPropertyDescriptor(fb, 'adminDb'); origStorage = Object.getOwnPropertyDescriptor(fb, 'adminStorage');
  Object.defineProperty(fb, 'adminDb', { configurable: true, get: () => ctx.adminDb });
  Object.defineProperty(fb, 'adminStorage', { configurable: true, get: () => ({ bucket }) });
});
afterEach(() => { Object.defineProperty(fb, 'adminDb', origDb); Object.defineProperty(fb, 'adminStorage', origStorage); });

const raw = (id) => ctx.adminDb._raw('social_posts', id);
async function seed({ episode = EP(), post = {}, sbStatus = 'ready' } = {}) {
  const d = await svc.createSocialPost(CQ, { content: 'Your critter has a job.', status: 'draft', reviewOn: '2026-11-21' });
  ctx.adminDb._patch('social_posts', d.id, { reviewOn: '2026-11-21', videoBriefMeta: V2META(episode, sbStatus), ...post });
  return d.id;
}
const approve = (id, rev = raw(id).revision || 0) => svc.reviewVideoBriefStoryboard(CQ, id, { decision: 'approve' }, { by: 'owner', expectedRevision: rev });

test('approve attaches the episode video with server-derived URLs and the reference field shapes', async () => {
  const id = await seed();
  const out = await approve(id);
  const r = raw(id);
  assert.equal(r.mediaType, 'video'); assert.equal(r.mediaContentType, 'video/mp4');
  assert.equal(r.mediaUrl, `https://firebasestorage.googleapis.com/v0/b/test-bucket/o/${encodeURIComponent(EP().storagePath)}?alt=media&token=tok-v`);
  assert.match(r.posterUrl, /\.jpg\?alt=media&token=[0-9a-f-]{36}$/);
  assert.equal(setMetaCalls, 1, 'poster token minted');
  assert.equal(r.mediaStoragePath, EP().storagePath);
  assert.equal(r.mediaJobId, 'cal_cal-2026-11-21-x');
  assert.deepEqual({ ...r.mediaMetadata }, { source: 'cq-calendar-episode', templateVersion: 'cq-cal-1', episodeId: 'cal-2026-11-21-x', kit: 'gravitax', outlineHash: EP().outlineHash, width: 1080, height: 1080, durationInFrames: 758, howtoId: null, specHash: null, requestHash: null });
  assert.equal(r.videoBriefMeta.status, 'rendered');
  assert.equal(r.videoBriefMeta.storyboard.status, 'approved');
  assert.equal(r.agents.mediaGenerator.status, 'complete');
  assert.equal(r.agents.mediaGenerator.jobId, 'cal_cal-2026-11-21-x');
  assert.equal(r.status, 'draft');
  assert.equal(out.revision, raw(id).revision);
});

test('approve replaces earlier bv_/cal_ media and nulls stale how-to metadata', async () => {
  const id = await seed({ post: { mediaUrl: 'https://old', mediaJobId: 'bv_1', mediaMetadata: { source: 'cq-howto', howtoId: 'h1', specHash: 's1', requestHash: 'r1' }, videoBriefStatus: 'waiting', videoBriefReason: 'x' } });
  await approve(id);
  assert.equal(raw(id).mediaMetadata.howtoId, null); assert.equal(raw(id).mediaMetadata.specHash, null);
  assert.equal(raw(id).videoBriefStatus, null); assert.equal(raw(id).videoBriefReason, null);
});

test('approve refuses owner-uploaded media, variants and NAS media; the post stays untouched', async () => {
  for (const post of [{ mediaUrl: 'https://owner/upload.mp4' }, { mediaUrl: 'https://o', mediaJobId: 'howto_9' }, { mediaVariants: [{ a: 1 }] }, { nasSha: 'abc' }]) {
    const id = await seed({ post });
    await assert.rejects(approve(id), (e) => e.status === 409 && e.code === 'has-media');
    assert.equal(raw(id).videoBriefMeta.storyboard.status, 'ready');
    assert.notEqual(raw(id).mediaJobId, 'cal_cal-2026-11-21-x');
  }
});

test('approve refuses non-draft, empty / overlong copy, and a missing or stale expectedRevision', async () => {
  const sent = await seed({ post: { status: 'approved' } });
  await assert.rejects(approve(sent), (e) => e.status === 409 && e.code === 'not-draft');
  const long = await seed({ post: { content: 'x'.repeat(281) } });
  await assert.rejects(approve(long), (e) => e.code === 'public-copy-too-long');
  const empty = await seed({ post: { content: '  ' } });
  await assert.rejects(approve(empty), (e) => e.code === 'empty-public-copy');
  const id = await seed();
  await assert.rejects(svc.reviewVideoBriefStoryboard(CQ, id, { decision: 'approve' }, { by: 'o' }), (e) => e.code === 'revision-conflict');
  await assert.rejects(approve(id, (raw(id).revision || 0) + 5), (e) => e.code === 'revision-conflict');
  assert.ok(!raw(id).mediaUrl);
});

test('hash / path / qa validation: nothing is trusted from the stored episode', async () => {
  const bad = [
    [{ outlineHash: 'XYZ' }, 'episode-bad-hash'],
    [{ outlineHash: 'a'.repeat(16) }, 'episode-hash-mismatch'], // outlineJson no longer hashes to it
    [{ storagePath: `clients/other-client/brief-videos/x.mp4` }, 'episode-bad-path'],
    [{ storagePath: `clients/${CQ}/brief-videos/../secrets/x.mp4` }, 'episode-bad-path'],
    [{ storagePath: `clients/${CQ}/brief-videos/x.mov` }, 'episode-bad-path'],
    [{ posterStoragePath: `clients/${CQ}/brief-videos/x.png` }, 'episode-bad-poster-path'],
    [{ qa: { ok: false, bad: 2 } }, 'episode-qa-not-passed'],
    [{ qa: undefined }, 'episode-qa-not-passed'],
  ];
  for (const [over, reason] of bad) assert.equal(validateEpisode({ ...EP(), ...over }, { clientId: CQ }).reason, reason, JSON.stringify(over));
  assert.equal(validateEpisode(EP(), { clientId: CQ }).ok, true);
  // service level: object missing, wrong content type
  const missing = await seed({ episode: { ...EP(), storagePath: `clients/${CQ}/brief-videos/none.mp4` } });
  await assert.rejects(approve(missing), (e) => e.code === 'episode-media-missing');
  objects.get(EP().storagePath).contentType = 'application/octet-stream';
  const wrongType = await seed();
  await assert.rejects(approve(wrongType), (e) => e.code === 'episode-media-missing');
  assert.ok(!raw(wrongType).mediaUrl);
  // pure planner also refuses a url-less call
  assert.equal(planEpisodeAttach({ clientId: CQ, status: 'draft', content: 'c' }, EP(), { clientId: CQ }).reason, 'job-incomplete');
});

test("'changes' decision never touches media", async () => {
  const id = await seed();
  await svc.reviewVideoBriefStoryboard(CQ, id, { decision: 'changes', notes: 'slower' }, { by: 'o', expectedRevision: raw(id).revision || 0 });
  assert.equal(raw(id).videoBriefMeta.storyboard.status, 'changes');
  assert.ok(!raw(id).mediaUrl); assert.equal(raw(id).videoBriefMeta.status, 'approved');
});

test('re-approve with the same episode is a success no-op (no write, no revision bump)', async () => {
  const id = await seed();
  await approve(id);
  const before = JSON.stringify(raw(id));
  const again = await svc.reviewVideoBriefStoryboard(CQ, id, { decision: 'approve' }, { by: 'o' }); // even a stale/missing revision
  assert.equal(JSON.stringify(raw(id)), before);
  assert.equal(again.mediaJobId, 'cal_cal-2026-11-21-x');
});

test('approve without an episode keeps the old behaviour (no media, no revision needed)', async () => {
  const id = await seed({ episode: null });
  await svc.reviewVideoBriefStoryboard(CQ, id, { decision: 'approve' }, { by: 'o' });
  assert.equal(raw(id).videoBriefMeta.storyboard.status, 'approved');
  assert.ok(!raw(id).mediaUrl);
});

test('stale episode is cleared: storyboard-set writes episode:null, a v2 brief edit resets it to null', async () => {
  const id = await seed({ sbStatus: 'approved' });
  await svc.setVideoBriefStoryboard(CQ, id, { outline: 'new outline' }, { by: 'cq-director', expectedRevision: raw(id).revision || 0 });
  assert.equal(raw(id).videoBriefMeta.storyboard.episode, null);
  assert.equal(raw(id).videoBriefMeta.storyboard.status, 'ready');
  // pure brief edit path
  const post = { clientId: CQ, status: 'draft', content: 'c', videoBriefMeta: V2META(EP(), 'approved') };
  const full = { format: 'feature', angle: 'a', poster: { idea: 'i', banner: 'b' }, hero: 'h', theme: 't', beats: [{ purpose: 'p', screen: 's', camera: 'c', cursor: 'k', response: 'r', caption: 'c', transition: 't', seconds: 5 }], payoff: 'p', end: 'e', mustNot: '', voiceMode: 'caption-only', narrationLines: [], needs: [] };
  const edited = mergeVideoBrief(post, { v2: full }, { now: 'n', by: 'o' });
  assert.equal(edited.videoBriefMeta.storyboard.status, 'pending');
  assert.equal(edited.videoBriefMeta.storyboard.episode, null);
  // and approve treats the null as "no episode"
  ctx.adminDb._patch('social_posts', id, { videoBriefMeta: { ...raw(id).videoBriefMeta, storyboard: { ...raw(id).videoBriefMeta.storyboard, status: 'ready' } } });
  await svc.reviewVideoBriefStoryboard(CQ, id, { decision: 'approve' }, { by: 'o' });
  assert.ok(!raw(id).mediaUrl);
});

// ── Audio preview (storyboard "Listen: narration + music") ─────────────────────────────────────────────────────────────
const AUDIO = `clients/${CQ}/brief-videos/2026-11-21_x-v01-audio.mp3`;
test('validateEpisode: audioPreviewPath is optional and follows the same prefix/dir rules (.mp3)', () => {
  assert.equal(validateEpisode({ ...EP(), audioPreviewPath: AUDIO }, { clientId: CQ }).ok, true);
  assert.equal(validateEpisode({ ...EP(), audioPreviewPath: null }, { clientId: CQ }).ok, true);
  for (const bad of [`clients/${CQ}/brief-videos/x.wav`, 'clients/other/brief-videos/x.mp3', `clients/${CQ}/storyboards/x.mp3`, `clients/${CQ}/brief-videos/../x.mp3`, 42]) {
    assert.equal(validateEpisode({ ...EP(), audioPreviewPath: bad }, { clientId: CQ }).reason, 'episode-bad-audio-path', String(bad));
  }
});

test('resolveEpisodeAudio: server-derived URL for audio/*, null when absent / missing / wrong type; mints a token when missing', async () => {
  const b = bucket();
  assert.equal(await resolveEpisodeAudio(b, EP(), { clientId: CQ }), null, 'no audioPreviewPath');
  const ep = { ...EP(), audioPreviewPath: AUDIO };
  assert.equal(await resolveEpisodeAudio(b, ep, { clientId: CQ }), null, 'object missing');
  objects.set(AUDIO, { contentType: 'video/mp4', metadata: { firebaseStorageDownloadTokens: 't' } });
  assert.equal(await resolveEpisodeAudio(b, ep, { clientId: CQ }), null, 'not audio/*');
  objects.set(AUDIO, { contentType: 'audio/mpeg', metadata: { firebaseStorageDownloadTokens: 'tok-a' } });
  assert.equal(await resolveEpisodeAudio(b, ep, { clientId: CQ }), `https://firebasestorage.googleapis.com/v0/b/test-bucket/o/${encodeURIComponent(AUDIO)}?alt=media&token=tok-a`);
  objects.set(AUDIO, { contentType: 'audio/mpeg', metadata: {} });
  assert.match(await resolveEpisodeAudio(b, ep, { clientId: CQ }), /-audio\.mp3\?alt=media&token=[0-9a-f-]{36}$/);
  assert.equal(await resolveEpisodeAudio(b, { ...ep, audioPreviewPath: 'clients/other/brief-videos/a.mp3' }, { clientId: CQ }), null, 'bad path never touches storage');
});

test('episodeAudioUrlFor resolves the current episode; videoBriefView carries episodeAudioUrl', async () => {
  objects.set(AUDIO, { contentType: 'audio/mpeg', metadata: { firebaseStorageDownloadTokens: 'tok-a' } });
  const id = await seed({ episode: { ...EP(), audioPreviewPath: AUDIO } });
  const post = { ...raw(id), id };
  const url = await svc.episodeAudioUrlFor(post);
  assert.match(url, /tok-a$/);
  assert.equal(await svc.episodeAudioUrlFor({ ...raw(await seed()), clientId: CQ }), null, 'episode without audio');
  const view = videoBriefView(post, { episodeAudioUrl: url });
  assert.equal(view.episodeAudioUrl, url);
  assert.equal(videoBriefView(post).episodeAudioUrl, null);
});
