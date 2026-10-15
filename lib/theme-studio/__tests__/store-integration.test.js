// The Studio's edit session driving the REAL WS2 draft store (injectable doubles).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftStore } from '../../theme-runtime/draft-store.js';
import {
  createFakeDocument, createFakeStorage, createManualScheduler, createFakeSceneBridge,
} from '../../theme-runtime/__tests__/helpers.js';
import { createEditSession } from '../edit-session.js';
import { createStudioStore } from '../store-adapter.js';
import { setMasterHue, setIntensity, setRoleCustom, setLocked, resolveBoth } from '../../theme/index.js';
import {
  applySuggestion, suggestionView, a11yByRole, roleA11y,
} from '../view-models.js';
import { applyRoleAction } from '../role-state.js';

function make() {
  const scheduler = createManualScheduler();
  const raw = createDraftStore({
    document: createFakeDocument(),
    storage: createFakeStorage(),
    scheduler,
    win: null,
    ChannelCtor: null,
    getSceneBridge: () => createFakeSceneBridge(),
    prefStore: { setPreviewOverride() {} },
  });
  const store = createStudioStore(raw);
  store.startDraft();
  return { store, session: createEditSession(store), scheduler };
}

test('a 20-event drag then release is exactly one undo step in the real store', () => {
  const { store, session } = make();
  const start = store.getSnapshot().draft.master.hue;
  for (let h = 1; h <= 20; h++) session.apply((d) => setMasterHue(d, start + h * 5), { kind: 'drag', label: 'Master hue' });
  assert.equal(store.getSnapshot().draft.master.hue, start + 100);
  session.end();
  assert.equal(store.getSnapshot().canUndo, true);
  store.undo();
  assert.equal(store.getSnapshot().draft.master.hue, start);
  assert.equal(store.getSnapshot().canUndo, false, 'one entry only');
  store.redo();
  assert.equal(store.getSnapshot().draft.master.hue, start + 100);
});

test('keyboard nudges within 400 ms merge into one undo step', () => {
  const { store, session, scheduler } = make();
  const start = store.getSnapshot().draft.master.hue;
  for (let i = 1; i <= 3; i++) { session.apply((d) => setIntensity(d, 1 - i * 0.01), { kind: 'key', coalesceKey: 'master-intensity' }); scheduler.advance(100); }
  store.undo();
  assert.equal(store.getSnapshot().draft.master.intensity, 1);
  assert.equal(store.getSnapshot().draft.master.hue, start);
});

test('suggestions via the store report: locked roles are never rewritten', () => {
  const scheduler = createManualScheduler();
  const raw = createDraftStore({
    document: createFakeDocument(), storage: createFakeStorage(), scheduler, win: null, ChannelCtor: null,
    getSceneBridge: () => createFakeSceneBridge(), prefStore: { setPreviewOverride() {} },
  });
  const store = createStudioStore(raw);
  const session = createEditSession(store);
  store.startDraft();
  session.apply((d) => applyRoleAction(d, 'light', 'on-solid', 'lock'), { kind: 'set' });
  scheduler.advance(300);
  const snap = store.getSnapshot();
  assert.ok(snap.report, 'report is built after the debounce');
  const res = snap.report.modes.light.results.find((r) => r.id === 'on-solid@success-solid');
  const lockedBefore = JSON.stringify(snap.draft.modes.light.roles['on-solid']);
  const view = suggestionView(res, snap.draft, 'light');
  assert.equal(view.role, 'success-solid');
  const pair = snap.resolved || resolveBoth(snap.draft);
  session.apply((d) => applySuggestion(d, pair.light, 'light', res.suggestion), { kind: 'set', label: 'apply' });
  const after = store.getSnapshot().draft;
  assert.equal(JSON.stringify(after.modes.light.roles['on-solid']), lockedBefore);
  assert.equal(after.modes.light.roles['success-solid'].link, 'custom');
  scheduler.advance(300);
  const badge = roleA11y(a11yByRole(store.getSnapshot().report.modes.light), 'on-solid');
  assert.ok(badge.text.length > 0);
  store.undo();
  assert.equal(store.getSnapshot().draft.modes.light.roles['success-solid'].link, 'auto');
});

test('master moves leave custom and locked roles alone in the real store', () => {
  const { store, session } = make();
  session.apply((d) => setRoleCustom(d, 'light', 'accent', { l: 0.7, c: 0.1, h: 10, a: 1 }), { kind: 'set' });
  session.apply((d) => setLocked(d, 'dark', 'support-1', true), { kind: 'set' });
  const before = store.getSnapshot().draft;
  session.apply((d) => setMasterHue(d, 300), { kind: 'drag' });
  session.end();
  const after = store.getSnapshot().draft;
  assert.deepEqual(after.modes.light.roles.accent, before.modes.light.roles.accent);
  assert.deepEqual(after.modes.dark.roles['support-1'], before.modes.dark.roles['support-1']);
});
