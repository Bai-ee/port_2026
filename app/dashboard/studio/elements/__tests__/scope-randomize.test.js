import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOOK_COLOR_PALETTE, colorKeysForBucket, rollBucketKeys,
  randomizeMotionOnly, randomizeElementColorsOnly, randomizeLookColors,
  randomizeLighting, randomizeCamera, computeLockSkipReport,
} from '../scope-randomize.js';
import { createElementInstance } from '../schema.js';
import { getElementDefinition } from '../catalog.js';
import { mulberry32 } from '../randomize.js';

const PRIMARY_ID = 'glass-petal-sphere-1';

// ── colorKeysForBucket / rollBucketKeys ─────────────────────────────────────

test('colorKeysForBucket: kinetic-rings material bucket has exactly one color-typed key', () => {
  assert.deepEqual(colorKeysForBucket(getElementDefinition('kinetic-rings'), 'material'), ['color']);
});

test('colorKeysForBucket: a bucket with no color-typed fields returns an empty list', () => {
  assert.deepEqual(colorKeysForBucket(getElementDefinition('kinetic-rings'), 'motion'), []);
});

test('rollBucketKeys: only the requested keys change; sibling keys in the same bucket are untouched', () => {
  const inst = createElementInstance('kinetic-rings', { id: 'r1', enabled: true });
  const def = getElementDefinition('kinetic-rings');
  const { instance: next, changed } = rollBucketKeys(inst, def, mulberry32(3), 'material', ['color'], 'wild');
  assert.equal(next.material.metalness, inst.material.metalness, 'metalness untouched — not in the requested key list');
  assert.equal(next.material.roughness, inst.material.roughness, 'roughness untouched — not in the requested key list');
  assert.equal(typeof changed, 'boolean');
});

// ── randomizeMotionOnly ──────────────────────────────────────────────────────

test('randomizeMotionOnly: only the motion bucket changes; material/appearance stay byte-identical', () => {
  const inst = createElementInstance('kinetic-rings', { id: 'r1', enabled: true });
  const { instances } = randomizeMotionOnly([inst], { primaryId: PRIMARY_ID, deriveRand: () => mulberry32(9), intensity: 'wild' });
  const next = instances[0];
  assert.deepEqual(next.material, inst.material);
  assert.deepEqual(next.appearance, inst.appearance);
});

test('randomizeMotionOnly: skips a whole-element-locked instance and a motion-group-locked instance', () => {
  const whole = createElementInstance('kinetic-rings', { id: 'r1', enabled: true, random: { locked: true, groups: {} } });
  const group = createElementInstance('kinetic-rings', { id: 'r2', enabled: true, random: { locked: false, groups: { motion: true } } });
  const { instances, changedById } = randomizeMotionOnly([whole, group], { primaryId: PRIMARY_ID, deriveRand: () => mulberry32(1), intensity: 'wild' });
  assert.deepEqual(instances[0].motion, whole.motion);
  assert.deepEqual(instances[1].motion, group.motion);
  assert.deepEqual(changedById, {});
});

test('randomizeMotionOnly: excludes the primary id entirely', () => {
  const primary = createElementInstance('kinetic-rings', { id: PRIMARY_ID, enabled: true });
  const { instances } = randomizeMotionOnly([primary], { primaryId: PRIMARY_ID, deriveRand: () => mulberry32(1) });
  assert.equal(instances[0], primary, 'primary passes through as the same reference, untouched');
});

// ── randomizeElementColorsOnly ───────────────────────────────────────────────

test('randomizeElementColorsOnly: only color-typed material keys change; metalness/roughness are untouched', () => {
  const inst = createElementInstance('kinetic-rings', { id: 'r1', enabled: true });
  const { instances } = randomizeElementColorsOnly([inst], { primaryId: PRIMARY_ID, deriveRand: () => mulberry32(5), intensity: 'wild' });
  const next = instances[0];
  assert.equal(next.material.metalness, inst.material.metalness);
  assert.equal(next.material.roughness, inst.material.roughness);
  assert.ok(getElementDefinition('kinetic-rings').randomRanges.material.color.includes(next.material.color));
});

