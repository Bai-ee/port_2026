// Theme draft store (contract §7.5). Plain module, no React; lazy (Studio / ThemeStudioMount only).
//
// State flow:
//   updateDraft -> history (unless transient) -> applier (1 rAF) -> <style id="theme-draft-css"> + scene bridge
//                                             -> autosave (trailing 400 ms) -> localStorage + report (150 ms)
// "Saved" (saveDraft) is an explicit, broadcast checkpoint; autosave only protects work from a reload.
// `dirty` = draft differs from the last explicit save (the hash travels in the payload as savedHash,
// so the indicator survives a reload).

import { STORAGE_KEYS } from '../theme/constants.js';
import { hashDefinition, validateDefinition } from '../theme/validate.js';
import { buildReport } from '../theme/report.js';
import { buildExportBundle, importThemeJson } from '../theme/export.js';
import { resetRole as editResetRole, resetMode as editResetMode } from '../theme/edit.js';
import { PRODUCTION_DEFINITION } from './production.js';
import { createSafeStorage, localSource } from './storage.js';
import { createDefaultScheduler } from './scheduler.js';
import { createHistory } from './history.js';
import { createApplier, buildDraftCss } from './applier.js';
import { createCrossTab } from './cross-tab.js';
import { getSceneBridge, setStudioSessionActive } from './registry.js';
import { getPrefStore } from './pref-store.js';

export const AUTOSAVE_MS = 400;
export const REPORT_MS = 150;

const SERVER_SNAPSHOT = Object.freeze({
  active: false, applied: false, draft: null, production: PRODUCTION_DEFINITION,
  dirty: false, differsFromProduction: false, savedAt: null, canUndo: false, canRedo: false,
  editingMode: 'light', previewMode: null, compare: 'draft', resolved: null, report: null,
  reportPending: false, externalChange: false, storageAvailable: true,
});

/** Parse what the store wrote under STORAGE_KEYS.draft. Never throws. */
export function parseStoredDraft(raw) {
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || obj.v !== 1 || !obj.definition) return { ok: false };
    const v = validateDefinition(obj.definition);
    if (!v.ok || !v.definition) return { ok: false };
    return {
      ok: true,
      definition: v.definition,
      savedAt: typeof obj.savedAt === 'string' ? obj.savedAt : null,
      savedHash: typeof obj.savedHash === 'string' ? obj.savedHash : null,
      baseHash: typeof obj.baseHash === 'string' ? obj.baseHash : null,
    };
  } catch { return { ok: false }; }
}

/**
 * @param options all injectable for tests:
 *   production, scheduler, document, storage, win, ChannelCtor, prefStore (null => none),
 *   getSceneBridge
 */
