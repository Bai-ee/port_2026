import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateTrackJs, buildPlayerZipEntries, sanitizePlayerProjectBase,
} from '../edittrax/edittrax-export.js';

// Evaluates generated track.js text the same way the real player template
// runs it: as top-level `const`s in a classic (non-module) <script> scope,
// with `document` (the loader-status DOM tail) and `window` (the
// `window.parts = parts` expose line — see readLivePartLoops in
// edittrax-embed.js) as the only external dependencies. Appends a return
// statement to pull the resulting bindings back out for assertions;
// `result.window` carries the shim so callers can assert on `window.parts`
// identity/contents.
function evalTrackJs(code, documentStub) {
  const stub = documentStub || {
    getElementById: () => ({
      style: {},
      set innerHTML(_v) {},
    }),
  };
  const windowStub = {};
  // eslint-disable-next-line no-new-func
  const fn = new Function('document', 'window', `${code}\nreturn { bpm, parts, presets, downloadName, boxHeight, reverseScrolling };`);
  const result = fn(stub, windowStub);
  return { ...result, window: windowStub };
}

const BASIC_PARTS = [
  { file: 'audio/seg.1.wav', length: 4, loop: 1 },
  { file: 'audio/seg.2.wav', length: 4, loop: 3 },
  { file: 'audio/seg.3.wav', length: 8, loop: 0 },
];

// ── generateTrackJs: evaluates and matches the input contract ─────────────

test('generateTrackJs: generated text evaluates and round-trips bpm/parts/downloadName/boxHeight/reverseScrolling', () => {
  const code = generateTrackJs({
    bpm: 128,
    parts: BASIC_PARTS,
    downloadName: 'MyTrack_EDIT.wav',
    boxHeight: 72,
    reverseScrolling: true,
  });
  const result = evalTrackJs(code);

  assert.equal(result.bpm, 128);
  assert.deepEqual(result.parts, BASIC_PARTS);
  assert.equal(result.downloadName, 'MyTrack_EDIT.wav');
  assert.equal(result.boxHeight, 72);
  assert.equal(result.reverseScrolling, true);
});

test('generateTrackJs: defaults boxHeight=60 and reverseScrolling=false when omitted', () => {
  const code = generateTrackJs({ bpm: 120, parts: BASIC_PARTS, downloadName: 'x.wav' });
  const result = evalTrackJs(code);
  assert.equal(result.boxHeight, 60);
  assert.equal(result.reverseScrolling, false);
});

test('generateTrackJs: presets are exactly 4 entries, each length === parts.length, with PREVIEW/FULL/EXTENDED/ZERO semantics', () => {
  const code = generateTrackJs({
    bpm: 120, parts: BASIC_PARTS, downloadName: 'x.wav',
  });
  const { presets } = evalTrackJs(code);

  assert.equal(presets.length, 4);
  presets.forEach((preset) => assert.equal(preset.length, BASIC_PARTS.length));

  // Preset 0 is auto-applied by the player on boot (script_unlocked.js:161
  // loadPreset(0)) — it must carry the current build, never all-off.
  assert.deepEqual(presets[0], BASIC_PARTS.map((p) => p.loop), 'preset 0 PREVIEW: current per-part loop counts (applied on boot)');
  assert.deepEqual(presets[1], [1, 1, 1], 'preset 1 FULL: every part once');
  assert.deepEqual(presets[2], [2, 2, 2], 'preset 2 EXTENDED: all doubled');
  assert.deepEqual(presets[3], [0, 0, 0], 'preset 3 ZERO: all off');
});

test('generateTrackJs: single-part input still produces 4 presets of length 1', () => {
  const code = generateTrackJs({
    bpm: 90, parts: [{ file: 'audio/seg.1.wav', length: 4, loop: 5 }], downloadName: 'solo.wav',
  });
  const { parts, presets } = evalTrackJs(code);
  assert.equal(parts.length, 1);
  assert.equal(presets.length, 4);
  presets.forEach((preset) => assert.equal(preset.length, 1));
  assert.deepEqual(presets[0], [5], 'boot preset carries the build');
  assert.deepEqual(presets[1], [1]);
});

test('generateTrackJs: template order — trackDir, bpm, parts, presets, loader tail, downloadName, boxHeight, reverseScrolling', () => {
  const code = generateTrackJs({ bpm: 100, parts: BASIC_PARTS, downloadName: 'x.wav' });
  const order = [
    'const trackDir = ""',
    'const bpm = 100',
    'const parts = [',
    'const presets = [];',
    "getElementById('statusScriptIcon')",
    'const downloadName = "x.wav"',
    'const boxHeight = 60',
    'const reverseScrolling = false',
  ];
  let cursor = -1;
  order.forEach((needle) => {
    const idx = code.indexOf(needle);
    assert.ok(idx !== -1, `expected to find ${JSON.stringify(needle)}`);
    assert.ok(idx > cursor, `expected ${JSON.stringify(needle)} to appear after the previous marker`);
    cursor = idx;
  });
});

