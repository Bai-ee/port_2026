// proof-render-view.test.js — Phase 2 (STUDIO-DETERMINISTIC-FINAL-RENDER-
// SONNET-HANDOFF.md). Covers app/api/dashboard/proof-render/route.js's own
// GET-response shaping logic (extracted to api/_lib/proof-render-view.cjs
// precisely so it's testable — this repo's route.js files have no direct
// test coverage of their own): own-client signed read, metadata-only legacy
// job, expired artifact, signing failure, and no path leakage.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { projectArtifactView, withSignedUrls } = require('../proof-render-view.cjs');

const BASE_JOB = {
  jobId: 'proof_1', clientId: 'client-a', ownerUid: 'user-a1', status: 'done',
  recipe: { kind: 'art-scene-v2' }, warnings: [], capabilities: { supported: true, unsupportedFeatures: [] },
  renderParams: { width: 240, height: 240, fps: 12, durationSeconds: 0.5 },
  output: { width: 240, height: 240, fps: 12, codec: 'h264', frameCount: 6, duration: 0.5 },
  error: null, attempts: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:05.000Z',
  startedAt: '2026-01-01T00:00:01.000Z', completedAt: '2026-01-01T00:00:05.000Z',
};

function jobWithArtifact(overrides = {}) {
  return {
    ...BASE_JOB,
    artifact: {
      mp4StoragePath: 'proof-render-artifacts/client-a/proof_1/claim-1/proof.mp4',
      posterStoragePath: 'proof-render-artifacts/client-a/proof_1/claim-1/poster.jpg',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      retentionDays: 7,
      ...overrides,
    },
  };
}

// ── projectArtifactView ──────────────────────────────────────────────────

test('a metadata-only legacy job (no artifact at all) projects hasArtifact:false, no expired flag, no crash', () => {
  const view = projectArtifactView({ ...BASE_JOB, artifact: null });
  assert.deepEqual(view.artifact, { hasArtifact: false });
});

test('a non-expired artifact projects expired:false', () => {
  const view = projectArtifactView(jobWithArtifact());
  assert.equal(view.artifact.hasArtifact, true);
  assert.equal(view.artifact.expired, false);
});

test('an artifact past its expiresAt projects expired:true, with no signed URLs (those require withSignedUrls, never computed here)', () => {
  const past = new Date(Date.now() - 1000).toISOString();
  const view = projectArtifactView(jobWithArtifact({ expiresAt: past }));
  assert.equal(view.artifact.expired, true);
  assert.equal(view.artifact.mp4Url, undefined);
  assert.equal(view.artifact.posterUrl, undefined);
});

test('an artifact with an unparseable expiresAt is treated as expired (fail honest, not fail open)', () => {
  const view = projectArtifactView(jobWithArtifact({ expiresAt: 'not-a-date' }));
  assert.equal(view.artifact.expired, true);
});

test('never leaks the raw storage paths — only hasArtifact/expiresAt/expired', () => {
  const view = projectArtifactView(jobWithArtifact());
  const serialized = JSON.stringify(view);
  assert.ok(!serialized.includes('mp4StoragePath'));
  assert.ok(!serialized.includes('posterStoragePath'));
  assert.ok(!serialized.includes('proof-render-artifacts/'));
});

test('never leaks workerLease/claimToken/recipeHash/lastClaimToken (delegates to toClientView, which already guarantees this)', () => {
  const view = projectArtifactView(jobWithArtifact());
  const serialized = JSON.stringify(view);
  assert.ok(!('workerLease' in view));
  assert.ok(!serialized.includes('claimToken'));
  assert.ok(!('recipeHash' in view));
  assert.ok(!('lastClaimToken' in view));
});

// ── withSignedUrls ────────────────────────────────────────────────────────

test('mints fresh signed URLs for a non-expired artifact and merges them onto the view', async () => {
  const job = jobWithArtifact();
  const view = projectArtifactView(job);
  const mintReadUrls = async (artifact) => {
    assert.deepEqual(artifact, job.artifact, 'must be called with the exact raw artifact record');
    return { mp4Url: 'https://signed/proof.mp4?x=1', posterUrl: 'https://signed/poster.jpg?x=1' };
  };
  const result = await withSignedUrls(view, job, { mintReadUrls });
  assert.equal(result.artifact.mp4Url, 'https://signed/proof.mp4?x=1');
  assert.equal(result.artifact.posterUrl, 'https://signed/poster.jpg?x=1');
  assert.equal(result.artifact.hasArtifact, true);
});

test('never attempts to sign a metadata-only legacy job (no artifact at all)', async () => {
  const job = { ...BASE_JOB, artifact: null };
  const view = projectArtifactView(job);
  let called = false;
  const mintReadUrls = async () => { called = true; return { mp4Url: 'x', posterUrl: 'y' }; };
  const result = await withSignedUrls(view, job, { mintReadUrls });
  assert.equal(called, false);
  assert.deepEqual(result.artifact, { hasArtifact: false });
});

test('never attempts to sign an expired artifact — stays an honest expired:true with no URLs, never a link to a possibly-deleted object', async () => {
  const past = new Date(Date.now() - 1000).toISOString();
  const job = jobWithArtifact({ expiresAt: past });
  const view = projectArtifactView(job);
  let called = false;
  const mintReadUrls = async () => { called = true; return { mp4Url: 'x', posterUrl: 'y' }; };
  const result = await withSignedUrls(view, job, { mintReadUrls });
  assert.equal(called, false);
  assert.equal(result.artifact.expired, true);
  assert.equal(result.artifact.mp4Url, undefined);
});

test('a signing failure degrades to urlsAvailable:false rather than throwing — every other job field is still returned', async () => {
  const job = jobWithArtifact();
  const view = projectArtifactView(job);
  const mintReadUrls = async () => { throw new Error('simulated IAM/signing outage'); };
  const result = await withSignedUrls(view, job, { mintReadUrls });
  assert.equal(result.artifact.urlsAvailable, false);
  assert.equal(result.artifact.mp4Url, undefined);
  assert.equal(result.status, 'done', 'the rest of the job view must remain intact despite the signing failure');
  assert.deepEqual(result.output, BASE_JOB.output);
});

// ── list-shape behavior (list responses never sign, per projectArtifactView alone) ──

test('list-style usage (projectArtifactView with no withSignedUrls call) never includes signed URLs, avoiding N signing calls per poll', () => {
  const jobA = jobWithArtifact({ mp4StoragePath: 'proof-render-artifacts/client-a/proof_1/claim-1/proof.mp4' });
  const jobB = { ...jobA, jobId: 'proof_2', artifact: null };
  const views = [jobA, jobB].map(projectArtifactView);
  assert.equal(views[0].artifact.hasArtifact, true);
  assert.equal(views[0].artifact.mp4Url, undefined);
  assert.equal(views[1].artifact.hasArtifact, false);
});
