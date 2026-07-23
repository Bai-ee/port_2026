'use strict';

// Unit tests for the PURE binary/JSON parsing + validation logic in
// studio-glb-assets.cjs (parseGLBJson, findExternalUriViolation,
// countGLBStats, validateGLBSafety, sanitizeFileName, storagePathForAsset).
// Live Storage/Firestore calls (createUploadUrl, confirmUpload, listAssets,
// deleteAsset) are NOT exercised here — they need a real GCS bucket/signed-
// URL round trip, verified live in the browser instead (same convention
// this repo already uses for other bucket-touching helpers, e.g.
// editvideos-bridge.cjs's own upload-session plumbing).

const test = require('node:test');
const assert = require('node:assert');
const glbAssets = require('../studio-glb-assets.cjs');
const { makeFakeContext } = require('./fake-firestore.cjs');
const { FakeBucket, FakeFile, makeFakeStorageContext } = require('./fake-storage.cjs');

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK_TYPE = 0x4e4f534a;

/**
 * Build a minimal binary-GLB buffer directly from a JSON-chunk object — no
 * BIN chunk, since none of the fields this module validates ever touch
 * chunk 2. Lets the external-URI / count-cap / malformed-header tests
 * target the JSON-level logic precisely, without needing to hand-mutate a
 * real exporter's binary payload.
 */
function buildGLBFromJson(json, { version = 2, forceTotalLength = null, forceChunkType = null } = {}) {
  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  const pad = (4 - (jsonBytes.length % 4)) % 4;
  const paddedJson = Buffer.concat([jsonBytes, Buffer.alloc(pad, 0x20)]);
  const totalLength = 12 + 8 + paddedJson.length;
  const buffer = Buffer.alloc(totalLength);
  buffer.writeUInt32LE(GLB_MAGIC, 0);
  buffer.writeUInt32LE(version, 4);
  buffer.writeUInt32LE(forceTotalLength ?? totalLength, 8);
  buffer.writeUInt32LE(paddedJson.length, 12);
  buffer.writeUInt32LE(forceChunkType ?? JSON_CHUNK_TYPE, 16);
  paddedJson.copy(buffer, 20);
  return buffer;
}

const MINIMAL_VALID_JSON = {
  asset: { version: '2.0' },
  nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
  materials: [{}],
  accessors: [{ count: 24 }, { count: 36 }], // POSITION accessor (unused by triangle math since indices present), indices accessor count=36 -> 12 triangles
  animations: [],
};

// --- parseGLBJson ------------------------------------------------------------

test('parseGLBJson: parses a well-formed minimal GLB JSON chunk', () => {
  const buffer = buildGLBFromJson(MINIMAL_VALID_JSON);
  const json = glbAssets.parseGLBJson(buffer);
  assert.deepStrictEqual(json, MINIMAL_VALID_JSON);
});

test('parseGLBJson: rejects a buffer too small to hold a header', () => {
  assert.throws(() => glbAssets.parseGLBJson(Buffer.from([1, 2, 3])), /too small/);
});

test('parseGLBJson: rejects the wrong magic number', () => {
  const buffer = buildGLBFromJson(MINIMAL_VALID_JSON);
  buffer.writeUInt32LE(0xdeadbeef, 0);
  assert.throws(() => glbAssets.parseGLBJson(buffer), /glTF magic/);
});

test('parseGLBJson: rejects an unsupported glTF version', () => {
  const buffer = buildGLBFromJson(MINIMAL_VALID_JSON, { version: 1 });
  assert.throws(() => glbAssets.parseGLBJson(buffer), /version/);
});

test('parseGLBJson: rejects a declared total length exceeding the actual bytes (truncated upload)', () => {
  const buffer = buildGLBFromJson(MINIMAL_VALID_JSON, { forceTotalLength: 999999 });
  assert.throws(() => glbAssets.parseGLBJson(buffer), /truncated|corrupt/);
});

