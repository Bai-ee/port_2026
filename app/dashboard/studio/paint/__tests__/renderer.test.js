import test from 'node:test';
import assert from 'node:assert/strict';
import { PAINT_RENDERER_REVISION, mountPaintPreview, renderRecipeToCanvas } from '../renderer.js';

// Smoke-level only: full p5/DOM canvas rendering needs a real browser and is
// out of scope for `node --test` here (no jsdom/canvas polyfills added).
// Manual/browser verification of actual drawing is a later integration pass.

test('renderer: exports a positive integer revision', () => {
  assert.equal(typeof PAINT_RENDERER_REVISION, 'number');
  assert.ok(Number.isInteger(PAINT_RENDERER_REVISION));
  assert.ok(PAINT_RENDERER_REVISION > 0);
});

test('renderer: exports the expected function contract', () => {
  assert.equal(typeof mountPaintPreview, 'function');
  assert.equal(typeof renderRecipeToCanvas, 'function');
});

test('renderer: mountPaintPreview rejects a missing container', () => {
  assert.throws(() => mountPaintPreview(null, { template: {}, recipe: { seed: 1, output: { width: 10, height: 10 } } }));
});

test('renderer: renderRecipeToCanvas rejects outside a DOM environment', async () => {
  await assert.rejects(() => renderRecipeToCanvas({ seed: 1, output: { width: 10, height: 10 } }, {}));
});
