'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { REFRESH_GROUPS, paidGroupsFor, estimateFor, readLastRefreshed } from './refresh-groups.js';

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

export default function MarketingRefreshControl({ running = false, onRun, estimateCtx, onOpenConfig }) {
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState({ ids: [], todayWithModel: false });
  const [last, setLast] = useState({});
  const [pending, setPending] = useState(null); // selection awaiting confirm

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
    if (paidGroupsFor(full).length) { setPending(full); return; }
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
    if (sel && typeof onRun === 'function') onRun(sel);
  };

  const paid = useMemo(() => (pending ? paidGroupsFor(pending, estimateCtx || {}) : []), [pending, estimateCtx]);
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
        #marketing-refresh-panel { margin-top: 8px; width: min(520px, 92vw); padding: 12px; border: 1px solid rgba(0,0,0,0.15); border-radius: 12px; background: #fff; color: #111; box-shadow: 0 8px 24px rgba(0,0,0,0.12); text-align: left; }
        #marketing-refresh-panel .mr-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid rgba(0,0,0,0.08); }
        #marketing-refresh-panel .mr-row-main { display: flex; flex: 1 1 260px; gap: 10px; align-items: flex-start; min-height: 44px; cursor: pointer; }
        #marketing-refresh-panel .mr-row-text { display: flex; flex-direction: column; gap: 2px; }
        #marketing-refresh-panel .mr-row-label { font-weight: 600; }
        #marketing-refresh-panel .mr-row-updates { font-size: 13px; }
        #marketing-refresh-panel .mr-row-meta { font-size: 12px; opacity: 0.65; }
        #marketing-refresh-panel .mr-row-option { display: flex; align-items: center; gap: 6px; min-height: 44px; font-size: 13px; }
        #marketing-refresh-panel input[type="checkbox"] { width: 20px; height: 20px; margin-top: 2px; }
        #marketing-refresh-panel button { min-height: 44px; padding: 0 14px; border: 1px solid rgba(0,0,0,0.3); border-radius: 8px; background: #fff; color: inherit; font: inherit; cursor: pointer; }
        #marketing-refresh-panel button:disabled { opacity: 0.5; cursor: default; }
        #marketing-refresh-confirm-row { margin-top: 10px; padding: 10px; border: 1px solid #b45309; border-radius: 8px; background: #fffbeb; font-size: 14px; }
        #marketing-refresh-confirm-total { margin-top: 8px; font-weight: 600; }
        #marketing-refresh-footer-note { margin-top: 10px; font-size: 12px; opacity: 0.65; }
        #marketing-refresh-panel .mr-config-link { border-color: transparent; background: transparent; text-decoration: underline; padding: 0 8px; }
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
