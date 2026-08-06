// proof-render-worker.test.mjs — Slice 4d. Real headless Chromium + real
// local ffmpeg/ffprobe (same as Slice 4c's art-render.test.mjs) PLUS the
// Firestore job queue against the in-memory fake — proves the full
// create → claim → render → complete chain end to end, including that the
// completed job's stored output is the sanitized metadata only (no local
// filesystem path ever reaches the job record).

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { normalizeArtSceneRecipe } from '../art-recipe.mjs';
import { checkCapabilities, ArtRenderError } from '../art-render-validation.mjs';
import { runOneProofRenderJob, drainProofRenderJobs, _internals as workerInternals } from '../proof-render-worker.mjs';
import { _internals as artRenderInternals } from '../art-render.mjs';

const require = createRequire(import.meta.url);
// Vendored — must be the SAME module instance proof-render-worker.mjs itself requires.
const jobs = require('../vendor/api-lib/proof-render-jobs.cjs');
const artifacts = require('../vendor/api-lib/proof-render-artifacts.cjs');
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');

let fakeCtx;
beforeEach(() => {
  fakeCtx = makeFakeContext();
  jobs.__setTestContext(fakeCtx);
  artifacts.__setTestContext(fakeCtx); // same fake bucket instance backs both modules
});
afterEach(() => {
  jobs.__setTestContext(null);
  artifacts.__setTestContext(null);
});

const CLIENT_A = 'client-a';
const OWNER_A = 'user-a1';
const SMALL_PARAMS = { width: 200, height: 200, fps: 10, durationSeconds: 0.2, warmupFrames: 2 };

function supportedRecipe(scene = {}) {
  return normalizeArtSceneRecipe({ kind: 'art-scene-v2', schemaVersion: 1, scene: { envIntensity: 0, ...scene } }).recipe;
}

async function enqueue(scene = {}, renderParams = SMALL_PARAMS) {
  const recipe = supportedRecipe(scene);
  const capabilities = checkCapabilities(recipe);
  assert.equal(capabilities.supported, true, 'test fixture recipe must itself be within the supported profile');
  return jobs.createProofRenderJob({
    clientId: CLIENT_A, ownerUid: OWNER_A, recipe, warnings: [], capabilities, renderParams,
  });
}

test('runOneProofRenderJob claims, renders, and completes a queued job — output is the sanitized ffprobe metadata only', async () => {
  const job = await enqueue({ mat: { baseColor: '#7dd3fc' } });
  const result = await runOneProofRenderJob({ workerId: 'test-worker' });

  assert.equal(result.claimed, true);
  assert.equal(result.jobId, job.jobId);
  assert.equal(result.status, 'done');
  assert.equal(result.metadata.width, SMALL_PARAMS.width);
  assert.equal(result.metadata.codec, 'h264');

  const stored = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
  assert.equal(stored.status, 'done');
  assert.deepEqual(stored.output, result.metadata);

  const view = jobs.toClientView(stored);
  const serialized = JSON.stringify(view);
  assert.ok(!serialized.includes('/tmp/'), 'the completed job record must never contain a local filesystem path');
  assert.ok(!serialized.toLowerCase().includes('.mp4'), 'no mp4 file path leaked into the stored output either');
});

// ── Live device-screen capture metadata reaches the stored job ("Live URL
// wired to Final Render" wiring round, requirement 5) — renderArtScene's
// `result.liveCapture` (url/frameCount/readiness/scrollInfo/gpu) used to be
// computed and then silently discarded by the worker; a software-rendering
// fallback had nowhere durable to surface. DI-injects
// artRenderInternals.captureDeviceLiveFrames with a synthetic fake — NEVER
// real network — same seam/constraint art-render.test.mjs's own live-frame
// tests already use.
const LIVE_STILL_FIXTURE = new URL('../assets/artwork/holocloth-default-artwork.jpg', import.meta.url).pathname;
function liveFrameDataUrl() {
  return `data:image/jpeg;base64,${readFileSync(LIVE_STILL_FIXTURE).toString('base64')}`;
}

