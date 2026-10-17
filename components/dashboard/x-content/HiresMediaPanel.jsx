'use client';

import React, { useCallback, useEffect, useState } from 'react';
import MiniThumb from './MiniThumb.jsx';

// HiresMediaPanel — "Get high-res" for a calendar post whose picture is a NAS thumbnail (<=720px).
// Finds bigger copies of the same photo on the drive (quote-targets `find-hires-media`, free, read-only) and swaps one in
// (`hires-media-use`: queues the Mac worker copy when the file is not staged yet, else replaces the post media).
// Presentation + two route calls only; the matching and the media swap live server-side (features/x-content-inventory/hires-media.js).
// Theme tokens only. Rendered inside PostSheet (inside .xce-scope), so global xce-* button classes apply.

const EDITABLE = new Set(['draft', 'approved', 'awaiting_approval', 'scheduled']);
const ROW = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid color-mix(in srgb, var(--t-text) 10%, transparent)' };
const META = { margin: 0, fontSize: 12, lineHeight: 1.4, color: 'var(--t-text-muted)' };

const dimsOf = (c) => (c.width && c.height ? `${c.width}×${c.height}` : 'size unknown');
const stateOf = (c) => (c.staged ? 'On staging, ready' : /^(QUEUED|RUNNING|CLAIMED|IN_PROGRESS)$/i.test(c.stageState || '') ? 'Copying from the drive…' : c.stageState === 'FAILED' ? 'Last copy failed' : 'On the drive, not copied yet');

export default function HiresMediaPanel({ post, call, onRefresh }) {
  const eligible = typeof call === 'function' && String(post?.packageId || '').startsWith('nas-') && EDITABLE.has(post?.status);
  const [info, setInfo] = useState(null);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setInfo(await call('find-hires-media', { postId: post.id })); } catch { setInfo(null); }
  }, [call, post?.id]);

  useEffect(() => {
    setInfo(null); setOpen(false); setMessage(''); setError('');
    if (eligible) load();
  }, [eligible, load]);

  const use = async (candidate) => {
    setBusyId(candidate.id); setError(''); setMessage('');
    try {
      const r = await call('hires-media-use', { postId: post.id, packageId: info.target.id, candidateId: candidate.id });
      if (r?.status === 'done') {
        setMessage(`Swapped to the ${r.width && r.height ? `${r.width}×${r.height} ` : ''}original.`);
        if (r.downloadUrl) setInfo((i) => ({ ...i, download: r.downloadUrl }));
        if (onRefresh) onRefresh();
      } else {
        setMessage(r?.note || 'Queued: the Mac worker is copying the original.');
      }
      await load();
    } catch (err) { setError(err.message || 'Could not use that file.'); } finally { setBusyId(null); }
  };

  if (!eligible || !info?.ok || !info.target?.isThumbnail || !info.candidates?.length) return null;
  return (
    <div id="x-content-post-sheet-hires" className="xce-mc-field">
      <span className="xce-mc-kicker">Picture is a thumbnail ({dimsOf(info.target)})</span>
      <div id="x-content-post-sheet-hires-actions">
        <button type="button" id="x-content-post-sheet-hires-toggle" className="xce-btn-ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? 'Hide high-res options' : 'Get high-res'}
        </button>
      </div>
      {open ? (
        <ul id="x-content-post-sheet-hires-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {info.candidates.map((c) => (
            <li key={c.id} id={`x-content-post-sheet-hires-${c.id}`} style={ROW}>
              <MiniThumb id={c.thumbId || c.id} call={call} nasSha={c.nasSha || null} size={48} label={c.title || c.id} />
              <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--t-text)' }}>{dimsOf(c)}</span>
                <p style={META}>{(c.reasons || []).slice(0, 2).join(' · ')}</p>
                <p style={META}>{stateOf(c)}</p>
              </span>
              <button type="button" className="xce-btn-primary" disabled={busyId !== null} onClick={() => use(c)}>
                {busyId === c.id ? 'Working…' : c.staged ? 'Use this' : 'Copy and use'}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {open && info.nasWorker && info.nasWorker.online === false ? (
        <p id="x-content-post-sheet-hires-worker" className="xce-mc-notice">The NAS worker is offline. Start it on the Mac: <code>{info.nasWorker.startCommand}</code></p>
      ) : null}
      {message ? <p id="x-content-post-sheet-hires-message" style={META} role="status">{message}</p> : null}
      {info.download ? <p style={META}><a id="x-content-post-sheet-hires-download" href={info.download} target="_blank" rel="noopener noreferrer">Open the original</a></p> : null}
      {error ? <p id="x-content-post-sheet-hires-error" className="xce-mc-over" role="alert">{error}</p> : null}
    </div>
  );
}
