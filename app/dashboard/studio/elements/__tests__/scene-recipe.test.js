import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isFiniteNum, isHexColor, isBool, sanitizeVec3,
  sanitizeMat, sanitizePhys, sanitizeAnim, sanitizeCam, sanitizeGlass, sanitizeShotCam,
  sanitizeFx, sanitizeCan, sanitizeLightCans, sanitizeElementLocks,
} from '../scene-recipe.js';

// Regression for the Codex-blocked crash (2026-07-23T17:58:38Z): an imported
// Scene Template with `recipe.lightCans=[null,null,null,null]` was accepted
// with error:null, applied with only a shallow Array.isArray+length check,
// and crashed the render loop the moment it dereferenced a null can's `.on`.
// These tests exercise the sanitizers now standing at that boundary.

test('predicates', () => {
  assert.equal(isFiniteNum(1.5), true);
  assert.equal(isFiniteNum(NaN), false);
  assert.equal(isFiniteNum(Infinity), false);
  assert.equal(isFiniteNum('1'), false);
  assert.equal(isFiniteNum(null), false);
  assert.equal(isHexColor('#ffffff'), true);
  assert.equal(isHexColor('#FFF'), false, 'only 6-digit hex is accepted, matching every color input in this app');
  assert.equal(isHexColor('red'), false);
  assert.equal(isHexColor(null), false);
  assert.equal(isBool(true), true);
  assert.equal(isBool(0), false);
  assert.equal(isBool('true'), false);
});

test('sanitizeVec3: valid 3-number array passes through; anything else falls back', () => {
  assert.deepEqual(sanitizeVec3([1, 2, 3], [0, 0, 0]), [1, 2, 3]);
  assert.deepEqual(sanitizeVec3([1, null, 3], [9, 9, 9]), [9, 9, 9]);
  assert.deepEqual(sanitizeVec3([1, 2], [9, 9, 9]), [9, 9, 9], 'wrong length rejected');
  assert.deepEqual(sanitizeVec3('not an array', [9, 9, 9]), [9, 9, 9]);
  assert.deepEqual(sanitizeVec3(null, [9, 9, 9]), [9, 9, 9]);
  // must not alias the fallback array — mutating the result must not mutate fallback
  const fb = [1, 1, 1];
  const out = sanitizeVec3(null, fb);
  out[0] = 99;
  assert.deepEqual(fb, [1, 1, 1]);
});

const FALLBACK_MAT = {
  preset: 'black-cloth', finish: 'glossy', baseColor: '#101114',
  holoIntensity: 0.55, holoScale: 8, bandFreq: 0.35,
  saturation: 0.6, hueShift: 0, sparkle: 0.25, specTint: 1,
  iridescence: 0.35, roughness: 0.12, metalness: 0.35,
  clearcoat: 0.5, coatRoughness: 0.08, sheen: 0.08,
  bump: 0.79, bumpTiling: 3,
};
const FINISHES = ['glossy', 'satin', 'matte'];
const PRESET_IDS = ['black-cloth', 'holo-foil', 'oil-slick', 'chrome', 'silk', 'paper'];

test('sanitizeMat: valid nested fields pass through; invalid ones fall back to the CURRENT value', () => {
  const raw = { finish: 'matte', baseColor: '#ffffff', holoIntensity: 1, roughness: 'not a number' };
  const out = sanitizeMat(raw, FALLBACK_MAT, { finishes: FINISHES, presetIds: PRESET_IDS });
  assert.equal(out.finish, 'matte');
  assert.equal(out.baseColor, '#ffffff');
  assert.equal(out.holoIntensity, 1);
  assert.equal(out.roughness, FALLBACK_MAT.roughness, 'invalid nested member falls back to current, not a hardcoded default');
});