// Correction (gate review): the declared length must EXACTLY match the
// actual byte count, not merely "not exceed" it — a shorter declared
// length would let trailing bytes ride along completely unvalidated
// (nothing here ever reads past `totalLength`).
test('parseGLBJson: rejects a buffer with TRAILING bytes beyond the declared total length', () => {
  const wellFormed = buildGLBFromJson(MINIMAL_VALID_JSON);
  const withTrailingGarbage = Buffer.concat([wellFormed, Buffer.from('smuggled-extra-payload')]);
  assert.throws(() => glbAssets.parseGLBJson(withTrailingGarbage), /does not match|truncated|corrupt/);
});

test('parseGLBJson: a JSON chunk length claiming more bytes than fit before the declared total length is rejected (isolated from the overall length check — buffer.length itself exactly matches totalLength here)', () => {
  const jsonBytes = Buffer.from(JSON.stringify(MINIMAL_VALID_JSON), 'utf8');
  const totalLength = 20 + jsonBytes.length; // buffer.length will exactly equal this — passes the exact-match check on its own
  const declaredChunkLength = jsonBytes.length + 50; // but claims MORE JSON bytes than actually fit before totalLength
  const buffer = Buffer.alloc(totalLength);
  buffer.writeUInt32LE(GLB_MAGIC, 0);
  buffer.writeUInt32LE(2, 4);
  buffer.writeUInt32LE(totalLength, 8);
  buffer.writeUInt32LE(declaredChunkLength, 12);
  buffer.writeUInt32LE(JSON_CHUNK_TYPE, 16);
  jsonBytes.copy(buffer, 20);
  assert.throws(() => glbAssets.parseGLBJson(buffer), /exceeds the declared/);
});

test('parseGLBJson: rejects a first chunk that is not JSON', () => {
  const buffer = buildGLBFromJson(MINIMAL_VALID_JSON, { forceChunkType: 0x004e4942 }); // 'BIN\0'
  assert.throws(() => glbAssets.parseGLBJson(buffer), /not JSON/);
});

test('parseGLBJson: rejects invalid JSON bytes in the JSON chunk', () => {
  const buffer = Buffer.alloc(28);
  buffer.writeUInt32LE(GLB_MAGIC, 0);
  buffer.writeUInt32LE(2, 4);
  buffer.writeUInt32LE(28, 8);
  buffer.writeUInt32LE(8, 12);
  buffer.writeUInt32LE(JSON_CHUNK_TYPE, 16);
  buffer.write('{not json', 20, 'utf8');
  assert.throws(() => glbAssets.parseGLBJson(buffer), /not valid JSON/);
});

// --- findExternalUriViolation --------------------------------------------------

test('findExternalUriViolation: a self-contained (no uri / data: uri) GLB passes', () => {
  assert.strictEqual(glbAssets.findExternalUriViolation({ buffers: [{}], images: [{ uri: 'data:image/png;base64,AAAA' }] }), null);
  assert.strictEqual(glbAssets.findExternalUriViolation({}), null);
});

test('findExternalUriViolation: an http(s) buffer uri is rejected', () => {
  const violation = glbAssets.findExternalUriViolation({ buffers: [{ uri: 'https://evil.example.com/payload.bin' }] });
  assert.match(violation, /buffer references an external URI/);
});

test('findExternalUriViolation: an http(s) image uri is rejected', () => {
  const violation = glbAssets.findExternalUriViolation({ images: [{ uri: 'http://tracker.example.com/pixel.png' }] });
  assert.match(violation, /image references an external URI/);
});

test('findExternalUriViolation: a bare relative-path uri (expects a sibling file) is also rejected', () => {
  const violation = glbAssets.findExternalUriViolation({ buffers: [{ uri: 'scene.bin' }] });
  assert.match(violation, /external URI/);
});

// --- countGLBStats -------------------------------------------------------------

