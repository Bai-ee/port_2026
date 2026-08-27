import test from 'node:test';
import assert from 'node:assert/strict';
import editorialFields, { FIELD_DIRECTIONS, getFieldDirection } from '../editorial-fields.js';

test('Editorial Fields provides six distinct media-free composition directions', () => {
  assert.equal(FIELD_DIRECTIONS.length, 6);
  assert.equal(editorialFields.directions.length, 6);
  assert.equal(new Set(FIELD_DIRECTIONS.map((entry) => entry.id)).size, 6);
});

test('Editorial Fields clamps its selected direction', () => {
  assert.equal(getFieldDirection(-3).id, FIELD_DIRECTIONS[0].id);
  assert.equal(getFieldDirection(200).id, FIELD_DIRECTIONS.at(-1).id);
});
