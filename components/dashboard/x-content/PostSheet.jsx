'use client';

import { useCalendarActions, standaloneCallSocial } from './standalone.js';
import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { classifyResult, ctDate, ctTime, ctWallToMs } from '../../../features/x-content-inventory/month-calendar.js';
import { ENGINE_TAG, STATE_LABEL, StateDot, dayHeading } from './calendar-bits.jsx';

// PostSheet — review + edit one calendar post. Right-side sheet ≥481px,
// full-screen on phones. Presentational: every action goes back to the card.
//
// Times are edited as America/Chicago wall time (the account's posting
// timezone), never the browser's local zone, so what you type is what posts.
//
// Keyboard: Tab is trapped inside the sheet, focus moves in on open and back
// to the opener on close. J/K (focus not in a field) step through the review
// queue. Esc closes; with unsaved edits the first Esc asks, the second discards.
// There is deliberately NO single-key or chord approve/reject: publishing
// actions need a click on a visible button.
//
// Stale-card safety: approve/save/reject/unschedule/reconcile all pass
// `expectedRevision` (the row's revision) in their options object. A handler
// that resolves `false` (or {ok:false,errorClass:'revision-conflict'}) keeps the
// sheet open with the user's edit and offers Reload (onRefresh). A handler that
// resolves {ok:false, errorClass:'plan-*'} reveals the owner-override fields.

const MAX_CHARS = 280;
const SCORE_DEBOUNCE_MS = 400;
const CONSEQUENCE = 'Schedules this exact copy; it posts when the publish run picks it up.';
const CONFLICT_TEXT = 'This post changed while you were editing. Reload to see the latest, then re-apply your edit.';
const DISCARD_TEXT = 'Discard unsaved changes? Esc again to discard';
const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),video[controls],[tabindex]:not([tabindex="-1"])';

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