test('countGLBStats: counts nodes/meshes/materials/textures/animations and estimates triangles from indices', () => {
  const stats = glbAssets.countGLBStats(MINIMAL_VALID_JSON);
  assert.strictEqual(stats.nodeCount, 1);
  assert.strictEqual(stats.meshCount, 1);
  assert.strictEqual(stats.materialCount, 1);
  assert.strictEqual(stats.animationCount, 0);
  assert.strictEqual(stats.triangleEstimate, 12); // 36 indices / 3
});

test('countGLBStats: falls back to the POSITION accessor count when a primitive has no indices', () => {
  const json = {
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ count: 9 }],
  };
  const stats = glbAssets.countGLBStats(json);
  assert.strictEqual(stats.triangleEstimate, 3); // 9 / 3
});

test('countGLBStats: names animation clips, falling back to a generated name when the clip has none', () => {
  const json = { animations: [{ name: 'Walk' }, {}] };
  const stats = glbAssets.countGLBStats(json);
  assert.deepStrictEqual(stats.animationNames, ['Walk', 'Animation 2']);
});

test('countGLBStats: missing arrays default to zero counts, never throws', () => {
  const stats = glbAssets.countGLBStats({});
  assert.deepStrictEqual(stats, {
    nodeCount: 0, meshCount: 0, materialCount: 0, textureCount: 0, animationCount: 0, animationNames: [], triangleEstimate: 0,
  });
});

// --- triangleCountForPrimitive (mode-aware — gate review correction) ---------
// TRIANGLES (mode 4, or omitted — the glTF-spec default) is the only mode
// floor(count/3) is correct for. TRIANGLE_STRIP/FAN (5/6) contribute
// count-2 triangles, not count/3 — the original bug this correction fixes:
// a 1.2M-vertex strip was reported as 400,000 triangles (count/3) when it
// actually represents ~1,199,998, silently passing the 500,000 cap.
// Points/lines contribute zero — inventing a count for a non-triangle
// primitive would be worse than under-counting.

test('triangleCountForPrimitive: TRIANGLES mode (explicit) uses floor(count/3)', () => {
  const accessors = [{ count: 10 }];
  assert.strictEqual(glbAssets.triangleCountForPrimitive({ mode: 4, indices: 0 }, accessors), 3);
});

test('triangleCountForPrimitive: mode omitted defaults to TRIANGLES per the glTF spec', () => {
  const accessors = [{ count: 9 }];
  assert.strictEqual(glbAssets.triangleCountForPrimitive({ indices: 0 }, accessors), 3);
});

test('triangleCountForPrimitive: TRIANGLE_STRIP (mode 5) uses count-2, not count/3', () => {
  const accessors = [{ count: 10 }];
  assert.strictEqual(glbAssets.triangleCountForPrimitive({ mode: 5, indices: 0 }, accessors), 8); // 10-2, NOT floor(10/3)=3
});

test('triangleCountForPrimitive: TRIANGLE_FAN (mode 6) uses count-2, not count/3', () => {
  const accessors = [{ count: 10 }];
  assert.strictEqual(glbAssets.triangleCountForPrimitive({ mode: 6, indices: 0 }, accessors), 8);
});

test('triangleCountForPrimitive: a degenerate strip/fan (0/1/2 vertices) floors at 0, never negative', () => {
  const accessors = [{ count: 1 }];
  assert.strictEqual(glbAssets.triangleCountForPrimitive({ mode: 5, indices: 0 }, accessors), 0);
});

test('triangleCountForPrimitive: non-triangle modes (POINTS/LINES/LINE_LOOP/LINE_STRIP) contribute zero triangles', () => {
  const accessors = [{ count: 100 }];
  [0, 1, 2, 3].forEach((mode) => {
    assert.strictEqual(glbAssets.triangleCountForPrimitive({ mode, indices: 0 }, accessors), 0, `mode ${mode} should contribute 0`);
  });
});

