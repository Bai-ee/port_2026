import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTheme } from '../resolve.js';
import { resolveScene, SCENE_REFERENCE } from '../scene.js';
import { BASELINE_DEFINITION } from '../baseline.js';
import { setMasterHue, setSceneSource, setSceneFollow, setSceneCustom } from '../edit.js';
import { gamutMap, rgb255ToHsl, wrapTurns, formatHex } from '../color.js';

const near = (a, b, tol = 1e-4, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);

test('SCENE_REFERENCE is the inner-page surface params', () => {
  assert.deepEqual({ ...SCENE_REFERENCE }, { hue: 0.44, saturation: 0.9, lightness: 0.52 });
});

test('follow at the baseline is the identity (light) and the authored proposal (dark)', () => {
  const l = resolveTheme(BASELINE_DEFINITION, 'light').scene;
  assert.equal(l.source, 'follow');
  assert.equal(l.hueShift, 0);
  assert.equal(l.saturationMul, 1);
  assert.equal(l.lightnessDelta, 0);
  assert.equal(l.opacityMul, 1);
  assert.equal(l.hueSpan, 0.8);
  assert.equal(l.highlight.mix, 0);
  assert.equal(l.background, '#ffffff');
  const d = resolveTheme(BASELINE_DEFINITION, 'dark').scene;
  assert.equal(d.saturationMul, 0.95);
  assert.equal(d.lightnessDelta, 0.1);
  assert.equal(d.opacityMul, 1.5);
  assert.equal(d.hueSpan, 0.8);
  assert.notEqual(d.background, '#ffffff');
});

test('follow: master +60deg => hueShift 1/6; deg shift adds; result wraps into (-0.5, 0.5]', () => {
  near(resolveTheme(setMasterHue(BASELINE_DEFINITION, 261), 'light').scene.hueShift, 1 / 6, 1e-5);
  near(resolveTheme(setMasterHue(BASELINE_DEFINITION, 141), 'light').scene.hueShift, -1 / 6, 1e-5);
  const withShift = setSceneFollow(setMasterHue(BASELINE_DEFINITION, 261), 'light', { hueShiftDeg: 30 });
  near(resolveTheme(withShift, 'light').scene.hueShift, 90 / 360, 1e-5);
  for (const hue of [0, 20, 90, 200, 201, 300, 359.99]) {
    const s = resolveTheme(setMasterHue(BASELINE_DEFINITION, hue), 'light').scene.hueShift;
    assert.ok(s > -0.5 && s <= 0.5, `hueShift ${s} @${hue}`);
  }
  const f = setSceneFollow(BASELINE_DEFINITION, 'light', { saturationMul: 0.7, lightnessDelta: -0.1, opacityMul: 2, hueSpan: 0.4 });
  const s = resolveTheme(f, 'light').scene;
  assert.deepEqual([s.saturationMul, s.lightnessDelta, s.opacityMul, s.hueSpan], [0.7, -0.1, 2, 0.4]);
});

test('custom base uses the delta model against the reference params', () => {
  const base = { l: 0.6, c: 0.2, h: 30 };
  const d = setSceneCustom(setSceneSource(BASELINE_DEFINITION, 'light', 'custom'), 'light', { base, opacityMul: 1.2 });
  const s = resolveTheme(d, 'light').scene;
  const rgb = gamutMap(base).rgb255;
  const hsl = rgb255ToHsl(rgb);
  assert.equal(s.source, 'custom');
  near(s.hueShift, wrapTurns(hsl.h - 0.44), 1e-5);
  near(s.saturationMul, hsl.s / 0.9, 1e-5);
  near(s.lightnessDelta, hsl.l - 0.52, 1e-5);
  assert.equal(s.opacityMul, 1.2);
  assert.equal(s.hueSpan, 0.8, 'no secondary => 0.8');
  assert.equal(s.swatches.base, formatHex({ r: rgb[0], g: rgb[1], b: rgb[2] }));
});

test('custom defaults round-trip to (almost) the follow identity', () => {
  const s = resolveTheme(setSceneSource(BASELINE_DEFINITION, 'light', 'custom'), 'light').scene;
  near(s.hueShift, 0, 0.002);
  near(s.saturationMul, 1, 0.02);
  near(s.lightnessDelta, 0, 0.02);
});

test('custom secondary sets hueSpan as counter-clockwise turns, clamped to [0.05, 1]', () => {
  const mk = (secondary) => resolveTheme(setSceneCustom(setSceneSource(BASELINE_DEFINITION, 'light', 'custom'), 'light', {
    base: { l: 0.7, c: 0.15, h: 30 }, secondary,
  }), 'light').scene;
  const baseH = rgb255ToHsl(gamutMap({ l: 0.7, c: 0.15, h: 30 }).rgb255).h;
  const sec = { l: 0.7, c: 0.15, h: 250 };
  const secH = rgb255ToHsl(gamutMap(sec).rgb255).h;
  near(mk(sec).hueSpan, (((secH - baseH) % 1) + 1) % 1, 1e-4);
  assert.equal(mk(null).hueSpan, 0.8);
  assert.equal(mk({ l: 0.7, c: 0.15, h: 30 }).hueSpan, 0.05, 'identical hue clamps up');
  for (const h of [0, 90, 180, 270, 359]) {
    const span = mk({ l: 0.7, c: 0.15, h }).hueSpan;
    assert.ok(span >= 0.05 && span <= 1);
  }
});

test('highlight is display-space sRGB numbers in 0..1 with mix = strength', () => {
  const d = setSceneCustom(setSceneSource(BASELINE_DEFINITION, 'dark', 'custom'), 'dark', {
    highlight: { l: 0.8, c: 0.15, h: 340 }, highlightStrength: 0.35,
  });
  const s = resolveTheme(d, 'dark').scene;
  assert.equal(s.highlight.mix, 0.35);
  assert.equal(s.highlight.srgb.length, 3);
  for (const v of s.highlight.srgb) assert.ok(v >= 0 && v <= 1);
  const hi = gamutMap({ l: 0.8, c: 0.15, h: 340 }).rgb255.map((v) => v / 255);
  hi.forEach((v, i) => near(s.highlight.srgb[i], v, 1e-4));
  assert.match(s.swatches.highlight, /^#[0-9a-f]{6}$/);
  // follow mode: highlight is the accent-bright colour with mix 0
  const f = resolveTheme(BASELINE_DEFINITION, 'light');
  assert.equal(f.scene.swatches.highlight, f.roles['accent-bright'].hex);
});

test('swatches, wash and background are consistent with the resolved roles', () => {
  const t = resolveTheme(BASELINE_DEFINITION, 'dark');
  assert.equal(t.scene.background, t.roles.page.hex);
  assert.equal(t.scene.wash, t.roles['scene-wash'].value);
  for (const k of ['base', 'secondary', 'highlight']) assert.match(t.scene.swatches[k], /^#[0-9a-f]{6}$/);
  // resolveScene tolerates a missing roles argument
  const bare = resolveScene(BASELINE_DEFINITION, 'light');
  assert.equal(bare.background, '#ffffff');
});
