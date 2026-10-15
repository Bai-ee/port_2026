// Per-canvas smoother between the scene store (scene-bridge.js) and the render loop.
//
// ox.jsx owns ONE driver per <Canvas> instance. The bridge pushes the latest target into it from a
// subscription (no React state); the render loop calls `step()` every frame and reads the smoothed
// `state`. The state object, its fields and every object a consumer derives from it keep their
// identity for the life of the driver, so a theme change never allocates, remounts or recompiles.
//
// Contract §9.3.2: dt-based exponential smoothing with the surface's own `paramSmoothing` rate;
// snap when prefers-reduced-motion. Refinement over the literal contract: the opaque *background*
// snaps when the resolved palette flips (light <-> dark) so the canvas never lags behind the
// instantly-switching page chrome; the background still eases for edits within a palette (Studio drags).

import { normalizeSceneTargets, SCENE_IDENTITY } from './apply-scene.js';
import { wrapTurns } from './util.js';

const EPS = 1e-6;

const SCALAR_KEYS = [
  'saturationMul', 'lightnessDelta', 'opacityMul', 'hueSpan',
  'highlightMix', 'highlightR', 'highlightG', 'highlightB',
];
const BACKGROUND_KEYS = ['backgroundR', 'backgroundG', 'backgroundB'];

function blank() {
  return normalizeSceneTargets(SCENE_IDENTITY, {});
}

export function createSceneDriver() {
  /** Smoothed values the render loop reads. Same fields as a ResolvedScene's numeric deltas. */
  const state = Object.assign(blank(), { version: 0, ready: false });
  const target = blank();
  let hasTarget = false;
  let modeKey = null;
  let snapBackground = false;
  let lastStepTime = null;

  /** Jump to the target; returns true when any value actually moved. */
  const copyAll = () => {
    let moved = state.hueShift !== target.hueShift;
    state.hueShift = target.hueShift;
    for (const k of SCALAR_KEYS) { if (state[k] !== target[k]) moved = true; state[k] = target[k]; }
    for (const k of BACKGROUND_KEYS) { if (state[k] !== target[k]) moved = true; state[k] = target[k]; }
    return moved;
  };

  return {
    state,

    /**
     * Point the driver at a new scene. `nextModeKey` is the palette the scene belongs to ('light' |
     * 'dark'); a change of palette snaps the background. The first target is adopted immediately so
     * the very first frame already shows the right colours.
     */
    setTarget(scene, nextModeKey = null) {
      normalizeSceneTargets(scene, target);
      if (!hasTarget) {
        hasTarget = true;
        copyAll();
        state.ready = true;
        state.version += 1;
      } else if (nextModeKey !== modeKey) {
        snapBackground = true;
      }
      modeKey = nextModeKey;
    },

    hasTarget() {
      return hasTarget;
    },

    /**
     * Advance one frame. Idempotent for a given `time` (seconds), so several consumers in the same
     * frame (particles + background) can all call it. `rate` is the exponential rate in 1/s;
     * `snap` jumps straight to the target (reduced motion).
     */
    step(time, rate = 10, snap = false) {
      if (!hasTarget) return state;
      if (time === lastStepTime) return state;
      const dt = lastStepTime === null || !Number.isFinite(time) ? 0 : Math.min(Math.max(time - lastStepTime, 0), 0.1);
      lastStepTime = Number.isFinite(time) ? time : lastStepTime;

      if (snap) {
        if (copyAll()) state.version += 1;
        snapBackground = false;
        return state;
      }

      const k = 1 - Math.exp(-dt * rate);
      let changed = false;

      // Hue shift is circular: move along the shortest arc.
      const dh = wrapTurns(target.hueShift - state.hueShift);
      if (dh !== 0) {
        changed = true;
        state.hueShift = Math.abs(dh) < EPS ? target.hueShift : wrapTurns(state.hueShift + dh * k);
      }

      for (const key of SCALAR_KEYS) {
        const d = target[key] - state[key];
        if (d !== 0) {
          changed = true;
          state[key] = Math.abs(d) < EPS ? target[key] : state[key] + d * k;
        }
      }

      for (const key of BACKGROUND_KEYS) {
        const d = target[key] - state[key];
        if (d !== 0) {
          changed = true;
          state[key] = snapBackground || Math.abs(d) < EPS ? target[key] : state[key] + d * k;
        }
      }
      snapBackground = false;

      if (changed) state.version += 1;
      return state;
    },
  };
}

/** One-shot: read the right scene for `sceneMode` from `bridge` into `driver`. No-op for 'off'. */
export function syncDriver(driver, bridge, sceneMode) {
  const scene = bridge.getForSceneMode(sceneMode);
  if (!scene) return false;
  driver.setTarget(scene, bridge.resolveModeFor(sceneMode));
  return true;
}

/** Sync now and on every bridge change. Returns the unsubscribe function. */
export function bindDriver(driver, bridge, sceneMode) {
  if (sceneMode !== 'theme' && sceneMode !== 'light' && sceneMode !== 'dark') return () => {};
  const sync = () => { syncDriver(driver, bridge, sceneMode); };
  sync();
  return bridge.subscribe(sync);
}
