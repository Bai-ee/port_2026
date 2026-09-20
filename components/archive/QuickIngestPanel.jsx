'use client';

// Lane 2 intake (master plan D2/D3): one photo or video, uploaded straight
// from a phone on /archive, staged transiently in Firebase Storage until the
// NAS worker (a separate agent, W3) claims it, hashes it, and — once
// Arweave succeeds — deletes the object. See docs/archive/INTAKE_CONTRACT.md.
//
// Mounted with a single line in app/archive/page.jsx directly under the
// "Process a Collection" card. Reuses the page's own authedFetch (no second
// auth path) and the same XHR-PUT mechanic Media Library uses.

import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadFileToSignedUrl } from '../../lib/dashboard/upload-signed-url';
import { fsTimestampToDate } from '../../lib/dashboard/format-utils';

function formatBytes(bytes) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  if (size >= 1024 * 1024 * 1024) return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

function relativeTime(raw) {
  const d = fsTimestampToDate(raw);
  if (!d) return '';
  const seconds = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export default function QuickIngestPanel({ authedFetch }) {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState([]);
  const inputRef = useRef(null);

  const loadRecent = useCallback(async () => {
    try {
      const response = await authedFetch('/api/archive/intake?limit=20');
      if (!response.ok) return;
      const body = await response.json();
      setRecent(body.items || []);
    } catch {
      // Recent-list refresh is best-effort; the upload flow itself already
      // reports its own errors in `status`.
    }
  }, [authedFetch]);

  useEffect(() => { loadRecent(); }, [loadRecent]);

  const handleFile = useCallback(async (file) => {
    if (!file || busy) return;
    setBusy(true);
    setProgress(0);
    setStatus('REQUESTING UPLOAD URL');
    try {
      const mintResponse = await authedFetch('/api/archive/intake', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, contentType: file.type || 'application/octet-stream', sizeBytes: file.size }),
      });
      const mint = await mintResponse.json();
      if (!mintResponse.ok) { setStatus(mint.error || 'UPLOAD URL FAILED'); return; }

      setStatus('UPLOADING');
      await uploadFileToSignedUrl({
        file,
        upload: { uploadUrl: mint.uploadUrl, method: mint.method, contentType: mint.contentType },
        onProgress: (pct) => setProgress(pct),
      });

      setStatus('CONFIRMING');
      const confirmResponse = await authedFetch('/api/archive/intake', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intakeId: mint.intakeId, state: 'UPLOADED', sizeBytes: file.size }),
      });
      const confirmed = await confirmResponse.json();
      if (!confirmResponse.ok) { setStatus(confirmed.error || 'CONFIRM FAILED'); return; }

      setProgress(100);
      setStatus('UPLOADED · queued for the worker');
      await loadRecent();
    } catch (err) {
      setStatus(err?.message || 'UPLOAD FAILED');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }, [authedFetch, busy, loadRecent]);

  return (
    <section
      id="archive-quick-ingest-panel"
      style={{ marginTop: 16, border: '1px solid #262626', borderRadius: 20, padding: 24, background: '#101010' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 12, opacity: .45 }}>QUICK INGEST</div>
          <h3 style={{ fontSize: 24, margin: '8px 0' }}>Upload from phone</h3>
        </div>
      </div>
      <p style={{ maxWidth: 720, opacity: .6, lineHeight: 1.5, fontSize: 13 }}>
        One photo or video at a time. It stages in Firebase Storage until the worker hashes,
        reviews, and archives it to Arweave — then it is deleted from Firebase. Nothing here
        touches the NAS.
      </p>
      <div
        id="archive-quick-ingest-dropzone"
        style={{ border: '1px dashed #333', borderRadius: 14, padding: 20, marginTop: 14, textAlign: 'center' }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          disabled={busy}
          onChange={(e) => handleFile(e.target.files?.[0] || null)}
          style={{ display: 'block', margin: '0 auto', color: '#ddd', maxWidth: '100%' }}
        />
      </div>
      <div id="archive-quick-ingest-progress-row" style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <div style={{ flex: '1 1 auto', minWidth: 0, height: 6, borderRadius: 999, background: '#222', overflow: 'hidden' }}>
          <div style={{ width: `${progress}%`, height: '100%', background: '#f4f4f0', transition: 'width .2s ease' }} />
        </div>
        <span style={{ fontSize: 11, opacity: .6, minWidth: 0, maxWidth: '55%', textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {status || 'Select a file to upload.'}
        </span>
      </div>
      <div id="archive-quick-ingest-recent-list" style={{ marginTop: 16, borderTop: '1px solid #252525' }}>
        {recent.length === 0 ? (
          <div style={{ opacity: .5, padding: '14px 0', fontSize: 12 }}>No uploads yet.</div>
        ) : recent.map((item) => (
          <div
            key={item.id}
            style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid #1e1e1e', fontSize: 12, flexWrap: 'wrap' }}
          >
            <span style={{ minWidth: 0, maxWidth: '100%', flex: '1 1 160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.fileName || item.id}
            </span>
            <span style={{ opacity: .6, whiteSpace: 'nowrap' }}>{formatBytes(item.sizeBytes)}</span>
            <span style={{ opacity: .6, whiteSpace: 'nowrap' }}>{item.state}</span>
            <span style={{ opacity: .4, whiteSpace: 'nowrap' }}>{relativeTime(item.createdAt)}</span>
          </div>
        ))}
      </div>
      <style jsx>{`
        @media (max-width: 480px) {
          #archive-quick-ingest-panel { padding: 16px var(--mobile-gutter, 8px); }
          #archive-quick-ingest-recent-list > div { flex-wrap: wrap; }
        }
      `}</style>
    </section>
  );
}
