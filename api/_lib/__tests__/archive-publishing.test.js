'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  costForBytes,
  summarizeArchiveCost,
  normalizeArchiveManifest,
  normalizeArchiveSources,
  mapDeployResult,
  mapDeployEstimate,
} = require('../editvideos-bridge.cjs');
const {
  assetSourceFor,
  buildArchivedAsset,
  mergeArchivedAssets,
  buildLatestArchiveJob,
} = require('../archive-publishing-projection.cjs');

// --- cost --------------------------------------------------------------------
test('costForBytes mirrors EditVideos rates (0.0001 AR/MB, $0.10/MB approx)', () => {
  const oneMb = costForBytes(1024 * 1024, 10);
  assert.equal(oneMb.sizeMB, 1);
  assert.equal(oneMb.costAR, 0.0001);
  assert.equal(oneMb.costUSD, 0.001); // 0.0001 AR * $10
  assert.equal(oneMb.costUSDApprox, 0.1);
  assert.equal(oneMb.arPriceUSD, 10);
});

test('costForBytes clamps bad input and falls back AR price to 10', () => {
  const z = costForBytes(-5, 0);
  assert.equal(z.sizeBytes, 0);
  assert.equal(z.arPriceUSD, 10);
});

test('summarizeArchiveCost sums sizeBytes|size|fileSize across files', () => {
  const sum = summarizeArchiveCost(
    [{ sizeBytes: 1024 * 1024 }, { size: 1024 * 1024 }, { fileSize: 2 * 1024 * 1024 }],
    10
  );
  assert.equal(sum.fileCount, 3);
  assert.equal(sum.sizeBytes, 4 * 1024 * 1024);
  assert.equal(sum.estimatedAt, null);
});

// --- manifest normalization --------------------------------------------------
test('normalizeArchiveManifest flattens folders into sorted entries + derives arweaveUrl', () => {
  const out = normalizeArchiveManifest({
    version: '1.0.0',
    lastUpdated: '2026-06-20T00:00:00Z',
    folders: {
      skyline: {
        files: [
          { name: 'a.mp4', transactionId: 'TX1', archivedAt: '2026-06-10T00:00:00Z', fileSize: 100 },
          { name: 'b.mp4', arweaveUrl: 'https://arweave.net/TX2', transactionId: 'TX2', archivedAt: '2026-06-15T00:00:00Z' },
        ],
      },
    },
  });
  assert.equal(out.source, 'editvideos');
  assert.equal(out.entries.length, 2);
  // newest archivedAt first
  assert.equal(out.entries[0].transactionId, 'TX2');
  // derived url from txid
  assert.equal(out.entries[1].arweaveUrl, 'https://arweave.net/TX1');
  assert.equal(out.entries[1].status, 'confirmed');
});

test('normalizeArchiveManifest handles empty/missing folders', () => {
  const out = normalizeArchiveManifest({});
  assert.deepEqual(out.entries, []);
  assert.deepEqual(out.folders, {});
  assert.equal(out.version, '1.0.0');
});

// --- source normalization ----------------------------------------------------
test('normalizeArchiveSources types remix, studio, and folder rows', () => {
  const rows = normalizeArchiveSources({
    mediaCaptures: [{ type: 'video_remix', label: 'Remix', jobId: 'J1', downloadUrl: 'u', fileSize: 10 }],
    studioCaptures: [{ label: 'Studio', jobId: 'S1', kind: 'image' }],
    folderFiles: { folder: 'skyline', files: [{ name: 'c.mov', fullPath: 'skyline/c.mov', size: 5 }] },
  });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].source, 'mediaCaptures');
  assert.equal(rows[1].source, 'studioCaptures');
  assert.equal(rows[1].contentType, 'image/png');
  assert.equal(rows[2].source, 'editvideosFolder');
  assert.equal(rows[2].storagePath, 'skyline/c.mov');
});

test('normalizeArchiveSources skips non-remix media captures', () => {
  const rows = normalizeArchiveSources({ mediaCaptures: [{ type: 'other' }] });
  assert.deepEqual(rows, []);
});

// --- deploy mapping ----------------------------------------------------------
test('mapDeployResult maps success + failure shapes', () => {
  const ok = mapDeployResult({ success: true, manifestId: 'M1', websiteUrl: 'w', arnsUrl: 'a', filesUploaded: 3, totalFiles: 5 });
  assert.equal(ok.status, 'done');
  assert.equal(ok.manifestId, 'M1');
  assert.equal(ok.arweaveUrl, 'w');
  assert.equal(ok.totalFiles, 5);
  assert.equal(ok.error, null);

  const bad = mapDeployResult({ success: false, error: 'boom' });
  assert.equal(bad.status, 'failed');
  assert.equal(bad.error, 'boom');
});

test('mapDeployEstimate normalizes cost block', () => {
  const est = mapDeployEstimate({ filesChanged: 2, filesUnchanged: 8, totalFiles: 10, cost: { sizeBytes: 2048, costAR: 0.5, costUSD: 5, arPriceUSD: 10 } });
  assert.equal(est.mode, 'website-deploy');
  assert.equal(est.filesChanged, 2);
  assert.equal(est.sizeBytes, 2048);
  assert.equal(est.costUSD, 5);
});

// --- projection --------------------------------------------------------------
test('assetSourceFor maps row source enums', () => {
  assert.equal(assetSourceFor('mediaCaptures'), 'video-remix');
  assert.equal(assetSourceFor('studioCaptures'), 'studio-render');
  assert.equal(assetSourceFor('editvideosFolder'), 'source-media');
  assert.equal(assetSourceFor('weird'), 'source-media');
});

test('buildArchivedAsset normalizes a row + result into an archivedAsset', () => {
  const asset = buildArchivedAsset(
    { source: 'mediaCaptures', label: 'Remix', sourceCaptureJobId: 'J1', folder: 'skyline', fileName: 'a.mp4', sizeBytes: 100 },
    { transactionId: 'TX1', arweaveUrl: 'https://arweave.net/TX1', turboUrl: 't', fileSize: 100, contentType: 'video/mp4' }
  );
  assert.equal(asset.source, 'video-remix');
  assert.equal(asset.transactionId, 'TX1');
  assert.equal(asset.status, 'pending_confirmation');
  assert.equal(asset.sourcePath, 'skyline/a.mp4');
});

test('buildArchivedAsset marks failed when no transactionId', () => {
  const asset = buildArchivedAsset({ source: 'editvideosFolder', label: 'x' }, {});
  assert.equal(asset.status, 'failed');
  assert.equal(asset.transactionId, null);
});

test('mergeArchivedAssets dedupes on transactionId and does not mutate input', () => {
  const cur = { archivedAssets: [{ transactionId: 'TX1', label: 'old' }] };
  const next = mergeArchivedAssets(cur, [{ transactionId: 'TX1', label: 'new' }, { transactionId: 'TX2', label: 'second' }]);
  assert.equal(next.archivedAssets.length, 2);
  assert.equal(next.archivedAssets.find((a) => a.transactionId === 'TX1').label, 'new');
  // input untouched
  assert.equal(cur.archivedAssets.length, 1);
  assert.equal(cur.archivedAssets[0].label, 'old');
});

test('buildLatestArchiveJob defaults', () => {
  const j = buildLatestArchiveJob({ jobId: 'media_1', status: 'done', fileCount: 2 });
  assert.equal(j.jobId, 'media_1');
  assert.equal(j.status, 'done');
  assert.equal(j.fileCount, 2);
  assert.equal(j.error, null);
});
