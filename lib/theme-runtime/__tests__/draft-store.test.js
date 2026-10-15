import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftStore, parseStoredDraft, AUTOSAVE_MS, REPORT_MS } from '../draft-store.js';
import { PRODUCTION_DEFINITION } from '../production.js';
import { setMasterHue, setIntensity, setRoleCustom, setRoleBase } from '../../theme/edit.js';
import { hashDefinition } from '../../theme/validate.js';
import { exportThemeJson } from '../../theme/export.js';
import { STORAGE_KEYS, DRAFT_CSS_MARKER } from '../../theme/constants.js';
import { setStudioSessionActive } from '../registry.js';
import runtime from '../../theme/production/resolved.runtime.generated.js';
import { createFakeDocument, createFakeStorage, createManualScheduler, createFakeSceneBridge } from './helpers.js';

function make(over = {}) {
  const doc = over.document || createFakeDocument();
  const storage = over.storage || createFakeStorage();
  const scheduler = over.scheduler || createManualScheduler();
  const bridge = over.bridge || createFakeSceneBridge();
  const prefCalls = [];
  const store = createDraftStore({
    document: doc, storage, scheduler, win: null, ChannelCtor: null,
    getSceneBridge: () => bridge,
    prefStore: { setPreviewOverride: (v) => prefCalls.push(v) },
    ...over.options,
  });
  return { store, doc, storage, scheduler, bridge, prefCalls };
}

const hueOf = (store) => store.getSnapshot().draft.master.hue;
const H = (def) => hashDefinition(def);

test('the checked-in production definition matches the generated runtime hash', () => {
  assert.equal(H(PRODUCTION_DEFINITION), runtime.hash);
});

test('startDraft() with nothing stored forks production: active, clean, resolved, applied to the page', () => {
  const { store, doc, bridge } = make();
  const r = store.startDraft();
  assert.deepEqual({ ok: r.ok, source: r.source }, { ok: true, source: 'production' });
  const s = store.getSnapshot();
  assert.equal(s.active, true);
  assert.equal(s.dirty, false);
  assert.equal(s.differsFromProduction, false);
  assert.equal(s.canUndo, false);
  assert.ok(s.resolved && s.resolved.light && s.resolved.dark);
  assert.ok(doc.getElementById('theme-draft-css').textContent.startsWith(DRAFT_CSS_MARKER));
  assert.ok(bridge.draft && bridge.draft.light);
});

test('before startDraft the snapshot is inert', () => {
  const { store } = make();
  const s = store.getSnapshot();
  assert.equal(s.active, false);
  assert.equal(s.draft, null);
  assert.equal(s.resolved, null);
  assert.equal(s.dirty, false);
});

test('a pointer drag is ONE undo entry: 40 transient updates + commitTransient', () => {
  const { store, scheduler } = make();
  store.startDraft();
  const start = H(store.getSnapshot().draft);
  for (let hue = 1; hue <= 40; hue += 1) {
    store.updateDraft((d) => setMasterHue(d, hue), { transient: true });
  }
  assert.equal(store.getSnapshot().canUndo, true, 'transient state counts as undoable');
  assert.equal(hueOf(store), 40);
  store.commitTransient();
  scheduler.frame();
  assert.equal(hueOf(store), 40);
  assert.equal(store.undo(), true);
  assert.equal(H(store.getSnapshot().draft), start, 'ONE undo returns to the pre-drag state');
  assert.equal(store.getSnapshot().canUndo, false);
  assert.equal(store.redo(), true);
  assert.equal(hueOf(store), 40);
});

test('transient updates do not touch history or storage until commit', () => {
  const { store, storage, scheduler } = make();
  store.startDraft();
  store.updateDraft((d) => setMasterHue(d, 90), { transient: true });
  scheduler.advance(2000);
  assert.equal(storage.map.has(STORAGE_KEYS.draft), false, 'no autosave while a drag is open');
  store.commitTransient();
  assert.equal(storage.map.has(STORAGE_KEYS.draft), true, 'commitTransient flushes the autosave immediately');
});

