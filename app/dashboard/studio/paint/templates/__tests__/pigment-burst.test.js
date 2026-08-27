import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../../elements/randomize.js';
import template, { computeBurstLayout } from '../pigment-burst.js';

const { defaults, schema, palettes } = template;

test('pigment-burst: template shape sanity', () => {
  assert.equal(template.id, 'pigment-burst');
  assert.equal(typeof template.version, 'number');
  assert.equal(typeof template.label, 'string');
  assert.equal(typeof template.render, 'function');
});

test('pigment-burst: same seed produces identical layout (determinism)', () => {
  const a = computeBurstLayout(mulberry32(42), defaults.params, 1920, 1080);
  const b = computeBurstLayout(mulberry32(42), defaults.params, 1920, 1080);
  assert.deepEqual(a, b);
});

test('pigment-burst: different seeds produce different layout', () => {
  const a = computeBurstLayout(mulberry32(1), defaults.params, 1920, 1080);
  const b = computeBurstLayout(mulberry32(2), defaults.params, 1920, 1080);
  assert.notDeepEqual(a, b);
});

test('pigment-burst: particleCount/confettiAmount respect hard ceilings at max param values and largest export size', () => {
  const maxedParams = { ...defaults.params, particleCount: 1, confettiAmount: 1, density: 1 };
  const layout = computeBurstLayout(mulberry32(3), maxedParams, 2560, 1440);
  assert.ok(layout.particles.length <= 550, `expected <=550 particles, got ${layout.particles.length}`);
  assert.ok(layout.confetti.length <= 90, `expected <=90 confetti marks, got ${layout.confetti.length}`);
});

test('pigment-burst: layout has the expected shape', () => {
  const layout = computeBurstLayout(mulberry32(7), defaults.params, 1920, 1080);
  assert.equal(typeof layout.center.x, 'number');
  assert.equal(typeof layout.center.y, 'number');
  assert.ok(Array.isArray(layout.coreBlobs) && layout.coreBlobs.length > 0);
  assert.ok(Array.isArray(layout.particles) && layout.particles.length > 0);
  assert.ok(Array.isArray(layout.confetti));
});

test('pigment-burst: defaults.params satisfy their own schema.params bounds', () => {
  Object.entries(defaults.params).forEach(([key, value]) => {
    const bounds = schema.params[key];
    assert.ok(bounds, `missing schema bounds for param "${key}"`);
    assert.ok(value >= bounds.min && value <= bounds.max, `${key}=${value} out of [${bounds.min}, ${bounds.max}]`);
    assert.equal(bounds.default, value, `${key} schema default should match defaults.params`);
  });
});

test('pigment-burst: every schema.params key has a global-vocabulary bound', () => {
  ['density', 'scale', 'composition', 'texture'].forEach((key) => {
    assert.ok(schema.params[key], `missing global param "${key}"`);
  });
});

test('pigment-burst: defaults.paletteId matches a declared palette', () => {
  assert.ok(palettes.some((p) => p.id === defaults.paletteId));
  palettes.forEach((p) => {
    assert.ok(p.colors.length >= 4 && p.colors.length <= 7);
  });
});
