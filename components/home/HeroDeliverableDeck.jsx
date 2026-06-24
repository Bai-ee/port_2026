'use client';

import React, { useEffect, useState } from 'react';
import DeliverableHoverCard, { DELIVERABLE_CARD_IDS } from './DeliverableHoverCards';

/*
 * Self-cycling "card deck" version of the deliverable hover cards, shown in the
 * hero to the right of the headline panel. Reuses the exact same
 * DeliverableHoverCard chrome as the table-row hover previews — every card is
 * stacked on top of the others and one is dealt to the front at a time on a
 * timer (front slides/fades out, the next slides up into place).
 *
 * Layout: left edge anchored to the right border of the hero headline panel
 * (HeroHeadline's `edge` + panel max width), so the stack butts up against the
 * left container. Card width then fills the remaining space to the viewport
 * edge. Decorative only: aria-hidden + pointer-events:none. Respects
 * reduced-motion.
 */

const CYCLE_MS = 3000;
// Delay before the deck fades in, so it appears after the hero headline.
const REVEAL_DELAY_MS = 1200;

// The front card is full size; the rest recede up-and-right like a string,
// each smaller / further / fainter, with alternating tilt for a funky zigzag.
// As the deck cycles each card travels between slots, so the front "scales
// down and away" into the trail while the next grows forward.
function slotStyle(pos) {
  if (pos === 0) return { x: 0, y: 0, rot: 0, scale: 1.0, op: 1, z: 60 };
  if (pos === 1) return { x: 78, y: -34, rot: -5, scale: 0.70, op: 0.92, z: 50 };
  if (pos === 2) return { x: 140, y: -64, rot: 7, scale: 0.50, op: 0.7, z: 40 };
  if (pos === 3) return { x: 188, y: -92, rot: -9, scale: 0.36, op: 0.5, z: 30 };
  if (pos === 4) return { x: 226, y: -120, rot: 11, scale: 0.26, op: 0.32, z: 20 };
  return { x: 268, y: -150, rot: -14, scale: 0.16, op: 0, z: 10 };
}

export default function HeroDeliverableDeck() {
  const ids = DELIVERABLE_CARD_IDS;
  const N = ids.length;
  const [active, setActive] = useState(0);
  const [revealed, setRevealed] = useState(false);

  // Reveal the deck shortly after mount so it fades in behind the headline
  // (reduced motion: show immediately, no cycling).
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setRevealed(true);
      return undefined;
    }
    const reveal = setTimeout(() => setRevealed(true), REVEAL_DELAY_MS);
    return () => clearTimeout(reveal);
  }, []);

  // Cycle only once revealed.
  useEffect(() => {
    if (!revealed) return undefined;
    if (typeof window === 'undefined') return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const t = setInterval(() => setActive((i) => (i + 1) % N), CYCLE_MS);
    return () => clearInterval(t);
  }, [N, revealed]);

  // Left edge sits at the hero headline panel's right border:
  //   edge      = HeroHeadline's left side-gutter, max(10vw, (100vw-810)/2)
  //   panelW    = panel rendered/max width, min(100vw - 2*edge, 672px)
  //   deckLeft  = edge + panelW
  // Card width fills from deckLeft to the viewport edge, capped at 432px
  // (~20% larger than the previous 360px), floored at 200px (shrink-in-place
  // on narrow screens). The card's own 0.8 internal scale keeps the visual
  // right edge clear of the viewport even at the 432px cap.
  const heroVars = {
    '--hero-edge': 'max(10vw, calc((100vw - 810px) / 2))',
    '--hero-panelw': 'min(calc(100vw - 2 * var(--hero-edge)), 672px)',
    // Ideal left = panel right border. But never let the deck push off-screen:
    // cap deckLeft so a min-width card still fits, shifting it left (overlapping
    // the headline) on narrow screens instead of overflowing the viewport.
    '--deck-min-w': '240px',
    // Pull left of the panel border so the stack overlaps the headline's right
    // edge and has room to fan out.
    '--deck-overlap': 'clamp(70px, 9vw, 180px)',
    '--deck-ideal-left':
      'calc(var(--hero-edge) + var(--hero-panelw) - var(--deck-overlap))',
    '--deck-left':
      'min(var(--deck-ideal-left), calc(100vw - var(--deck-min-w) - 24px))',
  };
  const cardWidth = 'clamp(240px, calc(100vw - var(--deck-left) - 24px), 432px)';

  return (
    <div
      id="hero-deliverable-deck"
      aria-hidden="true"
      style={{
        // Fixed to the viewport, left edge butted against the headline panel's
        // right border, vertically centered near the headline (~50vh). zIndex
        // below the headline panel (100) and #content-section (110), so section
        // 2 covers it as you scroll.
        ...heroVars,
        position: 'fixed',
        top: '50vh',
        left: 'var(--deck-left)',
        width: cardWidth,
        height: 'clamp(360px, 36vw, 560px)',
        transform: 'translateY(-50%)',
        zIndex: 99,
        pointerEvents: 'none',
        transformOrigin: 'top left',
        // Fade in after the headline.
        opacity: revealed ? 1 : 0,
        transition: 'opacity 0.8s ease',
      }}
    >
      {ids.map((id, i) => {
        const pos = (i - active + N) % N;
        const s = slotStyle(pos);
        // The front→back recycle is fade-only (no animated travel): the exiting
        // card (now at the hidden slot) fades out in place at the FRONT, then
        // the next cycle it snaps to the back slot while invisible and fades in.
        // Everything else (the trail shuffling forward) animates smoothly.
        const FRONT = slotStyle(0);
        const isExiting = pos === N - 1; // just left the front → fade out in place
        const isEntering = pos === N - 2; // came from hidden → snap to back, fade in
        const tx = isExiting ? FRONT : s;
        const transition =
          isExiting || isEntering
            ? 'opacity 0.55s ease' // fade only; transform changes snap (invisible)
            : 'transform 0.85s cubic-bezier(0.25, 0.1, 0.25, 1), opacity 0.55s ease';
        return (
          <div
            key={id}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: cardWidth,
              transformOrigin: 'top left',
              transform: `translate(${tx.x}px, ${tx.y}px) rotate(${tx.rot}deg) scale(${tx.scale})`,
              opacity: s.op,
              // Exiting card fades out on top so the fade is visible (not hidden
              // behind the incoming front card).
              zIndex: isExiting ? 70 : s.z,
              transition,
              // Per-slot delay ripples the trail forward like a string.
              transitionDelay: isExiting || isEntering ? '0s' : `${pos * 0.06}s`,
            }}
          >
            <DeliverableHoverCard id={id} shown rot={0} offX={0} width="100%" noShadow />
          </div>
        );
      })}
    </div>
  );
}
