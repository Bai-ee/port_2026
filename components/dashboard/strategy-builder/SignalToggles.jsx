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
 * @param {{ signals: Object, onChange: Function }} props
 */
export default function SignalToggles({ signals, onChange }) {
  function handleToggle(key) {
    onChange({
      ...signals,
      [key]: { ...signals[key], enabled: !signals[key]?.enabled },
    });
  }

  return (
    <div id="strategy-builder-signal-toggles" className="sb-section">
      <span className="sb-label">Signal Inputs</span>
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
