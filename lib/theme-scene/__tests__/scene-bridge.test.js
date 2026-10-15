import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneBridge, sceneBridge } from '../scene-bridge.js';
import { SCENE_IDENTITY } from '../apply-scene.js';

const scene = (hueShift, extra = {}) => ({ ...SCENE_IDENTITY, hueShift, ...extra });
const pair = (l, d) => ({ light: scene(l), dark: scene(d) });

test('defaults to the identity scene before anything is set', () => {
  const b = createSceneBridge();
  assert.equal(b.get(), SCENE_IDENTITY);
  assert.equal(b.get('light'), SCENE_IDENTITY);
  assert.equal(b.get('dark'), SCENE_IDENTITY);
  assert.equal(b.getMode(), 'light');
});

test('get("current") follows the mode; get("light"|"dark") is independent of the mode', () => {
  const b = createSceneBridge();
  const prod = pair(0.1, 0.2);
  b.setProduction(prod);
  assert.equal(b.get('current'), prod.light);
  b.setMode('dark');
  assert.equal(b.get('current'), prod.dark);
  assert.equal(b.get('light'), prod.light, 'light is still light when the mode is dark');
  assert.equal(b.get('dark'), prod.dark);
  b.setMode('light');
  assert.equal(b.get('dark'), prod.dark, 'dark is still dark when the mode is light');
});

test('draft wins over production per mode and clears back to production', () => {
  const b = createSceneBridge();
  const prod = pair(0.1, 0.2);
  const draft = pair(0.3, 0.4);
  b.setProduction(prod);
  b.setDraft(draft);
  assert.equal(b.get('light'), draft.light);
  assert.equal(b.get('dark'), draft.dark);
  assert.equal(b.hasDraft(), true);
  b.setDraft(null);
  assert.equal(b.get('light'), prod.light);
  assert.equal(b.hasDraft(), false);
});

test('a partial draft only overrides the palettes it carries', () => {
  const b = createSceneBridge();
  const prod = pair(0.1, 0.2);
  b.setProduction(prod);
  const light = scene(0.5);
  b.setDraft({ light });
  assert.equal(b.get('light'), light);
  assert.equal(b.get('dark'), prod.dark);
});

test('subscribe notifies on effective changes only and supports unsubscribe', () => {
  const b = createSceneBridge();
  let calls = 0;
  const off = b.subscribe(() => { calls += 1; });
  const prod = pair(0, 0);
  b.setProduction(prod);
  assert.equal(calls, 1);
  b.setProduction(prod);
  assert.equal(calls, 1, 'same object: no notification');
  b.setMode('dark');
  assert.equal(calls, 2);
  b.setMode('dark');
  assert.equal(calls, 2, 'same mode: no notification');
  b.setDraft(pair(1, 1));
  assert.equal(calls, 3);
  b.setDraft(null);
  assert.equal(calls, 4);
  b.setDraft(null);
  assert.equal(calls, 4);
  off();
  b.setMode('light');
  assert.equal(calls, 4, 'unsubscribed');
});

test('a throwing listener does not block the others', () => {
  const b = createSceneBridge();
  let ok = 0;
  b.subscribe(() => { throw new Error('boom'); });
  b.subscribe(() => { ok += 1; });
  b.setMode('dark');
  assert.equal(ok, 1);
});

test('garbage input is ignored, never thrown on', () => {
  const b = createSceneBridge();
  b.setProduction('nope');
  b.setProduction(42);
  b.setDraft([].length ? null : 'x');
  b.setMode('sepia');
  assert.equal(b.getMode(), 'light');
  assert.equal(b.get('dark'), SCENE_IDENTITY);
  assert.equal(b.subscribe(null)(), undefined);
});

test('getForSceneMode / resolveModeFor map sceneMode to the right palette', () => {
  const b = createSceneBridge();
  const prod = pair(0.1, 0.2);
  b.setProduction(prod);
  b.setMode('dark');
  assert.equal(b.getForSceneMode('theme'), prod.dark);
  assert.equal(b.getForSceneMode('light'), prod.light);
  assert.equal(b.getForSceneMode('dark'), prod.dark);
  assert.equal(b.getForSceneMode('off'), null);
  assert.equal(b.getForSceneMode('wat'), null);
  assert.equal(b.resolveModeFor('theme'), 'dark');
  assert.equal(b.resolveModeFor('light'), 'light');
  assert.equal(b.resolveModeFor('off'), null);
});

test('the exported singleton is shared through globalThis', () => {
  assert.equal(globalThis[Symbol.for('hitloop.themeSceneBridge.v1')], sceneBridge);
  assert.equal(typeof sceneBridge.setProduction, 'function');
});

test('reset() forgets state and tells subscribers', () => {
  const b = createSceneBridge();
  b.setProduction(pair(0.1, 0.2));
  b.setMode('dark');
  let calls = 0;
  b.subscribe(() => { calls += 1; });
  b.reset();
  assert.equal(calls, 1);
  assert.equal(b.get('dark'), SCENE_IDENTITY);
});
