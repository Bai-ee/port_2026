'use client';

import React, {
  useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore,
} from 'react';
import { STUDIO_CSS } from './studio-chrome-css.js';
import { StudioProvider, useAnnouncer, useStoreSelector } from './StudioContext.jsx';
import StudioHeader from './StudioHeader.jsx';
import LiveRegion from './controls/LiveRegion.jsx';
import Banner from './controls/Banner.jsx';
import PresetModeSection from './sections/PresetModeSection.jsx';
import PaletteCombosSection from './sections/PaletteCombosSection.jsx';
import LibrarySection from './sections/LibrarySection.jsx';
import MasterSection from './sections/MasterSection.jsx';
import PaletteSection from './sections/PaletteSection.jsx';
import SceneSection from './sections/SceneSection.jsx';
import AdvancedSection from './sections/AdvancedSection.jsx';
import AccessibilitySection from './sections/AccessibilitySection.jsx';
import CompareSection from './sections/CompareSection.jsx';
import ExportSection from './sections/ExportSection.jsx';
import { createStudioStore } from '../../lib/theme-studio/store-adapter.js';
import { createEditSession } from '../../lib/theme-studio/edit-session.js';
import { initialUiState, uiReducer, topPopover } from '../../lib/theme-studio/ui-state.js';
import { matchShortcut, trapNextIndex } from '../../lib/theme-studio/keymap.js';
import { saveMessage } from '../../lib/theme-studio/format.js';

const MOBILE_QUERY = '(max-width: 640px)';
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

function subscribeMobile(fn) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener('change', fn);
  return () => mq.removeEventListener('change', fn);
}
const getMobile = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(MOBILE_QUERY).matches : false);
const getMobileServer = () => false;

const selDraftPresent = (s) => !!s.draft;
const selStorage = (s) => s.storageAvailable;
const selExternal = (s) => s.externalChange;
const selCompare = (s) => s.compare;

/**
 * The Studio itself, given a draft store. Desktop (over 640px): a non-modal right
 * drawer so the page stays interactive for live preview. Mobile: a modal bottom
 * sheet with a focus trap and scroll lock.
 */
