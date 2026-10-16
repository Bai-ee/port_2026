'use client';

import React, {
  createContext, useCallback, useContext, useMemo, useRef, useState, useSyncExternalStore,
} from 'react';
import { resolveBoth } from '../../lib/theme/index.js';
import { createLibrary } from '../../lib/theme-studio/library.js';
import { createSafeStorage, localSource } from '../../lib/theme-runtime/storage.js';

const Ctx = createContext(null);

export const StudioProvider = Ctx.Provider;

export function useStudio() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStudio must be used inside <ThemeStudio>');
  return v;
}

/**
 * Subscribe to a slice of the draft-store snapshot. Re-renders only when the
 * selected value changes (compared with `equal`), never on every drag frame
 * unless the selected slice actually moved.
 */
export function useStoreSelector(store, selector, equal = Object.is) {
  // `selector` must be a module-level function or return a primitive / stable reference.
  const cache = useRef({ snap: undefined, selector: undefined, value: undefined, has: false });
  const get = useCallback(() => {
    const snap = store.getSnapshot();
    const c = cache.current;
    if (c.has && c.snap === snap && c.selector === selector) return c.value;
    const next = selector(snap);
    if (c.has && c.selector === selector && equal(c.value, next)) {
      c.snap = snap;
      return c.value;
    }
    cache.current = { snap, selector, value: next, has: true };
    return next;
  }, [store, selector, equal]);
  const getServer = useCallback(() => selector(store.getServerSnapshot()), [store, selector]);
  return useSyncExternalStore(store.subscribe, get, getServer);
}

const selDraft = (s) => s.draft;
const selResolved = (s) => s.resolved;
const selEditing = (s) => s.editingMode;
const selReport = (s) => s.report;
const selPreview = (s) => s.previewMode;
const selCompare = (s) => s.compare;

export function useDraft() {
  const { store } = useStudio();
  return useStoreSelector(store, selDraft);
}
export function useEditingMode() {
  const { store } = useStudio();
  return useStoreSelector(store, selEditing);
}
export function usePreviewMode() {
  const { store } = useStudio();
  return useStoreSelector(store, selPreview);
}
export function useCompare() {
  const { store } = useStudio();
  return useStoreSelector(store, selCompare);
}
export function useReport() {
  const { store } = useStudio();
  return useStoreSelector(store, selReport);
}

/** The store's resolved { light, dark } pair, or one resolved here from the draft. */
export function useResolvedPair() {
  const { store } = useStudio();
  const draft = useStoreSelector(store, selDraft);
  const fromStore = useStoreSelector(store, selResolved);
  return useMemo(() => {
    if (fromStore && fromStore.light && fromStore.dark) return fromStore;
    return draft ? resolveBoth(draft) : null;
  }, [fromStore, draft]);
}

/** Polite live-region announcements (re-announces identical text). */
export function useAnnouncer() {
  const [msg, setMsg] = useState('');
  const flip = useRef(false);
  const announce = useCallback((text) => {
    flip.current = !flip.current;
    setMsg(`${text}${flip.current ? '' : '​'}`);
  }, []);
  return [msg, announce];
}

// --- My Themes library (P4) -------------------------------------------------
// One shared library per page. Every write bumps a version so every subscriber
// (the Library section today, anything else later) re-reads the list.
let sharedLibrary = null;
let libraryVersion = 0;
const libraryListeners = new Set();
const notifyLibrary = () => { libraryVersion += 1; libraryListeners.forEach((fn) => fn()); };
const WRITES = ['save', 'rename', 'duplicate', 'star', 'remove', 'importAll'];

function getSharedLibrary() {
  if (!sharedLibrary) {
    const raw = createLibrary({ storage: createSafeStorage(localSource) });
    sharedLibrary = Object.create(raw);
    for (const k of WRITES) {
      if (typeof raw[k] === 'function') sharedLibrary[k] = (...a) => { const r = raw[k](...a); notifyLibrary(); return r; };
    }
    sharedLibrary.cap = raw.cap;
  }
  return sharedLibrary;
}
const subscribeLibrary = (fn) => { libraryListeners.add(fn); return () => libraryListeners.delete(fn); };
const libraryVersionNow = () => libraryVersion;

/** A "My Themes" library bound to this browser's localStorage (failure-tolerant). */
export function useThemeLibrary() {
  return getSharedLibrary();
}

/** Changes whenever the shared library is written to; use it to re-read `list()`. */
export function useLibraryVersion() {
  return useSyncExternalStore(subscribeLibrary, libraryVersionNow, libraryVersionNow);
}
