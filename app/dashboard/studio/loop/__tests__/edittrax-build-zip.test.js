import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchTemplateBytes, buildEdittraxZipBytes,
} from '../edittrax/build-player-zip.js';

const BASE_HREF = '/edittrax-player/';

// Decodes zip bytes as latin1 text so `PK\x03\x04` local-file-header magic
// and ASCII entry names (store-mode zips embed names as raw bytes, no
// compression to unwrap) can be found with plain string search — enough to
// verify entry presence/prefixing without a zip-reading dependency.
function bytesToLatin1(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

function makeFakeFetch({ manifestOk = true, manifest, files = {} }) {
  return async (url) => {
    if (url === `${BASE_HREF}manifest.json`) {
      if (!manifestOk) return { ok: false, status: 404 };
      return { ok: true, status: 200, json: async () => manifest };
    }
    const path = url.slice(BASE_HREF.length);
    const bytes = files[path];
    if (!bytes) return { ok: false, status: 404 };
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  };
}

const FAKE_MANIFEST = {
  generatedAt: '2026-08-29T00:00:00.000Z',
  files: [
    { path: 'index.html', bytes: 13 },
    { path: 'style.css', bytes: 6 },
  ],
};
const FAKE_FILES = {
  'index.html': new TextEncoder().encode('<html></html>'),
  'style.css': new TextEncoder().encode('body{}'),
};

// ── fetchTemplateBytes ───────────────────────────────────────────────────

test('fetchTemplateBytes: fetches manifest + every listed file as Uint8Array', async () => {
  const fetchImpl = makeFakeFetch({ manifest: FAKE_MANIFEST, files: FAKE_FILES });
  const { manifest, templateBytesByPath } = await fetchTemplateBytes({ baseHref: BASE_HREF, fetchImpl });

  assert.deepEqual(manifest, FAKE_MANIFEST);
  assert.equal(templateBytesByPath.size, 2);
  assert.ok(templateBytesByPath.get('index.html') instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(templateBytesByPath.get('index.html')), '<html></html>');
  assert.equal(new TextDecoder().decode(templateBytesByPath.get('style.css')), 'body{}');
});

test('fetchTemplateBytes: manifest 404 throws a message pointing at the sync script', async () => {
  const fetchImpl = makeFakeFetch({ manifestOk: false, manifest: FAKE_MANIFEST, files: FAKE_FILES });
  await assert.rejects(
    () => fetchTemplateBytes({ baseHref: BASE_HREF, fetchImpl }),
    /sync-edittrax-player\.mjs/,
  );
});

test('fetchTemplateBytes: manifest fetch rejecting (network error) throws a message pointing at the sync script', async () => {
  const fetchImpl = async () => { throw new Error('network down'); };
  await assert.rejects(
    () => fetchTemplateBytes({ baseHref: BASE_HREF, fetchImpl }),
    /sync-edittrax-player\.mjs/,
  );
});

test('fetchTemplateBytes: a missing file path throws listing it', async () => {
  const manifest = { files: [{ path: 'index.html' }, { path: 'missing.js' }] };
  const fetchImpl = makeFakeFetch({ manifest, files: { 'index.html': FAKE_FILES['index.html'] } });
  await assert.rejects(
    () => fetchTemplateBytes({ baseHref: BASE_HREF, fetchImpl }),
    (err) => err instanceof Error
      && /failed to fetch template file/.test(err.message)
      && err.message.includes('missing.js')
      && !err.message.includes('index.html ('),
  );
});

// ── buildEdittraxZipBytes ────────────────────────────────────────────────

test('buildEdittraxZipBytes: produces a zip containing template files, track.js, and per-part audio, under the project folder', async () => {
  const fetchImpl = makeFakeFetch({ manifest: FAKE_MANIFEST, files: FAKE_FILES });
  const { zipBytes, filename } = await buildEdittraxZipBytes({
    projectBase: 'myproj',
    bpm: 128,
    barsPerLoop: 4,
    slots: [2, 5],
    counts: [3, 1],
    audioBytesBySlot: [Uint8Array.from([1, 2, 3]), Uint8Array.from([4, 5, 6])],
    baseHref: BASE_HREF,
    fetchImpl,
  });

  assert.equal(filename, 'myproj-edittrax-player.zip');
  assert.ok(zipBytes instanceof Uint8Array);

  const text = bytesToLatin1(zipBytes);
  assert.ok(text.startsWith('PK\x03\x04'), 'starts with a local-file-header signature');
  assert.ok(text.includes('myproj/index.html'));
  assert.ok(text.includes('myproj/style.css'));
  assert.ok(text.includes('myproj/track.js'));
  assert.ok(text.includes('myproj/audio/seg.1.wav'));
  assert.ok(text.includes('myproj/audio/seg.2.wav'));
  // track.js content is embedded (store mode, no compression) — bpm and the
  // generated per-part config should be readable directly in the bytes.
  assert.ok(text.includes('const bpm = 128;'));
  assert.ok(text.includes('"audio/seg.1.wav"'));
  assert.ok(text.includes('"audio/seg.2.wav"'));
});

test('buildEdittraxZipBytes: the same loop assigned to two slots yields two distinct audio entries', async () => {
  const fetchImpl = makeFakeFetch({ manifest: FAKE_MANIFEST, files: FAKE_FILES });
  const { zipBytes } = await buildEdittraxZipBytes({
    projectBase: 'dup-loop',
    bpm: 100,
    barsPerLoop: 8,
    slots: [4, 4, 4],
    counts: [1, 2, 3],
    audioBytesBySlot: [Uint8Array.from([9]), Uint8Array.from([9]), Uint8Array.from([9])],
    baseHref: BASE_HREF,
    fetchImpl,
  });
  const text = bytesToLatin1(zipBytes);
  assert.ok(text.includes('dup-loop/audio/seg.1.wav'));
  assert.ok(text.includes('dup-loop/audio/seg.2.wav'));
  assert.ok(text.includes('dup-loop/audio/seg.3.wav'));
});

test('buildEdittraxZipBytes: missing counts entries fall back to loop=1', async () => {
  const fetchImpl = makeFakeFetch({ manifest: FAKE_MANIFEST, files: FAKE_FILES });
  const { zipBytes } = await buildEdittraxZipBytes({
    projectBase: 'no-counts',
    bpm: 120,
    barsPerLoop: 4,
    slots: [0, 1],
    counts: undefined,
    audioBytesBySlot: [Uint8Array.from([1]), Uint8Array.from([2])],
    baseHref: BASE_HREF,
    fetchImpl,
  });
  const text = bytesToLatin1(zipBytes);
  assert.ok(text.includes('no-counts/track.js'));
  // Both parts default to loop: 1 — spot-check via the generated track.js
  // literal shape (`loop: 1`) appearing twice for this two-part track.
  const loopOnes = text.match(/loop: 1/g) || [];
  assert.ok(loopOnes.length >= 2, 'expected loop: 1 to appear for both fallback parts');
});

test('buildEdittraxZipBytes: throws on empty slots', async () => {
  await assert.rejects(
    () => buildEdittraxZipBytes({
      projectBase: 'x', bpm: 120, barsPerLoop: 4, slots: [], counts: [], audioBytesBySlot: [],
    }),
    /slots must be a non-empty array/,
  );
});

test('buildEdittraxZipBytes: throws when audioBytesBySlot length does not match slots', async () => {
  await assert.rejects(
    () => buildEdittraxZipBytes({
      projectBase: 'x',
      bpm: 120,
      barsPerLoop: 4,
      slots: [0, 1],
      counts: [1, 1],
      audioBytesBySlot: [Uint8Array.from([1])],
    }),
    /audioBytesBySlot length \(1\) must match slots length \(2\)/,
  );
});

test('buildEdittraxZipBytes: propagates a descriptive error when the template manifest 404s', async () => {
  const fetchImpl = makeFakeFetch({ manifestOk: false, manifest: FAKE_MANIFEST, files: FAKE_FILES });
  await assert.rejects(
    () => buildEdittraxZipBytes({
      projectBase: 'x',
      bpm: 120,
      barsPerLoop: 4,
      slots: [0],
      counts: [1],
      audioBytesBySlot: [Uint8Array.from([1])],
      baseHref: BASE_HREF,
      fetchImpl,
    }),
    /sync-edittrax-player\.mjs/,
  );
});
