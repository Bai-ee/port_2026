'use client';

// Invoice Studio HoloPaper — debounced, generation-tokened texture
// orchestration (handoff §4). Lane R. Wraps invoice-dom-snapshot.js's
// captureInvoiceSnapshot() driver in a React hook a LATER integration phase
// (H2 — not this lane) wires into InvoiceCanvas.jsx. This lane does not
// import or mount InvoiceCanvas/InvoiceStudio/InvoiceRail/CoverCard.
//
// ── API ──────────────────────────────────────────────────────────────────
//
//   const { texture, status, retry } = useInvoiceTexture(iframeEl, {
//     enabled,      // boolean — typically presentation.holoEnabled. false:
//                   // no timers/listeners/captures; any in-flight capture's
//                   // eventual result is discarded (the gate is still
//                   // checked, so a capture that resolves after enabled
//                   // flips false never applies).
//     debounceMs,   // default 250 — see DEFAULT_DEBOUNCE_MS. No more than
//                   // one capture runs per this many ms of refreshKey churn.
//     refreshKey,   // ANY value (string/number/composite) whose CHANGE (by
//                   // !==) schedules a debounced capture. The caller decides
//                   // what belongs in it — the handoff's own refresh-trigger
//                   // list (§4) is: iframe `load` after a structural
//                   // rerender, debounced draft.invoice/draft.lastEdit
//                   // changes, and theme/locale/label/logo/section/doc-kind
//                   // changes. A sensible composite is something like
//                   // `${structureKey}:${draft.lastEdit?.at ?? 0}`.
//     loadTick,     // optional — bump this (e.g. a counter incremented from
//                   // InvoiceCanvas's own onDocumentRendered callback) to
//                   // force a fresh debounced capture after a structural
//                   // iframe reload, independent of refreshKey. Optional
//                   // because a caller that already folds structureKey into
//                   // refreshKey gets the same effect without it — this is
//                   // just a second, independently-named lever so the two
//                   // concerns (edits vs. structural reloads) don't have to
//                   // share one value if the integration finds that
//                   // awkward. Either is sufficient on its own.
//   });
//
//   texture  — { source: HTMLCanvasElement, width, height, revision } | null.
//              null only before the FIRST successful capture. Every
//              subsequent capture — in flight, or failed — leaves the
//              existing `texture` object untouched (H12: "keeps the last
//              good texture visible... never resets texture to null just
//              because a refresh started or failed").
//   status   — 'idle' | 'loading' | 'ready' | 'fallback'. Mirrors
//              useInvoicePresentation.js's SCENE_STATUS vocabulary
//              (duplicated here as plain string literals rather than
//              imported — this lane does not need a dependency edge onto
//              that H0 file; the eventual wiring in InvoiceCanvas.jsx is a
//              straight passthrough of one into the other). 'idle': disabled,
//              or enabled but no capture has run yet. 'loading': a capture
//              is currently in flight (even if a good texture already
//              exists — this is "refreshing", not "blank"). 'ready': the
//              most recent capture succeeded. 'fallback': the most recent
//              capture failed or timed out; `texture` still holds whatever
//              succeeded before it (or null, if none ever has).
//   retry()  — explicit retry after a fallback (or any time) — runs a
//              capture immediately, bypassing the debounce window. No-op
//              while `enabled` is false.
//
// ── Generation tokens / latest-wins ─────────────────────────────────────────
// Every capture calls the shared gate's begin() and only applies its result
// if isCurrent() still holds when it resolves — see
// invoice-dom-snapshot.js's createCaptureGate(). This is what stops a slow
// older capture (e.g. one that hit its fonts/image/svg timeout and took the
// full bounded duration) from clobbering a newer, faster one that started
// after it. `revision` on the returned texture is that capture's gate token,
// so it is monotonically increasing across the hook's lifetime.
//
// ── Debounce ─────────────────────────────────────────────────────────────
// invoice-dom-snapshot.js's createDebouncedScheduler() (trailing-edge) holds
// captures to at most one per `debounceMs` of `refreshKey`/`loadTick` churn.
// `retry()` bypasses the scheduler and calls the capture directly.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  captureInvoiceSnapshot, createCaptureGate, createDebouncedScheduler, DEFAULT_DEBOUNCE_MS,
} from './invoice-dom-snapshot.js';

