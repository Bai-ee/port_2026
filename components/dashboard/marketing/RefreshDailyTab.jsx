'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { REFRESH_GROUPS, paidGroupsFor } from './refresh-groups.js';

// Refresh modal "Daily (automatic)" tab: which groups the unattended crons run for this client, saved server-side
// (digest_config/{clientId}.refreshDaily via /api/admin/refresh-daily). Manual runs ("Run now") never read it.
// Rendered inside #marketing-refresh-panel, so it reuses that panel's row styles.

const ENDPOINT = '/api/admin/refresh-daily';

// When each cron-run group fires (UTC, vercel.json). The digest email sends at 13:00 UTC from whatever is saved.
const RUN_AT_UTC = { renders: '12:05', 'market-signals': '12:20', 'x-search': '12:20', analysis: '12:40', 'today-queue': '11:30' };
const NOT_DAILY = {
  'strategy-accounts': 'Automatic only through its X source "Auto daily" switch (Run now tab).',
  'quote-targets': 'Automatic only through its X source "Auto daily" switch (Run now tab).',
  'hot-quotes': 'Automatic: the 06:30 Mac scan runs it every morning. Press Hot now for a fresh set any time.',
  'x-monitor': 'Manual only — no automatic run.',
};

function localTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setUTCHours(h, m, 0, 0);
  try { return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return `${hhmm} UTC`; }
}

function totalUsd(rows) {
  let usd = 0;
  let unknown = false;
  rows.forEach((r) => { if (typeof r.estimate?.usd === 'number') usd += r.estimate.usd; else unknown = true; });
  return usd > 0 ? `${unknown ? '≥' : ''}~$${usd.toFixed(2)} per day` : 'no known dollar figure';
}