test('a drag that ends where it started leaves no history entry', () => {
  const { store } = make();
  store.startDraft();
  const h0 = store.getSnapshot().draft.master.hue;
  store.updateDraft((d) => setMasterHue(d, 120), { transient: true });
  store.updateDraft((d) => setMasterHue(d, h0), { transient: true });
  store.commitTransient();
  assert.equal(store.getSnapshot().canUndo, false);
  assert.equal(store.getSnapshot().dirty, false);
});

test('a non-transient edit while a drag is open closes the drag first (two entries, in order)', () => {
  const { store } = make();
  store.startDraft();
  store.updateDraft((d) => setMasterHue(d, 50), { transient: true });
  store.updateDraft((d) => setIntensity(d, 0.5));
  assert.equal(store.undo(), true);
  assert.equal(hueOf(store), 50);
  assert.equal(store.undo(), true);
  assert.notEqual(hueOf(store), 50);
});

test('keyboard nudges coalesce within 400 ms into one entry', () => {
  const { store, scheduler } = make();
  store.startDraft();
  const start = H(store.getSnapshot().draft);
  for (let i = 1; i <= 5; i += 1) {
    store.updateDraft((d) => setMasterHue(d, 201 + i), { coalesceKey: 'master-hue' });
    scheduler.advance(100);
  }
  assert.equal(hueOf(store), 206);
  store.undo();
  assert.equal(H(store.getSnapshot().draft), start, 'one undo reverts the whole burst');
  assert.equal(store.getSnapshot().canUndo, false);
});

test('keyboard nudges separated by more than 400 ms are separate entries', () => {
  const { store, scheduler } = make();
  store.startDraft();
  store.updateDraft((d) => setMasterHue(d, 210), { coalesceKey: 'master-hue' });
  scheduler.advance(450);
  store.updateDraft((d) => setMasterHue(d, 211), { coalesceKey: 'master-hue' });
  store.undo();
  assert.equal(hueOf(store), 210);
  store.undo();
  assert.equal(hueOf(store), 201);
});

test('history cap: 100 undo steps', () => {
  const { store } = make();
  store.startDraft();
  for (let i = 1; i <= 130; i += 1) store.updateDraft((d) => setMasterHue(d, i + 0.5));
  let n = 0;
  while (store.undo()) n += 1;
  assert.equal(n, 100);
});

test('no-op updates (same object) are ignored', () => {
  const { store } = make();
  store.startDraft();
  assert.equal(store.updateDraft((d) => d), false);
  assert.equal(store.updateDraft(() => null), false);
  assert.equal(store.getSnapshot().canUndo, false);
});

test('undo/redo flags and edits after undo drop the redo branch', () => {
  const { store } = make();
  store.startDraft();
  store.updateDraft((d) => setMasterHue(d, 10));
  store.updateDraft((d) => setMasterHue(d, 20));
  store.undo();
  assert.equal(store.getSnapshot().canRedo, true);
  store.updateDraft((d) => setMasterHue(d, 30));
  assert.equal(store.getSnapshot().canRedo, false);
  assert.equal(store.redo(), false);
});

test('dirty and differsFromProduction track content, not edit count', () => {
  const { store } = make();
  store.startDraft();
  store.updateDraft((d) => setMasterHue(d, 10));
  assert.equal(store.getSnapshot().dirty, true);
  assert.equal(store.getSnapshot().differsFromProduction, true);
  store.undo();
  assert.equal(store.getSnapshot().dirty, false);
  assert.equal(store.getSnapshot().differsFromProduction, false);
});

