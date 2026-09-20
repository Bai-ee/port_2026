'use client';

// Invoice Studio HoloPaper — React lifecycle shell around the imperative
// invoice-holo-scene.js world (docs/plans/INVOICE-STUDIO-HOLOPAPER-HANDOFF.md
// §5, Lane S ownership).
//
// Self-contained and generically reusable IN SHAPE — this component does
// NOT know about #invoice-studio-paper-shell, useInvoicePresentation, or
// the invoice iframe. It accepts plain props and a texture bundle shaped
// exactly like Lane R's interop contract; a later integration phase (H2)
// wires up the real props (presentation state, the DOM-snapshot texture
// hook, CSS alignment to the paper shell). Do not import InvoiceCanvas,
// InvoiceStudio, or useInvoicePresentation from here.
//
// Standard mode must never pay the Three.js/Holo bundle cost (H8) —
// invoice-holo-scene.js is imported dynamically here (`import('./invoice-
// holo-scene.js')`, not a static top-of-file import), and this component
// itself is only meant to be mounted (by a later phase) once Holo is
// already enabled, so its own JS is naturally deferred too as long as the
// caller dynamic-imports THIS file — but even if a caller statically
// imports InvoiceHoloSurface.jsx, the Three.js chunk still isn't fetched
// until an actual scene is created (see invoice-holo-scene.js's own header
// for why: the `three`/`three-stdlib` imports live inside
// createInvoiceHoloScene(), which this component only calls once WebGL
// feature-detection has passed).

import React, {
  useEffect, useRef, useState, useCallback,
} from 'react';

// Cheap synchronous WebGL feature probe — a throwaway 1x1 canvas, no
// scene/renderer created. Mirrors the standard "can I even try" check used
// before committing to a real WebGLRenderer; failing this never touches
// invoice-holo-scene.js or Three.js at all.
function detectWebGLSupport() {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return Boolean(gl);
  } catch {
    return false;
  }
}

const FALLBACK_MESSAGE = 'Holo Paper preview is unavailable in this browser. Your invoice is unaffected — every edit and the printed/downloaded document use the standard renderer.';

/**
 * InvoiceHoloSurface — mounts a container div, builds an
 * invoice-holo-scene.js world in it on mount, tears it down on unmount.
 *
 * Props:
 *   - texture: { source: HTMLCanvasElement, width, height, revision } | null
 *       Lane R's interop shape. Forwarded to scene.setTexture() in an
 *       effect keyed on texture.revision.
 *   - interactive: boolean (default false) — forwarded to
 *       scene.setInteractive().
 *   - reducedMotion: boolean (default false) — forwarded to
 *       scene.setReducedMotion().
 *   - active: boolean (default true) — false pauses the scene's own RAF
 *       loop (scene.pause()) without disposing it; true resumes it
 *       (scene.resume()). A later phase uses this for tab-hidden/offscreen
 *       pausing.
 *   - resetViewToken: any — a value that changes (e.g. an incrementing
 *       counter) is treated as a Reset View request, so a later phase's
 *       "Reset View" button can be a plain prop bump rather than needing an
 *       imperative ref. Optional — omit if not needed.
 *   - onReady / onContextLost: forwarded straight to
 *       createInvoiceHoloScene()'s own callbacks.
 *   - onFallback(reason): called once whenever this component ends up
 *       showing the inline fallback notice instead of a live scene —
 *       'unsupported' (WebGL feature-detect failed) or 'context-lost'
 *       (scene reported onContextLost after mounting successfully). A
 *       later phase uses this to switch presentation modes.
 *   - className / style: applied to the outer container div for sizing —
 *       this component renders no size of its own opinion beyond
 *       `position:relative; width:100%; height:100%`.
 */
