import test from 'node:test';
import assert from 'node:assert/strict';
import { createElementInstance, normalizeElementInstance, getElementDefaults, ELEMENT_SCHEMA_VERSION } from '../schema.js';

test('createElementInstance: glass-petal-sphere gets full catalog defaults', () => {
  const inst = createElementInstance('glass-petal-sphere', { id: 'g1' });
  assert.equal(inst.id, 'g1');
  assert.equal(inst.type, 'glass-petal-sphere');
  assert.equal(inst.version, ELEMENT_SCHEMA_VERSION);
  assert.equal(inst.enabled, false);
  assert.equal(inst.depth, 'hero');
  assert.deepEqual(inst.transform.position, [0, 0, 0]);
  assert.deepEqual(inst.transform.rotation, [0, 0, 0]);
  assert.deepEqual(inst.transform.scale, [1, 1, 1]);
  assert.equal(inst.material.tint, '#ffffff');
  assert.equal(inst.motion.rotate, true);
  assert.equal(inst.previewSupported, true);
  assert.equal(inst.finalRenderSupported, false);
});

test('normalizeElementInstance: known overrides win', () => {
  const inst = normalizeElementInstance({ id: 'g1', enabled: true, material: { tint: '#ff0000' } }, 'glass-petal-sphere');
  assert.equal(inst.enabled, true);
  assert.equal(inst.material.tint, '#ff0000');
  assert.equal(inst.material.clarity, 0.06); // default preserved
});

test('normalizeElementInstance: unknown top-level fields do not leak through', () => {
  const inst = normalizeElementInstance({ id: 'g1', bogusTopLevel: 1 }, 'glass-petal-sphere');
  assert.equal(inst.bogusTopLevel, undefined);
});

test('normalizeElementInstance: unknown NESTED fields in every bucket are stripped', () => {
  const inst = normalizeElementInstance({
    material: { tint: '#ff0000', evilInject: 'x' },
    motion: { rotate: true, evilInject: 'x' },
    appearance: { evilInject: 'x' },
    transform: { scale: [1, 1, 1], evilInject: 'x' },
    random: { locked: true, groups: { transform: true, evilInject: true } },
  }, 'glass-petal-sphere');
  assert.equal(inst.material.evilInject, undefined);
  assert.equal(inst.motion.evilInject, undefined);
  assert.equal(inst.appearance.evilInject, undefined);
  assert.equal(inst.transform.evilInject, undefined);
  assert.equal(inst.random.groups.evilInject, undefined);
  assert.deepEqual(Object.keys(inst.material).sort(), ['clarity', 'tint']);
  assert.deepEqual(Object.keys(inst.motion).sort(), ['rotSpeed', 'rotate']);
  assert.deepEqual(Object.keys(inst.appearance).sort(), []);
  assert.deepEqual(Object.keys(inst.transform).sort(), ['position', 'rotation', 'scale']);
});

test('normalizeElementInstance: out-of-range numeric fields are clamped to catalog bounds, not passed through', () => {
  const inst = normalizeElementInstance({
    material: { clarity: 99 },
    motion: { rotSpeed: -50 },
    transform: { scale: [50, 50, 50], position: [999, -999, 0], rotation: [999, -999, 0] },
  }, 'glass-petal-sphere');
  assert.equal(inst.material.clarity, 0.4); // max
  assert.equal(inst.motion.rotSpeed, 0.05); // min
  assert.deepEqual(inst.transform.scale, [2.2, 2.2, 2.2]); // max
  assert.deepEqual(inst.transform.position, [1.5, -1.5, 0]); // clamped to [-1.5,1.5]
  assert.deepEqual(inst.transform.rotation, [180, -180, 0]); // clamped to [-180,180]
});

test('normalizeElementInstance: invalid color/boolean/vector fall back to defaults, do not pass through', () => {
  const inst = normalizeElementInstance({
    material: { tint: 'not-a-color' },
    motion: { rotate: 'yes-please' },
    transform: { scale: ['bad', 'bad', 'bad'] },
  }, 'glass-petal-sphere');
  assert.equal(inst.material.tint, '#ffffff');
  assert.equal(inst.motion.rotate, true);
  assert.deepEqual(inst.transform.scale, [1, 1, 1]);
});

test('normalizeElementInstance: raw.quality is always ignored — catalog is the only source of cost/tier', () => {
  const inst = normalizeElementInstance({ quality: { minTier: 'ultra', estimatedCost: 999999 } }, 'glass-petal-sphere');
  assert.equal(inst.quality.minTier, 'draft');
  assert.equal(inst.quality.estimatedCost, 6);
});

test('normalizeElementInstance: random.locked strictly requires a boolean, does not coerce truthy strings', () => {
  const inst = normalizeElementInstance({ random: { locked: 'false' } }, 'glass-petal-sphere');
  assert.equal(inst.random.locked, false); // 'false' is a non-boolean -> falls back to default, not Boolean('false')===true
});

test('normalizeElementInstance: unknown element type is an explicit unsupported instance, not a throw', () => {
  const inst = normalizeElementInstance({ id: 'x1', name: 'Mystery' }, 'not-a-real-type');
  assert.equal(inst.unsupported, true);
  assert.equal(inst.enabled, false);
  assert.equal(inst.name, 'Mystery');
});

test('normalizeElementInstance: settings-migration case — old saved state with no element fields still normalizes', () => {
  const inst = normalizeElementInstance({}, 'glass-petal-sphere');
  assert.equal(inst.type, 'glass-petal-sphere');
  assert.equal(inst.random.locked, false);
  assert.deepEqual(inst.random.groups, { transform: false, material: false, motion: false, appearance: false });
});

test('getElementDefaults: mirrors the catalog field spec defaults', () => {
  const defaults = getElementDefaults('glass-petal-sphere');
  assert.deepEqual(defaults.transform.position, [0, 0, 0]);
  assert.deepEqual(defaults.material, { tint: '#ffffff', clarity: 0.06 });
  assert.equal(getElementDefaults('not-a-type'), null);
});
