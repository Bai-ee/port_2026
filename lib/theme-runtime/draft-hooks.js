// Draft-store hooks for the Studio. Imports the draft store (and so the authoring engine):
// import this only from the lazy Studio chunk, never from the main bundle.

'use client';

import { getDraftStore } from './draft-store.js';
import { useStoreSelector } from './hooks.js';

/** Select from DraftSnapshot; re-renders only when the selected value changes. */
export function useDraftSelector(selector, isEqual) {
  return useStoreSelector(getDraftStore(), selector, isEqual);
}

/** The draft store instance (stable singleton) for calling actions: const store = useDraftStore(). */
export function useDraftStore() {
  return getDraftStore();
}
