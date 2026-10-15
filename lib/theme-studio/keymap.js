// Keyboard rules for the Studio (pure; the components just forward events).

import { stepDecimals, roundTo } from './format.js';

const INC = new Set(['ArrowRight', 'ArrowUp']);
const DEC = new Set(['ArrowLeft', 'ArrowDown']);

/**
 * Next value for a slider key press, or null when the key is not a slider key.
 * opts: { value, min, max, step, page?, shift?, wrap? }
 * Arrows move by step (x10 with Shift), PageUp/PageDown by `page`, Home/End jump
 * to the ends. With wrap (hue) arrows and pages loop around instead of stopping.
 */
export function sliderKeyStep(key, opts) {
  const { value, min, max, step, shift = false, wrap = false } = opts;
  const page = opts.page ?? step * 10;
  if (![value, min, max, step].every(Number.isFinite) || step <= 0) return null;
  const dp = Math.max(stepDecimals(step), stepDecimals(page));
  let delta = 0;
  if (key === 'Home') return min;
  if (key === 'End') return max;
  if (INC.has(key)) delta = step * (shift ? 10 : 1);
  else if (DEC.has(key)) delta = -step * (shift ? 10 : 1);
  else if (key === 'PageUp') delta = page;
  else if (key === 'PageDown') delta = -page;
  else return null;
  let next = value + delta;
  if (wrap) {
    const span = max - min;
    next = min + ((((next - min) % span) + span) % span);
  } else {
    next = Math.min(max, Math.max(min, next));
  }
  return roundTo(next, dp);
}

/** True for elements where Ctrl/Cmd+Z should keep its native text-editing meaning. */
export function isNativeUndoTarget(target) {
  if (!target) return false;
  const tag = String(target.tagName || '').toLowerCase();
  return tag === 'textarea' || target.isContentEditable === true;
}

/**
 * Map a keydown to a Studio command: 'undo' | 'redo' | 'escape' | 'toggle' | null.
 * e: { key, ctrlKey, metaKey, shiftKey, altKey, target }
 */
export function matchShortcut(e) {
  if (!e) return null;
  const k = String(e.key || '');
  const mod = !!(e.ctrlKey || e.metaKey);
  if (k === 'Escape') return 'escape';
  if (e.altKey && e.shiftKey && !mod && (k === 'T' || k === 't')) return 'toggle';
  if (mod && !e.altKey) {
    if (isNativeUndoTarget(e.target)) return null;
    if ((k === 'z' || k === 'Z') && !e.shiftKey) return 'undo';
    if ((k === 'z' || k === 'Z') && e.shiftKey) return 'redo';
    if ((k === 'y' || k === 'Y') && e.ctrlKey && !e.shiftKey) return 'redo';
  }
  return null;
}

/** Index to focus next inside a trap of `count` focusable elements. */
export function trapNextIndex({ count, index, shift }) {
  if (count <= 0) return -1;
  if (index < 0 || index >= count) return shift ? count - 1 : 0;
  if (shift) return index === 0 ? count - 1 : index - 1;
  return index === count - 1 ? 0 : index + 1;
}
