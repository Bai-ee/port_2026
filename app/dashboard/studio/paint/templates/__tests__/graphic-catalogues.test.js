import test from 'node:test';
import assert from 'node:assert/strict';
import { GRAPHIC_DIRECTIONS, getGraphicDirection } from '../graphic-patterns.js';
import { ATMOSPHERE_DIRECTIONS, getAtmosphereDirection } from '../gradient-atmospheres.js';

test('Graphic Patterns exposes unmistakable block, square, shape, and grid directions', () => {
  assert.equal(GRAPHIC_DIRECTIONS.length, 6);
  assert.deepEqual(GRAPHIC_DIRECTIONS.map((direction) => direction.id), ['brutalist-poster', 'stacked-monoliths', 'checker-geometry', 'dot-matrix', 'signal-shapes', 'offset-grid']);
  assert.equal(getGraphicDirection(999).id, 'offset-grid');
});

test('Gradient Atmospheres exposes a dedicated cloud and gradient catalogue', () => {
  assert.equal(ATMOSPHERE_DIRECTIONS.length, 6);
  assert.equal(getAtmosphereDirection(0).id, 'cumulus-clouds');
  assert.equal(getAtmosphereDirection(999).id, 'ink-bloom');
});
