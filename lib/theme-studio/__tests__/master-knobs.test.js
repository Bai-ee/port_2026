// Master v2: the knob table (view-model) and the edit-session / real-store gesture paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftStore } from '../../theme-runtime/draft-store.js';
import {
  createFakeDocument, createFakeStorage, createManualScheduler, createFakeSceneBridge,
} from '../../theme-runtime/__tests__/helpers.js';
import { createEditSession } from '../edit-session.js';
import { createStudioStore } from '../store-adapter.js';
import { createBaseline, resolveBoth, normalizeDefinition } from '../../theme/index.js';
import { MASTER_KNOBS, masterKnob, masterKnobModels, masterAtDefaults } from '../view-models.js';
import { SECTION_IDS, initialUiState } from '../ui-state.js';

const canon = (d) => JSON.stringify(normalizeDefinition(d));

function make() {
  const scheduler = createManualScheduler();
  const raw = createDraftStore({
    document: createFakeDocument(), storage: createFakeStorage(), scheduler, win: null, ChannelCtor: null,
    getSceneBridge: () => createFakeSceneBridge(), prefStore: { setPreviewOverride() {} },
    production: createBaseline(), // reset* returns to the baseline, not production
  });
  const store = createStudioStore(raw);
  store.startDraft();
  return { store, session: createEditSession(store), scheduler };
}

test('knob table: stable ids, unique, every knob has bounds and a default inside them', () => {
  assert.deepEqual(MASTER_KNOBS.map((k) => k.id), [
    'hue', 'intensity', 'chroma', 'lightness', 'contrast', 'dark-depth', 'warmth-hue', 'warmth-strength', 'hue-spread',
  ].sort((a, b) => MASTER_KNOBS.findIndex((k) => k.id === a) - MASTER_KNOBS.findIndex((k) => k.id === b)));
  assert.equal(new Set(MASTER_KNOBS.map((k) => k.domId)).size, MASTER_KNOBS.length);
  for (const k of MASTER_KNOBS) {
    assert.ok(k.min < k.max, k.id);
    assert.ok(k.def >= k.min && k.def <= k.max, `${k.id} default inside bounds`);
    assert.ok(k.fields.length > 0, k.id);
    if (!['hue', 'intensity'].includes(k.id)) assert.match(k.domId, /^ts-master-[a-z-]+-slider$/);
  }
  assert.equal(masterKnob('hue').domId, 'theme-studio-master-hue', 'e2e id kept');
  assert.equal(masterKnob('intensity').domId, 'theme-studio-master-intensity', 'e2e id kept');
});

test('on the baseline every knob reads its default, so Reset is disabled everywhere', () => {
  const d = createBaseline();
  for (const m of ['light', 'dark']) {
    assert.equal(masterAtDefaults(d, m), true);
    for (const k of masterKnobModels(d, m)) assert.equal(k.atDefault, true, `${m}.${k.id}`);
  }
});

test('each knob write is visible in its read, at the declared fields, and reset restores the baseline', () => {
  const base = createBaseline();
  const probe = { hue: 200, intensity: 0.7, chroma: 1.4, lightness: 0.05, contrast: 1.25, 'dark-depth': 0.06, 'warmth-hue': 200, 'warmth-strength': 1.5, 'hue-spread': 0.6 };
  for (const k of MASTER_KNOBS) {
    const moved = k.write(base, probe[k.id], 'light');
    assert.notEqual(moved, base, `${k.id} changed the draft`);
    assert.ok(Math.abs(k.read(moved, 'light') - probe[k.id]) < 0.011, `${k.id} reads back`);
    assert.equal(masterKnobModels(moved, 'light').find((x) => x.id === k.id).atDefault, false);
    const back = k.write(moved, k.def, 'light');
    assert.equal(canon(back), canon(base), `${k.id} reset restores the baseline`);
  }
});

test('knobs do not disturb one another', () => {
  let d = createBaseline();
  for (const k of MASTER_KNOBS) d = k.write(d, k.id === 'hue' ? 10 : k.def, 'light');
  const hueOnly = MASTER_KNOBS.find((k) => k.id === 'hue').write(createBaseline(), 10, 'light');
  assert.equal(canon(d), canon(hueOnly));
});

test('moved knobs resolve to a different theme, defaults to the identical one', () => {
  const base = createBaseline();
  const moved = masterKnob('contrast').write(base, 1.4, 'light');
  assert.notDeepEqual(resolveBoth(moved).light.tokens, resolveBoth(base).light.tokens);
  assert.deepEqual(resolveBoth(masterKnob('contrast').write(moved, 1, 'light')).light.tokens, resolveBoth(base).light.tokens);
});

test('a 25-frame drag on every new knob is exactly one undo entry; undo restores, redo reapplies', () => {
  for (const k of MASTER_KNOBS) {
    const { store, session } = make();
    const start = k.read(store.getSnapshot().draft, 'light');
    const target = k.id === 'hue' || k.id === 'warmth-hue' ? 120 : k.max * 0.8 + k.min * 0.2;
    for (let i = 1; i <= 25; i++) {
      const v = start + ((target - start) * i) / 25;
      session.apply((d) => k.write(d, v, 'light'), { kind: 'drag', label: k.label });
    }
    session.end();
    const after = canon(store.getSnapshot().draft);
    assert.equal(store.getSnapshot().canUndo, true, k.id);
    store.undo();
    assert.equal(store.getSnapshot().canUndo, false, `${k.id}: one entry only`);
    assert.equal(canon(store.getSnapshot().draft), canon(createBaseline()), `${k.id}: undo restores`);
    store.redo();
    assert.equal(canon(store.getSnapshot().draft), after, `${k.id}: redo reapplies`);
  }
});

test('keyboard presses on a new knob coalesce into one undo entry; Reset is its own entry', () => {
  const { store, session, scheduler } = make();
  const k = masterKnob('contrast');
  for (let i = 1; i <= 4; i++) {
    session.apply((d) => k.write(d, 1 + i * 0.01, 'light'), { kind: 'key', coalesceKey: 'master-contrast' });
    scheduler.advance(100);
  }
  assert.equal(k.read(store.getSnapshot().draft, 'light'), 1.04);
  session.apply((d) => k.write(d, k.def, 'light'), { kind: 'set', label: 'Reset Contrast' });
  assert.equal(k.read(store.getSnapshot().draft, 'light'), 1);
  store.undo();
  assert.equal(k.read(store.getSnapshot().draft, 'light'), 1.04, 'undo of Reset returns to the keyboard result');
  store.undo();
  assert.equal(k.read(store.getSnapshot().draft, 'light'), 1, 'one more undo clears the whole key run');
});

test('the draft store keeps the new fields through its own normalisation', () => {
  const { store, session } = make();
  session.apply((d) => masterKnob('dark-depth').write(d, 0.07, 'light'), { kind: 'set', label: 'Dark depth' });
  const d = store.getSnapshot().draft;
  assert.equal(d.modes.dark.settings.surfaceDepth, 0.07);
  assert.ok(d.modes.dark.roles.page.base.l < createBaseline().modes.dark.roles.page.base.l);
  assert.ok(resolveBoth(d).dark.roles.page.oklch.l < resolveBoth(createBaseline()).dark.roles.page.oklch.l);
});

test('Master is the second inspector section in the UI state ordering and starts open', () => {
  assert.equal(SECTION_IDS.includes('master'), true);
  assert.equal(initialUiState().openSections.master, true);
});
