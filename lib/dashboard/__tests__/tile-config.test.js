import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeStylePreviewLabel } from '../tile-config.js';

test('sanitizeStylePreviewLabel: empty/whitespace-only input returns null', () => {
  assert.strictEqual(sanitizeStylePreviewLabel(''), null);
  assert.strictEqual(sanitizeStylePreviewLabel('   '), null);
  assert.strictEqual(sanitizeStylePreviewLabel(null), null);
  assert.strictEqual(sanitizeStylePreviewLabel(undefined), null);
});

test('sanitizeStylePreviewLabel: known system-sans aliases normalize to "System UI"', () => {
  assert.strictEqual(sanitizeStylePreviewLabel('Arial'), 'System UI');
  assert.strictEqual(sanitizeStylePreviewLabel('system-ui'), 'System UI');
  assert.strictEqual(sanitizeStylePreviewLabel('Segoe UI'), 'System UI');
});

test('sanitizeStylePreviewLabel: known system-serif aliases normalize to "System Serif"', () => {
  assert.strictEqual(sanitizeStylePreviewLabel('Georgia'), 'System Serif');
  assert.strictEqual(sanitizeStylePreviewLabel('Times New Roman'), 'System Serif');
});

test('sanitizeStylePreviewLabel: strips a trailing hash suffix down to the base font name', () => {
  assert.strictEqual(sanitizeStylePreviewLabel('Roboto_a1b2c3d4'), 'Roboto');
});

test('sanitizeStylePreviewLabel: collapses repeated whitespace and passes through custom names untouched', () => {
  assert.strictEqual(sanitizeStylePreviewLabel('Custom   Font'), 'Custom Font');
  assert.strictEqual(sanitizeStylePreviewLabel('Playfair Display'), 'Playfair Display');
});
