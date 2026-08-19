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
export function scrambleTextTo(node, next, options = {}) {
  const { durationMs = 600, preserveWhitespace = false, onComplete } = options;
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
      } else if (preserveWhitespace && /\s/.test(target)) {
        out += target;
      } else if (progress >= lockPoint) {
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
