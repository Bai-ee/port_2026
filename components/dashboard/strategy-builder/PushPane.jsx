'use client';

import React, { useState } from 'react';

function formatDate(isoDate) {
  if (!isoDate) return '—';
  return new Date(isoDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function planToCSV(items) {
  const header = 'scheduledAt,kind,content,anchorId,rationale,confidence';
  const rows = (items || []).map((item) => {
    const cols = [
      item.scheduledAt || '',
      item.kind || '',
      `"${(item.content || '').replace(/"/g, '""')}"`,
      item.anchorId || '',
      `"${(item.rationale || '').replace(/"/g, '""')}"`,
      typeof item.confidence === 'number' ? item.confidence : '',
    ];
    return cols.join(',');
  });
  return [header, ...rows].join('\n');
}

/**
 * @param {{
 *   plan: import('../../../features/strategy-builder/schemas.js').PostPlan|null,
 *   getIdToken: Function,
 *   onOpenSocialPosting?: Function,
 * }} props
 */
export default function PushPane({ plan, getIdToken, onPush, onOpenSocialPosting }) {
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState(null);

  if (!plan) {
    return (
      <div className="sb-empty-state">
        No plan generated yet. Go to the Inputs tab to generate a strategy.
      </div>
    );
  }

  const totalPosts = plan.items?.length || 0;
  const sortedItems = [...(plan.items || [])].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const dateRange = totalPosts > 0
    ? `${formatDate(sortedItems[0]?.scheduledAt)} → ${formatDate(sortedItems[sortedItems.length - 1]?.scheduledAt)}`
    : '—';
  const topAnchors = (plan.anchors || []).slice(0, 3);

  async function handlePushAll() {
    setConfirmed(true);
    setBusy(true);
    setResult(null);
    const res = await onPush(plan.items);
    setResult(res);
    setBusy(false);
  }

  function handleExportJSON() {
    downloadBlob(JSON.stringify(plan, null, 2), `strategy-${plan.campaignId}.json`, 'application/json');
  }

  function handleExportCSV() {
    downloadBlob(planToCSV(plan.items), `strategy-${plan.campaignId}.csv`, 'text/csv');
  }

  return (
    <div className="sb-pane">
      {/* Summary */}
      <div
        id="strategy-builder-push-summary"
        className="sb-summary-panel"
        style={{
          padding: '14px 16px',
          background: 'var(--surface-raised)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          marginBottom: 16,
        }}
      >
        <div className="sb-label" style={{ marginBottom: 10 }}>Plan Summary</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
          <div>
            <div style={{ fontSize: 26, fontFamily: 'var(--font-display)', color: 'var(--text-display)', lineHeight: 1 }}>{totalPosts}</div>
            <div className="sb-label" style={{ marginTop: 4 }}>total posts</div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', marginBottom: 4 }}>{dateRange}</div>
            <div className="sb-label">date range</div>
          </div>
        </div>
        {topAnchors.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div className="sb-label" style={{ marginBottom: 6 }}>Top Anchors</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {topAnchors.map((a) => (
                <span key={a.id} className="sb-chip">{a.name}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Result banner */}
      {result && (
        result.failed?.length > 0 ? (
          <div className="brand-snapshot-error" style={{ marginBottom: 14 }}>
            {result.scheduled} post{result.scheduled !== 1 ? 's' : ''} scheduled. {result.failed.length} failed.
            <ul style={{ marginTop: 6, paddingLeft: 16 }}>
              {result.failed.map((f) => (
                <li key={f.id} style={{ fontSize: 10 }}>{f.id}: {f.reason}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="sb-notice sb-notice--ok" style={{ marginBottom: 14 }}>
            {result.scheduled} post{result.scheduled !== 1 ? 's' : ''} scheduled.
          </div>
        )
      )}

      {/* Schedule All button */}
      <button
        id="strategy-builder-push-button"
        type="button"
        onClick={handlePushAll}
        disabled={busy || Boolean(result)}
        className="sb-cta"
        style={{ marginBottom: 12 }}
      >
        {busy ? (
          <>
            <span className="sb-spinner" />
            Scheduling…
          </>
        ) : result ? (
          'Scheduled'
        ) : (
          `Schedule All ${totalPosts} Posts`
        )}
      </button>

      {/* Export buttons */}
      <div
        id="strategy-builder-export-row"
        style={{ display: 'flex', gap: 8, marginBottom: 12 }}
      >
        <button type="button" onClick={handleExportJSON} className="sb-seg-btn">
          Export JSON
        </button>
        <button type="button" onClick={handleExportCSV} className="sb-seg-btn">
          Export CSV
        </button>
      </div>

      {/* Social posting deep link */}
      {result && result.scheduled > 0 && onOpenSocialPosting && (
        <button
          type="button"
          onClick={onOpenSocialPosting}
          className="sb-link-btn"
          style={{ width: '100%', padding: '8px 0', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11 }}
        >
          View in Social Posting →
        </button>
      )}
    </div>
  );
}
