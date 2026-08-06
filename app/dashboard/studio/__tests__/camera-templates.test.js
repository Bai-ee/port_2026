// camera-templates.test.js — the Mockup Video camera rides ported onto Holo
// Paper's timeline: expansion math, hold duplicates, canonical open, radius
// cap, and the MAX_TIMELINE_KEYFRAMES budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMERA_TEMPLATES, DEFAULT_VIEW, buildCameraTemplateTimeline, templateOrbitPose } from '../camera-templates.js';
import { MAX_TIMELINE_KEYFRAMES, sanitizeTimeline } from '../timeline.js';

const RECIPE = { shotCam: { use: false }, bgMode: 'color' };

test('all 13 mockup templates ported; every build fits the 12-keyframe budget and spans t=0..1', () => {
  assert.equal(CAMERA_TEMPLATES.length, 13);
  CAMERA_TEMPLATES.forEach((tpl) => {
    const built = buildCameraTemplateTimeline(tpl.id, RECIPE);
    assert.ok(built, tpl.id);
    assert.ok(built.keyframes.length >= 8 && built.keyframes.length <= MAX_TIMELINE_KEYFRAMES,
      `${tpl.id}: ${built.keyframes.length} keyframes must fit the timeline budget`);
    assert.equal(built.keyframes[0].t, 0, `${tpl.id} starts at t=0`);
    assert.ok(Math.abs(built.keyframes[built.keyframes.length - 1].t - 1) < 1e-9, `${tpl.id} ends at t=1`);
    assert.equal(built.totalSeconds, tpl.seconds);
    // strictly increasing t (holds create separated duplicates, never ties)
    for (let i = 1; i < built.keyframes.length; i++) {
      assert.ok(built.keyframes[i].t > built.keyframes[i - 1].t, `${tpl.id}: t strictly increases`);
    }
    // survives the real sanitizer without dropping keyframes
    const sane = sanitizeTimeline({ keyframes: built.keyframes, totalSeconds: built.totalSeconds, loop: false });
    assert.equal(sane.keyframes.length, built.keyframes.length, `${tpl.id}: sanitizer keeps every keyframe`);
    assert.ok(sane.keyframes.every((k) => k.orbitPose && Number.isFinite(k.orbitPose.px)), `${tpl.id}: every keyframe carries a finite orbitPose`);
  });
});

test('canonical open: every template\'s first keyframe is the DEFAULT_VIEW pose (never zoomed out or turned away)', () => {
  const expected = templateOrbitPose(DEFAULT_VIEW);
  CAMERA_TEMPLATES.forEach((tpl) => {
    const first = buildCameraTemplateTimeline(tpl.id, RECIPE).keyframes[0].orbitPose;
    assert.ok(Math.abs(first.px - expected.px) < 1e-9 && Math.abs(first.pz - expected.pz) < 1e-9, tpl.id);
  });
});

test('holds park the camera: a hold produces a duplicate pose at a later t', () => {
  const built = buildCameraTemplateTimeline('hero-push', RECIPE); // key 4 carries hold 0.8
  const holdPairs = [];
  for (let i = 1; i < built.keyframes.length; i++) {
    const a = built.keyframes[i - 1].orbitPose, b = built.keyframes[i].orbitPose;
    if (Math.abs(a.px - b.px) < 1e-9 && Math.abs(a.py - b.py) < 1e-9 && Math.abs(a.pz - b.pz) < 1e-9) holdPairs.push(i);
  }
  assert.ok(holdPairs.length >= 1, 'hero-push must contain at least one held (duplicated) pose');
});

test('world mapping: distances stay inside the orbit clamps and target fractions map to subject half-extent', () => {
  const wide = templateOrbitPose([2.3, 0, 0]);
  assert.ok(Math.hypot(wide.px, wide.py, wide.pz) <= 7.5 + 1e-9, 'radius cap upper clamp');
  const tight = templateOrbitPose([0.05, 0, 0]);
  assert.ok(Math.hypot(tight.px, tight.py, tight.pz) >= 0.7 - 1e-9, 'lower clamp keeps the camera off the subject');
  const cornered = templateOrbitPose([1, 0, 0, -0.7, 0.55]);
  assert.equal(cornered.tx, -0.35);
  assert.ok(Math.abs(cornered.ty - 0.275) < 1e-12);
});

test('unknown template id returns null, never throws', () => {
  assert.equal(buildCameraTemplateTimeline('nope', RECIPE), null);
});
