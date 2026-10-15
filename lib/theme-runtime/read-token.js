// Reading resolved tokens from JS (contract §7.6) and the `theme:tokens-changed` event.
// Prefer `'var(--t-…)'` strings; use readToken only where a real colour value is required
// (canvas 2D, `new THREE.Color`), and re-read on onTokensChanged.

export const TOKENS_CHANGED_EVENT = 'theme:tokens-changed';

let epoch = 0;
const memo = new Map();

export function getTokensEpoch() { return epoch; }

/** Invalidate memoised reads. Called by emitTokensChanged; exposed for tests. */
export function bumpTokensEpoch() {
  epoch += 1;
  memo.clear();
  return epoch;
}

/**
 * Dispatch `theme:tokens-changed` on `doc` (default: global document) after bumping the epoch.
 * Safe without a DOM and without CustomEvent.
 */
export function emitTokensChanged(doc) {
  bumpTokensEpoch();
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || typeof d.dispatchEvent !== 'function') return;
  try {
    const Ctor = typeof CustomEvent === 'function' ? CustomEvent : null;
    const evt = Ctor ? new Ctor(TOKENS_CHANGED_EVENT, { detail: { epoch } }) : { type: TOKENS_CHANGED_EVENT, detail: { epoch } };
    d.dispatchEvent(evt);
  } catch { /* a broken listener must not break the caller */ }
}

/**
 * getComputedStyle(documentElement).getPropertyValue(name).trim(), memoised per tokens-changed epoch.
 * With an explicit element (e.g. a `[data-theme-scope]` subtree) the read is not memoised.
 * Returns '' during SSR or when the token is not defined.
 */
export function readToken(name, el) {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return '';
  if (!el) {
    const hit = memo.get(name);
    if (hit !== undefined) return hit;
  }
  let value = '';
  try {
    const target = el || document.documentElement;
    value = String(getComputedStyle(target).getPropertyValue(name) || '').trim();
  } catch { value = ''; }
  if (!el) memo.set(name, value);
  return value;
}

/** Subscribe to token changes (mode switch, preference change, draft apply). Returns unsubscribe. */
export function onTokensChanged(fn, doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || typeof d.addEventListener !== 'function' || typeof fn !== 'function') return () => {};
  const handler = (event) => fn(event);
  d.addEventListener(TOKENS_CHANGED_EVENT, handler);
  return () => d.removeEventListener(TOKENS_CHANGED_EVENT, handler);
}
