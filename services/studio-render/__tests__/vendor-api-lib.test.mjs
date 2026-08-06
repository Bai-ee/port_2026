// vendor-api-lib.test.mjs — Phase 3 (STUDIO-DETERMINISTIC-FINAL-RENDER-
// SONNET-HANDOFF.md). Same "vendor is in sync" discipline as
// art-recipe.test.mjs's own vendor/elements/ tests, for the SECOND vendored
// dependency closure (api/_lib/'s Firestore/Storage job-queue modules,
// proof-render-worker.mjs's own dependency — see scripts/vendor-api-lib.mjs's
// header comment for the full "why a separate vendor dir" rationale).
//
// Also proves the vendored copies genuinely WORK when imported from their
// vendored location (not just byte-identical) — real create/claim/complete
// against the fake Firestore/Storage context, exactly like the real
// api/_lib/__tests__/proof-render-jobs.test.js does against the real files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { vendorApiLib, VENDORED_FILES } from '../scripts/vendor-api-lib.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVICE_DIR = path.resolve(__dirname, '..');
const API_LIB_SOURCE_DIR = path.resolve(SERVICE_DIR, '../../api/_lib');
const VENDOR_API_LIB_DIR = path.resolve(SERVICE_DIR, 'vendor/api-lib');

// ── Byte-for-byte sync ──────────────────────────────────────────────────

for (const file of VENDORED_FILES) {
  test(`vendor sync: vendor/api-lib/${file} is byte-identical to the real api/_lib/${file}`, () => {
    const real = readFileSync(path.join(API_LIB_SOURCE_DIR, file), 'utf8');
    const vendored = readFileSync(path.join(VENDOR_API_LIB_DIR, file), 'utf8');
    assert.equal(vendored, real, `vendor/api-lib/${file} is out of sync with the real source — re-run: node services/studio-render/scripts/vendor-api-lib.mjs`);
  });
}

test('vendor sync: vendor/api-lib/ contains exactly VENDORED_FILES — nothing extra, nothing missing', () => {
  const actual = readdirSync(VENDOR_API_LIB_DIR).sort();
  assert.deepEqual(actual, [...VENDORED_FILES].sort());
});

// vendorApiLib() exercised against an ISOLATED temp dir, never the canonical
// vendor/api-lib/ — same concurrent-test-isolation rationale as
// art-recipe.test.mjs's own withTempVendorDir (other test files in this
// suite import from the canonical dir while tests run concurrently).
function withTempVendorDir(fn) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vendor-api-lib-test-'));
  try { return fn(tempDir); } finally { rmSync(tempDir, { recursive: true, force: true }); }
}

test('vendorApiLib({targetDir}) copies byte-for-byte identical files into an ISOLATED temp directory, never touching the canonical vendor/api-lib/', () => {
  withTempVendorDir((tempDir) => {
    const result = vendorApiLib({ targetDir: tempDir });
    assert.equal(result.targetDir, tempDir);
    for (const file of VENDORED_FILES) {
      const real = readFileSync(path.join(API_LIB_SOURCE_DIR, file), 'utf8');
      const isolated = readFileSync(path.join(tempDir, file), 'utf8');
      assert.equal(isolated, real);
    }
  });
  for (const file of VENDORED_FILES) {
    const real = readFileSync(path.join(API_LIB_SOURCE_DIR, file), 'utf8');
    const canonical = readFileSync(path.join(VENDOR_API_LIB_DIR, file), 'utf8');
    assert.equal(canonical, real, `the canonical vendor/api-lib/${file} must be untouched by an isolated-targetDir vendorApiLib() call`);
  }
});

// ── Runtime proof: the vendored copies genuinely work from their vendored
// location, not just byte-identical text. Copied into an IN-REPO temp dir
// (not the OS tmpdir) so Node's own node_modules ancestor-walk still
// resolves the real `firebase-admin` package — the same resolution the
// deployed container gets via its own package.json + npm install, just
// without needing a second npm install for this test. ────────────────────

