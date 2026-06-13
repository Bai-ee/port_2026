'use client';

import React from 'react';

function formatMonthDay(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function daysAway(isoDate) {
  if (!isoDate) return null;
  const now = new Date();
  const target = new Date(isoDate + 'T00:00:00Z');
  const diff = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
  if (diff < 0) return null;
  if (diff === 0) return 'today';
  if (diff === 1) return '1 day away';
  return `${diff} days away`;
}

/**
 * @param {{ anchors: import('../../../features/strategy-builder/schemas.js').PostAnchor[], now: string }} props
 */
export default function PacingStrip({ anchors, now }) {
  if (!anchors || anchors.length === 0) return null;

  const nowDate = new Date(now || new Date().toISOString());
  const upcoming = [...anchors]
    .filter((a) => a.date && new Date(a.date + 'T00:00:00Z') >= nowDate)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3);

  if (upcoming.length === 0) return null;

  return (
    <div
      id="strategy-builder-pacing-strip"
      className="sb-pacing-strip"
      style={{
        display: 'flex',
        gap: 10,
        marginBottom: 16,
        overflowX: 'auto',
        paddingBottom: 2,
      }}
    >
      {upcoming.map((anchor) => {
        const away = daysAway(anchor.date);
        return (
          <div
            key={anchor.id}
            className={`sb-pacing-card sb-pacing-card-${anchor.ramp === 'hard' ? 'hard' : 'soft'}`}
            style={{
              flex: '0 0 auto',
              padding: '8px 14px',
              background: 'var(--surface-raised)',
              border: `1px solid ${anchor.ramp === 'hard' ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'var(--border-visible)'}`,
              borderRadius: 8,
              minWidth: 140,
            }}
          >
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', textTransform: 'uppercase', color: anchor.ramp === 'hard' ? 'var(--accent)' : 'var(--text-secondary)', marginBottom: 3 }}>
              {anchor.ramp === 'hard' ? 'HARD RAMP' : 'SOFT RAMP'}
            </div>
            <div style={{ fontSize: 12, fontFamily: 'var(--font-ui)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
              {anchor.name}
            </div>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
              {formatMonthDay(anchor.date)}
              {away && (
                <span style={{ marginLeft: 6, color: anchor.ramp === 'hard' ? 'var(--accent)' : 'var(--success)' }}>
                  · {away}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
