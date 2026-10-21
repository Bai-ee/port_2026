'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { XCE_COLORS, XCE_RADII } from '../content-ui/xce-tokens';
import UndoChip from './UndoChip.jsx';
import AgentPreferencesSections from './AgentPreferencesSections.jsx';

// AgentPermissionsPanel - "Agent permissions": how much the strategy agent may do without asking, plus recent actions.
//   <AgentPermissionsPanel clientId call />
// Reads/writes strategy-autonomy-get|save; lists strategy-action-log with per-row Undo (strategy-action-undo).
// Destructive (tier 2) always asks; X publishing is locked to typed confirm, except trusted scheduling (owner opt-in):
// the agent may schedule posts the owner already approved, unchanged, with a cancel window and a daily cap.

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
  const [trusted, setTrusted] = useState({ enabled: false, minLeadMinutes: 10, dailyCap: 3 });
  const [refreshTrust, setRefreshTrust] = useState({ enabled: false, dailyCapUsd: 1 });
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
      if (au.trustedSchedule && typeof au.trustedSchedule === 'object') setTrusted({ enabled: au.trustedSchedule.enabled === true, minLeadMinutes: au.trustedSchedule.minLeadMinutes ?? 10, dailyCap: au.trustedSchedule.dailyCap ?? 3 });
      if (au.trustedRefresh && typeof au.trustedRefresh === 'object') setRefreshTrust({ enabled: au.trustedRefresh.enabled === true, dailyCapUsd: Number(au.trustedRefresh.dailyCapUsd) > 0 ? Number(au.trustedRefresh.dailyCapUsd) : 1 });
      setLog(Array.isArray(l?.log) ? l.log : Array.isArray(l?.entries) ? l.entries : []);
    } catch (e) {
      if (mounted.current) setMsg({ kind: 'err', text: e?.data?.error || e?.message || 'Could not load permissions.' });
    }
  }, [clientId, call]);
  useEffect(() => { load(); }, [load]);

  const save = async (next) => {
    setBusy(true); setMsg({ kind: '', text: '' });
    try {
      await call('strategy-autonomy-save', { clientId, autonomy: { tier1: next.tier1, tier2: 'confirm', tier3: next.tier3, ...(next.trustedSchedule ? { trustedSchedule: next.trustedSchedule } : {}), trustedRefresh: next.trustedRefresh || refreshTrust } });
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
        <p style={S.help}>Posting to X is locked to type-to-confirm whatever you pick here, except the trusted scheduling below.</p>
      </div>
      <div id="x-strategy-agent-permissions-trusted-field" style={S.field}>
        <label htmlFor="x-strategy-agent-permissions-trusted" style={{ fontSize: 13, fontWeight: 600, display: 'flex', gap: 8, alignItems: 'center' }}>
          <input id="x-strategy-agent-permissions-trusted" type="checkbox" checked={trusted.enabled} disabled={busy}
            onChange={(e) => { const t = { ...trusted, enabled: e.target.checked }; setTrusted(t); save({ tier1, tier3, trustedSchedule: t }); }} />
          Let the agent schedule posts I&apos;ve approved
        </label>
        <p style={S.help}>Only posts you approved and that haven&apos;t changed since. Never posts right away: at least the lead time ahead, so you can unschedule it. Everything else still asks.</p>
        {trusted.enabled ? (
          <div id="x-strategy-agent-permissions-trusted-limits" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <label htmlFor="x-strategy-agent-permissions-trusted-lead" style={{ ...S.field, flex: '1 1 140px', fontSize: 12.5 }}>
              Minimum lead (minutes)
              <select id="x-strategy-agent-permissions-trusted-lead" style={S.select} value={trusted.minLeadMinutes} disabled={busy}
                onChange={(e) => { const t = { ...trusted, minLeadMinutes: Number(e.target.value) }; setTrusted(t); save({ tier1, tier3, trustedSchedule: t }); }}>
                {[10, 30, 60, 180, 720].map((m) => <option key={m} value={m}>{m >= 60 ? `${m / 60} h` : `${m} min`}</option>)}
              </select>
            </label>
            <label htmlFor="x-strategy-agent-permissions-trusted-cap" style={{ ...S.field, flex: '1 1 140px', fontSize: 12.5 }}>
              Most per day
              <select id="x-strategy-agent-permissions-trusted-cap" style={S.select} value={trusted.dailyCap} disabled={busy}
                onChange={(e) => { const t = { ...trusted, dailyCap: Number(e.target.value) }; setTrusted(t); save({ tier1, tier3, trustedSchedule: t }); }}>
                {[1, 2, 3, 5, 10].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
        ) : null}
      </div>
      <div id="agent-permissions-trusted-refresh-field" style={S.field}>
        <label htmlFor="agent-permissions-trusted-refresh-toggle" style={{ fontSize: 13, fontWeight: 600, display: 'flex', gap: 8, alignItems: 'center' }}>
          <input id="agent-permissions-trusted-refresh-toggle" type="checkbox" checked={refreshTrust.enabled} disabled={busy}
            onChange={(e) => { const r = { ...refreshTrust, enabled: e.target.checked }; setRefreshTrust(r); save({ tier1, tier3, ...(trusted.enabled ? { trustedSchedule: trusted } : {}), trustedRefresh: r }); }} />
          Let the agent refresh paid sources itself (X Monitor, Market signals, Analysis, Renders)
        </label>
        {refreshTrust.enabled ? (
          <label htmlFor="agent-permissions-trusted-refresh-cap" style={{ ...S.field, fontSize: 12.5 }}>
            Daily cap $
            <input id="agent-permissions-trusted-refresh-cap" type="number" min={0.1} max={20} step={0.1} style={S.select} value={refreshTrust.dailyCapUsd} disabled={busy}
              onChange={(e) => { const v = Math.min(20, Math.max(0.1, Number(e.target.value) || 1)); setRefreshTrust({ ...refreshTrust, dailyCapUsd: v }); }}
              onBlur={() => save({ tier1, tier3, ...(trusted.enabled ? { trustedSchedule: trusted } : {}), trustedRefresh: refreshTrust })} />
          </label>
        ) : null}
        <p id="agent-permissions-trusted-refresh-note" style={S.help}>Free sources (recent posts, hot quotes, bookmarks, quote targets, strategy accounts) always refresh on request. X posting stays typed-confirm.</p>
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
      <AgentPreferencesSections clientId={clientId} call={call} />
    </div>
  );
}
