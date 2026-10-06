import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPostText, buildDraftPayload, buildDraftMediaPatch, buildContentPackage, buildStoragePath,
  parseUploadUrlRequest, parseDraftRequest, parseVariants, buildMediaVariants, isBuilderContent, isAllowedUsageModule, packageId,
} from '../draft-builder.js';
import { validatePackage } from '../../x-content-inventory/schema.js';
import { SERIES } from '../../x-content-inventory/categories.js';
import { hasMemoryPlaceholder, assertNoMemoryPlaceholder, sanitizeSelfReply, sanitizeSourceRef } from '../../social-posting/self-reply.js';

const body = {
  releaseId: 74379, discogsUrl: 'https://www.discogs.com/release/74379', artist: 'Aphex Twin', title: 'Windowlicker',
  label: 'Warp Records', catno: 'WAP 105', year: '1999',
  videoStoragePath: 'publish-staging/discogs/74379/video.mp4', imageStoragePath: 'publish-staging/discogs/74379/image.jpg',
  files: { images: ['a.jpg'], videos: ['a.mp4'] }, clip: { start: 1, end: 61, look: 'x' },
};

test('post text format and 280 cap', () => {
  const t = buildPostText(body);
  assert.equal(t, 'Aphex Twin – Windowlicker\nWarp Records · WAP 105 · 1999\n\n[add your memory]');
  assert.equal(buildPostText({ ...body, year: null }).includes('105\n\n'), true);
  assert.ok(buildPostText({ ...body, title: 'x'.repeat(500) }).length <= 280);
});

test('draft payload shape', () => {
  const p = buildDraftPayload(body, { videoUrl: 'V', imageUrl: 'I' });
  assert.equal(p.status, 'draft'); assert.equal(p.scheduledAt, null); assert.equal(p.source, 'discogs-ingest');
  assert.deepEqual(p.sourceRef, { releaseId: 74379, discogsUrl: body.discogsUrl, catno: 'WAP 105' });
  assert.equal(p.mediaUrl, 'V'); assert.equal(p.selfReply.mediaUrl, 'I');
  assert.equal(p.selfReply.text, 'On Discogs: ' + body.discogsUrl); assert.equal(p.needsStory, true);
  const patch = buildDraftMediaPatch(body, { videoUrl: 'V', imageUrl: 'I' });
  assert.equal('content' in patch, false); assert.equal('status' in patch, false);
});

test('content package validates and keeps human story/status', () => {
  const pkg = buildContentPackage(body);
  assert.equal(pkg.id, 'discogs-74379'); assert.equal(pkg.eraYear, 1999); assert.equal(pkg.pillar, SERIES.C1.pillar);
  assert.equal(validatePackage(pkg).ok, true);
  const kept = buildContentPackage(body, { story: 'my memory', status: 'drafted' });
  assert.equal(kept.story, 'my memory'); assert.equal(kept.status, 'drafted');
  assert.equal(buildContentPackage({ ...body, year: null }).eraYear, null);
});

test('request validation', () => {
  assert.equal(parseUploadUrlRequest({ releaseId: 1, kind: 'image', contentType: 'image/jpeg' }).storagePath, buildStoragePath(1, 'image'));
  assert.throws(() => parseUploadUrlRequest({ releaseId: 1, kind: 'video', contentType: 'image/jpeg' }), { status: 400 });
  assert.throws(() => parseUploadUrlRequest({ releaseId: '1', kind: 'image', contentType: 'image/jpeg' }), { status: 400 });
  assert.equal(parseDraftRequest(body).releaseId, 74379);
  assert.throws(() => parseDraftRequest({ ...body, videoStoragePath: 'other/path.mp4' }), { status: 400 });
  assert.equal(packageId(5), 'discogs-5');
});

test('usage module allow-list', () => {
  assert.equal(isAllowedUsageModule('discogs-vision'), true);
  assert.equal(isAllowedUsageModule('social-posting'), false);
});

test('self-reply helpers + placeholder guard', () => {
  assert.equal(hasMemoryPlaceholder('x [add your memory]'), true);
  assert.throws(() => assertNoMemoryPlaceholder('hi [Add Your Memory]'), { status: 409 });
  assert.doesNotThrow(() => assertNoMemoryPlaceholder('done'));
  assert.equal(sanitizeSelfReply(null), null);
  assert.throws(() => sanitizeSelfReply({ text: 'x'.repeat(281) }), { status: 400 });
  assert.equal(sanitizeSelfReply({ text: 'a', mediaUrl: 'u', mediaContentType: 'image/jpeg' }).mediaType, 'image');
  assert.deepEqual(sanitizeSourceRef({ releaseId: 1 }), { releaseId: 1 });
  assert.equal(sanitizeSourceRef([1]), null);
});

