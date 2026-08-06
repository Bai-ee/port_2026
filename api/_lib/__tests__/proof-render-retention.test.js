// proof-render-retention.test.js — Phase 2 (STUDIO-DETERMINISTIC-FINAL-
// RENDER-SONNET-HANDOFF.md). Pure orchestration tests against the in-memory
// fake Firestore + Storage bucket — proves sweepExpiredProofRenderArtifacts'
// own logic (expiry comparison, per-job error isolation, real Storage
// deletion + job-doc clearing) on top of the already-proven jobs.cjs/
// artifacts.cjs primitives (see their own test files for the primitives'
// own coverage).

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const jobs = require('../proof-render-jobs.cjs');
const artifacts = require('../proof-render-artifacts.cjs');
const { sweepExpiredProofRenderArtifacts, reclaimOrphanedProofRenderArtifacts } = require('../proof-render-retention.cjs');
const { makeFakeContext } = require('./fake-firestore.cjs');

const CLIENT_A = 'client-a';
const USER_A = 'user-a1';
const SUPPORTED_CAPABILITIES = { supported: true, unsupportedFeatures: [] };
const RECIPE = { kind: 'art-scene-v2', schemaVersion: 1, mat: { baseColor: '#7dd3fc' } };
const RENDER_PARAMS = { width: 240, height: 240, fps: 12, durationSeconds: 0.5, warmupFrames: 3 };
const SANITIZED_OUTPUT = { width: 240, height: 240, fps: 12, codec: 'h264', frameCount: 6, duration: 0.5 };

let fakeCtx;
let tmpDir;

beforeEach(async () => {
  fakeCtx = makeFakeContext();
  jobs.__setTestContext(fakeCtx);
  artifacts.__setTestContext(fakeCtx);
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'proof-render-retention-test-'));
});
afterEach(async () => {
  jobs.__setTestContext(null);
  artifacts.__setTestContext(null);
  await rm(tmpDir, { recursive: true, force: true });
});

async function createDoneJobWithArtifact({ expiresAt, claimToken = 'claim-1' } = {}) {
  const job = await jobs.createProofRenderJob({
    clientId: CLIENT_A, ownerUid: USER_A, recipe: RECIPE, warnings: [],
    capabilities: SUPPORTED_CAPABILITIES, renderParams: RENDER_PARAMS,
  });
  const claimed = await jobs.claimNextProofRenderJob({ workerId: 'w1' });
  const mp4Path = path.join(tmpDir, `${job.jobId}.mp4`);
  const posterPath = path.join(tmpDir, `${job.jobId}.jpg`);
  await writeFile(mp4Path, Buffer.from('mp4'));
  await writeFile(posterPath, Buffer.from('jpg'));
  const uploaded = await artifacts.uploadProofArtifacts({ clientId: CLIENT_A, jobId: job.jobId, claimToken, mp4Path, posterPath });
  const artifact = { ...uploaded, expiresAt: expiresAt || uploaded.expiresAt };
  await jobs.completeProofRenderJob(job.jobId, claimed.workerLease.claimToken, SANITIZED_OUTPUT, artifact);
  return { job, artifact };
}

test('sweeps and deletes an expired artifact, clearing it from the job doc', async () => {
  const past = new Date(Date.now() - 1000).toISOString();
  const { job, artifact } = await createDoneJobWithArtifact({ expiresAt: past });

  const summary = await sweepExpiredProofRenderArtifacts();
  assert.equal(summary.scanned, 1);
  assert.equal(summary.deleted, 1);
  assert.equal(summary.errors, 0);

  const stored = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
  assert.equal(stored.artifact, null);
  assert.equal(stored.status, 'done', 'sweeping must never change the job status itself');

  const bucket = fakeCtx.adminStorage.bucket();
  assert.equal(bucket._raw(artifact.mp4StoragePath), undefined);
  assert.equal(bucket._raw(artifact.posterStoragePath), undefined);
});

test('a not-yet-expired artifact is left completely untouched', async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const { job, artifact } = await createDoneJobWithArtifact({ expiresAt: future });

  const summary = await sweepExpiredProofRenderArtifacts();
  assert.equal(summary.scanned, 1);
  assert.equal(summary.deleted, 0);
  assert.equal(summary.skipped, 0);

  const stored = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
  assert.deepEqual(stored.artifact, artifact);
  const bucket = fakeCtx.adminStorage.bucket();
  assert.ok(bucket._raw(artifact.mp4StoragePath), 'a not-yet-expired artifact must never be deleted');
});