test('resetRole / resetMode / resetDraft return to the baseline state through history', () => {
  const { store } = make();
  store.startDraft();
  store.updateDraft((d) => setRoleCustom(d, 'light', 'accent', { l: 0.6, c: 0.1, h: 300, a: 1 }));
  assert.equal(store.getSnapshot().differsFromProduction, true);
  store.resetRole('light', 'accent');
  assert.equal(store.getSnapshot().differsFromProduction, false);
  store.undo();
  assert.equal(store.getSnapshot().differsFromProduction, true, 'the reset itself is undoable');

  store.updateDraft((d) => setRoleBase(d, 'dark', 'surface', { l: 0.3 }));
  store.resetMode('dark');
  store.resetMode('light');
  store.resetRole('light', 'accent');
  assert.equal(store.getSnapshot().differsFromProduction, false);

  store.updateDraft((d) => setMasterHue(setIntensity(d, 1.2), 33));
  store.resetDraft();
  assert.equal(H(store.getSnapshot().draft), H(PRODUCTION_DEFINITION));
});

test('autosave is a trailing 400 ms debounce', () => {
  const { store, storage, scheduler } = make();
  store.startDraft();
  assert.equal(AUTOSAVE_MS, 400);
  store.updateDraft((d) => setMasterHue(d, 10));
  scheduler.advance(300);
  store.updateDraft((d) => setMasterHue(d, 11));
  scheduler.advance(300);
  assert.equal(storage.map.has(STORAGE_KEYS.draft), false, 'timer restarted by the second edit');
  scheduler.advance(150);
  const stored = parseStoredDraft(storage.map.get(STORAGE_KEYS.draft));
  assert.equal(stored.ok, true);
  assert.equal(stored.definition.master.hue, 11);
  assert.equal(stored.savedAt, null, 'autosave is not an explicit save');
});

test('draftCss / draftScene / active are written only while applied', () => {
  const { store, storage, scheduler } = make();
  store.startDraft();
  store.updateDraft((d) => setMasterHue(d, 10));
  scheduler.advance(500);
  assert.equal(storage.map.has(STORAGE_KEYS.active), false);
  assert.equal(storage.map.has(STORAGE_KEYS.draftCss), false);
  assert.equal(storage.map.has(STORAGE_KEYS.draftScene), false);

  store.setApplied(true);
  assert.equal(store.getSnapshot().applied, true);
  assert.equal(storage.map.get(STORAGE_KEYS.active), '1');
  assert.ok(storage.map.get(STORAGE_KEYS.draftCss).startsWith(DRAFT_CSS_MARKER), 'bootstrap marker present');
  const scenes = JSON.parse(storage.map.get(STORAGE_KEYS.draftScene));
  assert.ok(scenes.light && scenes.dark);

  store.updateDraft((d) => setMasterHue(d, 99));
  scheduler.advance(500);
  assert.match(storage.map.get(STORAGE_KEYS.draftCss), /hash:/);
  const after = parseStoredDraft(storage.map.get(STORAGE_KEYS.draft));
  assert.equal(after.definition.master.hue, 99);

  store.setApplied(false);
  assert.equal(storage.map.has(STORAGE_KEYS.active), false);
  assert.equal(storage.map.has(STORAGE_KEYS.draftCss), false);
  assert.equal(storage.map.has(STORAGE_KEYS.draftScene), false);
});

test('saveDraft: explicit checkpoint -> clean, savedAt set, survives a "reload"', () => {
  const { store, storage, scheduler } = make();
  store.startDraft();
  store.updateDraft((d) => setMasterHue(d, 10));
  const res = store.saveDraft();
  assert.equal(res.ok, true);
  assert.match(res.savedAt, /^\d{4}-\d\d-\d\dT/);
  assert.equal(store.getSnapshot().dirty, false);
  assert.equal(store.getSnapshot().savedAt, res.savedAt);
  store.updateDraft((d) => setMasterHue(d, 11));
  scheduler.advance(500);
  assert.equal(store.getSnapshot().dirty, true);

  // reload: new store, same storage
  const again = make({ storage, scheduler: createManualScheduler() });
  const r = again.store.startDraft();
  assert.equal(r.source, 'saved');
  assert.equal(again.store.getSnapshot().draft.master.hue, 11, 'autosaved work is restored');
  assert.equal(again.store.getSnapshot().dirty, true, 'unsaved indicator survives the reload');
  assert.equal(again.store.getSnapshot().savedAt, res.savedAt);
});