// The exact regression the review cited: a strip large enough that the OLD
// count/3 formula would have kept it under the cap, but the real (count-2)
// triangle count exceeds it.
test('countGLBStats + validateGLBSafety: a TRIANGLE_STRIP that count/3 would have under-counted below the cap is correctly counted OVER it and rejected', () => {
  const STRIP_VERTEX_COUNT = 1_200_000;
  const json = {
    meshes: [{ primitives: [{ mode: 5, attributes: { POSITION: 0 } }] }], // no indices -> falls back to POSITION accessor
    accessors: [{ count: STRIP_VERTEX_COUNT }],
  };
  const stats = glbAssets.countGLBStats(json);
  const oldBuggyFormula = Math.floor(STRIP_VERTEX_COUNT / 3);
  assert.strictEqual(oldBuggyFormula <= glbAssets.SAFETY_CAPS.maxTriangles, true, 'sanity: the old count/3 formula would have read as under the cap');
  assert.strictEqual(stats.triangleEstimate, STRIP_VERTEX_COUNT - 2);
  assert.strictEqual(stats.triangleEstimate > glbAssets.SAFETY_CAPS.maxTriangles, true, 'the REAL triangle-strip count must exceed the cap');
  const buffer = buildGLBFromJson(json);
  assert.throws(() => glbAssets.validateGLBSafety(buffer), /triangles exceeds/);
});

// --- validateGLBSafety (composition of the above + byte-size + caps) ----------

test('validateGLBSafety: accepts a small, well-formed, self-contained GLB', () => {
  const buffer = buildGLBFromJson(MINIMAL_VALID_JSON);
  const stats = glbAssets.validateGLBSafety(buffer);
  assert.strictEqual(stats.meshCount, 1);
});

test('validateGLBSafety: rejects a file over the byte-size cap', () => {
  const buffer = buildGLBFromJson(MINIMAL_VALID_JSON);
  assert.throws(() => glbAssets.validateGLBSafety(buffer, { maxBytes: 10 }), /MB/);
});

test('validateGLBSafety: rejects a file with an external texture reference', () => {
  const buffer = buildGLBFromJson({ ...MINIMAL_VALID_JSON, images: [{ uri: 'https://evil.example.com/tex.png' }] });
  assert.throws(() => glbAssets.validateGLBSafety(buffer), /self-contained/);
});

test('validateGLBSafety: rejects a node count over the cap', () => {
  const json = { ...MINIMAL_VALID_JSON, nodes: new Array(5).fill({}) };
  assert.throws(() => glbAssets.validateGLBSafety(buffer_(json), { caps: { ...glbAssets.SAFETY_CAPS, maxNodes: 4 } }), /nodes exceeds/);
  function buffer_(j) { return buildGLBFromJson(j); }
});

test('validateGLBSafety: rejects a triangle estimate over the cap', () => {
  const json = { ...MINIMAL_VALID_JSON, accessors: [{ count: 24 }, { count: 3_000_000 }] };
  const buffer = buildGLBFromJson(json);
  assert.throws(() => glbAssets.validateGLBSafety(buffer, { caps: { ...glbAssets.SAFETY_CAPS, maxTriangles: 500_000 } }), /triangles exceeds/);
});

test('validateGLBSafety: reports the FIRST violation found, still a single descriptive error (not a partial accept)', () => {
  const buffer = buildGLBFromJson({ ...MINIMAL_VALID_JSON, images: [{ uri: 'https://evil.example.com/x.png' }] });
  assert.throws(() => glbAssets.validateGLBSafety(buffer, { caps: { ...glbAssets.SAFETY_CAPS, maxNodes: 0 } }), /self-contained/);
});

// --- real-exporter round trip (three-stdlib GLTFExporter — dynamic ESM import
// from this CJS test file; confirms compatibility with an ACTUALLY-produced
// GLB, not just hand-built fixtures) ------------------------------------------

test('validateGLBSafety: accepts a real GLB produced by three-stdlib GLTFExporter', async () => {
  const THREE = await import('three');
  const stdlib = await import('three-stdlib');
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  const mesh = new THREE.Mesh(geo, mat);
  const scene = new THREE.Scene();
  scene.add(mesh);
  const exporter = new stdlib.GLTFExporter();
  const arrayBuffer = await new Promise((resolve, reject) => {
    exporter.parse(scene, resolve, reject, { binary: true });
  });
  const buffer = Buffer.from(arrayBuffer);
  const stats = glbAssets.validateGLBSafety(buffer);
  assert.strictEqual(stats.meshCount, 1);
  assert.strictEqual(stats.materialCount, 1);
});

