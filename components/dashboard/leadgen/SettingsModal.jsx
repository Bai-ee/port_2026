'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X, RotateCcw } from 'lucide-react';
import {
  DEFAULT_SCORING_WEIGHTS,
  DEFAULT_THRESHOLDS,
  DISCOVERY_QUALITY_FLOOR,
  GEO_PRIORITY,
} from '../../../features/leadgen/constants';

// Operator-tunable settings persisted at leadgen_configs/scoring. Keys mirror
// the override hooks in features/leadgen/scorer.js + prospector.js so the
// server picks them up on the next discover run.
//
// Stored shape:
//   {
//     weights:        { websiteQuality, businessSuccess, growthInvestment, contactAccess },
//     thresholds:     { minimumScore, autoAudit, autoGenerate },
//     discoveryFloor: { minRating, minReviews, skipPermanentlyClosed },
//     geoBoost:       { home, metro, state, other },
//   }

const WEIGHT_KEYS = ['websiteQuality', 'businessSuccess', 'growthInvestment', 'contactAccess'];
const WEIGHT_LABELS = {
  websiteQuality:   'Website Quality',
  businessSuccess:  'Business Success (popularity)',
  growthInvestment: 'Growth Investment',
  contactAccess:    'Contact Access',
};

function asNumber(v, fallback) {
  if (v === '' || v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export default function SettingsModal({ open, onClose, getIdToken }) {
  const [loading, setLoading]       = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState(null);
  const [notice, setNotice]         = useState(null);
  const [weights, setWeights]       = useState(DEFAULT_SCORING_WEIGHTS);
  const [thresholds, setThresholds] = useState(DEFAULT_THRESHOLDS);
  const [floor, setFloor]           = useState(DISCOVERY_QUALITY_FLOOR);
  const [geo, setGeo]               = useState(GEO_PRIORITY.boost);
  const firstFieldRef = useRef(null);

  // Load current config when opened.
  useEffect(() => {
    if (!open) return undefined;
    setError(null);
    setNotice(null);
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await getIdToken?.();
        const res = await fetch('/api/leadgen/configs', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`Could not load configs (HTTP ${res.status}).`);
        const data = await res.json();
        if (cancelled) return;
        const s = data?.scoring || {};
        setWeights({    ...DEFAULT_SCORING_WEIGHTS,    ...(s.weights || {}) });
        setThresholds({ ...DEFAULT_THRESHOLDS,        ...(s.thresholds || {}) });
        setFloor({      ...DISCOVERY_QUALITY_FLOOR,   ...(s.discoveryFloor || {}) });
        setGeo({        ...GEO_PRIORITY.boost,        ...(s.geoBoost || {}) });
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Load failed.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    setTimeout(() => firstFieldRef.current?.focus(), 30);
    return () => { cancelled = true; };
  }, [open, getIdToken]);

  // ESC closes.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const weightSum = WEIGHT_KEYS.reduce((acc, k) => acc + (Number(weights[k]) || 0), 0);
  const weightSumOk = Math.abs(weightSum - 1) < 0.005;
  const thresholdsOk = thresholds.minimumScore < thresholds.autoAudit && thresholds.autoAudit < thresholds.autoGenerate;

  function resetAll() {
    setWeights(DEFAULT_SCORING_WEIGHTS);
    setThresholds(DEFAULT_THRESHOLDS);
    setFloor(DISCOVERY_QUALITY_FLOOR);
    setGeo(GEO_PRIORITY.boost);
    setNotice('Reset to defaults — click Save to persist.');
  }

  function normalizeWeights() {
    const sum = WEIGHT_KEYS.reduce((acc, k) => acc + (Number(weights[k]) || 0), 0) || 1;
    const next = {};
    for (const k of WEIGHT_KEYS) next[k] = Math.round(((Number(weights[k]) || 0) / sum) * 1000) / 1000;
    setWeights(next);
  }

  async function handleSubmit(e) {
    e?.preventDefault?.();
    setError(null);
    setNotice(null);

    if (!weightSumOk) {
      setError(`Weights must sum to 1.0 (currently ${weightSum.toFixed(3)}). Click "Normalize" or adjust manually.`);
      return;
    }
    if (!thresholdsOk) {
      setError('Thresholds must satisfy: minimumScore < autoAudit < autoGenerate.');
      return;
    }

    const payload = {
      scoring: {
        weights,
        thresholds: {
          minimumScore: Number(thresholds.minimumScore),
          autoAudit:    Number(thresholds.autoAudit),
          autoGenerate: Number(thresholds.autoGenerate),
        },
        discoveryFloor: {
          minRating: Number(floor.minRating),
          minReviews: Number(floor.minReviews),
          skipPermanentlyClosed: Boolean(floor.skipPermanentlyClosed),
        },
        geoBoost: {
          home:  Number(geo.home),
          metro: Number(geo.metro),
          state: Number(geo.state),
          other: Number(geo.other),
        },
      },
    };

    setSubmitting(true);
    try {
      const token = await getIdToken?.();
      const res = await fetch('/api/leadgen/configs', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Save failed (HTTP ${res.status}). ${txt.slice(0, 200)}`);
      }
      setNotice('Saved. Next campaign run will use the new settings.');
    } catch (err) {
      setError(err?.message || 'Save failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div id="leadgen-settings-backdrop" role="dialog" aria-modal="true" aria-labelledby="leadgen-settings-title">
      <div id="leadgen-settings-shell">
        <header id="leadgen-settings-head">
          <h2 id="leadgen-settings-title">Lead Gen Settings</h2>
          <div id="leadgen-settings-head-actions">
            <button type="button" className="leadgen-settings-reset" onClick={resetAll} title="Reset to defaults">
              <RotateCcw size={12} strokeWidth={2.4} />
              <span>Reset</span>
            </button>
            <button type="button" className="leadgen-modal-x" onClick={onClose} aria-label="Close">
              <X size={16} strokeWidth={2} />
            </button>
          </div>
        </header>

        {loading ? (
          <div id="leadgen-settings-loading">Loading current config…</div>
        ) : (
          <form id="leadgen-settings-form" onSubmit={handleSubmit}>

            {/* ── Scoring weights ───────────────────────────────────────── */}
            <section className="leadgen-settings-section">
              <header className="leadgen-settings-section-head">
                <h3>Scoring weights</h3>
                <span className={`leadgen-settings-sum${weightSumOk ? '' : ' is-bad'}`}>
                  Σ {weightSum.toFixed(3)}{weightSumOk ? ' ✓' : ' / 1.000'}
                </span>
              </header>
              <p className="leadgen-settings-blurb">Must sum to 1.0. Higher = signal weighs more in the composite score.</p>
              <div className="leadgen-settings-grid">
                {WEIGHT_KEYS.map((k, i) => (
                  <label key={k} className="leadgen-field">
                    <span className="leadgen-field-label">{WEIGHT_LABELS[k]}</span>
                    <input
                      ref={i === 0 ? firstFieldRef : undefined}
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      className="leadgen-field-input"
                      value={weights[k] ?? 0}
                      onChange={(e) => setWeights((w) => ({ ...w, [k]: asNumber(e.target.value, 0) }))}
                    />
                  </label>
                ))}
              </div>
              <button type="button" className="leadgen-settings-norm" onClick={normalizeWeights}>
                Normalize to sum 1.0
              </button>
            </section>

            {/* ── Thresholds ────────────────────────────────────────────── */}
            <section className="leadgen-settings-section">
              <header className="leadgen-settings-section-head">
                <h3>Thresholds</h3>
                {!thresholdsOk ? <span className="leadgen-settings-sum is-bad">order invalid</span> : null}
              </header>
              <p className="leadgen-settings-blurb">
                Must be strictly increasing — minimumScore &lt; autoAudit &lt; autoGenerate. Below minimumScore = discarded.
              </p>
              <div className="leadgen-settings-grid">
                <label className="leadgen-field">
                  <span className="leadgen-field-label">Minimum score (discard below)</span>
                  <input type="number" min="0" max="100" className="leadgen-field-input"
                    value={thresholds.minimumScore}
                    onChange={(e) => setThresholds((t) => ({ ...t, minimumScore: asNumber(e.target.value, 0) }))} />
                </label>
                <label className="leadgen-field">
                  <span className="leadgen-field-label">Auto-audit threshold</span>
                  <input type="number" min="0" max="100" className="leadgen-field-input"
                    value={thresholds.autoAudit}
                    onChange={(e) => setThresholds((t) => ({ ...t, autoAudit: asNumber(e.target.value, 0) }))} />
                </label>
                <label className="leadgen-field">
                  <span className="leadgen-field-label">Auto-generate preview</span>
                  <input type="number" min="0" max="100" className="leadgen-field-input"
                    value={thresholds.autoGenerate}
                    onChange={(e) => setThresholds((t) => ({ ...t, autoGenerate: asNumber(e.target.value, 0) }))} />
                </label>
              </div>
            </section>

            {/* ── Discovery quality floor ──────────────────────────────── */}
            <section className="leadgen-settings-section">
              <header className="leadgen-settings-section-head">
                <h3>Discovery quality floor</h3>
              </header>
              <p className="leadgen-settings-blurb">
                Junk filter applied at SerpAPI ingest, before scoring. Saves audit cost on obvious-junk listings.
              </p>
              <div className="leadgen-settings-grid">
                <label className="leadgen-field">
                  <span className="leadgen-field-label">Min rating</span>
                  <input type="number" step="0.1" min="0" max="5" className="leadgen-field-input"
                    value={floor.minRating}
                    onChange={(e) => setFloor((f) => ({ ...f, minRating: asNumber(e.target.value, 0) }))} />
                </label>
                <label className="leadgen-field">
                  <span className="leadgen-field-label">Min reviews</span>
                  <input type="number" min="0" max="9999" className="leadgen-field-input"
                    value={floor.minReviews}
                    onChange={(e) => setFloor((f) => ({ ...f, minReviews: asNumber(e.target.value, 0) }))} />
                </label>
                <label className="leadgen-checkbox" style={{ marginTop: 6 }}>
                  <input type="checkbox" checked={!!floor.skipPermanentlyClosed}
                    onChange={(e) => setFloor((f) => ({ ...f, skipPermanentlyClosed: e.target.checked }))} />
                  <span>Skip permanently-closed businesses</span>
                </label>
              </div>
            </section>

            {/* ── Geo boost ─────────────────────────────────────────────── */}
            <section className="leadgen-settings-section">
              <header className="leadgen-settings-section-head">
                <h3>Geo priority boost</h3>
              </header>
              <p className="leadgen-settings-blurb">
                Points added to composite score based on prospect's address tier. Concentric: home → metro → state → rest of US.
              </p>
              <div className="leadgen-settings-grid">
                <label className="leadgen-field">
                  <span className="leadgen-field-label">Home (DeKalb area)</span>
                  <input type="number" min="0" max="30" className="leadgen-field-input"
                    value={geo.home}
                    onChange={(e) => setGeo((g) => ({ ...g, home: asNumber(e.target.value, 0) }))} />
                </label>
                <label className="leadgen-field">
                  <span className="leadgen-field-label">Metro (Chicagoland)</span>
                  <input type="number" min="0" max="30" className="leadgen-field-input"
                    value={geo.metro}
                    onChange={(e) => setGeo((g) => ({ ...g, metro: asNumber(e.target.value, 0) }))} />
                </label>
                <label className="leadgen-field">
                  <span className="leadgen-field-label">State (rest of IL)</span>
                  <input type="number" min="0" max="30" className="leadgen-field-input"
                    value={geo.state}
                    onChange={(e) => setGeo((g) => ({ ...g, state: asNumber(e.target.value, 0) }))} />
                </label>
                <label className="leadgen-field">
                  <span className="leadgen-field-label">Other (rest of US)</span>
                  <input type="number" min="0" max="30" className="leadgen-field-input"
                    value={geo.other}
                    onChange={(e) => setGeo((g) => ({ ...g, other: asNumber(e.target.value, 0) }))} />
                </label>
              </div>
            </section>

            {error  ? <div className="leadgen-settings-msg leadgen-settings-msg--err">{error}</div>  : null}
            {notice ? <div className="leadgen-settings-msg leadgen-settings-msg--ok">{notice}</div> : null}

            <footer id="leadgen-settings-foot">
              <button type="button" className="leadgen-btn leadgen-btn--ghost" onClick={onClose} disabled={submitting}>
                Close
              </button>
              <button type="submit" className="leadgen-btn leadgen-btn--primary" disabled={submitting}>
                {submitting ? 'Saving…' : 'Save settings'}
              </button>
            </footer>
          </form>
        )}
      </div>

      <style jsx>{`
        #leadgen-settings-backdrop {
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
        #leadgen-settings-shell {
          width: min(680px, 96vw);
          max-height: 92vh;
          overflow: auto;
          background: #fafafa;
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 12px;
          box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          color: #1a1a1a;
          --lg-mono: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
        }
        #leadgen-settings-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 18px 22px;
          border-bottom: 1px dashed rgba(0,0,0,0.10);
        }
        #leadgen-settings-title {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          letter-spacing: -0.01em;
        }
        #leadgen-settings-head-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        :global(.leadgen-settings-reset) {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          background: transparent;
          border: 1px dashed rgba(0,0,0,0.18);
          border-radius: 999px;
          padding: 4px 10px;
          font-family: inherit;
          font-size: 11px;
          color: #555;
          cursor: pointer;
          transition: background 160ms ease, color 160ms ease;
        }
        :global(.leadgen-settings-reset:hover) {
          background: rgba(0,0,0,0.05);
          color: #1a1a1a;
        }

        #leadgen-settings-loading {
          padding: 48px 22px;
          text-align: center;
          color: #888;
          font-size: 12.5px;
          font-family: var(--lg-mono);
        }

        #leadgen-settings-form {
          padding: 18px 22px 22px;
          display: flex;
          flex-direction: column;
          gap: 22px;
        }
        .leadgen-settings-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding-bottom: 16px;
          border-bottom: 1px dashed rgba(0,0,0,0.08);
        }
        .leadgen-settings-section:last-of-type { border-bottom: none; }
        .leadgen-settings-section-head {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 12px;
        }
        .leadgen-settings-section-head h3 {
          margin: 0;
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #555;
        }
        .leadgen-settings-sum {
          font-family: var(--lg-mono);
          font-size: 10.5px;
          color: #16a34a;
          letter-spacing: 0.04em;
        }
        .leadgen-settings-sum.is-bad { color: #ff3b30; }
        .leadgen-settings-blurb {
          margin: 0;
          font-size: 11.5px;
          color: #777;
          line-height: 1.5;
        }
        .leadgen-settings-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
          margin-top: 4px;
        }
        :global(.leadgen-settings-norm) {
          align-self: flex-start;
          background: transparent;
          border: 1px dashed rgba(0,0,0,0.18);
          color: #555;
          font-family: inherit;
          font-size: 10.5px;
          padding: 4px 10px;
          border-radius: 999px;
          cursor: pointer;
        }
        :global(.leadgen-settings-norm:hover) { color: #1a1a1a; border-color: #1a1a1a; }

        .leadgen-settings-msg {
          font-size: 12px;
          padding: 8px 10px;
          border-radius: 8px;
        }
        .leadgen-settings-msg--err {
          color: #ff3b30;
          background: rgba(255, 59, 48, 0.06);
          border: 1px solid rgba(255, 59, 48, 0.22);
        }
        .leadgen-settings-msg--ok {
          color: #166534;
          background: rgba(22, 101, 52, 0.06);
          border: 1px solid rgba(22, 101, 52, 0.18);
        }

        #leadgen-settings-foot {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          padding-top: 6px;
        }

        @media (max-width: 560px) {
          .leadgen-settings-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
