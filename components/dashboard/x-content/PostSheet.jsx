'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { ctDate, ctTime, ctWallToMs } from '../../../features/x-content-inventory/month-calendar.js';
import { ENGINE_TAG, StateDot, dayHeading } from './calendar-bits.jsx';

// PostSheet — review + edit one calendar post. Right-side sheet ≥481px,
// full-screen on phones. Presentational: every action goes back to the card.
//
// Times are edited as America/Chicago wall time (the account's posting
// timezone), never the browser's local zone, so what you type is what posts.
//
// Keyboard (desktop, focus not in a field): J/K next/prev in the review queue,
// A approve, X reject, Esc close. ⌘/Ctrl+Enter runs the primary action anywhere.

const MAX_CHARS = 280;
const SCORE_DEBOUNCE_MS = 400;
const STATE_LABEL = { pending: 'Pending approval', approved: 'Approved · not scheduled', scheduled: 'Scheduled', posted: 'Posted', failed: 'Failed' };

function initialWhen(post) {
  const iso = post.scheduledAt || post.proposedAt || post.postedAt || null;
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return { date: '', time: '' };
  return { date: ctDate(ms), time: ctTime(ms) };
}

function whenToIso({ date, time }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [h, m] = time.split(':').map(Number);
  return new Date(ctWallToMs(date, h * 60 + m)).toISOString();
}