test('one job\'s deletion failure never aborts the rest of the batch — every outcome is tallied', async () => {
  const past = new Date(Date.now() - 1000).toISOString();
  const { job: failingJob } = await createDoneJobWithArtifact({ expiresAt: past, claimToken: 'claim-a' });
  const { job: okJob, artifact: okArtifact } = await createDoneJobWithArtifact({ expiresAt: past, claimToken: 'claim-b' });

  const originalDelete = artifacts.deleteProofArtifacts;
  artifacts.deleteProofArtifacts = async (paths) => {
    if (paths.mp4StoragePath.includes(failingJob.jobId)) throw new Error('simulated Storage outage');
    return originalDelete(paths);
  };
  try {
    const summary = await sweepExpiredProofRenderArtifacts();
    assert.equal(summary.scanned, 2);
    assert.equal(summary.deleted, 1);
    assert.equal(summary.errors, 1);
    assert.equal(summary.errorDetails[0].jobId, failingJob.jobId);
    assert.match(summary.errorDetails[0].message, /simulated Storage outage/);

    const failingStored = await jobs.getProofRenderJob(failingJob.jobId, { clientId: CLIENT_A });
    assert.ok(failingStored.artifact, 'a failed delete must leave the job\'s artifact reference intact — never cleared without a confirmed deletion');

    const okStored = await jobs.getProofRenderJob(okJob.jobId, { clientId: CLIENT_A });
    assert.equal(okStored.artifact, null);
    const bucket = fakeCtx.adminStorage.bucket();
    assert.equal(bucket._raw(okArtifact.mp4StoragePath), undefined);
  } finally {
    artifacts.deleteProofArtifacts = originalDelete;
  }
});

test('an empty queue (no done jobs with artifacts) sweeps cleanly with an all-zero summary', async () => {
  const summary = await sweepExpiredProofRenderArtifacts();
  assert.deepEqual(summary, { scanned: 0, deleted: 0, skipped: 0, errors: 0, errorDetails: [] });
});

test('respects the limit option — never scans more candidates than requested', async () => {
  const past = new Date(Date.now() - 1000).toISOString();
  await createDoneJobWithArtifact({ expiresAt: past, claimToken: 'claim-a' });
  await createDoneJobWithArtifact({ expiresAt: past, claimToken: 'claim-b' });
  await createDoneJobWithArtifact({ expiresAt: past, claimToken: 'claim-c' });

  const summary = await sweepExpiredProofRenderArtifacts({ limit: 2 });
  assert.equal(summary.scanned, 2);
});

// ── reclaimOrphanedProofRenderArtifacts (P2-2: "timed-out or partially
// failed uploads leave unreachable Storage objects") ───────────────────────

/** Uploads raw artifact objects for a claimToken WITHOUT going through
 * completeProofRenderJob — simulates exactly the race this sweep exists to
 * reclaim: an upload that finished (or partially finished) with nothing
 * ever ending up referencing it. */
async function uploadUnreferencedArtifact({ jobId, claimToken }) {
  const mp4Path = path.join(tmpDir, `${jobId}-${claimToken}.mp4`);
  const posterPath = path.join(tmpDir, `${jobId}-${claimToken}.jpg`);
  await writeFile(mp4Path, Buffer.from('mp4'));
  await writeFile(posterPath, Buffer.from('jpg'));
  return artifacts.uploadProofArtifacts({ clientId: CLIENT_A, jobId, claimToken, mp4Path, posterPath });
}

test('reclaims an orphaned object whose (clientId, jobId) has no job record at all', async () => {
  const orphan = await uploadUnreferencedArtifact({ jobId: 'proof_never_existed', claimToken: 'claim-orphan' });
  const bucket = fakeCtx.adminStorage.bucket();
  assert.ok(bucket._raw(orphan.mp4StoragePath), 'test setup: the object must actually be there before the sweep');

  const summary = await reclaimOrphanedProofRenderArtifacts();
  assert.equal(summary.groups, 1);
  assert.equal(summary.deleted, 1);
  assert.equal(summary.skipped, 0);
  assert.equal(bucket._raw(orphan.mp4StoragePath), undefined);
  assert.equal(bucket._raw(orphan.posterStoragePath), undefined);
});