test('saveDraft without a draft reports an error instead of throwing', () => {
  const { store } = make();
  assert.equal(store.saveDraft().ok, false);
});

test('discardDraft removes everything: storage keys, page style, bridge draft, preview override', () => {
  const { store, storage, doc, bridge, scheduler, prefCalls } = make();
  store.startDraft();
  store.setPreviewMode('dark');
  store.updateDraft((d) => setMasterHue(d, 10));
  store.setApplied(true);
  store.saveDraft();
  scheduler.advance(500);
  store.discardDraft();
  const s = store.getSnapshot();
  assert.equal(s.active, false);
  assert.equal(s.applied, false);
  assert.equal(s.draft, null);
  for (const k of [STORAGE_KEYS.draft, STORAGE_KEYS.active, STORAGE_KEYS.draftCss, STORAGE_KEYS.draftScene]) {
    assert.equal(storage.map.has(k), false, k);
  }
  assert.equal(doc.getElementById('theme-draft-css'), null);
  assert.equal(bridge.draft, null);
  assert.equal(prefCalls.at(-1), null, 'preview override cleared');
  assert.equal(scheduler.pendingTimers, 0, 'no stray timers after discard');
});

test('apply pipeline: edits in one frame => one apply; resolved updates in the snapshot', () => {
  const { store, scheduler } = make();
  store.startDraft();
  const applier = store._applier;
  const before = applier.applyCount;
  for (let i = 0; i < 25; i += 1) store.updateDraft((d) => setMasterHue(d, i + 0.5), { transient: true });
  scheduler.frame();
  assert.equal(applier.applyCount - before, 1);
  assert.equal(store.getSnapshot().resolved.light.meta.masterHue, 24.5);
  store.commitTransient();
});

test('data-theme-switching is held during a drag and released two frames after commit', () => {
  const { store, scheduler, doc } = make();
  store.startDraft();
  store.updateDraft((d) => setMasterHue(d, 50), { transient: true });
  assert.equal(doc.documentElement.hasAttribute('data-theme-switching'), true);
  scheduler.frame(); scheduler.frame();
  assert.equal(doc.documentElement.hasAttribute('data-theme-switching'), true);
  store.commitTransient();
  scheduler.frame(); scheduler.frame();
  assert.equal(doc.documentElement.hasAttribute('data-theme-switching'), false);
});

test('report is debounced 150 ms, stale-while-revalidate, and never computed during a drag', () => {
  const { store, scheduler } = make();
  store.startDraft();
  assert.equal(REPORT_MS, 150);
  assert.equal(store.getSnapshot().report, null);
  assert.equal(store.getSnapshot().reportPending, true);
  scheduler.advance(160);
  const first = store.getSnapshot().report;
  assert.ok(first && first.modes && first.summary);
  assert.equal(store.getSnapshot().reportPending, false);

  store.updateDraft((d) => setMasterHue(d, 10), { transient: true });
  scheduler.advance(1000);
  assert.equal(store.getSnapshot().report, first, 'no report work while dragging');
  store.commitTransient();
  assert.equal(store.getSnapshot().reportPending, true);
  scheduler.advance(160);
  assert.notEqual(store.getSnapshot().report, first);
});

test('compare=production shows production on the page while the draft keeps resolving; draft restores it', () => {
  const { store, scheduler, doc, bridge } = make();
  store.startDraft();
  store.updateDraft((d) => setMasterHue(d, 10));
  scheduler.frame();
  assert.ok(doc.getElementById('theme-draft-css'));
  store.setCompare('production');
  scheduler.frame();
  assert.equal(doc.getElementById('theme-draft-css'), null);
  assert.equal(bridge.draft, null);
  store.updateDraft((d) => setMasterHue(d, 20));
  scheduler.frame();
  assert.equal(doc.getElementById('theme-draft-css'), null, 'edits while comparing do not leak onto the page');
  assert.equal(store.getSnapshot().resolved.light.meta.masterHue, 20);
  store.setCompare('draft');
  scheduler.frame();
  assert.ok(doc.getElementById('theme-draft-css'));
});