test('upload-url variant paths', () => {
  const r = (extra) => parseUploadUrlRequest({ releaseId: 0, kind: 'video', contentType: 'video/mp4', ...extra });
  assert.equal(r({}).storagePath, 'publish-staging/discogs/0/video.mp4');
  assert.equal(r({ variant: '1x1' }).storagePath, 'publish-staging/discogs/0/video-1x1.mp4');
  assert.equal(parseUploadUrlRequest({ releaseId: 7, kind: 'image', contentType: 'image/jpeg', variant: '9x16' }).storagePath, 'publish-staging/discogs/7/image-9x16.jpg');
  assert.throws(() => r({ variant: '16x9' }), { status: 400 });
});

test('draft variants validation', () => {
  const ok = { video: { '9x16': 'publish-staging/discogs/74379/video-9x16.mp4', '1x1': 'publish-staging/discogs/74379/video-1x1.mp4' }, image: { '1x1': 'publish-staging/discogs/74379/image-1x1.jpg' } };
  assert.deepEqual(parseDraftRequest({ ...body, variants: ok }).variants, ok);
  assert.deepEqual(parseDraftRequest(body).variants, {});
  for (const bad of [
    { video: { '1x1': 'publish-staging/discogs/1/video-1x1.mp4' } },
    { video: { '1x1': 'publish-staging/discogs/74379/../1/video-1x1.mp4' } },
    { video: { '1x1': 'publish-staging/discogs/74379/image-1x1.jpg' } },
    { video: { '4x5': 'publish-staging/discogs/74379/video-4x5.mp4' } },
    { audio: {} }, [], 'x',
  ]) assert.throws(() => parseVariants(74379, bad), { status: 400 });
  const pkg = buildContentPackage({ ...body, variants: ok });
  assert.equal(pkg.assetRefs.length, 5); assert.equal(new Set(pkg.assetRefs).size, 5);
  assert.equal(validatePackage(pkg).ok, true);
  const mv = buildMediaVariants(ok, Object.fromEntries(Object.values(ok).flatMap((g) => Object.values(g)).map((p) => [p, 'U:' + p])));
  assert.equal(mv.video['1x1'].url, 'U:publish-staging/discogs/74379/video-1x1.mp4');
  assert.equal(buildDraftPayload(body, { videoUrl: 'V', imageUrl: 'I', mediaVariants: mv }).mediaVariants, mv);
  assert.equal('mediaVariants' in buildDraftPayload(body, { videoUrl: 'V', imageUrl: 'I' }), false);
  assert.equal(buildMediaVariants({}, {}), null);
});

test('content refresh rule only for untouched builder text', () => {
  assert.equal(isBuilderContent(buildPostText(body)), true);
  assert.equal(isBuilderContent(buildPostText({ ...body, label: '', catno: '', year: null })), true);
  assert.equal(isBuilderContent(buildPostText(body).replace('[add your memory]', 'I found this in Leeds')), false);
  assert.equal(isBuilderContent(buildPostText(body) + ' ok'), false);
  assert.equal(isBuilderContent('Intro line\n' + buildPostText(body)), false);
  assert.equal(isBuilderContent('[add your memory]'), false);
  assert.equal(isBuilderContent(null), false);
});

test('parseDraftRequest accepts a variant path as the post/self-reply media, rejects other releases', async () => {
  const { parseDraftRequest: parse } = await import('../draft-builder.js');
  const base = { releaseId: 74379, discogsUrl: 'https://www.discogs.com/release/74379', artist: 'A', title: 'T' };
  const ok = parse({ ...base, videoStoragePath: 'publish-staging/discogs/74379/video-1x1.mp4', imageStoragePath: 'publish-staging/discogs/74379/image-1x1.jpg' });
  assert.equal(ok.videoStoragePath ?? 'publish-staging/discogs/74379/video-1x1.mp4', 'publish-staging/discogs/74379/video-1x1.mp4');
  assert.throws(() => parse({ ...base, videoStoragePath: 'publish-staging/discogs/1/video-1x1.mp4', imageStoragePath: 'publish-staging/discogs/74379/image.jpg' }), /videoStoragePath/);
});
