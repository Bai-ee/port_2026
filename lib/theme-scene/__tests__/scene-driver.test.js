import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneDriver, bindDriver, syncDriver } from '../scene-driver.js';
import { createSceneBridge } from '../scene-bridge.js';
import { SCENE_IDENTITY } from '../apply-scene.js';

const scene = (extra) => ({ ...SCENE_IDENTITY, ...extra });
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('first target is adopted immediately (no ease-in from identity on mount)', () => {
  const d = createSceneDriver();
  d.setTarget(scene({ hueShift: 0.2, background: '#0f0e0a', opacityMul: 1.5 }), 'dark');
  assert.equal(d.state.hueShift, 0.2);
  assert.equal(d.state.opacityMul, 1.5);
  near(d.state.backgroundR, 0x0f / 255);
  assert.equal(d.state.ready, true);
});

test('step() eases toward a new target with the exponential smoother and then settles exactly', () => {
  const d = createSceneDriver();
  d.setTarget(scene({ saturationMul: 1 }), 'light');
  d.step(0, 10);
  d.setTarget(scene({ saturationMul: 0.5 }), 'light');
  d.step(1 / 60, 10);
  const expected = 1 + (0.5 - 1) * (1 - Math.exp(-(1 / 60) * 10));
  near(d.state.saturationMul, expected, 1e-9);
  assert.ok(d.state.saturationMul > 0.5 && d.state.saturationMul < 1);
  for (let i = 2; i < 600; i += 1) d.step(i / 60, 10);
  assert.equal(d.state.saturationMul, 0.5, 'settles exactly, no endless tiny residue');
});

test('step() is idempotent within a frame (several consumers may call it)', () => {
  const d = createSceneDriver();
  d.setTarget(scene({ lightnessDelta: 0 }), 'light');
  d.step(0, 10);
  d.setTarget(scene({ lightnessDelta: 0.4 }), 'light');
  const first = d.step(0.016, 10).lightnessDelta;
  const second = d.step(0.016, 10).lightnessDelta;
  assert.equal(first, second);
});

test('snap (reduced motion) jumps straight to the target', () => {
  const d = createSceneDriver();
  d.setTarget(scene({ hueShift: 0 }), 'light');
  d.step(0, 10, true);
  d.setTarget(scene({ hueShift: 0.3, opacityMul: 2, highlight: { srgb: [1, 0, 0], mix: 0.6 } }), 'light');
  d.step(0.016, 10, true);
  assert.equal(d.state.hueShift, 0.3);
  assert.equal(d.state.opacityMul, 2);
  assert.equal(d.state.highlightMix, 0.6);
  assert.equal(d.state.highlightR, 1);
});

test('hue shift eases along the shortest arc across the 0/1 seam', () => {
  const d = createSceneDriver();
  d.setTarget(scene({ hueShift: 0.45 }), 'light');
  d.step(0, 10);
  d.setTarget(scene({ hueShift: -0.45 }), 'light'); // 0.1 turn away through the seam, not 0.9 the long way
  d.step(0.05, 10);
  assert.ok(d.state.hueShift > 0.45 || d.state.hueShift < -0.4, `moved the short way: ${d.state.hueShift}`);
  for (let i = 1; i < 400; i += 1) d.step(0.05 + i / 60, 10);
  near(d.state.hueShift, -0.45);
});

test('the background snaps when the palette flips but eases for edits within a palette', () => {
  const d = createSceneDriver();
  d.setTarget(scene({ background: '#ffffff' }), 'light');
  d.step(0, 10);
  d.setTarget(scene({ background: '#000000' }), 'dark');
  d.step(1 / 60, 10);
  assert.equal(d.state.backgroundR, 0, 'light -> dark: no lagging white canvas behind the dark page');
  d.setTarget(scene({ background: '#808080' }), 'dark');
  d.step(2 / 60, 10);
  assert.ok(d.state.backgroundR > 0 && d.state.backgroundR < 128 / 255, 'same palette: eases');
});

