'use client';

// Shared scramble-in text effect. Same character set and per-character lock
// timing as the hero subheadline, so every scramble on the site reads as one
// effect. Used by HeroHeadline (cycling) and the HITLOOP about paragraph
// (one-shot, ScrollTrigger'd).
export const SCRAMBLE_CHARS = '!<>-_\\/[]{}—=+*^?#________';

const randomChar = () => SCRAMBLE_CHARS[(Math.random() * SCRAMBLE_CHARS.length) | 0];

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
    onComplete,
  } = options;
  const prev = node.textContent || '';
  const length = Math.max(prev.length, next.length);
  const start = performance.now();
  let rafId = 0;

  const frame = (now) => {
    const progress = Math.min((now - start) / durationMs, 1);
    let out = '';
    for (let i = 0; i < length; i += 1) {
      const target = next[i] ?? '';
      // Each char locks into place at a staggered point in the timeline.
      const lockPoint = (i / length) * 0.7;
      if (progress >= lockPoint + 0.3 || progress >= 1) {
        out += target;
        continue;
      }
      const started = progress >= lockPoint;
      // lockPoint only grows with i, so nothing past here has started either.
      if (growIn && !started) break;
      if (preserveWhitespace && /\s/.test(target)) {
        out += target;
      } else if (started || churnBeforeLock) {
        out += randomChar();
      } else {
        out += prev[i] ?? randomChar();
      }
    }
    node.textContent = out;

    if (progress < 1) {
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
