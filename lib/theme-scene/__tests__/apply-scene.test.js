import test from 'node:test';
import assert from 'node:assert/strict';
import { applySceneToParams, normalizeSceneTargets, SCENE_IDENTITY, DEFAULT_HUE_SPAN } from '../apply-scene.js';
import { resolveTheme, createBaseline, setMasterHue, setSceneSource, setSceneFollow, setSceneCustom } from '../../theme/index.js';

// The two real surfaces' baseline params (InternalPageBackground / HomePage).
const INNER = { hueOffset: 0.44, saturation: 0.9, lightness: 0.52, opacity: 0.16 };
const HOME_START = { hueOffset: 0.36, saturation: 0.75, lightness: 0.4, opacity: 0.23 };
const HOME_END = { hueOffset: 0.5, saturation: 1, lightness: 0.55, opacity: 0.18 };

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('identity scene returns the surface params untouched (baseline is bit-identical)', () => {
  for (const surface of [INNER, HOME_START, HOME_END]) {
    const r = applySceneToParams(surface, SCENE_IDENTITY);
    assert.equal(r.hueOffset, surface.hueOffset);
    assert.equal(r.saturation, surface.saturation);
    assert.equal(r.lightness, surface.lightness);
    assert.equal(r.opacity, surface.opacity);
    assert.equal(r.hueSpan, DEFAULT_HUE_SPAN);
  }
});

test('null / "off" / junk scene is the identity', () => {
  for (const sc of [null, undefined, 'off', 42]) {
    const r = applySceneToParams(INNER, sc);
    assert.deepEqual(r, { hueOffset: 0.44, saturation: 0.9, lightness: 0.52, opacity: 0.16, hueSpan: 0.8 });
  }
});

test('the real baseline light scene (resolved by lib/theme) is the identity on both surfaces', () => {
  const light = resolveTheme(createBaseline(), 'light').scene;
  for (const surface of [INNER, HOME_START, HOME_END]) {
    const r = applySceneToParams(surface, light);
    assert.equal(r.hueOffset, surface.hueOffset);
    assert.equal(r.saturation, surface.saturation);
    assert.equal(r.lightness, surface.lightness);
    assert.equal(r.opacity, surface.opacity);
    assert.equal(r.hueSpan, 0.8);
  }
});

test('hue shift is added then wrapped into [0,1)', () => {
  near(applySceneToParams({ hueOffset: 0.9 }, { hueShift: 0.25 }).hueOffset, 0.15);
  near(applySceneToParams({ hueOffset: 0.1 }, { hueShift: -0.25 }).hueOffset, 0.85);
  near(applySceneToParams({ hueOffset: 0.5 }, { hueShift: 0.5 }).hueOffset, 0);
  near(applySceneToParams({ hueOffset: 1.75 }, { hueShift: 0 }).hueOffset, 0.75);
  near(applySceneToParams({ hueOffset: -0.25 }, { hueShift: 0 }).hueOffset, 0.75);
  for (const h of [0, 0.999999, 1, -1e-12, 3.3]) {
    const r = applySceneToParams({ hueOffset: h }, { hueShift: 0.5 }).hueOffset;
    assert.ok(r >= 0 && r < 1, String(r));
  }
});

test('saturation, lightness and opacity are scaled / offset and clamped to [0,1]', () => {
  const r = applySceneToParams(INNER, { saturationMul: 2, lightnessDelta: 0.7, opacityMul: 10 });
  assert.equal(r.saturation, 1);
  assert.equal(r.lightness, 1);
  assert.equal(r.opacity, 1);
  const lo = applySceneToParams(INNER, { saturationMul: 0, lightnessDelta: -2, opacityMul: 0 });
  assert.equal(lo.saturation, 0);
  assert.equal(lo.lightness, 0);
  assert.equal(lo.opacity, 0);
  const mid = applySceneToParams(INNER, { saturationMul: 0.95, lightnessDelta: 0.1, opacityMul: 1.5 });
  near(mid.saturation, 0.855);
  near(mid.lightness, 0.62);
  near(mid.opacity, 0.24);
});

test('hueSpan: finite value used (clamped to schema range), absent => 0.8', () => {
  assert.equal(applySceneToParams(INNER, { hueSpan: 0.3 }).hueSpan, 0.3);
  assert.equal(applySceneToParams(INNER, { hueSpan: 9 }).hueSpan, 1);
  assert.equal(applySceneToParams(INNER, { hueSpan: 0 }).hueSpan, 0.05);
  assert.equal(applySceneToParams(INNER, {}).hueSpan, 0.8);
  assert.equal(applySceneToParams(INNER, { hueSpan: 'off' }).hueSpan, 0.8);
  assert.equal(applySceneToParams(INNER, { hueSpan: NaN }).hueSpan, 0.8);
});

test('NaN / Infinity / strings in the scene fall back to identity values, never NaN', () => {
  const r = applySceneToParams(INNER, { hueShift: NaN, saturationMul: Infinity, lightnessDelta: 'x', opacityMul: undefined });
  for (const v of Object.values(r)) assert.ok(Number.isFinite(v));
  assert.equal(r.hueOffset, 0.44);
  assert.equal(r.saturation, 0.9);
  assert.equal(r.lightness, 0.52);
  assert.equal(r.opacity, 0.16);
});