test('state and its fields keep identity; version only moves when something changed', () => {
  const d = createSceneDriver();
  const stateRef = d.state;
  d.setTarget(scene({}), 'light');
  const v0 = d.state.version;
  d.step(0, 10);
  d.step(1 / 60, 10);
  assert.equal(d.state, stateRef);
  assert.equal(d.state.version, v0, 'no change => no version bump (consumers skip uniform writes)');
  d.setTarget(scene({ opacityMul: 2 }), 'light');
  d.step(2 / 60, 10);
  assert.ok(d.state.version > v0);
  assert.equal(d.state, stateRef);
});

test('step before any target is a harmless no-op', () => {
  const d = createSceneDriver();
  assert.equal(d.hasTarget(), false);
  assert.doesNotThrow(() => d.step(1, 10));
  assert.equal(d.state.hueSpan, 0.8);
});

test('large frame gaps (tab was hidden) are clamped, not a jump past the target', () => {
  const d = createSceneDriver();
  d.setTarget(scene({ saturationMul: 1 }), 'light');
  d.step(0, 10);
  d.setTarget(scene({ saturationMul: 0 }), 'light');
  d.step(1000, 10);
  const expected = 1 - (1 - Math.exp(-0.1 * 10));
  near(d.state.saturationMul, expected, 1e-9);
});

// --- binding to the bridge: precedence + light/dark independence ---------------------------

test('a "theme" driver follows the bridge mode; a pinned driver does not', () => {
  const bridge = createSceneBridge();
  const prod = { light: scene({ hueShift: 0.1, background: '#ffffff' }), dark: scene({ hueShift: 0.3, background: '#0f0e0a' }) };
  bridge.setProduction(prod);
  const themed = createSceneDriver();
  const pinned = createSceneDriver();
  const offThemed = bindDriver(themed, bridge, 'theme');
  const offPinned = bindDriver(pinned, bridge, 'light');
  assert.equal(themed.state.hueShift, 0.1);
  assert.equal(pinned.state.hueShift, 0.1);
  bridge.setMode('dark');
  themed.step(0, 10);
  pinned.step(0, 10);
  themed.step(1, 10, true);
  pinned.step(1, 10, true);
  assert.equal(themed.state.hueShift, 0.3, 'theme driver switched to the dark scene');
  assert.equal(pinned.state.hueShift, 0.1, 'pinned-light driver ignores the viewer mode');
  offThemed();
  offPinned();
});

test('draft edits flow to subscribers; clearing the draft returns to production', () => {
  const bridge = createSceneBridge();
  bridge.setProduction({ light: scene({ hueShift: 0.1 }), dark: scene({ hueShift: 0.2 }) });
  const d = createSceneDriver();
  bindDriver(d, bridge, 'theme');
  bridge.setDraft({ light: scene({ hueShift: -0.3 }), dark: scene({ hueShift: -0.2 }) });
  d.step(0, 10, true);
  assert.equal(d.state.hueShift, -0.3);
  bridge.setDraft(null);
  d.step(1, 10, true);
  assert.equal(d.state.hueShift, 0.1);
});

test('editing the dark scene never moves a light-pinned driver, and vice versa', () => {
  const bridge = createSceneBridge();
  bridge.setProduction({ light: scene({ hueShift: 0.1 }), dark: scene({ hueShift: 0.2 }) });
  const lightDriver = createSceneDriver();
  const darkDriver = createSceneDriver();
  bindDriver(lightDriver, bridge, 'light');
  bindDriver(darkDriver, bridge, 'dark');
  bridge.setDraft({ dark: scene({ hueShift: -0.4 }) });
  lightDriver.step(0, 10, true);
  darkDriver.step(0, 10, true);
  assert.equal(lightDriver.state.hueShift, 0.1);
  assert.equal(darkDriver.state.hueShift, -0.4);
});

test('bindDriver is a no-op for sceneMode "off"; syncDriver returns false', () => {
  const bridge = createSceneBridge();
  const d = createSceneDriver();
  const off = bindDriver(d, bridge, 'off');
  assert.equal(typeof off, 'function');
  assert.equal(d.hasTarget(), false);
  assert.equal(syncDriver(d, bridge, 'off'), false);
  assert.equal(syncDriver(d, bridge, 'theme'), true);
});
