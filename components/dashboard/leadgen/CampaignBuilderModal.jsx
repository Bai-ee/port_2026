'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import {
  VERTICAL_MAP, VERTICAL_KEYS,
  buildDefaultQueries,
  buildStrategicQueries,
  getStrategiesForVertical,
  getDefaultStrategyIds,
} from '../../../features/leadgen/vertical-map';

// Build a stable, file-system-safe campaign id from the inputs.
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function defaultIdFor(vertical, zip) {
  const v = slugify(vertical || 'leads');
  const z = slugify(zip || 'us');
  return `${v}-${z}-${Date.now().toString(36).slice(-4)}`;
}

export default function CampaignBuilderModal({ open, onClose, onSaved, getIdToken }) {
  const [vertical, setVertical]   = useState(VERTICAL_KEYS[0]);
  const [zip, setZip]             = useState('');
  const [maxPerRun, setMaxPerRun] = useState(20);
  const [queries, setQueries]     = useState([]);
  const [queriesEdited, setQueriesEdited] = useState(false);
  const [enabled, setEnabled]     = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]         = useState(null);
  const [selectedStrategies, setSelectedStrategies] = useState([]);
  const [availableStrategies, setAvailableStrategies] = useState([]);
  const firstFieldRef = useRef(null);

  useEffect(() => {
    if (open) {
      setError(null);
      const v = VERTICAL_KEYS[0];
      setVertical(v);
      setZip('');
      setMaxPerRun(20);
      const strats = getStrategiesForVertical(v);
      setAvailableStrategies(strats);
      const defaults = getDefaultStrategyIds(v);
      setSelectedStrategies(defaults);
      setQueries(buildStrategicQueries(v, defaults, '').map((q) => q.query));
      setQueriesEdited(false);
      setEnabled(true);
      setTimeout(() => firstFieldRef.current?.focus(), 30);
    }
  }, [open]);

  // When vertical changes, refresh available strategies and default selections.
  useEffect(() => {
    if (!open) return;
    const strats = getStrategiesForVertical(vertical);
    setAvailableStrategies(strats);
    if (!queriesEdited) {
      const defaults = getDefaultStrategyIds(vertical);
      setSelectedStrategies(defaults);
      setQueries(buildStrategicQueries(vertical, defaults, zip).map((q) => q.query));
    }
  }, [vertical, open]);

  // When strategies or zip change (and not manually edited), rebuild queries.
  useEffect(() => {
    if (!open || queriesEdited) return;
    setQueries(buildStrategicQueries(vertical, selectedStrategies, zip).map((q) => q.query));
  }, [selectedStrategies, zip, open]);

  // ESC closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const markEdited  = () => { if (!queriesEdited) setQueriesEdited(true); };
  const updateQuery = (i, v) => { markEdited(); setQueries((qs) => qs.map((q, idx) => (idx === i ? v : q))); };
  const addQuery    = () => { markEdited(); setQueries((qs) => [...qs, '']); };
  const removeQuery = (i) => { markEdited(); setQueries((qs) => qs.filter((_, idx) => idx !== i)); };
  const resetQueries = () => {
    const defaults = getDefaultStrategyIds(vertical);
    setSelectedStrategies(defaults);
    setQueries(buildStrategicQueries(vertical, defaults, zip).map((q) => q.query));
    setQueriesEdited(false);
  };

  function toggleStrategy(id) {
    setSelectedStrategies((prev) => {
      const next = prev.includes(id)
        ? prev.filter((s) => s !== id)
        : [...prev, id];
      return next.length > 0 ? next : prev;
    });
    if (queriesEdited) setQueriesEdited(false);
  }

  async function handleSubmit(e) {
    e?.preventDefault?.();
    setError(null);

    const cleanedQueries = queries.map((q) => q.trim()).filter(Boolean);
    if (!cleanedQueries.length) {
      setError('Add at least one search query.');
      return;
    }
    const z = zip.trim();
    if (z && !/^\d{5}$/.test(z)) {
      setError('ZIP must be a 5-digit US zip code, or leave empty for nationwide.');
      return;
    }

    const id = defaultIdFor(vertical, z);
    const campaign = {
      id,
      enabled,
      vertical,
      strategies: selectedStrategies,
      queries: cleanedQueries,
      location: {
        label: z ? `ZIP ${z}` : 'Nationwide',
        zip: z || null,
        // lat/lng intentionally omitted — search is keyword + ZIP only.
        lat: null,
        lng: null,
        radiusMiles: null,
      },
      maxProspectsPerRun: Number(maxPerRun) || 20,
      lastRunAt: null,
      createdAt: new Date().toISOString(),
    };

    setSubmitting(true);
    try {
      const token = await getIdToken?.();
      // Read current campaigns, append, and PUT the merged list back.
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;

      const getRes = await fetch('/api/leadgen/configs', { headers });
      if (!getRes.ok) throw new Error(`Could not load existing configs (HTTP ${getRes.status}).`);
      const cfg = await getRes.json();
      const existing = Array.isArray(cfg?.discovery?.campaigns) ? cfg.discovery.campaigns : [];
      const next = [...existing, campaign];

      const putRes = await fetch('/api/leadgen/configs', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ discovery: { campaigns: next } }),
      });
      if (!putRes.ok) {
        const txt = await putRes.text().catch(() => '');
        throw new Error(`Save failed (HTTP ${putRes.status}). ${txt.slice(0, 200)}`);
      }

      onSaved?.(campaign);
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Save failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div id="leadgen-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="leadgen-modal-title">
      <div id="leadgen-modal-shell">
        <header id="leadgen-modal-head">
          <h2 id="leadgen-modal-title">New Campaign</h2>
          <button type="button" className="leadgen-modal-x" onClick={onClose} aria-label="Close">
            <X size={16} strokeWidth={2} />
          </button>
        </header>

        <form id="leadgen-modal-form" onSubmit={handleSubmit}>
          <label className="leadgen-field">
            <span className="leadgen-field-label">Vertical</span>
            <select
              ref={firstFieldRef}
              className="leadgen-field-input"
              value={vertical}
              onChange={(e) => setVertical(e.target.value)}
            >
              {VERTICAL_KEYS.map((k) => (
                <option key={k} value={k}>{VERTICAL_MAP[k].label}</option>
              ))}
            </select>
          </label>

          <div className="leadgen-field-row">
            <label className="leadgen-field" style={{ maxWidth: 160 }}>
              <span className="leadgen-field-label">ZIP code (optional)</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{5}"
                maxLength={5}
                className="leadgen-field-input"
                placeholder="60115"
                value={zip}
                onChange={(e) => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
              />
            </label>
            <label className="leadgen-field" style={{ maxWidth: 130 }}>
              <span className="leadgen-field-label">Max / run</span>
              <input
                type="number"
                min="1"
                max="60"
                className="leadgen-field-input"
                value={maxPerRun}
                onChange={(e) => setMaxPerRun(e.target.value)}
              />
            </label>
            <div className="leadgen-field" style={{ justifyContent: 'flex-end' }}>
              <span className="leadgen-field-hint">
                {zip
                  ? `Search prioritized near ${zip}.`
                  : 'No ZIP = nationwide search. Geo priority still boosts DeKalb / Chicagoland / IL prospects.'}
              </span>
            </div>
          </div>

          {availableStrategies.length > 0 && (
            <div id="leadgen-strategy-field" className="leadgen-field">
              <div className="leadgen-strategies-head">
                <span className="leadgen-field-label">Search strategies</span>
                <span className="leadgen-field-hint leadgen-field-hint--inline">
                  {selectedStrategies.length} of {availableStrategies.length} active
                </span>
              </div>
              <div className="leadgen-strategies">
                {availableStrategies.map((s) => {
                  const isOn = selectedStrategies.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={`leadgen-strategy-chip${isOn ? ' leadgen-strategy-chip--on' : ''}`}
                      onClick={() => toggleStrategy(s.id)}
                      title={s.description}
                    >
                      <span className="leadgen-strategy-chip-label">{s.label}</span>
                      {s.source === 'vertical' ? (
                        <span className="leadgen-strategy-chip-badge">
                          {VERTICAL_MAP[vertical]?.label}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="leadgen-field">
            <div className="leadgen-queries-head">
              <span className="leadgen-field-label">Search queries</span>
              {queriesEdited ? (
                <button type="button" className="leadgen-queries-reset" onClick={resetQueries}>
                  Reset to defaults
                </button>
              ) : (
                <span className="leadgen-field-hint leadgen-field-hint--inline">
                  Auto-filled. Edit or add more.
                </span>
              )}
            </div>
            <div className="leadgen-queries">
              {queries.map((q, i) => (
                <div className="leadgen-query-row" key={i}>
                  <input
                    type="text"
                    className="leadgen-field-input"
                    placeholder="personal injury lawyer near 60608"
                    value={q}
                    onChange={(e) => updateQuery(i, e.target.value)}
                  />
                  <button
                    type="button"
                    className="leadgen-query-remove"
                    aria-label="Remove query"
                    onClick={() => removeQuery(i)}
                    disabled={queries.length === 1}
                  >
                    <Trash2 size={13} strokeWidth={2} />
                  </button>
                </div>
              ))}
              <button type="button" className="leadgen-query-add" onClick={addQuery}>
                <Plus size={12} strokeWidth={2.4} />
                <span>Add query</span>
              </button>
            </div>
          </div>

          <label className="leadgen-checkbox">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>Enable immediately</span>
          </label>

          {error ? <div id="leadgen-modal-error">{error}</div> : null}

          <footer id="leadgen-modal-foot">
            <button type="button" className="leadgen-btn leadgen-btn--ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="leadgen-btn leadgen-btn--primary" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save Campaign'}
            </button>
          </footer>
        </form>
      </div>

      <style jsx>{`
        #leadgen-modal-backdrop {
          position: fixed; inset: 0;
          background: rgba(15, 15, 15, 0.42);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          animation: leadgen-modal-fade 180ms ease-out;
        }
        @keyframes leadgen-modal-fade { from { opacity: 0; } to { opacity: 1; } }

        #leadgen-modal-shell {
          width: min(560px, 96vw);
          max-height: 92vh;
          overflow: auto;
          background: #fafafa;
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 18px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18);
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          color: #1a1a1a;
          --lg-mono: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
        }
        #leadgen-modal-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 18px 22px;
          border-bottom: 1px dashed rgba(0,0,0,0.10);
        }
        #leadgen-modal-title {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          letter-spacing: -0.01em;
        }
        :global(.leadgen-modal-x) {
          background: transparent;
          border: 1px solid rgba(0,0,0,0.10);
          width: 28px; height: 28px;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: #555;
        }
        :global(.leadgen-modal-x:hover) { background: rgba(0,0,0,0.05); }

        #leadgen-modal-form {
          padding: 18px 22px 22px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        :global(.leadgen-field) {
          display: flex;
          flex-direction: column;
          gap: 6px;
          flex: 1;
          min-width: 0;
        }
        :global(.leadgen-field-label) {
          font-family: var(--lg-mono);
          font-size: 9.5px;
          letter-spacing: 0.16em;
          color: #9a9a9a;
          text-transform: uppercase;
        }
        :global(.leadgen-field-input) {
          font-family: inherit;
          font-size: 13px;
          color: #1a1a1a;
          padding: 9px 11px;
          background: #fff;
          border: 1px solid rgba(0,0,0,0.10);
          border-radius: 8px;
          outline: none;
          transition: border-color 160ms ease;
          width: 100%;
        }
        :global(.leadgen-field-input:focus) { border-color: #1a1a1a; }
        .leadgen-field-row {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        .leadgen-queries { display: flex; flex-direction: column; gap: 6px; }
        .leadgen-query-row {
          display: flex;
          gap: 6px;
          align-items: center;
        }
        :global(.leadgen-query-remove) {
          background: transparent;
          border: 1px solid rgba(0,0,0,0.10);
          width: 30px; height: 30px;
          border-radius: 8px;
          cursor: pointer;
          color: #777;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        :global(.leadgen-query-remove:disabled) { opacity: 0.35; cursor: not-allowed; }
        :global(.leadgen-query-remove:hover:not(:disabled)) { background: rgba(255, 59, 48, 0.06); color: #ff3b30; }
        :global(.leadgen-query-add) {
          align-self: flex-start;
          background: transparent;
          border: 1px dashed rgba(0,0,0,0.18);
          color: #555;
          font-family: inherit;
          font-size: 11.5px;
          padding: 6px 10px;
          border-radius: 999px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        :global(.leadgen-query-add:hover) { color: #1a1a1a; border-color: #1a1a1a; }

        :global(.leadgen-field-hint) {
          font-size: 11px;
          color: #888;
          line-height: 1.5;
          padding: 6px 0 0;
        }
        :global(.leadgen-field-hint--inline) {
          padding: 0;
        }
        .leadgen-queries-head {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 4px;
        }
        .leadgen-strategies-head {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 6px;
        }
        .leadgen-strategies {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        :global(.leadgen-strategy-chip) {
          font-family: inherit;
          font-size: 11px;
          padding: 5px 10px;
          border-radius: 999px;
          border: 1px solid rgba(0,0,0,0.12);
          background: #fff;
          color: #555;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          transition: all 160ms ease;
          user-select: none;
        }
        :global(.leadgen-strategy-chip:hover) {
          border-color: #1a1a1a;
          color: #1a1a1a;
        }
        :global(.leadgen-strategy-chip--on) {
          background: #1a1a1a;
          border-color: #1a1a1a;
          color: #fff;
        }
        :global(.leadgen-strategy-chip--on:hover) {
          background: #333;
          border-color: #333;
        }
        :global(.leadgen-strategy-chip-badge) {
          font-size: 8.5px;
          letter-spacing: 0.05em;
          padding: 1px 5px;
          border-radius: 999px;
          background: rgba(255,255,255,0.15);
          color: inherit;
          text-transform: uppercase;
          font-weight: 600;
        }
        :global(.leadgen-strategy-chip:not(.leadgen-strategy-chip--on) .leadgen-strategy-chip-badge) {
          background: rgba(0,0,0,0.05);
        }

        :global(.leadgen-queries-reset) {
          font-family: inherit;
          font-size: 10.5px;
          color: #ff3b30;
          background: transparent;
          border: 1px dashed rgba(255, 59, 48, 0.35);
          border-radius: 999px;
          padding: 2px 8px;
          cursor: pointer;
          transition: background 160ms ease;
        }
        :global(.leadgen-queries-reset:hover) {
          background: rgba(255, 59, 48, 0.06);
        }

        :global(.leadgen-checkbox) {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: #555;
          margin-top: 2px;
        }

        #leadgen-modal-error {
          font-size: 12px;
          color: #ff3b30;
          background: rgba(255, 59, 48, 0.06);
          border: 1px solid rgba(255, 59, 48, 0.2);
          padding: 8px 10px;
          border-radius: 8px;
        }

        #leadgen-modal-foot {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          padding-top: 4px;
          border-top: 1px dashed rgba(0,0,0,0.10);
          margin-top: 6px;
          padding-top: 14px;
        }
      `}</style>
    </div>
  );
}