test('a live device-screen job merges liveCapture (incl. gpu) onto the stored output — a non-live job stays byte-identical to ffprobe metadata alone (see the test above)', async () => {
  const frame = liveFrameDataUrl();
  const originalCapture = artRenderInternals.captureDeviceLiveFrames;
  artRenderInternals.captureDeviceLiveFrames = async () => ({
    frames: [frame, frame],
    viewport: { width: 150, height: 100 },
    readiness: { ready: true, reason: 'visual-ready' },
    scrollInfo: { y: 500, how: 'paced-stepped', staleRetryTotal: 0 },
    gpu: { renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)', software: false },
  });
  try {
    const job = await enqueue({ clothShape: 'device', devicePrimary: { liveUrl: 'https://example.com/live-page' } });
    const result = await runOneProofRenderJob({ workerId: 'live-capture-test' });

    assert.equal(result.status, 'done');
    assert.ok(result.metadata.liveCapture, 'the worker\'s own returned metadata must carry the SAME enriched liveCapture object that was persisted');
    assert.equal(result.metadata.liveCapture.gpu.software, false);

    const stored = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
    assert.equal(stored.status, 'done');
    assert.ok(stored.output.liveCapture, 'liveCapture must reach the persisted job record, not be discarded');
    assert.equal(stored.output.liveCapture.url, 'https://example.com/live-page');
    assert.equal(stored.output.liveCapture.frameCount, 2);
    assert.deepEqual(stored.output.liveCapture.gpu, { renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)', software: false });
    // The ffprobe fields themselves must still be present alongside
    // liveCapture — this is an ADDITION, never a replacement.
    assert.equal(stored.output.width, SMALL_PARAMS.width);
    assert.equal(stored.output.codec, 'h264');

    const view = jobs.toClientView(stored);
    const serialized = JSON.stringify(view);
    assert.ok(!serialized.includes('/tmp/'), 'no local filesystem path in the live-capture metadata either');
  } finally {
    artRenderInternals.captureDeviceLiveFrames = originalCapture;
  }
});

test('a software-rendering fallback (gpu.software:true) reaches the stored job just as honestly as a real-GPU capture — never silently dropped either way', async () => {
  const frame = liveFrameDataUrl();
  const originalCapture = artRenderInternals.captureDeviceLiveFrames;
  artRenderInternals.captureDeviceLiveFrames = async () => ({
    frames: [frame],
    viewport: { width: 150, height: 100 },
    readiness: { ready: true, reason: 'visual-ready' },
    scrollInfo: { y: 0, how: 'paced-stepped', staleRetryTotal: 0 },
    gpu: { renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 16.0.0) (0x0000C0DE)))', software: true },
  });
  try {
    const job = await enqueue({ clothShape: 'device', devicePrimary: { liveUrl: 'https://slow-swiftshader-example.com/' } });
    await runOneProofRenderJob({ workerId: 'live-capture-software-test' });
    const stored = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
    assert.equal(stored.output.liveCapture.gpu.software, true, 'a software fallback must be surfaced, not silently discarded like it was before this fix');
  } finally {
    artRenderInternals.captureDeviceLiveFrames = originalCapture;
  }
});

// ── Phase 1 (STUDIO-DETERMINISTIC-FINAL-RENDER-SONNET-HANDOFF.md): artifact
// upload + total-deadline enforcement wired into the worker. ──────────────

test('a job only ever reaches done with a durable artifact already uploaded — exact artifact object is what gets stored', async () => {
  const job = await enqueue({ mat: { baseColor: '#7dd3fc' } });
  const result = await runOneProofRenderJob({ workerId: 'test-worker' });
  assert.equal(result.status, 'done');
  assert.ok(result.artifact, 'runOneProofRenderJob must return the artifact it uploaded');
  assert.match(result.artifact.mp4StoragePath, new RegExp(`^proof-render-artifacts/${CLIENT_A}/${job.jobId}/`));
  assert.match(result.artifact.posterStoragePath, new RegExp(`^proof-render-artifacts/${CLIENT_A}/${job.jobId}/`));

  const stored = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
  assert.deepEqual(stored.artifact, result.artifact, 'the exact artifact object passed to completeProofRenderJob is what gets persisted');

  const bucket = fakeCtx.adminStorage.bucket();
  assert.ok(bucket._raw(result.artifact.mp4StoragePath), 'the MP4 must genuinely be present in Storage, not just referenced');
  assert.ok(bucket._raw(result.artifact.posterStoragePath), 'the poster must genuinely be present in Storage, not just referenced');

  const view = jobs.toClientView(stored);
  assert.deepEqual(view.artifact, { hasArtifact: true, expiresAt: result.artifact.expiresAt });
});

test('an artifact upload failure is requeued through the existing fenced requeue path, exactly like a render failure', async () => {
  const job = await enqueue({ mat: { baseColor: '#00ffaa' } });
  const originalUpload = artifacts.uploadProofArtifacts;
  artifacts.uploadProofArtifacts = async () => { throw new Error('simulated Storage outage'); };
  try {
    const result = await runOneProofRenderJob({ workerId: 'upload-fail-test' });
    assert.equal(result.claimed, true);
    assert.equal(result.jobId, job.jobId);
    assert.equal(result.status, 'queued', 'an upload failure must be requeued for retry, not treated as a special terminal case');
    assert.match(result.error, /simulated Storage outage/);

    const stored = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
    assert.equal(stored.status, 'queued');
    assert.equal(stored.output, null, 'a job that never reached completion must never have output/artifact set');
    assert.equal(stored.artifact, null);
  } finally {
    artifacts.uploadProofArtifacts = originalUpload;
  }
});