export default function RefreshDailyTab({ getIdToken, clientId, estimateCtx, disabled = false }) {
  const [saved, setSaved] = useState(null); // profile as stored (or the default)
  const [draft, setDraft] = useState(null); // { enabled, groups[] } being edited
  const [groupIds, setGroupIds] = useState([]);
  const [pending, setPending] = useState(null); // paid groups newly ticked, awaiting confirm
  const [msg, setMsg] = useState('');

  const headers = useCallback(async () => {
    const token = getIdToken ? await getIdToken() : null;
    return { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  }, [getIdToken]);

  useEffect(() => {
    if (!clientId) return undefined;
    let live = true;
    (async () => {
      try {
        const res = await fetch(`${ENDPOINT}?clientId=${encodeURIComponent(clientId)}`, { headers: await headers() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Could not load the Daily settings.');
        if (!live) return;
        setSaved(data.profile);
        setDraft({ enabled: data.profile.enabled, groups: data.profile.groups });
        setGroupIds(data.groupIds || []);
      } catch (e) { if (live) setMsg(e?.message || 'Could not load the Daily settings.'); }
    })();
    return () => { live = false; };
  }, [clientId, headers]);

  const dailyPaid = useMemo(() => (draft ? paidGroupsFor({ ids: draft.groups, todayWithModel: false }, estimateCtx || {}) : []), [draft, estimateCtx]);
  const dirty = Boolean(saved && draft) && (saved.enabled !== draft.enabled || [...saved.groups].sort().join() !== [...draft.groups].sort().join());

  const toggle = (id) => {
    setPending(null);
    setMsg('');
    setDraft((d) => ({ ...d, groups: d.groups.includes(id) ? d.groups.filter((g) => g !== id) : [...d.groups, id] }));
  };

  const write = async () => {
    setPending(null);
    setMsg('Saving…');
    try {
      const res = await fetch(ENDPOINT, { method: 'POST', headers: await headers(), body: JSON.stringify({ clientId, ...draft }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Save failed.');
      setSaved(data.profile);
      setDraft({ enabled: data.profile.enabled, groups: data.profile.groups });
      setMsg('Saved. The next automatic run uses it.');
    } catch (e) { setMsg(e?.message || 'Save failed.'); }
  };

  // Newly ticked paid groups (vs what is saved) are an ongoing daily spend: confirm them first.
  const save = () => {
    const before = new Set(saved?.enabled ? saved.groups : []);
    const added = draft.enabled ? dailyPaid.filter((p) => !before.has(p.id)) : [];
    if (added.length) { setPending(added); return; }
    write();
  };

  if (!draft) return <div id="marketing-refresh-daily-loading" className="mr-row-meta">{msg || 'Loading Daily settings…'}</div>;

  return (
    <div id="marketing-refresh-daily-tab">
      <label id="marketing-refresh-daily-switch" className="mr-row-main" htmlFor="marketing-refresh-daily-switch-checkbox">
        <input type="checkbox" id="marketing-refresh-daily-switch-checkbox" checked={draft.enabled} disabled={disabled} onChange={(e) => { setPending(null); setMsg(''); setDraft({ ...draft, enabled: e.target.checked }); }} />
        <span className="mr-row-text">
          <span className="mr-row-label">Run automatically every day</span>
          <span className="mr-row-updates">{draft.enabled ? 'The crons run the ticked groups below.' : 'Off: nothing refreshes on its own. The morning email uses your last manual refresh.'}</span>
          {!saved.saved ? <span className="mr-row-meta">Not saved yet — showing what runs today.</span> : null}
        </span>
      </label>

      <div id="marketing-refresh-daily-group-list" data-enabled={draft.enabled ? 'true' : 'false'}>
        {REFRESH_GROUPS.map((g) => {
          const daily = groupIds.includes(g.id);
          const on = daily && draft.groups.includes(g.id);
          return (
            <div key={g.id} id={`marketing-refresh-daily-row-${g.id}`} className="mr-row" data-paid={g.paid ? 'true' : 'false'}>
              <label className="mr-row-main" htmlFor={`marketing-refresh-daily-toggle-${g.id}`}>
                <input type="checkbox" id={`marketing-refresh-daily-toggle-${g.id}`} checked={on} disabled={disabled || !daily || !draft.enabled} onChange={() => toggle(g.id)} />
                <span className="mr-row-text">
                  <span className="mr-row-label">{g.n}. {g.label}</span>
                  <span className="mr-row-updates">{g.updates}</span>
                  <span className="mr-row-meta">{daily ? `Runs at ${localTime(RUN_AT_UTC[g.id])} · ${g.cost}` : NOT_DAILY[g.id] || 'Manual only.'}</span>
                </span>
              </label>
            </div>
          );
        })}
      </div>

      <div id="marketing-refresh-daily-cost">
        Daily paid groups: {draft.enabled && dailyPaid.length ? `${dailyPaid.map((p) => p.label).join(', ')} · ${totalUsd(dailyPaid)}` : 'none'}
      </div>

      {pending ? (
        <div id="marketing-refresh-daily-confirm-row" role="alert">
          <div id="marketing-refresh-daily-confirm-text">
            These will spend every day, automatically, until you untick them:
            <ul id="marketing-refresh-daily-confirm-list">
              {pending.map((p) => <li key={p.id}><strong>{p.label}</strong> — {p.estimate?.text || p.cost}</li>)}
            </ul>
          </div>
          <div id="marketing-refresh-daily-confirm-actions">
            <button type="button" id="marketing-refresh-daily-confirm-button" onClick={write}>Confirm and save</button>
            <button type="button" id="marketing-refresh-daily-cancel-button" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      ) : null}

      <div id="marketing-refresh-daily-footer-row">
        <span id="marketing-refresh-daily-msg" role="status">{msg || 'The email sends at ' + localTime('13:00') + ' from whatever is saved.'}</span>
        <button type="button" id="marketing-refresh-daily-save-button" disabled={disabled || !dirty} onClick={save}>Save</button>
      </div>

      <style jsx global>{`
        #marketing-refresh-daily-group-list[data-enabled="false"] { opacity: 0.55; }
        #marketing-refresh-daily-cost { margin-top: 10px; font-size: 13px; font-weight: 600; }
        #marketing-refresh-daily-confirm-row { margin-top: 10px; padding: 10px; border: 1px solid var(--t-warning-border); border-radius: 8px; background: var(--t-raised); font-size: 14px; }
        #marketing-refresh-daily-confirm-list { margin: 6px 0 0 18px; padding: 0; }
        #marketing-refresh-daily-confirm-actions { display: flex; gap: 8px; margin-top: 10px; }
        #marketing-refresh-daily-footer-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; font-size: 13px; }
      `}</style>
    </div>
  );
}
