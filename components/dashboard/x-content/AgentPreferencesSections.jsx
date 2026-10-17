'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { XCE_COLORS, XCE_RADII } from '../content-ui/xce-tokens';

// AgentPreferencesSections - two blocks under Agent permissions:
//   "Reply format": the owner's saved instructions for how the agent formats answers (strategy-reply-style-get|save).
//     The agent also saves here when the owner says "from now on ..." in chat; MCP clients read the same text.
//   "Requests I couldn't do": what the agent answered "needs code / needs you" for (strategy-unmet-list|status),
//     newest first, with a review status.
//   <AgentPreferencesSections clientId call />

const S = {
  h: { margin: 0, fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: XCE_COLORS.inkSoft },
  help: { margin: 0, fontSize: 12.5, lineHeight: 1.45, color: XCE_COLORS.inkSoft },
  area: { boxSizing: 'border-box', width: '100%', minHeight: 132, padding: 10, borderRadius: XCE_RADII.md, border: `1px solid ${XCE_COLORS.border}`, background: XCE_COLORS.surface, color: XCE_COLORS.ink, font: 'inherit', fontSize: 16, lineHeight: 1.45, resize: 'vertical' },
  btn: { minHeight: 44, padding: '0 14px', borderRadius: XCE_RADII.md, border: `1px solid ${XCE_COLORS.borderStrong}`, background: XCE_COLORS.surface, color: XCE_COLORS.ink, font: 'inherit', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' },
  select: { minHeight: 36, padding: '0 8px', borderRadius: XCE_RADII.md, border: `1px solid ${XCE_COLORS.border}`, background: XCE_COLORS.surface, color: XCE_COLORS.ink, font: 'inherit', fontSize: 14 },
  row: { display: 'grid', gap: 4, padding: '8px 0', borderTop: `1px solid ${XCE_COLORS.border}`, fontSize: 12.5, minWidth: 0, overflowWrap: 'anywhere' },
  err: { margin: 0, fontSize: 12, color: XCE_COLORS.red },
  ok: { margin: 0, fontSize: 12, color: XCE_COLORS.green },
};

const STATUS_LABEL = { open: 'Open', planned: 'Planned', done: 'Done', 'wont-do': "Won't do" };

export default function AgentPreferencesSections({ clientId, call }) {
  const [style, setStyle] = useState({ text: '', isDefault: true });
  const [draft, setDraft] = useState('');
  const [requests, setRequests] = useState([]);
  const [msg, setMsg] = useState({ kind: '', text: '' });
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async () => {
    if (!clientId || typeof call !== 'function') return;
    const [s, u] = await Promise.allSettled([call('strategy-reply-style-get', { clientId }), call('strategy-unmet-list', { clientId })]);
    if (!mounted.current) return;
    if (s.status === 'fulfilled' && s.value?.style) { setStyle(s.value.style); setDraft(s.value.style.text || ''); }
    if (u.status === 'fulfilled') setRequests(Array.isArray(u.value?.requests) ? u.value.requests : []);
  }, [clientId, call]);
  useEffect(() => { load(); }, [load]);

  const saveStyle = async () => {
    setBusy(true); setMsg({ kind: '', text: '' });
    try {
      const r = await call('strategy-reply-style-save', { clientId, text: draft });
      if (mounted.current) { setStyle(r.style); setMsg({ kind: 'ok', text: 'Saved. The agent uses this from its next reply.' }); }
    } catch (e) {
      if (mounted.current) setMsg({ kind: 'err', text: e?.data?.error || e?.message || 'Could not save.' });
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const setStatus = async (id, status) => {
    setRequests((rows) => rows.map((r) => (r.id === id ? { ...r, status } : r)));
    try { await call('strategy-unmet-status', { clientId, id, status }); } catch { load(); }
  };

  return (
    <>
      <div id="x-strategy-agent-reply-format" data-section="agent-reply-format" style={{ display: 'grid', gap: 6, minWidth: 0 }}>
        <h4 style={S.h}>Reply format</h4>
        <p style={S.help}>
          {style.isDefault ? 'Using the default. ' : ''}How the agent formats every answer, here and over MCP. Edit it here, or tell the agent in chat (for example "from now on, put the number first").
        </p>
        <textarea id="x-strategy-agent-reply-format-input" aria-label="Reply format instructions" style={S.area} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1200} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" id="x-strategy-agent-reply-format-save" style={S.btn} disabled={busy || !draft.trim() || draft === style.text} onClick={saveStyle}>Save format</button>
          {msg.text ? <p id="x-strategy-agent-reply-format-message" role={msg.kind === 'err' ? 'alert' : 'status'} style={msg.kind === 'err' ? S.err : S.ok}>{msg.text}</p> : null}
        </div>
      </div>
      <div id="x-strategy-agent-unmet-requests" data-section="agent-unmet-requests" style={{ minWidth: 0 }}>
        <h4 style={S.h}>Requests I couldn&apos;t do</h4>
        {requests.length === 0 ? <p id="x-strategy-agent-unmet-requests-empty" style={S.help}>None logged yet.</p> : null}
        {requests.slice(0, 50).map((r) => (
          <div key={r.id} id={`x-strategy-agent-unmet-request-${r.id}`} style={S.row}>
            <span><b>{r.request}</b>{r.count > 1 ? ` · asked ${r.count}x` : ''}</span>
            {r.missing ? <span style={S.help}>{r.kind === 'needs-you' ? 'Needs you: ' : 'Needs code: '}{r.missing}</span> : null}
            <select aria-label="Review status" style={S.select} value={r.status || 'open'} onChange={(e) => setStatus(r.id, e.target.value)}>
              {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        ))}
      </div>
    </>
  );
}
