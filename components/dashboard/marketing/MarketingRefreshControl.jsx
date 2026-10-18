'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Play, RefreshCw, Settings2, Sparkles } from 'lucide-react';
import { marqueeCardEdgeStyle } from '../../../pageSurfaceSystem';
import { REFRESH_GROUPS, paidGroupsFor, estimateFor, readLastRefreshed, groupFreshness } from './refresh-groups.js';
import { useMarketingContentCall } from './useMarketingContentCall';
import { XSourceToggle, XSpendLine } from './XSourceControls.jsx';
import RefreshDailyTab from './RefreshDailyTab.jsx';
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

const pad2 = (n) => String(n).padStart(2, '0');

// Compact row tag: a dollar floor when known, else the call count, else just PAID (full text lives in the row title).
function costTag(est) {
  if (est && typeof est.usd === 'number' && est.usd > 0) return `≥$${est.usd.toFixed(2)}`;
  if (est && typeof est.calls === 'number' && est.calls > 0) return `${est.calls} CALLS`;
  return 'PAID';
}

function costSummary(t) {
  const parts = [];
  if (t.usd > 0) parts.push(`${t.unknownUsd ? '≥' : ''}~$${t.usd.toFixed(2)}`);
  if (t.calls > 0) parts.push(`${t.calls} CALLS`);
  if (!parts.length) parts.push('PAID');
  return parts.join(' · ');
}