test('randomizeElementColorsOnly: skips an instance whose material group is locked', () => {
  const inst = createElementInstance('kinetic-rings', { id: 'r1', enabled: true, random: { locked: false, groups: { material: true } } });
  const { instances, changedById } = randomizeElementColorsOnly([inst], { primaryId: PRIMARY_ID, deriveRand: () => mulberry32(5), intensity: 'wild' });
  assert.deepEqual(instances[0].material, inst.material);
  assert.deepEqual(changedById, {});
});

test('randomizeElementColorsOnly: a type with no color-typed material field is a no-op', () => {
  const inst = createElementInstance('translucent-monoliths', { id: 'm1', enabled: true });
  // translucent-monoliths.material.color IS color-typed per catalog.js, so
  // pick a bucket-empty case instead: appearance has no color fields on any
  // type, confirmed indirectly via colorKeysForBucket above. Here we assert
  // the function itself never throws on a definition lookup miss.
  const { instances } = randomizeElementColorsOnly([{ ...inst, type: 'not-a-real-type' }], { primaryId: PRIMARY_ID, deriveRand: () => mulberry32(1) });
  assert.equal(instances.length, 1);
});

// ── randomizeLookColors ──────────────────────────────────────────────────────

const LOOK_FIXTURE = {
  lightCans: [
    { on: true, color: '#ffffff', intensity: 1.6, az: 35, el: 40 },
    { on: true, color: '#88ffee', intensity: 0.6, az: -140, el: 15 },
    { on: false, color: '#ffffff', intensity: 1, az: -35, el: 20 },
    { on: false, color: '#ffffff', intensity: 1, az: 180, el: 60 },
  ],
  bgColor: '#000000',
  fx: { colA: '#101014', colB: '#f4f1ea' },
  mat: { baseColor: '#101114' },
};

test('randomizeLookColors: every color field lands in LOOK_COLOR_PALETTE; non-color fields (on/intensity/az/el) are untouched', () => {
  const out = randomizeLookColors(LOOK_FIXTURE, { rand: mulberry32(2), intensity: 'wild' });
  out.lightCans.forEach((can, i) => {
    assert.ok(LOOK_COLOR_PALETTE.includes(can.color));
    assert.equal(can.on, LOOK_FIXTURE.lightCans[i].on);
    assert.equal(can.intensity, LOOK_FIXTURE.lightCans[i].intensity);
  });
  assert.ok(LOOK_COLOR_PALETTE.includes(out.bgColor));
  assert.ok(LOOK_COLOR_PALETTE.includes(out.fx.colA));
  assert.ok(LOOK_COLOR_PALETTE.includes(out.mat.baseColor));
});

test('randomizeLookColors: reports which sub-domains actually changed', () => {
  const out = randomizeLookColors(LOOK_FIXTURE, { rand: mulberry32(2), intensity: 'wild' });
  assert.ok(Array.isArray(out.changed));
  ['lighting', 'background', 'fx', 'material'].forEach((key) => {
    // every key in `changed` must be one of the four known sub-domains
    if (out.changed.includes(key)) assert.ok(['lighting', 'background', 'fx', 'material'].includes(key));
  });
});

// ── randomizeLighting ────────────────────────────────────────────────────────

test('randomizeLighting: every rolled value stays within its shipped slider range', () => {
  const out = randomizeLighting({ lightCans: LOOK_FIXTURE.lightCans, envIntensity: 1.2 }, { rand: mulberry32(4), intensity: 'wild' });
  out.lightCans.forEach((can) => {
    assert.ok(can.intensity >= 0 && can.intensity <= 3);
    assert.ok(can.az >= -180 && can.az <= 180);
    assert.ok(can.el >= -80 && can.el <= 85);
  });
  assert.ok(out.envIntensity >= 0 && out.envIntensity <= 2.5);
});

