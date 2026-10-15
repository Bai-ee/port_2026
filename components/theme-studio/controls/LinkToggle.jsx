'use client';

import React from 'react';
import Icon from '../Icon.jsx';
import { KIND_LABEL } from '../../../lib/theme-studio/role-state.js';

const KIND_ICON = { linked: 'link', custom: 'pencil', locked: 'lock' };

/** Linked / Custom / Locked, always as text plus an icon. */
export function KindBadge({ kind, label }) {
  return (
    <span className={`ts-badge ts-badge--${kind}`}>
      <Icon name={KIND_ICON[kind] || 'link'} size={12} />
      {label || KIND_LABEL[kind]}
    </span>
  );
}

/**
 * The state-machine controls of one role. Every transition is an explicit
 * button; moving the master hue never presses one of them.
 *   onAction('make-custom' | 'reset' | 'lock' | 'unlock' | 'copy-to-other' | 'link-to-other')
 */
export default function LinkToggle({ actions, resettable, otherMode, onAction, idBase }) {
  const other = otherMode === 'dark' ? 'Dark' : 'Light';
  return (
    <div className="ts-btn-row" role="group" aria-label="Role link state" id={`${idBase}-actions`}>
      {actions.canMakeCustom ? (
        <button type="button" className="ts-btn ts-btn--sm" onClick={() => onAction('make-custom')}>
          <Icon name="pencil" size={14} /> Make custom
        </button>
      ) : null}
      {(resettable || actions.kind !== 'linked') ? (
        <button type="button" className="ts-btn ts-btn--sm" onClick={() => onAction('reset')} disabled={!resettable}>
          <Icon name="reset" size={14} /> {actions.resetLabel}
        </button>
      ) : null}
      {actions.canLock ? (
        <button type="button" className="ts-btn ts-btn--sm" onClick={() => onAction('lock')}>
          <Icon name="lock" size={14} /> Lock
        </button>
      ) : null}
      {actions.canUnlock ? (
        <button type="button" className="ts-btn ts-btn--sm" onClick={() => onAction('unlock')}>
          <Icon name="unlock" size={14} /> Unlock
        </button>
      ) : null}
      <button type="button" className="ts-btn ts-btn--sm" onClick={() => onAction('copy-to-other')}>
        <Icon name="copy" size={14} /> Copy to {other}
      </button>
      <button type="button" className="ts-btn ts-btn--sm" onClick={() => onAction('link-to-other')} disabled={actions.kind === 'locked'}>
        <Icon name="link" size={14} /> Follow {other}
      </button>
    </div>
  );
}
