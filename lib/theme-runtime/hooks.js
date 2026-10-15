// React hooks over the stores (contract §7.6). Client only. All use useSyncExternalStore with
// selectors, so a component re-renders only when the value it selected changes.
// This file is main-bundle safe: it imports the pref store only (never the draft store/engine).

'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { getPrefStore } from './pref-store.js';
import { createSelectorGetter } from './select.js';

export { readToken, onTokensChanged } from './read-token.js';

/**
 * Generic selector hook over any store with { subscribe, getSnapshot, getServerSnapshot }.
 * `isEqual` (default Object.is) lets selectors that build small objects avoid re-renders: pass shallowEqual.
 */
export function useStoreSelector(store, selector, isEqual) {
  const getters = useMemo(() => ({
    client: createSelectorGetter(store.getSnapshot, isEqual),
    server: createSelectorGetter(store.getServerSnapshot, isEqual),
  }), [store]); // eslint-disable-line react-hooks/exhaustive-deps
  const getClientValue = useCallback(() => getters.client(selector), [getters, selector]);
  const getServerValue = useCallback(() => getters.server(selector), [getters, selector]);
  return useSyncExternalStore(store.subscribe, getClientValue, getServerValue);
}

/** Select from the preference snapshot { preference, systemMode, resolvedMode, storageAvailable }. */
export function useThemeSelector(selector, isEqual) {
  return useStoreSelector(getPrefStore(), selector, isEqual);
}

const selectPreference = (s) => s.preference;
const selectResolvedMode = (s) => s.resolvedMode;

/** { preference, setPreference }: re-renders only when the preference changes. */
export function useThemePreference() {
  const preference = useThemeSelector(selectPreference);
  const setPreference = useCallback((value) => getPrefStore().setPreference(value), []);
  return { preference, setPreference };
}

/** 'light' | 'dark': the mode currently applied to <html data-theme>. */
export function useResolvedMode() {
  return useThemeSelector(selectResolvedMode);
}
