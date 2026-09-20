'use client';

// Rail reveal — the stagger the Loop Studio rail has always used on first
// mount, extracted so every Studio tool's rail cards enter the same way:
// a 10px rise + fade, 0.26s power2.out, 0.04s apart.
//
// Usage: `const railInnerRef = useRailReveal();` then put that ref on the
// rail's inner column. It animates that column's DIRECT `.studio-rail-card`
// children, so bucket dividers and any nested cards are left alone.
//
// Runs exactly once per mount and never re-runs, so toggling a card open or
// swapping tools mid-session doesn't re-trigger it. Snaps straight to the end
// state (no animation) under prefers-reduced-motion, and when the tab is
// hidden at mount — see the comment on that guard below.

import { useEffect, useRef } from 'react';
import gsap from 'gsap';

export const RAIL_REVEAL = { y: 10, duration: 0.26, ease: 'power2.out', stagger: 0.04 };

export function useRailReveal() {
  const railInnerRef = useRef(null);
  const revealedRef = useRef(false);

  useEffect(() => {
    if (revealedRef.current) return;
    const root = railInnerRef.current;
    if (!root) return;
    const cards = root.querySelectorAll(':scope > .studio-rail-card');
    if (!cards.length) return;
    revealedRef.current = true;

    const reduced = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // A hidden tab freezes rAF, so GSAP's ticker never advances and the cards
    // would sit at the tween's from-state (invisible) until the tab is shown.
    // Nobody is watching an entrance they can't see: snap straight to the end.
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (reduced || hidden) { gsap.set(cards, { opacity: 1, y: 0 }); return; }

    gsap.fromTo(
      cards,
      { opacity: 0, y: RAIL_REVEAL.y },
      {
        opacity: 1, y: 0,
        duration: RAIL_REVEAL.duration,
        ease: RAIL_REVEAL.ease,
        stagger: RAIL_REVEAL.stagger,
      },
    );
  }, []);

  return railInnerRef;
}
