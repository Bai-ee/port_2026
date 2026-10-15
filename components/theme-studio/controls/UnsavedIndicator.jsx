'use client';

import React from 'react';
import { formatClock } from '../../../lib/theme-studio/format.js';

/** Dirty dot plus text. State is never conveyed by the dot alone. */
export default function UnsavedIndicator({ dirty, savedAt }) {
  if (dirty) {
    return (
      <span id="theme-studio-unsaved-indicator" className="ts-status">
        <span className="ts-dot ts-dot--dirty" aria-hidden="true" />
        <strong>Unsaved changes</strong>
      </span>
    );
  }
  const t = savedAt ? formatClock(savedAt) : '';
  return (
    <span id="theme-studio-unsaved-indicator" className="ts-status">
      <span className={`ts-dot${t ? ' ts-dot--saved' : ''}`} aria-hidden="true" />
      <span>{t ? `Saved ${t} (local)` : 'No changes yet'}</span>
    </span>
  );
}