test('generateTrackJs: exposes window.parts (same object identity as the evaluated parts) for readLivePartLoops', () => {
  const code = generateTrackJs({ bpm: 120, parts: BASIC_PARTS, downloadName: 'x.wav' });
  const result = evalTrackJs(code);

  assert.ok(Array.isArray(result.window.parts), 'window.parts must be set');
  assert.strictEqual(result.window.parts, result.parts, 'window.parts must be the SAME object as the evaluated parts array');
  assert.deepEqual(result.window.parts, BASIC_PARTS);
});

test('generateTrackJs: loader-status DOM tail is copied verbatim (statusScript / statusScriptIcon writes)', () => {
  const code = generateTrackJs({ bpm: 100, parts: BASIC_PARTS, downloadName: 'x.wav' });
  assert.match(code, /const svgElement2 = document\.getElementById\('statusScriptIcon'\);/);
  assert.match(code, /const newSvgContent2 = `\n<circle cx="20" cy="20" r="18" stroke="#CEC6B3" stroke-width="4" fill="#576B68" \/>\n<path d="M13 20 l5 5 l10 -10" stroke="#CEC6B3" stroke-width="4" fill="none" \/>`;/);
  assert.match(code, /document\.getElementById\("statusScript"\)\.innerHTML = "Visual Assets Loaded";/);
  assert.match(code, /document\.getElementById\('statusScript'\)\.style\.color = '#576B68';/);
  assert.match(code, /svgElement2\.innerHTML = newSvgContent2;/);
});

// ── generateTrackJs: file-string escaping ─────────────────────────────────

test('generateTrackJs: escapes double quotes and backslashes in file strings safely', () => {
  const trickyFile = 'audio/weird "name" \\ with\\backslashes.wav';
  const code = generateTrackJs({
    bpm: 120,
    parts: [{ file: trickyFile, length: 4, loop: 1 }],
    downloadName: 'x.wav',
  });
  const { parts } = evalTrackJs(code);
  assert.equal(parts[0].file, trickyFile);
});

test('generateTrackJs: escapes blob: URLs (embed path) safely', () => {
  const blobUrl = 'blob:http://localhost:3000/8f14e45f-ceea-467e-9575-4c7e6e0c1c1a';
  const code = generateTrackJs({
    bpm: 120,
    parts: [{ file: blobUrl, length: 4, loop: 2 }],
    downloadName: 'x.wav',
  });
  const { parts } = evalTrackJs(code);
  assert.equal(parts[0].file, blobUrl);
});

test('generateTrackJs: escapes quotes in downloadName safely', () => {
  const code = generateTrackJs({
    bpm: 120, parts: BASIC_PARTS, downloadName: 'My "Track" Edit.wav',
  });
  const { downloadName } = evalTrackJs(code);
  assert.equal(downloadName, 'My "Track" Edit.wav');
});

// ── generateTrackJs: validation ────────────────────────────────────────────

test('generateTrackJs: throws on empty parts', () => {
  assert.throws(
    () => generateTrackJs({ bpm: 120, parts: [], downloadName: 'x.wav' }),
    /parts must be a non-empty array/,
  );
});

test('generateTrackJs: throws on non-array parts', () => {
  assert.throws(
    () => generateTrackJs({ bpm: 120, parts: null, downloadName: 'x.wav' }),
    /parts must be a non-empty array/,
  );
});

test('generateTrackJs: throws on bpm <= 0', () => {
  assert.throws(
    () => generateTrackJs({ bpm: 0, parts: BASIC_PARTS, downloadName: 'x.wav' }),
    /bpm must be a finite number > 0/,
  );
  assert.throws(
    () => generateTrackJs({ bpm: -10, parts: BASIC_PARTS, downloadName: 'x.wav' }),
    /bpm must be a finite number > 0/,
  );
});

test('generateTrackJs: throws on non-finite bpm', () => {
  assert.throws(
    () => generateTrackJs({ bpm: NaN, parts: BASIC_PARTS, downloadName: 'x.wav' }),
    /bpm must be a finite number > 0/,
  );
  assert.throws(
    () => generateTrackJs({ bpm: Infinity, parts: BASIC_PARTS, downloadName: 'x.wav' }),
    /bpm must be a finite number > 0/,
  );
});

