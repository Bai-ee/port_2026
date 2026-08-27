import test from 'node:test';
import assert from 'node:assert/strict';
import { PAINT_OUTPUT_FORMATS, DEFAULT_PAINT_FORMAT_ID, getPaintFormat } from '../output-formats.js';

test('every format has a positive integer w/h, a label, and a unique id', () => {
  const ids = new Set();
  PAINT_OUTPUT_FORMATS.forEach((format) => {
    assert.ok(Number.isInteger(format.w) && format.w > 0, `${format.id} w must be a positive integer`);
    assert.ok(Number.isInteger(format.h) && format.h > 0, `${format.id} h must be a positive integer`);
    assert.ok(typeof format.label === 'string' && format.label.length > 0);
    ids.add(format.id);
  });
  assert.equal(ids.size, PAINT_OUTPUT_FORMATS.length, 'format ids must be unique');
});

test('DEFAULT_PAINT_FORMAT_ID matches a real entry in PAINT_OUTPUT_FORMATS', () => {
  assert.ok(PAINT_OUTPUT_FORMATS.some((format) => format.id === DEFAULT_PAINT_FORMAT_ID));
});

test('getPaintFormat: returns the exact matching entry by id', () => {
  const format = getPaintFormat('mobile');
  assert.equal(format.id, 'mobile');
  assert.equal(format.w, 1170);
  assert.equal(format.h, 2532);
});

test('getPaintFormat: falls back to the default format for an unknown id', () => {
  const fallback = getPaintFormat('not-a-real-format-id');
  const def = getPaintFormat(DEFAULT_PAINT_FORMAT_ID);
  assert.deepEqual(fallback, def);
});

test('getPaintFormat: falls back to the default format when called with no id at all', () => {
  const fallback = getPaintFormat();
  assert.equal(fallback.id, DEFAULT_PAINT_FORMAT_ID);
});

test('getPaintFormat: includes production portrait book formats', () => {
  assert.deepEqual(getPaintFormat('book-cover'), { id: 'book-cover', label: 'BOOK COVER', w: 1600, h: 2560 });
  assert.deepEqual(getPaintFormat('chapter-page'), { id: 'chapter-page', label: 'CHAPTER PAGE', w: 1800, h: 2700 });
});
