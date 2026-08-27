import test from 'node:test';
import assert from 'node:assert/strict';
import novelArt, { ART_DIRECTIONS, getArtDirection } from '../novel-art.js';

test('Novel Art provides twelve media-free art directions', () => {
  assert.equal(ART_DIRECTIONS.length, 12);
  assert.equal(novelArt.directions.length, 12);
  assert.equal(new Set(ART_DIRECTIONS.map((entry) => entry.id)).size, 12);
});

test('Novel Art clamps art direction values to a valid named direction', () => {
  assert.equal(getArtDirection(-10).id, ART_DIRECTIONS[0].id);
  assert.equal(getArtDirection(999).id, ART_DIRECTIONS.at(-1).id);
  assert.equal(getArtDirection(4.6).id, ART_DIRECTIONS[5].id);
});
