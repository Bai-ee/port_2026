'use client';

import React from 'react';

// Themed static stand-in for the WebGL scene: used when WebGL is unavailable, the scene chunk fails
// to load, a render throws, or the GL context is lost. Paints `--t-scene-fallback` (two soft radial
// washes in the scene's base / secondary swatches) over `--t-page`, so it follows light/dark and the
// Studio draft like the rest of the page. Deliberately static: no animation, nothing to reduce.
//
// `position` is 'absolute' inside an already-fixed scene wrapper and 'fixed' when it replaces a
// whole canvas mount (Home), matching ox.jsx's own full-viewport canvas.
export default function SceneFallback({ id = 'scene-fallback', reason = 'unavailable', position = 'absolute', zIndex = 0 }) {
  return (
    <div
      id={id}
      data-scene-fallback={reason}
      aria-hidden="true"
      style={{
        position,
        inset: 0,
        zIndex,
        pointerEvents: 'none',
        backgroundColor: 'var(--t-page)',
        backgroundImage: 'var(--t-scene-fallback)',
      }}
    />
  );
}
