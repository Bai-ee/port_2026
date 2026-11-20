'use client';

// VideoBriefPanel — the internal "Creative Brief" of one calendar post (features/brief-video/brief-fields.js).
// Saved on its own (social-posting `video-brief-save`; `video-brief-render` = approve + render now): never touches the post copy, approval,
// schedule or publishing. A brief renders only after "Approve for render"; attaching the video marks it rendered.
// Styles live in PostEditorStyles (#post-editor-root .pe-vb*).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { friendlyBriefReason, friendlyBriefReasons, similarVideoNote } from './post-editor-model.js';
import VideoBriefV2Editor from './VideoBriefV2Editor.jsx';
import { canUseV2, isV2Row } from './video-brief-v2-model.js';

const KIND_LABEL = { author: 'First version', feedback: 'Feedback', rollback: 'Restored' };
const FEEDBACK_MAX = 2000;
const STATUS_LABEL = { draft: 'Draft', ready: 'Ready for review', approved: 'Approved for render', rendered: 'Rendered' };

function fromRow(row) {
  const m = row?.videoBriefMeta || {};
  return {
    template: String(typeof m.creative === 'string' ? m.creative : (row?.videoBrief || '')),
    status: m.status || 'draft',
    assets: Array.isArray(m.assets) ? m.assets.join('\n') : '',
    shots: m.shots || '',
    captions: m.captions || '',
    audio: m.audio || '',
    narration: m.narration === true ? 'on' : m.narration === false ? 'off' : '',
  };
}

