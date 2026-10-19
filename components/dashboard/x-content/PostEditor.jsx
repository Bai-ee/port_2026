'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LoadingRing from '../content-ui/ui/LoadingRing';
import { ChevronDown, ImagePlus } from 'lucide-react';
import { useMarketingContentCall } from '../marketing/useMarketingContentCall.js';
import MiniThumb from './MiniThumb.jsx';
import QuotedTweetCard from './QuotedTweetCard.jsx';
import {
  MAX_CHARS, MEDIA_CHANGED_MESSAGE, charCount, isOverLimit, initialWhen, zoneLabel, resolveTimeZone,
  isSuggestion, isLockedRow, boundFields, boundFieldsGate, boundFieldsNotice, dirtyState, actionState, isScheduledStatus,
  buildSaveRequest, buildApproveRequest, buildApproveScheduleRequest, buildSuggestionApproveRequest, buildUnapproveRequest,
  buildRejectRequest, buildUnscheduleRequest, buildReconcileRequest, moreItems,
  decideItems, buildDecideRequest, decideResultText, DECISION_LABEL, DELETE_CONFIRM_TEXT, classifyError, approvalVoided, mediaChanged, mergeServerPost,
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
  // The quoted post is shown by the quoted card above (QuotedTweetCard), so it is not repeated here.
  const shown = fields.filter((f) => f.present && f.key !== 'quote');
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
  if (!info) return <LoadingRing id="post-editor-hires-loading" label="Looking for bigger copies" size={24} minHeight={64} />;
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
  onDecided,
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
  const [deleteAsk, setDeleteAsk] = useState(false);
  const [deciding, setDeciding] = useState(null); // 'pass' | 'replace' | 'delete' while a decide call runs
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

  // Post = publish now through the normal lifecycle, never a separate row: after an inline confirm it approves and
  // schedules this post ~75 s out (the server needs >= 60 s), shows a countdown with Cancel, then asks the publisher to
  // send due posts. If the editor closes mid-countdown, the regular publisher (every 15 min) still sends it.
  const name = clientName || clientId || 'Your account';
  const handle = clientHandle ? `@${String(clientHandle).replace(/^@/, '')}` : '';
  const POST_LEAD_MS = 75_000;
  const [postStep, setPostStep] = useState(null); // null | 'confirm' | { at: ms }
  const [nowMs, setNowMs] = useState(() => Date.now());
  const posting = postStep && typeof postStep === 'object';
  useEffect(() => {
    if (!posting) return undefined;
    const t = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(t);
  }, [posting]);
  useEffect(() => {
    if (!posting || nowMs < postStep.at) return;
    setPostStep(null);
    (async () => {
      setBusy(true);
      try {
        await send({ endpoint: 'social', body: { action: 'process-due' } });
        const fresh = row?.id ? await fetchRow(row.id) : null;
        if (fresh) { setRow((r) => ({ ...r, ...fresh })); if (onSaved) onSaved(fresh); }
        const live = fresh && (fresh.status === 'posted' || fresh.state === 'posted');
        setMessage(live
          ? { tone: 'ok', text: `Posted to ${handle || 'X'}.` }
          : { tone: 'info', text: fresh?.heldReason || fresh?.error || 'Sent to the publisher. It will go out within 15 minutes if it was not sent yet.' });
      } catch (e) {
        setMessage({ tone: 'info', text: `${e?.message || 'Could not reach the publisher.'} It is scheduled and will go out within 15 minutes.` });
      } finally { setBusy(false); }
    })();
  }, [posting, nowMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const canPost = !suggestion && st.canApprove && !(override && !overrideReason.trim());
  const doPostConfirmed = () => {
    if (!canPost) return;
    const at = Date.now() + POST_LEAD_MS;
    run(buildApproveScheduleRequest({ row, content, iso: new Date(at).toISOString(), planOverride }), {
      onOk: () => { setNowMs(Date.now()); setPostStep({ at }); },
    }).then((ok) => { if (!ok) setPostStep(null); });
  };
  const cancelPost = () => {
    setPostStep(null);
    run(buildUnscheduleRequest(row), { successText: 'Cancelled. Nothing was posted.' });
  };
  const secondsLeft = posting ? Math.max(0, Math.ceil((postStep.at - nowMs) / 1000)) : 0;

  // Save lives in More (the row is Approve · Schedule · Post · More).
  const items = row ? [
    ...(!suggestion ? [{ id: 'save', label: 'Save changes', enabled: st.canSave }] : []),
    ...moreItems(row, { busy, hasCall: true }),
  ] : [];
  const doMore = (id) => {
    setMoreOpen(false);
    if (id === 'save') doSave();
    else if (id === 'reject') run(buildRejectRequest(row), { successText: 'Rejected.', onOk: () => { if (onClose) onClose(); } });
    else if (id === 'unschedule') run(buildUnscheduleRequest(row), { successText: 'Unscheduled. It is a draft again.' });
    else if (id === 'unapprove') run(buildUnapproveRequest(row), { successText: 'Left unapproved. It is a draft again.' });
    else if (id === 'reconcile') setMorePanel((p) => (p === 'reconcile' ? null : 'reconcile'));
    else if (id === 'hires') setMorePanel((p) => (p === 'hires' ? null : 'hires'));
  };
  // Pass / Replace / Delete: one call, the item leaves this day. The host moves on via onDecided (else onClose).
  const doDecide = async (decision) => {
    if (!row) return;
    setDeleteAsk(false); setDeciding(decision); setBusy(true); setMessage(null); setConflict(false);
    try {
      const result = await send(buildDecideRequest(row, decision));
      setMessage({ tone: 'ok', text: decideResultText(decision, result) });
      if (onDecided) onDecided({ decision, result, row });
      else if (onClose) onClose();
    } catch (e) {
      const c = classifyError(e);
      if (c.kind === 'conflict') setConflict(true);
      else setMessage({ tone: 'bad', text: e?.code === 'not-removable' || e?.data?.code === 'not-removable' ? 'This one already went out, so it cannot be removed.' : c.message });
    } finally {
      setBusy(false); setDeciding(null);
    }
  };
  const decide = row ? decideItems(row, { busy: busy || !!postStep }) : { pass: false, replace: false, delete: false };

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

  const over = isOverLimit(content);
  const count = charCount(content);

  if (!row) {
    return (
      <section id="post-editor-root" className="pe-root" aria-busy={!loadError}>
        <PostEditorStyles />
        {loadError ? <p id="post-editor-loading" className="pe-muted" role="alert">{loadError}</p> : <LoadingRing id="post-editor-loading" label="Loading post" />}
      </section>
    );
  }

  return (
    <section id="post-editor-root" className="pe-root" aria-label="View and edit post">
      <PostEditorStyles />

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

        <QuotedTweetCard row={row} call={call} timeZone={tz} />

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
              <div id="post-editor-when-row" className="pe-when-row" role="group" aria-label={`Publish time (${zoneLabel(tz)})`} title={`Publish time · ${zoneLabel(tz)} (${tz.replace(/_/g, ' ')})`}>
                <input id="post-editor-date" type="date" className="pe-input pe-input-compact" value={when.date} aria-label={`Publish date (${tz})`} onChange={(e) => setWhen((w) => ({ ...w, date: e.target.value }))} />
                <input id="post-editor-time" type="time" step={300} className="pe-input pe-input-compact" value={when.time} aria-label={`Publish time (${tz})`} onChange={(e) => setWhen((w) => ({ ...w, time: e.target.value }))} />
              </div>
            </div>
          ) : null}
          {pickerSlot ? <div id="post-editor-picker-slot" className="pe-picker-slot">{pickerSlot}</div> : null}
        </div>
        {row.needsStory ? <p id="post-editor-needs-story" className="pe-muted pe-card-note">This draft still has a story placeholder. Approving removes that line; add your own first if you want one.</p> : null}
        <footer id="post-editor-footer" className="pe-footer">
          <div id="post-editor-footer-actions" className="pe-btn-row">
            <button type="button" id="post-editor-approve" className="pe-btn pe-btn-primary cta-pill-btn" disabled={!st.canApprove || !!postStep} onClick={doApprove} title={st.canApprove ? 'Approve without scheduling' : st.approveBlockedReason}>
              {busy ? 'Working…' : 'Approve'}
            </button>
            {!suggestion ? (
              <button type="button" id="post-editor-approve-schedule" className="pe-btn pe-btn-ghost" disabled={!st.canApproveSchedule || (override && !overrideReason.trim()) || !!postStep} onClick={doApproveSchedule} title={st.scheduleBlockedReason || 'Approve and schedule at the time above'}>
                Schedule
              </button>
            ) : null}
            {!suggestion ? (
              <button type="button" id="post-editor-post-now" className="pe-btn pe-btn-primary" disabled={!canPost || busy || !!postStep} onClick={() => setPostStep('confirm')} title={canPost ? `Post to ${handle || 'X'} now` : st.approveBlockedReason}>
                Post
              </button>
            ) : null}
            {items.length ? (
              <div id="post-editor-more" className="pe-more" ref={moreRef}>
                <button type="button" id="post-editor-more-button" className="pe-btn pe-btn-plain" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
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
          {row && (decide.pass || decide.replace || decide.delete || deciding) ? (
            <div id="post-editor-decide-row" className="pe-decide-row">
              <button type="button" id="post-editor-pass-btn" className="pe-btn pe-btn-plain pe-btn-small" disabled={!decide.pass} onClick={() => doDecide('pass')} title="Take it off the calendar. It can come back later.">{deciding === 'pass' ? <span className="brief-loader-spinner" aria-hidden="true" /> : null}{DECISION_LABEL.pass}</button>
              {!suggestion ? (
                <button type="button" id="post-editor-replace-btn" className="pe-btn pe-btn-plain pe-btn-small" disabled={!decide.replace} onClick={() => doDecide('replace')} title="Take it off and put the next best item for this track on the same day.">{deciding === 'replace' ? <span className="brief-loader-spinner" aria-hidden="true" /> : null}{DECISION_LABEL.replace}</button>
              ) : null}
              <button type="button" id="post-editor-delete-btn" className="pe-btn pe-btn-plain pe-btn-small" disabled={!decide.delete || deleteAsk} onClick={() => setDeleteAsk(true)} title="Take it off and never suggest this content again.">{deciding === 'delete' ? <span className="brief-loader-spinner" aria-hidden="true" /> : null}{DECISION_LABEL.delete}</button>
            </div>
          ) : null}
          {deleteAsk ? (
            <div id="post-editor-delete-confirm" className="pe-note pe-note-warn" role="alertdialog" aria-label="Delete for good">
              <p>{DELETE_CONFIRM_TEXT}</p>
              <div className="pe-btn-row">
                <button type="button" id="post-editor-delete-confirm-btn" className="pe-btn pe-btn-plain pe-btn-small" disabled={busy} onClick={() => doDecide('delete')}>Confirm</button>
                <button type="button" id="post-editor-delete-cancel-btn" className="pe-btn pe-btn-plain pe-btn-small" disabled={busy} onClick={() => setDeleteAsk(false)}>Cancel</button>
              </div>
            </div>
          ) : null}
          {postStep === 'confirm' ? (
            <div id="post-editor-post-confirm-row" className="pe-post-confirm" role="alert">
              <p className="pe-post-confirm-text">Post to {handle || 'X'} now? This is one live X API write and can&apos;t be undone.</p>
              <div className="pe-btn-row">
                <button type="button" id="post-editor-post-cancel" className="pe-btn pe-btn-plain" onClick={() => setPostStep(null)}>Cancel</button>
                <button type="button" id="post-editor-post-confirm" className="pe-btn pe-btn-primary" disabled={busy} onClick={doPostConfirmed}>Confirm and post</button>
              </div>
            </div>
          ) : null}
          {posting ? (
            <div id="post-editor-post-countdown-row" className="pe-post-confirm" role="status">
              <p className="pe-post-confirm-text">Posting to {handle || 'X'} in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}. Closing this still posts it.</p>
              <div className="pe-btn-row">
                <button type="button" id="post-editor-post-countdown-cancel" className="pe-btn pe-btn-plain" disabled={busy} onClick={cancelPost}>Cancel</button>
              </div>
            </div>
          ) : null}
          {!st.canApprove && st.approveBlockedReason ? <p id="post-editor-footer-hint" className="pe-muted">{st.approveBlockedReason}</p> : null}
        </footer>
      </article>

      <BoundFieldsPanel row={row} gate={gate} />

      {children}

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
      #post-editor-root .pe-quote-shell { display: flex; flex-direction: column; gap: 8px; }
      #post-editor-root .pe-quote-toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      #post-editor-root .pe-quote-toggle-row .pe-kicker { margin: 0; }
      #post-editor-root .pe-quote-toggle { min-height: 32px; padding: 4px 12px; border-radius: 999px; border: 1px solid var(--t-border-faint); background: transparent; color: var(--t-text-secondary); font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
      #post-editor-root .pe-quote-toggle[aria-checked="true"] { color: var(--t-text-strong); border-color: var(--t-control-border-strong); background: var(--t-inset); }
      #post-editor-root .pe-quote-toggle:focus-visible { outline: 2px solid var(--t-focus); outline-offset: 2px; }
      #post-editor-root .pe-quoted-card { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px solid var(--t-border-subtle); border-radius: 14px; background: var(--t-inset); overflow-wrap: anywhere; }
      #post-editor-root .pe-quoted-header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; font-size: 14px; }
      #post-editor-root .pe-quoted-text { margin: 0; font-size: 14px; line-height: 1.4; white-space: pre-wrap; }
      #post-editor-root .pe-quoted-media { display: block; width: 100%; max-height: 240px; object-fit: cover; border-radius: 10px; border: 1px solid var(--t-border-subtle); }
      #post-editor-root .pe-quoted-open, #post-editor-root .pe-quote-target { font-size: 12px; overflow-wrap: anywhere; }
      #post-editor-root .pe-creative { display: flex; flex-direction: column; gap: 8px; }
      #post-editor-root .pe-media { border-radius: 14px; overflow: hidden; border: 1px solid var(--t-border-subtle); background: var(--t-inset); }
      #post-editor-root .pe-media img, #post-editor-root .pe-media video { display: block; width: 100%; max-height: 420px; object-fit: contain; }
      #post-editor-root .pe-creative-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
      #post-editor-root .pe-card-note { padding-top: 8px; border-top: 1px solid var(--t-border-faint); }
      #post-editor-root .pe-picker-slot { border-top: 1px solid var(--t-border-subtle); padding-top: 10px; }
      #post-editor-root .pe-panel { border: 1px solid var(--t-border-subtle); border-radius: 12px; padding: 10px 12px; background: var(--t-inset); }
      #post-editor-root .pe-bound { display: flex; gap: 10px; padding: 6px 0; border-top: 1px solid var(--t-border-faint); }
      #post-editor-root .pe-bound:first-of-type { border-top: 0; }
      #post-editor-root .pe-bound-label { flex: 0 0 120px; font-size: 12px; font-weight: 700; }
      #post-editor-root .pe-bound-body { min-width: 0; flex: 1 1 auto; overflow-wrap: anywhere; }
      #post-editor-root .pe-bound-text { margin: 0; font-size: 14px; line-height: 1.4; white-space: pre-wrap; }
      #post-editor-root .pe-list { list-style: none; margin: 0; padding: 0; font-size: 13px; }
      #post-editor-root .pe-when-row { display: flex; gap: 6px; flex-wrap: nowrap; }
      #post-editor-root .pe-input-compact { min-height: 36px; padding: 4px 8px; font-size: 13px; }
      #post-editor-root .pe-input { min-height: 40px; padding: 6px 10px; border-radius: 10px; border: 1px solid var(--t-control-border); background: var(--t-raised); color: var(--t-text); font: inherit; }
      #post-editor-root .pe-input:focus-visible { outline: 2px solid var(--t-focus); outline-offset: 2px; }
      #post-editor-root .pe-note { margin: 0; padding: 8px 12px; border-radius: 10px; font-size: 13px; line-height: 1.4; border: 1px solid var(--t-border-subtle); background: var(--t-inset); }
      #post-editor-root .pe-note p { margin: 0 0 6px; }
      #post-editor-root .pe-note-ok { background: var(--t-success-bg); border-color: var(--t-success-border); }
      #post-editor-root .pe-note-info { background: var(--t-info-bg); border-color: var(--t-info-border); }
      #post-editor-root .pe-note-warn { background: var(--t-info-bg); border-color: var(--t-info-border); }
      #post-editor-root .pe-note-bad { background: var(--t-danger-bg); border-color: var(--t-danger-border); color: var(--t-danger); }
      #post-editor-root .pe-check { display: flex; align-items: center; gap: 8px; font-size: 13px; margin: 6px 0; }
      /* Actions sit inside the card, under the text; each button shares the card width equally. */
      #post-editor-root .pe-footer { display: flex; flex-direction: column; align-items: stretch; gap: 8px; padding-top: 10px; border-top: 1px solid var(--t-border-faint); text-align: center; }
      /* Approve = gradient fill + the homepage comet border (.cta-pill-btn); Save/Schedule = static gradient border;
         More = plain and compact, pinned right. */
      #post-editor-root #post-editor-footer-actions { flex-wrap: nowrap; width: 100%; }
      #post-editor-root #post-editor-footer-actions > .pe-btn { flex: 1 1 0; min-width: 0; }
      #post-editor-root #post-editor-footer-actions > .pe-more { flex: 0 0 auto; }
      #post-editor-root .pe-post-confirm { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 10px 12px; border: 1px solid var(--t-warning-border); border-radius: 12px; background: var(--t-inset); }
      #post-editor-root .pe-post-confirm-text { margin: 0; font-size: 13px; line-height: 1.4; }
      #post-editor-root .pe-post-confirm .pe-btn { width: auto; flex: 0 0 auto; }
      #post-editor-root .pe-btn-plain { background: transparent; color: var(--t-text-secondary); border-color: var(--t-border-faint); padding: 8px 12px; }
      #post-editor-root .pe-btn-plain:hover:not(:disabled) { color: var(--t-text-strong); border-color: var(--t-control-border-strong); }
      #post-editor-root #post-editor-footer-actions .pe-btn { justify-content: center; width: 100%; white-space: nowrap; }
      #post-editor-root .pe-btn-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: center; }
      #post-editor-root .pe-btn { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 8px 16px; border-radius: 999px; font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; border: 1px solid var(--t-control-border); }
      /* Standard gradient buttons (same as the Queue & Calendar card): primary = full gradient fill, secondary = static
         gradient border. The mask only reads alpha, so a token stands in for #fff. */
      #post-editor-root .pe-btn-ghost { position: relative; isolation: isolate; background: var(--t-surface); color: var(--t-text-strong); border-color: transparent; }
      #post-editor-root .pe-btn-ghost::before { content: ''; position: absolute; inset: 0; z-index: -1; border-radius: inherit; padding: 1px; pointer-events: none; background: linear-gradient(180deg, var(--t-accent-bright) 0%, var(--t-support-1) 52%, var(--t-support-2) 100%); -webkit-mask: linear-gradient(var(--t-text) 0 0) content-box, linear-gradient(var(--t-text) 0 0); -webkit-mask-composite: xor; mask: linear-gradient(var(--t-text) 0 0) content-box, linear-gradient(var(--t-text) 0 0); mask-composite: exclude; }
      #post-editor-root .pe-btn-primary { background: linear-gradient(135deg, var(--t-accent-bright) 0%, var(--t-support-1) 52%, var(--t-support-2) 100%); color: var(--t-on-solid); border-color: transparent; }
      #post-editor-root .pe-btn:disabled::before { display: none; }
      #post-editor-root .pe-btn:disabled { opacity: 0.45; cursor: not-allowed; background: var(--t-disabled-bg); color: var(--t-text-muted); border-color: var(--t-control-border); }
      #post-editor-root .pe-btn:focus-visible, #post-editor-root .pe-menu-item:focus-visible { outline: 2px solid var(--t-focus); outline-offset: 2px; }
      #post-editor-root .pe-decide-row { display: flex; gap: 8px; justify-content: center; }
      #post-editor-root .pe-btn-small { min-height: 32px; padding: 4px 12px; font-size: 13px; font-weight: 600; }
      #post-editor-root .pe-btn .brief-loader-spinner { width: 14px; height: 14px; }
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
        #post-editor-root #post-editor-footer-actions .pe-btn { padding: 8px 10px; font-size: 13px; }
      }
      @media (prefers-reduced-motion: reduce) { #post-editor-root * { transition: none !important; animation: none !important; } }
    `}</style>
  );
}
