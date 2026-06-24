'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeFolderName, validateRemixRecipe, V1_OUTPUT } = require('../media-recipe.cjs');

// --- sanitizeFolderName ----------------------------------------------------

test('sanitizeFolderName accepts allowlisted segments', () => {
  assert.equal(sanitizeFolderName('skyline'), 'skyline');
  assert.equal(sanitizeFolderName('my_folder-2'), 'my_folder-2');
  assert.equal(sanitizeFolderName('  trimmed  '), 'trimmed');
});

test('sanitizeFolderName rejects traversal, absolute, separators, empty, bad chars', () => {
  assert.throws(() => sanitizeFolderName('..'), /traversal/);
  assert.throws(() => sanitizeFolderName('../etc'), /separators|traversal/);
  assert.throws(() => sanitizeFolderName('a/../b'), /separators|traversal/);
  assert.throws(() => sanitizeFolderName('/abs'), /separators/);
  assert.throws(() => sanitizeFolderName('a/b'), /separators/);
  assert.throws(() => sanitizeFolderName('a\\b'), /separators/);
  assert.throws(() => sanitizeFolderName(''), /empty/);
  assert.throws(() => sanitizeFolderName('   '), /empty/);
  assert.throws(() => sanitizeFolderName('bad name'), /invalid characters/);
  assert.throws(() => sanitizeFolderName('emoji😀'), /invalid characters/);
  assert.throws(() => sanitizeFolderName('a'.repeat(121)), /invalid characters/);
  assert.throws(() => sanitizeFolderName(42), /must be a string/);
  assert.throws(() => sanitizeFolderName(null), /must be a string/);
});

// --- validateRemixRecipe: happy path + output lock -------------------------

test('validateRemixRecipe normalizes a valid recipe and locks output', () => {
  const out = validateRemixRecipe({
    sourceFolders: ['skyline', 'neighborhood'],
    filter: { key: 'look_hard_bw' },
    overlay: { enabled: true, effect: 'retro_dust' },
    arweaveAudioUrl: 'https://arweave.net/abc',
  });
  assert.equal(out.type, 'video-remix');
  assert.deepEqual(out.sourceFolders, ['skyline', 'neighborhood']);
  assert.deepEqual(out.output, V1_OUTPUT);
  assert.equal(out.output.width, 720);
  assert.equal(out.output.height, 720);
  assert.equal(out.output.fps, 30);
  assert.equal(out.output.durationSeconds, 30);
  assert.equal(out.output.format, 'mp4');
  assert.deepEqual(out.filter, { key: 'look_hard_bw' });
  assert.deepEqual(out.overlay, { enabled: true, effect: 'retro_dust' });
  assert.equal(out.arweaveAudioUrl, 'https://arweave.net/abc');
});

test('validateRemixRecipe forces output overriding client-supplied values', () => {
  const out = validateRemixRecipe({
    sourceFolders: ['a'],
    output: { width: 4096, height: 4096, fps: 120, durationSeconds: 600, format: 'mov' },
  });
  assert.deepEqual(out.output, V1_OUTPUT);
});

test('validateRemixRecipe strips unknown fields', () => {
  const out = validateRemixRecipe({ sourceFolders: ['a'], evil: 'x', logos: ['nope'] });
  assert.deepEqual(Object.keys(out).sort(), ['output', 'sourceFolders', 'type']);
});

// --- sourceFolders validation ----------------------------------------------

test('validateRemixRecipe rejects empty / missing / oversized sourceFolders', () => {
  assert.throws(() => validateRemixRecipe({}), /sourceFolders must be a non-empty array/);
  assert.throws(() => validateRemixRecipe({ sourceFolders: [] }), /non-empty array/);
  assert.throws(() => validateRemixRecipe({ sourceFolders: 'skyline' }), /non-empty array/);
  assert.throws(
    () => validateRemixRecipe({ sourceFolders: Array.from({ length: 26 }, (_, i) => `f${i}`) }),
    /at most 25/
  );
});

test('validateRemixRecipe rejects traversal/absolute folders inside sourceFolders', () => {
  assert.throws(() => validateRemixRecipe({ sourceFolders: ['ok', '..'] }), /traversal/);
  assert.throws(() => validateRemixRecipe({ sourceFolders: ['ok', '../escape'] }), /separators|traversal/);
  assert.throws(() => validateRemixRecipe({ sourceFolders: ['/abs'] }), /separators/);
  assert.throws(() => validateRemixRecipe({ sourceFolders: ['a/b'] }), /separators/);
  assert.throws(() => validateRemixRecipe({ sourceFolders: [''] }), /empty/);
});

test('validateRemixRecipe rejects non-object input', () => {
  assert.throws(() => validateRemixRecipe(null), /must be an object/);
  assert.throws(() => validateRemixRecipe('x'), /must be an object/);
  assert.throws(() => validateRemixRecipe(['a']), /must be an object/);
});

// --- arweaveAudioUrl --------------------------------------------------------

test('validateRemixRecipe accepts allowed https audio hosts', () => {
  for (const url of [
    'https://arweave.net/abc',
    'https://firebasestorage.googleapis.com/v0/b/x/o/y',
    'https://storage.googleapis.com/bucket/audio.mp3',
  ]) {
    const out = validateRemixRecipe({ sourceFolders: ['a'], arweaveAudioUrl: url });
    assert.equal(out.arweaveAudioUrl, url);
  }
});

