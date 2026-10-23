// Pure helpers for the per-bucket Upload control (BucketUpload.jsx).
export const MAX_UPLOAD_BATCH = 25;

// Where a bucket's uploads land: its saved folder, else a new `track-<id>` folder.
export function uploadTargetFor(bucket) {
  const existing = String(bucket?.uploadFolder || '').trim();
  if (existing) return { folderMode: 'existing', folderName: existing };
  return { folderMode: 'new', folderName: `track-${bucket?.id || ''}` };
}

export function isUploadable(file) {
  const t = String(file?.type || '');
  return t.startsWith('video/') || t.startsWith('image/');
}

// Filters a picked list to video/image and caps the batch; reports what was dropped.
export function acceptPicked(fileList, alreadyQueued = 0) {
  const list = Array.from(fileList || []);
  const media = list.filter(isUploadable);
  const room = Math.max(0, MAX_UPLOAD_BATCH - alreadyQueued);
  return { accepted: media.slice(0, room), skippedType: list.length - media.length, skippedCap: Math.max(0, media.length - room) };
}

// Body rows for quote-targets `ingest-uploads` from the completed upload rows.
export function toIngestFiles(rows) {
  return (rows || []).map((r) => ({
    fullPath: r.fullPath, name: r.name, size: r.size, contentType: r.contentType,
    kind: r.kind === 'video' ? 'video' : 'image',
    ...(r.posterPath ? { posterPath: r.posterPath } : {}),
  }));
}

export function summarizeIngest(result, bucketName) {
  const added = Array.isArray(result?.created) ? result.created.length : 0;
  const there = Array.isArray(result?.existing) ? result.existing.length : 0;
  const parts = [`${added} added to ${bucketName}`];
  if (there) parts.push(`${there} already there`);
  return parts.join(' · ');
}
