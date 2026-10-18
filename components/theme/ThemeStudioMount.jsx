'use client';

// Theme Studio entry point (contract §8.4). Renders nothing until the viewer is an admin (or, in
// development only, opted in with ?theme-studio=1). There is no floating launcher any more: the
// Studio opens from the dashboard Admin › Theme Studio card (its button is #theme-studio-launcher and
// fires OPEN_EVENT) or with Alt+Shift+T. The Studio and the draft store (with the whole authoring
// engine) are loaded on first open: non-admin bundles never fetch that chunk.

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '../../AuthContext';
import { isStudioEnabled } from '../../lib/theme-runtime/studio-gate';
import { STORAGE_KEYS } from '../../lib/theme/constants';
import { createSafeStorage, localSource } from '../../lib/theme-runtime/storage';
import { syncSiteDraft } from '../../lib/theme-runtime/site-draft';

// Lazy-load boundary (contract §11.1). WS3 provides components/theme-studio/ThemeStudio.jsx
// (default export, props: { open, onClose }).
const ThemeStudio = dynamic(() => import('../theme-studio/ThemeStudio'), { ssr: false, loading: () => null });

const LAUNCHER_ID = 'theme-studio-launcher';
// Dispatched by the dashboard Admin › Theme Studio card (#theme-studio-launcher) and, in development,
// by #dev-theme-editor-button in HomePage.jsx.
const OPEN_EVENT = 'theme-studio:open';

export default function ThemeStudioMount() {
  const { isAdmin, adminReady } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);

  // Evaluated on the client only: the query string and sessionStorage do not exist during SSR.
  useEffect(() => {
    let session;
    try { session = window.sessionStorage; } catch { session = undefined; }
    const allowed = isStudioEnabled({
      isAdmin,
      adminReady,
      search: window.location.search,
      nodeEnv: process.env.NODE_ENV,
      sessionStorage: session,
    });
    setEnabled(allowed);

    // A site-wide applied draft must not outlive the admin session: once the viewer is known not
    // to be allowed into the Studio there is no launcher left to revert it, yet the pre-paint
    // bootstrap would keep injecting it for this browser. Clear the three site keys and re-sync.
    // (The saved draft record itself, STORAGE_KEYS.draft, is left alone: it is the admin's work.)
    if (adminReady && !allowed) {
      try {
        const safe = createSafeStorage(localSource);
        if (safe.get(STORAGE_KEYS.active) !== null || safe.get(STORAGE_KEYS.draftCss) !== null
          || safe.get(STORAGE_KEYS.draftScene) !== null) {
          safe.remove(STORAGE_KEYS.active);
          safe.remove(STORAGE_KEYS.draftCss);
          safe.remove(STORAGE_KEYS.draftScene);
          syncSiteDraft(safe);
        }
      } catch { /* storage blocked: nothing was applied from here either */ }
    }
  }, [isAdmin, adminReady]);

  // OPEN_EVENT opens the Studio for an allowed viewer (the Admin card). In development it also opts in
  // without the ?theme-studio=1 query (homepage editor bar), writing the same session flag the query does.
  useEffect(() => {
    const dev = process.env.NODE_ENV === 'development';
    if (!dev && !enabled) return undefined;
    const onOpen = () => {
      if (dev) {
        try { window.sessionStorage.setItem(STORAGE_KEYS.devStudio, '1'); } catch { /* ignore */ }
        setEnabled(true);
      }
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [enabled]);

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);

  // Alt+Shift+T. event.code, because Alt changes event.key on macOS.
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (event) => {
      if (event.altKey && event.shiftKey && event.code === 'KeyT') {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, toggle]);

  // First open: load the draft store (engine) and attach its listeners before the Studio mounts.
  useEffect(() => {
    if (!enabled || !open || ready) return undefined;
    let cancelled = false;
    import('../../lib/theme-runtime/draft-store')
      .then((mod) => {
        mod.getDraftStore().start();
        if (!cancelled) setReady(true);
      })
      .catch(() => { /* chunk failed to load: the launcher stays, the Studio simply does not open */ });
    return () => { cancelled = true; };
  }, [enabled, open, ready]);

  if (!enabled) return null;

  // LAUNCHER_ID = the Admin card's button; the Studio returns focus to it on close when it is on the page.
  return open && ready ? <ThemeStudio open onClose={close} launcherId={LAUNCHER_ID} /> : null;
}