async function withInRepoTempDir(fn) {
  const tempDir = path.join(SERVICE_DIR, `.vendor-api-lib-runtime-test-${process.pid}-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  // Await `fn` BEFORE cleanup — critical for the dynamic-import() based
  // tests below: unlike require() (fully synchronous, reads+caches the file
  // before this function's first `await` even suspends), ESM `import()`
  // does its file read asynchronously, so a `finally` that fired without
  // awaiting `fn` first would delete tempDir out from under a still-pending
  // import() — an observed, not hypothetical, ENOENT race.
  try { return await fn(tempDir); } finally { rmSync(tempDir, { recursive: true, force: true }); }
}

test('the vendored jobs/artifacts modules import and run a full create->claim->complete cycle from their vendored location', async () => {
  await withInRepoTempDir(async (tempDir) => {
    for (const file of VENDORED_FILES) {
      cpSync(path.join(VENDOR_API_LIB_DIR, file), path.join(tempDir, file));
    }
    const isolatedJobs = require(path.join(tempDir, 'proof-render-jobs.cjs'));
    const isolatedArtifacts = require(path.join(tempDir, 'proof-render-artifacts.cjs'));
    const { makeFakeContext } = require(path.join(SERVICE_DIR, '../../api/_lib/__tests__/fake-firestore.cjs'));

    const fakeCtx = makeFakeContext();
    isolatedJobs.__setTestContext(fakeCtx);
    isolatedArtifacts.__setTestContext(fakeCtx);
    try {
      const job = await isolatedJobs.createProofRenderJob({
        clientId: 'client-a', ownerUid: 'user-a1', recipe: { kind: 'art-scene-v2' }, warnings: [],
        capabilities: { supported: true, unsupportedFeatures: [] }, renderParams: { width: 100, height: 100, fps: 10, durationSeconds: 0.1 },
      });
      const claimed = await isolatedJobs.claimNextProofRenderJob({ workerId: 'isolated-test' });
      assert.equal(claimed.jobId, job.jobId);
      await isolatedJobs.completeProofRenderJob(job.jobId, claimed.workerLease.claimToken, { width: 100, height: 100, fps: 10, codec: 'h264', frameCount: 1, duration: 0.1 });
      const stored = await isolatedJobs.getProofRenderJob(job.jobId, { clientId: 'client-a' });
      assert.equal(stored.status, 'done');
      assert.equal(typeof isolatedArtifacts.uploadProofArtifacts, 'function', 'the vendored artifacts module must export its real API');
    } finally {
      isolatedJobs.__setTestContext(null);
      isolatedArtifacts.__setTestContext(null);
    }
  });
});

// ── Dockerfile.proof COPY-list completeness ────────────────────────────

function dockerfileProofCopySources() {
  const dockerfileSource = readFileSync(path.join(SERVICE_DIR, 'Dockerfile.proof'), 'utf8');
  const copyLines = [...dockerfileSource.matchAll(/^COPY\s+(.+)$/gm)].map((m) => m[1].trim());
  return copyLines.flatMap((line) => line.split(/\s+/).slice(0, -1));
}

test('Dockerfile.proof\'s real COPY list includes proof-server.mjs, proof-render-worker.mjs, and vendor/ (both closures land under one vendor/ COPY)', () => {
  const sources = dockerfileProofCopySources();
  assert.ok(sources.includes('proof-server.mjs'));
  assert.ok(sources.includes('proof-render-worker.mjs'));
  assert.ok(sources.includes('art-render.mjs'));
  assert.ok(sources.includes('art-render-validation.mjs'));
  assert.ok(sources.includes('art-scene.mjs'));
  assert.ok(sources.includes('art-recipe.mjs'));
  assert.ok(sources.some((s) => s.replace(/\/$/, '') === 'vendor'));
  assert.ok(sources.some((s) => s.replace(/\/$/, '') === 'assets'));
});

test('every Dockerfile.proof COPY source actually exists on disk', () => {
  const sources = dockerfileProofCopySources();
  for (const rel of sources) {
    assert.ok(existsSync(path.join(SERVICE_DIR, rel)), `Dockerfile.proof COPY source does not exist: ${rel}`);
  }
});

test('proof-server.mjs and its full module graph import successfully from an ISOLATED copy of ONLY Dockerfile.proof\'s real COPY-list files (catches a missing-COPY-line packaging bug without needing Docker)', async () => {
  const sources = dockerfileProofCopySources();
  await withInRepoTempDir(async (tempDir) => {
    for (const rel of sources) {
      cpSync(path.join(SERVICE_DIR, rel), path.join(tempDir, rel), { recursive: true });
    }
    const isolatedServerUrl = pathToFileURL(path.join(tempDir, 'proof-server.mjs')).href;
    const isolated = await import(isolatedServerUrl);
    assert.equal(typeof isolated.server, 'object');
    assert.equal(typeof isolated.isAuthorized, 'function');
    // The isolated server never had .listen() called on it (import.meta.url
    // !== the real running process's argv[1] in THIS context either) — this
    // test's whole point is "does the module graph resolve," not "does it
    // bind a port," so no cleanup/close is needed.
  });
});
