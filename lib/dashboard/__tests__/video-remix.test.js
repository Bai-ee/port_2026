import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRemixRecipe,
  formatVideoRemixBytes,
  normalizeVideoRemixFolderDetails,
} from '../video-remix.js';

test('formatVideoRemixBytes: zero/invalid returns 0 B', () => {
  assert.strictEqual(formatVideoRemixBytes(0), '0 B');
  assert.strictEqual(formatVideoRemixBytes(null), '0 B');
  assert.strictEqual(formatVideoRemixBytes(NaN), '0 B');
  assert.strictEqual(formatVideoRemixBytes(-5), '0 B');
});

test('formatVideoRemixBytes: picks the right unit at each threshold', () => {
  assert.strictEqual(formatVideoRemixBytes(512), '512 B');
  assert.strictEqual(formatVideoRemixBytes(2048), '2.0 KB');
  assert.strictEqual(formatVideoRemixBytes(5 * 1024 * 1024), '5.0 MB');
  assert.strictEqual(formatVideoRemixBytes(3 * 1024 * 1024 * 1024), '3.0 GB');
});

test('buildRemixRecipe: house defaults produce the standard recipe shape', () => {
  const recipe = buildRemixRecipe(undefined, ['folder-a']);
  assert.strictEqual(recipe.artist, null); // 'random' maps to null
  assert.strictEqual(recipe.mixTitle, null);
  assert.deepStrictEqual(recipe.filter, { key: 'look_hard_bw_street_doc', intensity: 0.8 });
  assert.deepStrictEqual(recipe.overlay, { enabled: false });
  assert.deepStrictEqual(recipe.logos, { top: 'ue_barcode_white.png', end: 'mixtapes_white_square.png' });
  assert.strictEqual(recipe.endCard, null);
  assert.deepStrictEqual(recipe.sourceFolders, ['folder-a']);
});

test('buildRemixRecipe: named artist, overlay, and end text branch correctly', () => {
  const recipe = buildRemixRecipe({
    artist: 'DJ Test',
    mixTitle: 'My Mix',
    videoFilter: 'random',
    filterIntensity: 0.5,
    enableOverlay: true,
    overlayEffect: 'grain',
    endTextOverlay: 'Thanks for watching',
  }, ['a', 'b']);
  assert.strictEqual(recipe.artist, 'DJ Test');
  assert.strictEqual(recipe.mixTitle, 'My Mix');
  // videoFilter 'random' means no key, only intensity
  assert.deepStrictEqual(recipe.filter, { intensity: 0.5 });
  assert.deepStrictEqual(recipe.overlay, { enabled: true, effect: 'grain' });
  assert.deepStrictEqual(recipe.endCard, { text: 'Thanks for watching' });
});

test('buildRemixRecipe: falls back to settings.selectedFolders when sourceFolders is not an array', () => {
  const recipe = buildRemixRecipe({ selectedFolders: ['only-this'] }, undefined);
  assert.deepStrictEqual(recipe.sourceFolders, ['only-this']);
});

test('normalizeVideoRemixFolderDetails: string entries become root folders', () => {
  const out = normalizeVideoRemixFolderDetails(['mixtapes']);
  assert.deepStrictEqual(out, [{ name: 'mixtapes', displayName: 'mixtapes', count: null, type: 'root' }]);
});

test('normalizeVideoRemixFolderDetails: object entries preserve count/type and coerce fields', () => {
  const out = normalizeVideoRemixFolderDetails([
    { name: 'clips', displayName: 'Clips Folder', count: '12', type: 'sub' },
    { name: '', displayName: 'ignored' }, // filtered out: no name
  ]);
  assert.deepStrictEqual(out, [{ name: 'clips', displayName: 'Clips Folder', count: 12, type: 'sub' }]);
});

test('normalizeVideoRemixFolderDetails: non-array input returns empty array', () => {
  assert.deepStrictEqual(normalizeVideoRemixFolderDetails(null), []);
  assert.deepStrictEqual(normalizeVideoRemixFolderDetails(undefined), []);
});
