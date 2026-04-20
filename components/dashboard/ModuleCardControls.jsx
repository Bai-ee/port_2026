'use client';

import React from 'react';

const STATUS_META = {
  succeeded: { dot: '#22c55e', label: 'Active',    glow: '0 0 5px 2px rgba(34,197,94,0.45)' },
  failed:    { dot: '#ef4444', label: 'Failed',    glow: '0 0 5px 2px rgba(239,68,68,0.45)' },
  running:   { dot: '#f59e0b', label: 'Running…',  glow: '0 0 5px 2px rgba(245,158,11,0.45)' },
  queued:    { dot: '#f59e0b', label: 'Queued',    glow: '0 0 5px 2px rgba(245,158,11,0.30)' },
  idle:      { dot: '#6b7280', label: 'Idle',      glow: 'none' },
  disabled:  { dot: '#6b7280', label: 'Inactive',  glow: 'none' },
  inactive:  { dot: '#6b7280', label: 'Inactive',  glow: 'none' },
};

function formatTs(ts) {
  if (!ts) return null;
  try {
    const d = ts?.toDate?.() ?? (ts?.seconds ? new Date(ts.seconds * 1000) : new Date(ts));
    if (!d || isNaN(d.getTime())) return null;
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  } catch { return null; }
}

export default function ModuleCardControls({
  cardId, moduleState, moduleConfig,
  loading, toggleLoading,
  onRun, onToggle,
  tech = [],
  hideRunButton = false,
  hideStatusLabel = false,
}) {
  const state = moduleState?.[cardId] ?? null;
  const status = state?.status ?? 'disabled';
  const { dot, label, glow } = STATUS_META[status] ?? STATUS_META.disabled;
  const successAt = formatTs(state?.lastSuccessAt);
  const errorMsg  = state?.lastErrorMessage ?? null;

  // When moduleConfig is present, require explicit enabled=true to allow running.
  // When moduleConfig is null (legacy clients), allow run by default.
  const isEnabled = moduleConfig ? (moduleConfig[cardId]?.enabled ?? false) : true;
  const canRun    = isEnabled && status !== 'running' && status !== 'queued';
  const isRetry   = status === 'failed';
  const isRerun   = status === 'succeeded';

  return (
    <div id={`module-controls-${cardId}`} style={rootStyle}>
      <div style={rowStyle}>
        {!hideStatusLabel && (
          <>
            <span style={{ ...dotStyle, background: dot, boxShadow: glow }} />
            <span style={statusTextStyle}>{label}</span>
            {successAt && status === 'succeeded' && (
              <span style={metaTextStyle}>{successAt}</span>
            )}
          </>
        )}
        {tech.length > 0 && (
          <span style={techGroupStyle}>
            {tech.map((t) => (
              <span key={t} style={techTagStyle}>{t}</span>
            ))}
          </span>
        )}
        {!hideRunButton && !isEnabled && onToggle && (
          <button
            type="button"
            id={`module-enable-btn-${cardId}`}
            className="tile-foot-action-btn"
            style={btnStyle}
            disabled={toggleLoading}
            onClick={(e) => { e.stopPropagation(); onToggle(cardId, true); }}
          >
            {toggleLoading ? '…' : 'Enable & Run'}
          </button>
        )}
        {!hideRunButton && isEnabled && canRun && onRun && (
          <button
            type="button"
            id={`module-run-btn-${cardId}`}
            className="tile-foot-action-btn"
            style={btnStyle}
            disabled={loading}
            onClick={(e) => { e.stopPropagation(); onRun(cardId, isRerun); }}
          >
            {loading ? '…' : isRetry ? 'Retry' : isRerun ? 'Re-run' : 'Run'}
          </button>
        )}
      </div>
      {status === 'failed' && errorMsg && (
        <p style={errorStyle}>{errorMsg}</p>
      )}
    </div>
  );
}

const rootStyle = {
  padding: '6px 16px 8px',
  borderTop: '1px solid rgba(255,255,255,0.06)',
};
const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
};
const dotStyle = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  flexShrink: 0,
  display: 'inline-block',
};
const statusTextStyle = {
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: 10,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--text-secondary)',
};
const metaTextStyle = {
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: 10,
  color: 'var(--text-disabled, #666)',
  opacity: 0.7,
};
const techGroupStyle = {
  display: 'inline-flex',
  gap: 4,
  flexWrap: 'wrap',
  marginLeft: 4,
};
const techTagStyle = {
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: 9,
  letterSpacing: '0.06em',
  background: 'rgba(255,255,255,0.07)',
  borderRadius: 3,
  padding: '1px 5px',
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
};
const btnStyle = {
  marginLeft: 'auto',
};
const errorStyle = {
  margin: '4px 0 0',
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: 9,
  color: '#ef4444',
  opacity: 0.85,
  letterSpacing: '0.04em',
  lineHeight: 1.4,
  maxWidth: 260,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