test('generateTrackJs: throws on negative loop', () => {
  assert.throws(
    () => generateTrackJs({
      bpm: 120,
      parts: [{ file: 'audio/seg.1.wav', length: 4, loop: -1 }],
      downloadName: 'x.wav',
    }),
    /parts\[0\]\.loop must be a non-negative integer/,
  );
});

test('generateTrackJs: throws on non-integer length', () => {
  assert.throws(
    () => generateTrackJs({
      bpm: 120,
      parts: [{ file: 'audio/seg.1.wav', length: 4.5, loop: 1 }],
      downloadName: 'x.wav',
    }),
    /parts\[0\]\.length must be a non-negative integer/,
  );
});

test('generateTrackJs: throws on non-integer loop', () => {
  assert.throws(
    () => generateTrackJs({
      bpm: 120,
      parts: [{ file: 'audio/seg.1.wav', length: 4, loop: 1.5 }],
      downloadName: 'x.wav',
    }),
    /parts\[0\]\.loop must be a non-negative integer/,
  );
});

test('generateTrackJs: throws on negative length', () => {
  assert.throws(
    () => generateTrackJs({
      bpm: 120,
      parts: [{ file: 'audio/seg.1.wav', length: -2, loop: 1 }],
      downloadName: 'x.wav',
    }),
    /parts\[0\]\.length must be a non-negative integer/,
  );
});

test('generateTrackJs: throws on missing/empty file string', () => {
  assert.throws(
    () => generateTrackJs({
      bpm: 120,
      parts: [{ file: '', length: 4, loop: 1 }],
      downloadName: 'x.wav',
    }),
    /parts\[0\]\.file must be a non-empty string/,
  );
});

test('generateTrackJs: throws on missing/empty downloadName', () => {
  assert.throws(
    () => generateTrackJs({ bpm: 120, parts: BASIC_PARTS, downloadName: '' }),
    /downloadName must be a non-empty string/,
  );
});

test('generateTrackJs: throws on non-positive boxHeight', () => {
  assert.throws(
    () => generateTrackJs({
      bpm: 120, parts: BASIC_PARTS, downloadName: 'x.wav', boxHeight: 0,
    }),
    /boxHeight must be a finite number > 0/,
  );
});

// ── buildPlayerZipEntries ──────────────────────────────────────────────────

function makeManifest(paths) {
  return { generatedAt: '2026-08-29T00:00:00.000Z', files: paths.map((path) => ({ path })) };
}

test('buildPlayerZipEntries: correct names/prefix/order — template files, then track.js, then audio', () => {
  const manifest = makeManifest(['index.html', 'style.css', 'Tone.js']);
  const templateBytesByPath = {
    'index.html': new TextEncoder().encode('<html></html>'),
    'style.css': new TextEncoder().encode('body{}'),
    'Tone.js': new TextEncoder().encode('/* tone */'),
  };
  const trackJsText = 'const bpm = 120;';
  const audioEntries = [
    { name: 'seg.1.wav', data: Uint8Array.from([1, 2, 3]) },
    { name: 'seg.2.wav', data: Uint8Array.from([4, 5, 6]) },
  ];

  const entries = buildPlayerZipEntries({
    projectBase: 'my-track', manifest, templateBytesByPath, trackJsText, audioEntries,
  });

  assert.deepEqual(entries.map((e) => e.name), [
    'my-track/index.html',
    'my-track/style.css',
    'my-track/Tone.js',
    'my-track/track.js',
    'my-track/audio/seg.1.wav',
    'my-track/audio/seg.2.wav',
  ]);
  entries.forEach((e) => assert.ok(e.name.startsWith('my-track/'), `${e.name} must be prefixed with projectBase`));

  const trackJsEntry = entries.find((e) => e.name === 'my-track/track.js');
  assert.equal(new TextDecoder().decode(trackJsEntry.data), trackJsText);

  const audio1 = entries.find((e) => e.name === 'my-track/audio/seg.1.wav');
  assert.deepEqual(Array.from(audio1.data), [1, 2, 3]);
});

test('buildPlayerZipEntries: accepts templateBytesByPath as a Map', () => {
  const manifest = makeManifest(['a.txt']);
  const templateBytesByPath = new Map([['a.txt', new TextEncoder().encode('hi')]]);
  const entries = buildPlayerZipEntries({
    projectBase: 'proj',
    manifest,
    templateBytesByPath,
    trackJsText: 'const x = 1;',
    audioEntries: [{ name: 'seg.1.wav', data: Uint8Array.from([9]) }],
  });
  assert.equal(entries[0].name, 'proj/a.txt');
  assert.equal(new TextDecoder().decode(entries[0].data), 'hi');
});

