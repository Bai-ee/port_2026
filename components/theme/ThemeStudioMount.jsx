'use client';

// Theme Studio entry point (contract §8.4). Renders nothing until the viewer is an admin (or, in
// development only, opted in with ?theme-studio=1). Then it shows a small fixed launcher
// (#theme-studio-launcher, shortcut Alt+Shift+T). The Studio and the draft store (with the whole
// authoring engine) are loaded on first open: non-admin bundles never fetch that chunk.

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
const OPEN_EVENT = 'theme-studio:open'; // dispatched by #dev-theme-editor-button in HomePage.jsx

// Fixed, theme-independent colours on purpose (same values as the locked Studio chrome tokens,
// contract §11.3): the launcher must stay readable whatever palette is being drafted.
const launcherStyle = {
  position: 'fixed',
  left: 16,
  bottom: 16,
  zIndex: 2147483000,
  minWidth: 44,
  minHeight: 44,
  padding: '0 14px',
  border: '1px solid #c8c8c8',
  borderRadius: 999,
  background: '#ffffff',
  color: '#1a1a1a',
  font: '600 13px/1 "Space Grotesk", system-ui, sans-serif',
  letterSpacing: '0.02em',
  cursor: 'pointer',
  boxShadow: '0 2px 10px rgba(0, 0, 0, 0.18)',
};

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

  // Development only: the homepage editor bar opens the Studio without the ?theme-studio=1 query.
  // Writes the same session flag the query does, so a later gate re-evaluation keeps it enabled.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return undefined;
    const onOpen = () => {
      try { window.sessionStorage.setItem(STORAGE_KEYS.devStudio, '1'); } catch { /* ignore */ }
      setEnabled(true);
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

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

  return (
    <>
      <button
        id={LAUNCHER_ID}
        type="button"
        data-section="theme-studio"
        style={launcherStyle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts="Alt+Shift+T"
        onClick={toggle}
      >
        Theme Studio
      </button>
      {open && ready ? <ThemeStudio open onClose={close} launcherId={LAUNCHER_ID} /> : null}
    </>
  );
}
