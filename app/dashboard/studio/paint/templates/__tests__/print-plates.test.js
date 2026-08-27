import test from 'node:test';
import assert from 'node:assert/strict';
import plate, { PRINT_PLATE_DIRECTIONS, getPrintPlateDirection } from '../print-plates.js';

test('Print Plates exposes clean motif-and-layout directions for randomized plates', () => {
  assert.equal(PRINT_PLATE_DIRECTIONS.length, 8);
  assert.deepEqual(PRINT_PLATE_DIRECTIONS.map((direction) => direction.id), [
    'flower-ring', 'melon-half-drop', 'rain-cloud-grid', 'lattice-diamond',
    'paisley-fan', 'tulip-mirror', 'sunburst-orbit', 'abstract-block-plate',
  ]);
  assert.equal(plate.id, 'print-plates');
  assert.equal(plate.directions.length, 8);
  assert.deepEqual(plate.schema.params.motif, { min: -1, max: 7, step: 1, default: -1 });
  assert.deepEqual(plate.schema.params.layout, { min: -1, max: 6, step: 1, default: -1 });
  assert.deepEqual(plate.schema.params.rhythm, { min: 0, max: 2, step: 1, default: 0 });
});

test('Print Plates clamps an out-of-range art direction to a real print grammar', () => {
  assert.equal(getPrintPlateDirection(-5).id, 'flower-ring');
  assert.equal(getPrintPlateDirection(99).id, 'abstract-block-plate');
});
