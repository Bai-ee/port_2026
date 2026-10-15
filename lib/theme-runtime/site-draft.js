// Site-wide applied draft, rehydrated from storage (contract §15.2 ThemeRuntime duties).
// The bootstrap already injected the draft CSS before paint; this keeps the page (and the scene
// bridge) in step afterwards: on mount, and when another tab applies/reverts the draft.
// No engine import: only reads strings the Studio wrote.

import { STORAGE_KEYS, DRAFT_CSS_MARKER } from '../theme/constants.js';
import { getSceneBridge, isStudioSessionActive } from './registry.js';

const STYLE_ID = 'theme-draft-css';

export function isValidScenes(v) {
  const ok = (s) => s && typeof s === 'object' && typeof s.background === 'string'
    && typeof s.hueShift === 'number' && Number.isFinite(s.hueShift)
    && typeof s.saturationMul === 'number' && typeof s.lightnessDelta === 'number'
    && typeof s.opacityMul === 'number' && typeof s.hueSpan === 'number';
  return !!v && typeof v === 'object' && ok(v.light) && ok(v.dark);
}

/**
 * @param safe   storage wrapper from createSafeStorage
 * @param options { document, getSceneBridge }
 * @returns 'skipped' | 'applied' | 'cleared'
 */
export function syncSiteDraft(safe, options = {}) {
  const doc = options.document !== undefined ? options.document : (typeof document !== 'undefined' ? document : null);
  const bridge = (options.getSceneBridge || getSceneBridge)();
  // An in-memory Studio draft in this tab always wins over what storage says.
  if (isStudioSessionActive()) return 'skipped';

  const el = doc ? doc.getElementById(STYLE_ID) : null;
  const active = safe.get(STORAGE_KEYS.active) === '1';
  if (!active) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
    if (bridge && bridge.setDraft) bridge.setDraft(null);
    return 'cleared';
  }

  const css = safe.get(STORAGE_KEYS.draftCss);
  if (doc && css && css.indexOf(DRAFT_CSS_MARKER) === 0) {
    let target = el;
    if (!target) {
      target = doc.createElement('style');
      target.id = STYLE_ID;
      (doc.head || doc.documentElement).appendChild(target);
    }
    if (target.textContent !== css) target.textContent = css;
  }

  let scenes = null;
  try {
    const raw = safe.get(STORAGE_KEYS.draftScene);
    scenes = raw ? JSON.parse(raw) : null;
  } catch { scenes = null; }
  if (bridge && bridge.setDraft) bridge.setDraft(isValidScenes(scenes) ? scenes : null);
  return 'applied';
}
