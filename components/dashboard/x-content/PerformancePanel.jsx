'use client';

import React from 'react';
import { Skeleton, RetryError } from './Feedback.jsx';
import { RefreshCw } from 'lucide-react';

// PerformancePanel — per-engine results over stored social_posts.performance.
//
// PURE PRESENTATION. `stats` is features/x-content-inventory/performance.js
// engineStats output; nothing is re-derived here except the plain-English line.
// STYLING: classNames only (`xce-`); the parent card owns the single
// `<style jsx global>` block, prefixed `#x-content-card`.

const ENGINE_LABEL = { record: 'Record', ue: 'UE', client: 'Client', identity: 'Identity', untagged: 'Untagged' };

const fmt = (v, d = 0) => (v == null ? '—' : String(Math.round(v * 10 ** d) / 10 ** d));

function trendText(t) {
  if (!t || t.state === 'insufficient') return 'needs data';
  const arrow = t.state === 'up' ? '↑' : t.state === 'down' ? '↓' : '→';
  return `${arrow} ${t.pct > 0 ? '+' : ''}${t.pct}%`;
}

function meaning(label, s, minN) {
  if (s.measured === 0) return `${label}: nothing captured yet. Run the daily backfill.`;
  if (s.insufficient) return `${label}: ${s.measured} measured of ${minN} needed. Too early to compare, so it is not ranked.`;
  const bits = [`${label} ranks #${s.rank} on value score (median ${fmt(s.medianValue, 1)})`];
  if (s.trend.state === 'up' || s.trend.state === 'down') bits.push(`views ${s.trend.state === 'up' ? 'up' : 'down'} ${Math.abs(s.trend.pct)}% vs the prior window`);
  if (s.replyRate != null) bits.push(`${fmt(s.replyRate, 1)} replies per 1k views`);
  return `${bits.join('; ')}.`;
}

export default function PerformancePanel({ stats, lastCapturedAt, loading, error, onRefresh }) {
  const entries = stats?.engines ? Object.entries(stats.engines) : [];
  const minN = stats?.minN ?? 5;

  return (
    <div id="x-content-performance-panel" className="xce-panel">
      <div id="x-content-performance-header" className="xce-head">
        <span className="xce-head-date">Results by engine · {stats?.windowDays ? `${stats.windowDays}d` : 'all time'}</span>
        <span className="xce-head-count">
          {stats ? `${stats.total} posts · ${stats.unmeasured} unmeasured` : '—'}
          {lastCapturedAt ? ` · captured ${new Date(lastCapturedAt).toLocaleDateString()}` : ''}
        </span>
        {onRefresh ? (
          <button type="button" id="x-content-performance-refresh-button" className="xce-tier-option" disabled={loading} onClick={onRefresh}>
            <RefreshCw size={13} /> Refresh
          </button>
        ) : null}
      </div>

      {error ? <RetryError id="x-content-performance-error" message={error} onRetry={onRefresh} busy={!!loading} /> : null}

      {!entries.length && loading ? (
        <Skeleton id="x-content-performance-skeleton" rows={3} variant="row" />
      ) : !entries.length && !loading ? (
        <div id="x-content-performance-empty" className="xce-empty">
          No posted tweets with captured metrics yet.
          <div className="xce-empty-note">Metrics come from the daily backfill script; nothing here calls X.</div>
        </div>
      ) : (
        <ul id="x-content-performance-engine-list" className="xce-perf-list">
          {entries.map(([key, s]) => {
            const label = ENGINE_LABEL[key] || key;
            return (
              <li key={key} id={`x-content-performance-engine-${key}`} className={`xce-perf-row xce-engine-${key}`}>
                <div className="xce-perf-name">
                  <span className="xce-engine-name">{label}</span>
                  {s.insufficient ? <span className="xce-perf-flag">n&lt;{minN} · insufficient</span> : <span className="xce-perf-rank">#{s.rank}</span>}
                </div>
                <dl className="xce-perf-grid">
                  <div><dt>n</dt><dd>{s.n}</dd></div>
                  <div><dt>Med views</dt><dd>{fmt(s.medianViews)}</dd></div>
                  <div><dt>Value</dt><dd>{fmt(s.medianValue, 1)}</dd></div>
                  <div><dt>Trend</dt><dd>{trendText(s.trend)}</dd></div>
                </dl>
                <details className="xce-more" id={`x-content-performance-engine-${key}-details`}>
                  <summary className="xce-more-summary">Details</summary>
                  <div className="xce-more-body">
                    <p className="xce-perf-meaning">{meaning(label, s, minN)}</p>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}

      <details className="xce-more" id="x-content-performance-footnote-details">
        <summary className="xce-more-summary">Details</summary>
        <div className="xce-more-body">
          <p id="x-content-performance-footnote" className="xce-empty-note">
            Value = reply/quote x5, repost x1, like x0.5. Daily snapshots cannot see the first-2h velocity that decides reach.
          </p>
        </div>
      </details>
    </div>
  );
}