test('sanitizeMat: invalid finish/baseColor/preset types are dropped individually, not the whole object', () => {
  const raw = { finish: 'chrome-plated', baseColor: 'not-hex', preset: 123, holoScale: 20 };
  const out = sanitizeMat(raw, FALLBACK_MAT, { finishes: FINISHES, presetIds: PRESET_IDS });
  assert.equal(out.finish, FALLBACK_MAT.finish);
  assert.equal(out.baseColor, FALLBACK_MAT.baseColor);
  assert.equal(out.preset, FALLBACK_MAT.preset);
  assert.equal(out.holoScale, 20, 'the one valid field in the same object still applies');
});

test('sanitizeMat: null/non-object raw returns the fallback unchanged', () => {
  assert.deepEqual(sanitizeMat(null, FALLBACK_MAT, { finishes: FINISHES, presetIds: PRESET_IDS }), FALLBACK_MAT);
  assert.deepEqual(sanitizeMat('garbage', FALLBACK_MAT, { finishes: FINISHES, presetIds: PRESET_IDS }), FALLBACK_MAT);
});

test('sanitizeMat: preset is validated against presetIds — a real preset id is accepted, an unknown string is rejected, and empty string ("Custom") is always allowed', () => {
  assert.equal(sanitizeMat({ preset: 'chrome' }, FALLBACK_MAT, { finishes: FINISHES, presetIds: PRESET_IDS }).preset, 'chrome');
  assert.equal(sanitizeMat({ preset: 'not-a-real-preset' }, FALLBACK_MAT, { finishes: FINISHES, presetIds: PRESET_IDS }).preset, FALLBACK_MAT.preset, 'an unknown preset id must not persist/poison state — Codex blocker 2026-07-23T18:24:04Z');
  assert.equal(sanitizeMat({ preset: '' }, FALLBACK_MAT, { finishes: FINISHES, presetIds: PRESET_IDS }).preset, '', '"" is the legitimate Custom value, not itself a preset id');
});

const FALLBACK_PHYS = { gravity: 2.7, damping: 0.9, stiffness: 0.85, rebound: 0, rumple: 0.79, pinMode: 'free-float' };
const PIN_MODE_IDS = ['free-float', 'top-edge', 'top-corners', 'four-corners'];

test('sanitizePhys: valid pinMode enum + numeric fields pass; invalid pinMode falls back', () => {
  const out = sanitizePhys({ pinMode: 'top-corners', gravity: 5 }, FALLBACK_PHYS, { pinModeIds: PIN_MODE_IDS });
  assert.equal(out.pinMode, 'top-corners');
  assert.equal(out.gravity, 5);
  const out2 = sanitizePhys({ pinMode: 'floating-through-the-floor' }, FALLBACK_PHYS, { pinModeIds: PIN_MODE_IDS });
  assert.equal(out2.pinMode, FALLBACK_PHYS.pinMode);
});

test('sanitizeAnim: booleans/numbers validated independently', () => {
  const fb = { on: true, turbulence: 0.6, speed: 1 };
  assert.deepEqual(sanitizeAnim({ on: false, turbulence: 'fast' }, fb), { on: false, turbulence: 0.6, speed: 1 });
  assert.deepEqual(sanitizeAnim(null, fb), fb);
});

test('sanitizeCam: only real booleans accepted per axis', () => {
  const fb = { rotX: true, rotY: true, pan: true };
  assert.deepEqual(sanitizeCam({ rotX: false, rotY: 'yes', pan: 0 }, fb), { rotX: false, rotY: true, pan: true });
});

const FALLBACK_GLASS = { on: false, scale: 1, rotate: true, rotSpeed: 0.4, tint: '#ffffff', clarity: 0.06, position: [0, 0, 0], rotationOffset: [0, 0, 0] };

test('sanitizeGlass: position/rotationOffset validated as vec3s, tint as hex', () => {
  const out = sanitizeGlass({ position: [1, 2, 3], rotationOffset: 'bad', tint: 'not-hex', scale: 2 }, FALLBACK_GLASS);
  assert.deepEqual(out.position, [1, 2, 3]);
  assert.deepEqual(out.rotationOffset, [0, 0, 0]);
  assert.equal(out.tint, '#ffffff');
  assert.equal(out.scale, 2);
});

