'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { mapRecipeToVideoJob } = require('../editvideos-bridge.cjs');

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

test('mapRecipeToVideoJob rejects empty selectedFolders', () => {
  assert.throws(() => mapRecipeToVideoJob({ ...BASE, sourceFolders: [] }, { jobId: 'X' }), /non-empty/);
  assert.throws(() => mapRecipeToVideoJob({ ...BASE, sourceFolders: undefined }, { jobId: 'X' }), /non-empty/);
});
