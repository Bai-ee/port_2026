'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ImagePlus } from 'lucide-react';
import { useMarketingContentCall } from '../marketing/useMarketingContentCall.js';
import MiniThumb from './MiniThumb.jsx';
import {
  MAX_CHARS, MEDIA_CHANGED_MESSAGE, charCount, isOverLimit, initialWhen, whenToIso, zoneLabel, resolveTimeZone,
  isSuggestion, isLockedRow, statusPill, boundFields, boundFieldsGate, boundFieldsNotice, dirtyState, actionState, isScheduledStatus,
  buildSaveRequest, buildApproveRequest, buildApproveScheduleRequest, buildSuggestionApproveRequest, buildUnapproveRequest,
  buildRejectRequest, buildUnscheduleRequest, buildReconcileRequest, moreItems, classifyError, approvalVoided, mediaChanged, mergeServerPost,
} from './post-editor-model.js';

// PostEditor — the single View & Edit Post surface. An X-style card that IS the editor: copy, creative, time, and
// Save / Approve / Approve & schedule. What it shows is exactly what gets saved and approved.
//
// Host-agnostic: it never opens an overlay. `onPickCreative()` asks the host to show the picker; `pickerSlot` renders the
// picker inline inside the editor. `onDirtyChange(bool)` lets the host block leaving with unsaved edits (no confirm/alert here).
//
// Calls: quote-targets `call(action, body)` and social-posting `callSocial(body)` (useMarketingContentCall). No new routes.
// Approval locks in content, selfReply, mediaUrl, mediaVariants, replyTo (lifecycle.js contentHash): all five are shown, and
// Approve stays disabled while any of them is not visible (post-editor-model.js boundFieldsGate).
// Styles: tokens only (--t-*), every selector under #post-editor-root.

const HIRES_STATUSES = new Set(['draft', 'approved', 'awaiting_approval', 'scheduled']);
const isVideoRow = (row) => row?.mediaType === 'video' || /\.(mp4|mov|webm)(\?|$)/i.test(row?.mediaUrl || '');
const dimsOf = (c) => (c.width && c.height ? `${c.width}×${c.height}` : 'size unknown');
const hiresState = (c) => (c.staged ? 'On staging, ready' : /^(QUEUED|RUNNING|CLAIMED|IN_PROGRESS)$/i.test(c.stageState || '') ? 'Copying from the drive…' : c.stageState === 'FAILED' ? 'Last copy failed' : 'On the drive, not copied yet');

// A row loaded by id only (post-status projection): map the raw status onto the calendar row fields the model reads.
const STATE_BY_STATUS = { draft: 'pending', awaiting_approval: 'awaiting', needs_review: 'held', approved: 'approved', scheduled: 'scheduled', queued: 'scheduled', posting: 'scheduled', manual: 'manual', posted: 'posted', failed: 'failed' };
const withState = (r) => (r && !r.state && r.status ? { ...r, state: STATE_BY_STATUS[r.status] || 'pending' } : r);

function MediaBlock({ row }) {
  if (row.mediaUrl) {
    return (
      <div id="post-editor-creative-media" className="pe-media">
        {isVideoRow(row)
          ? <video controls preload="metadata" playsInline poster={row.posterUrl || undefined} src={row.mediaUrl} />
          : <img src={row.mediaUrl} alt="" />}
      </div>
    );
  }
  if (row.thumbUrl) {
    return <div id="post-editor-creative-media" className="pe-media"><img src={row.thumbUrl} alt="" /></div>;
  }
  return <p id="post-editor-creative-empty" className="pe-muted">No creative yet.</p>;
}

function VariantList({ variants }) {
  const entries = [];
  for (const [kind, sizes] of Object.entries(variants || {})) {
    if (!sizes || typeof sizes !== 'object') continue;
    for (const [size, v] of Object.entries(sizes)) entries.push({ id: `${kind}-${size}`, kind, size, url: v?.url || null });
  }
  if (!entries.length) return <p className="pe-muted">Variants are set, but none could be listed.</p>;
  return (
    <ul id="post-editor-variants-list" className="pe-list">
      {entries.map((e) => (
        <li key={e.id} id={`post-editor-variant-${e.id}`}>
          {e.kind} · {e.size}{e.url ? <> · <a href={e.url} target="_blank" rel="noopener noreferrer">open</a></> : null}
        </li>
      ))}
    </ul>
  );
}

