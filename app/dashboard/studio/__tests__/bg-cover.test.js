// bg-cover.test.js — the no-skew guarantee for uploaded background images:
// scene.background otherwise stretches a Texture to the canvas; this module
// is the exact cover-fit transform the render loop applies every frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeBackgroundCover, computeContainLayout } from '../bg-cover.js';

test('matching aspect: no crop at all', () => {
  assert.deepEqual(computeBackgroundCover(16 / 9, 16 / 9), { repeatX: 1, repeatY: 1, offsetX: 0, offsetY: 0 });
});

test('wider image than canvas: full height, width cropped equally left/right — never stretched', () => {
  // 2:1 image on a 1:1 canvas -> show the middle half of the width.
  const c = computeBackgroundCover(2, 1);
  assert.equal(c.repeatY, 1);
  assert.ok(Math.abs(c.repeatX - 0.5) < 1e-12);
  assert.ok(Math.abs(c.offsetX - 0.25) < 1e-12, 'crop must be centered');
  assert.equal(c.offsetY, 0);
});

test('taller image than canvas (a portrait upload on a landscape stage): full width, height cropped equally', () => {
  // 1:2 image (aspect 0.5) on a 16:9 canvas.
  const canvas = 16 / 9;
  const c = computeBackgroundCover(0.5, canvas);
  assert.equal(c.repeatX, 1);
  assert.ok(Math.abs(c.repeatY - 0.5 / canvas) < 1e-12);
  assert.ok(Math.abs(c.offsetY - (1 - 0.5 / canvas) / 2) < 1e-12, 'crop must be centered');
  // The visible region's aspect equals the canvas aspect exactly — this IS
  // the "never skewed" property: imageAspect * (repeatY/repeatX)⁻¹ … the
  // sampled patch (full width × repeatY of height) has aspect img/repeatY.
  assert.ok(Math.abs((0.5 / c.repeatY) - canvas) < 1e-12, 'sampled patch aspect must equal the canvas aspect');
});

test('garbage inputs fall back to identity, never NaN', () => {
  assert.deepEqual(computeBackgroundCover(0, NaN), { repeatX: 1, repeatY: 1, offsetX: 0, offsetY: 0 });
});

test('cover SHIFT: slides the crop window through the vertical slack only, clamped, centered at 0', () => {
  const canvas = 16 / 9;
  // Tall image on a wide canvas -> vertical slack exists.
  const centered = computeBackgroundCover(0.5, canvas, 0);
  const top = computeBackgroundCover(0.5, canvas, 1);
  const bottom = computeBackgroundCover(0.5, canvas, -1);
  const slack = 1 - centered.repeatY;
  assert.ok(Math.abs(centered.offsetY - slack / 2) < 1e-12, 'shift 0 = centered');
  assert.ok(Math.abs(top.offsetY - slack) < 1e-12, 'shift +1 pins the window to the image top');
  assert.ok(Math.abs(bottom.offsetY - 0) < 1e-12, 'shift -1 pins to the bottom');
  const overshoot = computeBackgroundCover(0.5, canvas, 5);
  assert.ok(Math.abs(overshoot.offsetY - slack) < 1e-12, 'shift clamps to ±1');
  // Wide image on a squarer canvas -> the crop is horizontal; shift is a no-op.
  const noSlack = computeBackgroundCover(2, 1, 1);
  assert.equal(noSlack.offsetY, 0);
  assert.ok(Math.abs(noSlack.offsetX - 0.25) < 1e-12, 'horizontal crop stays centered regardless of shiftY');
});

test('contain layout: whole image always visible, letterboxed, shift moves it through the vertical slack', () => {
  const canvas = 16 / 9;
  // Wider-than-canvas image -> bars above/below.
  const c = computeContainLayout(3, canvas, 0);
  assert.equal(c.w, 1);
  assert.ok(Math.abs(c.h - canvas / 3) < 1e-12);
  assert.ok(Math.abs(c.y - (1 - c.h) / 2) < 1e-12, 'centered at shift 0');
  const top = computeContainLayout(3, canvas, 1);
  assert.ok(Math.abs(top.y - 0) < 1e-12, 'shift +1 slides the image to the top of the stage');
  const bottom = computeContainLayout(3, canvas, -1);
  assert.ok(Math.abs(bottom.y - (1 - c.h)) < 1e-12, 'shift -1 to the bottom');
  // Taller-than-canvas image -> bars at the sides; full height; no vertical slack.
  const t = computeContainLayout(0.5, canvas, 1);
  assert.equal(t.h, 1);
  assert.equal(t.y, 0);
  assert.ok(Math.abs(t.w - 0.5 / canvas) < 1e-12);
  assert.ok(Math.abs(t.x - (1 - t.w) / 2) < 1e-12, 'side bars stay centered');
});