test('a stale claim (reclaimed by a newer worker) whose upload completes anyway never becomes authoritative, and its orphaned artifact is cleaned up', async () => {
  const job = await enqueue({ mat: { baseColor: '#ff00aa' } });
  const originalUpload = artifacts.uploadProofArtifacts;
  const originalDelete = artifacts.deleteProofArtifacts;
  const deleteCalls = [];
  artifacts.deleteProofArtifacts = async (paths) => { deleteCalls.push(paths); return originalDelete(paths); };
  let capturedArtifact = null;
  artifacts.uploadProofArtifacts = async (opts) => {
    const uploaded = await originalUpload(opts);
    capturedArtifact = uploaded;
    // Simulate this worker's lease being reclaimed by a newer claim WHILE
    // its own upload was in flight — by the time upload resolves, this
    // claimToken is no longer the active lease.
    await jobs.requeueProofRenderJob(job.jobId, opts.claimToken, new Error('simulated reclaim'));
    await jobs.claimNextProofRenderJob({ workerId: 'newer-claim' }); // some other worker now holds it
    return uploaded;
  };
  try {
    const result = await runOneProofRenderJob({ workerId: 'stale-worker' });
    assert.equal(result.status, 'lost-claim', 'completion must fail fenced, and the stale worker\'s own requeue attempt must also be fenced out');
    assert.ok(capturedArtifact, 'sanity: the upload itself did succeed before the claim was lost');

    assert.equal(deleteCalls.length, 1, 'the orphaned (never-authoritative) artifact must be cleaned up exactly once');
    assert.deepEqual(deleteCalls[0], capturedArtifact);

    const bucket = fakeCtx.adminStorage.bucket();
    assert.equal(bucket._raw(capturedArtifact.mp4StoragePath), undefined, 'the orphaned MP4 must actually be deleted from Storage, not just logically discarded');
    assert.equal(bucket._raw(capturedArtifact.posterStoragePath), undefined);
  } finally {
    artifacts.uploadProofArtifacts = originalUpload;
    artifacts.deleteProofArtifacts = originalDelete;
  }
});

test('two claim-scoped uploads for the SAME job never collide — different claimTokens produce different storage paths', async () => {
  await enqueue({ mat: { baseColor: '#123abc' } });
  const pathsSeen = [];
  const originalUpload = artifacts.uploadProofArtifacts;
  artifacts.uploadProofArtifacts = async (opts) => {
    const result = await originalUpload(opts);
    pathsSeen.push(result.mp4StoragePath);
    return result;
  };
  const originalComplete = jobs.completeProofRenderJob;
  let completeCallCount = 0;
  jobs.completeProofRenderJob = async (...args) => {
    completeCallCount += 1;
    if (completeCallCount === 1) throw new Error('simulated stale claim on first attempt');
    return originalComplete(...args);
  };
  try {
    // First attempt: upload succeeds, but completion is forced to fail —
    // requeues through the real fenced path (unpatched requeueProofRenderJob).
    const firstRun = await runOneProofRenderJob({ workerId: 'w1' });
    assert.equal(firstRun.status, 'queued', 'first attempt requeues after a simulated completion failure');
    // The real requeue schedules a 30s backoff before the job is reclaimable
    // — not what this test is about, so fast-forward it directly rather than
    // sleeping 30s real time.
    fakeCtx.adminDb._patch(jobs.COLLECTION, firstRun.jobId, { nextAttemptAt: new Date(0).toISOString(), nextAttemptAtTs: { toMillis: () => 0 } });
    // Second attempt: a fresh claim on the same job, uploads to a NEW
    // claim-scoped path, and completes for real.
    const secondRun = await runOneProofRenderJob({ workerId: 'w2' });
    assert.equal(secondRun.status, 'done');

    assert.equal(pathsSeen.length, 2);
    assert.notEqual(pathsSeen[0], pathsSeen[1], 'two different claims on the same job must upload to two different claim-scoped paths');
  } finally {
    artifacts.uploadProofArtifacts = originalUpload;
    jobs.completeProofRenderJob = originalComplete;
  }
});

test('the total render/job deadline aborts an in-flight render, and the failure flows through the existing fenced requeue path', async () => {
  const job = await enqueue({ mat: { baseColor: '#00aaff' } });
  const result = await runOneProofRenderJob({ workerId: 'deadline-render-test', totalDeadlineMs: 1 });
  assert.equal(result.claimed, true);
  assert.equal(result.jobId, job.jobId);
  assert.equal(result.status, 'queued', 'a deadline-aborted render must requeue for retry, not a special terminal case');
  assert.match(result.error, /deadline/i);

  const stored = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
  assert.equal(stored.status, 'queued');
  assert.equal(stored.artifact, null, 'nothing was ever uploaded — the render itself never got far enough');
});

test('the total render/job deadline aborts a slow artifact upload — the worker stops waiting even though the upload keeps running in the background', async () => {
  const job = await enqueue({ mat: { baseColor: '#aa00ff' } });
  const originalUpload = artifacts.uploadProofArtifacts;
  let releaseUpload;
  const hang = new Promise((resolve) => { releaseUpload = resolve; });
  let backgroundUploadStarted = false;
  artifacts.uploadProofArtifacts = async (opts) => {
    backgroundUploadStarted = true;
    await hang; // deliberately never resolves within the deadline window below
    return originalUpload(opts);
  };
  try {
    // Generous enough to comfortably clear the small real render (Chromium
    // launch + a 2-frame capture + ffmpeg/ffprobe), but the upload above is
    // held open indefinitely — the deadline must still fire and the worker
    // must stop waiting on it rather than blocking forever.
    const result = await runOneProofRenderJob({ workerId: 'deadline-upload-test', totalDeadlineMs: 5000 });
    assert.equal(result.claimed, true);
    assert.equal(result.jobId, job.jobId);
    assert.ok(backgroundUploadStarted, 'sanity: the render itself must have completed and reached the upload phase');
    assert.equal(result.status, 'queued', 'a deadline-aborted upload wait must requeue for retry, not a special terminal case');
    assert.match(result.error, /deadline/i);
    assert.match(result.error, /upload/i);

    const stored = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
    assert.equal(stored.artifact, null, 'the worker gave up waiting before the (still-hanging) upload ever resolved, so nothing was ever recorded');
  } finally {
    releaseUpload();
    artifacts.uploadProofArtifacts = originalUpload;
  }
});

