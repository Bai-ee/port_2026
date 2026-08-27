import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BOOK_TYPOGRAPHY, invertHex, isBookFormat, normalizeBookTypography, wrapWords } from '../book-typography.js';

test('book typography: defaults are safe for a normal wallpaper recipe', () => {
  assert.deepEqual(normalizeBookTypography(), DEFAULT_BOOK_TYPOGRAPHY);
});

test('book typography: normalization sanitizes editable copy and color', () => {
  const out = normalizeBookTypography({ enabled: true, headline: '  A\n\nTitle ', subhead: 12, layout: 'nope', spacer: 'bad', color: '#cf1456' });
  assert.equal(out.enabled, true);
  assert.equal(out.headline, 'A Title');
  assert.equal(out.subhead, DEFAULT_BOOK_TYPOGRAPHY.subhead);
  assert.equal(out.layout, 'chapter');
  assert.equal(out.spacer, 'rules');
  assert.equal(out.color, '#cf1456');
});

test('book typography: exposes bounded independent headline and subhead scales', () => {
  const out = normalizeBookTypography({ headlineScale: 99, subheadScale: 0 });
  assert.equal(out.headlineScale, 1.45);
  assert.equal(out.subheadScale, 0.65);
});

test('book typography: defaults to a strong, bounded blur vignette behind copy', () => {
  const out = normalizeBookTypography({ backdrop: { intensity: 9, blur: -1, size: 9, falloff: 0 } });
  assert.equal(out.backdrop.enabled, true);
  assert.equal(out.backdrop.intensity, 1);
  assert.equal(out.backdrop.blur, 0);
  assert.equal(out.backdrop.size, 1.4);
  assert.equal(out.backdrop.falloff, 0.15);
});

test('book typography: inverses a selected copy color for dark artwork', () => {
  assert.equal(invertHex('#1d1711'), '#e2e8ee');
  assert.equal(invertHex('#ffffff'), '#000000');
});

test('book typography: identifies only its book-native formats', () => {
  assert.equal(isBookFormat('book-cover'), true);
  assert.equal(isBookFormat('chapter-page'), true);
  assert.equal(isBookFormat('desktop'), false);
});

test('book typography: wraps word boundaries without dropping words', () => {
  assert.deepEqual(wrapWords('A title for a book', (line) => line.length, 7), ['A title', 'for a', 'book']);
});
