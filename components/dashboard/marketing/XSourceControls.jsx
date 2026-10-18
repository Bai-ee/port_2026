'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { formatXSpendLine, buildPricingBody, X_CAP_SOURCES, sourceCapsForm } from './x-source-model.js';

const USAGE_ENDPOINT = '/api/admin/x-usage';

// Per-row "Mac | X API" segmented toggle + "Daily" chip (auto daily, shown only for X API). Presentational; full wording in titles.
export function XSourceToggle({ groupId, source, autoDaily, disabled, onSource, onAutoDaily }) {
  return (
    <div id={`marketing-refresh-source-${groupId}`} className="mr-source" role="group" aria-label="Data source">
      <button type="button" className="mr-source-opt" title="Mac worker via bird (free)" aria-label="Mac (free)" aria-pressed={source === 'mac'} disabled={disabled} onClick={() => onSource('mac')}>MAC</button>
      <button type="button" className="mr-source-opt" title="Paid X API" aria-label="X API (paid)" aria-pressed={source === 'x-api'} disabled={disabled} onClick={() => onSource('x-api')}>X API</button>
      {source === 'x-api' ? (
        <label id={`marketing-refresh-autodaily-${groupId}`} className="mr-chip" title="Auto daily (paid X API)" data-on={autoDaily ? 'true' : 'false'} htmlFor={`marketing-refresh-autodaily-checkbox-${groupId}`}>
          <input type="checkbox" id={`marketing-refresh-autodaily-checkbox-${groupId}`} checked={!!autoDaily} disabled={disabled} onChange={(e) => onAutoDaily(e.target.checked)} />
          DAILY
        </label>
      ) : null}
    </div>
  );
}

// Header line "X API today: ..." + inline "Set rate" form. Admin-only route: a failed read hides the whole block.
export function XSpendLine({ getIdToken, active }) {
  const [usage, setUsage] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ perPostReadUsd: '', perUserLookupUsd: '', dailyReadCap: '' });
  const [caps, setCaps] = useState(() => sourceCapsForm(null));
  const [msg, setMsg] = useState('');

  const authHeaders = useCallback(async () => {
    const token = getIdToken ? await getIdToken() : null;
    return { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  }, [getIdToken]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(USAGE_ENDPOINT, { headers: await authHeaders() });
      if (!res.ok) { setHidden(true); return; }
      setUsage(await res.json());
      setHidden(false);
    } catch { setHidden(true); }
  }, [authHeaders]);

  useEffect(() => { if (active) load(); }, [active, load]);

  const save = async () => {
    const built = buildPricingBody({ ...form, sourceCaps: caps });
    if (built.error) { setMsg(built.error); return; }
    setMsg('Saving…');
    try {
      const res = await fetch(USAGE_ENDPOINT, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(built.body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Save failed.');
      setMsg('Saved.');
      setFormOpen(false);
      load();
    } catch (e) { setMsg(e?.message || 'Save failed.'); }
  };

  if (hidden) return null;
  const field = (key, label) => (
    <label className="mr-rate-field" htmlFor={`marketing-refresh-rate-${key}`}>
      {label}
      <input id={`marketing-refresh-rate-${key}`} type="number" min="0" step="any" inputMode="decimal" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </label>
  );
  return (
    <div id="marketing-refresh-x-spend-shell">
      <div id="marketing-refresh-x-spend-line">
        <span>{usage ? formatXSpendLine(usage) : 'X API today: loading…'}</span>
        <button type="button" id="marketing-refresh-x-rate-link" className="mr-config-link" onClick={() => { setFormOpen((v) => !v); setMsg(''); setCaps(sourceCapsForm(usage?.pricing)); }}>Set rate</button>
      </div>
      {formOpen ? (
        <div id="marketing-refresh-x-rate-form">
          {field('perPostReadUsd', 'USD per post read')}
          {field('perUserLookupUsd', 'USD per user lookup')}
          {field('dailyReadCap', 'Daily read cap (posts)')}
          <div id="marketing-refresh-x-source-caps" role="group" aria-label="Per-source daily caps">
            <span id="marketing-refresh-x-source-caps-title">Per-source daily caps (reads today / cap; blank = no cap)</span>
            {X_CAP_SOURCES.map(({ id, label }) => {
              const used = usage?.today?.bySource?.[id];
              const reads = used ? (Number(used.readPosts) || 0) + (Number(used.userReads) || 0) : 0;
              return (
                <label key={id} className="mr-rate-field" htmlFor={`marketing-refresh-x-cap-${id}`}>
                  {label} · {reads} today
                  <input id={`marketing-refresh-x-cap-${id}`} type="number" min="0" step="1" inputMode="numeric" value={caps[id]} onChange={(e) => setCaps({ ...caps, [id]: e.target.value })} />
                </label>
              );
            })}
          </div>
          <div id="marketing-refresh-x-rate-actions">
            <button type="button" id="marketing-refresh-x-rate-save" onClick={save}>Save rate</button>
            <span id="marketing-refresh-x-rate-msg" role="status">{msg}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
