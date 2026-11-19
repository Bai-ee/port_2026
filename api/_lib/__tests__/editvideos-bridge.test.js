'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { mapRecipeToVideoJob, normalizeSourceFileRef } = require('../editvideos-bridge.cjs');

const BASE = {
  type: 'video-remix',
  sourceFolders: ['skyline', 'neighborhood'],
  output: { width: 720, height: 720, fps: 30, format: 'mp4', durationSeconds: 30 },
};

test('mapRecipeToVideoJob produces the EditVideos videoJobs schema with locked defaults', () => {
  const job = mapRecipeToVideoJob(BASE, { jobId: 'JOB-1' });
  assert.equal(job.jobId, 'JOB-1');
  assert.equal(job.status, 'pending');
  assert.equal(job.artist, null, 'artist:null → worker uses random Arweave audio');
  assert.equal(job.useArtistImage, false, 'no Underground-Existence thumbnails');
  assert.equal(job.useTrax, false);
  assert.equal(job.duration, 30);
  assert.deepEqual(job.selectedFolders, ['skyline', 'neighborhood']);
  // Untouched-by-Hitloop fields are present and null.
  assert.equal(job.topLogo, null);
  assert.equal(job.endLogo, null);
  assert.equal(job.customEndMedia, null);
  assert.equal(job.endTextOverlay, null);
  assert.equal(job.videoOrder, null);
  assert.equal(job.completedAt, null);
  assert.equal(job.videoUrl, null);
  assert.equal(job.error, null);
  assert.equal(job.metadata.fileName, null);
  assert.equal(job.metadata.fileSize, null);
  assert.equal(typeof job.metadata.mixTitle, 'string');
  // createdAt is left for the writer (serverTimestamp), not the pure mapper.
  assert.equal('createdAt' in job, false);
});

test('mapRecipeToVideoJob defaults filterIntensity to 0.8 and videoFilter to null', () => {
  const job = mapRecipeToVideoJob(BASE, { jobId: 'JOB-2' });
  assert.equal(job.filterIntensity, 0.8);
  assert.equal(job.videoFilter, null);
  assert.equal(job.enableOverlay, false);
  assert.equal(job.overlayEffect, null);
});

test('mapRecipeToVideoJob maps filter key + intensity', () => {
  const job = mapRecipeToVideoJob(
    { ...BASE, filter: { key: 'look_hard_bw', intensity: 0.5 } },
    { jobId: 'JOB-3' }
  );
  assert.equal(job.videoFilter, 'look_hard_bw');
  assert.equal(job.filterIntensity, 0.5);
});

test('mapRecipeToVideoJob maps enabled overlay; ignores effect when disabled', () => {
  const on = mapRecipeToVideoJob(
    { ...BASE, overlay: { enabled: true, effect: 'retro_dust' } },
    { jobId: 'JOB-4' }
  );
  assert.equal(on.enableOverlay, true);
  assert.equal(on.overlayEffect, 'retro_dust');

  const off = mapRecipeToVideoJob(
    { ...BASE, overlay: { enabled: false, effect: 'retro_dust' } },
    { jobId: 'JOB-5' }
  );
  assert.equal(off.enableOverlay, false);
  assert.equal(off.overlayEffect, null);
});

test('mapRecipeToVideoJob passes selectedFolders through verbatim', () => {
  const job = mapRecipeToVideoJob(
    { ...BASE, sourceFolders: ['a', 'b', 'c'] },
    { jobId: 'JOB-6' }
  );
  assert.deepEqual(job.selectedFolders, ['a', 'b', 'c']);
});

test('mapRecipeToVideoJob maps manual six-segment video order', () => {
  const videoOrder = Array.from({ length: 6 }, (_, index) => ({
    segmentIndex: index,
    videoName: `clip-${index + 1}.mp4`,
  }));
  const job = mapRecipeToVideoJob(
    { ...BASE, sourceFolders: ['skyline'], videoOrder },
    { jobId: 'JOB-7' }
  );
  assert.deepEqual(job.videoOrder, videoOrder);
});

test('mapRecipeToVideoJob maps artist, mix, track toggle, logos, artist image, and end text', () => {
  const job = mapRecipeToVideoJob(
    {
      ...BASE,
      artist: 'Baiee',
      mixTitle: 'Night Set',
      useTrax: true,
      logos: { top: 'top-logo.png', end: 'end-logo.jpg' },
      useArtistImage: true,
      endCard: { text: 'BOOK NOW' },
    },
    { jobId: 'JOB-8' }
  );
  assert.equal(job.artist, 'Baiee');
  assert.equal(job.mixTitle, 'Night Set');
  assert.equal(job.metadata.mixTitle, 'Night Set');
  assert.equal(job.useTrax, true);
  assert.equal(job.topLogo, 'top-logo.png');
  assert.equal(job.endLogo, 'end-logo.jpg');
  assert.equal(job.useArtistImage, true);
  assert.equal(job.endTextOverlay, 'BOOK NOW');
});

test('mapRecipeToVideoJob rejects empty selectedFolders', () => {
  assert.throws(() => mapRecipeToVideoJob({ ...BASE, sourceFolders: [] }, { jobId: 'X' }), /non-empty/);
  assert.throws(() => mapRecipeToVideoJob({ ...BASE, sourceFolders: undefined }, { jobId: 'X' }), /non-empty/);
});

