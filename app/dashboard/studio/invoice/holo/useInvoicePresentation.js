'use client';

// Invoice Studio — HoloPaper presentation state (docs/plans/
// INVOICE-STUDIO-HOLOPAPER-HANDOFF.md §3). Editor-only presentation state:
// it never touches the invoice draft, normalized invoice data, or the
// publish payload (H2/H14 — see the controlling handoff). H0 establishes
// this hook and threads it through InvoiceStudio -> InvoiceRail -> CoverCard
// with the feature fully off; the Holo scene/overlay itself, and CoverCard's
// actual controls, are wired in a later phase against this same contract.
//
// Two pieces of state, deliberately NOT symmetric:
//   - holoEnabled — persisted locally (its own guarded key, separate from
//     the invoice draft's own `invoice-studio-draft-v2` — H3/L "do not bump
//     or reshape draft storage" rule). An operator who turns Holo on expects
//     it to stay on across a reload.
//   - sceneInteractive — ephemeral. ALWAYS false on every mount (H7),
//     mirroring the Mockup Video tool's `deviceInteract` pattern: handing
//     pointer ownership to a WebGL scene is a decision made fresh each
//     session, never restored silently.
// `sceneStatus` is derived UI state for the (not-yet-mounted) scene/overlay
// to report through: 'idle' (Holo off, or on but not yet loaded), 'loading'
// (dynamic import / first texture in flight), 'ready', or 'fallback' (WebGL
// unavailable, context lost, or snapshot failed — H16).
//
// `resetViewToken` — ephemeral, starts at 0, incremented by
// `bumpResetView()`. CoverCard's "Reset View" button and the Holo scene
// mounted inside InvoiceCanvas are SIBLINGS (neither is the other's
// parent/child), so a plain callback prop can't bridge them; both read the
// same `presentation` object from the ONE hook instance InvoiceStudio owns,
// so a token bump here is visible to whichever component renders
// InvoiceHoloSurface's `resetViewToken` prop without either side needing a
// ref into the other.
//
// Every storage read/write is try/catch'd and never throws (same contract
// as useInvoiceDraft.js's own storage helpers) — see __tests__/
// useInvoicePresentation.test.js for the DOM-free storage round-trip.

import { useCallback, useState } from 'react';

export const PRESENTATION_STORAGE_KEY = 'invoice-studio-presentation-v1';
export const PRESENTATION_STORAGE_VERSION = 1;

export const SCENE_STATUS = Object.freeze({
  IDLE: 'idle', LOADING: 'loading', READY: 'ready', FALLBACK: 'fallback',
});

// ── localStorage (best-effort; never throws) — pure, directly testable ────
export function readStoredPresentation() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(PRESENTATION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.v !== PRESENTATION_STORAGE_VERSION) return null;
    return { holoEnabled: parsed.holoEnabled === true };
  } catch {
    // Private window / blocked site data / corrupt JSON — default to off.
    return null;
  }
}

export function writeStoredPresentation(holoEnabled) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(
      PRESENTATION_STORAGE_KEY,
      JSON.stringify({ v: PRESENTATION_STORAGE_VERSION, holoEnabled: holoEnabled === true }),
    );
  } catch {
    // Quota exceeded / blocked storage — the preference just won't persist.
  }
}

export function useInvoicePresentation() {
  const [holoEnabled, setHoloEnabledState] = useState(() => {
    const stored = readStoredPresentation();
    return stored ? stored.holoEnabled : false;
  });
  // Ephemeral (H7) — a fresh useState(false) is itself the "always Off on
  // mount" guarantee; nothing reads storage for this field.
  const [sceneInteractive, setSceneInteractiveState] = useState(false);
  const [sceneStatus, setSceneStatusState] = useState(SCENE_STATUS.IDLE);
  const [resetViewToken, setResetViewToken] = useState(0);

  const setHoloEnabled = useCallback((next) => {
    const value = next === true;
    setHoloEnabledState(value);
    writeStoredPresentation(value);
    if (!value) {
      // Turning Holo off synchronously drops interaction too (§3) — an
      // operator never lands back on Holo On with interaction silently on.
      setSceneInteractiveState(false);
      setSceneStatusState(SCENE_STATUS.IDLE);
    }
  }, []);

  const setSceneInteractive = useCallback((next) => {
    setSceneInteractiveState((prev) => {
      if (!holoEnabled) return false; // no-op while Holo is off — nothing to interact with
      return next === true;
    });
  }, [holoEnabled]);

  const setSceneStatus = useCallback((status) => {
    if (!Object.values(SCENE_STATUS).includes(status)) return;
    setSceneStatusState(status);
  }, []);

  const bumpResetView = useCallback(() => {
    setResetViewToken((prev) => prev + 1);
  }, []);

  return {
    presentation: {
      holoEnabled, sceneInteractive, sceneStatus, resetViewToken,
    },
    setHoloEnabled,
    setSceneInteractive,
    setSceneStatus,
    bumpResetView,
  };
}

export default useInvoicePresentation;
