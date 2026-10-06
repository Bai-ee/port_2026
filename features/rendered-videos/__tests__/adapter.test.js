import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderedVideoToPackage, mapRenderedVideos, renderOrigin, objectPathFromUrl, exclusionReason, findUeArtist,
} from '../adapter.js';
import { resolveMediaUrls, evObjectPath } from '../media-url.js';
import { validatePackage } from '../../x-content-inventory/schema.js';

const SIGNED = 'https://storage.googleapis.com/editvideos-63486.firebasestorage.app/videos/ACIDMAN_video_123.mp4?X-Goog-Signature=abc&X-Goog-Expires=31536000';
const vid = (o = {}) => ({
  id: 'job1', jobId: 'job1', artist: 'ACIDMAN', mixTitle: 'Stargazers vs Sunbathers', duration: 125, fileSize: 1e7,
  videoUrl: SIGNED, status: 'completed', createdAt: { toMillis: () => Date.parse('2026-09-01T12:00:00Z') }, ...o,
});
const ue = [{ artistName: 'ACIDMAN', artistGenre: 'acid', mixes: [{ mixTitle: 'Stargazers vs Sunbathers', mixDateYear: "'09" }] }];
const daily = { recipe: { filter: 'look_hard_bw_street_doc', manualOrderSegments: 6 }, recipeFull: { filter: { key: 'look_hard_bw_street_doc' }, logos: { end: 'mixtapes_white_square.png' }, videoOrder: new Array(6).fill({}) } };

test('mapping: ids, bucket, series, format, source, title', () => {
  const p = renderedVideoToPackage(vid(), { ueArtists: ue, now: Date.parse('2026-10-06T00:00:00Z') });
  assert.equal(p.id, 'rv-job1');
  assert.equal(p.bucketId, 'ue');
  assert.equal(p.series, 'C4');
  assert.equal(p.engine, 'ue');
  assert.equal(p.title, 'ACIDMAN – Stargazers vs Sunbathers');
  assert.equal(p.format, 'video');
  assert.equal(p.mediaState, 'video');
  assert.deepEqual(p.source, { kind: 'rendered-video', externalId: 'job1' });
  assert.equal(p.story, '[add your memory]');
  assert.match(p.variants.x.suggestedStory, /ACIDMAN/);
  assert.match(p.variants.x.suggestedStory, /2:05/);
});

test('assetRefs hold the object path, never a signed URL', () => {
  const p = renderedVideoToPackage(vid());
  assert.deepEqual(p.assetRefs, ['ev:videos/ACIDMAN_video_123.mp4']);
  assert.ok(!JSON.stringify(p).includes('X-Goog'));
  assert.ok(!JSON.stringify(p).includes('https://'));
  assert.equal(objectPathFromUrl('https://firebasestorage.googleapis.com/v0/b/b/o/videos%2Fx.mp4?alt=media'), 'videos/x.mp4');
  assert.equal(objectPathFromUrl('https://example.com/videos/x.mp4'), null);
});

test('exclusion: failed, deleted, non-completed, no path', () => {
  assert.ok(exclusionReason(vid({ status: 'failed' })));
  assert.ok(exclusionReason(vid({ status: 'processing' })));
  assert.ok(exclusionReason(vid({ deleted: true })));
  assert.ok(exclusionReason(vid({ videoUrl: 'nope' })));
  assert.equal(renderedVideoToPackage(vid({ status: 'failed' })), null);
  const { packages, skipped } = mapRenderedVideos([vid(), vid({ id: 'b', jobId: 'b', status: 'failed' }), vid()]);
  assert.equal(packages.length, 1);
  assert.equal(skipped.length, 2);
});