test('sanitizeGlass: does not alias the fallback position/rotationOffset arrays', () => {
  const out = sanitizeGlass(null, FALLBACK_GLASS);
  out.position[0] = 99;
  assert.deepEqual(FALLBACK_GLASS.position, [0, 0, 0]);
});

test('sanitizeShotCam: use flag + numeric fields', () => {
  const fb = { use: false, az: 24, el: 12, dist: 3.2, fov: 40 };
  assert.deepEqual(sanitizeShotCam({ use: true, fov: 'wide' }, fb), { use: true, az: 24, el: 12, dist: 3.2, fov: 40 });
});

const FALLBACK_FX = { bloom: false, bloomStrength: 0.55, bloomThreshold: 0.8, grain: 0, vignette: 0, treatment: 'none', t1: 8, t2: 45, t3: 1, colA: '#101014', colB: '#f4f1ea' };
const TREATMENT_IDS = ['none', 'halftone', 'riso-duotone'];

test('sanitizeFx: treatment enum, hex colors, numeric params all validated independently', () => {
  const out = sanitizeFx({ treatment: 'halftone', colA: '#000000', colB: 'not-hex', t1: 12 }, FALLBACK_FX, { treatmentIds: TREATMENT_IDS });
  assert.equal(out.treatment, 'halftone');
  assert.equal(out.colA, '#000000');
  assert.equal(out.colB, FALLBACK_FX.colB, 'invalid color falls back to current');
  assert.equal(out.t1, 12);
});

test('sanitizeFx: unknown treatment id is rejected, everything else in the object still applies', () => {
  const out = sanitizeFx({ treatment: 'made-up-treatment', grain: 0.5 }, FALLBACK_FX, { treatmentIds: TREATMENT_IDS });
  assert.equal(out.treatment, FALLBACK_FX.treatment);
  assert.equal(out.grain, 0.5);
});

const FALLBACK_CAN = { on: true, color: '#ffffff', intensity: 1.6, az: 35, el: 40 };

test('sanitizeCan: a well-formed can passes through untouched', () => {
  const can = { on: false, color: '#ff0000', intensity: 2, az: -90, el: 10 };
  assert.deepEqual(sanitizeCan(can, FALLBACK_CAN), can);
});

test('sanitizeCan: null/undefined can — THE exact reproduction from the blocked review — falls back to a well-formed can instead of crashing', () => {
  assert.deepEqual(sanitizeCan(null, FALLBACK_CAN), FALLBACK_CAN);
  assert.deepEqual(sanitizeCan(undefined, FALLBACK_CAN), FALLBACK_CAN);
});

test('sanitizeCan: a partially-malformed can keeps its valid members and falls back per-member for the rest', () => {
  const out = sanitizeCan({ on: 'yes', color: '#00ff00', intensity: 'bright' }, FALLBACK_CAN);
  assert.equal(out.on, FALLBACK_CAN.on, 'non-boolean on falls back');
  assert.equal(out.color, '#00ff00', 'valid color still applies');
  assert.equal(out.intensity, FALLBACK_CAN.intensity, 'non-number intensity falls back');
  assert.equal(out.az, FALLBACK_CAN.az);
  assert.equal(out.el, FALLBACK_CAN.el);
});

const FALLBACK_CANS = [
  { on: true, color: '#ffffff', intensity: 1.6, az: 35, el: 40 },
  { on: true, color: '#88ffee', intensity: 0.6, az: -140, el: 15 },
  { on: false, color: '#ffffff', intensity: 1, az: -35, el: 20 },
  { on: false, color: '#ffffff', intensity: 1, az: 180, el: 60 },
];