export default function ThemeStudioShell({ store: rawStore, onClose, returnFocusId = 'theme-studio-launcher' }) {
  const store = useMemo(() => createStudioStore(rawStore), [rawStore]);
  const session = useMemo(() => createEditSession(store), [store]);
  const [ui, dispatch] = useReducer(uiReducer, undefined, initialUiState);
  const [liveMsg, announce] = useAnnouncer();
  const [saveNote, setSaveNote] = useState('');
  const mobile = useSyncExternalStore(subscribeMobile, getMobile, getMobileServer);
  const panelRef = useRef(null);
  const uiRef = useRef(ui);
  uiRef.current = ui;

  const hasDraft = useStoreSelector(store, selDraftPresent);
  const storageOk = useStoreSelector(store, selStorage);
  const external = useStoreSelector(store, selExternal);
  const compare = useStoreSelector(store, selCompare);

  // Make sure there is a draft to edit.
  useEffect(() => {
    if (!store.getSnapshot().draft) store.startDraft();
  }, [store]);

  // Focus the heading on open; give focus back on close.
  useEffect(() => {
    const previous = typeof document !== 'undefined' ? document.activeElement : null;
    const heading = document.getElementById('theme-studio-heading');
    if (heading) heading.focus({ preventScroll: true });
    return () => {
      session.end();
      if (store.getSnapshot().compare === 'production') store.setCompare('draft');
      const target = document.getElementById(returnFocusId) || previous;
      if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
    };
  }, [session, store, returnFocusId]);

  // The mobile sheet is modal: lock page scroll, and restore exactly what was there.
  useEffect(() => {
    if (!mobile) return undefined;
    const body = document.body;
    const prev = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => { body.style.overflow = prev; };
  }, [mobile]);

  const closeStudio = useCallback(() => {
    session.end();
    if (onClose) onClose();
  }, [session, onClose]);

  const edit = useCallback((updater, opts = {}) => {
    // Editing while comparing returns to the draft, so the page shows what you are changing.
    if (store.getSnapshot().compare === 'production') store.setCompare('draft');
    session.apply(updater, opts);
  }, [session, store]);
  const endEdit = useCallback(() => { session.end(); }, [session]);

  const copyText = useCallback(async (text, label) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (!ok) throw new Error('copy failed');
      }
      announce(`Copied ${label || 'text'}.`);
    } catch (err) {
      announce(`Could not copy ${label || 'text'}. Select it and copy by hand.`);
    }
  }, [announce]);

  const downloadFile = useCallback((filename, mime, content) => {
    try {
      const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      announce(`Downloaded ${filename}.`);
    } catch (err) {
      announce(`Could not download ${filename}.`);
    }
  }, [announce]);

  const saveDraft = useCallback(() => {
    session.end();
    const finish = (result) => {
      const msg = saveMessage(result);
      setSaveNote(msg);
      announce(msg);
    };
    if (!store.has('saveDraft')) { finish({ ok: false, error: 'saving is not available' }); return; }
    Promise.resolve(store.saveDraft()).then(finish, (e) => finish({ ok: false, error: e && e.message }));
  }, [session, store, announce]);

  const ctx = useMemo(() => ({
    store, session, ui, dispatch, announce, edit, endEdit, copyText, downloadFile, saveDraft, saveNote, closeStudio, mobile,
  }), [store, session, ui, announce, edit, endEdit, copyText, downloadFile, saveDraft, saveNote, closeStudio, mobile]);

  // The desktop drawer is non-modal, so the viewer may be clicking the live page to
  // preview a change. Esc must still close it (contract 11.2) when focus is outside.
  // Keys inside the drawer are handled by the drawer's own onKeyDown.
  const escapeRef = useRef(null);
  escapeRef.current = () => {
    if (topPopover(uiRef.current)) dispatch({ type: 'popover/closeTop' });
    else closeStudio();
  };
  useEffect(() => {
    if (mobile) return undefined;
    const onWindowKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const panel = panelRef.current;
      if (panel && e.target instanceof Node && panel.contains(e.target)) return;
      if (e.target instanceof Element && e.target.closest('[role="dialog"][aria-modal="true"]')) return;
      escapeRef.current();
    };
    window.addEventListener('keydown', onWindowKey);
    return () => window.removeEventListener('keydown', onWindowKey);
  }, [mobile]);

  const onKeyDown = (e) => {
    const cmd = matchShortcut({
      key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey, target: e.target,
    });
    if (cmd === 'undo') { e.preventDefault(); session.end(); store.undo(); return; }
    if (cmd === 'redo') { e.preventDefault(); session.end(); store.redo(); return; }
    if (cmd === 'escape') {
      e.stopPropagation();
      if (topPopover(ui)) dispatch({ type: 'popover/closeTop' });
      else closeStudio();
      return;
    }
    if (e.key === 'Tab' && mobile && panelRef.current) {
      const list = Array.from(panelRef.current.querySelectorAll(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
      if (!list.length) return;
      const idx = list.indexOf(document.activeElement);
      const atEdge = idx < 0 || (e.shiftKey ? idx === 0 : idx === list.length - 1);
      if (atEdge) {
        e.preventDefault();
        list[trapNextIndex({ count: list.length, index: idx, shift: e.shiftKey })].focus();
      }
    }
  };

  return (
    <StudioProvider value={ctx}>
      <div id="theme-studio-root" data-layout={mobile ? 'sheet' : 'drawer'}>
        <style id="theme-studio-chrome-css" dangerouslySetInnerHTML={{ __html: STUDIO_CSS }} />
        {mobile ? <div className="ts-backdrop" id="theme-studio-backdrop" aria-hidden="true" onClick={closeStudio} /> : null}
        <aside
          ref={panelRef}
          id="theme-studio-drawer"
          className={`ts-panel${mobile ? ' ts-sheet' : ''}`}
          role="dialog"
          aria-modal={mobile ? 'true' : 'false'}
          aria-labelledby="theme-studio-heading"
          onKeyDown={onKeyDown}
        >
          {mobile ? <div className="ts-grab" aria-hidden="true" /> : null}
          <StudioHeader />
          <div className="ts-body" id="theme-studio-scroll">
            {!storageOk ? (
              <Banner tone="warn" id="theme-studio-storage-warning" role="alert">
                <p><strong>Browser storage is unavailable.</strong> Your draft cannot be saved and is lost when this tab closes. Export the JSON to keep your work.</p>
              </Banner>
            ) : null}
            {external ? (
              <Banner
                tone="warn"
                id="theme-studio-external-change"
                role="alert"
                actions={(
                  <>
                    <button type="button" className="ts-btn ts-btn--sm" onClick={() => { store.acceptExternal(); announce('Loaded the other tab\'s draft. Undo brings yours back.'); }}>Load other draft</button>
                    <button type="button" className="ts-btn ts-btn--sm" onClick={() => { store.keepMine(); announce('Keeping your draft.'); }}>Keep mine</button>
                  </>
                )}
              >
                <p><strong>Another tab saved a different draft.</strong> Yours was not overwritten.</p>
              </Banner>
            ) : null}
            {compare === 'production' ? (
              <Banner
                tone="info"
                id="theme-studio-compare-banner"
                actions={<button type="button" className="ts-btn ts-btn--sm" onClick={() => store.setCompare('draft')}>Back to my draft</button>}
              >
                <p><strong>Comparing.</strong> This page shows the published theme, not your draft.</p>
              </Banner>
            ) : null}
            {hasDraft ? (
              <>
                <PresetModeSection />
                <MasterSection />
                <PaletteCombosSection />
                <LibrarySection />
                <PaletteSection />
                <SceneSection />
                <AdvancedSection />
                <AccessibilitySection />
                <CompareSection />
                <ExportSection />
              </>
            ) : (
              <p className="ts-p" style={{ padding: 16 }} role="status">Starting a draft…</p>
            )}
          </div>
          <LiveRegion message={liveMsg} />
        </aside>
      </div>
    </StudioProvider>
  );
}
