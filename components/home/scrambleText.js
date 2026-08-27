'use client';

// Shared scramble-in text effect. Same character set and per-character lock
// timing as the hero subheadline, so every scramble on the site reads as one
// effect. Used by HeroHeadline (cycling) and the HITLOOP about paragraph
// (one-shot, ScrollTrigger'd).
export const SCRAMBLE_CHARS = '!<>-_\\/[]{}—=+*^?#________';

// Shared ease for scrambles that should feel weighted — most of the characters
// lock almost immediately, the last few settle in. Used by the cursor-driven
// subheadline so the reveal reads as inertia rather than a constant sweep.
export const easeOutQuart = (t) => 1 - (1 - t) ** 4;

// Shared ease for scrambles that should read as one continuous move rather
// than a snap — slow to leave, slow to arrive. Used where the scramble has to
// communicate a word turning into another word, not just resolve fast.
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

// Stable pseudo-random glyph for a (character index, churn step) pair. Same
// inputs always give the same glyph, which is what lets the churn hold a value
// for a whole step instead of re-rolling every frame.
const glyphFor = (pool, index, step) => {
  const h = (Math.imul(index + 1, 73856093) ^ Math.imul(step + 1, 19349663)) >>> 0;
  return pool[h % pool.length];
};

const randomChar = () => SCRAMBLE_CHARS[(Math.random() * SCRAMBLE_CHARS.length) | 0];

// Character pool built from the words a scramble runs between, for swaps that
// should read as one word re-forming into another rather than as glitch static.
// Symbol churn says "corrupted signal"; churning HELLO into UNDERGROUNDEX using
// only H/E/L/O/U/N/D/R/G/X says the letters themselves are rearranging.
// Duplicates and whitespace are dropped; order follows first appearance.
export function poolFromWords(...words) {
  let pool = '';
  for (const word of words) {
    const upper = String(word || '').toUpperCase();
    for (let i = 0; i < upper.length; i += 1) {
      const char = upper[i];
      if (/\s/.test(char) || pool.includes(char)) continue;
      pool += char;
    }
  }
  return pool;
}

// Pre-reveal placeholder: same length (and same spaces when preserved) as the
// final string, so swapping it in causes no layout shift.
export function scrambleMask(text, { preserveWhitespace = false } = {}) {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    out += preserveWhitespace && /\s/.test(text[i]) ? text[i] : randomChar();
  }
  return out;
}

// Scrambles node's current text into `next`. Returns a cancel function.
// preserveWhitespace keeps spaces/newlines fixed so wrapped paragraphs don't
// reflow mid-animation.
// churnBeforeLock re-randomises characters that haven't reached their lock
// window yet, instead of holding the incoming text frozen. Needed for long
// scrambles (the hero headline runs ~1.5s) where the default would sit on a
// static mask for most of the duration.
// churnIntervalMs holds each scrambling character on one glyph for that many
// ms instead of re-rolling it every frame. Re-rolling at 60fps reads as strobe
// noise; ~60ms reads as a machine cycling through characters. Each character is
// also phase-offset from its neighbours, so the re-rolls travel across the word
// as a wave rather than the whole line flickering in lockstep. 0 = the original
// every-frame behaviour.
// charPool replaces the default symbol set for this scramble — see
// poolFromWords. Ignored if it holds fewer than two distinct characters, since
// a one-glyph pool cannot visibly churn.
// ease reshapes the timeline without changing its length: characters lock on
// eased progress instead of wall-clock progress, so an ease-out front-loads the
// locking and lets the tail settle. Defaults to linear, which is what every
// pre-existing caller gets.
// growIn emits nothing for characters that haven't reached their scramble
// window, so the line types itself out left to right instead of appearing as a
// full-width block of glyphs. The node should start empty, and the line needs a
// min-height or the growth will change the element's height.
export function scrambleTextTo(node, next, options = {}) {
  const {
    durationMs = 600,
    preserveWhitespace = false,
    churnBeforeLock = false,
    growIn = false,
    ease = null,
    churnIntervalMs = 0,
    charPool = null,
    onComplete,
  } = options;
  const pool = charPool && charPool.length >= 2 ? charPool : SCRAMBLE_CHARS;
  const pick = () => pool[(Math.random() * pool.length) | 0];
  const prev = node.textContent || '';
  const length = Math.max(prev.length, next.length);
  const start = performance.now();
  let rafId = 0;

  const frame = (now) => {
    const elapsedMs = now - start;
    const elapsed = Math.min(elapsedMs / durationMs, 1);
    const progress = ease ? ease(elapsed) : elapsed;
    // Phase each character a third of a step apart so neighbours never re-roll
    // on the same frame.
    const phaseMs = churnIntervalMs / 3;
    const churn = churnIntervalMs > 0
      ? (i) => glyphFor(pool, i, Math.floor((elapsedMs + i * phaseMs) / churnIntervalMs))
      : pick;
    let out = '';
    for (let i = 0; i < length; i += 1) {
      const target = next[i] ?? '';
      // Each char locks into place at a staggered point in the timeline.
      const lockPoint = (i / length) * 0.7;
      if (progress >= lockPoint + 0.3 || elapsed >= 1) {
        out += target;
        continue;
      }
      const started = progress >= lockPoint;
      // lockPoint only grows with i, so nothing past here has started either.
      if (growIn && !started) break;
      if (preserveWhitespace && /\s/.test(target)) {
        out += target;
      } else if (started || churnBeforeLock) {
        out += churn(i);
      } else {
        out += prev[i] ?? churn(i);
      }
    }
    node.textContent = out;

    if (elapsed < 1) {
      rafId = requestAnimationFrame(frame);
    } else {
      node.textContent = next;
      if (onComplete) onComplete();
    }
  };

  rafId = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(rafId);
}

// Holds `node` in a continuously re-randomised scrambled state for as long as
// it runs — no timeline, no target. Cursor-driven scrambles use this: the line
// churns while the pointer moves, then a scrambleTextTo call resolves it.
// `template` fixes the character count (and, with preserveWhitespace, the space
// positions) to the phrase that will be revealed, so the line never reflows
// between churning and resolving. Returns a cancel function.
export function scrambleChurn(node, template, options = {}) {
  const { preserveWhitespace = false, intervalMs = 45 } = options;
  let rafId = 0;
  let last = -Infinity;

  const frame = (now) => {
    if (now - last >= intervalMs) {
      node.textContent = scrambleMask(template, { preserveWhitespace });
      last = now;
    }
    rafId = requestAnimationFrame(frame);
  };

  rafId = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(rafId);
}