export function createDraftStore(options = {}) {
  const production = options.production || PRODUCTION_DEFINITION;
  const sched = options.scheduler || createDefaultScheduler();
  const doc = options.document !== undefined ? options.document : (typeof document !== 'undefined' ? document : null);
  const win = options.win !== undefined ? options.win : (typeof window !== 'undefined' ? window : null);
  const prefStore = options.prefStore !== undefined ? options.prefStore : null;
  const nowIso = () => new Date(sched.now()).toISOString();

  const safe = createSafeStorage(options.storage !== undefined ? options.storage : localSource, {
    onFail: () => { if (ready) emit(); },
  });
  let ready = false;

  // ---- hashing (memoised by definition identity) ----
  const hashes = new WeakMap();
  function hashOf(def) {
    if (!def) return null;
    let h = hashes.get(def);
    if (h === undefined) { h = hashDefinition(def); hashes.set(def, h); }
    return h;
  }
  const productionHash = hashOf(production);

  // ---- state ----
  let draft = null;
  let savedHash = null;
  let savedAt = null;
  let seenExternalAt = null;
  let pendingExternal = null;
  let externalChange = false;
  let applied = false;
  let transientOpen = false;
  let editingMode = 'light';
  let previewMode = null;
  let compare = 'draft';
  let resolved = null;
  let report = null;
  let reportPending = false;
  let history = createHistory({ now: () => sched.now() });
  let snapshot = null;
  const listeners = new Set();

  function visible() { return compare === 'draft'; }

  const applier = createApplier({
    document: doc,
    scheduler: sched,
    getSceneBridge: options.getSceneBridge || getSceneBridge,
    onApplied: (result) => {
      if (draft && result.definition === draft) {
        resolved = { light: result.pair.light, dark: result.pair.dark };
        emit();
      }
    },
  });

  // ---- snapshot ----
  function buildSnapshot() {
    const dh = hashOf(draft);
    return Object.freeze({
      active: draft !== null,
      applied,
      draft,
      production,
      dirty: draft !== null && dh !== savedHash,
      differsFromProduction: draft !== null && dh !== productionHash,
      savedAt,
      canUndo: draft !== null && (history.canUndo || transientOpen),
      canRedo: draft !== null && history.canRedo && !transientOpen,
      editingMode,
      previewMode,
      compare,
      resolved: draft ? resolved : null,
      report: draft ? report : null,
      reportPending,
      externalChange,
      storageAvailable: safe.available,
    });
  }
  function emit() {
    snapshot = buildSnapshot();
    for (const l of Array.from(listeners)) { try { l(); } catch { /* isolate */ } }
  }

  // ---- timers ----
  let autosaveTimer = null;
  let reportTimer = null;

  function clearTimers() {
    if (autosaveTimer !== null) { sched.clearTimeout(autosaveTimer); autosaveTimer = null; }
    if (reportTimer !== null) { sched.clearTimeout(reportTimer); reportTimer = null; }
  }

  function scheduleReport() {
    if (!draft || transientOpen) return;
    reportPending = true;
    if (reportTimer !== null) sched.clearTimeout(reportTimer);
    reportTimer = sched.setTimeout(() => {
      reportTimer = null;
      if (!draft || transientOpen) return;
      try { report = buildReport(draft); } catch { report = null; }
      reportPending = false;
      emit();
    }, REPORT_MS);
  }

  function scheduleAutosave() {
    if (!draft || transientOpen) return;
    if (autosaveTimer !== null) sched.clearTimeout(autosaveTimer);
    autosaveTimer = sched.setTimeout(() => { autosaveTimer = null; persist(); }, AUTOSAVE_MS);
  }

  function flushAutosave() {
    if (autosaveTimer !== null) { sched.clearTimeout(autosaveTimer); autosaveTimer = null; }
    if (draft) persist();
  }

  // ---- persistence ----
  function payloadFor() {
    return JSON.stringify({
      v: 1, savedAt, savedHash, baseHash: productionHash, definition: draft,
    });
  }

  /**
   * Write the draft record, and the site-wide keys when applied. Returns the raw payload or null
   * on failure. While another tab's saved draft is waiting on the user's choice (externalChange)
   * the shared keys are off limits to implicit writes (autosave, pagehide): they would replace
   * that explicit checkpoint with this tab's unsaved work. Deliberate actions pass `force`.
   */
  function persist({ force = false } = {}) {
    if (!draft) return null;
    if (!force && (externalChange || pendingExternal)) return null;
    const raw = payloadFor();
    const ok = safe.set(STORAGE_KEYS.draft, raw);
    if (applied) writeSiteKeys();
    if (!safe.available) emit();
    return ok ? raw : null;
  }

  function writeSiteKeys() {
    const last = applier.flush() || applier.last;
    let pair = last && last.definition === draft ? last.pair : null;
    if (!pair) pair = applier.applyImmediately(draft, visible()).pair;
    safe.set(STORAGE_KEYS.draftCss, buildDraftCss(pair));
    safe.set(STORAGE_KEYS.draftScene, JSON.stringify({ light: pair.light.scene, dark: pair.dark.scene }));
    safe.set(STORAGE_KEYS.active, '1');
  }

  function clearSiteKeys() {
    safe.remove(STORAGE_KEYS.active);
    safe.remove(STORAGE_KEYS.draftCss);
    safe.remove(STORAGE_KEYS.draftScene);
  }

  // ---- lifecycle internals ----
  function adopt(def, meta = {}) {
    clearTimers();
    transientOpen = false;
    applier.endSwitching();
    draft = def;
    savedHash = meta.savedHash !== undefined && meta.savedHash !== null ? meta.savedHash : hashOf(def);
    savedAt = meta.savedAt || null;
    history = createHistory({ now: () => sched.now() });
    history.reset(def, meta.label || 'start');
    externalChange = false;
    pendingExternal = null;
    compare = 'draft';
    resolved = null;
    report = null;
    setStudioSessionActive(true);
    applier.applyImmediately(def, true); // sets `resolved` through onApplied
    scheduleReport();
  }

  function afterEdit({ persistNow = false } = {}) {
    applier.schedule(draft, visible());
    if (persistNow) flushAutosave(); else scheduleAutosave();
    scheduleReport();
    emit();
  }

  function commitIfTransient() {
    if (transientOpen) store.commitTransient();
  }

  function loadStored() {
    const raw = safe.get(STORAGE_KEYS.draft);
    if (!raw) return null;
    const parsed = parseStoredDraft(raw);
    return parsed.ok ? parsed : null;
  }

  // ---- cross-tab ----
  let crossTab = null;
  function onDraftRaw(raw) {
    const parsed = parseStoredDraft(raw);
    if (!parsed.ok || !parsed.savedAt) return; // autosave traffic (no explicit save) is ignored
    const known = [savedAt, seenExternalAt].filter(Boolean).sort().pop() || null;
    if (known && parsed.savedAt <= known) return; // duplicate delivery (storage + channel) or older
    if (!draft) return; // no session here: nothing to protect, the next start loads it
    seenExternalAt = parsed.savedAt;
    const dirty = hashOf(draft) !== savedHash;
    if (dirty) {
      // NEVER overwrite unsaved work: surface the choice instead
      pendingExternal = parsed;
      externalChange = true;
      emit();
      return;
    }
    savedAt = parsed.savedAt;
    adoptIncoming(parsed);
  }

  function adoptIncoming(parsed) {
    draft = parsed.definition;
    savedHash = parsed.savedHash || hashOf(parsed.definition);
    savedAt = parsed.savedAt;
    history = createHistory({ now: () => sched.now() });
    history.reset(draft, 'synced');
    externalChange = false;
    pendingExternal = null;
    resolved = null;
    applier.applyImmediately(draft, visible()); // sets `resolved`; no autosave/broadcast (it is already stored)
    scheduleReport();
    emit();
  }

  // ---- public API ----
  const store = {
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => SERVER_SNAPSHOT,

    /** Attach pagehide flush and cross-tab listeners. Idempotent; returns stop(). */
    start() {
      if (crossTab) return store.stop;
      crossTab = createCrossTab({ win, ChannelCtor: options.ChannelCtor, onDraftRaw });
      if (win && typeof win.addEventListener === 'function') {
        win.addEventListener('pagehide', onPageHide);
      }
      return store.stop;
    },
    stop() {
      if (crossTab) { crossTab.close(); crossTab = null; }
      if (win && typeof win.removeEventListener === 'function') win.removeEventListener('pagehide', onPageHide);
    },

    // ---- lifecycle ----
    /**
     * Begin (or resume) a draft session.
     *   startDraft(definition)  validate + use that definition (not dirty)
     *   startDraft()            resume the last saved/autosaved draft if there is one, else fork production
     */
    startDraft(fromDefinition) {
      if (fromDefinition) {
        const v = validateDefinition(fromDefinition);
        if (!v.ok || !v.definition) return { ok: false, errors: v.errors };
        applied = safe.get(STORAGE_KEYS.active) === '1';
        adopt(v.definition, { label: 'start' });
        emit();
        return { ok: true, source: 'definition' };
      }
      const saved = loadStored();
      if (saved) {
        applied = safe.get(STORAGE_KEYS.active) === '1';
        adopt(saved.definition, { savedHash: saved.savedHash, savedAt: saved.savedAt, label: 'resumed' });
        emit();
        return { ok: true, source: 'saved' };
      }
      applied = false;
      adopt(production, { label: 'start' });
      emit();
      return { ok: true, source: 'production' };
    },

    /** Load the stored draft into the session. `found:false` when nothing valid is stored. */
    loadSaved() {
      const saved = loadStored();
      if (!saved) return { ok: true, found: false };
      applied = safe.get(STORAGE_KEYS.active) === '1';
      adopt(saved.definition, { savedHash: saved.savedHash, savedAt: saved.savedAt, label: 'loaded' });
      emit();
      return { ok: true, found: true };
    },

    discardDraft() {
      clearTimers();
      transientOpen = false;
      applier.endSwitching();
      applier.clear();
      draft = null; savedHash = null; savedAt = null; applied = false;
      externalChange = false; pendingExternal = null; resolved = null; report = null; reportPending = false;
      compare = 'draft'; previewMode = null;
      history = createHistory({ now: () => sched.now() });
      safe.remove(STORAGE_KEYS.draft);
      clearSiteKeys();
      if (prefStore) prefStore.setPreviewOverride(null);
      setStudioSessionActive(false);
      emit();
    },

    saveDraft() {
      if (!draft) return { ok: false, savedAt: null, error: 'No draft to save.' };
      commitIfTransient();
      const at = nowIso();
      const prevAt = savedAt; const prevHash = savedHash;
      savedAt = at; savedHash = hashOf(draft);
      if (autosaveTimer !== null) { sched.clearTimeout(autosaveTimer); autosaveTimer = null; }
      const raw = persist({ force: true });
      if (!raw) {
        savedAt = prevAt; savedHash = prevHash; // stay dirty: nothing was stored
        emit();
        return { ok: false, savedAt: null, error: 'Could not save: storage unavailable.' };
      }
      if (crossTab) crossTab.post(raw);
      emit();
      return { ok: true, savedAt: at };
    },

    /** Apply the draft site-wide (persist for other loads/tabs) or revert to production for everyone else. */
    setApplied(on) {
      if (!draft) return;
      const next = !!on;
      if (next === applied) return;
      applied = next;
      if (next) {
        commitIfTransient();
        persist({ force: true });
      } else {
        clearSiteKeys();
      }
      emit();
    },

    // ---- editing ----
    updateDraft(updater, opts = {}) {
      if (typeof updater !== 'function') return false;
      if (!draft) { const r = store.startDraft(); if (!r.ok) return false; }
      if (!opts.transient) commitIfTransient();
      const next = updater(draft);
      if (!next || typeof next !== 'object' || next === draft) return false;
      draft = next;
      if (opts.transient) {
        if (!transientOpen) { transientOpen = true; applier.beginSwitching(); }
        // Drags keep history untouched; apply is rAF-batched; autosave/report wait for the commit.
        applier.schedule(draft, visible());
        emit();
        return true;
      }
      history.push(draft, { coalesceKey: opts.coalesceKey, label: opts.label });
      afterEdit();
      return true;
    },

    /** Close a drag: exactly one undo entry for the whole gesture. */
    commitTransient() {
      if (!transientOpen) return false;
      transientOpen = false;
      const cur = history.current();
      if (cur && hashOf(cur) !== hashOf(draft)) history.push(draft, { label: 'adjust' });
      applier.endSwitching();
      afterEdit({ persistNow: true });
      return true;
    },

    undo() {
      if (!draft) return false;
      commitIfTransient();
      const def = history.undo();
      if (!def) return false;
      draft = def;
      afterEdit();
      return true;
    },
    redo() {
      if (!draft) return false;
      commitIfTransient();
      const def = history.redo();
      if (!def) return false;
      draft = def;
      afterEdit();
      return true;
    },

    resetRole(mode, roleId) { return store.updateDraft((d) => editResetRole(d, mode, roleId), { label: `reset ${roleId}` }); },
    resetMode(mode) { return store.updateDraft((d) => editResetMode(d, mode), { label: `reset ${mode}` }); },
    resetDraft() { return store.updateDraft(() => production, { label: 'reset draft' }); },

    // ---- view state ----
    setEditingMode(mode) {
      const m = mode === 'dark' ? 'dark' : 'light';
      if (m === editingMode) return;
      editingMode = m;
      emit();
    },
    setPreviewMode(mode) {
      const m = mode === 'light' || mode === 'dark' || mode === 'system' ? mode : null;
      if (m === previewMode) return;
      previewMode = m;
      if (prefStore) prefStore.setPreviewOverride(m);
      emit();
    },
    setCompare(which) {
      const c = which === 'production' ? 'production' : 'draft';
      if (c === compare) return;
      compare = c;
      if (draft) applier.schedule(draft, visible());
      emit();
    },

    // ---- cross-tab resolution ----
    /** "Load other draft": adopt the other tab's saved draft; your version stays reachable via undo. */
    acceptExternal() {
      if (!pendingExternal || !draft) return false;
      const parsed = pendingExternal;
      commitIfTransient();
      pendingExternal = null; externalChange = false;
      draft = parsed.definition;
      savedAt = parsed.savedAt;
      savedHash = parsed.savedHash || hashOf(draft);
      history.push(draft, { label: 'load other draft' });
      afterEdit();
      return true;
    },
    /** "Keep mine": dismiss the notice; the other tab's payload is remembered so it does not re-flag. */
    keepMine() {
      pendingExternal = null; externalChange = false;
      emit();
    },

    // ---- io ----
    exportBundle() { return draft ? buildExportBundle(draft) : null; },
    importText(text, { apply = true } = {}) {
      const result = importThemeJson(text);
      if (result.ok && result.definition && apply) store.updateDraft(() => result.definition, { label: 'import' });
      return result;
    },

    // ---- test hooks ----
    _applier: applier,
    _flushAutosave: flushAutosave,
  };

  function onPageHide() {
    flushAutosave();
    applier.flush();
  }

  snapshot = buildSnapshot();
  ready = true;
  return store;
}

let singleton = null;
export function getDraftStore() {
  if (!singleton) singleton = createDraftStore({ prefStore: typeof window === 'undefined' ? null : getPrefStore() });
  return singleton;
}
export function _resetDraftStoreForTests() {
  if (singleton) singleton.stop();
  singleton = null;
}