// --- sanitizeFileName / storagePathForAsset ------------------------------------

test('sanitizeFileName: strips path separators, sanitizes unsafe characters, forces a .glb extension', () => {
  assert.strictEqual(glbAssets.sanitizeFileName('../../etc/passwd'), 'passwd.glb'); // only the basename survives — path components are dropped, not sanitized-in-place
  assert.strictEqual(glbAssets.sanitizeFileName('my model!.glb'), 'my_model_.glb');
  assert.strictEqual(glbAssets.sanitizeFileName(''), 'asset.glb');
  assert.strictEqual(glbAssets.sanitizeFileName(undefined), 'asset.glb');
  assert.strictEqual(glbAssets.sanitizeFileName('C:\\Users\\me\\evil.exe.glb').includes('\\'), false);
});

test('storagePathForAsset: namespaces every asset under its own id so filenames never collide across assets', () => {
  const a = glbAssets.storagePathForAsset('id-1', 'model.glb');
  const b = glbAssets.storagePathForAsset('id-2', 'model.glb');
  assert.notStrictEqual(a, b);
  assert.strictEqual(a, 'studio-glb-assets/id-1/model.glb');
});

// --- isPathWithinAssetNamespace (gate review correction) ----------------------

test('isPathWithinAssetNamespace: a path actually minted for this assetId is accepted', () => {
  const path = glbAssets.storagePathForAsset('asset-1', 'model.glb');
  assert.strictEqual(glbAssets.isPathWithinAssetNamespace('asset-1', path), true);
});

test('isPathWithinAssetNamespace: a path belonging to a DIFFERENT assetId is rejected', () => {
  const otherAssetsPath = glbAssets.storagePathForAsset('asset-2', 'model.glb');
  assert.strictEqual(glbAssets.isPathWithinAssetNamespace('asset-1', otherAssetsPath), false);
});

test('isPathWithinAssetNamespace: a path outside studio-glb-assets/ entirely is rejected', () => {
  assert.strictEqual(glbAssets.isPathWithinAssetNamespace('asset-1', 'some-other-bucket-area/asset-1/model.glb'), false);
});

test('isPathWithinAssetNamespace: a prefix-only match with nothing after it (no real filename) is rejected', () => {
  assert.strictEqual(glbAssets.isPathWithinAssetNamespace('asset-1', 'studio-glb-assets/asset-1/'), false);
});

test('isPathWithinAssetNamespace: an assetId that is itself a prefix of another (e.g. "asset-1" vs "asset-10") does not falsely match', () => {
  const path = glbAssets.storagePathForAsset('asset-10', 'model.glb');
  assert.strictEqual(glbAssets.isPathWithinAssetNamespace('asset-1', path), false);
});

test('isPathWithinAssetNamespace: empty/missing assetId or path is rejected', () => {
  assert.strictEqual(glbAssets.isPathWithinAssetNamespace('', 'studio-glb-assets/x/y.glb'), false);
  assert.strictEqual(glbAssets.isPathWithinAssetNamespace('asset-1', ''), false);
  assert.strictEqual(glbAssets.isPathWithinAssetNamespace(undefined, undefined), false);
});

// ── Injected Storage/Firestore — createUploadUrl / confirmUpload /
// listAssets / deleteAsset. Everything above is pure-logic; these are the
// real async orchestration functions the gate review specifically asked
// for coverage on (request→confirm identity binding, oversized-actual-
// object rejection BEFORE download, validation-failure cleanup, and
// successful immutable doc creation) — exercised against the fake Storage/
// Firestore in this directory (fake-storage.cjs / fake-firestore.cjs),
// asserting on the FAKE's own call counters so "rejected before download"
// is a verified fact about call order, not just an inference from the
// final state. ──────────────────────────────────────────────────────────