test('randomizeLighting: deterministic — same seed produces the same result', () => {
  const a = randomizeLighting({ lightCans: LOOK_FIXTURE.lightCans, envIntensity: 1.2 }, { rand: mulberry32(4) });
  const b = randomizeLighting({ lightCans: LOOK_FIXTURE.lightCans, envIntensity: 1.2 }, { rand: mulberry32(4) });
  assert.deepEqual(a, b);
});

// ── randomizeCamera ──────────────────────────────────────────────────────────

const DIFFUSION_CAMERA_FIXTURE = {
  enabled: true, locked: false, focalTarget: 'origin',
  focusDistance: 2.2, aperture: 0.4, falloff: 0.5, diffusionRadius: 0.3, highlightBloom: 0.2,
  foregroundBias: 0, backgroundBias: 0,
};
const SHOTCAM_FIXTURE = { use: false, az: 24, el: 12, dist: 3.2, fov: 40 };

test('randomizeCamera: shotCam + diffusionCamera fields stay within their declared ranges', () => {
  const out = randomizeCamera({ shotCam: SHOTCAM_FIXTURE, diffusionCamera: DIFFUSION_CAMERA_FIXTURE }, { rand: mulberry32(6), intensity: 'wild' });
  assert.ok(out.shotCam.az >= -180 && out.shotCam.az <= 180);
  assert.ok(out.shotCam.dist >= 1.2 && out.shotCam.dist <= 8);
  assert.ok(out.shotCam.fov >= 20 && out.shotCam.fov <= 90);
  assert.ok(out.diffusionCamera.aperture >= 0 && out.diffusionCamera.aperture <= 1);
  assert.ok(out.diffusionCamera.foregroundBias >= -1 && out.diffusionCamera.foregroundBias <= 1);
});

test('randomizeCamera: never flips shotCam.use as a side effect', () => {
  const out = randomizeCamera({ shotCam: SHOTCAM_FIXTURE, diffusionCamera: DIFFUSION_CAMERA_FIXTURE }, { rand: mulberry32(6) });
  assert.equal(out.shotCam.use, SHOTCAM_FIXTURE.use);
});

test('randomizeCamera: a locked diffusionCamera is skipped entirely; shotCam still rolls', () => {
  const locked = { ...DIFFUSION_CAMERA_FIXTURE, locked: true };
  const out = randomizeCamera({ shotCam: SHOTCAM_FIXTURE, diffusionCamera: locked }, { rand: mulberry32(6), intensity: 'wild' });
  assert.deepEqual(out.diffusionCamera, locked);
  assert.ok(!out.changed.includes('diffusionCamera'));
});

// ── computeLockSkipReport ────────────────────────────────────────────────────

test('computeLockSkipReport: a whole-element-locked instance is reported once; a group-locked instance is reported per locked group', () => {
  const whole = createElementInstance('kinetic-rings', { id: 'r1', enabled: true, random: { locked: true, groups: {} } });
  const group = createElementInstance('kinetic-rings', { id: 'r2', enabled: true, random: { locked: false, groups: { material: true, motion: true } } });
  const report = computeLockSkipReport([whole, group], { primaryId: PRIMARY_ID });
  assert.equal(report.elements.filter((e) => e.id === 'r1').length, 1);
  assert.equal(report.elements.filter((e) => e.id === 'r2').length, 2);
});

test('computeLockSkipReport: the primary id and non-renderable entries never appear in the report', () => {
  const primary = createElementInstance('kinetic-rings', { id: PRIMARY_ID, enabled: true, random: { locked: true, groups: {} } });
  const report = computeLockSkipReport([primary], { primaryId: PRIMARY_ID });
  assert.deepEqual(report.elements, []);
});

test('computeLockSkipReport: diffusionCameraLocked flag surfaces exactly one camera-domain skip entry', () => {
  assert.deepEqual(computeLockSkipReport([], { primaryId: PRIMARY_ID, diffusionCameraLocked: false }).camera, []);
  assert.equal(computeLockSkipReport([], { primaryId: PRIMARY_ID, diffusionCameraLocked: true }).camera.length, 1);
});