function BoundFieldsPanel({ row, gate }) {
  const fields = boundFields(row);
  const shown = fields.filter((f) => f.present);
  const hidden = fields.filter((f) => !f.known);
  if (!shown.length && !hidden.length) return null;
  return (
    <section id="post-editor-locked-fields-panel" className="pe-panel" aria-label="Also locked in by approval">
      <p className="pe-kicker">Locked in by approval · read-only here</p>
      {shown.map((f) => (
        <div key={f.key} id={`post-editor-bound-${f.key}`} className="pe-bound">
          <span className="pe-bound-label">{f.label}</span>
          {f.key === 'selfReply' ? (
            <div className="pe-bound-body">
              <p className="pe-bound-text">{f.value.text || '(media only)'}</p>
              {f.value.mediaUrl ? <p className="pe-muted"><a href={f.value.mediaUrl} target="_blank" rel="noopener noreferrer">self-reply creative</a></p> : null}
            </div>
          ) : f.key === 'mediaVariants' ? (
            <div className="pe-bound-body"><VariantList variants={f.value} /></div>
          ) : f.key === 'replyTo' ? (
            <div className="pe-bound-body">
              {f.value.author ? <p className="pe-bound-text">@{String(f.value.author).replace(/^@/, '')}</p> : null}
              {f.value.text ? <p className="pe-bound-text">{f.value.text}</p> : null}
              {f.value.url ? <p className="pe-muted"><a href={f.value.url} target="_blank" rel="noopener noreferrer">{f.value.url}</a></p> : null}
            </div>
          ) : (
            <div className="pe-bound-body"><p className="pe-bound-text">{String(f.value)}</p></div>
          )}
        </div>
      ))}
      {hidden.length ? <p id="post-editor-hidden-fields-note" className="pe-note pe-note-warn" role="alert">{boundFieldsNotice(gate)}</p> : null}
    </section>
  );
}

function HiresPanel({ row, call, onUsed }) {
  const eligible = String(row.packageId || '').startsWith('nas-') && HIRES_STATUSES.has(row.status);
  const [info, setInfo] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    try { setInfo(await call('find-hires-media', { postId: row.id })); } catch { setInfo(null); }
  }, [call, row.id]);
  useEffect(() => { setInfo(null); setMsg(''); setErr(''); if (eligible) load(); }, [eligible, load]);
  const use = async (c) => {
    setBusyId(c.id); setErr(''); setMsg('');
    try {
      const r = await call('hires-media-use', { postId: row.id, packageId: info.target.id, candidateId: c.id });
      if (r?.status === 'done') { setMsg(`Swapped to the ${r.width && r.height ? `${r.width}×${r.height} ` : ''}original.`); if (onUsed) await onUsed(); } else setMsg(r?.note || 'Queued: the Mac worker is copying the original.');
      await load();
    } catch (e) { setErr(e?.message || 'Could not use that file.'); } finally { setBusyId(null); }
  };
  if (!eligible) return <p id="post-editor-hires-unavailable" className="pe-muted">High-res is only available for drive (NAS) pictures on an editable post.</p>;
  if (!info) return <p id="post-editor-hires-loading" className="pe-muted">Looking for bigger copies…</p>;
  if (!info.ok || !info.target?.isThumbnail || !info.candidates?.length) return <p id="post-editor-hires-none" className="pe-muted">No bigger copy found. The current picture is already the original.</p>;
  return (
    <div id="post-editor-hires-panel" className="pe-sub">
      <p className="pe-kicker">Picture is a thumbnail ({dimsOf(info.target)})</p>
      <ul id="post-editor-hires-list" className="pe-list pe-hires-list">
        {info.candidates.map((c) => (
          <li key={c.id} id={`post-editor-hires-${c.id}`} className="pe-hires-row">
            <MiniThumb id={c.thumbId || c.id} call={call} nasSha={c.nasSha || null} size={48} label={c.title || c.id} />
            <span className="pe-hires-text"><strong>{dimsOf(c)}</strong><span className="pe-muted">{(c.reasons || []).slice(0, 2).join(' · ')}</span><span className="pe-muted">{hiresState(c)}</span></span>
            <button type="button" className="pe-btn pe-btn-primary" disabled={busyId !== null} onClick={() => use(c)}>{busyId === c.id ? 'Working…' : c.staged ? 'Use this' : 'Copy and use'}</button>
          </li>
        ))}
      </ul>
      {info.nasWorker && info.nasWorker.online === false ? <p className="pe-note">The NAS worker is offline. Start it on the Mac: <code>{info.nasWorker.startCommand}</code></p> : null}
      {msg ? <p id="post-editor-hires-message" className="pe-muted" role="status">{msg}</p> : null}
      {info.download ? <p className="pe-muted"><a id="post-editor-hires-download" href={info.download} target="_blank" rel="noopener noreferrer">Open the original</a></p> : null}
      {err ? <p id="post-editor-hires-error" className="pe-note pe-note-bad" role="alert">{err}</p> : null}
    </div>
  );
}

