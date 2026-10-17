'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { REFRESH_GROUPS, paidGroupsFor, estimateFor, readLastRefreshed, groupFreshness } from './refresh-groups.js';
import { useMarketingContentCall } from './useMarketingContentCall';
import { XSourceToggle, XSpendLine } from './XSourceControls.jsx';
import { normalizeDataSources, sourceFor, autoDailyFor, withSource, withAutoDaily, sourceGroupsPresent, xApiPaidRows, estimatesByGroup, selectionUsesXApi } from './x-source-model.js';

const SELECTION_KEY = 'marketing-refresh-selection-v1';
const FREE_IDS = REFRESH_GROUPS.filter((g) => !g.paid).map((g) => g.id);

// Only free selections are ever restored: paid groups (and model copy) start OFF every session.
function readSelection() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SELECTION_KEY) || '{}');
    const ids = Array.isArray(parsed?.ids) ? parsed.ids.filter((id) => FREE_IDS.includes(id)) : [];
    return { ids, todayWithModel: false };
  } catch {
    return { ids: [], todayWithModel: false };
  }
}

function writeSelection(selection) {
  try {
    window.localStorage.setItem(SELECTION_KEY, JSON.stringify({ ids: selection.ids.filter((id) => FREE_IDS.includes(id)) }));
  } catch { /* storage unavailable */ }
}

