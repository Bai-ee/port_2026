'use client';

// One clock for the cursor-driven hero.
//
// HeroHeadline owns the only pointermove listener and writes this object as the
// subheadline churns and resolves; HeroSchematicOverlay reads it every frame so
// the measurement lines and the text change are the same action rather than two
// effects that happen to run at once. Plain mutable object behind a ref — never
// React state, since both sides run per-frame.
//
// phase:
//   'idle'   — cursor still and the phrase has resolved. Nothing animates.
//   'churn'  — cursor moving. Subheadline scrambles, lines track live.
//   'reveal' — cursor went still. Subheadline is locking in and the lines
//              retract into the cursor over the same duration.
export function createHeroCursorStage() {
  return {
    phase: 'idle',
    x: 0,
    y: 0,
    // Pointer has been seen at least once — before that there is nothing to
    // draw a line to, so the overlay stays blank.
    seen: false,
    // performance.now() of the moment the reveal fired, and how long it runs.
    // The overlay drives its retract/flash off these, so it always resolves on
    // exactly the same clock as the scramble.
    revealAt: 0,
    revealMs: 0,
  };
}