test('scroll interpolation composes with deltas (deltas are over the interpolated values)', () => {
  const scene = { hueShift: 0.1, saturationMul: 0.9, lightnessDelta: 0.05, opacityMul: 1.5, hueSpan: 0.6 };
  for (const p of [0, 0.25, 0.5, 0.75, 1]) {
    const lerp = (a, b) => a + (b - a) * p;
    const interpolated = {
      hueOffset: lerp(HOME_START.hueOffset, HOME_END.hueOffset),
      saturation: lerp(HOME_START.saturation, HOME_END.saturation),
      lightness: lerp(HOME_START.lightness, HOME_END.lightness),
      opacity: lerp(HOME_START.opacity, HOME_END.opacity),
    };
    const r = applySceneToParams(interpolated, scene);
    near(r.hueOffset, interpolated.hueOffset + 0.1);
    near(r.saturation, Math.min(1, interpolated.saturation * 0.9));
    near(r.lightness, interpolated.lightness + 0.05);
    near(r.opacity, interpolated.opacity * 1.5);
    assert.equal(r.hueSpan, 0.6);
  }
});

test('an out object is reused and returned (no per-frame allocation)', () => {
  const out = {};
  const a = applySceneToParams(INNER, SCENE_IDENTITY, out);
  const b = applySceneToParams(HOME_END, { hueShift: 0.2 }, out);
  assert.equal(a, out);
  assert.equal(b, out);
  near(out.hueOffset, 0.7);
});

test('surface defaults fill in missing params (ox ParticleSwarm defaults)', () => {
  const r = applySceneToParams({}, SCENE_IDENTITY);
  assert.deepEqual(r, { hueOffset: 0, saturation: 0.85, lightness: 0.5, opacity: 1, hueSpan: 0.8 });
});

// --- follow vs custom, against the real engine, over the real per-surface params -------------

test('follow: master hue +60deg rotates the surface hue by 1/6 turn; deltas stay over surface params', () => {
  const def = setMasterHue(createBaseline(), 261);
  const scene = resolveTheme(def, 'light').scene;
  assert.equal(scene.source, 'follow');
  near(scene.hueShift, 1 / 6, 1e-4);
  near(applySceneToParams(INNER, scene).hueOffset, 0.44 + 1 / 6, 1e-4);
  near(applySceneToParams(HOME_START, scene).hueOffset, 0.36 + 1 / 6, 1e-4);
  assert.equal(applySceneToParams(INNER, scene).saturation, 0.9);
});

test('custom takes over from follow: master hue no longer moves the scene', () => {
  let def = setSceneSource(createBaseline(), 'light', 'custom');
  def = setSceneCustom(def, 'light', { base: { l: 0.62, c: 0.14, h: 30 } });
  const before = resolveTheme(def, 'light').scene;
  const after = resolveTheme(setMasterHue(def, 300), 'light').scene;
  assert.equal(before.source, 'custom');
  assert.equal(before.hueShift, after.hueShift, 'custom ignores the master hue');
  assert.equal(before.saturationMul, after.saturationMul);
  // ...and it is a delta over the inner-page reference (not an absolute colour), so it still composes.
  const r = applySceneToParams(INNER, before);
  near(r.hueOffset, (0.44 + before.hueShift + 1) % 1, 1e-9);
});

test('follow tuning (saturation/lightness/opacity/span) applies to the surface params', () => {
  const def = setSceneFollow(createBaseline(), 'light', { saturationMul: 0.5, lightnessDelta: -0.1, opacityMul: 2, hueSpan: 0.4 });
  const scene = resolveTheme(def, 'light').scene;
  const r = applySceneToParams(INNER, scene);
  near(r.saturation, 0.45);
  near(r.lightness, 0.42);
  near(r.opacity, 0.32);
  assert.equal(r.hueSpan, 0.4);
});

test('light and dark scenes are independent of each other', () => {
  let def = setSceneFollow(createBaseline(), 'dark', { hueShiftDeg: 90 });
  const light = resolveTheme(def, 'light').scene;
  const dark = resolveTheme(def, 'dark').scene;
  assert.equal(light.hueShift, 0);
  near(dark.hueShift, 0.25, 1e-4);
  def = setSceneFollow(def, 'light', { hueShiftDeg: -90 });
  const light2 = resolveTheme(def, 'light').scene;
  const dark2 = resolveTheme(def, 'dark').scene;
  near(light2.hueShift, -0.25, 1e-4);
  assert.equal(dark2.hueShift, dark.hueShift, 'editing light never moves dark');
});

test('normalizeSceneTargets tolerates a malformed scene (e.g. read back from localStorage)', () => {
  const t = normalizeSceneTargets({ hueShift: 'a', background: 'red', highlight: { srgb: [2, -1, 'x'], mix: 7 }, hueSpan: -3 });
  assert.equal(t.hueShift, 0);
  assert.equal(t.hueSpan, 0.05);
  assert.equal(t.highlightMix, 1);
  assert.deepEqual([t.highlightR, t.highlightG, t.highlightB], [1, 0, 0]);
  assert.deepEqual([t.backgroundR, t.backgroundG, t.backgroundB], [1, 1, 1], 'unparseable background => baseline white');
  const ok = normalizeSceneTargets({ background: '#0f0e0a' });
  near(ok.backgroundR, 0x0f / 255);
  assert.deepEqual(Object.keys(normalizeSceneTargets(null)).sort(), Object.keys(t).sort());
});
