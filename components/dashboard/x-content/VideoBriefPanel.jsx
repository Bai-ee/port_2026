'use client';

// VideoBriefPanel — the internal "Video brief" of one calendar post (features/brief-video/brief-fields.js).
// Saved on its own (social-posting `video-brief-save` / `video-brief-approve`): never touches the post copy, approval,
// schedule or publishing. A brief renders only after "Approve for render"; attaching the video marks it rendered.
// Styles live in PostEditorStyles (#post-editor-root .pe-vb*).

import React, { useEffect, useMemo, useState } from 'react';

const STATUS_LABEL = { draft: 'Draft', ready: 'Ready for review', approved: 'Approved for render', rendered: 'Rendered' };

function fromRow(row) {
  const m = row?.videoBriefMeta || {};
  return {
    template: String(row?.videoBrief || ''),
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
  useEffect(() => { setF(initial); }, [initial]);

  const savedStatus = row?.videoBriefMeta?.status || null;
  const hasSaved = Boolean(String(row?.videoBrief || '').trim());
  const legacy = /INTERNAL VIDEO BRIEF/i.test(String(row?.content || ''));
  const editable = !locked && row?.status === 'draft' && !legacy;
  const dirty = ['template', 'status', 'assets', 'shots', 'captions', 'audio', 'narration'].some((k) => f[k] !== initial[k]);
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setMsg(null); };

  const send = async (body, okText) => {
    setBusy(true); setMsg(null);
    try {
      const res = await callSocial({ ...body, postId: row.id, expectedRevision: row.revision ?? null });
      if (!res?.ok) throw new Error(res?.error || 'Save failed.');
      const b = res.brief || {};
      onRowPatch?.({ revision: b.revision ?? res.post?.revision ?? row.revision, videoBrief: b.template || null, videoBriefMeta: b.meta || null });
      setMsg({ tone: 'ok', text: okText });
    } catch (e) {
      setMsg({ tone: 'bad', text: e?.message || 'Save failed.' });
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
  }, f.template.trim() ? 'Brief saved. The post copy was not changed.' : 'Brief cleared.');
  const approve = () => send({ action: 'video-brief-approve' }, 'Approved for render. The next render tick picks it up.');

  return (
    <details id="post-editor-video-brief-panel" className="pe-vb" open={hasSaved || undefined}>
      <summary id="post-editor-video-brief-summary">
        <span>Video brief <span className="pe-muted">· internal, never published</span></span>
        {savedStatus ? <span id="post-editor-video-brief-status-pill" className="pe-vb-pill">{STATUS_LABEL[savedStatus] || savedStatus}</span> : null}
      </summary>
      <div id="post-editor-video-brief-body" className="pe-vb-body">
        {legacy ? <p className="pe-muted">This post has an INTERNAL VIDEO BRIEF in its text. Move it out of the post copy (cut, save the post), then paste it here.</p> : null}
        {!legacy && row?.status !== 'draft' ? <p className="pe-muted">Briefs render only for drafts. This post is {row?.status}, so the brief is read-only.</p> : null}
        <label className="pe-vb-field" htmlFor="post-editor-video-brief-template">Template (shot-by-shot)
          <textarea id="post-editor-video-brief-template" className="pe-text" rows={Math.min(18, Math.max(5, f.template.split('\n').length + 1))} value={f.template} readOnly={!editable} onChange={set('template')} placeholder="Full video template. Max 8000 characters." />
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
          <button type="button" id="post-editor-video-brief-approve-btn" className="pe-btn pe-btn-ghost" disabled={!editable || busy || dirty || !hasSaved || savedStatus === 'approved' || savedStatus === 'rendered'} onClick={approve} title={dirty ? 'Save the brief first.' : ''}>Approve for render</button>
        </div>
        {msg ? <p id="post-editor-video-brief-message" className={msg.tone === 'bad' ? 'pe-over' : 'pe-muted'} role={msg.tone === 'bad' ? 'alert' : 'status'}>{msg.text}</p> : null}
        <p className="pe-muted">Saving never changes the post copy, approval or schedule. Editing an approved template sends it back to review. Rendering uses the template text.</p>
      </div>
    </details>
  );
}