test('disposal/cleanup: the deadline timer and heartbeat are both cleared once a job settles — no dangling timers after done', async () => {
  await enqueue({ mat: { baseColor: '#ffaa00' } });
  const originalClearTimeout = global.clearTimeout;
  let clearTimeoutCalls = 0;
  global.clearTimeout = (...args) => { clearTimeoutCalls += 1; return originalClearTimeout(...args); };
  try {
    const result = await runOneProofRenderJob({ workerId: 'disposal-test' });
    assert.equal(result.status, 'done');
    assert.ok(clearTimeoutCalls >= 1, 'the deadline setTimeout must be cleared in finally once the job settles');
  } finally {
    global.clearTimeout = originalClearTimeout;
  }
});

test('runOneProofRenderJob returns claimed:false when the queue is empty', async () => {
  const result = await runOneProofRenderJob({ workerId: 'test-worker' });
  assert.equal(result.claimed, false);
});

// ── busy vs genuinely-empty (P1-B, Production lifecycle hardening) ─────────
// No real render needed for either case: the lease is held directly via
// claimNextProofRenderJob, simulating "another /run is already mid-render"
// without paying for an actual Playwright/ffmpeg pass.

test('runOneProofRenderJob reports busy:true when the singleton lease is already held by another claim', async () => {
  await enqueue({ mat: { baseColor: '#7dd3fc' } });
  await enqueue({ mat: { baseColor: '#00ff00' } }); // a second, genuinely stranded job
  const held = await jobs.claimNextProofRenderJob({ workerId: 'other-worker' });
  assert.ok(held, 'test setup: the first claim must succeed');

  const result = await runOneProofRenderJob({ workerId: 'test-worker' });
  assert.equal(result.claimed, false);
  assert.equal(result.busy, true, 'a second job exists but the singleton lease is held — this is contention, not an empty queue');
});

test('runOneProofRenderJob reports busy:false when the queue is genuinely empty', async () => {
  const result = await runOneProofRenderJob({ workerId: 'test-worker' });
  assert.equal(result.claimed, false);
  assert.equal(result.busy, false);
});

test('two jobs enqueued together are each individually claimed and completed across two worker passes', async () => {
  const jobA = await enqueue({ mat: { baseColor: '#ff0000' } });
  const jobB = await enqueue({ mat: { baseColor: '#00ff00' } });

  const first = await runOneProofRenderJob({ workerId: 'w1' });
  const second = await runOneProofRenderJob({ workerId: 'w2' });

  const claimedIds = [first.jobId, second.jobId].sort();
  assert.deepEqual(claimedIds, [jobA.jobId, jobB.jobId].sort());
  assert.equal(first.status, 'done');
  assert.equal(second.status, 'done');

  const third = await runOneProofRenderJob({ workerId: 'w3' });
  assert.equal(third.claimed, false, 'nothing left to claim once both jobs are done');
});

// ── Heartbeat wiring (Codex re-review, P1) — module-level lease-renewal
// correctness is covered exhaustively in api/_lib/__tests__/proof-render-
// jobs.test.js; this proves the WORKER actually calls it during a render. ──

test('the worker renews its lease (heartbeat) during a render when heartbeatIntervalMs is short enough to fire at least once', async () => {
  const job = await enqueue({ mat: { baseColor: '#123456' } });
  const renewCalls = [];
  const originalRenew = jobs.renewProofRenderLease;
  // jobs is the SAME cached CJS module instance the worker itself
  // requires (Node module cache) — patching the property here is visible
  // to the worker's own `jobs.renewProofRenderLease(...)` call site.
  jobs.renewProofRenderLease = async (jobId, claimToken) => {
    renewCalls.push({ jobId, claimToken });
    return originalRenew(jobId, claimToken);
  };
  try {
    const result = await runOneProofRenderJob({ workerId: 'heartbeat-test', heartbeatIntervalMs: 25 });
    assert.equal(result.status, 'done');
    assert.ok(renewCalls.length >= 1, 'the heartbeat must fire at least once during a real render');
    assert.equal(renewCalls[0].jobId, job.jobId);
  } finally {
    jobs.renewProofRenderLease = originalRenew;
  }
});

test('heartbeatIntervalMs:0 disables the heartbeat entirely (no renewal calls)', async () => {
  await enqueue({ mat: { baseColor: '#654321' } });
  const renewCalls = [];
  const originalRenew = jobs.renewProofRenderLease;
  jobs.renewProofRenderLease = async (...args) => { renewCalls.push(args); return originalRenew(...args); };
  try {
    const result = await runOneProofRenderJob({ workerId: 'no-heartbeat-test', heartbeatIntervalMs: 0 });
    assert.equal(result.status, 'done');
    assert.equal(renewCalls.length, 0);
  } finally {
    jobs.renewProofRenderLease = originalRenew;
  }
});

// ── Failure-safe setup lifecycle (Codex re-review round 3, P1) ─────────────