// variant 'popover' (default) = the Marketing Director button + dropdown panel.
// variant 'header' = the dashboard header pair: Refresh runs the remembered selection, Settings opens the
// same panel in a one-column card-style modal. Paid groups still go through the confirm row (opened in the modal).
export default function MarketingRefreshControl({ variant = 'popover', running = false, onRun, estimateCtx, onOpenConfig, freshnessCtx, getIdToken, clientId }) {
  const isHeader = variant === 'header';
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('now'); // 'now' = run now (manual) | 'daily' = what the crons run (RefreshDailyTab)
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
  // The header Refresh can run without the modal ever opening, so it loads sources on mount: the confirm check needs them.
  useEffect(() => {
    if ((!open && !isHeader) || !clientId || !getIdToken) return undefined;
    let live = true;
    call('x-data-sources-get', { clientId }).then((r) => { if (live) { setSources(normalizeDataSources(r)); setXEstimates(estimatesByGroup(r)); } }).catch(() => {});
    return () => { live = false; };
  }, [open, isHeader, clientId, getIdToken, call]);

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

  // The header modal closes once a run starts so the run terminal is in view.
  const fire = (sel) => {
    if (isHeader) setOpen(false);
    if (typeof onRun === 'function') onRun(sel);
  };

  const attempt = (sel) => {
    const full = { ids: ordered(sel.ids), todayWithModel: !!sel.todayWithModel && sel.ids.includes('today-queue') };
    if (!full.ids.length || running) return 'none';
    if (paidGroupsFor(full).length || xApiPaidRows(full, sources).length) { setPending(full); return 'confirm'; }
    setPending(null);
    fire(full);
    return 'ran';
  };

  // Header Refresh: nothing selected opens Settings; a paid selection opens the modal on its confirm row.
  const runFromHeader = () => {
    if (running) return;
    if (attempt(selection) !== 'ran') setOpen(true);
  };

  useEffect(() => {
    if (!isHeader || !open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; };
  }, [isHeader, open]);

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
    if (sel) fire(selectionUsesXApi(sel, sources) ? { ...sel, xApiConfirmed: true } : sel);
  };

  const paid = useMemo(() => {
    if (!pending) return [];
    const base = paidGroupsFor(pending, estimateCtx || {});
    return [...base, ...xApiPaidRows(pending, sources, base, xEstimates, REFRESH_GROUPS)];
  }, [pending, estimateCtx, sources, xEstimates]);
  const totals = useMemo(() => totalsFor(paid), [paid]);

  // Live preview of what the current selection would cost (same helpers the confirm row uses).
  const selectionPaid = useMemo(() => {
    const sel = { ids: selection.ids, todayWithModel: selection.todayWithModel };
    const base = paidGroupsFor(sel, estimateCtx || {});
    return [...base, ...xApiPaidRows(sel, sources, base, xEstimates, REFRESH_GROUPS)];
  }, [selection, estimateCtx, sources, xEstimates]);
  const selectionTotals = useMemo(() => totalsFor(selectionPaid), [selectionPaid]);

  const panel = (
        <div id="marketing-refresh-panel" role="group" aria-label="Refresh data">
          <div id="marketing-refresh-tab-row" role="tablist" aria-label="Refresh mode">
            <button type="button" role="tab" id="marketing-refresh-tab-now" className="mr-source-opt" aria-selected={tab === 'now'} aria-pressed={tab === 'now'} onClick={() => setTab('now')}>Run now</button>
            <button type="button" role="tab" id="marketing-refresh-tab-daily" className="mr-source-opt" aria-selected={tab === 'daily'} aria-pressed={tab === 'daily'} disabled={!clientId} onClick={() => { setPending(null); setTab('daily'); }}>Daily (automatic)</button>
          </div>
          {tab === 'daily' ? (<>
            <XSpendLine getIdToken={getIdToken} active={open} />
            <RefreshDailyTab getIdToken={getIdToken} clientId={clientId} estimateCtx={estimateCtx} disabled={running} />
          </>) : (<>
          <div id="marketing-refresh-summary-row">
            <div id="marketing-refresh-summary-count">
              <span id="marketing-refresh-summary-count-value">{pad2(selection.ids.length)}</span>
              <span id="marketing-refresh-summary-count-total">/{pad2(REFRESH_GROUPS.length)} SELECTED</span>
            </div>
            <div id="marketing-refresh-summary-meta">
              <span id="marketing-refresh-summary-estimate" data-paid={selectionPaid.length ? 'true' : 'false'}>
                {selection.ids.length ? (selectionPaid.length ? `EST ${costSummary(selectionTotals)}` : 'EST FREE') : 'NOTHING SELECTED'}
              </span>
              <XSpendLine getIdToken={getIdToken} active={open} />
            </div>
          </div>

          <div id="marketing-refresh-group-list" role="list">
            {REFRESH_GROUPS.map((g) => {
              const on = selection.ids.includes(g.id);
              const est = estimateCtx ? estimateFor(g.id, { ...estimateCtx, todayWithModel: selection.todayWithModel }) : { text: g.cost, usd: null };
              const xRow = sourceGroupIds.includes(g.id) && sourceFor(sources, g.id) === 'x-api';
              const paidNow = g.paid || xRow || (g.id === 'today-queue' && selection.todayWithModel);
              const f = groupFreshness(g.id, { lastRefreshed: last, serverAsOf: freshness?.serverAsOf, staleAfterHours: freshness?.staleAfterHours?.[g.id] });
              const age = f.asOf ? (f.ageHours < 1 ? '<1H' : f.ageHours < 48 ? `${Math.round(f.ageHours)}H` : `${Math.round(f.ageHours / 24)}D`) : 'NEVER';
              return (
                <div key={g.id} id={`marketing-refresh-group-row-${g.id}`} className="mr-row" role="listitem" data-paid={paidNow ? 'true' : 'false'} data-on={on ? 'true' : 'false'}>
                  <label className="mr-row-main" htmlFor={`marketing-refresh-toggle-${g.id}`} title={`${g.updates}\n${est.text || g.cost}`}>
                    <input
                      type="checkbox"
                      role="switch"
                      className="mr-switch"
                      id={`marketing-refresh-toggle-${g.id}`}
                      checked={on}
                      disabled={running}
                      onChange={() => toggle(g.id)}
                    />
                    <span className="mr-row-num">{pad2(g.n)}</span>
                    <span className="mr-row-text">
                      <span className="mr-row-label">{g.label}</span>
                      <span className="mr-row-meta">
                        <span id={`marketing-refresh-freshness-${g.id}`} className="mr-row-freshness" data-stale={f.stale ? 'true' : 'false'}>
                          <span className="mr-dot" aria-hidden="true" />{f.stale ? 'STALE · ' : ''}{age}
                        </span>
                        <span className="mr-row-cost" data-paid={paidNow ? 'true' : 'false'}>{paidNow ? costTag(est) : 'FREE'}</span>
                      </span>
                    </span>
                  </label>
                  <div className="mr-row-actions">
                    {g.id === 'today-queue' ? (
                      <label id="marketing-refresh-today-model-option" className="mr-chip" htmlFor="marketing-refresh-today-model-checkbox" title="Write today's drafts with the model (paid)" data-on={selection.todayWithModel ? 'true' : 'false'}>
                        <input
                          type="checkbox"
                          id="marketing-refresh-today-model-checkbox"
                          checked={selection.todayWithModel}
                          disabled={running}
                          onChange={(e) => update({ ...selection, todayWithModel: e.target.checked })}
                        />
                        <Sparkles size={13} strokeWidth={2} aria-hidden="true" />
                        <span>MODEL</span>
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
                        className="mr-icon-btn"
                        title="What runs"
                        aria-label={`What runs: ${g.label}`}
                        onClick={() => { if (isHeader) setOpen(false); onOpenConfig(g.id); }}
                      >
                        <ArrowUpRight size={15} strokeWidth={2} aria-hidden="true" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      id={`marketing-refresh-run-only-${g.id}`}
                      className="mr-icon-btn"
                      title="Run only this"
                      aria-label={`Run only ${g.label}`}
                      disabled={running}
                      onClick={() => attempt({ ids: [g.id], todayWithModel: g.id === 'today-queue' ? selection.todayWithModel : false })}
                    >
                      <Play size={13} strokeWidth={2} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {sourceNote ? <div id="marketing-refresh-source-note" role="alert">[ERROR: {sourceNote}]</div> : null}

          {pending && paid.length ? (
            <div id="marketing-refresh-confirm-row" role="alert">
              <div id="marketing-refresh-confirm-text">
                <span className="mr-caps">CONFIRM SPEND · NOTHING RUNS UNTIL YOU CONFIRM</span>
                <ul id="marketing-refresh-confirm-list">
                  {paid.map((p) => <li key={p.id}><span>{p.label}</span><span className="mr-confirm-cost">{p.estimate?.text || p.cost}</span></li>)}
                </ul>
                <div id="marketing-refresh-confirm-total">
                  TOTAL {totals.usd > 0 ? `${totals.unknownUsd ? '≥' : ''}~$${totals.usd.toFixed(2)}` : 'NO KNOWN DOLLAR FIGURE'}
                  {totals.calls > 0 ? ` · ${totals.calls} CALLS` : ''}
                  {totals.unknownUsd && totals.usd > 0 ? ' + ITEMS WITHOUT A DOLLAR FIGURE' : ''}
                </div>
              </div>
              <div id="marketing-refresh-confirm-actions">
                <button type="button" id="marketing-refresh-cancel-button" className="mr-ghost-btn" onClick={cancel}>Cancel</button>
                <button type="button" id="marketing-refresh-confirm-button" className="cta-pill-btn mr-primary-btn" onClick={confirm}>Confirm and run</button>
              </div>
            </div>
          ) : (
            <div id="marketing-refresh-footer-row">
              <span id="marketing-refresh-footer-note">CARD TOGGLES DECIDE WHAT EACH GROUP SEARCHES</span>
              <span id="marketing-refresh-selected-count" className="mr-sr-only">{selection.ids.length} selected</span>
              <button
                type="button"
                id="marketing-refresh-run-selected-button"
                className="cta-pill-btn mr-primary-btn"
                disabled={running || !selection.ids.length}
                onClick={() => attempt(selection)}
              >
                <Play size={13} strokeWidth={2} aria-hidden="true" />
                {running ? 'Refreshing…' : 'Run selected'}
              </button>
            </div>
          )}
          </>)}
        </div>
  );

  const selectedCount = selection.ids.length;

  return (
    <div id={isHeader ? 'header-refresh-group' : 'marketing-refresh-shell'}>
      {isHeader ? (
        <>
          <button
            type="button"
            id="header-refresh-settings-btn"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label="Refresh settings"
            title="Refresh settings"
            onClick={() => setOpen(true)}
          >
            <Settings2 size={15} strokeWidth={2} aria-hidden="true" />
          </button>
          {/* Keeps the former Connect button's id + class so its pill styling and animated border carry over. */}
          <button
            type="button"
            id="reseed-run-btn"
            className="cta-pill-btn"
            disabled={running}
            aria-label={running ? 'Refreshing' : 'Refresh'}
            onClick={runFromHeader}
            title={selectedCount ? `Refresh ${selectedCount} selected` : 'Choose what to refresh'}
          >
            <span id="header-refresh-run-label">{running ? 'Refreshing…' : 'Refresh'}</span>
            <RefreshCw id="header-refresh-run-icon" size={15} strokeWidth={2} aria-hidden="true" />          </button>
          {open && typeof document !== 'undefined' ? createPortal(
            <div
              id="refresh-settings-modal-overlay"
              role="dialog"
              aria-modal="true"
              aria-label="Refresh settings"
              onClick={() => setOpen(false)}
            >
              <div id="refresh-settings-modal-card" data-tooltip-disabled="true" onClick={(e) => e.stopPropagation()}>
                <div id="refresh-settings-modal-header" className="tile-detail-bento-cell" style={marqueeCardEdgeStyle}>
                  <h2 id="refresh-settings-modal-title">Refresh</h2>
                  <button id="refresh-settings-modal-close" type="button" onClick={() => setOpen(false)} aria-label="Close">[ ✕ ]</button>
                </div>
                <div id="refresh-settings-modal-body" className="tile-detail-bento-cell" style={marqueeCardEdgeStyle}>
                  <div id="refresh-settings-modal-content" className="tile-detail-tab-content">
                    {panel}
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          ) : null}
        </>
      ) : (
        <>
          <button
            type="button"
            id="marketing-refresh-button"
            disabled={running}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {running ? 'Refreshing…' : 'Refresh'}
          </button>
          {open ? panel : null}
        </>
      )}

      <style jsx global>{`
        #marketing-refresh-shell { position: relative; display: inline-block; }
        #marketing-refresh-button { min-height: 44px; padding: 0 16px; border: 1px solid currentColor; border-radius: 999px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
        #marketing-refresh-button:disabled { opacity: 0.5; cursor: default; }
        /* Refresh panel (Nothing-style): monochrome, type-led. Doto count = the one hero; mono caps = metadata;
           status colour only on values (stale = danger, paid = warning). */
        #marketing-refresh-panel { --mr-mono: var(--font-mono, "Space Mono", monospace); --mr-ui: var(--font-ui, "Space Grotesk", system-ui, sans-serif); margin-top: 8px; width: min(640px, 92vw); padding: 16px; border: 1px solid var(--t-border-subtle); border-radius: 12px; background: var(--t-surface); color: var(--t-text); text-align: left; font-family: var(--mr-ui); box-sizing: border-box; }
        #marketing-refresh-summary-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; padding-bottom: 14px; border-bottom: 1px solid var(--t-border-faint); }
        #marketing-refresh-summary-count { display: flex; align-items: baseline; gap: 8px; }
        #marketing-refresh-summary-count-value { font-family: "Doto", var(--mr-mono); font-weight: 700; font-size: 56px; line-height: 0.85; letter-spacing: -0.02em; color: var(--t-text-strong); }
        #marketing-refresh-summary-count-total, #marketing-refresh-summary-meta, #marketing-refresh-panel .mr-row-num, #marketing-refresh-panel .mr-row-meta, #marketing-refresh-footer-note, #marketing-refresh-panel .mr-caps { font-family: var(--mr-mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
        #marketing-refresh-summary-count-total { color: var(--t-text-secondary); }
        #marketing-refresh-summary-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; text-align: right; color: var(--t-text-secondary); min-width: 0; }
        #marketing-refresh-summary-estimate { color: var(--t-text); }
        #marketing-refresh-summary-estimate[data-paid="true"] { color: var(--t-warning); }
        #marketing-refresh-x-spend-shell { font-size: 11px; }
        #marketing-refresh-x-spend-line { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
        #marketing-refresh-x-rate-link { padding: 0; border: none; background: none; color: var(--t-text); font: inherit; letter-spacing: inherit; text-transform: inherit; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
        #marketing-refresh-x-rate-form { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; padding: 10px; border: 1px solid var(--t-border-faint); border-radius: 8px; text-align: left; text-transform: none; letter-spacing: 0; }
        #marketing-refresh-tab-row { display: flex; gap: 6px; margin-bottom: 12px; }
        #marketing-refresh-tab-row .mr-source-opt { min-height: 36px; padding: 0 12px; border: 1px solid var(--t-control-border); border-radius: 999px; background: transparent; color: var(--t-text); font: inherit; cursor: pointer; }
        #marketing-refresh-tab-row .mr-source-opt[aria-pressed="true"] { border-color: var(--t-text-strong); font-weight: 600; }
        #marketing-refresh-x-source-caps { display: flex; flex-direction: column; gap: 8px; }
        #marketing-refresh-x-source-caps-title { font-size: 11px; color: var(--t-text-secondary); }
        #marketing-refresh-x-rate-form .mr-rate-field { display: flex; flex-direction: column; gap: 2px; }
        #marketing-refresh-x-rate-form input { min-height: 40px; padding: 0 10px; border: 1px solid var(--t-control-border); border-radius: 8px; background: var(--t-surface); color: inherit; font: inherit; }
        #marketing-refresh-x-rate-actions { display: flex; align-items: center; gap: 8px; }
        #marketing-refresh-x-rate-save { min-height: 36px; padding: 0 14px; border: 1px solid var(--t-control-border-strong); border-radius: 999px; background: transparent; color: var(--t-text); font: inherit; cursor: pointer; }

        #marketing-refresh-group-list { display: flex; flex-direction: column; }
        #marketing-refresh-panel .mr-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding: 7px 0; border-bottom: 1px solid var(--t-border-faint); }
        #marketing-refresh-panel .mr-row-main { display: flex; flex: 1 1 240px; align-items: center; gap: 12px; min-width: 0; min-height: 40px; cursor: pointer; }
        #marketing-refresh-panel .mr-switch { appearance: none; -webkit-appearance: none; position: relative; flex-shrink: 0; width: 32px; height: 18px; margin: 0; border: 1px solid var(--t-control-border-strong); border-radius: 999px; background: transparent; cursor: pointer; transition: background 150ms ease-out, border-color 150ms ease-out; }
        #marketing-refresh-panel .mr-switch::before { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--t-text-secondary); transition: transform 150ms ease-out, background 150ms ease-out; }
        #marketing-refresh-panel .mr-switch:checked { background: var(--t-text-strong); border-color: var(--t-text-strong); }
        #marketing-refresh-panel .mr-switch:checked::before { transform: translateX(14px); background: var(--t-surface); }
        #marketing-refresh-panel .mr-switch:focus-visible, #marketing-refresh-panel button:focus-visible, #marketing-refresh-panel .mr-chip:focus-within { outline: 2px solid var(--t-focus); outline-offset: 2px; }
        #marketing-refresh-panel .mr-switch:disabled { opacity: 0.4; cursor: default; }
        #marketing-refresh-panel .mr-row-num { flex-shrink: 0; width: 20px; color: var(--t-text-disabled); }
        #marketing-refresh-panel .mr-row-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
        #marketing-refresh-panel .mr-row-label { font-size: 15px; font-weight: 500; line-height: 1.2; color: var(--t-text-secondary); transition: color 150ms ease-out; }
        #marketing-refresh-panel .mr-row[data-on="true"] .mr-row-label { color: var(--t-text-strong); }
        #marketing-refresh-panel .mr-row-meta { display: flex; flex-wrap: wrap; gap: 4px 12px; color: var(--t-text-secondary); }
        #marketing-refresh-panel .mr-row-freshness { display: inline-flex; align-items: center; gap: 5px; }
        #marketing-refresh-panel .mr-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
        #marketing-refresh-panel .mr-row-freshness[data-stale="true"] { color: var(--t-danger); }
        #marketing-refresh-panel .mr-row-cost[data-paid="true"] { color: var(--t-warning); }

        #marketing-refresh-panel .mr-row-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; }
        #marketing-refresh-panel .mr-icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; border: 1px solid var(--t-border-faint); border-radius: 999px; background: transparent; color: var(--t-text-secondary); cursor: pointer; transition: color 150ms ease-out, border-color 150ms ease-out; }
        #marketing-refresh-panel .mr-icon-btn:hover:not(:disabled) { color: var(--t-text-strong); border-color: var(--t-control-border-strong); }
        #marketing-refresh-panel .mr-icon-btn:disabled { opacity: 0.4; cursor: default; }
        #marketing-refresh-panel .mr-chip { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px; border: 1px solid var(--t-border-faint); border-radius: 999px; color: var(--t-text-secondary); font-family: var(--mr-mono); font-size: 10.5px; letter-spacing: 0.08em; cursor: pointer; transition: color 150ms ease-out, border-color 150ms ease-out; }
        #marketing-refresh-panel .mr-chip input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
        #marketing-refresh-panel .mr-chip[data-on="true"] { color: var(--t-warning); border-color: var(--t-warning-border); }
        #marketing-refresh-panel .mr-source { display: inline-flex; align-items: center; gap: 6px; }
        #marketing-refresh-panel .mr-source-opt { height: 28px; padding: 0 10px; border: 1px solid var(--t-border-faint); background: transparent; color: var(--t-text-secondary); font-family: var(--mr-mono); font-size: 10.5px; letter-spacing: 0.08em; cursor: pointer; }
        #marketing-refresh-panel .mr-source-opt:first-child { border-radius: 999px 0 0 999px; margin-right: -6px; }
        #marketing-refresh-panel .mr-source-opt:nth-child(2) { border-radius: 0 999px 999px 0; }
        #marketing-refresh-panel .mr-source-opt[aria-pressed="true"] { background: var(--t-text-strong); border-color: var(--t-text-strong); color: var(--t-surface); }
        #marketing-refresh-panel .mr-source-opt:disabled { opacity: 0.4; cursor: default; }

        #marketing-refresh-source-note { margin-top: 10px; font-family: var(--mr-mono); font-size: 11px; color: var(--t-danger); }
        #marketing-refresh-footer-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 14px; }
        #marketing-refresh-footer-note { color: var(--t-text-disabled); }
        #marketing-refresh-panel .mr-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
        #marketing-refresh-panel .mr-primary-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; flex-shrink: 0; min-height: 40px; padding: 0 20px; border: 1px solid var(--t-border-faint); border-radius: 999px; background: var(--t-surface); color: var(--t-text-strong); font-family: var(--mr-ui); font-size: 14px; font-weight: 700; cursor: pointer; }
        #marketing-refresh-panel .mr-primary-btn:disabled { opacity: 0.45; cursor: default; }
        #marketing-refresh-panel .mr-primary-btn:disabled::before { animation: none; opacity: 0; }
        #marketing-refresh-panel .mr-ghost-btn { min-height: 40px; padding: 0 18px; border: 1px solid var(--t-border-faint); border-radius: 999px; background: transparent; color: var(--t-text-secondary); font-family: var(--mr-ui); font-size: 14px; cursor: pointer; }
        #marketing-refresh-confirm-row { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--t-warning-border); }
        #marketing-refresh-confirm-text { flex: 1 1 280px; min-width: 0; }
        #marketing-refresh-confirm-text .mr-caps { color: var(--t-warning); }
        #marketing-refresh-confirm-list { margin: 8px 0 0; padding: 0; list-style: none; font-size: 13px; }
        #marketing-refresh-confirm-list li { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; }
        #marketing-refresh-confirm-list .mr-confirm-cost { font-family: var(--mr-mono); font-size: 11px; color: var(--t-text-secondary); text-align: right; }
        #marketing-refresh-confirm-total { margin-top: 8px; font-family: var(--mr-mono); font-size: 11px; letter-spacing: 0.08em; color: var(--t-text-strong); }
        #marketing-refresh-confirm-actions { display: flex; gap: 8px; }
        /* Header pair (replaces the old URL input + Connect): Settings icon, then the Refresh pill (styled by #reseed-run-btn). */
        #header-refresh-group { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; min-width: 0; }
        #header-refresh-settings-btn { display: inline-flex; align-items: center; justify-content: center; width: 2.15rem; height: 2.15rem; flex-shrink: 0; padding: 0; color: color-mix(in srgb, var(--t-text) 65%, transparent); background: transparent; border: 1px solid var(--t-border-faint); border-radius: 999px; cursor: pointer; transition: color 0.28s ease, background 0.28s ease; }
        #header-refresh-settings-btn:hover { color: var(--t-text); background: color-mix(in srgb, var(--t-surface) 92%, transparent); }
        #header-refresh-run-icon { display: none; }
        /* Modal mirrors #tile-detail-modal-* (card modals), one column. */
        #refresh-settings-modal-overlay { --mobile-gutter: 8px; position: fixed; inset: 0; z-index: 900; display: flex; align-items: center; justify-content: center; padding: 20px; background: color-mix(in srgb, var(--t-surface) 60%, transparent); backdrop-filter: blur(18px); }
        #refresh-settings-modal-card { width: 100%; max-width: 720px; max-height: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; overflow: hidden; }
        #refresh-settings-modal-header { display: flex; align-items: center; gap: 10px; padding: 14px 20px; flex-shrink: 0; box-shadow: none; }
        #refresh-settings-modal-title { flex: 1; margin: 0; font-family: var(--font-ui); font-size: clamp(1rem, 1.6vw, 1.2rem); font-weight: 700; line-height: 1.2; letter-spacing: -0.03em; color: var(--text-display); }
        #refresh-settings-modal-close { flex-shrink: 0; padding: 5px 10px; border: 1px solid color-mix(in srgb, var(--t-text) 10%, transparent); border-radius: 4px; background: none; cursor: pointer; font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.05em; line-height: 1; color: var(--text-secondary); }
        #refresh-settings-modal-close:hover { color: var(--text-display); border-color: var(--text-secondary); }
        #refresh-settings-modal-body { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; overflow: hidden; }
        #refresh-settings-modal-content { overflow-y: auto; }
        #refresh-settings-modal-content #marketing-refresh-panel { width: 100%; margin: 0; padding: 0; border: none; border-radius: 0; background: transparent; box-shadow: none; box-sizing: border-box; }
        @media (max-width: 620px) {
          /* Phones: Refresh collapses to a round icon button; cta-pill-btn keeps its animated border. */
          #header-refresh-group #reseed-run-btn { width: 2.15rem; height: 2.15rem; min-width: 2.15rem; min-height: 2.15rem; padding: 0; border-radius: 999px; }
          #header-refresh-run-label { display: none; }
          #header-refresh-run-icon { display: block; }
          #refresh-settings-modal-overlay { padding: 12px; align-items: flex-start; }
          #refresh-settings-modal-card { max-height: calc(100dvh - 24px); gap: 10px; }
        }
        @media (max-width: 480px) {
          #refresh-settings-modal-overlay { padding: var(--mobile-gutter, 8px); }
          #refresh-settings-modal-card { max-height: calc(100dvh - 16px); }
          #refresh-settings-modal-header { padding: 12px 10px; }
          #refresh-settings-modal-content { padding: 12px var(--mobile-gutter, 8px); }
          #marketing-refresh-shell { display: block; }
          #marketing-refresh-panel { width: 100%; box-sizing: border-box; }
          #marketing-refresh-panel input[type="number"] { font-size: 16px; }
          #marketing-refresh-summary-count-value { font-size: 44px; }
          #marketing-refresh-summary-row { align-items: flex-start; flex-direction: column; gap: 8px; }
          #marketing-refresh-summary-meta { align-items: flex-start; text-align: left; }
          #marketing-refresh-x-spend-line { justify-content: flex-start; }
          #marketing-refresh-panel .mr-row-main { flex-basis: 170px; gap: 10px; }
          #marketing-refresh-panel .mr-row-num { display: none; }
          #marketing-refresh-panel .mr-icon-btn { width: 34px; height: 34px; }
          #marketing-refresh-footer-note { display: none; }
          #marketing-refresh-footer-row .mr-primary-btn, #marketing-refresh-confirm-actions { flex: 1 1 auto; }
          #marketing-refresh-confirm-actions button { flex: 1 1 0; }
        }
      `}</style>
    </div>
  );
}
