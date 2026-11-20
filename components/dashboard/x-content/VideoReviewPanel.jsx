'use client';

// VideoReviewPanel — the owner's feedback loop on the video attached from a storyboard episode: approve it, request changes
// (optionally "at m:ss"), and browse / restore earlier versions. Saves through social-posting `video-brief-video-review` and
// `video-brief-video-restore` (features/brief-video/video-review.js). Rendered by VideoBriefV2Editor; styles: PostEditor.jsx (.pe-vb*, .pe-v2*).

import React, { useState } from 'react';
import { friendlyBriefReasons } from './post-editor-model.js';
import { attachedVersion, versionsOf } from '../../../features/brief-video/video-review.js';

const REVIEW_LABEL = { pending: 'Awaiting your review', approved: 'Approved', changes: 'Changes requested' };

/** "1:05" / "65" / "" -> seconds | null | NaN (invalid). */
export function parseAtSeconds(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const m = /^(\d{1,3}):([0-5]?\d)$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return /^\d{1,4}(\.\d)?$/.test(t) ? Number(t) : Number.NaN;
}
export const fmtSeconds = (s) => (Number.isFinite(Number(s)) ? `${Math.floor(Number(s) / 60)}:${String(Math.floor(Number(s) % 60)).padStart(2, '0')}` : '');
const pad = (n) => String(n).padStart(2, '0');

export default function VideoReviewPanel({ row, callSocial, editable, onRowPatch }) {
  const meta = row?.videoBriefMeta || null;
  const v = attachedVersion(row);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [notes, setNotes] = useState('');
  const [at, setAt] = useState('');
  const [urls, setUrls] = useState({});
  if (v == null || !meta?.storyboard) return null;

  const review = meta.videoReview || null;
  const status = review?.status || 'pending';
  const versions = versionsOf(meta);
  const atSeconds = parseAtSeconds(at);
  const atBad = Number.isNaN(atSeconds);
  const canAct = editable && !busy;

  const run = async (body, okText) => {
    setBusy(true); setMsg(null);
    try {
      const res = await callSocial({ ...body, postId: row.id, expectedRevision: row.revision ?? null });
      if (!res?.ok) throw new Error(res?.error || 'Save failed.');
      onRowPatch?.({ revision: res.post?.revision ?? row.revision, videoBriefMeta: res.brief?.meta || null, mediaUrl: res.mediaUrl || row.mediaUrl, posterUrl: res.posterUrl || row.posterUrl, mediaJobId: res.brief?.mediaJobId ?? row.mediaJobId, mediaStoragePath: res.brief?.mediaStoragePath ?? row.mediaStoragePath, mediaMetadata: res.brief?.mediaMetadata ?? row.mediaMetadata });
      setNotes(''); setAt('');
      setMsg({ tone: 'ok', text: okText });
    } catch (e) {
      setMsg({ tone: 'bad', text: friendlyBriefReasons(e?.message || 'Save failed.') });
    } finally { setBusy(false); }
  };
  const decide = (decision) => run(
    { action: 'video-brief-video-review', decision, v, outlineHash: row.mediaMetadata?.outlineHash || null, ...(decision === 'changes' ? { notes: notes.trim(), atSeconds } : {}) },
    decision === 'approve' ? 'Video approved.' : 'Changes requested. The Director will send a new version.',
  );
  const restore = (n) => run({ action: 'video-brief-video-restore', v: n }, `Version ${pad(n)} is back on the post.`);
  const play = async (n) => {
    try {
      const res = await callSocial({ action: 'video-brief-get', postId: row.id, v: n });
      setUrls((u) => ({ ...u, [n]: res?.versionVideoUrl || 'none' }));
    } catch { setUrls((u) => ({ ...u, [n]: 'none' })); }
  };

  return (
    <section id="post-video-review-panel" className="pe-v2-fieldset" data-section="post-video-review">
      <div id="post-video-review-header-row" className="pe-vb-row">
        <strong>Video review</strong>
        <span id="post-video-review-version-badge" className="pe-vb-pill">v{pad(v)}</span>
        <span id="post-video-review-status-chip" className="pe-vb-pill" data-status={status}>{REVIEW_LABEL[status] || status}</span>
      </div>
      {row.mediaUrl ? <video id="post-video-review-player" src={row.mediaUrl} poster={row.posterUrl || undefined} controls playsInline preload="metadata" style={{ width: '100%', maxWidth: 360, borderRadius: 8 }} /> : null}
      {status === 'changes' && review?.notes ? <p id="post-video-review-requested-notes" className="pe-muted">You asked{Number.isFinite(review.atSeconds) ? ` (at ${fmtSeconds(review.atSeconds)})` : ''}: {review.notes}</p> : null}
      <div id="post-video-review-changes-form" className="pe-vb-row">
        <label className="pe-vb-field" htmlFor="post-video-review-notes">What should change
          <textarea id="post-video-review-notes" className="pe-text pe-v2-input" rows={3} maxLength={2000} value={notes} readOnly={!canAct} onChange={(e) => { setNotes(e.target.value); setMsg(null); }} />
        </label>
        <label className="pe-vb-field" htmlFor="post-video-review-at">At (m:ss, optional)
          <input id="post-video-review-at" className="pe-input pe-input-compact" inputMode="numeric" placeholder="0:12" value={at} readOnly={!canAct} onChange={(e) => { setAt(e.target.value); setMsg(null); }} />
        </label>
      </div>
      <div id="post-video-review-actions-row" className="pe-vb-row">
        <button type="button" id="post-video-review-approve-btn" className="pe-btn pe-btn-ghost" disabled={!canAct || status === 'approved'} onClick={() => decide('approve')}>Approve video</button>
        <button type="button" id="post-video-review-changes-btn" className="pe-btn pe-btn-ghost" disabled={!canAct || !notes.trim() || atBad} onClick={() => decide('changes')}>Request changes</button>
        {atBad ? <span className="pe-over">Use m:ss, like 0:12.</span> : null}
      </div>
      {versions.length ? (
        <ol id="post-video-versions-list" data-section="post-video-versions" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {versions.map((x) => (
            <li id={`post-video-version-${pad(x.v)}`} key={x.v} className="pe-vb-row">
              <span className="pe-vb-pill">v{pad(x.v)}{x.v === v ? ' (current)' : ''}</span>
              <span className="pe-muted">{x.createdAt ? String(x.createdAt).slice(0, 10) : ''}{x.notes ? ` · ${x.notes}` : ''}</span>
              {urls[x.v] && urls[x.v] !== 'none' ? <video id={`post-video-version-${pad(x.v)}-player`} src={urls[x.v]} controls playsInline preload="metadata" style={{ width: '100%', maxWidth: 240, borderRadius: 8 }} /> : <button type="button" id={`post-video-version-${pad(x.v)}-play-btn`} className="pe-btn pe-btn-ghost" onClick={() => play(x.v)}>{urls[x.v] === 'none' ? 'Unavailable' : 'Play'}</button>}
              {x.v !== v ? <button type="button" id={`post-video-version-${pad(x.v)}-restore-btn`} className="pe-btn pe-btn-ghost" disabled={!canAct} onClick={() => restore(x.v)}>Restore</button> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {msg ? <p id="post-video-review-message" className={msg.tone === 'bad' ? 'pe-over' : 'pe-muted'} role={msg.tone === 'bad' ? 'alert' : 'status'}>{msg.text}</p> : null}
    </section>
  );
}
