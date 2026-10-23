'use client';

import React, { useCallback, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { uploadFileToSignedUrl } from '../../../lib/dashboard/upload-signed-url';
import { captureVideoPoster } from '../../../lib/dashboard/capture-video-poster';
import { uploadTargetFor, acceptPicked, toIngestFiles, summarizeIngest, MAX_UPLOAD_BATCH } from './bucket-upload-model.js';

// BucketUpload — upload videos/images straight into one bucket (content track).
// Reuses the Media Library upload flow: create-upload-session → signed PUT
// (+ poster JPEG for video) → media complete-upload, then quote-targets
// `ingest-uploads` registers the files as items in this bucket.
// `mediaCall(action, body)` = authenticated POST to /api/dashboard/media (?as= aware);
// `call` = the quote-targets helper. Admin-only like the panel's other writes.

const ROW = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, minWidth: 0 };
const NAME = { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const MUTED = { color: 'var(--t-text-muted, var(--t-text))', opacity: 0.7, fontSize: 11, overflowWrap: 'anywhere' };

export default function BucketUpload({ bucket, call, mediaCall, onDone, disabled }) {
  const [queue, setQueue] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const inputRef = useRef(null);
  const id = bucket.id;

  const patch = (qid, p) => setQueue((q) => q.map((x) => (x.id === qid ? { ...x, ...p } : x)));

  const addFiles = (fileList) => {
    const { accepted, skippedType, skippedCap } = acceptPicked(fileList, queue.length);
    setStatus('');
    const notes = [];
    if (skippedType) notes.push(`${skippedType} skipped (not video/image)`);
    if (skippedCap) notes.push(`${skippedCap} over the ${MAX_UPLOAD_BATCH}-file batch cap`);
    setError(notes.join(' · '));
    setQueue((q) => [...q, ...accepted.map((file, i) => ({ id: `${Date.now()}-${i}-${file.name}`, file, name: file.name, size: file.size, type: file.type, status: 'queued', progress: 0 }))]);
  };

  const run = useCallback(async () => {
    const pending = queue.filter((x) => x.status === 'queued' || x.status === 'error');
    if (busy || !pending.length) return;
    setBusy(true); setError(''); setStatus('');
    try {
      const target = uploadTargetFor(bucket);
      const data = await mediaCall('create-upload-session', {
        ...target, orientation: 'auto',
        files: pending.map((x) => ({ name: x.name, type: x.type, size: x.size, withPoster: String(x.type || '').startsWith('video/') })),
      });
      const uploads = Array.isArray(data?.session?.uploads) ? data.session.uploads : [];
      if (uploads.length !== pending.length) throw new Error('Upload session did not return a URL for every file.');
      const folder = data.session.folder; // the folder the session actually resolved

      const rows = [];
      for (let i = 0; i < uploads.length; i += 1) {
        const item = pending[i];
        const upload = uploads[i];
        patch(item.id, { status: 'uploading', progress: 0, error: '' });
        try {
          const posterBlob = upload.posterUpload ? await captureVideoPoster(item.file).catch(() => null) : null;
          await uploadFileToSignedUrl({ file: item.file, upload, onProgress: (progress) => patch(item.id, { progress }) });
          let posterPath = null;
          if (posterBlob && upload.posterUpload) {
            try { await uploadFileToSignedUrl({ file: posterBlob, upload: upload.posterUpload, onProgress: () => {} }); posterPath = upload.posterUpload.storagePath; } catch { posterPath = null; }
          }
          patch(item.id, { status: 'done', progress: 100 });
          rows.push({ fullPath: upload.storagePath, name: upload.safeName, size: upload.size, contentType: upload.contentType, kind: upload.kind, posterPath });
        } catch (err) {
          patch(item.id, { status: 'error', error: err.message });
        }
      }
      if (!rows.length) throw new Error('No files uploaded.');
      await mediaCall('complete-upload', { folder, files: rows });
      const result = await call('ingest-uploads', { bucketId: id, folder, files: toIngestFiles(rows) });
      setStatus(summarizeIngest(result, bucket.name));
      setQueue((q) => q.filter((x) => x.status !== 'done'));
      await onDone?.(result);
    } catch (err) {
      setError(err.message || 'Upload failed.');
      setQueue((q) => q.map((x) => (x.status === 'uploading' ? { ...x, status: 'error', error: err.message } : x)));
    } finally {
      setBusy(false);
    }
  }, [queue, busy, bucket, mediaCall, call, id, onDone]);

  const pendingCount = queue.filter((x) => x.status === 'queued' || x.status === 'error').length;

  return (
    <div id={`content-bucket-${id}-upload-shell`} data-section="bucket-upload"
      style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', margin: '0 0 10px', border: '1px solid color-mix(in srgb, var(--t-text) 14%, transparent)', borderRadius: 10, background: 'var(--t-surface)', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box' }}>
      <div id={`content-bucket-${id}-upload-header`} style={{ ...ROW, flexWrap: 'wrap' }}>
        <button type="button" className="xce-btn-ghost" disabled={disabled || busy} onClick={() => inputRef.current?.click()}>
          <Upload size={13} /> Upload to {bucket.name}
        </button>
        <input id={`content-bucket-${id}-upload-input`} ref={inputRef} type="file" multiple accept="video/*,image/*" hidden
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        {pendingCount ? (
          <button type="button" className="xce-btn-primary" disabled={disabled || busy} onClick={run}>
            {busy ? 'Uploading…' : `Upload ${pendingCount} file${pendingCount === 1 ? '' : 's'}`}
          </button>
        ) : null}
        {bucket.uploadFolder ? <span id={`content-bucket-${id}-upload-folder`} style={MUTED}>Folder: {bucket.uploadFolder}</span> : null}
      </div>
      {queue.length ? (
        <ul id={`content-bucket-${id}-upload-queue`} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {queue.map((x) => (
            <li key={x.id} style={ROW}>
              <span style={NAME} title={x.name}>{x.name}</span>
              <span style={{ ...MUTED, flex: '0 0 auto' }}>{x.status === 'uploading' ? `${x.progress}%` : x.status}</span>
              {!busy && x.status !== 'done' ? <button type="button" className="xce-bk-icon" aria-label={`Remove ${x.name}`} onClick={() => setQueue((q) => q.filter((y) => y.id !== x.id))}>×</button> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {status ? <p id={`content-bucket-${id}-upload-status`} style={{ margin: 0, fontSize: 12 }} role="status">{status}</p> : null}
      {error ? <p id={`content-bucket-${id}-upload-error`} className="xce-error" style={{ margin: 0 }}>{error}</p> : null}
    </div>
  );
}
