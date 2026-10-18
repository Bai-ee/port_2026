'use client';

// The dashboard's standard loader (the comet ring used for the card grid and briefs: .brief-loader-spinner in
// styles/dashboard/01-base.css), centered in its space. Use it wherever content is being waited on, instead of
// "Loading…" text or skeleton rows. `label` is read by screen readers only.

import React from 'react';

export default function LoadingRing({ id, label = 'Loading', size = 36, minHeight = 160 }) {
  return (
    <div
      id={id}
      className="loading-ring"
      role="status"
      aria-label={label}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', minHeight }}
    >
      <div className="brief-loader-spinner" aria-hidden="true" style={size === 36 ? undefined : { width: size, height: size }} />
    </div>
  );
}
