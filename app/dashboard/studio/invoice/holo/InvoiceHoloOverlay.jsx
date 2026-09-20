'use client';

// Invoice Studio HoloPaper — the H8 code-splitting boundary for BOTH the
// snapshot pipeline (Lane R) and the Three.js scene (Lane S).
//
// docs/plans/INVOICE-STUDIO-HOLOPAPER-HANDOFF.md H8: "Scene code is
// dynamically imported only after Holo is enabled. Standard mode must not
// eagerly load three, three-stdlib, Holo shaders, or SNAPSHOT CODE." A plain
// `useInvoiceTexture()` call cannot itself be deferred without breaking the
// Rules of Hooks (a hook can't be called conditionally) — the fix is to put
// the hook call inside its OWN component and load that component's module
// only once Holo is enabled, exactly like InvoiceHoloSurface.jsx already
// defers `three`/`three-stdlib` one level deeper. InvoiceCanvas.jsx reaches
// this file ONLY via `lazy(() => import('./holo/InvoiceHoloOverlay'))`
// behind a `holoEnabled` gate — so THIS file's own static imports below
// (useInvoiceTexture.js, InvoiceHoloSurface.jsx, and transitively
// invoice-dom-snapshot.js / three / three-stdlib) are never fetched in
// Standard mode.
import React from 'react';
import { useInvoiceTexture } from './useInvoiceTexture.js';
import InvoiceHoloSurface from './InvoiceHoloSurface';

export default function InvoiceHoloOverlay({
  iframeEl,
  refreshKey,
  loadTick,
  maxDimension,
  interactive = false,
  reducedMotion = false,
  active = true,
  resetViewToken = null,
  onReady = null,
  onFallback = null,
}) {
  // `enabled: true` unconditionally — this component only ever mounts while
  // Holo is already enabled (InvoiceCanvas.jsx gates the lazy import itself
  // on `holoEnabled && hasLoadedOnce`), so there is no "disabled" state to
  // represent here; that gating already lives one level up.
  const { texture } = useInvoiceTexture(iframeEl, {
    enabled: true, refreshKey, loadTick, maxDimension,
  });

  return (
    <InvoiceHoloSurface
      texture={texture}
      interactive={interactive}
      reducedMotion={reducedMotion}
      active={active}
      resetViewToken={resetViewToken}
      onReady={onReady}
      onFallback={onFallback}
    />
  );
}
