'use client';

import React from 'react';

const SIGNALS = [
  {
    key: 'weather',
    label: 'Local Weather',
    description: 'Tailor posts around notable weather (storms, heat waves, snow).',
  },
  {
    key: 'events',
    label: 'Local Events',
    description: 'Anchor posts to local events you add manually.',
  },
  {
    key: 'holidays',
    label: 'Industry Holidays',
    description: 'Auto-detect relevant holidays and national days for your vertical.',
  },
];

/**
 * @param {{ signals: Object, onChange: Function, sourceHydrated?: boolean }} props
 */
export default function SignalToggles({ signals, onChange, sourceHydrated = false }) {
  function handleToggle(key) {
    onChange({
      ...signals,
      [key]: { ...signals[key], enabled: !signals[key]?.enabled },
    });
  }

  return (
    <div id="strategy-builder-signal-toggles" className="sb-section">
      <span className="sb-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        Signal Inputs
        <span
          className="sb-chip"
          style={{
            borderColor: sourceHydrated ? 'rgba(74,222,128,0.55)' : 'rgba(245,158,11,0.45)',
            color: sourceHydrated ? '#86efac' : '#fbbf24',
            background: sourceHydrated ? 'rgba(74,222,128,0.08)' : 'rgba(245,158,11,0.08)',
          }}
        >
          {sourceHydrated ? 'JSON' : 'Manual'}
        </span>
      </span>
      <div className="mb-config-platform-grid sb-toggle-grid">
        {SIGNALS.map(({ key, label, description }) => {
          const enabled = Boolean(signals?.[key]?.enabled);
          return (
            <button
              key={key}
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label={label}
              onClick={() => handleToggle(key)}
              className={`mb-config-platform-toggle${enabled ? ' is-on' : ''}`}
            >
              <span className="mb-config-platform-check" aria-hidden="true">
                {enabled ? '✓' : ''}
              </span>
              <span className="mb-config-platform-body">
                <span className="mb-config-platform-title">{label}</span>
                <span className="sb-hint">{description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
