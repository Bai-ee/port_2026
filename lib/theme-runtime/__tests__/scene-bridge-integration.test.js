// Runtime <-> WS4 scene bridge (contract §9.2). Skipped when the bridge module is absent so this
// workstream's tests never depend on it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftStore } from '../draft-store.js';
import { syncSiteDraft } from '../site-draft.js';
import { createSafeStorage } from '../storage.js';
import { setSceneBridge, getSceneBridge, setStudioSessionActive } from '../registry.js';
import { setMasterHue } from '../../theme/edit.js';
import { STORAGE_KEYS } from '../../theme/constants.js';
import runtime from '../../theme/production/resolved.runtime.generated.js';
import { createFakeDocument, createFakeStorage, createManualScheduler } from './helpers.js';

let sceneBridge = null;
try { ({ sceneBridge } = await import('../../theme-scene/scene-bridge.js')); } catch { sceneBridge = null; }
const maybe = sceneBridge ? test : test.skip;

maybe('draft store drives the real bridge: setDraft on apply, null on discard; get() follows', () => {
  sceneBridge.reset();
  sceneBridge.setProduction({ light: runtime.light.scene, dark: runtime.dark.scene });
  sceneBridge.setMode('light');
  setSceneBridge(sceneBridge);
  const scheduler = createManualScheduler();
  const store = createDraftStore({
    document: createFakeDocument(), storage: createFakeStorage(), scheduler, win: null, ChannelCtor: null,
  });
  let changes = 0;
  const off = sceneBridge.subscribe(() => { changes += 1; });
  try {
    store.startDraft();
    assert.equal(sceneBridge.hasDraft(), true);
    store.updateDraft((d) => setMasterHue(d, 300));
    scheduler.frame();
    const live = sceneBridge.get('light');
    assert.notEqual(live.hueShift, runtime.light.scene.hueShift, 'follow scene shifts with the master hue');
    assert.ok(changes > 0);
    store.setCompare('production');
    scheduler.frame();
    assert.equal(sceneBridge.hasDraft(), false, 'compare=production shows the production scene');
    store.setCompare('draft');
    scheduler.frame();
    assert.equal(sceneBridge.hasDraft(), true);
    store.discardDraft();
    assert.equal(sceneBridge.hasDraft(), false);
    assert.equal(sceneBridge.get('light').hueShift, runtime.light.scene.hueShift);
  } finally {
    off();
    setStudioSessionActive(false);
    setSceneBridge(null);
    sceneBridge.reset();
  }
});

maybe('syncSiteDraft rehydrates the real bridge from stored draft scenes, and clears it', () => {
  sceneBridge.reset();
  const scenes = { light: { ...runtime.light.scene, hueShift: 0.2 }, dark: { ...runtime.dark.scene, hueShift: 0.2 } };
  const storage = createFakeStorage({
    [STORAGE_KEYS.active]: '1',
    [STORAGE_KEYS.draftCss]: '/* theme-draft v1 hash:x */\n:root{}',
    [STORAGE_KEYS.draftScene]: JSON.stringify(scenes),
  });
  const doc = createFakeDocument();
  setSceneBridge(sceneBridge);
  try {
    syncSiteDraft(createSafeStorage(storage), { document: doc });
    assert.equal(sceneBridge.get('light').hueShift, 0.2);
    storage.map.delete(STORAGE_KEYS.active);
    syncSiteDraft(createSafeStorage(storage), { document: doc });
    assert.equal(sceneBridge.hasDraft(), false);
  } finally {
    setSceneBridge(null);
    sceneBridge.reset();
  }
  assert.equal(getSceneBridge(), null);
});
