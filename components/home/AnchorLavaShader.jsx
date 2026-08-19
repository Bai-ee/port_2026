'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  LAVA_DEFAULTS,
  createLavaEngine,
  normalizeLavaParams,
} from './lavaShaderEngine';

/*
 * A single-quad WebGL animated surface over the brand gradient (see
 * LAVA_BRAND_STOPS in ./lavaShaderEngine). Built to drop inside the ~68px anchor
 * band at the bottom of the homepage "I'm Bryan Balli" card
 * (#cmo-dashboard-card-anchor-footer), which already paints the identical ramp in
 * CSS.
 *
 * The CSS gradient is the fallback, so this renders NOTHING (returns null)
 * whenever it cannot do better: reduced-motion preference, no WebGL, or a shader
 * that fails to compile. That decision is made after mount so SSR and the first
 * client render agree (no hydration mismatch) and the band never flashes.
 *
 * The renderer itself lives in ./lavaShaderEngine — see that file's header for
 * the CPU-simulated-blobs and band-heights decisions. Every look value is a
 * live-tunable param there.
 *
 * TUNING — two ways in, both deliberately invisible (there is no on-screen
 * button; it was removed so nothing floats over the page):
 *   - Shift+L anywhere on the page
 *   - ?lava=1 or #lava in the URL (handy on a deployed preview)
 * Either works on any build. The panel is a separate chunk, so a real visitor
 * never downloads it, and tuned values are only read back from localStorage on a
 * dev surface — a production page load always renders the committed defaults.
 */

const LavaControls = dynamic(() => import('./AnchorLavaControls'), { ssr: false });

// Bump this whenever the DEFAULTS change in a way a stored session would mask —
// an old session is silently discarded rather than overriding the new defaults.
export const LAVA_TUNING_STORAGE_KEY = 'anchor-lava-tuning-v4';
const LAVA_PANEL_OPEN_KEY = 'anchor-lava-panel-open';

const DEFAULT_COLORS = [LAVA_DEFAULTS.colorA, LAVA_DEFAULTS.colorB, LAVA_DEFAULTS.colorC];

// Whether this is a local/dev surface. Used only to decide if a stored tuning
// session is restored — production never reads one, so a real visitor always gets
// the committed defaults. NODE_ENV is inlined at build time, so the hostname
// check is just a backstop for a prod build served locally.
function isDevSurface() {
  if (typeof window === 'undefined') return false;
  if (process.env.NODE_ENV !== 'production') return true;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local');
}

// Opt-in that works on ANY build (deployed previews included).
function wantsControls() {
  if (typeof window === 'undefined') return false;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('lava') === '1' || url.hash === '#lava') return true;
  } catch {
    /* malformed URL — fall through to the stored flag */
  }
  // Reopen automatically if a tuning session was left open, so a reload during a
  // dial-in session does not cost you the panel.
  try {
    return window.localStorage.getItem(LAVA_PANEL_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function readStoredTuning() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LAVA_TUNING_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function AnchorLavaShader({
  colors = DEFAULT_COLORS,
  intensity = LAVA_DEFAULTS.intensity,
  fps = LAVA_DEFAULTS.fps,
  blobCount = LAVA_DEFAULTS.blobCount,
  controls = false,
}) {
  const canvasRef = useRef(null);
  // Once WebGL or a shader has failed, stay off for the rest of the mount and
  // warn only that once.
  const failedRef = useRef(false);
  const [enabled, setEnabled] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  // The props are the committed look; the panel's overrides layer on top.
  const list = Array.isArray(colors) ? colors : DEFAULT_COLORS;
  const baseParams = useMemo(
    () =>
      normalizeLavaParams({
        colorA: list[0],
        colorB: list[1],
        colorC: list[2],
        intensity,
        fps,
        blobCount,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list.join('|'), intensity, fps, blobCount]
  );

  const [overrides, setOverrides] = useState(null);

  // Params are read fresh every frame out of a ref, so dragging a slider never
  // remounts the engine or rebuilds the GL program.
  const paramsRef = useRef(baseParams);
  const liveParams = useMemo(
    () => (overrides ? { ...baseParams, ...overrides } : baseParams),
    [baseParams, overrides]
  );
  paramsRef.current = liveParams;
  const getParams = useCallback(() => paramsRef.current, []);

  // Gate 1: motion preference + panel opt-in. Runs after mount, so the server
  // and the first client render both produce null and the canvas only ever
  // appears later.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const dev = isDevSurface();
    const wanted = controls || wantsControls();
    if (wanted) setPanelOpen(true);
    // A stored session stays live on a dev surface (or wherever the panel was
    // explicitly asked for) until Reset clears it. Production never reads it, so
    // a real visitor always gets the committed look.
    if (dev || wanted) {
      const stored = readStoredTuning();
      if (stored) setOverrides(stored);
    }
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setEnabled(!mq.matches && !failedRef.current);
    apply();
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, [controls]);

  // Shift+L toggles the panel from anywhere on the page. Ignored while typing so
  // it can never eat a capital L in a real form field.
  useEffect(() => {
    const onKey = (event) => {
      if (!event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== 'L' && event.key !== 'l') return;
      const el = event.target;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      setPanelOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Remember whether the panel was open so a reload mid-session keeps it up.
  useEffect(() => {
    try {
      if (panelOpen) window.localStorage.setItem(LAVA_PANEL_OPEN_KEY, '1');
      else window.localStorage.removeItem(LAVA_PANEL_OPEN_KEY);
    } catch {
      /* private mode / quota — the panel just will not reopen on reload */
    }
  }, [panelOpen]);

  // Gate 2: the GL engine. Mounted once — it owns its own rAF loop, observers
  // and pointer listeners, and reads params per frame.
  useEffect(() => {
    if (!enabled || failedRef.current) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const engine = createLavaEngine({ canvas, getParams });
    if (!engine) {
      failedRef.current = true;
      setEnabled(false);
      return undefined;
    }
    return () => engine.destroy();
  }, [enabled, getParams]);

  const handleChange = useCallback((next) => {
    setOverrides(next);
    try {
      window.localStorage.setItem(LAVA_TUNING_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* private mode / quota — tuning just will not survive a reload */
    }
  }, []);

  const handleReset = useCallback(() => {
    setOverrides(null);
    try {
      window.localStorage.removeItem(LAVA_TUNING_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  if (!enabled) return null;

  return (
    <>
      <canvas
        ref={canvasRef}
        id="anchor-lava-shader-canvas"
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      />
      {panelOpen ? (
        <LavaControls
          params={liveParams}
          baseParams={baseParams}
          onChange={handleChange}
          onReset={handleReset}
          onClose={() => setPanelOpen(false)}
        />
      ) : null}
    </>
  );
}

export default AnchorLavaShader;