test('view state: editing mode, preview mode (forwarded to the pref store)', () => {
  const { store, prefCalls } = make();
  store.startDraft();
  store.setEditingMode('dark');
  assert.equal(store.getSnapshot().editingMode, 'dark');
  store.setPreviewMode('system');
  assert.equal(store.getSnapshot().previewMode, 'system');
  store.setPreviewMode('bogus');
  assert.equal(store.getSnapshot().previewMode, null);
  assert.deepEqual(prefCalls, ['system', null]);
});

test('importText: invalid JSON changes nothing; valid JSON replaces the draft as ONE undo entry', () => {
  const { store } = make();
  store.startDraft();
  const bad = store.importText('{nope');
  assert.equal(bad.ok, false);
  assert.equal(store.getSnapshot().canUndo, false);

  const imported = exportThemeJson(setMasterHue(PRODUCTION_DEFINITION, 123));
  const ok = store.importText(imported);
  assert.equal(ok.ok, true);
  assert.equal(hueOf(store), 123);
  store.undo();
  assert.equal(hueOf(store), 201);

  const preview = store.importText(imported, { apply: false });
  assert.equal(preview.ok, true);
  assert.equal(hueOf(store), 201, 'apply:false only validates');
});

test('exportBundle returns the four artefacts for the current draft, null without one', () => {
  const { store } = make();
  assert.equal(store.exportBundle(), null);
  store.startDraft();
  store.updateDraft((d) => setMasterHue(d, 77));
  const b = store.exportBundle();
  assert.ok(b.json && b.css && b.guideMarkdown && b.reportJson);
  assert.match(b.status, /^(draft|validated)$/);
  assert.match(b.json, /"hue": 77/);
});

test('startDraft(definition) validates: garbage is rejected, valid starts clean', () => {
  const { store } = make();
  assert.equal(store.startDraft({ nope: 1 }).ok, false);
  assert.equal(store.getSnapshot().active, false);
  const r = store.startDraft(setMasterHue(PRODUCTION_DEFINITION, 5));
  assert.equal(r.ok, true);
  assert.equal(store.getSnapshot().dirty, false);
  assert.equal(store.getSnapshot().differsFromProduction, true);
});

test('updateDraft without a session starts one implicitly', () => {
  const { store } = make();
  assert.equal(store.updateDraft((d) => setMasterHue(d, 12)), true);
  assert.equal(store.getSnapshot().active, true);
  assert.equal(hueOf(store), 12);
});

test('loadSaved: nothing stored => found:false; corrupt storage is ignored', () => {
  const { store, storage } = make();
  assert.deepEqual(store.loadSaved(), { ok: true, found: false });
  storage.map.set(STORAGE_KEYS.draft, '{not json');
  assert.equal(store.loadSaved().found, false);
  storage.map.set(STORAGE_KEYS.draft, JSON.stringify({ v: 1, definition: { schema: 'wrong' } }));
  assert.equal(store.loadSaved().found, false);
});

test('listeners are notified synchronously on edits; subscribe returns an unsubscribe', () => {
  const { store } = make();
  store.startDraft();
  let n = 0;
  const off = store.subscribe(() => { n += 1; });
  store.updateDraft((d) => setMasterHue(d, 10));
  assert.ok(n >= 1);
  off();
  const before = n;
  store.updateDraft((d) => setMasterHue(d, 11));
  assert.equal(n, before);
});

test('the Studio session flag is set while a draft exists (and cleared on discard)', async () => {
  const reg = await import('../registry.js');
  const { store } = make();
  store.startDraft();
  assert.equal(reg.isStudioSessionActive(), true);
  store.discardDraft();
  assert.equal(reg.isStudioSessionActive(), false);
  setStudioSessionActive(false);
});
