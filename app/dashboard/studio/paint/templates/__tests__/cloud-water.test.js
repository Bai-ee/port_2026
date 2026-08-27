import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOUD_WATER_DIRECTIONS, getCloudWaterDirection } from '../cloud-water.js';

test('Cloud & Water provides strong cloud and water directions', () => {
  assert.deepEqual(CLOUD_WATER_DIRECTIONS.map((direction) => direction.id), ['cloudbank', 'storm-front', 'tidal-lines', 'deep-current']);
  assert.equal(getCloudWaterDirection(999).id, 'deep-current');
});