function setupFakeGlbContext() {
  const fakeDb = makeFakeContext();
  const fakeStorage = makeFakeStorageContext();
  glbAssets.__setTestContext({ adminDb: fakeDb.adminDb, adminStorage: fakeStorage.adminStorage });
  return { bucket: fakeStorage._bucket, adminDb: fakeDb.adminDb };
}

async function withFakeGlbContext(fn) {
  const handles = setupFakeGlbContext();
  try {
    return await fn(handles);
  } finally {
    glbAssets.__setTestContext(null);
  }
}

test('createUploadUrl: mints a signed PUT URL under the asset\'s own namespace, writes no Firestore doc yet', async () => {
  await withFakeGlbContext(async ({ bucket, adminDb }) => {
    const result = await glbAssets.createUploadUrl({ fileName: 'model.glb', sizeBytes: 1024 });
    assert.ok(result.assetId);
    assert.strictEqual(result.storagePath, `studio-glb-assets/${result.assetId}/model.glb`);
    assert.match(result.uploadUrl, /action=write/);
    const snap = await adminDb.collection(glbAssets.COLLECTION).doc(result.assetId).get();
    assert.strictEqual(snap.exists, false, 'no Firestore doc should exist until confirm succeeds');
    assert.strictEqual(bucket._calls.getSignedUrl, 1);
  });
});

test('createUploadUrl: rejects a declared sizeBytes over the cap without touching Storage at all', async () => {
  await withFakeGlbContext(async ({ bucket }) => {
    await assert.rejects(
      () => glbAssets.createUploadUrl({ fileName: 'model.glb', sizeBytes: glbAssets.MAX_GLB_UPLOAD_BYTES + 1 }),
      /MB/
    );
    assert.strictEqual(bucket._calls.getSignedUrl, 0);
  });
});

test('confirmUpload: a storagePath outside the given assetId\'s namespace is rejected WITHOUT any Storage call (can\'t probe/consume another asset\'s object)', async () => {
  await withFakeGlbContext(async ({ bucket }) => {
    const spoofedPath = glbAssets.storagePathForAsset('someone-elses-asset', 'model.glb');
    await assert.rejects(
      () => glbAssets.confirmUpload({ assetId: 'my-asset', storagePath: spoofedPath, fileName: 'model.glb' }),
      /does not belong/
    );
    assert.strictEqual(bucket._calls.getMetadata, 0);
    assert.strictEqual(bucket._calls.download, 0);
  });
});

test('confirmUpload: an uploaded object whose REAL size exceeds the cap is rejected from metadata alone — download is never called', async () => {
  await withFakeGlbContext(async ({ bucket }) => {
    const assetId = 'asset-1';
    const path = glbAssets.storagePathForAsset(assetId, 'model.glb');
    const oversized = Buffer.alloc(glbAssets.MAX_GLB_UPLOAD_BYTES + 1024);
    bucket.file(path)._put(oversized);
    await assert.rejects(
      () => glbAssets.confirmUpload({ assetId, storagePath: path, fileName: 'model.glb' }),
      /exceeds the .*MB limit. Rejected before download/
    );
    assert.strictEqual(bucket._calls.getMetadata, 1, 'metadata must be checked');
    assert.strictEqual(bucket._calls.download, 0, 'download must NEVER be called for an oversized object — this is the exact gate-review-caught bug');
    assert.strictEqual(bucket.file(path).exists(), false, 'the oversized object should be deleted, not left orphaned');
  });
});

test('confirmUpload: a real but malformed/unsafe GLB is rejected by validateGLBSafety and the Storage object is deleted', async () => {
  await withFakeGlbContext(async ({ bucket, adminDb }) => {
    const assetId = 'asset-1';
    const path = glbAssets.storagePathForAsset(assetId, 'model.glb');
    bucket.file(path)._put(Buffer.from('not a real glb'));
    await assert.rejects(() => glbAssets.confirmUpload({ assetId, storagePath: path, fileName: 'model.glb' }));
    assert.strictEqual(bucket.file(path).exists(), false, 'validation-failure cleanup must delete the object');
    const snap = await adminDb.collection(glbAssets.COLLECTION).doc(assetId).get();
    assert.strictEqual(snap.exists, false, 'no Firestore doc should be written for a rejected asset');
  });
});

