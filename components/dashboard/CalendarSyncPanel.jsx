'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CalendarSync, RefreshCw } from 'lucide-react';
import { readImpersonateClientId, withImpersonation } from '../../lib/dashboard/bootstrap-session.js';

// Synced calendars — the loaded client also posts what OTHER clients' calendars schedule, on its own connected
// accounts (features/social-posting/calendar-sync.js). One row per other client: X mode (copy / repost / off),
// Instagram mode (copy / off), delay. Saving writes client_configs.calendarSyncs and reconciles at once, so the
// mirrors appear on this client's calendar right away. Mounted inside the Social Accounts card (admin only).
// Own <style jsx>: the parent's scoped styles do not reach a child component's elements.

const X_MODES = [
  { value: 'copy', label: 'Copy (own post)' },
  { value: 'repost', label: 'Repost (retweet theirs)' },
  { value: 'off', label: 'Off' },
];
const IG_MODES = [
  { value: 'copy', label: 'Copy' },
  { value: 'off', label: 'Off' },
];

const describeRun = (run) => (run || []).map((e) => {
  const bits = [`${e.created} added`, `${e.retired} removed`, `${e.kept} kept`];
  if (e.skipped?.length) bits.push(`${e.skipped.length} skipped`);
  if (e.errors?.length) bits.push(`${e.errors.length} failed: ${e.errors.map((x) => x.message).join('; ')}`);
  return `${e.clientId}: ${bits.join(', ')}`;
}).join(' · ');