export default function InvoiceHoloSurface({
  texture = null,
  interactive = false,
  reducedMotion = false,
  active = true,
  resetViewToken = null,
  onReady = null,
  onContextLost = null,
  onFallback = null,
  className = null,
  style = null,
}) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const lastRevisionRef = useRef(-1);
  const onFallbackRef = useRef(onFallback);
  onFallbackRef.current = onFallback;

  // 'checking' | 'unsupported' | 'ready' | 'context-lost'. Distinct from
  // the scene's own internal readiness — this only tracks whether THIS
  // component should render the live container or the honest fallback
  // notice (H16 — never a blank canvas).
  const [surfaceStatus, setSurfaceStatus] = useState('checking');

  useEffect(() => {
    if (!detectWebGLSupport()) {
      setSurfaceStatus('unsupported');
      if (typeof onFallbackRef.current === 'function') onFallbackRef.current('unsupported');
    } else {
      setSurfaceStatus('ready');
    }
  }, []);

  const handleContextLost = useCallback(() => {
    setSurfaceStatus('context-lost');
    if (typeof onFallbackRef.current === 'function') onFallbackRef.current('context-lost');
    if (typeof onContextLost === 'function') onContextLost();
    // The scene stops its own render loop on context loss (see
    // invoice-holo-scene.js's onContextLostHandler); this component does
    // not attempt restoration, matching the handoff's "report it and stop
    // your own render loop cleanly" instruction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onContextLost]);

  // Mount/unmount — one scene per mount, torn down on unmount. Only
  // actually builds a scene while WebGL is supported (surfaceStatus ready);
  // never mounts a scene into a container that's about to show the
  // fallback notice instead.
  useEffect(() => {
    if (surfaceStatus !== 'ready' || !containerRef.current) return undefined;
    let cancelled = false;
    let scene = null;

    (async () => {
      const mod = await import('./invoice-holo-scene.js');
      if (cancelled || !containerRef.current) return;
      const createInvoiceHoloScene = mod.createInvoiceHoloScene || mod.default;
      scene = createInvoiceHoloScene(containerRef.current, {
        onReady: () => { if (!cancelled && typeof onReady === 'function') onReady(); },
        onContextLost: handleContextLost,
      });
      sceneRef.current = scene;
      // Apply whatever the current props already are — this effect can run
      // after the interactive/reducedMotion/texture props have already
      // been set once by React (e.g. Strict Mode's double-invoke, or a
      // fast prop change before the dynamic import resolved).
      scene.setInteractive(interactive === true);
      scene.setReducedMotion(reducedMotion === true);
      if (!active) scene.pause();
      if (texture && texture.source) {
        lastRevisionRef.current = texture.revision;
        scene.setTexture(texture.source, {
          width: texture.width, height: texture.height, revision: texture.revision,
        });
      }
    })();

    return () => {
      cancelled = true;
      if (scene) scene.dispose();
      if (sceneRef.current === scene) sceneRef.current = null;
    };
    // Deliberately mount-once (deps intentionally omitted beyond
    // surfaceStatus): every other prop is applied via its OWN effect below,
    // reading sceneRef.current live, so this effect does not need to
    // re-run (and rebuild the whole scene) when interactive/reducedMotion/
    // texture/active change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceStatus]);

  useEffect(() => {
    sceneRef.current?.setInteractive(interactive === true);
  }, [interactive]);

  useEffect(() => {
    sceneRef.current?.setReducedMotion(reducedMotion === true);
  }, [reducedMotion]);

  useEffect(() => {
    if (!sceneRef.current) return;
    if (active) sceneRef.current.resume();
    else sceneRef.current.pause();
  }, [active]);

  useEffect(() => {
    if (resetViewToken === null || resetViewToken === undefined) return;
    sceneRef.current?.resetView();
    // Intentionally fires on every change of resetViewToken, including the
    // very first non-null value — a caller that starts the token at e.g. 0
    // and only bumps it on button clicks won't see a spurious extra reset
    // because resetView() is idempotent (returns to the same default
    // framing every time).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetViewToken]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !texture || !texture.source) return;
    if (texture.revision === lastRevisionRef.current) return;
    lastRevisionRef.current = texture.revision;
    scene.setTexture(texture.source, {
      width: texture.width, height: texture.height, revision: texture.revision,
    });
    // Keyed on texture.revision per the handoff's own instruction — reading
    // texture.source/width/height from the latest closure is correct
    // because a revision bump always carries a fresh source alongside it in
    // Lane R's contract (a stale source under a bumped revision would be a
    // Lane R bug, not something this effect can detect).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texture && texture.revision]);

  const containerStyle = {
    position: 'relative', width: '100%', height: '100%', ...(style || null),
  };

  if (surfaceStatus === 'unsupported' || surfaceStatus === 'context-lost') {
    return (
      <div
        id="invoice-holo-surface-fallback"
        role="status"
        className={className || undefined}
        style={{
          ...containerStyle,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 16, boxSizing: 'border-box', textAlign: 'center',
          fontSize: 12, lineHeight: 1.5, color: 'rgba(30,30,34,0.72)',
          background: 'rgba(0,0,0,0.03)', borderRadius: 8,
        }}
      >
        <span>{FALLBACK_MESSAGE}</span>
      </div>
    );
  }

  // 'checking' and 'ready' both render the live container — 'checking' is
  // a single synchronous-effect tick (WebGL feature-detection has no async
  // step), so there is no meaningful blank-frame window here; the container
  // is inert (nothing appended to it) until the scene mount effect above
  // actually runs.
  return (
    <div
      id="invoice-holo-surface-container"
      ref={containerRef}
      className={className || undefined}
      style={containerStyle}
    />
  );
}
