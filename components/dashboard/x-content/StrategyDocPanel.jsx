'use client';

import React, { useEffect, useRef, useState } from 'react';
import { MessagesSquare, Pencil, RotateCcw } from 'lucide-react';
import { SECTION_MAX, describeDocChange } from '../../../features/x-strategy/strategy-doc.js';
import { formatDayTime } from './StrategyChat.jsx';
import { XCE_COLORS } from '../content-ui/xce-tokens';
import Accordion from '../content-ui/ui/Accordion';
import Badge from '../content-ui/ui/Badge';
import Card from '../content-ui/ui/Card';
import IconButton from '../content-ui/ui/IconButton';
import ClientBrainOwnedTag from '../ClientBrainOwnedTag';

// StrategyDocPanel - the "Strategy" sub-tab of the Strategy tab's Details pane: the owner's Strategy document.
// Read view per section, Edit -> textarea -> Save (version-checked), document history with Restore.
// Controlled: StrategyPanel owns the doc (strategy-doc-get) so the chat can show doc changes in its timeline.
// This panel writes through strategy-doc-save / strategy-doc-revert via the card's `call(action, body)` and hands
// the returned doc to `onSaved(doc)`. The chat never writes here except through a confirmed proposal.
//   <StrategyDocPanel clientId call doc meta loading loadError onReload onSaved onAskInChat />

const S = {
  stack: { display: 'grid', gap: 12, minWidth: 0 },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, minWidth: 0 },
  title: { fontSize: 15, fontWeight: 600, color: XCE_COLORS.ink },
  hint: { margin: '2px 0 0', fontSize: 12, lineHeight: 1.4, color: XCE_COLORS.inkMuted },
  body: { margin: '8px 0 0', fontSize: 13.5, lineHeight: 1.55, color: XCE_COLORS.ink, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  empty: { margin: '8px 0 0', fontSize: 13, color: XCE_COLORS.inkMuted, fontStyle: 'italic' },
  note: { margin: 0, fontSize: 12, lineHeight: 1.45, color: XCE_COLORS.inkSoft },
  warn: { padding: '8px 10px', borderRadius: 10, background: XCE_COLORS.amberBg, border: `1px solid ${XCE_COLORS.amberBorder}`, fontSize: 12.5, lineHeight: 1.45, color: XCE_COLORS.amber },
  err: { fontSize: 12, lineHeight: 1.4, color: XCE_COLORS.red },
  ok: { fontSize: 12, lineHeight: 1.4, color: XCE_COLORS.green },
  counter: { fontFamily: 'var(--font-mono)', fontSize: 11, color: XCE_COLORS.inkMuted },
};

const errText = (err, fallback) => String(err?.message || fallback || 'Request failed.');