test('normalizeSourceFileRef accepts flat and one-level nested source paths', () => {
  assert.deepEqual(
    normalizeSourceFileRef({ fullPath: 'skyline/clip 1.mp4' }),
    { folder: 'skyline', fileName: 'clip 1.mp4', fullPath: 'skyline/clip 1.mp4' }
  );
  assert.deepEqual(
    normalizeSourceFileRef({ storagePath: 'assets/retro_dust/dust.mov' }),
    { folder: 'assets/retro_dust', fileName: 'dust.mov', fullPath: 'assets/retro_dust/dust.mov' }
  );
  assert.deepEqual(
    normalizeSourceFileRef({ folder: 'neighborhood', fileName: 'still.webp' }),
    { folder: 'neighborhood', fileName: 'still.webp', fullPath: 'neighborhood/still.webp' }
  );
});

test('normalizeSourceFileRef rejects traversal, deep paths, reserved folders, and non-media files', () => {
  assert.throws(() => normalizeSourceFileRef({ fullPath: '../clip.mp4' }), /invalid path/);
  assert.throws(() => normalizeSourceFileRef({ fullPath: 'a/b/c/d.mp4' }), /folder and file/);
  assert.throws(() => normalizeSourceFileRef({ fullPath: 'logos/logo.png' }), /not available/);
  assert.throws(() => normalizeSourceFileRef({ folder: 'skyline', fileName: 'notes.txt' }), /Only media/);
});

// ── listFolderClipsForSelection (selector-only lister) ──────────────────────

const {
  listFolderClipsForSelection,
  invalidateFolderCache,
} = require('../editvideos-bridge.cjs');

/** Minimal bucket: getFiles({prefix}) over a fixed list of {name, metadata}. */
function fakeClipBucket(files) {
  const bucket = {
    calls: 0,
    async getFiles({ prefix }) {
      bucket.calls += 1;
      return [files.filter((f) => f.name.startsWith(prefix))];
    },
  };
  return bucket;
}

test('listFolderClipsForSelection: returns all 300 clips (no 120 cap) with selector fields only', async () => {
  invalidateFolderCache();
  const files = Array.from({ length: 300 }, (_, i) => ({
    name: `skyline/clip${String(i).padStart(3, '0')}.mp4`,
    metadata: { size: '1000', contentType: 'video/mp4', timeCreated: '2026-01-01T00:00:00Z' },
  }));
  const out = await listFolderClipsForSelection('skyline', { bucket: fakeClipBucket(files) });
  assert.equal(out.files.length, 300);
  assert.deepEqual(Object.keys(out.files[0]).sort(), ['fullPath', 'kind', 'name', 'size', 'timeCreated']);
  assert.equal(out.files[0].kind, 'video');
  assert.equal(out.files[0].size, 1000);
  assert.equal(out.files[0].timeCreated, '2026-01-01T00:00:00Z');
});

test('listFolderClipsForSelection: filters non-media, ignores subfolder objects, falls back to updated/null', async () => {
  invalidateFolderCache();
  const files = [
    { name: 'skyline/a.mov', metadata: { size: '5', updated: '2025-05-05T00:00:00Z' } },
    { name: 'skyline/sub/a.mov', metadata: { size: '9', timeCreated: '2026-02-02T00:00:00Z' } },
    { name: 'skyline/sub/z.mov', metadata: {} },
    { name: 'skyline/b.jpg', metadata: { size: '5', contentType: 'image/jpeg' } },
    { name: 'skyline/notes.txt', metadata: {} },
  ];
  const out = await listFolderClipsForSelection('skyline', { bucket: fakeClipBucket(files) });
  assert.deepEqual(out.files.map((f) => f.name), ['a.mov', 'b.jpg']);
  assert.equal(out.files[0].fullPath, 'skyline/a.mov');
  assert.equal(out.files[0].timeCreated, '2025-05-05T00:00:00Z');
  assert.equal(out.files[1].kind, 'image');
  assert.equal(out.files[1].timeCreated, null);
});

test('listFolderClipsForSelection: cached until invalidateFolderCache', async () => {
  invalidateFolderCache();
  const bucket = fakeClipBucket([{ name: 'skyline/a.mov', metadata: {} }]);
  await listFolderClipsForSelection('skyline', { bucket });
  await listFolderClipsForSelection('skyline', { bucket });
  assert.equal(bucket.calls, 1);
  invalidateFolderCache();
  await listFolderClipsForSelection('skyline', { bucket });
  assert.equal(bucket.calls, 2);
});

test('deployHeaders sends X-Deploy-Token only when EDITVIDEOS_DEPLOY_TOKEN is set', () => {
  const { deployHeaders } = require('../editvideos-bridge.cjs');
  assert.deepEqual(deployHeaders({}), { 'Content-Type': 'application/json' });
  assert.deepEqual(deployHeaders({ EDITVIDEOS_DEPLOY_TOKEN: 'abc' }),
    { 'Content-Type': 'application/json', 'X-Deploy-Token': 'abc' });
});
