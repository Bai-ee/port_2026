// The <html> attribute contract (contract §8.1). Tiny and dependency-free so the main
// bundle can use it without pulling the authoring engine.

/** Set data-theme / data-theme-pref / color-scheme. Idempotent; each write skipped when unchanged. */
export function applyModeAttributes(doc, { mode, preference }) {
  const root = doc && doc.documentElement;
  if (!root) return;
  const m = mode === 'dark' ? 'dark' : 'light';
  if (root.getAttribute('data-theme') !== m) root.setAttribute('data-theme', m);
  if (preference && root.getAttribute('data-theme-pref') !== preference) root.setAttribute('data-theme-pref', preference);
  if (root.style && root.style.colorScheme !== m) root.style.colorScheme = m;
}

export function readModeAttributes(doc) {
  const root = doc && doc.documentElement;
  if (!root) return { mode: null, preference: null };
  return { mode: root.getAttribute('data-theme'), preference: root.getAttribute('data-theme-pref') };
}

export const SWITCHING_ATTR = 'data-theme-switching';

export function setSwitching(doc, on) {
  const root = doc && doc.documentElement;
  if (!root) return;
  if (on) { if (!root.hasAttribute(SWITCHING_ATTR)) root.setAttribute(SWITCHING_ATTR, ''); }
  else if (root.hasAttribute(SWITCHING_ATTR)) root.removeAttribute(SWITCHING_ATTR);
}

/**
 * Reference-counted gate for `data-theme-switching` (transition suppression). Several holders can
 * overlap (a mode switch during a hue drag); the attribute clears only when the last one releases.
 *   const gate = createSwitchingGate(document, raf);
 *   const release = gate.hold();          // attribute set now
 *   release();                            // attribute cleared 2 animation frames later
 *   release.immediate();                  // ... or right now
 */
export function createSwitchingGate(doc, raf) {
  let holds = 0;
  function drop() {
    holds = Math.max(0, holds - 1);
    if (holds === 0) setSwitching(doc, false);
  }
  return {
    hold() {
      holds += 1;
      setSwitching(doc, true);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        raf(() => raf(drop));
      };
      release.immediate = () => {
        if (released) return;
        released = true;
        drop();
      };
      return release;
    },
    get holds() { return holds; },
  };
}
