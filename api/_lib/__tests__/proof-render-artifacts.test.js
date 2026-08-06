// proof-render-artifacts.test.js — Phase 1 (STUDIO-DETERMINISTIC-FINAL-
// RENDER-SONNET-HANDOFF.md). Pure, dependency-injected tests against the
// in-memory fake Storage bucket (fake-firestore.cjs's own adminStorage
// stub) — no live project, no real GCS bucket. Same pattern as
// proof-render-jobs.test.js/studio-templates.test.js.
//
// This module had zero test coverage before Phase 1 wired it into
// proof-render-worker.mjs as a live production dependency (Phase 0 recon
// flagged this gap explicitly) — what's tested here: the claim-scoped path
// construction (the exact mechanism that prevents a stale/losing worker
// claim from ever overwriting a winning claim's already-durable artifact —
// see artifactStoragePath's own comment), sanitization against path-
// traversal-shaped input, and that upload/sign/delete genuinely round-trip
// through the injected bucket.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const artifacts = require('../proof-render-artifacts.cjs');
const { makeFakeContext } = require('./fake-firestore.cjs');

let fakeCtx;
let tmpDir;

beforeEach(async () => {
  fakeCtx = makeFakeContext();
  artifacts.__setTestContext(fakeCtx);
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'proof-render-artifacts-test-'));
});
afterEach(async () => {
  artifacts.__setTestContext(null);
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeLocalFiles() {
  const mp4Path = path.join(tmpDir, 'output.mp4');
  const posterPath = path.join(tmpDir, 'poster.jpg');
  await writeFile(mp4Path, Buffer.from('fake mp4 bytes'));
  await writeFile(posterPath, Buffer.from('fake jpeg bytes'));
  return { mp4Path, posterPath };
}

// ── artifactStoragePath: sanitization + claim-scoping ───────────────────────

test('artifactStoragePath builds a client/job/claimToken-scoped path', () => {
  const p = artifacts.artifactStoragePath('client-a', 'proof_123', 'claim-abc', 'proof.mp4');
  assert.equal(p, 'proof-render-artifacts/client-a/proof_123/claim-abc/proof.mp4');
});

test('artifactStoragePath strips characters outside the safe charset — never a literal path fragment', () => {
  const p = artifacts.artifactStoragePath('../../etc', 'job/../../passwd', 'claim/../x', 'proof.mp4');
  // '.' and '/' are both outside the allowed [a-zA-Z0-9_-] charset, so a
  // traversal sequence doesn't just get neutralized — it's removed entirely.
  assert.equal(p, 'proof-render-artifacts/etc/jobpasswd/claimx/proof.mp4');
  assert.ok(!p.includes('../') && !p.includes('..'), 'sanitized path must never contain a traversal sequence');
});

test('artifactStoragePath throws if clientId, jobId, or claimToken is missing/empty', () => {
  assert.throws(() => artifacts.artifactStoragePath('', 'job', 'claim', 'proof.mp4'));
  assert.throws(() => artifacts.artifactStoragePath('client', '', 'claim', 'proof.mp4'));
  assert.throws(() => artifacts.artifactStoragePath('client', 'job', '', 'proof.mp4'));
  assert.throws(() => artifacts.artifactStoragePath(null, null, null, 'proof.mp4'));
});

test('two different claimTokens for the SAME clientId/jobId produce two different, non-colliding paths', () => {
  const a = artifacts.artifactStoragePath('client-a', 'proof_123', 'claim-1', 'proof.mp4');
  const b = artifacts.artifactStoragePath('client-a', 'proof_123', 'claim-2', 'proof.mp4');
  assert.notEqual(a, b);
});

// ── uploadProofArtifacts ─────────────────────────────────────────────────

test('uploadProofArtifacts stores both files in the bucket at their claim-scoped paths and returns paths + retention metadata, never a local path', async () => {
  const { mp4Path, posterPath } = await writeLocalFiles();
  const result = await artifacts.uploadProofArtifacts({ clientId: 'client-a', jobId: 'proof_1', claimToken: 'claim-1', mp4Path, posterPath });

  assert.equal(result.mp4StoragePath, 'proof-render-artifacts/client-a/proof_1/claim-1/proof.mp4');
  assert.equal(result.posterStoragePath, 'proof-render-artifacts/client-a/proof_1/claim-1/poster.jpg');
  assert.equal(result.retentionDays, artifacts.RETENTION_DAYS);
  assert.ok(Date.parse(result.expiresAt) > Date.now(), 'expiresAt must be a real future timestamp');

  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(tmpDir), 'the returned object must never contain the local scratch path');

  const bucket = fakeCtx.adminStorage.bucket();
  const storedMp4 = bucket._raw(result.mp4StoragePath);
  const storedPoster = bucket._raw(result.posterStoragePath);
  assert.equal(storedMp4.contentType, 'video/mp4');
  assert.equal(storedPoster.contentType, 'image/jpeg');
  assert.equal(storedMp4.buffer.toString(), 'fake mp4 bytes');
  assert.equal(storedPoster.buffer.toString(), 'fake jpeg bytes');
});

test('uploadProofArtifacts rejects when the local files do not exist, before anything is stored', async () => {
  await assert.rejects(() => artifacts.uploadProofArtifacts({
    clientId: 'client-a', jobId: 'proof_1', claimToken: 'claim-1',
    mp4Path: path.join(tmpDir, 'missing.mp4'), posterPath: path.join(tmpDir, 'missing.jpg'),
  }));
});

// ── P2-2 fix: a partially-failed upload cleans up the object that DID land
// (best-effort), never leaving an unreferenced orphan behind — and never
// masks the original error, even if the cleanup itself also fails. ────────

/** Wraps a real FakeStorageFile so save() fails for ONE target path while
 * delete()/getSignedUrl() still delegate to the real object — a bare
 * `{...real, save: ...}` spread would silently drop those prototype
 * methods (they're not own properties on the fake), breaking the very
 * cleanup call this test exists to exercise. */
function makeFailingFileBucket(bucketInstance, { failSavePath, failDeletePath } = {}) {
  const originalFile = bucketInstance.file.bind(bucketInstance);
  bucketInstance.file = (objectPath) => {
    const real = originalFile(objectPath);
    return {
      save: (...args) => (objectPath === failSavePath
        ? Promise.reject(new Error('simulated poster upload failure'))
        : real.save(...args)),
      delete: (...args) => (objectPath === failDeletePath
        ? Promise.reject(new Error('simulated cleanup delete failure'))
        : real.delete(...args)),
      getSignedUrl: (...args) => real.getSignedUrl(...args),
    };
  };
  return () => { bucketInstance.file = originalFile; }; // restore
}

test('uploadProofArtifacts cleans up the object that DID upload when its sibling fails — never left as an orphan', async () => {
  const { mp4Path, posterPath } = await writeLocalFiles();
  const bucketInstance = fakeCtx.adminStorage.bucket();
  const posterPathInBucket = artifacts.artifactStoragePath('client-a', 'proof_partial', 'claim-1', 'poster.jpg');
  const mp4PathInBucket = artifacts.artifactStoragePath('client-a', 'proof_partial', 'claim-1', 'proof.mp4');
  const restore = makeFailingFileBucket(bucketInstance, { failSavePath: posterPathInBucket });
  try {
    await assert.rejects(
      () => artifacts.uploadProofArtifacts({ clientId: 'client-a', jobId: 'proof_partial', claimToken: 'claim-1', mp4Path, posterPath }),
      /simulated poster upload failure/,
    );
    assert.equal(bucketInstance._raw(mp4PathInBucket), undefined, 'the mp4, which DID successfully upload, must be cleaned up once its sibling fails — never left as an unreferenced orphan');
  } finally {
    restore();
  }
});

test('uploadProofArtifacts: if the cleanup delete ALSO fails, the ORIGINAL upload error still surfaces unchanged — a cleanup failure never masks or replaces it', async () => {
  const { mp4Path, posterPath } = await writeLocalFiles();
  const bucketInstance = fakeCtx.adminStorage.bucket();
  const posterPathInBucket = artifacts.artifactStoragePath('client-a', 'proof_doublefail', 'claim-1', 'poster.jpg');
  const mp4PathInBucket = artifacts.artifactStoragePath('client-a', 'proof_doublefail', 'claim-1', 'proof.mp4');
  const restore = makeFailingFileBucket(bucketInstance, { failSavePath: posterPathInBucket, failDeletePath: mp4PathInBucket });
  try {
    // The ORIGINAL error (poster upload failure) must be what the caller
    // sees — never "simulated cleanup delete failure", and the call must
    // not hang or throw some OTHER unhandled rejection from the cleanup
    // path leaking out unbounded.
    await assert.rejects(
      () => artifacts.uploadProofArtifacts({ clientId: 'client-a', jobId: 'proof_doublefail', claimToken: 'claim-1', mp4Path, posterPath }),
      /simulated poster upload failure/,
    );
  } finally {
    restore();
  }
});

// ── mintReadUrls ─────────────────────────────────────────────────────────

test('mintReadUrls returns a fresh signed URL pair for an uploaded artifact\'s exact storage paths', async () => {
  const { mp4Path, posterPath } = await writeLocalFiles();
  const uploaded = await artifacts.uploadProofArtifacts({ clientId: 'client-a', jobId: 'proof_1', claimToken: 'claim-1', mp4Path, posterPath });
  const urls = await artifacts.mintReadUrls(uploaded);
  assert.ok(urls.mp4Url.includes(uploaded.mp4StoragePath));
  assert.ok(urls.posterUrl.includes(uploaded.posterStoragePath));
});

test('mintReadUrls mints a DIFFERENT URL each call — never a cached/reused expiring URL', async () => {
  const { mp4Path, posterPath } = await writeLocalFiles();
  const uploaded = await artifacts.uploadProofArtifacts({ clientId: 'client-a', jobId: 'proof_1', claimToken: 'claim-1', mp4Path, posterPath });
  const first = await artifacts.mintReadUrls(uploaded);
  await new Promise((resolve) => { setTimeout(resolve, 2); }); // ensure the embedded `expires` timestamp advances
  const second = await artifacts.mintReadUrls(uploaded);
  assert.notEqual(first.mp4Url, second.mp4Url, 'a freshly minted signed URL must not be byte-identical to a prior one for the same object');
});

// ── deleteProofArtifacts ─────────────────────────────────────────────────

test('deleteProofArtifacts removes both objects from the bucket', async () => {
  const { mp4Path, posterPath } = await writeLocalFiles();
  const uploaded = await artifacts.uploadProofArtifacts({ clientId: 'client-a', jobId: 'proof_1', claimToken: 'claim-1', mp4Path, posterPath });
  const bucket = fakeCtx.adminStorage.bucket();
  assert.ok(bucket._raw(uploaded.mp4StoragePath));

  await artifacts.deleteProofArtifacts(uploaded);
  assert.equal(bucket._raw(uploaded.mp4StoragePath), undefined);
  assert.equal(bucket._raw(uploaded.posterStoragePath), undefined);
});

test('deleteProofArtifacts on an already-missing/never-uploaded object is a no-op, never throws (ignoreNotFound)', async () => {
  await assert.doesNotReject(() => artifacts.deleteProofArtifacts({
    mp4StoragePath: 'proof-render-artifacts/client-a/proof_never/claim-x/proof.mp4',
    posterStoragePath: 'proof-render-artifacts/client-a/proof_never/claim-x/poster.jpg',
  }));
});

// ── listArtifactStorageObjects (P2-2, the raw listing primitive an orphan
// reclaim sweep needs) ──────────────────────────────────────────────────

test('listArtifactStorageObjects lists every uploaded object\'s bare path under this module\'s own PREFIX', async () => {
  const { mp4Path, posterPath } = await writeLocalFiles();
  const a = await artifacts.uploadProofArtifacts({ clientId: 'client-a', jobId: 'proof_1', claimToken: 'claim-1', mp4Path, posterPath });
  const b = await artifacts.uploadProofArtifacts({ clientId: 'client-a', jobId: 'proof_2', claimToken: 'claim-2', mp4Path, posterPath });

  const paths = await artifacts.listArtifactStorageObjects();
  assert.ok(paths.includes(a.mp4StoragePath));
  assert.ok(paths.includes(a.posterStoragePath));
  assert.ok(paths.includes(b.mp4StoragePath));
  assert.ok(paths.includes(b.posterStoragePath));
  assert.equal(paths.length, 4);
});

test('listArtifactStorageObjects on an empty bucket returns an empty list', async () => {
  const paths = await artifacts.listArtifactStorageObjects();
  assert.deepEqual(paths, []);
});

test('listArtifactStorageObjects respects maxResults — never lists more than the caller asked for', async () => {
  const { mp4Path, posterPath } = await writeLocalFiles();
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- test setup, sequential is fine
    await artifacts.uploadProofArtifacts({ clientId: 'client-a', jobId: `proof_${i}`, claimToken: 'claim-1', mp4Path, posterPath });
  }
  const paths = await artifacts.listArtifactStorageObjects({ maxResults: 2 });
  assert.equal(paths.length, 2);
});

// ── Tenant isolation ─────────────────────────────────────────────────────

test('two clients uploading artifacts for a job with the SAME jobId never collide — clientId is part of the path', async () => {
  const { mp4Path, posterPath } = await writeLocalFiles();
  const a = await artifacts.uploadProofArtifacts({ clientId: 'client-a', jobId: 'proof_shared', claimToken: 'claim-1', mp4Path, posterPath });
  const b = await artifacts.uploadProofArtifacts({ clientId: 'client-b', jobId: 'proof_shared', claimToken: 'claim-1', mp4Path, posterPath });
  assert.notEqual(a.mp4StoragePath, b.mp4StoragePath);

  const bucket = fakeCtx.adminStorage.bucket();
  assert.ok(bucket._raw(a.mp4StoragePath));
  assert.ok(bucket._raw(b.mp4StoragePath));
});
