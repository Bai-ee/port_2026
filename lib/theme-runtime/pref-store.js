// Viewer light/dark/system preference store (contract §7.5). Plain module, no React.
// Main-bundle safe: imports only lib/theme/{constants,mode} and the slim generated runtime data.
//
// Mode rules are shared with the pre-paint bootstrap through lib/theme/mode.js; the
// bootstrap-parity test proves the bootstrap and this store agree on the first paint.

import { STORAGE_KEYS, PREFERENCES } from '../theme/constants.js';
import { normalizePreference, resolveMode } from '../theme/mode.js';
import runtimeData from '../theme/production/resolved.runtime.generated.js';
import { createSafeStorage, localSource } from './storage.js';
import { createDefaultScheduler } from './scheduler.js';
import { applyModeAttributes, createSwitchingGate } from './dom-attrs.js';
import { emitTokensChanged } from './read-token.js';

export const DEFAULT_PREFERENCE = normalizePreference(runtimeData && runtimeData.defaults && runtimeData.defaults.viewerPreference, 'light');
export const DARK_QUERY = '(prefers-color-scheme: dark)';

const SERVER_SNAPSHOT = Object.freeze({
  preference: DEFAULT_PREFERENCE,
  systemMode: 'light',
  resolvedMode: DEFAULT_PREFERENCE === 'dark' ? 'dark' : 'light',
  storageAvailable: true,
});

/**
 * @param options  all injectable for tests:
 *   storage            Storage-like object, or () => Storage (default: window.localStorage)
 *   matchMedia         (query) => MediaQueryList-like (default: window.matchMedia)
 *   document           (default: global document; null => no DOM writes)
 *   win                event target for `storage` events (default: window)
 *   defaultPreference  (default: production default from the generated runtime data)
 *   scheduler          { raf, caf, ... } (default: requestAnimationFrame based)
 */