test('confirmUpload: a valid GLB succeeds — writes the immutable Firestore doc with real measured stats, download is generation-pinned', async () => {
  await withFakeGlbContext(async ({ bucket, adminDb }) => {
    const assetId = 'asset-1';
    const path = glbAssets.storagePathForAsset(assetId, 'model.glb');
    const validBuffer = buildGLBFromJson(MINIMAL_VALID_JSON);
    bucket.file(path)._put(validBuffer);
    const doc = await glbAssets.confirmUpload({ assetId, storagePath: path, fileName: 'model.glb' });
    assert.strictEqual(doc.assetId, assetId);
    assert.strictEqual(doc.meshCount, 1);
    assert.strictEqual(doc.sizeBytes, validBuffer.length);
    const snap = await adminDb.collection(glbAssets.COLLECTION).doc(assetId).get();
    assert.strictEqual(snap.exists, true);
    assert.strictEqual(snap.data().meshCount, 1);
    assert.strictEqual(bucket.file(path).exists(), true, 'a successfully validated object must NOT be deleted');
  });
});

test('confirmUpload: downloading a generation the object no longer has (replaced mid-flight) fails rather than silently reading the wrong bytes', async () => {
  await withFakeGlbContext(async ({ bucket }) => {
    const assetId = 'asset-1';
    const path = glbAssets.storagePathForAsset(assetId, 'model.glb');
    bucket.file(path)._put(buildGLBFromJson(MINIMAL_VALID_JSON));
    // Simulate a TOCTOU swap: the object is replaced with a DIFFERENT
    // generation between getMetadata() and download(). confirmUpload calls
    // `bucket().file(path)` internally, minting a FRESH FakeFile instance
    // each time — so the patch has to live on the shared prototype (every
    // instance for this path), not on one instance a test happens to hold.
    const originalGetMetadata = FakeFile.prototype.getMetadata;
    FakeFile.prototype.getMetadata = async function patchedGetMetadata() {
      const [meta] = await originalGetMetadata.call(this);
      return [{ ...meta, generation: '999999' }]; // stale/wrong generation
    };
    try {
      await assert.rejects(() => glbAssets.confirmUpload({ assetId, storagePath: path, fileName: 'model.glb' }));
    } finally {
      FakeFile.prototype.getMetadata = originalGetMetadata;
    }
  });
});

test('listAssets: returns entries with freshly-minted read URLs, most recent first', async () => {
  await withFakeGlbContext(async ({ bucket, adminDb }) => {
    const pathA = glbAssets.storagePathForAsset('asset-a', 'a.glb');
    bucket.file(pathA)._put(buildGLBFromJson(MINIMAL_VALID_JSON));
    await glbAssets.confirmUpload({ assetId: 'asset-a', storagePath: pathA, fileName: 'a.glb' });
    const list = await glbAssets.listAssets();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].assetId, 'asset-a');
    assert.match(list[0].readUrl, /action=read/);
  });
});

test('deleteAsset: removes both the Storage object and the Firestore doc', async () => {
  await withFakeGlbContext(async ({ bucket, adminDb }) => {
    const assetId = 'asset-1';
    const path = glbAssets.storagePathForAsset(assetId, 'model.glb');
    bucket.file(path)._put(buildGLBFromJson(MINIMAL_VALID_JSON));
    await glbAssets.confirmUpload({ assetId, storagePath: path, fileName: 'model.glb' });
    await glbAssets.deleteAsset(assetId);
    assert.strictEqual(bucket.file(path).exists(), false);
    const snap = await adminDb.collection(glbAssets.COLLECTION).doc(assetId).get();
    assert.strictEqual(snap.exists, false);
  });
});