function PostSheetView({ post, busy, queue, onNavigate, onClose, onApprove, onReject, onSave, onUnschedule, onScore, onReconcile, onRefresh }) {
  const [content, setContent] = useState(post.content || '');
  const [when, setWhen] = useState(() => initialWhen(post));
  const [score, setScore] = useState(null);
  const [conflict, setConflict] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [planBlock, setPlanBlock] = useState(null);
  const [override, setOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [platformId, setPlatformId] = useState('');
  const sheetRef = useRef(null);
  const openerRef = useRef(typeof document !== 'undefined' ? document.activeElement : null);

  // Reset the editor whenever a different post (or a refreshed copy) arrives.
  useEffect(() => {
    setContent(post.content || '');
    setWhen(initialWhen(post));
    setConflict(false);
    setConfirmDiscard(false);
    setPlanBlock(null);
    setOverride(false);
    setOverrideReason('');
    setPlatformId('');
  }, [post.id, post.content, post.scheduledAt, post.proposedAt, post.revision]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus in on open; restore to the opener on close.
  useEffect(() => { sheetRef.current?.focus(); }, [post.id]);
  useEffect(() => () => {
    const el = openerRef.current;
    if (el && el.isConnected && typeof el.focus === 'function') el.focus();
  }, []);

  // Live score: free, deterministic (scoreXPost), debounced.
  useEffect(() => {
    if (!onScore || !content.trim()) { setScore(null); return undefined; }
    let live = true;
    const t = setTimeout(() => {
      onScore(content).then((s) => { if (live) setScore(s); }).catch(() => {});
    }, SCORE_DEBOUNCE_MS);
    return () => { live = false; clearTimeout(t); };
  }, [content, onScore]);

  const held = post.state === 'held';
  const locked = post.state === 'posted' || post.state === 'failed' || post.status === 'posting' || held;
  const reviewable = post.state === 'pending' || post.state === 'approved' || post.state === 'awaiting';
  const canReject = reviewable || held;
  const canApprove = reviewable && !post.needsStory && post.status !== 'needs_review';
  const iso = whenToIso(when);
  const isFuture = iso ? Date.parse(iso) > Date.now() + 60_000 : false;
  const over = content.length > MAX_CHARS;
  const empty = !content.trim();
  const contentDirty = content !== (post.content || '');
  const timeDirty = (() => { const w = initialWhen(post); return w.date !== when.date || w.time !== when.time; })();
  const dirty = !locked && (contentDirty || timeDirty);
  const expectedRevision = post.revision ?? null;

  const idx = queue.indexOf(post.id);
  const prevId = !dirty && idx > 0 ? queue[idx - 1] : null;
  const nextId = !dirty && idx !== -1 && idx < queue.length - 1 ? queue[idx + 1] : null;

  const whenLabel = iso ? `${dayHeading(ctDate(Date.parse(iso)))} · ${when.time} CT` : 'No time set';
  const overrideMissing = override && !overrideReason.trim();
  const approveBlocked = busy || !canApprove || over || empty || !isFuture || overrideMissing;

  // Run a card handler; route its result into conflict / plan-override UI.
  const run = async (fn) => {
    setConflict(false);
    let res;
    try { res = await fn(); } catch { return; }
    const c = classifyResult(res);
    if (c.kind === 'conflict') setConflict(true);
    else if (c.kind === 'plan') setPlanBlock({ code: c.code, message: c.message });
  };

  const requestClose = () => {
    if (dirty && !confirmDiscard) { setConfirmDiscard(true); return; }
    onClose();
  };

  const actions = {
    approve: () => {
      if (approveBlocked) return;
      const opts = { content, scheduledAt: iso, expectedRevision };
      if (override) opts.planOverride = { confirm: true, reason: overrideReason.trim() };
      run(() => onApprove(post, opts));
    },
    reject: () => { if (!busy && canReject) run(() => onReject(post, { expectedRevision })); },
    save: () => {
      if (busy || over || empty) return;
      const extra = { content, expectedRevision };
      if (post.state === 'scheduled' && timeDirty) {
        if (!isFuture) return;
        extra.scheduledAt = iso;
      }
      run(() => onSave(post, extra));
    },
    unschedule: () => { if (!busy) run(() => onUnschedule(post, { expectedRevision })); },
    reconcile: (outcome) => {
      if (busy || !onReconcile) return;
      run(() => onReconcile(post, { outcome, platformId: outcome === 'posted' ? (platformId.trim() || null) : null, expectedRevision }));
    },
  };

  // Latest-handler ref so the window listener never goes stale or re-binds per keystroke.
  const latest = useRef({});
  latest.current = { requestClose, nextId, prevId, onNavigate };

  useEffect(() => {
    const onKey = (e) => {
      const cur = latest.current;
      // Capture phase + stopPropagation: Escape closes THIS sheet only. The dashboard's own Escape handler (which
      // closes the whole Content Engine modal) must not also fire and drop the operator's place and unsaved edits.
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); cur.requestClose(); return; }
      if (e.key === 'Tab') {
        const root = sheetRef.current;
        if (!root) return;
        const nodes = Array.from(root.querySelectorAll(FOCUSABLE));
        if (!nodes.length) { e.preventDefault(); root.focus(); return; }
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const active = document.activeElement;
        if (!root.contains(active) || active === root) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
        else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
        return;
      }
      const tag = (e.target?.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'j' && cur.nextId) { e.preventDefault(); cur.onNavigate(cur.nextId); }
      else if (k === 'k' && cur.prevId) { e.preventDefault(); cur.onNavigate(cur.prevId); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Editing clears the discard prompt (the user is clearly not discarding).
  const edit = (fn) => (e) => { setConfirmDiscard(false); fn(e); };

  const pct = score && Number.isFinite(score.xGrowthScore) ? Math.round(score.xGrowthScore * 100) : null;
  const warning = score?.warnings?.[0]?.message || null;
  const video = post.mediaType === 'video' || /\.(mp4|mov|webm)(\?|$)/i.test(post.mediaUrl || '');

  return (
    <div id="x-content-post-sheet-backdrop" className="xce-mc-sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
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
          <button type="button" id="x-content-post-sheet-close" className="xce-mc-icon-btn" onClick={requestClose} aria-label="Close (Esc)"><X size={16} /></button>
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
              onChange={edit((e) => setContent(e.target.value))}
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
                <input id="x-content-post-sheet-date" type="date" className="xce-input" value={when.date} aria-label="Date (Central Time)" onChange={edit((e) => setWhen((w) => ({ ...w, date: e.target.value })))} />
                <input id="x-content-post-sheet-time" type="time" step={300} className="xce-input" value={when.time} aria-label="Time (Central Time)" onChange={edit((e) => setWhen((w) => ({ ...w, time: e.target.value })))} />
              </div>
              {iso && !isFuture ? <p className="xce-mc-over">Pick a time in the future.</p> : null}
            </div>
          ) : null}

          {post.needsStory ? <p id="x-content-post-sheet-needs-story" className="xce-mc-notice">This draft still needs its story before it can be approved. Write it in the item drawer.</p> : null}
          {post.state === 'awaiting' ? <p id="x-content-post-sheet-awaiting-note" className="xce-mc-notice">Awaiting your approval. Nothing posts until you approve it.</p> : null}
          {held ? (
            <div id="x-content-post-sheet-held-panel" className="xce-mc-notice xce-mc-held">
              <p id="x-content-post-sheet-held-reason" className="xce-mc-held-reason">Held for review: {post.heldReason || 'Held for review.'}</p>
              <p id="x-content-post-sheet-held-next" className="xce-mc-held-next">{post.heldNext || 'Review it, then reject it or reconcile it.'}</p>
              {post.error ? <p id="x-content-post-sheet-held-detail" className="xce-mc-held-detail">{post.error}</p> : null}
            </div>
          ) : null}
          {post.state === 'failed' ? (
            <div id="x-content-post-sheet-failed-panel" className="xce-mc-failed">
              <p id="x-content-post-sheet-error" className="xce-mc-over">{post.error || 'Publishing failed.'}</p>
              <p id="x-content-post-sheet-failed-note" className="xce-mc-held-next">Failed posts are not retried automatically.</p>
            </div>
          ) : null}

          <dl id="x-content-post-sheet-facts" className="xce-mc-facts">
            {post.engine ? <><dt>Engine</dt><dd>{ENGINE_TAG[post.engine]}</dd></> : null}
            {post.packageId ? <><dt>Package</dt><dd>{post.packageId}</dd></> : null}
            {!post.twitterId && post.selfReported ? <><dt>On X</dt><dd>Posted manually (self-reported){post.permalink ? <> · <a href={post.permalink} target="_blank" rel="noopener noreferrer">link</a></> : null}</dd></> : null}
            {post.twitterId ? <><dt>On X</dt><dd><a href={`https://x.com/i/web/status/${post.twitterId}`} target="_blank" rel="noopener noreferrer">View post</a></dd></> : null}
            <dt>ID</dt><dd>{post.id}</dd>
          </dl>
        </div>

        {conflict ? (
          <div id="x-content-post-sheet-conflict" className="xce-mc-conflict" role="alert">
            <p id="x-content-post-sheet-conflict-text" className="xce-mc-conflict-text">{CONFLICT_TEXT}</p>
            {onRefresh ? <button type="button" id="x-content-post-sheet-reload" className="xce-btn-ghost" onClick={() => onRefresh()}>Reload</button> : null}
          </div>
        ) : null}

        {planBlock ? (
          <div id="x-content-post-sheet-plan-override" className="xce-mc-override">
            <p id="x-content-post-sheet-plan-override-text" className="xce-mc-over">{planBlock.message || `The plan blocks this post (${planBlock.code}).`}</p>
            <label htmlFor="x-content-post-sheet-override-check" className="xce-mc-override-check">
              <input id="x-content-post-sheet-override-check" type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
              Override plan <span className="xce-mc-override-note">Owner override — recorded on the post</span>
            </label>
            {override ? (
              <input id="x-content-post-sheet-override-reason" type="text" className="xce-input" value={overrideReason} placeholder="Reason (required)" aria-label="Override reason (required)" onChange={(e) => setOverrideReason(e.target.value)} />
            ) : null}
          </div>
        ) : null}

        {confirmDiscard ? <p id="x-content-post-sheet-discard-confirm" className="xce-mc-discard" role="alert">{DISCARD_TEXT}</p> : null}

        {held ? (
          <footer id="x-content-post-sheet-held-actions" className="xce-mc-sheet-foot">
            {onReconcile ? (
              <div id="x-content-post-sheet-reconcile-row" className="xce-mc-reconcile">
                <label htmlFor="x-content-post-sheet-platform-id" className="xce-mc-kicker">X post ID (if it is live)</label>
                <input id="x-content-post-sheet-platform-id" type="text" className="xce-input" value={platformId} placeholder="optional" onChange={(e) => setPlatformId(e.target.value)} />
              </div>
            ) : null}
            <div className="xce-mc-sheet-buttons">
              <button type="button" id="x-content-post-sheet-reject" className="xce-btn-ghost" disabled={busy} onClick={actions.reject}>Reject</button>
              {onReconcile ? (
                <>
                  <button type="button" id="x-content-post-sheet-reconcile-not-posted" className="xce-btn-ghost" disabled={busy} onClick={() => actions.reconcile('not_posted')}>Mark not posted</button>
                  <button type="button" id="x-content-post-sheet-reconcile-posted" className="xce-btn-primary" disabled={busy} onClick={() => actions.reconcile('posted')}>{busy ? 'Working…' : 'Mark posted'}</button>
                </>
              ) : null}
            </div>
            <p className="xce-mc-sheet-keys">J/K next · Esc close</p>
          </footer>
        ) : null}

        {!locked ? (
          <footer id="x-content-post-sheet-actions" className="xce-mc-sheet-foot">
            {reviewable ? (
              <>
                <div className="xce-mc-sheet-buttons">
                  <button type="button" id="x-content-post-sheet-reject" className="xce-btn-ghost" disabled={busy} onClick={actions.reject}>Reject</button>
                  {contentDirty ? <button type="button" id="x-content-post-sheet-save" className="xce-btn-ghost" disabled={busy || over || empty} onClick={actions.save}>Save edit</button> : null}
                  <button type="button" id="x-content-post-sheet-approve" className="xce-btn-primary" disabled={approveBlocked} onClick={actions.approve} aria-describedby="x-content-post-sheet-consequence">
                    {busy ? 'Working…' : 'Approve & schedule'}
                  </button>
                </div>
                <p id="x-content-post-sheet-consequence" className="xce-mc-sheet-consequence">
                  {!canApprove ? 'Cannot be approved yet.' : !iso ? 'Set a publish time to approve.' : CONSEQUENCE}
                </p>
              </>
            ) : (
              <div className="xce-mc-sheet-buttons">
                <button type="button" id="x-content-post-sheet-unschedule" className="xce-btn-ghost" disabled={busy} onClick={actions.unschedule}>Unschedule</button>
                <button type="button" id="x-content-post-sheet-save-scheduled" className="xce-btn-primary" disabled={busy || over || empty || (!contentDirty && !timeDirty) || (timeDirty && !isFuture)} onClick={actions.save}>
                  {busy ? 'Working…' : 'Save changes'}
                </button>
              </div>
            )}
            <p id="x-content-post-sheet-keys" className="xce-mc-sheet-keys">{reviewable ? 'J/K next · ' : ''}Esc close</p>
          </footer>
        ) : null}
      </section>
    </div>
  );
}

// Content Center (via MonthCalendarPanel) passes `queue` and all handlers. Standalone: <PostSheet post onClose? call? clientId? onNavigate? />
// uses the social-posting actions directly; no queue navigation; onClose defaults to a no-op.
export default function PostSheet(props) {
  const actions = useCalendarActions(standaloneCallSocial);
  if (props.queue !== undefined) return <PostSheetView {...props} />;
  return (
    <PostSheetView
      busy={actions.busyId === props.post?.id}
      onClose={() => {}}
      onApprove={actions.onApprove}
      onReject={actions.onReject}
      onSave={actions.onSave}
      onUnschedule={actions.onUnschedule}
      onScore={actions.onScore}
      onReconcile={actions.onReconcile}
      {...props}
      queue={[]}
      onNavigate={() => {}}
    />
  );
}
