'use client';

// POST level for a row shown from a synced client's calendar (features/social-posting/synced-calendar.js).
// Read the full copy + creative, then Approve / Unapprove FOR THIS (VIEWER) CLIENT ONLY: the `synced-review` action
// writes the viewer's own synced_reviews doc. The source client's post (status, schedule, copy) is never changed.
// Props: row (calendar row with `synced` + `viewerReview`), call(action, body), onRefresh, nav.

import React, { useState } from 'react';
import LoadingRing from '../content-ui/ui/LoadingRing';
import { STATE_LABEL } from './calendar-bits.jsx';

const isVideo = (row) => row?.mediaType === 'video' || /\.(mp4|mov|m4v|webm)(\?|$)/i.test(String(row?.mediaUrl || ''));
const dateLabel = (row) => {
  const at = Date.parse(row?.scheduledAt || row?.proposedAt || row?.postedAt || '');
  if (!Number.isFinite(at)) return row?.date || 'No date yet';
  return new Date(at).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT';
};

export default function SyncedPostReview({ row, calendarReady, call, onRefresh, nav }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [local, setLocal] = useState(null); // optimistic review until the calendar reloads

  if (!row) {
    return calendarReady
      ? <p id="synced-review-missing" className="synced-review-note">This post is no longer on the synced calendar.</p>
      : <LoadingRing id="synced-review-loading" label="Loading the post" minHeight={240} />;
  }

  const review = local || row.viewerReview || null;
  const approved = review?.approved === true;
  const source = row.synced?.name || row.synced?.clientId || 'another client';

  const decide = async (decision) => {
    if (typeof call !== 'function') return;
    setBusy(true);
    setNote('');
    try {
      const res = await call('synced-review', { postId: row.id, decision });
      setLocal(res?.review || { approved: decision === 'approve' });
      if (onRefresh) await onRefresh();
    } catch (err) {
      setNote(err?.message || 'Could not save that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="synced-review-panel" className="synced-review" data-synced-client={row.synced?.clientId || ''}>
      <header id="synced-review-header" className="synced-review-header">
        {nav?.back ? <button type="button" id="synced-review-back" className="synced-review-link" onClick={() => nav.back()}>‹ Back</button> : null}
        <p id="synced-review-source" className="synced-review-source">
          From {source} · on {source}: <strong>{STATE_LABEL[row.state] || row.state || 'draft'}</strong>
        </p>
        <p id="synced-review-time" className="synced-review-time">{dateLabel(row)}</p>
      </header>

      {row.mediaUrl || row.thumbUrl ? (
        <div id="synced-review-creative" className="synced-review-creative">
          {isVideo(row) && row.mediaUrl
            ? <video id="synced-review-video" src={row.mediaUrl} poster={row.thumbUrl || undefined} controls playsInline preload="metadata" />
            : <img id="synced-review-image" src={row.mediaUrl || row.thumbUrl} alt="" />}
        </div>
      ) : <p id="synced-review-no-creative" className="synced-review-note">No creative on this post yet.</p>}

      <pre id="synced-review-copy" className="synced-review-copy">{row.content || row.title || '(no text)'}</pre>

      <div id="synced-review-decision-row" className="synced-review-actions">
        <span id="synced-review-status" className={`synced-review-status${approved ? ' is-approved' : ''}`}>
          {approved ? 'Approved for HITLOOP' : review?.changed ? 'Changed since you approved it' : 'Not approved for HITLOOP yet'}
        </span>
        {approved
          ? <button type="button" id="synced-review-unapprove" className="synced-review-btn" disabled={busy} onClick={() => decide('unapprove')}>Unapprove</button>
          : <button type="button" id="synced-review-approve" className="synced-review-btn is-primary" disabled={busy} onClick={() => decide('approve')}>Approve for HITLOOP</button>}
      </div>
      <p id="synced-review-scope-note" className="synced-review-note">
        Only HITLOOP's approval changes. {source}'s own post stays as it is unless you ask the chat to update it.
      </p>
      {note ? <p id="synced-review-error" className="synced-review-note synced-review-error" role="alert">{note}</p> : null}

      <style>{`
        #synced-review-panel { display: flex; flex-direction: column; gap: 12px; max-width: 640px; margin: 0 auto; padding: 16px; background: var(--t-surface); color: var(--t-text); border: 1px solid color-mix(in srgb, var(--t-text) 12%, transparent); border-radius: 16px; }
        #synced-review-panel .synced-review-header { display: flex; flex-direction: column; gap: 4px; }
        #synced-review-panel .synced-review-link { align-self: flex-start; background: none; border: 0; padding: 0; color: var(--t-text-secondary); font: inherit; cursor: pointer; }
        #synced-review-panel .synced-review-source, #synced-review-panel .synced-review-time { margin: 0; font-family: var(--font-mono); font-size: 12px; color: var(--t-text-secondary); }
        #synced-review-panel .synced-review-creative video, #synced-review-panel .synced-review-creative img { display: block; width: 100%; max-height: 70vh; object-fit: contain; border-radius: 12px; background: color-mix(in srgb, var(--t-text) 92%, transparent); }
        #synced-review-panel .synced-review-copy { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 15px; line-height: 1.45; }
        #synced-review-panel .synced-review-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        #synced-review-panel .synced-review-status { font-size: 13px; color: var(--t-text-secondary); }
        #synced-review-panel .synced-review-status.is-approved { color: var(--t-text); font-weight: 600; }
        #synced-review-panel .synced-review-btn { min-height: 40px; padding: 0 16px; border-radius: 12px; border: 1px solid color-mix(in srgb, var(--t-text) 18%, transparent); background: var(--t-surface); color: var(--t-text); font: inherit; font-weight: 600; cursor: pointer; }
        #synced-review-panel .synced-review-btn.is-primary { background: var(--t-text); color: var(--t-surface); border-color: var(--t-text); }
        #synced-review-panel .synced-review-btn:disabled { opacity: 0.5; cursor: default; }
        #synced-review-panel .synced-review-note { margin: 0; font-size: 12px; color: var(--t-text-secondary); }
        #synced-review-panel .synced-review-error { color: var(--t-danger); }
      `}</style>
    </section>
  );
}