test('sanitizeLightCans: the EXACT blocked-review reproduction — [null,null,null,null] — returns four well-formed cans, not a crash-inducing array of nulls', () => {
  const out = sanitizeLightCans([null, null, null, null], FALLBACK_CANS);
  assert.equal(out.length, 4);
  out.forEach((c, i) => {
    assert.equal(typeof c.on, 'boolean');
    assert.equal(typeof c.color, 'string');
    assert.equal(typeof c.intensity, 'number');
    assert.deepEqual(c, FALLBACK_CANS[i]);
  });
});

test('sanitizeLightCans: mixed valid/invalid cans in the same array — good cans keep their data, bad ones fall back per-index', () => {
  const raw = [
    { on: false, color: '#123456', intensity: 3, az: 0, el: 0 },
    null,
    { on: 'not-a-bool' },
    undefined,
  ];
  const out = sanitizeLightCans(raw, FALLBACK_CANS);
  assert.deepEqual(out[0], { on: false, color: '#123456', intensity: 3, az: 0, el: 0 });
  assert.deepEqual(out[1], FALLBACK_CANS[1]);
  assert.deepEqual(out[2], FALLBACK_CANS[2]);
  assert.deepEqual(out[3], FALLBACK_CANS[3]);
});

test('sanitizeLightCans: wrong length or wrong top-level type rejects the whole array back to fallback', () => {
  assert.deepEqual(sanitizeLightCans([FALLBACK_CANS[0], FALLBACK_CANS[1]], FALLBACK_CANS), FALLBACK_CANS);
  assert.deepEqual(sanitizeLightCans('not an array', FALLBACK_CANS), FALLBACK_CANS);
  assert.deepEqual(sanitizeLightCans(null, FALLBACK_CANS), FALLBACK_CANS);
});

// Regression for Codex blocker 2 (2026-07-23T18:24:04Z): elementLocks is read
// downstream as `Boolean(elementLocks[id]?.locked)` — Boolean("yes") is true,
// so a non-boolean `locked` value would silently be treated as a real lock.
const VALID_IDS = ['glass-petal-sphere-1', 'orb-constellation-1'];

test('sanitizeElementLocks: a well-formed locks map passes through unchanged', () => {
  const raw = { 'glass-petal-sphere-1': { locked: true }, 'orb-constellation-1': { locked: false } };
  assert.deepEqual(sanitizeElementLocks(raw, VALID_IDS), raw);
});

test('sanitizeElementLocks: THE exact reproduction — a truthy non-boolean "locked" value is dropped, not coerced to locked:true', () => {
  const raw = { 'glass-petal-sphere-1': { locked: 'yes' } };
  const out = sanitizeElementLocks(raw, VALID_IDS);
  assert.equal(Object.prototype.hasOwnProperty.call(out, 'glass-petal-sphere-1'), false, 'a non-boolean locked value must be dropped entirely, never kept as truthy');
});

test('sanitizeElementLocks: unknown/foreign ids (not in the recipe\'s own restored instances) are dropped', () => {
  const raw = { 'some-id-from-a-different-recipe': { locked: true }, 'glass-petal-sphere-1': { locked: true } };
  const out = sanitizeElementLocks(raw, VALID_IDS);
  assert.deepEqual(out, { 'glass-petal-sphere-1': { locked: true } });
});

test('sanitizeElementLocks: malformed entries (non-object, missing locked) are dropped independently of well-formed ones', () => {
  const raw = { 'glass-petal-sphere-1': 'not an object', 'orb-constellation-1': { locked: true, extra: 'ignored-but-harmless' } };
  const out = sanitizeElementLocks(raw, VALID_IDS);
  assert.deepEqual(out, { 'orb-constellation-1': { locked: true } });
});

test('sanitizeElementLocks: null/non-object raw, or an empty valid-id list, both return an empty object — never throws', () => {
  assert.deepEqual(sanitizeElementLocks(null, VALID_IDS), {});
  assert.deepEqual(sanitizeElementLocks('garbage', VALID_IDS), {});
  assert.deepEqual(sanitizeElementLocks({ 'glass-petal-sphere-1': { locked: true } }, []), {});
});