export const TEXTURE_STATUS = Object.freeze({
  IDLE: 'idle', LOADING: 'loading', READY: 'ready', FALLBACK: 'fallback',
});

export function useInvoiceTexture(iframeEl, options = {}) {
  const {
    enabled = false,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    refreshKey,
    loadTick,
  } = options;

  const [texture, setTexture] = useState(null);
  const [status, setStatus] = useState(TEXTURE_STATUS.IDLE);

  // Refs so the scheduled/async callbacks below always see the LATEST
  // iframe element / enabled flag without needing to be re-created (and
  // therefore re-debounced) on every render.
  const iframeElRef = useRef(iframeEl);
  const enabledRef = useRef(enabled);
  useEffect(() => { iframeElRef.current = iframeEl; }, [iframeEl]);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  const gateRef = useRef(null);
  if (!gateRef.current) gateRef.current = createCaptureGate();

  const runCapture = useCallback(() => {
    const el = iframeElRef.current;
    if (!enabledRef.current || !el) return;
    const token = gateRef.current.begin();
    setStatus(TEXTURE_STATUS.LOADING);
    captureInvoiceSnapshot(el, { maxDimension: options.maxDimension }).then((result) => {
      // Stale (a newer capture has since begun) or disabled mid-flight —
      // discard silently. Never touches `texture`.
      if (!gateRef.current.isCurrent(token) || !enabledRef.current) return;
      if (result.ok) {
        setTexture({
          source: result.source, width: result.width, height: result.height, revision: token,
        });
        setStatus(TEXTURE_STATUS.READY);
      } else {
        // Keep the last good texture exactly as-is (H12) — only status
        // changes, never `texture`.
        setStatus(TEXTURE_STATUS.FALLBACK);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.maxDimension]);

  const schedulerRef = useRef(null);
  if (!schedulerRef.current) {
    schedulerRef.current = createDebouncedScheduler(() => runCapture(), debounceMs);
  }

  // Re-create the scheduler only when debounceMs actually changes (a fresh
  // debounceMs means a fresh window; runCapture itself is read fresh via
  // closure each time schedule() eventually fires, so it never needs to be
  // in this scheduler's own identity).
  useEffect(() => {
    schedulerRef.current?.cancel();
    schedulerRef.current = createDebouncedScheduler(() => runCapture(), debounceMs);
    return () => schedulerRef.current?.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounceMs]);

  // The actual trigger: enabled + a change to refreshKey/loadTick schedules
  // a debounced capture. Disabling cancels any pending (not yet fired)
  // capture and resets to idle; it does NOT clear an existing `texture`.
  useEffect(() => {
    if (!enabled) {
      schedulerRef.current?.cancel();
      setStatus(TEXTURE_STATUS.IDLE);
      return undefined;
    }
    if (!iframeElRef.current) return undefined;
    schedulerRef.current?.schedule();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, refreshKey, loadTick]);

  // Unmount / enabled:false cleanup — cancel any pending debounce timer. An
  // already-in-flight (past the debounce, inside captureInvoiceSnapshot's
  // own awaits) capture cannot be aborted, but its result is discarded by
  // the enabledRef/gate checks in runCapture's `.then` above.
  useEffect(() => () => { schedulerRef.current?.cancel(); }, []);

  const retry = useCallback(() => {
    if (!enabledRef.current) return;
    schedulerRef.current?.cancel();
    runCapture();
  }, [runCapture]);

  return { texture, status, retry };
}

export default useInvoiceTexture;
