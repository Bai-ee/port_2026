'use client';

import React from 'react';
import Icon from '../Icon.jsx';
import { useStudio } from '../StudioContext.jsx';

/**
 * Two-step destructive action. The prompt is a popover: Escape closes it first
 * (before the drawer), and focus lands on the safe choice (Cancel).
 */
export default function ConfirmButton({
  id, label, prompt, confirmLabel = 'Confirm', onConfirm, icon, disabled = false, danger = true, small = true,
}) {
  const { ui, dispatch } = useStudio();
  const open = ui.popovers.includes(id);
  const sm = small ? ' ts-btn--sm' : '';
  if (!open) {
    return (
      <button
        type="button"
        id={id}
        className={`ts-btn${sm}${danger ? ' ts-btn--danger' : ''}`}
        disabled={disabled}
        onClick={() => dispatch({ type: 'popover/open', id })}
      >
        {icon ? <Icon name={icon} size={14} /> : null}
        {label}
      </button>
    );
  }
  return (
    <div className="ts-banner ts-banner--warn" role="group" aria-label={`Confirm: ${label}`} id={`${id}-confirm`}>
      <Icon name="alert" />
      <div>
        <p><strong>{prompt}</strong></p>
        <div className="ts-banner-actions">
          <button
            type="button"
            className={`ts-btn ts-btn--sm ${danger ? 'ts-btn--danger-solid' : 'ts-btn--primary'}`}
            onClick={() => { dispatch({ type: 'popover/close', id }); onConfirm(); }}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            className="ts-btn ts-btn--sm"
            autoFocus
            onClick={() => dispatch({ type: 'popover/close', id })}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