test('THE REQUIRED CASE: never deletes an object whose owning job is still queued or rendering — in-flight jobs are always left alone', async () => {
  const job = await jobs.createProofRenderJob({
    clientId: CLIENT_A, ownerUid: USER_A, recipe: RECIPE, warnings: [], capabilities: SUPPORTED_CAPABILITIES, renderParams: RENDER_PARAMS,
  });
  const claimed = await jobs.claimNextProofRenderJob({ workerId: 'w-in-flight' });
  // Upload lands (e.g. the mp4 finished uploading) WHILE the job is still
  // 'rendering' — completeProofRenderJob has not run yet. This is exactly
  // the shape an in-progress or not-yet-finalized upload has; it must NOT
  // be mistaken for an orphan just because no `artifact` field points to
  // it yet.
  const uploaded = await uploadUnreferencedArtifact({ jobId: job.jobId, claimToken: claimed.workerLease.claimToken });
  const bucket = fakeCtx.adminStorage.bucket();

  const stillRendering = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
  assert.equal(stillRendering.status, 'rendering', 'test setup: the job must genuinely still be in flight');

  const summary = await reclaimOrphanedProofRenderArtifacts();
  assert.equal(summary.deleted, 0, 'nothing may be deleted while any group\'s owning job is still in flight');
  assert.equal(summary.skipped, 1);
  assert.ok(bucket._raw(uploaded.mp4StoragePath), 'the in-flight job\'s object must survive the sweep untouched');
  assert.ok(bucket._raw(uploaded.posterStoragePath));
});

test('never touches a terminal job\'s OWN current, still-referenced artifact', async () => {
  const { job, artifact } = await createDoneJobWithArtifact({ expiresAt: new Date(Date.now() + 60_000).toISOString(), claimToken: 'claim-current' });

  const summary = await reclaimOrphanedProofRenderArtifacts();
  assert.equal(summary.deleted, 0);
  assert.equal(summary.skipped, 1, 'the job\'s own current artifact must be recognized and skipped, not reclaimed');

  const bucket = fakeCtx.adminStorage.bucket();
  assert.ok(bucket._raw(artifact.mp4StoragePath), 'a currently-referenced, not-yet-expired artifact must never be touched by the orphan sweep');
  const stored = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
  assert.deepEqual(stored.artifact, artifact);
});

test('reclaims a STALE claim\'s leftover objects on a job that has since completed under a DIFFERENT claim, while leaving the current claim\'s own artifact alone', async () => {
  const { job, artifact: currentArtifact } = await createDoneJobWithArtifact({
    expiresAt: new Date(Date.now() + 60_000).toISOString(), claimToken: 'claim-winner',
  });
  // A losing/earlier claim's own leftover upload for the SAME job — never
  // referenced by the job's own (already-completed, different-claimToken)
  // artifact field.
  const stale = await uploadUnreferencedArtifact({ jobId: job.jobId, claimToken: 'claim-loser' });
  const bucket = fakeCtx.adminStorage.bucket();

  const summary = await reclaimOrphanedProofRenderArtifacts();
  assert.equal(summary.groups, 2);
  assert.equal(summary.deleted, 1);
  assert.equal(summary.skipped, 1);

  assert.equal(bucket._raw(stale.mp4StoragePath), undefined, 'the stale/losing claim\'s leftover object must be reclaimed');
  assert.ok(bucket._raw(currentArtifact.mp4StoragePath), 'the WINNING claim\'s own current artifact must survive untouched');
});

test('one group\'s cleanup failure never aborts the rest of the sweep — every outcome is tallied, best-effort only', async () => {
  const orphanA = await uploadUnreferencedArtifact({ jobId: 'proof_orphan_a', claimToken: 'claim-a' });
  const orphanB = await uploadUnreferencedArtifact({ jobId: 'proof_orphan_b', claimToken: 'claim-b' });

  const originalDelete = artifacts.deleteStorageObject;
  artifacts.deleteStorageObject = async (objectPath) => {
    if (objectPath.includes('proof_orphan_a')) throw new Error('simulated Storage outage');
    return originalDelete(objectPath);
  };
  try {
    const summary = await reclaimOrphanedProofRenderArtifacts();
    assert.equal(summary.groups, 2);
    assert.equal(summary.errors, 1);
    assert.equal(summary.deleted, 1);
    assert.match(summary.errorDetails[0].message, /simulated Storage outage/);

    const bucket = fakeCtx.adminStorage.bucket();
    assert.ok(bucket._raw(orphanA.mp4StoragePath), 'a failed delete must leave the object in place, not silently drop it');
    assert.equal(bucket._raw(orphanB.mp4StoragePath), undefined, 'the OTHER orphan must still be reclaimed despite the first one\'s failure');
  } finally {
    artifacts.deleteStorageObject = originalDelete;
  }
});

test('an unrecognized object path (outside the PREFIX/clientId/jobId/claimToken/file shape) is never touched', async () => {
  const bucket = fakeCtx.adminStorage.bucket();
  await bucket.file(`${artifacts.PREFIX}/not-a-well-formed-path.txt`).save(Buffer.from('x'));

  const summary = await reclaimOrphanedProofRenderArtifacts();
  assert.equal(summary.groups, 0);
  assert.equal(summary.deleted, 0);
  assert.ok(bucket._raw(`${artifacts.PREFIX}/not-a-well-formed-path.txt`), 'an unrecognized shape must be left alone entirely, never guessed at');
});