export default function PostEditor({
  postId = null,
  row: rowProp = null,
  clientId = null,
  clientName = '',
  clientHandle = '',
  avatarUrl = '',
  getIdToken,
  timeZone,
  onClose,
  onSaved,
  onPickCreative,
  pickerSlot = null,
  onDirtyChange,
  loadRow,
  children = null,
}) {
  const tz = resolveTimeZone(timeZone);
  const { call, callSocial } = useMarketingContentCall(getIdToken);

  const [row, setRow] = useState(() => withState(rowProp));
  const [loadError, setLoadError] = useState('');
  const [content, setContent] = useState(rowProp?.content ?? rowProp?.text ?? '');
  const [when, setWhen] = useState(() => initialWhen(rowProp, tz));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { tone: 'ok'|'bad'|'info', text }
  const [conflict, setConflict] = useState(false);
  const [planBlock, setPlanBlock] = useState(null);
  const [override, setOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [morePanel, setMorePanel] = useState(null); // 'reconcile' | 'hires' | null
  const [platformId, setPlatformId] = useState('');
  const textRef = useRef(null);
  const moreRef = useRef(null);

  // Adopt a different row (host navigated to another post, or refreshed it). Edits reset only when the identity or revision moves.
  const rowKey = rowProp ? `${rowProp.id}:${rowProp.revision ?? ''}` : null;
  useEffect(() => {
    if (!rowProp) return;
    const r = withState(rowProp);
    setRow(r); setContent(r.content ?? r.text ?? ''); setWhen(initialWhen(r, tz));
    setConflict(false); setPlanBlock(null); setOverride(false); setOverrideReason(''); setMessage(null); setMorePanel(null); setMoreOpen(false);
  }, [rowKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchRow = useCallback(async (id) => {
    if (typeof loadRow === 'function') return withState(await loadRow(id));
    const res = await call('post-status', { postIds: [id] });
    const p = res?.posts?.[0];
    if (!p) throw new Error('That post could not be found.');
    return withState(p);
  }, [call, loadRow]);

  // postId-only mount: load the row.
  useEffect(() => {
    if (rowProp || !postId) return undefined;
    let live = true;
    fetchRow(postId).then((r) => {
      if (!live) return;
      setRow(r); setContent(r.content ?? ''); setWhen(initialWhen(r, tz)); setLoadError('');
    }).catch((e) => { if (live) setLoadError(e?.message || 'Could not load the post.'); });
    return () => { live = false; };
  }, [postId, rowProp, fetchRow, tz]);

  const suggestion = isSuggestion(row);
  const locked = isLockedRow(row);
  const dirty = useMemo(() => (row ? dirtyState({ row, content, when, tz }) : { dirty: false, contentDirty: false, timeDirty: false }), [row, content, when, tz]);
  const gate = useMemo(() => boundFieldsGate(row), [row]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const st = useMemo(() => actionState({ row, content, when, tz, now, busy, dirty }), [row, content, when, tz, now, busy, dirty]);
  const pill = statusPill(row);
  const scheduled = isScheduledStatus(row);
  const effectiveDirty = !!row && !locked && !suggestion ? dirty.dirty : (suggestion ? dirty.contentDirty : false);

  const dirtyRef = useRef(false);
  useEffect(() => {
    if (dirtyRef.current === effectiveDirty) return;
    dirtyRef.current = effectiveDirty;
    if (onDirtyChange) onDirtyChange(effectiveDirty);
  }, [effectiveDirty, onDirtyChange]);
  useEffect(() => () => { if (dirtyRef.current && onDirtyChange) onDirtyChange(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Close the More menu on outside click / Escape (Escape here must not also step the stage back).
  useEffect(() => {
    if (!moreOpen) return undefined;
    const onDown = (e) => { if (moreRef.current && !moreRef.current.contains(e.target)) setMoreOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setMoreOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [moreOpen]);

  const send = useCallback((req) => (req.endpoint === 'social' ? callSocial(req.body) : call(req.action, req.body)), [call, callSocial]);

  // Run one write. Success -> merge the server's version into the editor; failure -> keep the edit, explain.
  const run = useCallback(async (req, { onOk, successText } = {}) => {
    setBusy(true); setMessage(null); setConflict(false); setPlanBlock(null);
    const before = row;
    try {
      const res = await send(req);
      const next = mergeServerPost(suggestion ? {} : row, res);
      setRow(next);
      setContent(next.content ?? content);
      setWhen(initialWhen(next, tz));
      const voided = approvalVoided(before, next);
      if (voided && mediaChanged(before, next)) setMessage({ tone: 'info', text: MEDIA_CHANGED_MESSAGE });
      else if (successText) setMessage({ tone: 'ok', text: successText });
      if (onSaved) onSaved(next);
      if (onOk) await onOk(next, res);
      return next;
    } catch (e) {
      const c = classifyError(e);
      if (c.kind === 'conflict') setConflict(true);
      else if (c.kind === 'plan') setPlanBlock({ code: c.code, message: c.message });
      else setMessage({ tone: 'bad', text: c.message });
      return null;
    } finally {
      setBusy(false);
    }
  }, [row, send, suggestion, content, tz, onSaved]);

  const reload = async () => {
    if (!row?.id) return;
    setBusy(true);
    try {
      const fresh = await fetchRow(row.id);
      setRow(fresh); setContent(fresh.content ?? ''); setWhen(initialWhen(fresh, tz)); setConflict(false);
      setMessage({ tone: 'info', text: 'Reloaded the latest version.' });
      if (onSaved) onSaved(fresh);
    } catch (e) {
      setMessage({ tone: 'bad', text: e?.message || 'Could not reload.' });
    } finally { setBusy(false); }
  };

  const doSave = () => {
    if (!st.canSave) return;
    run(buildSaveRequest({ row, content, iso: st.iso, scheduledTimeChanged: scheduled && dirty.timeDirty }), { successText: 'Saved.' });
  };
  const doApprove = () => {
    if (!st.canApprove) return;
    if (suggestion) { run(buildSuggestionApproveRequest({ row, content }), { successText: 'Approved. Nothing is scheduled or posted.' }); return; }
    run(buildApproveRequest({ row, content }), { successText: 'Approved. Nothing is scheduled or posted.' });
  };
  const planOverride = override && overrideReason.trim() ? { confirm: true, reason: overrideReason.trim() } : null;
  const doApproveSchedule = () => {
    if (!st.canApproveSchedule || (override && !overrideReason.trim())) return;
    run(buildApproveScheduleRequest({ row, content, iso: st.iso, planOverride }), { successText: 'Approved and scheduled.' });
  };

  const items = row ? moreItems(row, { busy, hasCall: true }) : [];
  const doMore = (id) => {
    setMoreOpen(false);
    if (id === 'reject') run(buildRejectRequest(row), { successText: 'Rejected.', onOk: () => { if (onClose) onClose(); } });
    else if (id === 'unschedule') run(buildUnscheduleRequest(row), { successText: 'Unscheduled. It is a draft again.' });
    else if (id === 'unapprove') run(buildUnapproveRequest(row), { successText: 'Left unapproved. It is a draft again.' });
    else if (id === 'reconcile') setMorePanel((p) => (p === 'reconcile' ? null : 'reconcile'));
    else if (id === 'hires') setMorePanel((p) => (p === 'hires' ? null : 'hires'));
  };
  const doReconcile = (outcome) => run(buildReconcileRequest({ row, outcome, platformId }), { successText: outcome === 'posted' ? 'Marked posted.' : 'Marked not posted.', onOk: () => setMorePanel(null) });

  const afterHires = async () => {
    if (!row?.id) return;
    try {
      const fresh = await fetchRow(row.id);
      const merged = { ...row, ...fresh, selfReply: row.selfReply, mediaVariants: fresh.mediaVariants ?? row.mediaVariants, replyTo: row.replyTo };
      const voided = approvalVoided(row, merged);
      setRow(merged);
      setMessage({ tone: voided ? 'info' : 'ok', text: voided ? MEDIA_CHANGED_MESSAGE : 'Picture swapped.' });
      if (onSaved) onSaved(merged);
    } catch { /* the panel already told the operator */ }
  };

  const name = clientName || clientId || 'Your account';
  const handle = clientHandle ? `@${String(clientHandle).replace(/^@/, '')}` : '';
  const over = isOverLimit(content);
  const count = charCount(content);
  const quoteUrl = suggestion ? (row?.quotedUrl || row?.url || null) : null;

  if (!row) {
    return (
      <section id="post-editor-root" className="pe-root" aria-busy={!loadError}>
        <PostEditorStyles />
        <p id="post-editor-loading" className="pe-muted" role={loadError ? 'alert' : 'status'}>{loadError || 'Loading post…'}</p>
      </section>
    );
  }

  return (
    <section id="post-editor-root" className="pe-root" aria-label="View and edit post">
      <PostEditorStyles />

      <header id="post-editor-status-row" className="pe-status-row">
        <span id="post-editor-status-pill" className={`pe-pill pe-pill-${pill.key}`}>{pill.label}</span>
        {row.proposed ? <span className="pe-muted">Proposed slot</span> : null}
        {row.fillKind ? <span className="pe-muted">{row.fillKind}</span> : null}
      </header>

      <article id="post-editor-card" className="pe-card">
        <div id="post-editor-card-author-row" className="pe-author">
          <span id="post-editor-card-avatar" className="pe-avatar" aria-hidden="true">
            {avatarUrl ? <img src={avatarUrl} alt="" /> : String(name).trim().charAt(0).toUpperCase()}
          </span>
          <span id="post-editor-card-author" className="pe-author-text">
            <strong>{name}</strong>
            {handle ? <span className="pe-muted">{handle}</span> : null}
          </span>
        </div>

        <label htmlFor="post-editor-text" className="pe-visually-hidden">Post text</label>
        <textarea
          id="post-editor-text"
          ref={textRef}
          className="pe-text"
          value={content}
          readOnly={locked}
          rows={Math.min(14, Math.max(4, content.split('\n').length + 2))}
          onChange={(e) => { setContent(e.target.value); if (message?.tone === 'ok') setMessage(null); }}
          aria-describedby="post-editor-count"
          aria-invalid={over || undefined}
        />
        <p id="post-editor-count-row" className="pe-count-row">
          <span id="post-editor-count" className={over ? 'pe-over' : 'pe-muted'}>{count} / {MAX_CHARS}</span>
          {locked ? <span className="pe-muted">Locked: this post can't be edited here.</span> : null}
        </p>

        {quoteUrl ? (
          <div id="post-editor-quote-target" className="pe-quote">
            <span className="pe-kicker">Quoting</span>
            <a href={quoteUrl} target="_blank" rel="noopener noreferrer">{quoteUrl}</a>
          </div>
        ) : null}

        <div id="post-editor-creative-shell" className="pe-creative">
          <MediaBlock row={row} />
          {!suggestion && !locked ? (
            <div id="post-editor-creative-actions" className="pe-creative-actions">
              <button
                type="button"
                id="post-editor-pick-creative"
                className="pe-btn pe-btn-ghost"
                disabled={busy || typeof onPickCreative !== 'function'}
                onClick={() => onPickCreative && onPickCreative()}
              >
                <ImagePlus size={15} aria-hidden="true" />
                {row.mediaUrl || row.thumbUrl ? 'Change creative' : 'Add creative'}
              </button>
            </div>
          ) : null}
          {pickerSlot ? <div id="post-editor-picker-slot" className="pe-picker-slot">{pickerSlot}</div> : null}
        </div>
      </article>

      <BoundFieldsPanel row={row} gate={gate} />

      {!suggestion && !locked ? (
        <section id="post-editor-when-panel" className="pe-panel" aria-label="Publish time">
          <p className="pe-kicker">Publish time · {zoneLabel(tz)} ({tz.replace(/_/g, ' ')})</p>
          <div id="post-editor-when-row" className="pe-when-row">
            <input id="post-editor-date" type="date" className="pe-input" value={when.date} aria-label={`Date (${tz})`} onChange={(e) => setWhen((w) => ({ ...w, date: e.target.value }))} />
            <input id="post-editor-time" type="time" step={300} className="pe-input" value={when.time} aria-label={`Time (${tz})`} onChange={(e) => setWhen((w) => ({ ...w, time: e.target.value }))} />
          </div>
          {whenToIso(when, tz) && !st.isFuture ? <p id="post-editor-when-hint" className="pe-note pe-note-warn">Pick a time at least a minute from now to schedule.</p> : null}
        </section>
      ) : null}

      {children}

      {row.needsStory ? <p id="post-editor-needs-story" className="pe-note">This draft still has a story placeholder. Approving removes that line; add your own first if you want one.</p> : null}
      {row.state === 'held' ? (
        <div id="post-editor-held-panel" className="pe-note pe-note-warn">
          <p>Held for review: {row.heldReason || 'Held for review.'}</p>
          <p className="pe-muted">{row.heldNext || 'Review it, then reject it or reconcile it from More.'}</p>
          {row.error ? <p className="pe-muted">{row.error}</p> : null}
        </div>
      ) : null}
      {row.state === 'failed' ? <p id="post-editor-failed-note" className="pe-note pe-note-bad">{row.error || 'Publishing failed.'} Failed posts are not retried automatically.</p> : null}

      {conflict ? (
        <div id="post-editor-conflict" className="pe-note pe-note-warn" role="alert">
          <p>This post changed while you were editing. Your edit is kept.</p>
          <button type="button" id="post-editor-reload" className="pe-btn pe-btn-ghost" disabled={busy} onClick={reload}>Reload</button>
        </div>
      ) : null}

      {planBlock ? (
        <div id="post-editor-plan-override" className="pe-note pe-note-warn">
          <p>{planBlock.message || `The plan blocks this post (${planBlock.code}).`}</p>
          <label htmlFor="post-editor-override-check" className="pe-check">
            <input id="post-editor-override-check" type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
            Override plan <span className="pe-muted">Owner override, recorded on the post</span>
          </label>
          {override ? <input id="post-editor-override-reason" type="text" className="pe-input" value={overrideReason} placeholder="Reason (required)" aria-label="Override reason (required)" onChange={(e) => setOverrideReason(e.target.value)} /> : null}
        </div>
      ) : null}

      {message ? <p id="post-editor-message" className={`pe-note pe-note-${message.tone}`} role={message.tone === 'bad' ? 'alert' : 'status'}>{message.text}</p> : null}
      {morePanel === 'reconcile' ? (
        <section id="post-editor-reconcile-panel" className="pe-panel" aria-label="Reconcile">
          <label htmlFor="post-editor-platform-id" className="pe-kicker">X post ID (if it is live)</label>
          <input id="post-editor-platform-id" type="text" className="pe-input" value={platformId} placeholder="optional" onChange={(e) => setPlatformId(e.target.value)} />
          <div id="post-editor-reconcile-actions" className="pe-btn-row">
            <button type="button" id="post-editor-reconcile-not-posted" className="pe-btn pe-btn-ghost" disabled={busy} onClick={() => doReconcile('not_posted')}>Mark not posted</button>
            <button type="button" id="post-editor-reconcile-posted" className="pe-btn pe-btn-primary" disabled={busy} onClick={() => doReconcile('posted')}>Mark posted</button>
          </div>
        </section>
      ) : null}
      {morePanel === 'hires' ? (
        <section id="post-editor-hires-section" className="pe-panel" aria-label="High-res picture">
          <HiresPanel row={row} call={call} onUsed={afterHires} />
        </section>
      ) : null}

      <footer id="post-editor-footer" className="pe-footer">
        <div id="post-editor-footer-actions" className="pe-btn-row">
          {!suggestion ? (
            <button type="button" id="post-editor-save" className="pe-btn pe-btn-ghost" disabled={!st.canSave} onClick={doSave}>{busy ? 'Working…' : 'Save'}</button>
          ) : null}
          <button type="button" id="post-editor-approve" className="pe-btn pe-btn-primary" disabled={!st.canApprove} onClick={doApprove} title="Approve without scheduling" aria-describedby="post-editor-footer-hint">
            {busy ? 'Working…' : 'Approve'}
          </button>
          {!suggestion ? (
            <button type="button" id="post-editor-approve-schedule" className="pe-btn pe-btn-primary" disabled={!st.canApproveSchedule || (override && !overrideReason.trim())} onClick={doApproveSchedule} title={st.scheduleBlockedReason || 'Approve and schedule at the time above'}>
              Approve &amp; schedule
            </button>
          ) : null}
          {items.length ? (
            <div id="post-editor-more" className="pe-more" ref={moreRef}>
              <button type="button" id="post-editor-more-button" className="pe-btn pe-btn-ghost" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
                More <ChevronDown size={14} aria-hidden="true" />
              </button>
              {moreOpen ? (
                <ul id="post-editor-more-menu" className="pe-menu" role="menu">
                  {items.map((it) => (
                    <li key={it.id} role="none">
                      <button type="button" role="menuitem" id={`post-editor-more-${it.id}`} className="pe-menu-item" disabled={!it.enabled} onClick={() => doMore(it.id)}>{it.label}</button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
        <p id="post-editor-footer-hint" className="pe-muted">
          {st.canApprove
            ? (suggestion ? 'Saves this as a draft and approves it. Nothing is scheduled or posted.' : 'Approve needs no time. Approve & schedule posts at the time above.')
            : st.approveBlockedReason}
          {st.canApprove && !st.canApproveSchedule && !suggestion && st.scheduleBlockedReason ? ` ${st.scheduleBlockedReason}` : ''}
        </p>
      </footer>
    </section>
  );
}

function PostEditorStyles() {
  return (
    <style jsx global>{`
      #post-editor-root { display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 640px; margin: 0 auto; color: var(--t-text); box-sizing: border-box; }
      #post-editor-root * { box-sizing: border-box; }
      #post-editor-root .pe-muted { margin: 0; font-size: 12px; line-height: 1.4; color: var(--t-text-muted); }
      #post-editor-root .pe-kicker { margin: 0 0 6px; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--t-text-muted); }
      #post-editor-root .pe-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
      #post-editor-root a { color: var(--t-info); }
      #post-editor-root .pe-status-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      #post-editor-root .pe-pill { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--t-control-border); font-size: 12px; font-weight: 700; background: var(--t-inset); }
      #post-editor-root .pe-pill-approved { background: var(--t-info-bg); border-color: var(--t-info-border); }
      #post-editor-root .pe-pill-scheduled, #post-editor-root .pe-pill-posted { background: var(--t-success-bg); border-color: var(--t-success-border); }
      #post-editor-root .pe-pill-needs-review, #post-editor-root .pe-pill-failed { background: var(--t-danger-bg); border-color: var(--t-danger-border); }
      #post-editor-root .pe-card { border: 1px solid var(--t-control-border); border-radius: 16px; background: var(--t-raised); padding: 14px; display: flex; flex-direction: column; gap: 10px; }
      #post-editor-root .pe-author { display: flex; align-items: center; gap: 10px; }
      #post-editor-root .pe-avatar { width: 40px; height: 40px; border-radius: 999px; overflow: hidden; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; background: var(--t-accent); color: var(--t-on-accent); font-weight: 700; }
      #post-editor-root .pe-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
      #post-editor-root .pe-author-text { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; }
      #post-editor-root .pe-text { width: 100%; resize: vertical; border: 0; outline: none; background: transparent; color: var(--t-text); font: inherit; font-size: 17px; line-height: 1.4; padding: 4px 0; min-height: 96px; }
      #post-editor-root .pe-text:focus-visible { outline: 2px solid var(--t-focus); outline-offset: 4px; border-radius: 6px; }
      #post-editor-root .pe-text[readonly] { opacity: 0.8; }
      #post-editor-root .pe-count-row { display: flex; justify-content: space-between; gap: 8px; margin: 0; font-size: 12px; }
      #post-editor-root .pe-over { color: var(--t-danger); font-weight: 700; }
      #post-editor-root .pe-quote { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border: 1px solid var(--t-border-subtle); border-radius: 12px; font-size: 13px; overflow-wrap: anywhere; }
      #post-editor-root .pe-creative { display: flex; flex-direction: column; gap: 8px; }
      #post-editor-root .pe-media { border-radius: 14px; overflow: hidden; border: 1px solid var(--t-border-subtle); background: var(--t-inset); }
      #post-editor-root .pe-media img, #post-editor-root .pe-media video { display: block; width: 100%; max-height: 420px; object-fit: contain; }
      #post-editor-root .pe-creative-actions { display: flex; gap: 8px; }
      #post-editor-root .pe-picker-slot { border-top: 1px solid var(--t-border-subtle); padding-top: 10px; }
      #post-editor-root .pe-panel { border: 1px solid var(--t-border-subtle); border-radius: 12px; padding: 10px 12px; background: var(--t-inset); }
      #post-editor-root .pe-bound { display: flex; gap: 10px; padding: 6px 0; border-top: 1px solid var(--t-border-faint); }
      #post-editor-root .pe-bound:first-of-type { border-top: 0; }
      #post-editor-root .pe-bound-label { flex: 0 0 120px; font-size: 12px; font-weight: 700; }
      #post-editor-root .pe-bound-body { min-width: 0; flex: 1 1 auto; overflow-wrap: anywhere; }
      #post-editor-root .pe-bound-text { margin: 0; font-size: 14px; line-height: 1.4; white-space: pre-wrap; }
      #post-editor-root .pe-list { list-style: none; margin: 0; padding: 0; font-size: 13px; }
      #post-editor-root .pe-when-row { display: flex; gap: 8px; flex-wrap: wrap; }
      #post-editor-root .pe-input { min-height: 40px; padding: 6px 10px; border-radius: 10px; border: 1px solid var(--t-control-border); background: var(--t-raised); color: var(--t-text); font: inherit; }
      #post-editor-root .pe-input:focus-visible { outline: 2px solid var(--t-focus); outline-offset: 2px; }
      #post-editor-root .pe-note { margin: 0; padding: 8px 12px; border-radius: 10px; font-size: 13px; line-height: 1.4; border: 1px solid var(--t-border-subtle); background: var(--t-inset); }
      #post-editor-root .pe-note p { margin: 0 0 6px; }
      #post-editor-root .pe-note-ok { background: var(--t-success-bg); border-color: var(--t-success-border); }
      #post-editor-root .pe-note-info { background: var(--t-info-bg); border-color: var(--t-info-border); }
      #post-editor-root .pe-note-warn { background: var(--t-info-bg); border-color: var(--t-info-border); }
      #post-editor-root .pe-note-bad { background: var(--t-danger-bg); border-color: var(--t-danger-border); color: var(--t-danger); }
      #post-editor-root .pe-check { display: flex; align-items: center; gap: 8px; font-size: 13px; margin: 6px 0; }
      #post-editor-root .pe-footer { display: flex; flex-direction: column; gap: 8px; position: sticky; bottom: 0; padding: 10px 0; background: var(--t-glass-soft); }
      #post-editor-root .pe-btn-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      #post-editor-root .pe-btn { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 8px 16px; border-radius: 999px; font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; border: 1px solid var(--t-control-border); }
      #post-editor-root .pe-btn-ghost { background: transparent; color: var(--t-text); }
      #post-editor-root .pe-btn-primary { background: var(--t-accent); color: var(--t-on-accent); border-color: var(--t-accent); }
      #post-editor-root .pe-btn:disabled { opacity: 0.45; cursor: not-allowed; background: var(--t-disabled-bg); color: var(--t-text-muted); border-color: var(--t-control-border); }
      #post-editor-root .pe-btn:focus-visible, #post-editor-root .pe-menu-item:focus-visible { outline: 2px solid var(--t-focus); outline-offset: 2px; }
      #post-editor-root .pe-more { position: relative; }
      #post-editor-root .pe-menu { position: absolute; bottom: calc(100% + 6px); left: 0; z-index: 5; min-width: 190px; margin: 0; padding: 6px; list-style: none; border: 1px solid var(--t-control-border); border-radius: 12px; background: var(--t-raised); box-shadow: var(--t-shadow-md); }
      #post-editor-root .pe-menu-item { display: block; width: 100%; text-align: left; padding: 8px 10px; border: 0; border-radius: 8px; background: transparent; color: var(--t-text); font: inherit; font-size: 14px; cursor: pointer; }
      #post-editor-root .pe-menu-item:hover:not(:disabled) { background: var(--t-inset); }
      #post-editor-root .pe-menu-item:disabled { color: var(--t-dash-text-disabled); cursor: not-allowed; }
      #post-editor-root .pe-hires-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--t-border-faint); }
      #post-editor-root .pe-hires-text { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; }
      @media (max-width: 480px) {
        #post-editor-root { max-width: none; padding: 0 var(--mobile-gutter, 8px); }
        #post-editor-root .pe-card { padding: 12px var(--mobile-gutter, 8px); border-radius: 12px; }
        #post-editor-root .pe-bound { flex-direction: column; gap: 2px; }
        #post-editor-root .pe-bound-label { flex-basis: auto; }
        #post-editor-root .pe-btn-row .pe-btn { flex: 1 1 auto; justify-content: center; }
      }
      @media (prefers-reduced-motion: reduce) { #post-editor-root * { transition: none !important; animation: none !important; } }
    `}</style>
  );
}
