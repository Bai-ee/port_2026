import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES } from '../templates/index.js';
import { buildStartOptions, createRandomStart } from '../variation.js';

test('randomizer exposes all forty-five ready-to-go starts', () => {
  const starts = buildStartOptions(TEMPLATES);
  assert.equal(starts.length, 45);
  assert.equal(new Set(starts.map((start) => start.key)).size, 45);
});

test('randomizer picks a different start and preserves the output format', () => {
  // This deterministic stream chooses a Novel Art direction after excluding
  // Watercolour Bloom, then gives every numeric value a valid in-range level.
  const values = [0.2, 0.4, 0.6, 0.8, 0.1, 0.3, 0.5, 0.7, 0.9, 0.25];
  let i = 0;
  const random = () => values[(i++) % values.length];
  const result = createRandomStart({ templateId: 'watercolour-bloom', output: { formatId: 'mobile' } }, TEMPLATES, random);
  assert.equal(result.output.formatId, 'mobile');
  assert.notEqual(result.templateId, 'watercolour-bloom');
  const template = TEMPLATES.find((entry) => entry.id === result.templateId);
  Object.entries(template.schema.params).forEach(([key, bounds]) => {
    assert.ok(result.params[key] >= bounds.min && result.params[key] <= bounds.max, `${key} is in range`);
  });
});
