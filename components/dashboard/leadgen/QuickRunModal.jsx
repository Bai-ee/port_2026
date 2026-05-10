'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X, Play, Loader2 } from 'lucide-react';
import {
  VERTICAL_MAP,
  VERTICAL_KEYS,
  buildDefaultQueries,
} from '../../../features/leadgen/vertical-map';

// Quick Run — fires an ad-hoc discover with default queries, no campaign saved.
// Useful for one-off probes ("just see what's out there in 60115 today").

export default function QuickRunModal({ open, onClose, onResult, getIdToken }) {
  const [vertical, setVertical]       = useState(VERTICAL_KEYS[0]);
  const [zip, setZip]                 = useState('');
  const [maxPerRun, setMaxPerRun]     = useState(20);
  const [running, setRunning]         = useState(false);
  const [error, setError]             = useState(null);
  const firstFieldRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setError(null);
    setVertical(VERTICAL_KEYS[0]);
    setZip('');
    setMaxPerRun(20);
    setTimeout(() => firstFieldRef.current?.focus(), 30);
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const previewQueries = buildDefaultQueries(vertical, zip);

  async function handleRun(e) {
    e?.preventDefault?.();
    setError(null);

    const z = zip.trim();
    if (z && !/^\d{5}$/.test(z)) {
      setError('ZIP must be 5 digits, or leave empty for nationwide.');
      return;
    }
    if (vertical === 'custom') {
      setError('Quick Run does not support the Custom vertical. Use New Campaign for freeform queries.');
      return;
    }

    const inlineCampaign = {
      id: `adhoc-${vertical}-${z || 'us'}-${Date.now().toString(36).slice(-4)}`,
      enabled: true,
      vertical,
      queries: previewQueries,
      location: {
        label: z ? `ZIP ${z}` : 'Nationwide',
        zip: z || null,
        lat: null, lng: null, radiusMiles: null,
      },
      maxProspectsPerRun: Number(maxPerRun) || 20,
    };

    setRunning(true);
    try {
      const token = await getIdToken?.();
      const res = await fetch('/api/leadgen/discover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ campaign: inlineCampaign }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Run failed (HTTP ${res.status}).`);
        return;
      }
      onResult?.({
        kind: 'ok',
        text: `Ad-hoc run: ${data?.discovery?.persisted ?? 0} new, ${data?.discovery?.skippedDuplicates ?? 0} dupes, ${data?.discovery?.skippedJunk ?? 0} junk filtered, ${data?.belowFloorDiscarded ?? 0} below floor.`,
      });
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Run failed.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div id="leadgen-quickrun-backdrop" role="dialog" aria-modal="true" aria-labelledby="leadgen-quickrun-title">
      <div id="leadgen-quickrun-shell">
        <header id="leadgen-quickrun-head">
          <div>
            <h2 id="leadgen-quickrun-title">Quick Run</h2>
            <p id="leadgen-quickrun-sub">
              Ad-hoc discovery using your saved settings. Nothing is saved as a campaign.
            </p>
          </div>
          <button type="button" className="leadgen-modal-x" onClick={onClose} aria-label="Close">
            <X size={16} strokeWidth={2} />
          </button>
        </header>

        <form id="leadgen-quickrun-form" onSubmit={handleRun}>
          <div className="leadgen-field-row">
            <label className="leadgen-field" style={{ minWidth: 200 }}>
              <span className="leadgen-field-label">Vertical</span>
              <select
                ref={firstFieldRef}
                className="leadgen-field-input"
                value={vertical}
                onChange={(e) => setVertical(e.target.value)}
              >
                {VERTICAL_KEYS.filter((k) => k !== 'custom').map((k) => (
                  <option key={k} value={k}>{VERTICAL_MAP[k].label}</option>
                ))}
              </select>
            </label>

            <label className="leadgen-field" style={{ maxWidth: 140 }}>
              <span className="leadgen-field-label">ZIP (optional)</span>
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
          </div>

          <div id="leadgen-quickrun-preview">
            <div className="leadgen-quickrun-preview-label">Will run these queries</div>
            <ul className="leadgen-quickrun-preview-list">
              {previewQueries.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </div>

          {error ? <div id="leadgen-quickrun-error">{error}</div> : null}

          <footer id="leadgen-quickrun-foot">
            <button
              type="button"
              className="leadgen-btn leadgen-btn--ghost"
              onClick={onClose}
              disabled={running}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="leadgen-btn leadgen-btn--primary"
              disabled={running}
            >
              {running ? (
                <><Loader2 size={13} strokeWidth={2.4} className="leadgen-spin" /><span>Running…</span></>
              ) : (
                <><Play size={13} strokeWidth={2.4} /><span>Run now</span></>
              )}
            </button>
          </footer>
        </form>
      </div>

      <style jsx>{`
        #leadgen-quickrun-backdrop {
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
        #leadgen-quickrun-shell {
          width: min(540px, 96vw);
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
        #leadgen-quickrun-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          padding: 18px 22px;
          border-bottom: 1px dashed rgba(0,0,0,0.10);
        }
        #leadgen-quickrun-title {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          letter-spacing: -0.01em;
        }
        #leadgen-quickrun-sub {
          margin: 4px 0 0;
          font-size: 11.5px;
          color: #777;
          line-height: 1.5;
        }
        #leadgen-quickrun-form {
          padding: 18px 22px 22px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        #leadgen-quickrun-preview {
          padding: 10px 12px;
          background: rgba(0,0,0,0.03);
          border: 1px solid rgba(0,0,0,0.08);
          border-radius: 10px;
        }
        .leadgen-quickrun-preview-label {
          font-family: var(--lg-mono);
          font-size: 9.5px;
          letter-spacing: 0.16em;
          color: #888;
          text-transform: uppercase;
          margin-bottom: 6px;
        }
        .leadgen-quickrun-preview-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 3px;
          font-family: var(--lg-mono);
          font-size: 12px;
          color: #1a1a1a;
        }
        .leadgen-quickrun-preview-list li::before {
          content: '·';
          color: #aaa;
          margin-right: 8px;
        }
        #leadgen-quickrun-error {
          font-size: 12px;
          color: #ff3b30;
          background: rgba(255, 59, 48, 0.06);
          border: 1px solid rgba(255, 59, 48, 0.22);
          padding: 8px 10px;
          border-radius: 8px;
        }
        #leadgen-quickrun-foot {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          padding-top: 4px;
          border-top: 1px dashed rgba(0,0,0,0.10);
          margin-top: 4px;
          padding-top: 14px;
        }
      `}</style>
    </div>
  );
}