function relativeTime(iso) {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return 'Never refreshed here';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

const ordered = (ids) => REFRESH_GROUPS.map((g) => g.id).filter((id) => ids.includes(id));

const CONFIG_LINK_IDS = ['market-signals', 'x-monitor', 'today-queue'];

// Sum of the known dollar figures + calls over the paid rows; `unknownUsd` flags rows with no dollar figure.
function totalsFor(paid) {
  let usd = 0;
  let calls = 0;
  let unknownUsd = false;
  paid.forEach((p) => {
    const e = p.estimate;
    if (e && typeof e.usd === 'number') usd += e.usd; else unknownUsd = true;
    if (e && typeof e.calls === 'number') calls += e.calls;
  });
  return { usd, calls, unknownUsd };
}

export default function MarketingRefreshControl({ running = false, onRun, estimateCtx, onOpenConfig, freshnessCtx, getIdToken, clientId }) {
  const [open, setOpen] = useState(false);
  // Server freshness (strategy-freshness = the same bundle the strategy agent's get_freshness reads), re-read when the
  // panel opens and after a run ends, so the panel and the agent agree on what is stale. A passed freshnessCtx wins.
  const { call } = useMarketingContentCall(getIdToken);
  const [serverFreshness, setServerFreshness] = useState(null);
  useEffect(() => {
    if (!open || running || !clientId || !getIdToken) return undefined;
    let live = true;
    call('strategy-freshness', { clientId }).then((r) => { if (live) setServerFreshness(r?.groups || null); }).catch(() => {});
    return () => { live = false; };
  }, [open, running, clientId, getIdToken, call]);
  const freshness = freshnessCtx || serverFreshness;
  const [selection, setSelection] = useState({ ids: [], todayWithModel: false });
  const [last, setLast] = useState({});
  const [pending, setPending] = useState(null); // selection awaiting confirm
  // X data sources (Mac bird vs X API) per group, loaded with the panel; a failed read leaves everything on the free Mac path.
  const [sources, setSources] = useState(() => normalizeDataSources(null));
  const [sourceNote, setSourceNote] = useState('');
  const [xEstimates, setXEstimates] = useState({});
  const sourceGroupIds = useMemo(() => sourceGroupsPresent(REFRESH_GROUPS), []);
  useEffect(() => {
    if (!open || !clientId || !getIdToken) return undefined;
    let live = true;
    call('x-data-sources-get', { clientId }).then((r) => { if (live) { setSources(normalizeDataSources(r)); setXEstimates(estimatesByGroup(r)); } }).catch(() => {});
    return () => { live = false; };
  }, [open, clientId, getIdToken, call]);

  const saveSources = useCallback(async (next) => {
    const prev = sources;
    setSources(next);
    setPending(null);
    setSourceNote('');
    try {
      const r = await call('x-data-sources-save', { clientId, strategyAccounts: next.strategyAccounts, quoteTargets: next.quoteTargets, autoDaily: next.autoDaily });
      if (r && r.dataSources) setSources(normalizeDataSources(r));
    } catch (e) {
      setSources(prev);
      setSourceNote(e?.message || 'Could not save the data source.');
    }
  }, [sources, call, clientId]);

  useEffect(() => { setSelection(readSelection()); }, []);
  useEffect(() => { if (open) setLast(readLastRefreshed()); }, [open, running]);

  const update = useCallback((next) => { setSelection(next); writeSelection(next); setPending(null); }, []);

  const toggle = (id) => {
    const ids = selection.ids.includes(id) ? selection.ids.filter((x) => x !== id) : [...selection.ids, id];
    update({ ...selection, ids, todayWithModel: id === 'today-queue' && !ids.includes(id) ? false : selection.todayWithModel });
  };

  const attempt = (sel) => {
    const full = { ids: ordered(sel.ids), todayWithModel: !!sel.todayWithModel && sel.ids.includes('today-queue') };
    if (!full.ids.length || running) return;
    if (paidGroupsFor(full).length || xApiPaidRows(full, sources).length) { setPending(full); return; }
    setPending(null);
    if (typeof onRun === 'function') onRun(full);
  };

  // Cancel also unticks the paid groups so a stale paid selection never survives into the next Run.
  const cancel = () => {
    const paidIds = new Set((pending ? paidGroupsFor(pending) : []).map((g) => g.id));
    const ids = selection.ids.filter((id) => !paidIds.has(id));
    const todayWithModel = paidIds.has('today-queue') ? false : selection.todayWithModel;
    update({ ...selection, ids, todayWithModel });
  };

  const confirm = () => {
    const sel = pending;
    setPending(null);
    // xApiConfirmed is set ONLY here, and only when this confirm row listed an X API group with its estimate.
    if (sel && typeof onRun === 'function') onRun(selectionUsesXApi(sel, sources) ? { ...sel, xApiConfirmed: true } : sel);
  };

  const paid = useMemo(() => {
    if (!pending) return [];
    const base = paidGroupsFor(pending, estimateCtx || {});
    return [...base, ...xApiPaidRows(pending, sources, base, xEstimates, REFRESH_GROUPS)];
  }, [pending, estimateCtx, sources, xEstimates]);
  const totals = useMemo(() => totalsFor(paid), [paid]);

  return (
    <div id="marketing-refresh-shell">
      <button
        type="button"
        id="marketing-refresh-button"
        disabled={running}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {running ? 'Refreshing…' : 'Refresh'}
      </button>

      {open ? (
        <div id="marketing-refresh-panel" role="group" aria-label="Refresh data">
          <XSpendLine getIdToken={getIdToken} active={open} />
          <div id="marketing-refresh-group-list">
            {REFRESH_GROUPS.map((g) => {
              const on = selection.ids.includes(g.id);
              const metaEstimate = estimateCtx ? estimateFor(g.id, { ...estimateCtx, todayWithModel: selection.todayWithModel }).text : g.cost;
              return (
                <div key={g.id} id={`marketing-refresh-group-row-${g.id}`} className="mr-row" data-paid={g.paid ? 'true' : 'false'}>
                  <label className="mr-row-main" htmlFor={`marketing-refresh-toggle-${g.id}`}>
                    <input
                      type="checkbox"
                      id={`marketing-refresh-toggle-${g.id}`}
                      checked={on}
                      disabled={running}
                      onChange={() => toggle(g.id)}
                    />
                    <span className="mr-row-text">
                      <span className="mr-row-label">{g.n}. {g.label}</span>
                      <span className="mr-row-updates">{g.updates}</span>
                      <span className="mr-row-meta">{relativeTime(last[g.id])} · {metaEstimate}</span>
                      {(() => {
                        const f = groupFreshness(g.id, { lastRefreshed: last, serverAsOf: freshness?.serverAsOf, staleAfterHours: freshness?.staleAfterHours?.[g.id] });
                        const label = f.asOf ? (f.stale ? `stale · updated ${f.ageHours < 48 ? `${Math.round(f.ageHours)}h` : `${Math.round(f.ageHours / 24)}d`} ago` : `updated ${f.ageHours < 1 ? '<1' : Math.round(f.ageHours)}h ago`) : 'stale · no refresh recorded';
                        return <span id={`marketing-refresh-freshness-${g.id}`} className="mr-row-freshness" data-stale={f.stale ? 'true' : 'false'}>{label}</span>;
                      })()}
                    </span>
                  </label>
                  {g.id === 'today-queue' ? (
                    <label id="marketing-refresh-today-model-option" className="mr-row-option" htmlFor="marketing-refresh-today-model-checkbox">
                      <input
                        type="checkbox"
                        id="marketing-refresh-today-model-checkbox"
                        checked={selection.todayWithModel}
                        disabled={running}
                        onChange={(e) => update({ ...selection, todayWithModel: e.target.checked })}
                      />
                      with model copy
                    </label>
                  ) : null}
                  {sourceGroupIds.includes(g.id) ? (
                    <XSourceToggle
                      groupId={g.id}
                      source={sourceFor(sources, g.id)}
                      autoDaily={autoDailyFor(sources, g.id)}
                      disabled={running}
                      onSource={(src) => saveSources(withSource(sources, g.id, src))}
                      onAutoDaily={(on) => saveSources(withAutoDaily(sources, g.id, on))}
                    />
                  ) : null}
                  {typeof onOpenConfig === 'function' && CONFIG_LINK_IDS.includes(g.id) ? (
                    <button
                      type="button"
                      id={`marketing-refresh-config-link-${g.id}`}
                      className="mr-config-link"
                      onClick={() => onOpenConfig(g.id)}
                    >
                      What runs →
                    </button>
                  ) : null}
                  <button
                    type="button"
                    id={`marketing-refresh-run-only-${g.id}`}
                    className="mr-run-only"
                    disabled={running}
                    onClick={() => attempt({ ids: [g.id], todayWithModel: g.id === 'today-queue' ? selection.todayWithModel : false })}
                  >
                    Run only this
                  </button>
                </div>
              );
            })}
          </div>

          {pending && paid.length ? (
            <div id="marketing-refresh-confirm-row" role="alert">
              <div id="marketing-refresh-confirm-text">
                Nothing runs until you confirm. This will spend on:
                <ul id="marketing-refresh-confirm-list">
                  {paid.map((p) => <li key={p.id}><strong>{p.label}</strong> — {p.estimate?.text || p.cost}</li>)}
                </ul>
                <div id="marketing-refresh-confirm-total">
                  Total: {totals.usd > 0 ? `${totals.unknownUsd ? '≥' : ''}~$${totals.usd.toFixed(2)}` : 'no known dollar figure'}
                  {totals.calls > 0 ? ` · ${totals.calls} calls` : ''}
                  {totals.unknownUsd && totals.usd > 0 ? ' + items without a dollar figure' : ''}
                </div>
              </div>
              <div id="marketing-refresh-confirm-actions">
                <button type="button" id="marketing-refresh-confirm-button" onClick={confirm}>Confirm and run</button>
                <button type="button" id="marketing-refresh-cancel-button" onClick={cancel}>Cancel</button>
              </div>
            </div>
          ) : null}

          {sourceNote ? <div id="marketing-refresh-source-note" role="alert">{sourceNote}</div> : null}

          <div id="marketing-refresh-footer-note">Toggles in each card decide what a group searches. Refresh only runs it.</div>

          <div id="marketing-refresh-footer-row">
            <span id="marketing-refresh-selected-count">{selection.ids.length} selected</span>
            <button
              type="button"
              id="marketing-refresh-run-selected-button"
              disabled={running || !selection.ids.length}
              onClick={() => attempt(selection)}
            >
              Run selected
            </button>
          </div>
        </div>
      ) : null}

      <style jsx global>{`
        #marketing-refresh-shell { position: relative; display: inline-block; }
        #marketing-refresh-button { min-height: 44px; padding: 0 16px; border: 1px solid currentColor; border-radius: 999px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
        #marketing-refresh-button:disabled { opacity: 0.5; cursor: default; }
        #marketing-refresh-panel { margin-top: 8px; width: min(520px, 92vw); padding: 12px; border: 1px solid color-mix(in srgb, var(--t-text-strong) 15%, transparent); border-radius: 12px; background: var(--t-surface); color: var(--t-text); box-shadow: 0 8px 24px rgba(0,0,0,0.12); text-align: left; }
        #marketing-refresh-panel .mr-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid color-mix(in srgb, var(--t-text-strong) 8%, transparent); }
        #marketing-refresh-panel .mr-row-main { display: flex; flex: 1 1 260px; gap: 10px; align-items: flex-start; min-height: 44px; cursor: pointer; }
        #marketing-refresh-panel .mr-row-text { display: flex; flex-direction: column; gap: 2px; }
        #marketing-refresh-panel .mr-row-label { font-weight: 600; }
        #marketing-refresh-panel .mr-row-updates { font-size: 13px; }
        #marketing-refresh-panel .mr-row-meta { font-size: 12px; opacity: 0.65; }
        #marketing-refresh-panel .mr-row-freshness { font-size: 12px; color: var(--t-text); opacity: 0.65; }
        #marketing-refresh-panel .mr-row-freshness[data-stale="true"] { color: var(--t-danger); opacity: 1; }
        #marketing-refresh-panel .mr-row-option { display: flex; align-items: center; gap: 6px; min-height: 44px; font-size: 13px; }
        #marketing-refresh-panel input[type="checkbox"] { width: 20px; height: 20px; margin-top: 2px; }
        #marketing-refresh-panel button { min-height: 44px; padding: 0 14px; border: 1px solid color-mix(in srgb, var(--t-text-strong) 30%, transparent); border-radius: 8px; background: var(--t-surface); color: inherit; font: inherit; cursor: pointer; }
        #marketing-refresh-panel button:disabled { opacity: 0.5; cursor: default; }
        #marketing-refresh-confirm-row { margin-top: 10px; padding: 10px; border: 1px solid #b45309; border-radius: 8px; background: var(--t-raised); font-size: 14px; }
        #marketing-refresh-confirm-total { margin-top: 8px; font-weight: 600; }
        #marketing-refresh-footer-note { margin-top: 10px; font-size: 12px; opacity: 0.65; }
        #marketing-refresh-panel .mr-config-link { border-color: transparent; background: transparent; text-decoration: underline; padding: 0 8px; }
        #marketing-refresh-panel .mr-source { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; flex: 1 1 100%; }
        #marketing-refresh-panel .mr-source-opt { padding: 0 10px; font-size: 13px; }
        #marketing-refresh-panel .mr-source-opt[aria-pressed="true"] { background: var(--t-raised); border-color: var(--t-text-strong); font-weight: 600; }
        #marketing-refresh-x-spend-shell { margin-bottom: 8px; font-size: 13px; }
        #marketing-refresh-x-spend-line { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
        #marketing-refresh-x-rate-form { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; padding: 10px; border: 1px solid color-mix(in srgb, var(--t-text-strong) 15%, transparent); border-radius: 8px; }
        #marketing-refresh-x-rate-form .mr-rate-field { display: flex; flex-direction: column; gap: 2px; }
        #marketing-refresh-x-rate-form input { min-height: 44px; padding: 0 10px; border: 1px solid color-mix(in srgb, var(--t-text-strong) 30%, transparent); border-radius: 8px; background: var(--t-surface); color: inherit; font: inherit; }
        #marketing-refresh-x-rate-actions { display: flex; align-items: center; gap: 8px; }
        #marketing-refresh-source-note { margin-top: 8px; font-size: 13px; color: var(--t-danger); }
        #marketing-refresh-confirm-list { margin: 6px 0 0 18px; padding: 0; }
        #marketing-refresh-confirm-actions { display: flex; gap: 8px; margin-top: 10px; }
        #marketing-refresh-footer-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; }
        @media (max-width: 480px) {
          #marketing-refresh-shell { display: block; }
          #marketing-refresh-panel { width: 100%; box-sizing: border-box; }
          #marketing-refresh-panel input, #marketing-refresh-panel button { font-size: 16px; }
        }
      `}</style>
    </div>
  );
}
