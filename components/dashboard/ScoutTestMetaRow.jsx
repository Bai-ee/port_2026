'use client';

// Full-width debug meta row for a tested source. Rendered at the bento-grid
// level (#scout-test-meta-band) — outside the panel column — so it spans the
// full modal width. Returns null unless that source has an expanded result.
// Extracted from DashboardPage.jsx's renderScoutTestMetaRow.
export default function ScoutTestMetaRow({ pkey, label, scoutTestState, scoutTestExpanded }) {
  const test = scoutTestState[pkey];
  if (!scoutTestExpanded[pkey] || !test || test.loading) return null;
  const m = test.meta;
  if (!m) return null;
  const queries = (m.queriesTried || m.terms) || [];
  const metaBits = [
    m.source,
    typeof test.ms === 'number' ? `${(test.ms / 1000).toFixed(1)}s` : null,
    typeof m.queriesRun === 'number' ? `${m.queriesRun} live queries` : (queries.length ? `${queries.length} queries` : null),
    m.status ? `status: ${m.status}` : null,
    m.cached ? (m.stale ? 'cached (stale fallback)' : `cached ${Math.round((m.cacheAgeMs || 0) / 60000)}m ago`) : null,
  ].filter(Boolean).join('  ·  ');
  if (!metaBits) return null;
  return (
    <div key={pkey} id={`scout-test-meta-${pkey}`} className="meta-row" style={{ width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 12px', borderTop: '1px solid var(--border, #2a2420)' }}>
      <span className="meta-row-source" style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>{label}: {metaBits}</span>
      {queries.length ? (
        <span className="meta-row-queries" style={{ width: '100%', fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.5, wordBreak: 'break-word' }}>Queries: {queries.slice(0, 6).join('  ·  ')}</span>
      ) : null}
    </div>
  );
}
