'use client';

// Invoice Studio rail — drag-to-reorder for section cards (owns
// draft.sections.order via `reorderSection`, see useInvoiceDraft.js).
// Vanilla Pointer Events, no new dependency.
//
// Gesture: press and HOLD a card's dedicated grab bar (SectionCard.jsx's
// `.studio-rail-card-grab`, mouse click-and-hold or touch tap-and-hold) — a
// quick tap/release on it still opens or closes the card, same as clicking
// anywhere else on the card. After a short hold with the pointer roughly
// stationary, the card "picks up" (lifts, scales up slightly) and further
// pointer movement drags it, tilting continuously toward the drag
// direction (proportional to how far you've pulled, not a hard on/off
// snap); its neighbors slide out of the way to open a slot. Releasing
// commits the new order. Moving the pointer BEFORE the hold delay fires
// cancels the hold without engaging drag at all — on touch that's read as
// the start of a normal scroll, not a reorder.
//
// Rows are tracked by ref and their `transform` is mutated directly on
// every pointermove — NOT through React state, which would re-render up to
// 14 cards per pixel of movement. Only the FINAL committed order ever goes
// through React (one `reorderSection` call on drop). Neighbor shifts are
// computed FLIP-style off a snapshot of each row's own real `offsetHeight`
// taken at drag start, never a uniform row-height assumption — an OPEN
// card (this rail is accordion — see InvoiceRail.jsx) is much taller than
// a collapsed one, and the math has to hold either way.
//
// ── Motion / easing ──────────────────────────────────────────────────────
// Every row carries a CSS `transition: transform ...` by default
// (InvoiceRail.jsx's `.invoice-rail-drag-row` rule) — that one rule is what
// makes a NEIGHBOR's shift (this file writes a bare `translateY(px)`, no
// easing logic of its own) glide smoothly into its open slot instead of
// snapping there, and what makes the "pick up" lift at the START of a drag
// (below, in beginDrag) ease in rather than pop. The dragged row itself
// switches OFF that transition (`transition:'none'`) the instant real
// pointer movement begins (see updateDrag) so it tracks the cursor with
// zero added lag for the rest of the gesture — only the initial pick-up
// and the neighbors' shifts ever animate; the thing actually following
// your finger never should (a laggy live-drag reads as sluggish, not
// elegant). The final commit (endDrag) suspends transitions on EVERY row
// for one tick: the FLIP math already lands each row's transform at
// exactly the screen position its new real flex-order slot gives it, so
// clearing transform in the same instant the real order changes is
// naturally seamless — letting a transition run there would instead
// animate FROM the old transform value while the row already sits in its
// NEW slot, producing a visible little jump that has nothing to do with
// the actual reorder.

import { useCallback, useRef, useState } from 'react';

const HOLD_MS = 300;
const JITTER_PX = 6;
const GAP = 10; // matches #invoice-studio-rail-inner's own `gap: 10`
const TILT_DEG = 2;
const TILT_PX_FOR_MAX_DEG = 26; // deltaY (px) at which tilt reaches TILT_DEG
const LIFT_PX = 4;
const SUPPRESS_CLICK_WINDOW_MS = 200;

