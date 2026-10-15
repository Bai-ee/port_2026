// Module-level scene store (contract §9.2). Plain JS, no React state: ox.jsx subscribes into a ref
// and reads it inside useFrame. WS2's ThemeRuntime / draft applier are the writers.
//
//   setProduction({light, dark})   ResolvedScene x2 from the generated runtime data
//   setMode('light'|'dark')        resolved viewer mode
//   setDraft({light, dark}|null)   unsaved Studio draft (wins over production while set)
//   get(which = 'current')         'current' | 'light' | 'dark'  ->  ResolvedScene  (draft ?? production)
//   subscribe(fn) -> unsubscribe   fn() after any effective change
//
// Extras used by ox.jsx: getMode(), getForSceneMode(sceneMode), resolveModeFor(sceneMode).
//
// The process-wide instance lives on globalThis so a duplicated module instance (separate chunk,
// HMR) still talks to the same store.

import { SCENE_IDENTITY } from './apply-scene.js';

const isObj = (v) => v !== null && typeof v === 'object';

function readDomMode() {
  try {
    if (typeof document !== 'undefined' && document.documentElement) {
      return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    }
  } catch { /* ignore */ }
  return 'light';
}

export function createSceneBridge() {
  let production = null;
  let draft = null;
  let mode = null; // null until ThemeRuntime calls setMode; then the DOM attribute is a safe stand-in
  const listeners = new Set();

  const notify = () => {
    for (const fn of Array.from(listeners)) {
      try { fn(); } catch { /* a broken listener must not block the others */ }
    }
  };

  const pick = (which) => {
    const w = which === 'dark' ? 'dark' : 'light';
    const fromDraft = draft && isObj(draft[w]) ? draft[w] : null;
    if (fromDraft) return fromDraft;
    const fromProd = production && isObj(production[w]) ? production[w] : null;
    return fromProd || SCENE_IDENTITY;
  };

  const bridge = {
    setProduction(pair) {
      const next = isObj(pair) ? pair : null;
      if (next === production) return;
      production = next;
      notify();
    },
    setMode(next) {
      const m = next === 'dark' ? 'dark' : 'light';
      if (m === mode) return;
      mode = m;
      notify();
    },
    setDraft(pair) {
      const next = isObj(pair) ? pair : null;
      if (next === draft) return;
      draft = next;
      notify();
    },
    getMode() {
      return mode || readDomMode();
    },
    get(which = 'current') {
      if (which === 'light' || which === 'dark') return pick(which);
      return pick(bridge.getMode());
    },
    /** sceneMode: 'theme' | 'light' | 'dark' | 'off'. null for 'off' / unknown. */
    getForSceneMode(sceneMode) {
      if (sceneMode === 'theme') return bridge.get('current');
      if (sceneMode === 'light' || sceneMode === 'dark') return bridge.get(sceneMode);
      return null;
    },
    /** The palette ('light' | 'dark') a sceneMode resolves to right now; null for 'off'. */
    resolveModeFor(sceneMode) {
      if (sceneMode === 'theme') return bridge.getMode();
      if (sceneMode === 'light' || sceneMode === 'dark') return sceneMode;
      return null;
    },
    hasDraft() {
      return draft !== null;
    },
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    /** Test helper: forget all state (listeners are kept so subscribers observe the reset). */
    reset() {
      production = null;
      draft = null;
      mode = null;
      notify();
    },
  };
  return bridge;
}

const GLOBAL_KEY = Symbol.for('hitloop.themeSceneBridge.v1');

function getSharedBridge() {
  const g = globalThis;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = createSceneBridge();
  return g[GLOBAL_KEY];
}

export const sceneBridge = getSharedBridge();
export default sceneBridge;
