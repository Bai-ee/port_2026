// Draft applier (contract §7.5 "Apply pipeline"). Engine-importing (lazy chunk with the draft store).
//
// Every draft change calls schedule(definition); any number of calls inside one frame produce ONE
// apply in the next animation frame:
//   resolveBoth -> toCss -> <style id="theme-draft-css"> -> sceneBridge.setDraft -> theme:tokens-changed
// While a transient drag is open `data-theme-switching` is held on <html> (transitions suppressed);
// it clears two frames after the drag ends.

import { resolveBoth } from '../theme/resolve.js';
import { toCss } from '../theme/css.js';
import { DRAFT_CSS_MARKER } from '../theme/constants.js';
import { createDefaultScheduler } from './scheduler.js';
import { createSwitchingGate } from './dom-attrs.js';
import { emitTokensChanged } from './read-token.js';
import { getSceneBridge } from './registry.js';

export const DRAFT_STYLE_ID = 'theme-draft-css';

/** Persistable/injectable form of the draft CSS: the bootstrap only accepts text starting with the marker. */
export function buildDraftCss(pair) {
  const css = toCss(pair, { header: false });
  return `${DRAFT_CSS_MARKER}hash:${pair.light.hash} */\n${css}`;
}

export function sceneOf(pair) {
  return { light: pair.light.scene, dark: pair.dark.scene };
}

/**
 * @param options { document, scheduler, getSceneBridge, onApplied }
 */
export function createApplier(options = {}) {
  const doc = options.document !== undefined ? options.document : (typeof document !== 'undefined' ? document : null);
  const sched = options.scheduler || createDefaultScheduler();
  const bridgeOf = options.getSceneBridge || getSceneBridge;
  const onApplied = options.onApplied || (() => {});
  const gate = doc ? createSwitchingGate(doc, sched.raf) : null;

  let pending = null;
  let handle = null;
  let applyCount = 0;
  let last = null; // { definition, pair, css, scenes }
  let releaseSwitching = null;

  function styleEl(create) {
    if (!doc) return null;
    let el = doc.getElementById(DRAFT_STYLE_ID);
    if (!el && create) {
      el = doc.createElement('style');
      el.id = DRAFT_STYLE_ID;
      (doc.head || doc.documentElement).appendChild(el);
    }
    return el;
  }

  // `visible:false` still resolves (the Studio needs the numbers) but shows PRODUCTION on the page
  // (Before/After compare): the draft style element is removed and the bridge draft cleared.
  function applyNow(definition, visible = true) {
    const pair = resolveBoth(definition);
    const scenes = sceneOf(pair);
    const bridge = bridgeOf();
    let css = null;
    if (visible) {
      css = buildDraftCss(pair);
      const el = styleEl(true);
      if (el) el.textContent = css;
      if (bridge && typeof bridge.setDraft === 'function') bridge.setDraft(scenes);
    } else {
      const el = styleEl(false);
      if (el && el.parentNode) el.parentNode.removeChild(el);
      if (bridge && typeof bridge.setDraft === 'function') bridge.setDraft(null);
    }
    applyCount += 1;
    last = { definition, pair, css, scenes, visible };
    emitTokensChanged(doc);
    onApplied(last);
    return last;
  }

  function run() {
    handle = null;
    const req = pending;
    pending = null;
    if (req) applyNow(req.definition, req.visible);
  }

  return {
    /** Request an apply of `definition` in the next frame (coalesces with earlier requests). */
    schedule(definition, visible = true) {
      pending = { definition, visible };
      if (handle === null) handle = sched.raf(run);
    },
    /** Apply any pending request synchronously (used before persisting). Returns the last applied result. */
    flush() {
      if (handle !== null) { sched.caf(handle); handle = null; run(); }
      return last;
    },
    /** Apply synchronously regardless of the frame (used on startDraft so the snapshot is complete). */
    applyImmediately(definition, visible = true) {
      if (handle !== null) { sched.caf(handle); handle = null; }
      pending = null;
      return applyNow(definition, visible);
    },
    /** Remove the draft from the page: production tokens/scene show again. */
    clear() {
      if (handle !== null) { sched.caf(handle); handle = null; }
      pending = null;
      last = null;
      const el = styleEl(false);
      if (el && el.parentNode) el.parentNode.removeChild(el);
      const bridge = bridgeOf();
      if (bridge && typeof bridge.setDraft === 'function') bridge.setDraft(null);
      emitTokensChanged(doc);
    },
    /** Transient (drag) bracket: transitions suppressed while open, cleared 2 frames after end. */
    beginSwitching() {
      if (!gate || releaseSwitching) return;
      releaseSwitching = gate.hold();
    },
    endSwitching() {
      if (!releaseSwitching) return;
      const r = releaseSwitching;
      releaseSwitching = null;
      r();
    },
    get applyCount() { return applyCount; },
    get pendingFrame() { return handle !== null; },
    get last() { return last; },
    get switchingOpen() { return !!releaseSwitching; },
  };
}
