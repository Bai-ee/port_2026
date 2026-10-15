'use client';

import React from 'react';

/** Polite status announcements (saves, clamped numbers, copied values). Visually hidden. */
export default function LiveRegion({ message }) {
  return (
    <div id="theme-studio-live-region" className="ts-sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}