export default function VideoBriefPanel({ row, callSocial, locked = false, onRowPatch }) {
  const initial = useMemo(() => fromRow(row), [row?.id, row?.videoBrief, row?.videoBriefMeta]); // eslint-disable-line react-hooks/exhaustive-deps
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [versions, setVersions] = useState([]);
  const [pickV2, setPickV2] = useState(false);
  useEffect(() => { setF(initial); }, [initial]);
  useEffect(() => { setPickV2(false); }, [row?.id]);

  const savedStatus = row?.videoBriefMeta?.status || null;
  const authorError = Array.isArray(row?.videoBriefMeta?.authorError?.reasons) ? row.videoBriefMeta.authorError : null;
  const hasSaved = Boolean(String(row?.videoBrief || '').trim());
  const legacy = /INTERNAL VIDEO BRIEF/i.test(String(row?.content || ''));
  const editable = !locked && row?.status === 'draft' && !legacy;
  const dirty = ['template', 'status', 'assets', 'shots', 'captions', 'audio', 'narration'].some((k) => f[k] !== initial[k]);
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setMsg(null); };
  const v2Mode = isV2Row(row) || pickV2; // v2 briefs (and a new CQ brief the owner starts as v2) use the structured editor; v1 is unchanged

  const send = async (body, okText) => {
    setBusy(true); setMsg(null);
    try {
      const res = await callSocial({ ...body, postId: row.id, expectedRevision: row.revision ?? null });
      if (!res?.ok) throw new Error(res?.error || 'Save failed.');
      const b = res.brief || {};
      onRowPatch?.({ revision: b.revision ?? res.post?.revision ?? row.revision, videoBrief: b.videoBrief || null, videoBriefMeta: b.meta || null });
      setMsg({ tone: 'ok', text: `${okText}${similarVideoNote(res.similar)}` });
    } catch (e) {
      setMsg({ tone: 'bad', text: friendlyBriefReasons(e?.message || 'Save failed.') });
    } finally {
      setBusy(false);
    }
  };

  const save = () => send({
    action: 'video-brief-save',
    template: f.template,
    status: f.status === 'approved' || f.status === 'rendered' ? undefined : f.status,
    assets: f.assets.split('\n').map((s) => s.trim()).filter(Boolean),
    shots: f.shots, captions: f.captions, audio: f.audio,
    narration: f.narration === '' ? null : f.narration === 'on',
  }, f.template.trim() ? 'Creative Brief saved. The post copy was not changed.' : 'Creative Brief cleared.');
  const authoredId = row?.videoBriefMeta?.authored?.requestId || null;
  const loadVersions = useCallback(async () => {
    if (!row?.id || !authoredId) { setVersions([]); return; }
    try {
      const res = await callSocial({ action: 'video-brief-versions', postId: row.id });
      if (res?.ok && Array.isArray(res.versions)) setVersions(res.versions);
    } catch { /* the list is informational */ }
  }, [row?.id, authoredId, callSocial]);
  useEffect(() => { loadVersions(); }, [loadVersions]);

  // Feedback / rollback: draft-only; the server revises the video request (one model call for feedback), then re-renders the draft's video.
  const revise = async (body, okText) => {
    setBusy(true); setMsg(null);
    try {
      const res = await callSocial({ ...body, postId: row.id, expectedRevision: row.revision ?? null });
      const b = res.brief || {};
      const r = res.render || {};
      const patch = { revision: res.post?.revision ?? row.revision, videoBrief: b.videoBrief || null, videoBriefMeta: b.meta || null };
      if (r.ok) patch.videoProcessing = { state: 'queued', label: 'Queued: re-rendering', ...(r.jobId ? { jobId: r.jobId } : {}) };
      onRowPatch?.(patch);
      if (Array.isArray(res.versions)) setVersions(res.versions);
      if (body.action === 'video-brief-feedback') setFeedback('');
      setMsg(r.ok
        ? { tone: 'ok', text: `${okText}${similarVideoNote(res.similar)}` }
        : { tone: 'bad', text: `Saved, but the video could not re-render now: ${friendlyBriefReason(r.error) || 'unknown error'} Use "Render this version" to try again.` });
    } catch (e) {
      setMsg({ tone: 'bad', text: friendlyBriefReasons(e?.message || 'The video could not be revised.') });
    } finally {
      setBusy(false);
    }
  };
  const sendFeedback = () => revise({ action: 'video-brief-feedback', feedback: feedback.trim() }, 'Feedback applied. The video is re-rendering; the new version replaces it when it finishes.');
  const useVersion = (n) => revise({ action: 'video-brief-rollback', n }, `Version ${n} restored. The video is re-rendering.`);

  const renderNow = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await callSocial({ action: 'video-brief-render', postId: row.id, expectedRevision: row.revision ?? null });
      const b = res.brief || {};
      const r = res.render || {};
      const patch = { revision: res.post?.revision ?? row.revision, videoBrief: b.videoBrief || null, videoBriefMeta: b.meta || null };
      if (r.ok) patch.videoProcessing = { state: 'queued', label: r.existing ? 'Render already started' : 'Queued: rendering started', ...(r.jobId ? { jobId: r.jobId } : {}) };
      onRowPatch?.(patch);
      setMsg(r.ok
        ? { tone: 'ok', text: r.existing ? 'Already rendering. The video attaches when it finishes.' : 'Rendering started. The video attaches to this post when it finishes.' + similarVideoNote(res.similar) }
        : { tone: 'bad', text: `Approved, but the render could not start now: ${friendlyBriefReason(r.error) || 'unknown error'}` });
    } catch (e) {
      setMsg({ tone: 'bad', text: friendlyBriefReasons(e?.message || 'Render failed to start.') });
    } finally {
      setBusy(false);
    }
  };
  const vpState = row?.videoProcessing?.state;
  const inFlight = vpState === 'queued' || vpState === 'rendering' || vpState === 'rendered';
  const IN_FLIGHT_LABEL = { queued: 'Queued…', rendering: 'Rendering…', rendered: 'Rendered, attaching…' };
  const renderLabel = busy ? 'Starting…' : inFlight ? IN_FLIGHT_LABEL[vpState] : (pendingVersion ? 'Render this version' : savedStatus === 'approved' ? 'Render now' : 'Approve & render now');

  // While a render runs, poll every 10 s: the server attaches the finished video at once (no wait for the cron tick).
  const postId = row?.id;
  useEffect(() => {
    if (!inFlight || !postId) return undefined;
    let stopped = false;
    const started = Date.now();
    const tick = async () => {
      if (stopped || (typeof document !== 'undefined' && document.hidden)) return;
      if (Date.now() - started > 20 * 60_000) { stopped = true; return; }
      try {
        const res = await callSocial({ action: 'video-brief-status', postId });
        if (stopped || !res?.ok) return;
        const p = res.post || {};
        onRowPatch?.({ revision: p.revision, status: p.status, content: p.content, mediaUrl: p.mediaUrl, mediaType: p.mediaType, posterUrl: p.posterUrl, mediaJobId: p.mediaJobId, videoBrief: p.videoBrief, videoBriefMeta: p.videoBriefMeta, videoProcessing: res.videoProcessing || null }, { attached: res.attached });
        if (res.attached) { setMsg({ tone: 'ok', text: 'Video attached to this post.' }); loadVersions(); }
      } catch { /* next tick */ }
    };
    const id = setInterval(tick, 10_000);
    tick();
    return () => { stopped = true; clearInterval(id); };
  }, [inFlight, postId, callSocial, loadVersions]); // eslint-disable-line react-hooks/exhaustive-deps
  const newest = versions[0] || null;
  // A revised request whose replace render never started (cap, error): its newest version has no video yet while the post still shows the old one.
  const pendingVersion = Boolean(newest && !newest.mediaUrl && row?.mediaUrl && authoredId && newest.requestId === authoredId);
  const canRender = editable && !busy && !dirty && hasSaved && !inFlight && (pendingVersion || (savedStatus !== 'rendered' && !row?.mediaUrl));
  const canRevise = editable && !busy && !dirty && !inFlight && Boolean(authoredId) && savedStatus !== 'draft' && savedStatus !== 'ready';

  return (
    <details id="post-editor-video-brief-panel" className="pe-vb" open={hasSaved || undefined}>
      <summary id="post-editor-video-brief-summary">
        <span>Creative Brief <span className="pe-muted">· internal, never published</span></span>
        {savedStatus ? <span id="post-editor-video-brief-status-pill" className="pe-vb-pill">{isV2Row(row) && savedStatus === 'approved' ? 'Approved (storyboard next)' : (STATUS_LABEL[savedStatus] || savedStatus)}</span> : null}
      </summary>
      <div id="post-editor-video-brief-body" className="pe-vb-body">
        {legacy ? <p className="pe-muted">This post has an INTERNAL VIDEO BRIEF in its text. Move it out of the post copy (cut, save the post), then paste it here.</p> : null}
        {!legacy && row?.status !== 'draft' ? <p className="pe-muted">Briefs render only for drafts. This post is {row?.status}, so the brief is read-only.</p> : null}
        {v2Mode ? <VideoBriefV2Editor row={row} callSocial={callSocial} editable={editable} onRowPatch={onRowPatch} /> : (<>
        {editable && !hasSaved && canUseV2(row) ? (
          <div id="post-editor-video-brief-v2-choice-row" className="pe-vb-row">
            <button type="button" id="post-editor-video-brief-use-v2-btn" className="pe-btn pe-btn-ghost" onClick={() => setPickV2(true)}>Use the v2 form (structured)</button>
            <span className="pe-muted">Recommended for Critters Quest episodes.</span>
          </div>
        ) : null}
        <label className="pe-vb-field" htmlFor="post-editor-video-brief-template">Creative Brief (shot-by-shot)
          <textarea id="post-editor-video-brief-template" className="pe-text" rows={Math.min(18, Math.max(5, f.template.split('\n').length + 1))} value={f.template} readOnly={!editable} onChange={set('template')} placeholder="Fill in the Creative Brief template. Max 8000 characters." />
          <span className="pe-muted">{f.template.trim().length} / 8000</span>
        </label>
        <label className="pe-vb-field" htmlFor="post-editor-video-brief-assets">Reference artwork and asset links (one per line)
          <textarea id="post-editor-video-brief-assets" className="pe-text" rows={3} value={f.assets} readOnly={!editable} onChange={set('assets')} />
        </label>
        <label className="pe-vb-field" htmlFor="post-editor-video-brief-shots">Shot timings
          <textarea id="post-editor-video-brief-shots" className="pe-text" rows={3} value={f.shots} readOnly={!editable} onChange={set('shots')} />
        </label>
        <label className="pe-vb-field" htmlFor="post-editor-video-brief-captions">Captions
          <textarea id="post-editor-video-brief-captions" className="pe-text" rows={3} value={f.captions} readOnly={!editable} onChange={set('captions')} />
        </label>
        <label className="pe-vb-field" htmlFor="post-editor-video-brief-audio">Audio direction
          <textarea id="post-editor-video-brief-audio" className="pe-text" rows={2} value={f.audio} readOnly={!editable} onChange={set('audio')} />
        </label>
        <div id="post-editor-video-brief-settings-row" className="pe-vb-row">
          <label className="pe-vb-field" htmlFor="post-editor-video-brief-narration">Narration
            <select id="post-editor-video-brief-narration" className="pe-input" value={f.narration} disabled={!editable} onChange={set('narration')}>
              <option value="">Not set</option><option value="on">On</option><option value="off">Off</option>
            </select>
          </label>
          <label className="pe-vb-field" htmlFor="post-editor-video-brief-status">Status
            <select id="post-editor-video-brief-status" className="pe-input" value={f.status} disabled={!editable || f.status === 'approved' || f.status === 'rendered'} onChange={set('status')}>
              <option value="draft">Draft</option><option value="ready">Ready for review</option>
              {f.status === 'approved' ? <option value="approved">Approved for render</option> : null}
              {f.status === 'rendered' ? <option value="rendered">Rendered</option> : null}
            </select>
          </label>
        </div>
        <div id="post-editor-video-brief-actions-row" className="pe-vb-row">
          <button type="button" id="post-editor-video-brief-save-btn" className="pe-btn pe-btn-ghost" disabled={!editable || busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save brief'}</button>
          <button type="button" id="post-editor-video-brief-render-btn" className="pe-btn pe-btn-ghost" disabled={!canRender} onClick={renderNow} title={dirty ? 'Save the brief first.' : ''}>{renderLabel}</button>
        </div>
        {row?.mediaUrl && row?.mediaType === 'video' && String(row?.mediaJobId || '').startsWith('bv_') ? (
          <p id="post-editor-video-brief-video-row" className="pe-muted"><a id="post-editor-video-brief-open-link" href={row.mediaUrl} target="_blank" rel="noreferrer">Open video</a> · attached to this post</p>
        ) : null}
        {authoredId ? (
          <div id="creative-brief-feedback-panel" className="pe-vb-body" data-section="creative-brief-feedback">
            <label className="pe-vb-field" htmlFor="creative-brief-feedback-input">Feedback on the video (what should change?)
              <textarea id="creative-brief-feedback-input" className="pe-text" rows={3} maxLength={FEEDBACK_MAX} value={feedback} readOnly={!canRevise} onChange={(e) => { setFeedback(e.target.value); setMsg(null); }} placeholder="e.g. Make the opening banner shorter and hold the last shot for 2 more seconds." />
              <span className="pe-muted">{feedback.trim().length} / {FEEDBACK_MAX} · rewrites the video request and re-renders this draft's video</span>
            </label>
            <div id="creative-brief-feedback-actions-row" className="pe-vb-row">
              <button type="button" id="creative-brief-feedback-submit" className="pe-btn pe-btn-ghost" disabled={!canRevise || !feedback.trim()} onClick={sendFeedback}>{busy ? 'Working…' : 'Send feedback & re-render'}</button>
            </div>
            {versions.length ? (
              <ol id="creative-brief-version-list" className="pe-muted" style={{ margin: 0, paddingLeft: 18 }}>
                {versions.map((v) => (
                  <li id={`creative-brief-version-${v.n}`} key={v.n}>
                    <strong>v{v.n}</strong> · {KIND_LABEL[v.kind] || v.kind}{v.fromN ? ` of v${v.fromN}` : ''} · {String(v.createdAt || '').slice(0, 16).replace('T', ' ')}
                    {v.feedback ? <> · “{String(v.feedback).slice(0, 80)}{String(v.feedback).length > 80 ? '…' : ''}”</> : null}
                    {v.mediaUrl ? <> · <a href={v.mediaUrl} target="_blank" rel="noreferrer">video</a></> : <> · no video yet</>}
                    {v.requestId === authoredId ? ' · current' : (
                      <> · <button type="button" id={`creative-brief-version-${v.n}-use-btn`} className="pe-btn pe-btn-ghost" disabled={!canRevise} onClick={() => useVersion(v.n)}>Use this version</button></>
                    )}
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}
        {authorError ? <p id="post-editor-video-brief-author-error" className="pe-over" role="alert">Could not build the video from this Creative Brief: {friendlyBriefReasons(authorError.reasons)}</p> : null}
        {msg ? <p id="post-editor-video-brief-message" className={msg.tone === 'bad' ? 'pe-over' : 'pe-muted'} role={msg.tone === 'bad' ? 'alert' : 'status'}>{msg.text}</p> : null}
        <p className="pe-muted">Saving never changes the post copy, approval or schedule. Render now approves the brief and starts the video immediately (max 5 a day). Editing an approved template sends it back to review. A Critters Quest Creative Brief is turned into a video request when you approve it.</p>
        </>)}
      </div>
    </details>
  );
}
