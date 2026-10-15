import test from 'node:test';
import assert from 'node:assert/strict';
import { syncSiteDraft, isValidScenes } from '../site-draft.js';
import { createSafeStorage } from '../storage.js';
import { setStudioSessionActive } from '../registry.js';
import { STORAGE_KEYS, DRAFT_CSS_MARKER } from '../../theme/constants.js';
import runtime from '../../theme/production/resolved.runtime.generated.js';
import { createFakeDocument, createFakeStorage, createFakeSceneBridge } from './helpers.js';

const scenes = { light: runtime.light.scene, dark: runtime.dark.scene };
const css = `${DRAFT_CSS_MARKER}hash:deadbeef */\n:root{}`;

function setup(initial) {
  const doc = createFakeDocument();
  const storage = createFakeStorage(initial);
  const bridge = createFakeSceneBridge();
  const safe = createSafeStorage(storage);
  return { doc, storage, bridge, safe, run: () => syncSiteDraft(safe, { document: doc, getSceneBridge: () => bridge }) };
}

test.afterEach(() => setStudioSessionActive(false));

test('generated production scenes satisfy the scene shape check', () => {
  assert.equal(isValidScenes(scenes), true);
  assert.equal(isValidScenes({ light: {}, dark: {} }), false);
  assert.equal(isValidScenes(null), false);
});

test('active flag + css + scene => style injected and bridge draft set', () => {
  const t = setup({ [STORAGE_KEYS.active]: '1', [STORAGE_KEYS.draftCss]: css, [STORAGE_KEYS.draftScene]: JSON.stringify(scenes) });
  assert.equal(t.run(), 'applied');
  assert.equal(t.doc.getElementById('theme-draft-css').textContent, css);
  assert.deepEqual(t.bridge.draft, scenes);
});

test('css without the marker is never injected', () => {
  const t = setup({ [STORAGE_KEYS.active]: '1', [STORAGE_KEYS.draftCss]: ':root{--t-page:red}' });
  t.run();
  assert.equal(t.doc.getElementById('theme-draft-css'), null);
});

test('malformed scene JSON => bridge draft cleared, no throw', () => {
  const t = setup({ [STORAGE_KEYS.active]: '1', [STORAGE_KEYS.draftCss]: css, [STORAGE_KEYS.draftScene]: '{oops' });
  assert.doesNotThrow(() => t.run());
  assert.equal(t.bridge.draft, null);
});

test('another tab reverts the applied draft => style removed, bridge draft cleared', () => {
  const t = setup({ [STORAGE_KEYS.active]: '1', [STORAGE_KEYS.draftCss]: css, [STORAGE_KEYS.draftScene]: JSON.stringify(scenes) });
  t.run();
  t.storage.map.delete(STORAGE_KEYS.active);
  assert.equal(t.run(), 'cleared');
  assert.equal(t.doc.getElementById('theme-draft-css'), null);
  assert.equal(t.bridge.draft, null);
});

test('an in-memory Studio draft in this tab is never clobbered by site-wide state', () => {
  const t = setup({ [STORAGE_KEYS.active]: '1', [STORAGE_KEYS.draftCss]: css });
  const own = t.doc.createElement('style'); own.id = 'theme-draft-css'; own.textContent = `${DRAFT_CSS_MARKER}mine */`;
  t.doc.head.appendChild(own);
  setStudioSessionActive(true);
  assert.equal(t.run(), 'skipped');
  assert.equal(own.textContent, `${DRAFT_CSS_MARKER}mine */`);
});

test('blocked storage => treated as not active, nothing throws', () => {
  const t = setup({});
  t.storage.failGet = true;
  assert.doesNotThrow(() => t.run());
});