export default function CalendarSyncPanel({ activeClientId, getIdToken }) {
  const [clients, setClients] = useState([]);
  const [syncs, setSyncs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [dirty, setDirty] = useState(false);

  const post = useCallback(async (body) => {
    const token = await getIdToken();
    const res = await fetch(withImpersonation('/api/social-posting', readImpersonateClientId()), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return data;
  }, [getIdToken]);

  const load = useCallback(async () => {
    if (!activeClientId) return;
    setLoading(true);
    setNotice(null);
    try {
      const token = await getIdToken();
      const [list, cfg] = await Promise.all([
        fetch('/api/admin/clients', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }).then((r) => r.json()).catch(() => ({ clients: [] })),
        post({ action: 'calendar-syncs' }),
      ]);
      setClients((list.clients || []).filter((c) => c.clientId && c.clientId !== activeClientId));
      setSyncs(cfg.syncs || []);
      setDirty(false);
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }, [activeClientId, getIdToken, post]);

  useEffect(() => { load(); }, [load]);

  const entryFor = (clientId) => syncs.find((s) => s.clientId === clientId) || { clientId, x: 'off', instagram: 'off', offsetMinutes: 0 };
  const setEntry = (clientId, patch) => {
    setSyncs((prev) => {
      const cur = prev.find((s) => s.clientId === clientId) || { clientId, x: 'off', instagram: 'off', offsetMinutes: 0 };
      const next = { ...cur, ...patch };
      const rest = prev.filter((s) => s.clientId !== clientId);
      return next.x === 'off' && next.instagram === 'off' ? rest : [...rest, next];
    });
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const data = await post({ action: 'set-calendar-syncs', syncs });
      setSyncs(data.syncs || []);
      setDirty(false);
      setNotice({ kind: 'ok', text: data.run?.length ? `Saved. ${describeRun(data.run)}` : 'Saved. No calendars synced.' });
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const data = await post({ action: 'run-calendar-sync' });
      setNotice({ kind: 'ok', text: data.run?.length ? describeRun(data.run) : 'No calendars synced.' });
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const active = syncs.length;
  return (
    <section id="calendar-sync-panel" className="cs-panel">
      <div className="cs-head">
        <span className="cs-kicker"><CalendarSync size={13} /> Synced calendars</span>
        <small>{active ? `${active} SOURCE${active === 1 ? '' : 'S'}` : 'OFF'}</small>
      </div>
      <p className="cs-sub">
        Also post what another client&apos;s calendar schedules, on <strong>this</strong> client&apos;s connected accounts. Each synced post
        appears on this calendar as its own row (edit, unschedule or reject it here without touching the source). Turning a source
        on is standing consent to publish those posts from this client&apos;s X and Instagram.
      </p>
      {!activeClientId ? (
        <div className="cs-empty">Load a client first.</div>
      ) : loading ? (
        <div className="cs-empty">Loading…</div>
      ) : !clients.length ? (
        <div className="cs-empty">No other clients to sync from.</div>
      ) : (
        <div id="calendar-sync-source-list" className="cs-list">
          {clients.map((c) => {
            const e = entryFor(c.clientId);
            const on = e.x !== 'off' || e.instagram !== 'off';
            return (
              <div key={c.clientId} id={`calendar-sync-source-${c.clientId}`} className={`cs-row${on ? ' cs-row-on' : ''}`}>
                <div className="cs-row-name">
                  <strong>{c.companyName || c.clientId}</strong>
                  <small>{c.clientId}</small>
                </div>
                <label className="cs-field">
                  <span>X</span>
                  <select value={e.x} onChange={(ev) => setEntry(c.clientId, { x: ev.target.value })} disabled={busy}>
                    {X_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </label>
                <label className="cs-field">
                  <span>Instagram</span>
                  <select value={e.instagram} onChange={(ev) => setEntry(c.clientId, { instagram: ev.target.value })} disabled={busy}>
                    {IG_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </label>
                <label className="cs-field cs-field-delay">
                  <span>Delay (min)</span>
                  <input type="number" min={0} max={10080} step={5} value={e.offsetMinutes} disabled={busy || !on}
                    onChange={(ev) => setEntry(c.clientId, { offsetMinutes: Number(ev.target.value) || 0 })} />
                </label>
              </div>
            );
          })}
        </div>
      )}
      <div id="calendar-sync-actions-row" className="cs-actions">
        <button type="button" id="calendar-sync-save-button" className="cs-primary" onClick={save} disabled={busy || !dirty || !activeClientId}>
          {busy ? 'Working…' : 'Save & sync now'}
        </button>
        <button type="button" id="calendar-sync-run-button" onClick={runNow} disabled={busy || !active || dirty}>
          <RefreshCw size={13} /> Sync now
        </button>
        <small className="cs-hint">Also runs every 15 minutes with the publish sweep.</small>
      </div>
      {notice ? <p id="calendar-sync-notice" className={`cs-notice cs-notice-${notice.kind}`}>{notice.text}</p> : null}
      <style jsx>{`
        .cs-panel { border: 1px solid var(--t-border-subtle); border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; background: var(--t-surface); }
        .cs-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 6px; }
        .cs-kicker { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
        .cs-head small { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em; opacity: 0.6; }
        .cs-sub { margin: 0 0 12px; font-size: 13px; line-height: 1.45; opacity: 0.8; }
        .cs-empty { font-size: 13px; opacity: 0.6; padding: 8px 0; }
        .cs-list { display: flex; flex-direction: column; gap: 8px; }
        .cs-row { display: grid; grid-template-columns: minmax(140px, 1.4fr) 1fr 1fr 110px; gap: 10px; align-items: end; padding: 10px 12px; border: 1px solid var(--t-border-faint); border-radius: 8px; opacity: 0.75; }
        .cs-row-on { opacity: 1; border-color: var(--t-text); }
        .cs-row-name { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .cs-row-name strong { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cs-row-name small { font-family: var(--font-mono); font-size: 10px; opacity: 0.55; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cs-field { display: flex; flex-direction: column; gap: 4px; font-size: 11px; opacity: 0.85; }
        .cs-field select, .cs-field input { font: inherit; font-size: 13px; padding: 6px 8px; border: 1px solid var(--t-control-border); border-radius: 6px; background: var(--t-surface); color: inherit; width: 100%; box-sizing: border-box; }
        .cs-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 12px; }
        .cs-actions button { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 13px; padding: 7px 12px; border-radius: 999px; border: 1px solid var(--t-text); background: transparent; color: inherit; cursor: pointer; }
        .cs-actions button:disabled { opacity: 0.45; cursor: default; }
        .cs-actions .cs-primary { background: var(--t-text); color: var(--t-surface); }
        .cs-hint { font-size: 11px; opacity: 0.6; }
        .cs-notice { margin: 10px 0 0; font-size: 13px; }
        .cs-notice-error { color: var(--t-danger); }
        @media (max-width: 640px) {
          .cs-row { grid-template-columns: 1fr 1fr; }
          .cs-row-name { grid-column: 1 / -1; }
          .cs-field-delay { grid-column: 1 / -1; }
        }
      `}</style>
    </section>
  );
}