test('validateRemixRecipe rejects bad audio scheme/host and slices length', () => {
  assert.throws(
    () => validateRemixRecipe({ sourceFolders: ['a'], arweaveAudioUrl: 'http://arweave.net/abc' }),
    /https/
  );
  assert.throws(
    () => validateRemixRecipe({ sourceFolders: ['a'], arweaveAudioUrl: 'https://evil.example.com/x' }),
    /host is not allowed/
  );
  assert.throws(
    () => validateRemixRecipe({ sourceFolders: ['a'], arweaveAudioUrl: 'not-a-url' }),
    /valid URL/
  );
  const long = `https://arweave.net/${'a'.repeat(500)}`;
  const out = validateRemixRecipe({ sourceFolders: ['a'], arweaveAudioUrl: long });
  assert.equal(out.arweaveAudioUrl.length, 400);
});

// --- filter / overlay keys --------------------------------------------------

test('validateRemixRecipe rejects bad filter/overlay keys', () => {
  assert.throws(
    () => validateRemixRecipe({ sourceFolders: ['a'], filter: { key: 'bad key!' } }),
    /filter.key/
  );
  assert.throws(
    () => validateRemixRecipe({ sourceFolders: ['a'], overlay: { enabled: true, effect: 'bad-effect!' } }),
    /overlay.effect/
  );
});

test('validateRemixRecipe ignores disabled overlay and omits empty filter', () => {
  const out = validateRemixRecipe({
    sourceFolders: ['a'],
    overlay: { enabled: false, effect: 'whatever!' },
    filter: {},
  });
  assert.equal(out.overlay, undefined);
  assert.equal(out.filter, undefined);
});

// --- Video Remix params: artist / mix / trax / intensity / logos / endCard ---

test('validateRemixRecipe carries through valid params tab fields', () => {
  const out = validateRemixRecipe({
    sourceFolders: ['skyline'],
    artist: 'Bai-ee',
    mixTitle: 'Live at The Loft 2024',
    useTrax: true,
    useArtistImage: true,
    filter: { key: 'look_hard_bw_street_doc', intensity: 0.5 },
    overlay: { enabled: true, effect: 'random' },
    logos: { top: 'ue_barcode_black.png', end: 'serial_logo.png' },
    endCard: { text: 'thanks for watching' },
  });
  assert.equal(out.artist, 'Bai-ee');
  assert.equal(out.mixTitle, 'Live at The Loft 2024');
  assert.equal(out.useTrax, true);
  assert.equal(out.useArtistImage, true);
  assert.deepEqual(out.filter, { key: 'look_hard_bw_street_doc', intensity: 0.5 });
  assert.deepEqual(out.overlay, { enabled: true, effect: 'random' });
  assert.deepEqual(out.logos, { top: 'ue_barcode_black.png', end: 'serial_logo.png' });
  assert.deepEqual(out.endCard, { text: 'thanks for watching' });
});

test('validateRemixRecipe rejects a bad artist name', () => {
  assert.throws(
    () => validateRemixRecipe({ sourceFolders: ['a'], artist: 'bad/artist!' }),
    /artist has invalid characters/
  );
});

test('validateRemixRecipe rejects a bad overlay effect but allows random', () => {
  assert.throws(
    () => validateRemixRecipe({ sourceFolders: ['a'], overlay: { enabled: true, effect: 'BAD-EFFECT' } }),
    /overlay.effect/
  );
  const out = validateRemixRecipe({ sourceFolders: ['a'], overlay: { enabled: true, effect: 'random' } });
  assert.deepEqual(out.overlay, { enabled: true, effect: 'random' });
});

test('validateRemixRecipe rejects a bad logo filename', () => {
  assert.throws(
    () => validateRemixRecipe({ sourceFolders: ['a'], logos: { top: 'has space.png' } }),
    /logos.top/
  );
  assert.throws(
    () => validateRemixRecipe({ sourceFolders: ['a'], logos: { end: '../evil.png' } }),
    /logos.end/
  );
});

test('validateRemixRecipe validates filter intensity range', () => {
  assert.throws(
    () => validateRemixRecipe({ sourceFolders: ['a'], filter: { intensity: 1.5 } }),
    /filter.intensity/
  );
  assert.throws(
    () => validateRemixRecipe({ sourceFolders: ['a'], filter: { intensity: -0.1 } }),
    /filter.intensity/
  );
  const out = validateRemixRecipe({ sourceFolders: ['a'], filter: { intensity: 0 } });
  assert.deepEqual(out.filter, { intensity: 0 });
});

test('validateRemixRecipe strips control chars and caps endCard text length', () => {
  const out = validateRemixRecipe({
    sourceFolders: ['a'],
    mixTitle: `clean title`,
    endCard: { text: 'x'.repeat(200) },
  });
  assert.equal(out.mixTitle, 'cleantitle');
  assert.equal(out.endCard.text.length, 80);
});

test('validateRemixRecipe still strips unknown fields with new optionals absent', () => {
  const out = validateRemixRecipe({ sourceFolders: ['a'], evil: 'x' });
  assert.deepEqual(Object.keys(out).sort(), ['output', 'sourceFolders', 'type']);
});