test('a mkdtemp failure after claiming triggers the same fenced requeue path, and starts no heartbeat interval at all (nothing left dangling)', async () => {
  const job = await enqueue({ mat: { baseColor: '#abcdef' } });
  const originalMkdtemp = workerInternals.mkdtemp;
  workerInternals.mkdtemp = async () => { throw new Error('simulated ENOSPC'); };

  let setIntervalCalls = 0;
  const originalSetInterval = global.setInterval;
  global.setInterval = (...args) => { setIntervalCalls += 1; return originalSetInterval(...args); };

  try {
    const result = await runOneProofRenderJob({ workerId: 'mkdtemp-fail-test' });
    assert.equal(result.claimed, true);
    assert.equal(result.jobId, job.jobId);
    assert.equal(result.status, 'queued', 'a setup failure must trigger the same fenced requeue path a render failure would');
    assert.match(result.error, /simulated ENOSPC/);
    assert.equal(setIntervalCalls, 0, 'the heartbeat must never even start if mkdtemp fails first — there is nothing to leave dangling');

    const stored = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
    assert.equal(stored.status, 'queued');
    assert.equal(stored.workerLease, null, 'the lease must be cleared, not left claimed with nothing tracking it');
  } finally {
    workerInternals.mkdtemp = originalMkdtemp;
    global.setInterval = originalSetInterval;
  }
});

// ── Heartbeat stays active during a slow (but non-blocking) encode/probe
// phase (Codex re-review round 3, P1) ───────────────────────────────────────

test('the heartbeat keeps renewing the lease during a deliberately delayed ffmpeg/ffprobe phase — proves the spawnSync→spawn conversion actually stopped blocking the event loop', async () => {
  const job = await enqueue({ mat: { baseColor: '#7dd3fc' } });
  const originalRunLocalBinary = artRenderInternals.runLocalBinary;
  const DELAY_MS = 250;
  // Wraps the REAL implementation (so exit-code/stderr handling and ffprobe
  // validation are still genuinely exercised) with an artificial delay —
  // proving the delay window doesn't freeze the event loop, not faking
  // away ffmpeg/ffprobe themselves.
  artRenderInternals.runLocalBinary = async (cmd, args) => {
    await new Promise((resolve) => { setTimeout(resolve, DELAY_MS); });
    return originalRunLocalBinary(cmd, args);
  };

  const renewCalls = [];
  const originalRenew = jobs.renewProofRenderLease;
  jobs.renewProofRenderLease = async (jobId, claimToken) => {
    renewCalls.push({ jobId, claimToken });
    return originalRenew(jobId, claimToken);
  };

  try {
    const result = await runOneProofRenderJob({ workerId: 'delayed-encode-test', heartbeatIntervalMs: 25 });
    assert.equal(result.status, 'done', 'the render must still succeed once the (delayed) encode/probe phase completes');
    // 3 runLocalBinary calls total (2 ffmpeg + 1 ffprobe), each delayed
    // 250ms ≈ 750ms of artificially-slow but genuinely non-blocking
    // execution. A 25ms heartbeat firing throughout that window should
    // renew roughly 750/25 ≈ 30 times; the OLD blocking spawnSync
    // implementation would have frozen the event loop for that entire
    // window, capping the real count far below this bound (nothing could
    // fire while spawnSync blocked).
    assert.ok(renewCalls.length >= 10, `expected the heartbeat to fire many times during the delayed encode/probe phase, got ${renewCalls.length}`);
    assert.equal(renewCalls[0].jobId, job.jobId);
  } finally {
    artRenderInternals.runLocalBinary = originalRunLocalBinary;
    jobs.renewProofRenderLease = originalRenew;
  }
});

// ── ffmpeg/ffprobe process-timeout hardening (Slice 4f) — worker-level
// regression: a timed-out render must flow through the EXACT SAME fenced
// requeue path any other render failure already does (no special-casing in
// proof-render-worker.mjs itself — the worker's catch block is generic), and
// the heartbeat interval started for that claim must stop once the job
// settles, exactly like every other failure/requeue path already proves. ──

test('a render whose ffmpeg/ffprobe step times out is requeued through the existing fenced requeue path, and the heartbeat stops once settled', async () => {
  const job = await enqueue({ mat: { baseColor: '#ff00ff' } });
  const originalRunLocalBinary = artRenderInternals.runLocalBinary;
  // Simulates art-render.mjs's own timeout→SIGTERM/SIGKILL escalation
  // throwing its typed ArtRenderError — proves the WORKER's generic
  // catch/requeue path handles a timeout exactly like any other render
  // failure, with no new branch needed in proof-render-worker.mjs itself.
  artRenderInternals.runLocalBinary = async () => {
    throw new ArtRenderError('ffmpeg timed out after 180000ms and was killed (SIGTERM).', { timedOut: true });
  };

  const renewCalls = [];
  const originalRenew = jobs.renewProofRenderLease;
  jobs.renewProofRenderLease = async (jobId, claimToken) => {
    renewCalls.push({ jobId, claimToken });
    return originalRenew(jobId, claimToken);
  };

  try {
    const result = await runOneProofRenderJob({ workerId: 'timeout-test', heartbeatIntervalMs: 20 });
    assert.equal(result.claimed, true);
    assert.equal(result.jobId, job.jobId);
    assert.equal(result.status, 'queued', 'a timed-out render must be requeued for retry, not treated as a special terminal case');
    assert.match(result.error, /timed out/);

    const stored = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
    assert.equal(stored.status, 'queued');
    assert.equal(stored.workerLease, null, 'the lease must be cleared after a timeout-triggered requeue, not left claimed');

    const callsAtSettlement = renewCalls.length;
    await new Promise((r) => { setTimeout(r, 60); }); // several 20ms heartbeat ticks, if any were still firing
    assert.equal(renewCalls.length, callsAtSettlement, 'the heartbeat interval must be cleared once the job is requeued — no renewals after settlement');
  } finally {
    artRenderInternals.runLocalBinary = originalRunLocalBinary;
    jobs.renewProofRenderLease = originalRenew;
  }
});

