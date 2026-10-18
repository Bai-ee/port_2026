'use client';

// Infinite carousel around the POST level's editor: move to the previous / next post of the same day (wraps last <-> first)
// without going Back to the Day list. Presentation + input only: it calls nav.openPost(id, { replace: true }), so the stage's
// own history stays "Day > Post" (Back returns to the Day level) and the stage's leave guard (StagePostLevel's inline
// "Unsaved edits. Leave anyway?" prompt) decides whether the move happens. The parent remounts per post (key), so the editor's
// state never leaks between posts; the slide-in direction is remembered across that remount in a module variable.
//
// Props: postId, postIds (ids of the day's posts in Day-view order), nav ({ openPost }), children (the editor).
// Inputs: touch swipe, trackpad horizontal wheel, ArrowLeft/ArrowRight (not while typing), prev/next buttons.

import React, { useEffect, useRef } from 'react';
import {
  initialWheelState, keyStep, positionLabel, stepTarget, swipeStep, isTypingTarget, wheelStep,
} from './post-carousel-model.js';

let pendingSlide = 0; // +1 entering from the right (next), -1 from the left (prev)

function reducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export default function PostCarousel({ postId, postIds, nav, children }) {
  const ids = Array.isArray(postIds) ? postIds : [];
  const multi = ids.length > 1 && ids.includes(String(postId));
  const trackRef = useRef(null);
  const busyRef = useRef(false);
  const live = useRef({});
  live.current = { ids, postId, nav, multi };

  // Slide in from the direction we came from (skipped for reduced motion).
  const enter = useRef(pendingSlide);
  useEffect(() => { pendingSlide = 0; }, []);
  const slideClass = enter.current && !reducedMotion() ? (enter.current > 0 ? ' pcar-enter-next' : ' pcar-enter-prev') : '';

  const go = async (dir) => {
    const { ids: list, postId: cur, nav: n, multi: ok } = live.current;
    if (!ok || busyRef.current || !n) return;
    const target = stepTarget(list, cur, dir);
    if (!target) return;
    busyRef.current = true;
    pendingSlide = dir;
    try {
      await n.openPost(target, { replace: true });
    } finally {
      // Navigation blocked (user chose Stay) or finished: either way release; on success this component unmounts.
      pendingSlide = 0;
      busyRef.current = false;
    }
  };
  const goRef = useRef(go);
  goRef.current = go;

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return undefined;
    let touch = null;
    let wheel = initialWheelState();

    const onTouchStart = (e) => {
      const t = e.touches && e.touches[0];
      if (!t || e.touches.length > 1 || isTypingTarget(e.target)) { touch = null; return; }
      touch = { x: t.clientX, y: t.clientY };
    };
    const onTouchEnd = (e) => {
      const t = e.changedTouches && e.changedTouches[0];
      if (!touch || !t) return;
      const step = swipeStep(t.clientX - touch.x, t.clientY - touch.y);
      touch = null;
      if (step) goRef.current(step);
    };
    const onTouchCancel = () => { touch = null; };
    const onWheel = (e) => {
      if (!live.current.multi) return;
      const r = wheelStep(wheel, e, e.timeStamp || Date.now());
      wheel = r.state;
      if (r.consumed && e.cancelable) e.preventDefault(); // keep the browser's back-swipe out of it
      if (r.step) goRef.current(r.step);
    };
    const onKey = (e) => {
      if (!live.current.multi) return;
      const step = keyStep(e);
      if (!step) return;
      e.preventDefault();
      goRef.current(step);
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchCancel, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
      el.removeEventListener('wheel', onWheel);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const label = positionLabel(ids, postId);

  return (
    <div id="calendar-stage-post-carousel" data-multi={multi ? 'true' : 'false'}>
      {/* Arrows flank the card (vertically centered); the position sits under it. */}
      <div id="calendar-stage-post-carousel-row">
        {multi ? <button type="button" id="calendar-stage-post-carousel-prev" className="pcar-arrow" aria-label="Previous post" onClick={() => go(-1)}>{'‹'}</button> : <span className="pcar-arrow-spacer" aria-hidden="true" />}
        <div id="calendar-stage-post-carousel-track" ref={trackRef} className={`pcar-track${slideClass}`}>
          {children}
        </div>
        {multi ? <button type="button" id="calendar-stage-post-carousel-next" className="pcar-arrow" aria-label="Next post" onClick={() => go(1)}>{'›'}</button> : <span className="pcar-arrow-spacer" aria-hidden="true" />}
      </div>
      {multi ? <p id="calendar-stage-post-carousel-position" role="status" aria-live="polite" aria-label={`Post ${label}`}>{label}</p> : null}
      <style jsx global>{`
        #calendar-stage-post-carousel #calendar-stage-post-carousel-row {
          display: grid;
          grid-template-columns: 40px minmax(0, 1fr) 40px;
          align-items: center;
          gap: 16px;
        }
        #calendar-stage-post-carousel .pcar-arrow-spacer { width: 40px; }
        #calendar-stage-post-carousel #calendar-stage-post-carousel-position {
          margin: 12px 0 0;
          text-align: center;
          font-size: 13px;
          font-variant-numeric: tabular-nums;
          color: var(--t-dash-text-secondary);
        }
        #calendar-stage-post-carousel .pcar-arrow {
          width: 40px;
          height: 40px;
          border-radius: 999px;
          border: 1px solid var(--t-dash-border-visible);
          background: var(--t-dash-surface);
          color: var(--t-dash-text-primary);
          font-size: 18px;
          line-height: 1;
          cursor: pointer;
        }
        #calendar-stage-post-carousel .pcar-arrow:hover { background: var(--t-dash-surface-raised); }
        #calendar-stage-post-carousel .pcar-arrow:focus-visible { outline: 2px solid var(--t-focus); outline-offset: 2px; }
        #calendar-stage-post-carousel .pcar-track {
          touch-action: pan-y;
          overscroll-behavior-x: contain;
        }
        #calendar-stage-post-carousel .pcar-enter-next { animation: pcar-in-next 220ms ease-out both; }
        #calendar-stage-post-carousel .pcar-enter-prev { animation: pcar-in-prev 220ms ease-out both; }
        @keyframes pcar-in-next { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes pcar-in-prev { from { opacity: 0; transform: translateX(-28px); } to { opacity: 1; transform: translateX(0); } }
        @media (prefers-reduced-motion: reduce) {
          #calendar-stage-post-carousel .pcar-enter-next,
          #calendar-stage-post-carousel .pcar-enter-prev { animation: none; }
        }
        @media (max-width: 480px) {
          #calendar-stage-post-carousel .pcar-arrow, #calendar-stage-post-carousel .pcar-arrow-spacer { display: none; }
          #calendar-stage-post-carousel #calendar-stage-post-carousel-row { grid-template-columns: minmax(0, 1fr); gap: 0; }
        }
      `}</style>
    </div>
  );
}
