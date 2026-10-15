'use client';

import React from 'react';
import Icon from '../Icon.jsx';

/** Switch for on/off settings (role="switch"). */
export function Toggle({ id, label, description, checked, onChange, disabled = false }) {
  return (
    <label className="ts-switch" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={!!checked}
        disabled={disabled}
        aria-describedby={description ? `${id}-desc` : undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="ts-switch-track" aria-hidden="true" />
      <span className="ts-switch-text">
        <span className="ts-switch-label">{label}</span>
        {description ? <span className="ts-hint" id={`${id}-desc`}>{description}</span> : null}
      </span>
    </label>
  );
}

/** Checkbox for filters. */
export function Check({ id, label, checked, onChange, disabled = false }) {
  return (
    <label className="ts-check" htmlFor={id}>
      <input id={id} type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="ts-check-box" aria-hidden="true"><Icon name="check" size={12} /></span>
      <span className="ts-switch-label">{label}</span>
    </label>
  );
}

export default Toggle;
