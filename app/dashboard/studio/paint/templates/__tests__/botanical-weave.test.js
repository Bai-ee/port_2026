import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../../elements/randomize.js';
import template, { computeWeaveLayout } from '../botanical-weave.js';

const { defaults, schema, palettes } = template;

test('botanical-weave: template shape sanity', () => {
  assert.equal(template.id, 'botanical-weave');
  assert.equal(typeof template.version, 'number');
  assert.equal(typeof template.label, 'string');
  assert.equal(typeof template.render, 'function');
});

test('botanical-weave: same seed produces identical layout (determinism)', () => {
  const a = computeWeaveLayout(mulberry32(42), defaults.params, 1920, 1080);
  const b = computeWeaveLayout(mulberry32(42), defaults.params, 1920, 1080);
  assert.deepEqual(a, b);
});

test('botanical-weave: different seeds produce different layout', () => {
  const a = computeWeaveLayout(mulberry32(1), defaults.params, 1920, 1080);
  const b = computeWeaveLayout(mulberry32(2), defaults.params, 1920, 1080);
  assert.notDeepEqual(a, b);
});

test('botanical-weave: layout has the expected shape and blossoms reference valid branches', () => {
  const layout = computeWeaveLayout(mulberry32(7), defaults.params, 1920, 1080);
  assert.ok(Array.isArray(layout.branches) && layout.branches.length > 0);
  assert.ok(Array.isArray(layout.blossoms) && layout.blossoms.length > 0);
  layout.blossoms.forEach((bloom) => {
    assert.ok(bloom.branchIndex >= 0 && bloom.branchIndex < layout.branches.length);
    assert.ok(bloom.t >= 0 && bloom.t <= 1);
  });
});

test('botanical-weave: defaults.params satisfy their own schema.params bounds', () => {
  Object.entries(defaults.params).forEach(([key, value]) => {
    const bounds = schema.params[key];
    assert.ok(bounds, `missing schema bounds for param "${key}"`);
    assert.ok(value >= bounds.min && value <= bounds.max, `${key}=${value} out of [${bounds.min}, ${bounds.max}]`);
    assert.equal(bounds.default, value, `${key} schema default should match defaults.params`);
  });
});

test('botanical-weave: every schema.params key has a global-vocabulary bound', () => {
  ['density', 'scale', 'composition', 'texture'].forEach((key) => {
    assert.ok(schema.params[key], `missing global param "${key}"`);
  });
});

test('botanical-weave: defaults.paletteId matches a declared palette', () => {
  assert.ok(palettes.some((p) => p.id === defaults.paletteId));
  palettes.forEach((p) => {
    assert.ok(p.colors.length >= 4 && p.colors.length <= 7);
  });
});