export default function PostSheet({ post, busy, queue, onNavigate, onClose, onApprove, onReject, onSave, onUnschedule, onScore }) {
  const [content, setContent] = useState(post.content || '');
  const [when, setWhen] = useState(() => initialWhen(post));
  const [score, setScore] = useState(null);
  const sheetRef = useRef(null);

  // Reset the editor whenever a different post (or a refreshed copy) arrives.
  useEffect(() => {
    setContent(post.content || '');
    setWhen(initialWhen(post));
  }, [post.id, post.content, post.scheduledAt, post.proposedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { sheetRef.current?.focus(); }, [post.id]);

  // Live score: free, deterministic (scoreXPost), debounced.
  useEffect(() => {
    if (!onScore || !content.trim()) { setScore(null); return undefined; }
    let live = true;
    const t = setTimeout(() => {
      onScore(content).then((s) => { if (live) setScore(s); }).catch(() => {});
    }, SCORE_DEBOUNCE_MS);
    return () => { live = false; clearTimeout(t); };
  }, [content, onScore]);

  const locked = post.state === 'posted' || post.state === 'failed' || post.status === 'posting';
  const reviewable = post.state === 'pending' || post.state === 'approved';
  const canApprove = reviewable && !post.needsStory && post.status !== 'needs_review';
  const iso = whenToIso(when);
  const isFuture = iso ? Date.parse(iso) > Date.now() + 60_000 : false;
  const over = content.length > MAX_CHARS;
  const empty = !content.trim();
  const contentDirty = content !== (post.content || '');
  const timeDirty = (() => { const w = initialWhen(post); return w.date !== when.date || w.time !== when.time; })();

  const idx = queue.indexOf(post.id);
  const prevId = idx > 0 ? queue[idx - 1] : null;
  const nextId = idx !== -1 && idx < queue.length - 1 ? queue[idx + 1] : null;

  const whenLabel = iso ? `${dayHeading(ctDate(Date.parse(iso)))} · ${when.time} CT` : 'No time set';
  const approveBlocked = busy || !canApprove || over || empty || !isFuture;

  const actions = useMemo(() => ({
    approve: () => { if (!approveBlocked) onApprove(post, { content, scheduledAt: iso }); },
    reject: () => { if (!busy && reviewable) onReject(post); },
    save: () => {
      if (busy || over || empty) return;
      const extra = { content };
      if (post.state === 'scheduled' && timeDirty) {
        if (!isFuture) return;
        extra.scheduledAt = iso;
      }
      onSave(post, extra);
    },
  }), [approveBlocked, busy, reviewable, over, empty, timeDirty, isFuture, iso, content, post, onApprove, onReject, onSave]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (reviewable) actions.approve(); else if (!locked) actions.save();
        return;
      }
      const tag = (e.target?.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'j' && nextId) { e.preventDefault(); onNavigate(nextId); }
      else if (k === 'k' && prevId) { e.preventDefault(); onNavigate(prevId); }
      else if (k === 'a' && reviewable) { e.preventDefault(); actions.approve(); }
      else if (k === 'x' && reviewable) { e.preventDefault(); actions.reject(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, reviewable, locked, nextId, prevId, onClose, onNavigate]);

  const pct = score && Number.isFinite(score.xGrowthScore) ? Math.round(score.xGrowthScore * 100) : null;
  const warning = score?.warnings?.[0]?.message || null;
  const video = post.mediaType === 'video' || /\.(mp4|mov|webm)(\?|$)/i.test(post.mediaUrl || '');

  return (
    <div id="x-content-post-sheet-backdrop" className="xce-mc-sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section
        id="x-content-post-sheet"
        ref={sheetRef}
        tabIndex={-1}
        className="xce-mc-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="x-content-post-sheet-when"
      >
        <header id="x-content-post-sheet-header" className="xce-mc-sheet-head">
          <span id="x-content-post-sheet-state" className={`xce-mc-sheet-state xce-mc-state-${post.state}`}>
            <StateDot state={post.state} />
            {STATE_LABEL[post.state] || post.status}
            {post.proposed ? ' · proposed slot' : ''}
          </span>
          {idx !== -1 ? (
            <span id="x-content-post-sheet-queue-nav" className="xce-mc-sheet-queue">
              <button type="button" className="xce-mc-icon-btn" disabled={!prevId} onClick={() => onNavigate(prevId)} aria-label="Previous to review (K)"><ChevronLeft size={16} /></button>
              <span className="xce-mc-sheet-queue-pos">{idx + 1} / {queue.length}</span>
              <button type="button" className="xce-mc-icon-btn" disabled={!nextId} onClick={() => onNavigate(nextId)} aria-label="Next to review (J)"><ChevronRight size={16} /></button>
            </span>
          ) : null}
          <button type="button" id="x-content-post-sheet-close" className="xce-mc-icon-btn" onClick={onClose} aria-label="Close (Esc)"><X size={16} /></button>
        </header>

        <div id="x-content-post-sheet-body" className="xce-mc-sheet-body">
          <h3 id="x-content-post-sheet-when" className="xce-mc-sheet-when">{whenLabel}</h3>

          {post.mediaUrl ? (
            <div id="x-content-post-sheet-media" className="xce-mc-sheet-media">
              {video
                ? <video controls preload="none" playsInline poster={post.posterUrl || undefined} src={post.mediaUrl} />
                : <img src={post.mediaUrl} alt="" />}
            </div>
          ) : null}

          <div id="x-content-post-sheet-text-field" className="xce-mc-field">
            <label htmlFor="x-content-post-sheet-text" className="xce-mc-kicker">Post</label>
            <textarea
              id="x-content-post-sheet-text"
              className="xce-textarea xce-mc-sheet-text"
              value={content}
              readOnly={locked}
              onChange={(e) => setContent(e.target.value)}
              rows={7}
            />
            <p id="x-content-post-sheet-text-meta" className="xce-mc-sheet-meta-line">
              <span className={over ? 'xce-mc-over' : ''}>{content.length} / {MAX_CHARS}</span>
              {pct != null ? <span>Score {pct}</span> : null}
              {warning ? <span className="xce-mc-sheet-warning">{warning}</span> : null}
            </p>
          </div>

          {!locked ? (
            <div id="x-content-post-sheet-when-field" className="xce-mc-field">
              <span className="xce-mc-kicker">Publish time · CT</span>
              <div id="x-content-post-sheet-when-row" className="xce-mc-when-row">
                <input id="x-content-post-sheet-date" type="date" className="xce-input" value={when.date} aria-label="Date (Central Time)" onChange={(e) => setWhen((w) => ({ ...w, date: e.target.value }))} />
                <input id="x-content-post-sheet-time" type="time" step={300} className="xce-input" value={when.time} aria-label="Time (Central Time)" onChange={(e) => setWhen((w) => ({ ...w, time: e.target.value }))} />
              </div>
              {iso && !isFuture ? <p className="xce-mc-over">Pick a time in the future.</p> : null}
            </div>
          ) : null}

          {post.needsStory ? <p id="x-content-post-sheet-needs-story" className="xce-mc-notice">This draft still needs its story before it can be approved. Write it in the item drawer.</p> : null}
          {post.status === 'needs_review' ? <p id="x-content-post-sheet-needs-review" className="xce-mc-notice">Flagged for review by the guard. It can be rejected here; approving needs it back in draft.</p> : null}
          {post.state === 'failed' && post.error ? <p id="x-content-post-sheet-error" className="xce-mc-over">{post.error}</p> : null}

          <dl id="x-content-post-sheet-facts" className="xce-mc-facts">
            {post.engine ? <><dt>Engine</dt><dd>{ENGINE_TAG[post.engine]}</dd></> : null}
            {post.packageId ? <><dt>Package</dt><dd>{post.packageId}</dd></> : null}
            {post.twitterId ? <><dt>On X</dt><dd><a href={`https://x.com/i/web/status/${post.twitterId}`} target="_blank" rel="noopener noreferrer">View post</a></dd></> : null}
            <dt>ID</dt><dd>{post.id}</dd>
          </dl>
        </div>

        {!locked ? (
          <footer id="x-content-post-sheet-actions" className="xce-mc-sheet-foot">
            {reviewable ? (
              <>
                <p id="x-content-post-sheet-consequence" className="xce-mc-sheet-consequence">
                  {canApprove ? (iso ? `Approving publishes to X at ${whenLabel}.` : 'Set a publish time to approve.') : 'Cannot be approved yet.'}
                </p>
                <div className="xce-mc-sheet-buttons">
                  <button type="button" id="x-content-post-sheet-reject" className="xce-btn-ghost" disabled={busy} onClick={actions.reject}>Reject</button>
                  {contentDirty ? <button type="button" id="x-content-post-sheet-save" className="xce-btn-ghost" disabled={busy || over || empty} onClick={actions.save}>Save edit</button> : null}
                  <button type="button" id="x-content-post-sheet-approve" className="xce-btn-primary" disabled={approveBlocked} onClick={actions.approve}>
                    {busy ? 'Working…' : 'Approve & schedule'}
                  </button>
                </div>
              </>
            ) : (
              <div className="xce-mc-sheet-buttons">
                <button type="button" id="x-content-post-sheet-unschedule" className="xce-btn-ghost" disabled={busy} onClick={() => onUnschedule(post)}>Unschedule</button>
                <button type="button" id="x-content-post-sheet-save-scheduled" className="xce-btn-primary" disabled={busy || over || empty || (!contentDirty && !timeDirty) || (timeDirty && !isFuture)} onClick={actions.save}>
                  {busy ? 'Working…' : 'Save changes'}
                </button>
              </div>
            )}
            <p className="xce-mc-sheet-keys" aria-hidden="true">{reviewable ? 'J/K next · A approve · X reject · ' : ''}⌘↵ {reviewable ? 'approve' : 'save'} · Esc close</p>
          </footer>
        ) : null}
      </section>
    </div>
  );
}
