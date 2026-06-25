'use strict';

// archive-publishing-projection.cjs — pure projection of archive/deploy results
// into the dashboard_state.archivePublishing shape the Knowledge Officer
// archive-publishing card reads. No firebase here; the route does the write.
// See docs/plans/ARCHIVE_PUBLISHING_CARD_PLAN.md (Proposed Data Model).

const MAX_ASSETS = 60;

/** Map a source-row `source` to the archivedAsset `source` enum. */
function assetSourceFor(rowSource) {
  switch (rowSource) {
    case 'mediaCaptures': return 'video-remix';
    case 'studioCaptures': return 'studio-render';
    case 'editvideosFolder': return 'source-media';
    default: return 'source-media';
  }
}

/**
 * Build a normalized archivedAsset from a selected source row + the EditVideos
 * archive result. Pure.
 */
function buildArchivedAsset(row = {}, result = {}) {
  return {
    label: row.label || result.fileName || 'Archived file',
    source: assetSourceFor(row.source),
    sourceJobId: row.sourceCaptureJobId || null,
    sourcePath: row.storagePath || row.fullPath || (row.folder && row.fileName ? `${row.folder}/${row.fileName}` : null),
    transactionId: result.transactionId || null,
    arweaveUrl: result.arweaveUrl || (result.transactionId ? `https://arweave.net/${result.transactionId}` : null),
    turboUrl: result.turboUrl || null,
    fileSize: Number(result.fileSize ?? row.sizeBytes) || null,
    contentType: result.contentType || row.contentType || null,
    status: result.transactionId ? 'pending_confirmation' : 'failed',
    archivedAt: result.archivedAt || new Date().toISOString(),
  };
}

/**
 * Merge new archived assets into the existing archivePublishing state, dedup on
 * transactionId (fallback sourcePath), cap to the last MAX_ASSETS. Pure: returns
 * a new archivePublishing object, never mutates the input.
 */
function mergeArchivedAssets(current = {}, newAssets = []) {
  const existing = Array.isArray(current?.archivedAssets) ? current.archivedAssets : [];
  const keyOf = (a) => a?.transactionId || a?.sourcePath || a?.label;
  const incomingKeys = new Set(newAssets.map(keyOf));
  const kept = existing.filter((a) => !incomingKeys.has(keyOf(a)));
  const merged = [...kept, ...newAssets].slice(-MAX_ASSETS);
  return { ...current, archivedAssets: merged };
}

/** Build the latestArchiveJob summary block. Pure. */
function buildLatestArchiveJob({ jobId, status, fileCount, error = null, queuedAt = null, completedAt = null } = {}) {
  return {
    jobId: jobId || null,
    status: status || 'queued',
    queuedAt: queuedAt || new Date().toISOString(),
    completedAt: completedAt || null,
    fileCount: Number(fileCount) || 0,
    error: error || null,
  };
}

module.exports = {
  assetSourceFor,
  buildArchivedAsset,
  mergeArchivedAssets,
  buildLatestArchiveJob,
  MAX_ASSETS,
};
