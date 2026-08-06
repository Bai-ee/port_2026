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
  assert.equal(inst.finalRenderSupported, true, 'flipped by the Phase 5 glass-parity pass — the server renderer consumes the primary glass now');
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
  assert.deepEqual(Object.keys(inst.material).sort(), ['clarity', 'tint', 'transmission']);
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
  assert.deepEqual(defaults.material, { tint: '#ffffff', clarity: 0.06, transmission: 1 });
  assert.equal(getElementDefaults('not-a-type'), null);
});

// ── transmission (TRANSPARENCY) — Codex visual-correction round. Same
// schema/catalog wiring every other material field already goes through;
// these prove `transmission` specifically reached that boundary correctly. ─

test('createElementInstance: glass-petal-sphere defaults material.transmission to 1 — the backward-compatible "as transparent as the material was already hardcoded to" value', () => {
  const inst = createElementInstance('glass-petal-sphere', { id: 'g1' });
  assert.equal(inst.material.transmission, 1);
});

test('normalizeElementInstance: transmission overrides win and are clamped to the catalog\'s [0,1] bound, independently of clarity', () => {
  const inst = normalizeElementInstance({ material: { transmission: 0.35, clarity: 0.02 } }, 'glass-petal-sphere');
  assert.equal(inst.material.transmission, 0.35);
  assert.equal(inst.material.clarity, 0.02);
  const clamped = normalizeElementInstance({ material: { transmission: 5 } }, 'glass-petal-sphere');
  assert.equal(clamped.material.transmission, 1, 'transmission clamps to its catalog max, same as every other bounded numeric field');
});

// ── device-mockup captureSourceUrl/captureViewport (Recovery round 2,
// Defect 1) — the element-instance equivalent of devicePrimary's own
// capture-provenance fields (ClothStudio.jsx DEFAULT_DEVICE_PRIMARY). Same
// fieldSpec/normalize treatment captureUrl/uploadAssetId already get. ──

test('createElementInstance: device-mockup defaults captureSourceUrl/captureViewport to empty strings, alongside captureUrl/uploadAssetId', () => {
  const inst = createElementInstance('device-mockup', { id: 'd1' });
  assert.equal(inst.appearance.captureUrl, '');
  assert.equal(inst.appearance.uploadAssetId, '');
  assert.equal(inst.appearance.captureSourceUrl, '');
  assert.equal(inst.appearance.captureViewport, '');
});

test('normalizeElementInstance: device-mockup captureSourceUrl/captureViewport round-trip through normalize exactly like captureUrl', () => {
  const inst = normalizeElementInstance({
    appearance: { captureUrl: '/api/public/studio-device-capture?id=x', captureSourceUrl: 'https://example.com', captureViewport: 'mobile' },
  }, 'device-mockup');
  assert.equal(inst.appearance.captureUrl, '/api/public/studio-device-capture?id=x');
  assert.equal(inst.appearance.captureSourceUrl, 'https://example.com');
  assert.equal(inst.appearance.captureViewport, 'mobile');
});

test('normalizeElementInstance: device-mockup — a legacy instance saved BEFORE this round (no captureSourceUrl/captureViewport keys at all) normalizes to the safe empty-string default, never throws or leaves them undefined', () => {
  const inst = normalizeElementInstance({
    appearance: { viewport: 'desktop', captureUrl: '/api/public/studio-device-capture?id=legacy', uploadAssetId: '' },
  }, 'device-mockup');
  assert.equal(inst.appearance.captureUrl, '/api/public/studio-device-capture?id=legacy', 'the legacy field itself is untouched');
  assert.equal(inst.appearance.captureSourceUrl, '', 'absent provenance normalizes to the safe default, never undefined');
  assert.equal(inst.appearance.captureViewport, '');
});

test('normalizeElementInstance: device-mockup captureSourceUrl is length-capped (2048) and captureViewport (16), same bounded-string discipline as every other free string field', () => {
  const inst = normalizeElementInstance({
    appearance: { captureSourceUrl: 'x'.repeat(3000), captureViewport: 'y'.repeat(50) },
  }, 'device-mockup');
  assert.equal(inst.appearance.captureSourceUrl.length, 2048);
  assert.equal(inst.appearance.captureViewport.length, 16);
});