test('buildPlayerZipEntries: throws listing every manifest path missing template bytes', () => {
  const manifest = makeManifest(['a.txt', 'b.txt', 'c.txt']);
  const templateBytesByPath = { 'a.txt': new Uint8Array([1]) };
  assert.throws(
    () => buildPlayerZipEntries({
      projectBase: 'proj',
      manifest,
      templateBytesByPath,
      trackJsText: 'const x = 1;',
      audioEntries: [{ name: 'seg.1.wav', data: Uint8Array.from([1]) }],
    }),
    (err) => err instanceof Error
      && /missing template bytes for/.test(err.message)
      && err.message.includes('b.txt')
      && err.message.includes('c.txt')
      && !err.message.includes('a.txt'),
  );
});

test('buildPlayerZipEntries: throws on empty audioEntries', () => {
  const manifest = makeManifest(['a.txt']);
  const templateBytesByPath = { 'a.txt': new Uint8Array([1]) };
  assert.throws(
    () => buildPlayerZipEntries({
      projectBase: 'proj', manifest, templateBytesByPath, trackJsText: 'x', audioEntries: [],
    }),
    /audioEntries must be a non-empty array/,
  );
});

test('buildPlayerZipEntries: throws when an audio entry name collides with a template path', () => {
  const manifest = makeManifest(['audio/seg.1.wav']);
  const templateBytesByPath = { 'audio/seg.1.wav': new Uint8Array([1]) };
  assert.throws(
    () => buildPlayerZipEntries({
      projectBase: 'proj',
      manifest,
      templateBytesByPath,
      trackJsText: 'x',
      audioEntries: [{ name: 'seg.1.wav', data: Uint8Array.from([2]) }],
    }),
    /collides with template path/,
  );
});

test('buildPlayerZipEntries: throws on duplicate audio entry names', () => {
  const manifest = makeManifest([]);
  assert.throws(
    () => buildPlayerZipEntries({
      projectBase: 'proj',
      manifest,
      templateBytesByPath: {},
      trackJsText: 'x',
      audioEntries: [
        { name: 'seg.1.wav', data: Uint8Array.from([1]) },
        { name: 'seg.1.wav', data: Uint8Array.from([2]) },
      ],
    }),
    /duplicate audio entry name/,
  );
});

test('buildPlayerZipEntries: throws on empty/missing projectBase', () => {
  const manifest = makeManifest([]);
  assert.throws(
    () => buildPlayerZipEntries({
      projectBase: '',
      manifest,
      templateBytesByPath: {},
      trackJsText: 'x',
      audioEntries: [{ name: 'seg.1.wav', data: Uint8Array.from([1]) }],
    }),
    /projectBase must be a non-empty string/,
  );
});

// ── sanitizePlayerProjectBase ───────────────────────────────────────────────

test('sanitizePlayerProjectBase: replaces spaces with hyphens', () => {
  assert.equal(sanitizePlayerProjectBase('My Cool Track'), 'My-Cool-Track');
});

test('sanitizePlayerProjectBase: replaces slashes and collapses repeats', () => {
  assert.equal(sanitizePlayerProjectBase('a/b\\c'), 'a-b-c');
});

test('sanitizePlayerProjectBase: strips diacritics', () => {
  assert.equal(sanitizePlayerProjectBase('Café Édition'), 'Cafe-Edition');
});

test('sanitizePlayerProjectBase: trims leading/trailing separators and collapses repeated hyphens', () => {
  assert.equal(sanitizePlayerProjectBase('  --weird--name--  '), 'weird-name');
});

test('sanitizePlayerProjectBase: empty string falls back to edittrax-player', () => {
  assert.equal(sanitizePlayerProjectBase(''), 'edittrax-player');
});

test('sanitizePlayerProjectBase: whitespace-only string falls back', () => {
  assert.equal(sanitizePlayerProjectBase('   '), 'edittrax-player');
});

test('sanitizePlayerProjectBase: non-string input falls back', () => {
  assert.equal(sanitizePlayerProjectBase(undefined), 'edittrax-player');
  assert.equal(sanitizePlayerProjectBase(null), 'edittrax-player');
  assert.equal(sanitizePlayerProjectBase(42), 'edittrax-player');
});

test('sanitizePlayerProjectBase: a string of only separator characters falls back', () => {
  assert.equal(sanitizePlayerProjectBase('---'), 'edittrax-player');
  assert.equal(sanitizePlayerProjectBase('...'), 'edittrax-player');
});

test('sanitizePlayerProjectBase: preserves already-safe names untouched', () => {
  assert.equal(sanitizePlayerProjectBase('house-techno-edm_01'), 'house-techno-edm_01');
});

test('sanitizePlayerProjectBase: unicode emoji and symbols collapse to hyphen-joined ascii', () => {
  assert.equal(sanitizePlayerProjectBase('Track 🔥 Name!!'), 'Track-Name');
});
