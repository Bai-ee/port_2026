'use client';

// Brief Studio draft: client brief title / markdown / theme / OG fields, kept in
// this browser's localStorage, PER CLIENT. Privacy: nothing is read from or
// written to storage unless `isAdmin` is true and a client is picked, so a
// non-admin never hydrates or renders a stored draft.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearBriefDraft, draftAfterClientChange, draftFromSavedBrief, emptyBriefDraft, normalizeBriefDraft, readBriefDraft, writeBriefDraft,
} from './brief-draft-storage';

const PERSIST_DEBOUNCE_MS = 400;

function getStorage() {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

export function useBriefDraft({ isAdmin = false, clientId = '' } = {}) {
  const activeClientId = isAdmin ? String(clientId || '') : '';
  const [state, setState] = useState(emptyBriefDraft);
  const [loadedFor, setLoadedFor] = useState('');
  const [dirty, setDirty] = useState(false);
  // True once any client has been picked this session: from then on a client
  // switch never carries typed content over (it loads that client's own draft).
  const everPickedRef = useRef(false);

  // Hydrate when the client changes. Switching clients never carries a loaded
  // saved-brief slug across (it belongs to the other client).
  useEffect(() => {
    if (!activeClientId) {
      const firstPickPending = !everPickedRef.current;
      setState((current) => draftAfterClientChange({ current, stored: null, hasClient: false, firstPick: firstPickPending, isAdmin }));
      setLoadedFor('');
      setDirty(false);
      return;
    }
    const firstPick = !everPickedRef.current;
    everPickedRef.current = true;
    const stored = readBriefDraft(getStorage(), activeClientId);
    setState((current) => draftAfterClientChange({ current, stored, hasClient: true, firstPick, isAdmin }));
    setLoadedFor(activeClientId);
    setDirty(false);
  }, [activeClientId, isAdmin]);

  // Debounced persist; skipped until this client's draft has been hydrated.
  useEffect(() => {
    if (!activeClientId || loadedFor !== activeClientId) return undefined;
    const timer = setTimeout(() => writeBriefDraft(getStorage(), activeClientId, state), PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [state, activeClientId, loadedFor]);

  const patch = useCallback((partial) => {
    setState((current) => normalizeBriefDraft({ ...current, ...(typeof partial === 'function' ? partial(current) : partial) }));
    setDirty(true);
  }, []);

  const loadSaved = useCallback((brief) => {
    setState(draftFromSavedBrief(brief));
    setDirty(false);
  }, []);

  const startNew = useCallback(() => {
    setState(emptyBriefDraft());
    setDirty(false);
    clearBriefDraft(getStorage(), activeClientId);
  }, [activeClientId]);

  const markSaved = useCallback((savedSlug) => {
    setState((current) => ({ ...current, savedSlug: savedSlug || current.savedSlug }));
    setDirty(false);
  }, []);

  return {
    ready: Boolean(activeClientId) && loadedFor === activeClientId,
    clientId: activeClientId,
    ...state,
    dirty,
    patch,
    setText: (text) => patch({ text }),
    setTitle: (title) => patch({ title }),
    setTheme: (themeId) => patch({ themeId: themeId || null }),
    loadSaved,
    startNew,
    markSaved,
  };
}
