'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { XCE_COLORS, XCE_RADII } from '../content-ui/xce-tokens';
import UndoChip from './UndoChip.jsx';

// AgentPermissionsPanel - "Agent permissions": how much the strategy agent may do without asking, plus recent actions.
//   <AgentPermissionsPanel clientId call />
// Reads/writes strategy-autonomy-get|save; lists strategy-action-log with per-row Undo (strategy-action-undo).
// Destructive (tier 2) always asks; X publishing is locked to typed confirm.

const S = {
  panel: { padding: '12px 14px', borderRadius: XCE_RADII.md + 2, border: `1px solid ${XCE_COLORS.border}`, background: XCE_COLORS.surface, display: 'grid', gap: 12, minWidth: 0, marginBottom: 10 },
  h: { margin: 0, fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: XCE_COLORS.inkSoft },
  help: { margin: 0, fontSize: 12.5, lineHeight: 1.45, color: XCE_COLORS.inkSoft },
  field: { display: 'grid', gap: 4, minWidth: 0 },
  select: { boxSizing: 'border-box', width: '100%', minHeight: 44, padding: '0 10px', borderRadius: XCE_RADII.md, border: `1px solid ${XCE_COLORS.border}`, background: XCE_COLORS.surface, color: XCE_COLORS.ink, font: 'inherit', fontSize: 16 },
  logRow: { display: 'grid', gap: 2, padding: '8px 0', borderTop: `1px solid ${XCE_COLORS.border}`, fontSize: 12.5, minWidth: 0, overflowWrap: 'anywhere' },
  err: { margin: 0, fontSize: 12, color: XCE_COLORS.red },
  ok: { margin: 0, fontSize: 12, color: XCE_COLORS.green },
};

const logTime = (at) => { const ms = Date.parse(at || ''); return Number.isFinite(ms) ? new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };

export default function AgentPermissionsPanel({ clientId, call }) {
  const [tier1, setTier1] = useState('auto');
  const [tier3, setTier3] = useState('confirm');
  const [xLocked, setXLocked] = useState(true);
  const [log, setLog] = useState([]);
  const [msg, setMsg] = useState({ kind: '', text: '' });
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async () => {
    if (!clientId || typeof call !== 'function') return;
    try {
      const [a, l] = await Promise.all([call('strategy-autonomy-get', { clientId }), call('strategy-action-log', { clientId })]);
      if (!mounted.current) return;
      const au = a?.autonomy || a || {};
      if (au.tier1 === 'auto' || au.tier1 === 'confirm') setTier1(au.tier1);
      if (au.tier3 === 'confirm' || au.tier3 === 'typed') setTier3(au.tier3);
      setLog(Array.isArray(l?.log) ? l.log : Array.isArray(l?.entries) ? l.entries : []);
    } catch (e) {
      if (mounted.current) setMsg({ kind: 'err', text: e?.data?.error || e?.message || 'Could not load permissions.' });
    }
  }, [clientId, call]);
  useEffect(() => { load(); }, [load]);

  const save = async (next) => {
    setBusy(true); setMsg({ kind: '', text: '' });
    try {
      await call('strategy-autonomy-save', { clientId, autonomy: { tier1: next.tier1, tier2: 'confirm', tier3: next.tier3 } });
      if (mounted.current) setMsg({ kind: 'ok', text: 'Saved.' });
    } catch (e) {
      if (mounted.current) { setMsg({ kind: 'err', text: e?.data?.error || e?.message || 'Could not save.' }); load(); }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <div id="x-strategy-agent-permissions-panel" data-section="agent-permissions" style={S.panel}>
      <h4 style={S.h}>Agent permissions</h4>
      <div id="x-strategy-agent-permissions-tier1-field" style={S.field}>
        <label htmlFor="x-strategy-agent-permissions-tier1" style={{ fontSize: 13, fontWeight: 600 }}>Small changes (drafts, edits, notes)</label>
        <select id="x-strategy-agent-permissions-tier1" style={S.select} value={tier1} disabled={busy} onChange={(e) => { setTier1(e.target.value); save({ tier1: e.target.value, tier3 }); }}>
          <option value="auto">Do it, then show Undo</option>
          <option value="confirm">Ask me first</option>
        </select>
        <p style={S.help}>Reversible changes can run straight away. Every one is logged and can be undone.</p>
      </div>
      <p id="x-strategy-agent-permissions-tier2-note" style={S.help}>Deletes and overwrites always ask first, with a warning about what changes.</p>
      <div id="x-strategy-agent-permissions-tier3-field" style={S.field}>
        <label htmlFor="x-strategy-agent-permissions-tier3" style={{ fontSize: 13, fontWeight: 600 }}>Sending or spending (posting, email, paid calls)</label>
        <select id="x-strategy-agent-permissions-tier3" style={S.select} value={tier3} disabled={busy} onChange={(e) => { setTier3(e.target.value); save({ tier1, tier3: e.target.value }); }}>
          <option value="confirm">Ask me first</option>
          <option value="typed">Ask me and make me type to confirm</option>
        </select>
        <p style={S.help}>Posting to X is locked to type-to-confirm whatever you pick here. Nothing publishes or spends without a card.</p>
      </div>
      {msg.text ? <p id="x-strategy-agent-permissions-message" role={msg.kind === 'err' ? 'alert' : 'status'} style={msg.kind === 'err' ? S.err : S.ok}>{msg.text}</p> : null}
      <div id="x-strategy-agent-recent-actions" data-section="agent-recent-actions">
        <h4 style={S.h}>Recent actions</h4>
        {log.length === 0 ? <p id="x-strategy-agent-recent-actions-empty" style={S.help}>Nothing yet.</p> : null}
        {log.slice(0, 20).map((r) => (
          <div key={r.id || r.undoId} id={`x-strategy-agent-recent-action-${r.id || r.undoId}`} style={S.logRow}>
            <span><b>{r.title || r.actionId}</b> {'·'} {r.status || 'done'} {logTime(r.at) ? `· ${logTime(r.at)}` : ''}</span>
            {r.undoneAt ? <span style={S.help}>Undone</span> : (r.undoId || r.id) && r.status !== 'failed' && r.undoable !== false ? (
              <UndoChip undoId={r.undoId || r.id} call={call} clientId={clientId} onUndone={load} />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