// ── drainProofRenderJobs (P1 follow-up checkpoint: "worker drain closes
// the dispatch race") — sequential multi-job drain within one call, bounded
// by an iteration cap and a deadline budget so it can never run
// indefinitely. Real renders throughout, same as every other test above. ──

test('drainProofRenderJobs processes every currently-queued job sequentially in one call, regardless of individual outcome', async () => {
  const jobA = await enqueue({ mat: { baseColor: '#111111' } });
  const jobB = await enqueue({ mat: { baseColor: '#222222' } });

  const result = await drainProofRenderJobs({ workerId: 'drain-basic-test' });
  assert.equal(result.stopReason, 'empty');
  assert.equal(result.jobs.length, 2);
  assert.deepEqual(result.jobs.map((j) => j.jobId).sort(), [jobA.jobId, jobB.jobId].sort());
  assert.ok(result.jobs.every((j) => j.status === 'done'));
  assert.deepEqual(result.counts, { done: 2, queued: 0, failed: 0, lostClaim: 0 });
  // 3, not 2: iterations counts every claim ATTEMPT, including the final
  // one that found the queue genuinely empty and stopped the loop — see
  // drainProofRenderJobs' own header ("iterations... >= jobs.length").
  assert.equal(result.iterations, 3);
});

test('drainProofRenderJobs stops at the iteration cap with stopReason:"max-iterations", leaving remaining queued work untouched', async () => {
  const jobA = await enqueue({ mat: { baseColor: '#333333' } });
  const jobB = await enqueue({ mat: { baseColor: '#444444' } });
  const jobC = await enqueue({ mat: { baseColor: '#555555' } }); // must survive untouched

  const result = await drainProofRenderJobs({ workerId: 'drain-cap-test', maxIterations: 2 });
  assert.equal(result.stopReason, 'max-iterations');
  assert.equal(result.iterations, 2);
  assert.equal(result.jobs.length, 2, 'exactly two jobs may be processed when the cap is 2 — never more');
  // WHICH two is deliberately not asserted: all three jobs are created
  // within the same millisecond, so their createdAt tiebreak falls back to
  // the random job-ID suffix and any 2-of-3 subset is a legitimate claim
  // order. The invariant is: two distinct enqueued jobs done, one untouched.
  const allIds = [jobA.jobId, jobB.jobId, jobC.jobId];
  const processedIds = result.jobs.map((j) => j.jobId);
  assert.equal(new Set(processedIds).size, 2, 'the two processed jobs must be distinct — never the same job claimed twice');
  for (const id of processedIds) assert.ok(allIds.includes(id), `processed job ${id} must be one of the three enqueued jobs`);
  assert.ok(result.jobs.every((j) => j.status === 'done'));

  const [leftoverId] = allIds.filter((id) => !processedIds.includes(id));
  const stored = await jobs.getProofRenderJob(leftoverId, { clientId: CLIENT_A });
  assert.equal(stored.status, 'queued', 'the cap must stop the drain — the remaining job must be left alone, not silently claimed anyway');
});

test('drainProofRenderJobs stops once its request deadline elapses, with stopReason:"deadline", preserving whatever it already completed', async () => {
  // Mocked (via _internals.runOneProofRenderJob), not a real render —
  // deliberate, post-P1-correction change: requestDeadlineMs is now ALSO
  // the per-job clamp (see this function's own header comment), so a value
  // small enough to reliably stop the LOOP after one iteration (the thing
  // this test is actually about) would ALSO now clamp that first job's own
  // render to the same tiny budget, making "job A reaches done" and "the
  // deadline trips before job B" mutually exclusive with a real render of
  // unpredictable duration. Real per-job deadline enforcement is already
  // thoroughly covered directly against runOneProofRenderJob elsewhere in
  // this file ("the total render/job deadline aborts an in-flight
  // render," etc.) — this test's own job is the LOOP-level stop condition,
  // which the mock lets it prove precisely and fast.
  const original = workerInternals.runOneProofRenderJob;
  let calls = 0;
  workerInternals.runOneProofRenderJob = async () => {
    calls += 1;
    if (calls === 1) {
      await new Promise((resolve) => { setTimeout(resolve, 50); }); // simulate real render wall-clock time
      return { claimed: true, jobId: 'job-a', status: 'done' };
    }
    // Must never be reached — the deadline has to stop the loop before a second iteration is even attempted.
    return { claimed: true, jobId: 'job-b', status: 'done' };
  };
  try {
    const result = await drainProofRenderJobs({ workerId: 'drain-deadline-test', requestDeadlineMs: 40, maxIterations: 25 });
    assert.equal(result.stopReason, 'deadline');
    assert.equal(result.jobs.length, 1, 'exactly one job should complete before the next pre-iteration deadline check trips');
    assert.equal(result.jobs[0].jobId, 'job-a');
    assert.equal(result.jobs[0].status, 'done');
    assert.equal(calls, 1, 'a second iteration must never even be attempted once the deadline has elapsed');
  } finally {
    workerInternals.runOneProofRenderJob = original;
  }
});

