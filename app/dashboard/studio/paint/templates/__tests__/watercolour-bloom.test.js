import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../../elements/randomize.js';
import template, { computeBloomLayout } from '../watercolour-bloom.js';

const { defaults, schema, palettes } = template;

test('watercolour-bloom: template shape sanity', () => {
  assert.equal(template.id, 'watercolour-bloom');
  assert.equal(typeof template.version, 'number');
  assert.equal(typeof template.label, 'string');
  assert.equal(typeof template.render, 'function');
});

test('watercolour-bloom: same seed produces identical layout (determinism)', () => {
  const a = computeBloomLayout(mulberry32(42), defaults.params, 1920, 1080);
  const b = computeBloomLayout(mulberry32(42), defaults.params, 1920, 1080);
  assert.deepEqual(a, b);
});

test('watercolour-bloom: different seeds produce different layout', () => {
  const a = computeBloomLayout(mulberry32(1), defaults.params, 1920, 1080);
  const b = computeBloomLayout(mulberry32(2), defaults.params, 1920, 1080);
  assert.notDeepEqual(a, b);
});

test('watercolour-bloom: layout has the expected shape', () => {
  const layout = computeBloomLayout(mulberry32(7), defaults.params, 1920, 1080);
  assert.ok(Array.isArray(layout.blooms) && layout.blooms.length > 0);
  assert.ok(Array.isArray(layout.stems) && layout.stems.length > 0);
  layout.blooms.forEach((bloom) => {
    assert.equal(typeof bloom.x, 'number');
    assert.equal(typeof bloom.y, 'number');
    assert.ok(bloom.r > 0);
  });
});

test('watercolour-bloom: defaults.params satisfy their own schema.params bounds', () => {
  Object.entries(defaults.params).forEach(([key, value]) => {
    const bounds = schema.params[key];
    assert.ok(bounds, `missing schema bounds for param "${key}"`);
    assert.ok(value >= bounds.min && value <= bounds.max, `${key}=${value} out of [${bounds.min}, ${bounds.max}]`);
    assert.equal(bounds.default, value, `${key} schema default should match defaults.params`);
  });
});

test('watercolour-bloom: every schema.params key has a global-vocabulary bound', () => {
  ['density', 'scale', 'composition', 'texture'].forEach((key) => {
    assert.ok(schema.params[key], `missing global param "${key}"`);
  });
});

test('watercolour-bloom: defaults.paletteId matches a declared palette', () => {
  assert.ok(palettes.some((p) => p.id === defaults.paletteId));
  palettes.forEach((p) => {
    assert.ok(p.colors.length >= 4 && p.colors.length <= 7);
  });
});