export default function StrategyDocPanel({ clientId, call, doc, meta = [], loading, loadError, onReload, onSaved, onAskInChat }) {
  const [editing, setEditing] = useState(null); // {key, text}
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ kind: '', text: '', conflict: false });
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const load = () => { if (typeof onReload === 'function') onReload(); };

  const save = async (sections, { reason = '' } = {}) => {
    setBusy(true);
    setMsg({ kind: '', text: '', conflict: false });
    try {
      const res = await call('strategy-doc-save', { clientId, sections, expectedVersion: doc?.version ?? 0, reason });
      if (!mounted.current) return;
      if (typeof onSaved === 'function') onSaved(res.doc);
      setEditing(null);
      setMsg({ kind: 'ok', text: res.changed ? (res.change || 'Saved.') : 'No changes to save.', conflict: false });
    } catch (err) {
      if (!mounted.current) return;
      const conflict = err?.status === 409;
      setMsg({ kind: 'err', text: conflict ? 'The strategy changed since you opened it (maybe from chat). Reload, then re-apply your edit.' : errText(err, 'Not saved.'), conflict });
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const restore = async (version) => {
    setBusy(true);
    setMsg({ kind: '', text: '', conflict: false });
    try {
      const res = await call('strategy-doc-revert', { clientId, version });
      if (!mounted.current) return;
      if (typeof onSaved === 'function') onSaved(res.doc);
      setMsg({ kind: 'ok', text: res.change || `Restored v${version}.`, conflict: false });
    } catch (err) {
      if (mounted.current) setMsg({ kind: 'err', text: errText(err, 'Not restored.'), conflict: err?.status === 409 });
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  if (loading && !doc) return <div id="strategy-doc-loading" className="xce-loading">Loading strategy…</div>;
  if (loadError && !doc) {
    return (
      <div id="strategy-doc-load-error" role="alert" style={S.stack}>
        <div style={S.err}>{loadError}</div>
        <button type="button" id="strategy-doc-load-retry-button" className="xce-btn" onClick={load}>Try again</button>
      </div>
    );
  }
  if (!doc) return null;

  const history = [...(doc.history || [])].reverse();
  const confirmed = !!doc.confirmed;
  const firstKey = meta[0]?.key;

  return (
    <section id="strategy-doc-panel" data-section="strategy-doc" style={S.stack}>
      <div id="strategy-doc-status-row" style={{ ...S.row, justifyContent: 'space-between' }}>
        <span style={S.title}>{doc.version ? `Strategy · v${doc.version}` : 'Strategy · draft'}<ClientBrainOwnedTag /></span>
        <Badge id="strategy-doc-status-badge" tone={confirmed ? 'green' : 'amber'}>{confirmed ? 'Confirmed' : 'Draft'}</Badge>
      </div>

      {!confirmed ? (
        <div id="strategy-doc-draft-notice" style={S.warn}>
          This is a draft. Nothing runs on it until you confirm it.
          Edit any section, approve the Client Brain to fill it, or confirm it as is.
          <div style={{ marginTop: 8 }}>
            <button type="button" id="strategy-doc-confirm-button" className="xce-btn" disabled={busy || !firstKey} onClick={() => save({ [firstKey]: doc.sections[firstKey] || '' }, { reason: 'confirmed draft' })}>
              {busy ? 'Saving…' : 'Confirm this strategy'}
            </button>
          </div>
        </div>
      ) : null}

      {doc.updatedAt ? <p id="strategy-doc-last-updated" style={{ ...S.note, fontFamily: 'var(--font-mono)', fontSize: 11 }}>Last changed {formatDayTime(doc.updatedAt)}{doc.lastReview?.at ? ` · last review ${formatDayTime(doc.lastReview.at)}` : ''}</p> : null}

      {msg.text ? (
        <div id="strategy-doc-message" role={msg.kind === 'err' ? 'alert' : 'status'} style={msg.kind === 'err' ? S.err : S.ok}>
          {msg.text}
          {msg.conflict ? <button type="button" id="strategy-doc-reload-button" className="xce-btn" style={{ marginLeft: 8 }} onClick={() => { setMsg({ kind: '', text: '', conflict: false }); load(); }}>Reload</button> : null}
        </div>
      ) : null}

      {meta.map(({ key, title, hint }) => {
        const isEditing = editing?.key === key;
        const text = doc.sections?.[key] || '';
        return (
          <Card key={key} id={`strategy-doc-section-${key}`} data-section={`strategy-doc-${key}`} padding={14}>
            <div id={`strategy-doc-section-${key}-header`} style={{ ...S.row, flexWrap: 'nowrap', justifyContent: 'space-between' }}>
              <div style={{ minWidth: 0 }}>
                <div style={S.title}>{title}</div>
                <p style={S.hint}>{hint}</p>
              </div>
              {!isEditing ? (
                <div style={{ ...S.row, flexWrap: 'nowrap', gap: 4 }}>
                  {typeof onAskInChat === 'function' ? (
                    <IconButton id={`strategy-doc-section-${key}-discuss-button`} label={`Discuss ${title} in chat`} icon={<MessagesSquare size={16} />} size={36}
                      onClick={() => onAskInChat(`Let's work on the ${title} section of my strategy.`)} />
                  ) : null}
                  <IconButton id={`strategy-doc-section-${key}-edit-button`} label={`Edit ${title}`} icon={<Pencil size={16} />} size={36} disabled={busy || !!editing}
                    onClick={() => { setMsg({ kind: '', text: '', conflict: false }); setEditing({ key, text }); }} />
                </div>
              ) : null}
            </div>

            {isEditing ? (
              <div id={`strategy-doc-section-${key}-editor`} style={{ ...S.stack, marginTop: 8 }}>
                <textarea id={`strategy-doc-section-${key}-input`} aria-label={`${title} text`} rows={Math.min(16, Math.max(5, editing.text.split('\n').length + 2))}
                  maxLength={SECTION_MAX} value={editing.text} onChange={(e) => setEditing({ key, text: e.target.value })} style={{ width: '100%', minHeight: 110, fontSize: 13.5, lineHeight: 1.5 }} />
                <div style={{ ...S.row, justifyContent: 'space-between' }}>
                  <span style={S.counter}>{editing.text.length}/{SECTION_MAX}</span>
                  <div style={S.row}>
                    <button type="button" id={`strategy-doc-section-${key}-cancel-button`} className="xce-btn xce-btn-ghost" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
                    <button type="button" id={`strategy-doc-section-${key}-save-button`} className="xce-btn" disabled={busy} onClick={() => save({ [key]: editing.text })}>{busy ? 'Saving…' : 'Save'}</button>
                  </div>
                </div>
              </div>
            ) : text ? <p id={`strategy-doc-section-${key}-text`} style={S.body}>{text}</p> : <p id={`strategy-doc-section-${key}-text`} style={S.empty}>Empty.</p>}
          </Card>
        );
      })}

      <Accordion id="strategy-doc-history-accordion" title={`Strategy history${history.length ? ` · ${history.length}` : ''}`}>
        {history.length ? (
          <ul id="strategy-doc-history-list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {history.map((h) => (
              <li key={h.version} id={`strategy-doc-history-row-${h.version}`} style={{ ...S.row, flexWrap: 'nowrap', justifyContent: 'space-between', paddingBottom: 6, borderBottom: `1px solid ${XCE_COLORS.border}` }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, lineHeight: 1.4 }}>{describeDocChange(h)}</div>
                  <div style={{ ...S.note, fontFamily: 'var(--font-mono)', fontSize: 11 }}>{formatDayTime(h.at)}</div>
                </div>
                {h.version < doc.version ? (
                  <IconButton id={`strategy-doc-history-restore-button-${h.version}`} label={`Restore v${h.version}`} icon={<RotateCcw size={16} />} size={36} disabled={busy} onClick={() => restore(h.version)} />
                ) : <Badge tone="grey">current</Badge>}
              </li>
            ))}
          </ul>
        ) : <p style={S.note}>No saved versions yet.</p>}
      </Accordion>
    </section>
  );
}
