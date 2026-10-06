'use client';

import React, { useState } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';
import { ConfirmButton } from './Feedback';

// ClientCapturePanel — capture a client story, and approve/reject client packages.
//
// PURE PRESENTATION. Persistence is handed back through `onCapture`,
// `onApprove`, `onReject`. Nothing here writes copy: the story field is the
// author's own memory; left blank it stays "[add your memory]" server-side.
// STYLING: classNames only (`xce-`); the parent card owns the CSS.

const EMPTY = { client: '', project: '', problem: '', decision: '', rejectedIdea: '', result: '', assetRefsText: '', story: '', owned: false };

const FIELDS = [
  ['client', 'Client', 'input'],
  ['project', 'Project', 'input'],
  ['problem', 'Problem', 'textarea'],
  ['decision', 'Decision', 'textarea'],
  ['rejectedIdea', 'Rejected idea', 'textarea'],
  ['result', 'Result', 'textarea'],
  ['assetRefsText', 'Assets (one per line)', 'textarea'],
  ['story', 'Your memory (the post is written from this)', 'textarea'],
];

function approvalOf(pkg) {
  return pkg?.approval?.state || (pkg?.rights === 'client-approval-needed' ? 'needed' : 'none');
}

export default function ClientCapturePanel({ packages, loading, error, savingId, onCapture, onApprove, onReject }) {
  const [form, setForm] = useState(EMPTY);
  const rows = (Array.isArray(packages) ? packages : []).filter((p) => p?.engine === 'client' || p?.series === 'C6');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    if (!onCapture) return;
    const ok = await onCapture({
      client: form.client,
      project: form.project,
      problem: form.problem,
      decision: form.decision,
      rejectedIdea: form.rejectedIdea,
      result: form.result,
      story: form.story,
      assetRefs: form.assetRefsText.split('\n').map((l) => l.trim()).filter(Boolean),
      rights: form.owned ? 'owned' : 'client-approval-needed',
      bucketId: 'client',
    });
    if (ok) setForm(EMPTY);
  }

  return (
    <div id="x-content-client-capture-panel" className="xce-panel">
      <div id="x-content-client-capture-header" className="xce-head">
        <span className="xce-kicker">Client stories</span>
        <span className="xce-head-count">{rows.length} packages</span>
      </div>

      {error ? (
        <p id="x-content-client-error" className="xce-error"><AlertTriangle size={13} /> {typeof error === 'string' ? error : 'Something failed.'}</p>
      ) : null}

      <form id="x-content-client-capture-form" className="xce-form" onSubmit={submit}>
        <div id="x-content-client-capture-fields" className="xce-form-grid">
          {FIELDS.map(([key, label, kind]) => (
            <div key={key} className={`xce-field${kind === 'textarea' ? ' xce-field-wide' : ''}`}>
              <label htmlFor={`x-content-client-field-${key}`}>{label}</label>
              {kind === 'input' ? (
                <input id={`x-content-client-field-${key}`} className="xce-input" value={form[key]} onChange={(e) => set(key, e.target.value)} />
              ) : (
                <textarea id={`x-content-client-field-${key}`} className="xce-textarea xce-textarea-short" value={form[key]} onChange={(e) => set(key, e.target.value)} />
              )}
            </div>
          ))}
        </div>
        <label id="x-content-client-owned-toggle" className="xce-check">
          <input type="checkbox" checked={form.owned} onChange={(e) => set('owned', e.target.checked)} />
          I own this work (no client approval needed)
        </label>
        <div id="x-content-client-capture-actions" className="xce-form-actions">
          <button type="submit" id="x-content-client-capture-submit" className="xce-btn-primary" disabled={!form.client.trim() || !form.project.trim() || savingId === 'capture'}>
            Capture story
          </button>
        </div>
      </form>

      <div id="x-content-client-list-section" className="xce-inv-section">
        <p className="xce-inv-kicker">Client packages</p>
        {loading ? <div className="xce-loading">Loading…</div> : null}
        {!loading && !rows.length ? <div className="xce-empty">No client packages yet. Capture one above.</div> : null}
        <ul id="x-content-client-package-list" className="xce-inv-list">
          {rows.map((p) => {
            const state = approvalOf(p);
            const busy = savingId === p.id;
            return (
              <li key={p.id} id={`x-content-client-package-${p.id}`} className="xce-week-slot">
                <p className="xce-inv-row-title">{p.title}</p>
                <div className="xce-inv-row-flags">
                  <span className={`xce-chip ${state === 'approved' ? 'xce-chip-adopted' : state === 'rejected' ? 'xce-chip-error' : 'xce-chip-warn'}`}>approval: {state}</span>
                </div>
                <details className="xce-more" id={`x-content-client-package-${p.id}-details`}>
                  <summary className="xce-more-summary">Details</summary>
                  <div className="xce-more-body">
                    <div className="xce-inv-row-flags">
                      <span className="xce-chip xce-chip-status">{p.rights}</span>
                      <span className="xce-chip xce-chip-status">{p.status}</span>
                    </div>
                    {p.variants?.x?.suggestedStory ? <p className="xce-reason">Angle: {p.variants.x.suggestedStory}</p> : null}
                  </div>
                </details>
                <div className="xce-slot-actions">
                  {state !== 'approved' && onApprove ? (
                    <button type="button" id={`x-content-client-approve-${p.id}`} className="xce-draft-button" disabled={busy} onClick={() => onApprove(p.id)}>
                      <Check size={14} /> Approve
                    </button>
                  ) : null}
                  {state !== 'rejected' && onReject ? (
                    <ConfirmButton id={`x-content-client-reject-${p.id}`} className="xce-draft-button xce-danger" label="Reject" prompt="Reject this?" icon={<X size={14} />} disabled={busy} onConfirm={() => onReject(p.id)} />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