export function createPrefStore(options = {}) {
  const hasWindow = typeof window !== 'undefined';
  const doc = options.document !== undefined ? options.document : (typeof document !== 'undefined' ? document : null);
  const win = options.win !== undefined ? options.win : (hasWindow ? window : null);
  const defaultPreference = normalizePreference(options.defaultPreference, DEFAULT_PREFERENCE);
  const sched = options.scheduler || createDefaultScheduler();
  const matchMediaFn = options.matchMedia !== undefined
    ? options.matchMedia
    : (hasWindow && typeof window.matchMedia === 'function' ? window.matchMedia.bind(window) : null);

  let storageAvailable = true;
  let ready = false;
  const safe = createSafeStorage(options.storage !== undefined ? options.storage : localSource, {
    onFail: () => {
      storageAvailable = false;
      if (ready && rebuildSnapshot()) scheduleNotify();
    },
  });

  // ---- initial value: <html data-theme-pref> (set by the bootstrap) -> storage -> default ----
  let mq = null;
  try { mq = matchMediaFn ? matchMediaFn(DARK_QUERY) : null; } catch { mq = null; }
  const readSystem = () => {
    try { return mq && mq.matches ? 'dark' : 'light'; } catch { return 'light'; }
  };

  let preference = defaultPreference;
  if (doc) {
    const fromAttr = doc.documentElement && doc.documentElement.getAttribute('data-theme-pref');
    if (PREFERENCES.includes(fromAttr)) preference = fromAttr;
    else {
      const stored = safe.get(STORAGE_KEYS.pref);
      preference = PREFERENCES.includes(stored) ? stored : defaultPreference;
    }
    storageAvailable = safe.available;
  }
  let systemMode = readSystem();
  let override = null; // preview override (Studio): never persisted

  const effective = () => resolveMode(override || preference, systemMode === 'dark');

  let snapshot = null;
  function rebuildSnapshot() {
    const next = { preference, systemMode, resolvedMode: effective(), storageAvailable: storageAvailable && safe.available };
    if (snapshot
      && snapshot.preference === next.preference
      && snapshot.systemMode === next.systemMode
      && snapshot.resolvedMode === next.resolvedMode
      && snapshot.storageAvailable === next.storageAvailable) return false;
    snapshot = Object.freeze(next);
    return true;
  }
  rebuildSnapshot();
  ready = true;

  // ---- DOM + notification ----
  const gate = doc ? createSwitchingGate(doc, sched.raf) : null;
  const listeners = new Set();
  let notifyHandle = null;
  let modeChangedPending = false;

  function scheduleNotify() {
    if (notifyHandle !== null) return;
    notifyHandle = sched.raf(() => {
      notifyHandle = null;
      if (modeChangedPending) { modeChangedPending = false; emitTokensChanged(doc); }
      for (const l of Array.from(listeners)) { try { l(); } catch { /* isolate listeners */ } }
    });
  }

  function commit({ switching }) {
    const before = snapshot;
    const changed = rebuildSnapshot();
    if (doc) {
      const release = switching && before && before.resolvedMode !== snapshot.resolvedMode && gate ? gate.hold() : null;
      applyModeAttributes(doc, { mode: snapshot.resolvedMode, preference });
      if (release) release();
    }
    if (changed) {
      if (before && before.resolvedMode !== snapshot.resolvedMode) modeChangedPending = true;
      scheduleNotify();
    }
  }

  // Align attributes with state at creation (a no-op when the bootstrap already ran).
  if (doc) applyModeAttributes(doc, { mode: snapshot.resolvedMode, preference });

  // ---- external events ----
  function onSystemChange(event) {
    systemMode = event && typeof event.matches === 'boolean' ? (event.matches ? 'dark' : 'light') : readSystem();
    // snapshot.systemMode always updates; attributes only move when the effective preference is 'system'
    commit({ switching: true });
  }

  function onStorage(event) {
    if (!event) return;
    if (event.key !== null && event.key !== undefined && event.key !== STORAGE_KEYS.pref) return;
    const next = event.key === null || event.key === undefined
      ? defaultPreference
      : normalizePreference(event.newValue, defaultPreference);
    if (next === preference) return;
    preference = next; // adopt only; never write back (no ping-pong between tabs)
    commit({ switching: true });
  }

  let started = false;
  let stopFns = [];

  const store = {
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => SERVER_SNAPSHOT,

    setPreference(pref) {
      const next = normalizePreference(pref, preference);
      safe.set(STORAGE_KEYS.pref, next);
      preference = next;
      commit({ switching: true });
    },

    /** Studio preview: temporarily show 'light' | 'dark' | 'system' (null clears). Not persisted. */
    setPreviewOverride(value) {
      const next = value === null || value === undefined ? null : (PREFERENCES.includes(value) ? value : override);
      if (next === override) return;
      override = next;
      commit({ switching: true });
    },
    getPreviewOverride: () => override,

    /** Attach OS-change and cross-tab listeners. Idempotent; returns stop(). */
    start() {
      if (started) return store.stop;
      started = true;
      if (mq) {
        try {
          if (typeof mq.addEventListener === 'function') {
            mq.addEventListener('change', onSystemChange);
            stopFns.push(() => mq.removeEventListener('change', onSystemChange));
          } else if (typeof mq.addListener === 'function') {
            mq.addListener(onSystemChange);
            stopFns.push(() => mq.removeListener(onSystemChange));
          }
        } catch { /* ignore */ }
        // the OS may have changed between creation and start
        const now = readSystem();
        if (now !== systemMode) { systemMode = now; commit({ switching: false }); }
      }
      if (win && typeof win.addEventListener === 'function') {
        win.addEventListener('storage', onStorage);
        stopFns.push(() => win.removeEventListener('storage', onStorage));
      }
      // Another tab may have changed the preference between the bootstrap (which set the attribute)
      // and this listener attaching (hydration can lag, notably in dev): that `storage` event was
      // missed, so adopt whatever storage says now. Only a valid stored value counts.
      if (doc) {
        const stored = safe.get(STORAGE_KEYS.pref);
        if (PREFERENCES.includes(stored) && stored !== preference) {
          preference = stored; // adopt only; never write back
          commit({ switching: false });
        }
      }
      return store.stop;
    },
    stop() {
      started = false;
      const fns = stopFns;
      stopFns = [];
      fns.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    },

    // exposed for ThemeRuntime/tests
    _onSystemChange: onSystemChange,
    _onStorage: onStorage,
  };
  return store;
}

let singleton = null;

/** Lazily created browser singleton. On the server this returns an inert instance (no DOM, no storage). */
export function getPrefStore() {
  if (!singleton) {
    singleton = typeof window === 'undefined'
      ? createPrefStore({ document: null, win: null, matchMedia: null, storage: () => null })
      : createPrefStore();
  }
  return singleton;
}

/** Test helper: drop the singleton. */
export function _resetPrefStoreForTests() {
  if (singleton) singleton.stop();
  singleton = null;
}
