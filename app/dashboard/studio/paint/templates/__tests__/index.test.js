import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, getTemplate, listTemplates, DEFAULT_TEMPLATE_ID } from '../index.js';

test('index: registers every original, editorial, graphic, gradient, and print-plate template', () => {
  const ids = TEMPLATES.map((t) => t.id).sort();
  assert.deepEqual(ids, ['botanical-weave', 'cloud-water', 'editorial-fields', 'gradient-atmospheres', 'graphic-patterns', 'novel-art', 'pigment-burst', 'print-plates', 'watercolour-bloom']);
});

test('index: getTemplate returns the matching template for a known id', () => {
  const t = getTemplate('watercolour-bloom');
  assert.ok(t);
  assert.equal(t.id, 'watercolour-bloom');
});

test('index: getTemplate returns null for an unknown id', () => {
  assert.equal(getTemplate('does-not-exist'), null);
});

test('index: listTemplates returns only id/version/label for every template', () => {
  const list = listTemplates();
  assert.equal(list.length, TEMPLATES.length);
  list.forEach((entry, i) => {
    assert.deepEqual(Object.keys(entry).sort(), ['id', 'label', 'version'].sort());
    assert.equal(entry.id, TEMPLATES[i].id);
    assert.equal(entry.version, TEMPLATES[i].version);
    assert.equal(entry.label, TEMPLATES[i].label);
  });
});

test('index: DEFAULT_TEMPLATE_ID matches the first registered template', () => {
  assert.equal(DEFAULT_TEMPLATE_ID, TEMPLATES[0].id);
  assert.ok(getTemplate(DEFAULT_TEMPLATE_ID));
});
