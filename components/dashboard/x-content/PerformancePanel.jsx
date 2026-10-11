'use client';

import React from 'react';
import { Skeleton, RetryError } from './Feedback.jsx';
import { BarChart3, FileText, RefreshCw } from 'lucide-react';
import Card from './ui/Card.jsx';
import Badge from './ui/Badge.jsx';
import IconButton from './ui/IconButton.jsx';
import Accordion from './ui/Accordion.jsx';
import { XCE_COLORS, XCE_RADII, XCE_TYPE } from './xce-tokens';

// PerformancePanel — per-engine results over stored social_posts.performance.
//
// PURE PRESENTATION. `stats` is features/x-content-inventory/performance.js
// engineStats output; nothing is re-derived here except the plain-English line.
// STYLING: inline styles from the ui/* primitives + xce-tokens. Window label
// is static (windowDays is fixed by the card); no period dropdown.

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
  const measured = stats ? Math.max(0, (stats.total || 0) - (stats.unmeasured || 0)) : 0;
  const windowLabel = stats?.windowDays ? `Last ${stats.windowDays} days` : 'All time';

  return (
    <div id="x-content-performance-panel" className="xce-panel" style={{ display: 'grid', gap: 14 }}>
      <div id="x-content-performance-header" style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <h3 id="x-results-title" style={{ margin: 0, fontSize: 20, fontWeight: 700, color: XCE_COLORS.ink }}>Results</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span id="x-results-window-label" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 38, padding: '0 12px', borderRadius: XCE_RADII.md, border: `1px solid ${XCE_COLORS.border}`, background: XCE_COLORS.surface, fontSize: 13, color: XCE_COLORS.ink }}>
              {windowLabel}
            </span>
            {onRefresh ? (
              <IconButton id="x-content-performance-refresh-button" label="Refresh results" icon={<RefreshCw size={15} />} size={38} disabled={loading} onClick={onRefresh} />
            ) : null}
          </div>
        </div>
        <span id="x-results-measured-count" style={{ fontFamily: XCE_TYPE.mono, fontSize: 12, color: XCE_COLORS.inkMuted }}>
          {stats ? `${measured} measured post${measured === 1 ? '' : 's'}` : '—'}
          {stats && stats.unmeasured ? ` · ${stats.unmeasured} unmeasured` : ''}
        </span>
      </div>

      {error ? <RetryError id="x-content-performance-error" message={error} onRetry={onRefresh} busy={!!loading} /> : null}

      {!entries.length && loading ? (
        <Skeleton id="x-content-performance-skeleton" rows={3} variant="row" />
      ) : !entries.length && !loading ? (
        <div
          id="x-content-performance-empty"
          style={{ display: 'grid', justifyItems: 'center', gap: 8, padding: '22px 16px', textAlign: 'center', border: `1px dashed ${XCE_COLORS.borderStrong}`, borderRadius: XCE_RADII.lg }}
        >
          <span aria-hidden="true" style={{ width: 44, height: 44, borderRadius: 999, background: XCE_COLORS.greyBg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: XCE_COLORS.inkSoft }}>
            <BarChart3 size={20} />
          </span>
          <strong style={{ fontSize: 15, color: XCE_COLORS.ink }}>No results yet.</strong>
          <span style={{ fontSize: 13, lineHeight: 1.5, color: XCE_COLORS.inkMuted }}>No posted tweets with captured metrics yet.</span>
          <span className="xce-empty-note">Metrics come from the daily backfill script; nothing here calls X.</span>
        </div>
      ) : null}

      <Card id="x-results-accordion-card" padding="0 14px">
        <Accordion id="x-results-by-engine" title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontWeight: 600 }}><BarChart3 size={16} /> By engine</span>} defaultOpen={entries.length > 0}>
          {entries.length ? (
            <ul id="x-content-performance-engine-list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
              {entries.map(([key, s]) => {
                const label = ENGINE_LABEL[key] || key;
                return (
                  <li key={key} id={`x-content-performance-engine-${key}`} style={{ display: 'grid', gap: 8, padding: 12, borderRadius: XCE_RADII.md, border: `1px solid ${XCE_COLORS.border}`, background: XCE_COLORS.surfaceMuted }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ ...XCE_TYPE.label, fontFamily: XCE_TYPE.mono, color: XCE_COLORS.ink }}>{label}</span>
                      {s.insufficient ? <Badge tone="amber">n&lt;{minN} · insufficient</Badge> : <Badge tone="green">#{s.rank}</Badge>}
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
          ) : (
            <p id="x-results-by-engine-empty" className="xce-empty-note" style={{ margin: 0 }}>No engine results yet.</p>
          )}
        </Accordion>
        <Accordion id="x-content-performance-footnote-details" title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontWeight: 600 }}><FileText size={16} /> Measurement details</span>}>
          <p id="x-content-performance-footnote" className="xce-empty-note" style={{ margin: 0 }}>
            Value = reply/quote x5, repost x1, like x0.5. Daily snapshots cannot see the first-2h velocity that decides reach.
            {lastCapturedAt ? ` Last captured ${new Date(lastCapturedAt).toLocaleDateString()}.` : ''}
          </p>
        </Accordion>
      </Card>
    </div>
  );
}
