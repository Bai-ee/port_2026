'use client';

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Upload } from 'lucide-react';
import { uploadManager } from '../../../lib/dashboard/upload-manager';
import { readImpersonateClientId } from '../../../lib/dashboard/bootstrap-session.js';
import { uploadTargetFor, acceptPicked, summarizeIngest, MAX_UPLOAD_BATCH } from './bucket-upload-model.js';

// BucketUpload — upload videos/images straight into one bucket (content track).
// Picking files hands them to the background upload manager (lib/dashboard/upload-manager.js):
// resumable chunks + poster, complete-upload, then quote-targets `ingest-uploads`.
// Uploads keep running when this modal closes and resume after a refresh; this
// component just renders that bucket's jobs from the store. Admin-only like the panel's other writes.

const ROW = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, minWidth: 0 };
const NAME = { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const MUTED = { color: 'var(--t-text-muted, var(--t-text))', opacity: 0.7, fontSize: 11, overflowWrap: 'anywhere' };

export default function BucketUpload({ bucket, onDone, disabled }) {
  const [queue, setQueue] = useState([]); // picked, not yet handed to the manager
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const id = bucket.id;

  const allJobs = useSyncExternalStore(uploadManager.subscribe, uploadManager.getSnapshot, uploadManager.getSnapshot);
  const jobs = allJobs.filter((j) => j.bucketId === id);

  useEffect(() => uploadManager.onJobDone((job) => { if (job.bucketId === id) onDoneRef.current?.(job.result); }), [id]);

  const addFiles = (fileList) => {
    const { accepted, skippedType, skippedCap } = acceptPicked(fileList, queue.length);
    const notes = [];
    if (skippedType) notes.push(`${skippedType} skipped (not video/image)`);
    if (skippedCap) notes.push(`${skippedCap} over the ${MAX_UPLOAD_BATCH}-file batch cap`);
    setError(notes.join(' · '));
    setQueue((q) => [...q, ...accepted.map((file, i) => ({ id: `${Date.now()}-${i}-${file.name}`, file, name: file.name, size: file.size }))]);
  };

  const run = () => {
    if (!queue.length) return;
    uploadManager.enqueue({ clientId: readImpersonateClientId(), bucketId: id, bucketName: bucket.name, ...uploadTargetFor(bucket), files: queue.map((x) => x.file) });
    setQueue([]); setError('');
  };

  const pendingCount = queue.length;
  const jobFiles = jobs.filter((j) => j.stage !== 'done').flatMap((j) => j.files.map((f) => ({ ...f, jobId: j.id })));
  const doneJobs = jobs.filter((j) => j.stage === 'done');
  const failedJobs = jobs.filter((j) => j.stage === 'error');

  return (
    <div id={`content-bucket-${id}-upload-shell`} data-section="bucket-upload"
      style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', margin: '0 0 10px', border: '1px solid color-mix(in srgb, var(--t-text) 14%, transparent)', borderRadius: 10, background: 'var(--t-surface)', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box' }}>
      <div id={`content-bucket-${id}-upload-header`} style={{ ...ROW, flexWrap: 'wrap' }}>
        <button type="button" className="xce-btn-ghost" disabled={disabled} onClick={() => inputRef.current?.click()}>
          <Upload size={13} /> Upload to {bucket.name}
        </button>
        <input id={`content-bucket-${id}-upload-input`} ref={inputRef} type="file" multiple accept="video/*,image/*" hidden
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        {pendingCount ? (
          <button type="button" className="xce-btn-primary" disabled={disabled} onClick={run}>
            {`Upload ${pendingCount} file${pendingCount === 1 ? '' : 's'}`}
          </button>
        ) : null}
        {bucket.uploadFolder ? <span id={`content-bucket-${id}-upload-folder`} style={MUTED}>Folder: {bucket.uploadFolder}</span> : null}
      </div>
      {queue.length || jobFiles.length ? (
        <ul id={`content-bucket-${id}-upload-queue`} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {queue.map((x) => (
            <li key={x.id} style={ROW}>
              <span style={NAME} title={x.name}>{x.name}</span>
              <span style={{ ...MUTED, flex: '0 0 auto' }}>queued</span>
              <button type="button" className="xce-bk-icon" aria-label={`Remove ${x.name}`} onClick={() => setQueue((q) => q.filter((y) => y.id !== x.id))}>×</button>
            </li>
          ))}
          {jobFiles.map((f) => (
            <li key={`${f.jobId}-${f.key}`} style={ROW}>
              <span style={NAME} title={f.error || f.name}>{f.name}</span>
              <span style={{ ...MUTED, flex: '0 0 auto' }}>{f.status === 'uploading' ? `${f.progress}%` : f.status}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {doneJobs.map((j) => (
        <p key={j.id} id={`content-bucket-${id}-upload-status`} style={{ ...ROW, margin: 0 }} role="status">
          <span style={NAME}>{j.summary || summarizeIngest(j.result, bucket.name)}</span>
          <button type="button" className="xce-bk-icon" aria-label="Dismiss" onClick={() => uploadManager.dismiss(j.id)}>×</button>
        </p>
      ))}
      {failedJobs.map((j) => (
        <p key={j.id} className="xce-error" style={{ ...ROW, margin: 0 }}>
          <span style={NAME}>{j.error || 'Upload failed.'}</span>
          <button type="button" className="xce-btn-ghost" onClick={() => uploadManager.retry(j.id)}>Retry</button>
          <button type="button" className="xce-bk-icon" aria-label="Dismiss" onClick={() => uploadManager.dismiss(j.id)}>×</button>
        </p>
      ))}
      {error ? <p id={`content-bucket-${id}-upload-error`} className="xce-error" style={{ margin: 0 }}>{error}</p> : null}
    </div>
  );
}