// ── Per-iteration deadline clamping (P1 correction, post-Environment/IBL-
// parity external review): "a new job can start at 239 seconds and run for
// another 600 seconds" — the OLD deadline was checked only BETWEEN
// iterations and never changed what budget an iteration ITSELF received.
// Fast/mocked (via _internals.runOneProofRenderJob — see that seam's own
// comment for why a direct call-site DI is required for an ES module) so
// this can assert on the EXACT deadline value each iteration received,
// without waiting out real request-scale timeouts. ─────────────────────────

test('each iteration receives min(totalDeadlineMs, remaining request budget) as its own per-job deadline — never a fresh full budget regardless of elapsed time', async () => {
  // No enqueue() needed — the mock below replaces runOneProofRenderJob
  // entirely, so this never touches the real queue/claimNextProofRenderJob
  // at all; only the deadline VALUE each call receives is under test.
  const original = workerInternals.runOneProofRenderJob;
  const capturedDeadlines = [];
  let call = 0;
  workerInternals.runOneProofRenderJob = async (opts) => {
    capturedDeadlines.push(opts.totalDeadlineMs);
    call += 1;
    if (call === 1) {
      // Simulate real elapsed wall-clock time during "rendering" — by the
      // time this resolves, a meaningful chunk of the request budget below
      // is already spent.
      await new Promise((resolve) => { setTimeout(resolve, 120); });
      return { claimed: true, jobId: 'fake-1', status: 'done' };
    }
    return { claimed: false, busy: false }; // pretend the queue is now empty — stop cleanly after observing 2 deadlines
  };
  try {
    const requestDeadlineMs = 500; // comfortably more than the 120ms the mock spends, comfortably less than the real 600s per-job ceiling
    await drainProofRenderJobs({ workerId: 'drain-clamp-test', requestDeadlineMs, totalDeadlineMs: 600_000 });
    assert.equal(capturedDeadlines.length, 2, 'both iterations must have run (the second finding the queue empty)');
    assert.ok(capturedDeadlines[0] <= requestDeadlineMs, `iteration 1's deadline (${capturedDeadlines[0]}) must never exceed the request budget (${requestDeadlineMs}), even though the per-job ceiling (600000) is far larger`);
    assert.ok(capturedDeadlines[1] < capturedDeadlines[0], `iteration 2's deadline (${capturedDeadlines[1]}) must be SMALLER than iteration 1's (${capturedDeadlines[0]}) — real time elapsed between them, so less budget remains; a fresh full budget every iteration is exactly the bug this closes`);
    assert.ok(capturedDeadlines[1] > 0 && capturedDeadlines[1] < requestDeadlineMs - 100, 'iteration 2 must reflect the ~120ms already spent, not the original full request budget');
  } finally {
    workerInternals.runOneProofRenderJob = original;
  }
});

test('a job claimed with almost no request budget left still runs, but with only that tiny remaining budget — never silently skipped, never given more than is left', async () => {
  // No enqueue() needed — same reasoning as the test above.
  const original = workerInternals.runOneProofRenderJob;
  const capturedDeadlines = [];
  workerInternals.runOneProofRenderJob = async (opts) => {
    capturedDeadlines.push(opts.totalDeadlineMs);
    return { claimed: false, busy: false };
  };
  try {
    // 5ms is far below any real per-job ceiling — proves the clamp applies
    // even at the extreme low end, not just "somewhat reduced."
    await drainProofRenderJobs({ workerId: 'drain-tiny-budget-test', requestDeadlineMs: 5, totalDeadlineMs: 600_000 });
    assert.equal(capturedDeadlines.length, 1);
    assert.ok(capturedDeadlines[0] > 0, 'the iteration must still be attempted with whatever tiny positive budget remains');
    assert.ok(capturedDeadlines[0] <= 5, `must never exceed the ~5ms actually left, got ${capturedDeadlines[0]}`);
  } finally {
    workerInternals.runOneProofRenderJob = original;
  }
});

test('drainProofRenderJobs stops immediately with stopReason:"shutting-down" when isShuttingDown() is already true, claiming nothing at all', async () => {
  await enqueue({ mat: { baseColor: '#888888' } });
  const result = await drainProofRenderJobs({ workerId: 'drain-shutdown-test', isShuttingDown: () => true });
  assert.equal(result.stopReason, 'shutting-down');
  assert.equal(result.jobs.length, 0);
  assert.equal(result.iterations, 0);
});