test('rights: owner owned, others never-public; default mixTitle = unknown mix', () => {
  const owned = renderedVideoToPackage(vid({ artist: 'Bai-ee' }));
  assert.equal(owned.rights, 'owned');
  assert.equal(owned.approval.state, 'none');
  const other = renderedVideoToPackage(vid());
  assert.equal(other.rights, 'never-public');
  assert.equal(other.approval.state, 'needed');
  const unk = renderedVideoToPackage(vid({ mixTitle: 'Hitloop Video Remix' }), { ueArtists: ue });
  assert.ok(unk.tags.includes('mix-unknown'));
  assert.equal(unk.eraYear, null);
  assert.ok(!unk.title.includes('Hitloop Video Remix'));
});

test('auto-daily tagging: daily fingerprint, deliberate, unknown', () => {
  assert.equal(renderOrigin(daily), 'auto-daily');
  assert.equal(renderOrigin({ recipe: { filter: 'look_hard_bw_street_doc', manualOrderSegments: 6 } }), 'auto-daily'); // trimmed-only job
  assert.equal(renderOrigin({ recipe: { filter: 'vhs', manualOrderSegments: 0 }, recipeFull: { filter: { key: 'vhs' } } }), 'deliberate');
  assert.equal(renderOrigin({ recipe: { filter: 'look_hard_bw_street_doc' }, recipeFull: { filter: { key: 'look_hard_bw_street_doc' } } }), 'deliberate'); // same look alone is not enough
  assert.equal(renderOrigin(null), 'origin-unknown');
  assert.ok(renderedVideoToPackage(vid(), { mediaJob: daily }).tags.includes('auto-daily'));
  assert.ok(renderedVideoToPackage(vid()).tags.includes('origin-unknown'));
  const m = new Map([['job1', daily]]);
  assert.ok(mapRenderedVideos([vid()], { mediaJobsByEditJobId: m }).packages[0].tags.includes('auto-daily'));
});

test('enrichment joins by artist name case/space-insensitive; facets', () => {
  assert.equal(findUeArtist(ue, '  acidman ').artistName, 'ACIDMAN');
  const p = renderedVideoToPackage(vid({ artist: ' acid man ', mixTitle: 'stargazers  vs sunbathers' }), { ueArtists: ue });
  assert.deepEqual(p.facets.people, ['acid man']);
  assert.deepEqual(p.facets.genres, ['acid']);
  assert.equal(p.facets.eraYear, 2009);
  assert.equal(p.eraYear, 2009);
  assert.equal(p.facets.vibe.kind, 'video');
  assert.ok(p.searchTokens.includes('acid'));
});

test('poster ref only when known; schema-valid except source.kind pending SOURCE_KINDS', () => {
  assert.equal(renderedVideoToPackage(vid()).posterRef, undefined);
  assert.equal(renderedVideoToPackage(vid(), { knownPosters: ['job1'] }).posterRef, 'ev:posters/job1.jpg');
  const v = validatePackage(renderedVideoToPackage(vid()));
  assert.deepEqual(v.errors.filter((e) => !e.startsWith('bad source.kind')), []);
});

test('media-url: signed-url action shape', async () => {
  const pkg = { assetRefs: ['ev:videos/a.mp4'], posterRef: 'ev:posters/a.jpg' };
  const calls = [];
  const out = await resolveMediaUrls(pkg, async (p) => { calls.push(p); return `https://signed/${p}`; });
  assert.deepEqual(out, { ok: true, videoUrl: 'https://signed/videos/a.mp4', posterUrl: 'https://signed/posters/a.jpg', expiresInSeconds: 3600 });
  assert.deepEqual(calls, ['videos/a.mp4', 'posters/a.jpg']);
  const noPoster = await resolveMediaUrls({ assetRefs: ['ev:videos/a.mp4'] }, async (p) => `u/${p}`);
  assert.equal('posterUrl' in noPoster, false);
  await assert.rejects(resolveMediaUrls(null, async () => 'x'), { status: 404 });
  await assert.rejects(resolveMediaUrls({ assetRefs: ['NAS/x.mp4'] }, async () => 'x'), { status: 422 });
  await assert.rejects(resolveMediaUrls(pkg, async () => null), { status: 502 });
  assert.equal(evObjectPath('ev:../secrets'), null);
});