export function useRailDragReorder(order, reorderSection) {
  const rowRefs = useRef(new Map());
  const [draggingId, setDraggingId] = useState(null);
  const dragRef = useRef(null);
  // A TIMESTAMP, not a plain "consume on next click" flag — a browser only
  // fires `click` after pointerup when the platform's own input pipeline
  // produced the pointer events; nothing guarantees one follows here (a
  // stylus/some touch paths can skip it, and it never happens at all for a
  // non-UI-driven pointerup). A boolean cleared only by that click would
  // stay stuck true forever whenever no click shows up, silently eating the
  // NEXT unrelated click anywhere in the rail. A short time window
  // self-heals with no such dependency. Shared across rows on purpose: only
  // one row can ever be mid-drag at a time.
  const dragEndedAtRef = useRef(0);

  const setRowRef = useCallback((id) => (el) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  const applyShift = useCallback((id, px) => {
    const el = rowRefs.current.get(id);
    if (el) el.style.transform = px ? `translateY(${px}px)` : '';
  }, []);

  const beginDrag = useCallback((id, startClientY) => {
    const startEl = rowRefs.current.get(id);
    if (!startEl) return;
    const startIndex = order.indexOf(id);
    if (startIndex === -1) return;
    // Snapshot every row's OWN height — never a fixed row size, since the
    // accordion means exactly one card can be much taller than the rest.
    const heights = new Map();
    order.forEach((rowId) => {
      const el = rowRefs.current.get(rowId);
      heights.set(rowId, el ? el.offsetHeight : 0);
    });
    dragRef.current = {
      id, startY: startClientY, startIndex, order: [...order], heights, targetIndex: startIndex,
      trackingStarted: false,
    };
    setDraggingId(id);
    startEl.style.zIndex = '50';
    startEl.style.touchAction = 'none';
    startEl.style.willChange = 'transform';
    // Deliberately NOT `transition:'none'` here — this is the "pick up"
    // moment, not live tracking yet (the pointer hasn't moved beyond
    // JITTER_PX), so the row's default CSS transition
    // (.invoice-rail-drag-row, InvoiceRail.jsx) is left ENABLED and eases
    // this lift in smoothly. updateDrag below switches it off the instant
    // real dragging starts.
    startEl.style.transform = `translateY(${-LIFT_PX}px) scale(1.02)`;
    // Forced on <body>, not just the grab bar's own `:hover` CSS (InvoiceRail
    // .jsx's stylesheet) — the pointer leaves that 6px-wide bar within a
    // pixel or two of any real drag, and a per-element `cursor` only paints
    // while the OS says the pointer is actually over that element. Without
    // this, the "closed hand" reverted to whatever was under the pointer
    // (a text cursor over the title, a normal arrow over the canvas) the
    // instant the card started moving.
    if (typeof document !== 'undefined' && document.body) {
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'grabbing';
    }
  }, [order]);

  const updateDrag = useCallback((clientY) => {
    const drag = dragRef.current;
    if (!drag) return;
    const deltaY = clientY - drag.startY;
    const draggedHeight = drag.heights.get(drag.id) || 0;
    const el = rowRefs.current.get(drag.id);
    if (el) {
      if (!drag.trackingStarted) {
        // First real movement: turn OFF easing so the row follows the
        // pointer with zero added lag for the rest of the gesture — see
        // this file's own "Motion / easing" header note for why the
        // pick-up above and this live phase deliberately use opposite
        // transition states.
        drag.trackingStarted = true;
        el.style.transition = 'none';
      }
      // Continuous, not a 3-state snap: tilt scales smoothly with how far
      // you've pulled (clamped to ±TILT_DEG), so it eases through zero as
      // the drag direction reverses instead of popping between two fixed
      // angles.
      const tilt = Math.max(-TILT_DEG, Math.min(TILT_DEG, (deltaY / TILT_PX_FOR_MAX_DEG) * TILT_DEG));
      el.style.transform = `translateY(${deltaY - LIFT_PX}px) scale(1.02) rotate(${tilt.toFixed(2)}deg)`;
    }

    // FLIP-style hit test: nothing but `transform` ever moves a neighbor's
    // real box during a drag, so the ORIGINAL snapshot layout stays a valid
    // coordinate space for the whole gesture. Split into "others" (every
    // row but the dragged one) while tracking the dragged row's own live
    // center in that same space, offset by how far the pointer has moved.
    let cursor = 0;
    let draggedCenter = 0;
    const others = [];
    drag.order.forEach((rowId) => {
      const h = drag.heights.get(rowId) || 0;
      const center = cursor + h / 2;
      if (rowId === drag.id) draggedCenter = center + deltaY;
      else others.push({ id: rowId, center });
      cursor += h + GAP;
    });
    let insertIndex = others.length;
    for (let i = 0; i < others.length; i++) {
      if (draggedCenter < others[i].center) { insertIndex = i; break; }
    }
    // Removing an item at slot k leaves exactly k items before it — so the
    // dragged row's own "hasn't moved" position, reinterpreted as an
    // others-only index, is just its original full-array index. No
    // conversion needed for the comparison below.
    const startInsertIndex = drag.startIndex;
    drag.targetIndex = insertIndex;

    others.forEach(({ id: rowId }, oi) => {
      let shift = 0;
      if (startInsertIndex < insertIndex && oi >= startInsertIndex && oi < insertIndex) shift = -(draggedHeight + GAP);
      else if (startInsertIndex > insertIndex && oi >= insertIndex && oi < startInsertIndex) shift = draggedHeight + GAP;
      applyShift(rowId, shift);
    });
  }, [applyShift]);

  const endDrag = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDraggingId(null);
    if (typeof document !== 'undefined' && document.body) {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }
    if (!drag) return;
    // A hold that lifted the card but never actually moved it (released
    // before any real drag) never touched a neighbor's transform either —
    // nothing to keep in sync, so just let the lift ease back down/away
    // normally. Only suspend transitions (see below) once real tracking —
    // and therefore neighbor shifts — actually happened.
    const touched = [];
    if (drag.trackingStarted) {
      // Suspend EVERY row's transition for this one commit — see the file's
      // "Motion / easing" header note: the FLIP math already lands each
      // row's transform at exactly the screen position its new real
      // flex-order slot will give it, so clearing transform in the same
      // instant `order` changes is naturally seamless. Leaving the
      // transition enabled here would instead animate FROM the stale
      // transform value while the row already sits in its new slot — a
      // spurious little jump. Re-enabled on the next frame so the NEXT drag
      // (or any other transform change) still eases normally.
      drag.order.forEach((rowId) => {
        const el = rowRefs.current.get(rowId);
        if (el) { el.style.transition = 'none'; touched.push(el); }
      });
    }
    const draggedEl = rowRefs.current.get(drag.id);
    if (draggedEl) {
      draggedEl.style.zIndex = '';
      draggedEl.style.touchAction = '';
      draggedEl.style.willChange = '';
      draggedEl.style.transform = '';
    }
    // Reordering `sections.order` (below) puts every row back in real flex
    // order at exactly the slot this transform math already visually
    // placed it — clearing every neighbor's transform in the same tick
    // that order changes lands them with no jump, no separate settle step.
    drag.order.forEach((rowId) => { if (rowId !== drag.id) applyShift(rowId, 0); });
    if (drag.targetIndex !== drag.startIndex) reorderSection(drag.id, drag.targetIndex);
    if (touched.length) {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => { touched.forEach((el) => { el.style.transition = ''; }); });
      } else {
        touched.forEach((el) => { el.style.transition = ''; });
      }
    }
  }, [applyShift, reorderSection]);

  // Attach to each row's wrapper via onPointerDown. Only presses landing on
  // the dedicated grab bar (SectionCard.jsx's `.studio-rail-card-grab`, the
  // card's `leading` slot) engage the hold — the title/subtitle/chevron
  // button and the eye toggle (`trailing`) are siblings of it, so neither
  // is ever hijacked into a drag; they keep their own plain click behavior
  // untouched. A quick click ON the bar itself still opens/closes the card
  // (SectionCard wires its own `onClick={onToggle}`) — only a real
  // press-and-hold-then-move is a drag (see updateDrag/JITTER_PX below).
  const handlePointerDown = useCallback((id) => (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (!e.target || typeof e.target.closest !== 'function' || !e.target.closest('.studio-rail-card-grab')) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const pointerId = e.pointerId;
    let holdFired = false;
    let cancelled = false;
    // How far the pointer actually traveled once the hold engaged — a click
    // whose mousedown/mouseup simply straddles HOLD_MS with the pointer
    // never really moving (an ordinary slow click, or how some input
    // automation dispatches a "click") still fires this timer, but it isn't
    // a real drag and shouldn't eat the click below (see onUp).
    let maxMovedAbs = 0;

    function cleanup() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    }
    const onMove = (ev) => {
      if (!holdFired) {
        if (Math.abs(ev.clientX - startX) > JITTER_PX || Math.abs(ev.clientY - startY) > JITTER_PX) {
          cancelled = true;
          clearTimeout(holdTimer);
          cleanup();
        }
        return;
      }
      maxMovedAbs = Math.max(maxMovedAbs, Math.abs(ev.clientY - startY));
      updateDrag(ev.clientY);
    };
    const onUp = () => {
      clearTimeout(holdTimer);
      if (holdFired) {
        endDrag();
        // Only a real drag (actual movement) should swallow the trailing
        // click — a press-and-hold that's released without ever moving
        // reads as a plain click and should still open/close the card.
        if (maxMovedAbs > JITTER_PX) dragEndedAtRef.current = Date.now();
      }
      cleanup();
    };
    const holdTimer = setTimeout(() => {
      if (cancelled) return;
      holdFired = true;
      beginDrag(id, startY);
      const startEl = rowRefs.current.get(id);
      try { startEl?.setPointerCapture(pointerId); } catch { /* unsupported/already released — pointermove is on window regardless */ }
    }, HOLD_MS);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [beginDrag, updateDrag, endDrag]);

  // Capture-phase click guard: a browser `click` still fires on pointerup
  // at whatever element received the pointerdown, regardless of how far a
  // `transform` visually moved it (the DOM never actually reflowed
  // underneath the pointer) — without this, finishing a drag would also
  // fire the card's own open/close toggle. Windowed rather than "consume
  // one click" — see dragEndedAtRef's own comment above.
  const handleClickCapture = useCallback((e) => {
    if (Date.now() - dragEndedAtRef.current < SUPPRESS_CLICK_WINDOW_MS) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  return { setRowRef, handlePointerDown, handleClickCapture, draggingId };
}