test('drainProofRenderJobs stops mid-drain when isShuttingDown() flips true after the first job, without aborting that already-in-flight job', async () => {
  const jobA = await enqueue({ mat: { baseColor: '#999999' } });
  const jobB = await enqueue({ mat: { baseColor: '#aaaaaa' } });
  let calls = 0;
  const result = await drainProofRenderJobs({
    workerId: 'drain-shutdown-mid-test',
    // false for the pre-iteration-1 check, true for every check after —
    // simulates SIGTERM arriving WHILE job A is still rendering.
    isShuttingDown: () => { calls += 1; return calls > 1; },
  });
  assert.equal(result.stopReason, 'shutting-down');
  assert.equal(result.jobs.length, 1);
  // Same-millisecond createdAt → random-ID tiebreak: either job may be the
  // one claimed first. Invariant: exactly one of the two finished, the
  // other was left queued and unclaimed.
  const doneId = result.jobs[0].jobId;
  assert.ok([jobA.jobId, jobB.jobId].includes(doneId), 'the finished job must be one of the two enqueued jobs');
  assert.equal(result.jobs[0].status, 'done', 'the job already in flight when shutdown was signaled must still be allowed to finish, not be aborted');

  const otherId = doneId === jobA.jobId ? jobB.jobId : jobA.jobId;
  const stored = await jobs.getProofRenderJob(otherId, { clientId: CLIENT_A });
  assert.equal(stored.status, 'queued');
});

test('drainProofRenderJobs reports stopReason:"error" (and preserves already-completed jobs) when an infrastructure-level exception interrupts claiming — never a job-specific failure', async () => {
  const jobA = await enqueue({ mat: { baseColor: '#bbbbbb' } });
  const jobB = await enqueue({ mat: { baseColor: '#cccccc' } });

  const originalClaim = jobs.claimNextProofRenderJob;
  let calls = 0;
  jobs.claimNextProofRenderJob = async (...args) => {
    calls += 1;
    if (calls === 2) throw new Error('simulated Firestore outage');
    return originalClaim(...args);
  };
  try {
    const result = await drainProofRenderJobs({ workerId: 'drain-error-test' });
    assert.equal(result.stopReason, 'error');
    assert.match(result.error, /simulated Firestore outage/);
    assert.equal(result.jobs.length, 1, 'the job that already completed before the outage must still be reported, not discarded');
    // Same-millisecond createdAt → random-ID tiebreak: either job may have
    // been claimed first; the invariant is only that ONE enqueued job
    // completed before the outage and is preserved in the report.
    assert.ok([jobA.jobId, jobB.jobId].includes(result.jobs[0].jobId), 'the preserved job must be one of the two enqueued jobs');
    assert.equal(result.jobs[0].status, 'done');
  } finally {
    jobs.claimNextProofRenderJob = originalClaim;
  }
});

// ── 'delayed' vs 'empty' (post-P1 external-review correction): a backoff-
// requeued job must never make the drain report the queue EMPTY — that
// turned a transient failure's own 30–900s retry window into a /run 200 a
// durable dispatcher acks, leaving the job stranded until unrelated
// traffic. REQUIRED regression: a render fails, is requeued with future
// backoff, and the SAME drain call reports 'delayed' + retryAt. ───────────

test('REGRESSION: a transient failure requeued with future backoff must stop the SAME drain with stopReason:"delayed" (+retryAt) — never "empty"', async () => {
  const job = await enqueue({ mat: { baseColor: '#112233' } });
  const originalUpload = artifacts.uploadProofArtifacts;
  artifacts.uploadProofArtifacts = async () => { throw new Error('simulated transient Storage outage'); };
  try {
    const result = await drainProofRenderJobs({ workerId: 'drain-delayed-regression' });

    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].jobId, job.jobId);
    assert.equal(result.jobs[0].status, 'queued', 'the transient failure must have been requeued for retry');
    assert.equal(result.counts.queued, 1);

    assert.notEqual(result.stopReason, 'empty', 'a queue holding a backoff-delayed retry is NOT empty — reporting it empty is the exact defect this regression pins');
    assert.equal(result.stopReason, 'delayed');
    assert.ok(result.retryAt, 'delayed must carry the earliest claimable moment');

    const stored = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
    assert.equal(stored.status, 'queued');
    assert.ok(stored.nextAttemptAt, 'requeue must have scheduled a future attempt');
    assert.equal(result.retryAt, stored.nextAttemptAt, "retryAt must be the requeued job's own nextAttemptAt");
    assert.ok(Date.parse(result.retryAt) > Date.now(), 'the retry moment must genuinely be in the future');
  } finally {
    artifacts.uploadProofArtifacts = originalUpload;
  }
});

test('runOneProofRenderJob distinguishes delayed from empty: {claimed:false, busy:false, delayed:true, retryAt} for a backoff-delayed job, plain {claimed:false, busy:false} only when the queue is truly empty', async () => {
  const job = await enqueue({ mat: { baseColor: '#445566' } });
  const future = new Date(Date.now() + 90_000).toISOString();
  fakeCtx.adminDb._patch(jobs.COLLECTION, job.jobId, { nextAttemptAt: future, nextAttemptAtTs: null });

  const delayed = await runOneProofRenderJob({ workerId: 'delayed-shape-test' });
  assert.equal(delayed.claimed, false);
  assert.equal(delayed.busy, false);
  assert.equal(delayed.delayed, true);
  assert.equal(delayed.retryAt, future);

  // Terminal-fail the job → the queue is now GENUINELY empty → no delayed flag.
  fakeCtx.adminDb._patch(jobs.COLLECTION, job.jobId, { status: 'failed' });
  const empty = await runOneProofRenderJob({ workerId: 'delayed-shape-test' });
  assert.equal(empty.claimed, false);
  assert.equal(empty.busy, false);
  assert.equal(empty.delayed, undefined, 'a genuinely empty queue must never carry a delayed flag');
  assert.equal(empty.retryAt, undefined);
});
