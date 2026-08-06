// proof-server.test.mjs — Phase 3 (STUDIO-DETERMINISTIC-FINAL-RENDER-SONNET-
// HANDOFF.md), extended by the P1 follow-up "worker drain" checkpoint. Real
// HTTP requests (global fetch) against the module's own `server`, listening
// on an OS-assigned ephemeral port — no live Cloud Run, no Docker.
// Firestore/Storage are the same in-memory fakes every other worker-layer
// test in this repo already uses; `drainProofRenderJobs` (and therefore a
// real Playwright/ffmpeg render, per job) genuinely executes for the
// multi-job drain tests, same as proof-render-worker.test.mjs.

import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { normalizeArtSceneRecipe } from '../art-recipe.mjs';
import { checkCapabilities } from '../art-render-validation.mjs';
import { server, _internals } from '../proof-server.mjs';

const require = createRequire(import.meta.url);
// Vendored — must be the SAME module instance proof-render-worker.mjs itself requires.
const jobs = require('../vendor/api-lib/proof-render-jobs.cjs');
const artifacts = require('../vendor/api-lib/proof-render-artifacts.cjs');
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');

const CLIENT_A = 'client-a';
const OWNER_A = 'user-a1';
const SMALL_PARAMS = { width: 160, height: 160, fps: 8, durationSeconds: 0.2, warmupFrames: 2 };
const SECRET = 'test-proof-render-secret';

let baseUrl;
let fakeCtx;
let originalSecretEnv;

before(async () => {
  await new Promise((resolve) => { server.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => { server.close(resolve); });
});

beforeEach(() => {
  fakeCtx = makeFakeContext();
  jobs.__setTestContext(fakeCtx);
  artifacts.__setTestContext(fakeCtx);
  originalSecretEnv = process.env.PROOF_RENDER_SHARED_SECRET;
  process.env.PROOF_RENDER_SHARED_SECRET = SECRET;
  _internals.setShuttingDownForTest(false);
});
afterEach(() => {
  jobs.__setTestContext(null);
  artifacts.__setTestContext(null);
  process.env.PROOF_RENDER_SHARED_SECRET = originalSecretEnv;
  _internals.setShuttingDownForTest(false);
});

function supportedRecipe(scene = {}) {
  return normalizeArtSceneRecipe({ kind: 'art-scene-v2', schemaVersion: 1, scene: { envIntensity: 0, ...scene } }).recipe;
}

async function enqueue(scene = {}) {
  const recipe = supportedRecipe(scene);
  const capabilities = checkCapabilities(recipe);
  assert.equal(capabilities.supported, true);
  return jobs.createProofRenderJob({
    clientId: CLIENT_A, ownerUid: OWNER_A, recipe, warnings: [], capabilities, renderParams: SMALL_PARAMS,
  });
}

async function postRun(secretHeader) {
  const headers = secretHeader === undefined ? {} : { 'x-proof-render-secret': secretHeader };
  const res = await fetch(`${baseUrl}/run`, { method: 'POST', headers });
  return { status: res.status, body: await res.json() };
}

// ── health ────────────────────────────────────────────────────────────────

test('GET /healthz returns 200 with no auth required, even with no secret configured', async () => {
  delete process.env.PROOF_RENDER_SHARED_SECRET;
  const res = await fetch(`${baseUrl}/healthz`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, 'studio-proof-render');
  assert.equal(body.shuttingDown, false);
});

// ── bad/missing secret ───────────────────────────────────────────────────

test('POST /run with no secret header is rejected 401', async () => {
  const { status, body } = await postRun(undefined);
  assert.equal(status, 401);
  assert.equal(body.ok, false);
});

test('POST /run with the wrong secret is rejected 401', async () => {
  const { status } = await postRun('totally-wrong-secret');
  assert.equal(status, 401);
});

test('POST /run is rejected 401 when no secret is configured server-side at all — never "open" by omission', async () => {
  delete process.env.PROOF_RENDER_SHARED_SECRET;
  const { status } = await postRun(SECRET);
  assert.equal(status, 401);
});

test('POST /run with the correct secret is authorized', async () => {
  const { status, body } = await postRun(SECRET);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
});

// ── empty queue / drain-all-in-one-request ────────────────────────────────

test('an empty queue returns claimed:false, truthfully, as a 200 (not an error)', async () => {
  const { status, body } = await postRun(SECRET);
  assert.equal(status, 200);
  assert.deepEqual(body, { ok: true, claimed: false });
});

test('a single /run call drains ALL currently-queued jobs sequentially — not just one — and a follow-up call finds nothing left', async () => {
  const jobA = await enqueue({ mat: { baseColor: '#ff0000' } });
  const jobB = await enqueue({ mat: { baseColor: '#00ff00' } });

  const { status, body } = await postRun(SECRET);
  assert.equal(status, 200);
  assert.equal(body.claimed, true);
  assert.equal(body.stopReason, 'empty', 'the drain must run until the queue is genuinely empty, not stop after one job');
  assert.equal(body.jobs.length, 2);
  const claimedIds = body.jobs.map((j) => j.jobId).sort();
  assert.deepEqual(claimedIds, [jobA.jobId, jobB.jobId].sort());
  assert.ok(body.jobs.every((j) => j.status === 'done'));
  assert.deepEqual(body.counts, { done: 2, queued: 0, failed: 0, lostClaim: 0 });
  // Backward-compat top-level fields mirror the LAST processed job.
  assert.ok([jobA.jobId, jobB.jobId].includes(body.jobId));
  assert.equal(body.status, 'done');

  const followUp = await postRun(SECRET);
  assert.deepEqual(followUp.body, { ok: true, claimed: false });
});

// ── dispatch retry safety: two concurrent /run calls never both drain (a
// durable dispatcher retrying a slow/uncertain delivery must never cause
// two renders of the same job, or two workers draining at once) ───────────

test('two concurrent /run calls against a single queued job resolve to exactly one winner — the other is rejected 409, not a silent empty 200', async () => {
  const job = await enqueue({ mat: { baseColor: '#123456' } });
  const [a, b] = await Promise.all([
    fetch(`${baseUrl}/run`, { method: 'POST', headers: { 'x-proof-render-secret': SECRET } }),
    fetch(`${baseUrl}/run`, { method: 'POST', headers: { 'x-proof-render-secret': SECRET } }),
  ]);
  const [aBody, bBody] = await Promise.all([a.json(), b.json()]);
  const responses = [{ res: a, body: aBody }, { res: b, body: bBody }];
  const winners = responses.filter((r) => r.res.status === 200 && r.body.claimed);
  const rejected = responses.filter((r) => r.res.status === 409);
  assert.equal(winners.length, 1, 'exactly one of the two concurrent calls must have claimed/drained');
  assert.equal(rejected.length, 1, 'the other must be rejected 409 (in-process drain guard), never a silent empty 200');
  assert.equal(winners[0].body.jobId, job.jobId);
  assert.equal(rejected[0].body.busy, true);
});

// ── THE CRITICAL TEST (P1 follow-up checkpoint): two jobs enqueued, two
// /run requests fired concurrently — exactly one gets 409, the winner
// drains and completes BOTH jobs. Proves the original stranding bug (a job
// enqueued while the worker is busy sitting stranded until a human
// intervenes) is actually dead: the SAME single winning request that a
// naive one-job-per-request design would have left job B stranded on now
// finishes it before responding at all. ────────────────────────────────────

test('CRITICAL: two /run requests fired concurrently against two queued jobs — exactly one gets 409, the other drains and completes BOTH jobs', async () => {
  const jobA = await enqueue({ mat: { baseColor: '#111111' } });
  const jobB = await enqueue({ mat: { baseColor: '#222222' } });

  const [a, b] = await Promise.all([
    fetch(`${baseUrl}/run`, { method: 'POST', headers: { 'x-proof-render-secret': SECRET } }),
    fetch(`${baseUrl}/run`, { method: 'POST', headers: { 'x-proof-render-secret': SECRET } }),
  ]);
  const [aBody, bBody] = await Promise.all([a.json(), b.json()]);
  const responses = [{ res: a, body: aBody }, { res: b, body: bBody }];

  const busyOnes = responses.filter((r) => r.res.status === 409);
  const winners = responses.filter((r) => r.res.status === 200);
  assert.equal(busyOnes.length, 1, 'exactly one concurrent /run must be rejected as busy');
  assert.equal(winners.length, 1, 'exactly one concurrent /run must win and drain');

  assert.equal(busyOnes[0].body.ok, false);
  assert.equal(busyOnes[0].body.claimed, false);
  assert.equal(busyOnes[0].body.busy, true);
  assert.ok(busyOnes[0].res.headers.get('retry-after'), 'the rejected call must carry a Retry-After hint');

  assert.equal(winners[0].body.claimed, true);
  assert.equal(winners[0].body.stopReason, 'empty');
  assert.equal(winners[0].body.jobs.length, 2, 'the winning drain must complete BOTH queued jobs in this ONE request, not just one');
  const claimedIds = winners[0].body.jobs.map((j) => j.jobId).sort();
  assert.deepEqual(claimedIds, [jobA.jobId, jobB.jobId].sort());
  assert.ok(winners[0].body.jobs.every((j) => j.status === 'done'), 'both jobs must reach done, not just be claimed');
  assert.deepEqual(winners[0].body.counts, { done: 2, queued: 0, failed: 0, lostClaim: 0 });

  // Durable proof, independent of the HTTP response: both jobs are
  // genuinely 'done' in the job store, not just claimed-and-abandoned.
  const storedA = await jobs.getProofRenderJob(jobA.jobId, { clientId: CLIENT_A });
  const storedB = await jobs.getProofRenderJob(jobB.jobId, { clientId: CLIENT_A });
  assert.equal(storedA.status, 'done');
  assert.equal(storedB.status, 'done');
});

// ── busy: retryable, distinct from empty (P1-B, Production lifecycle
// hardening round) — a second /run while the worker is already claimed must
// NOT look like a delivered/no-op 200 to a durable dispatcher, or a still-
// queued job gets stranded until a human manually POSTs /run again. This
// specific test forces a CROSS-PROCESS busy state (claims directly via
// jobs.claimNextProofRenderJob, bypassing this server's own handleRun
// entirely) — the Firestore-lock-based check inside drainProofRenderJobs'
// first iteration, distinct from the in-process `draining` guard the
// CRITICAL two-job test above exercises (that guard only ever fires for a
// second /run to THIS SAME running process). ──────────────────────────────

test('a second /run while the worker is already claimed/rendering (by a genuinely separate process) gets a retryable 409 with Retry-After, not a 200 a dispatcher would ack and drop', async () => {
  await enqueue({ mat: { baseColor: '#ff0000' } });
  await enqueue({ mat: { baseColor: '#00ff00' } }); // the job that would otherwise be stranded
  const held = await jobs.claimNextProofRenderJob({ workerId: 'other-worker' });
  assert.ok(held, 'test setup: the first claim must succeed');

  const res = await fetch(`${baseUrl}/run`, { method: 'POST', headers: { 'x-proof-render-secret': SECRET } });
  assert.equal(res.status, 409);
  assert.ok(res.headers.get('retry-after'), 'a busy response must tell the dispatcher when to retry');
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.claimed, false);
  assert.equal(body.busy, true);
  // The cross-process busy state now surfaces through drainProofRenderJobs'
  // stopReason:'busy' and the unified retryable-409 message — assert both
  // the machine-readable reason and that the message still tells the
  // dispatcher this is a retry, not a delivered no-op.
  assert.equal(body.stopReason, 'busy');
  assert.match(body.error, /stopped early \(busy\)/i);
  assert.match(body.error, /retry/i);
});

test('a genuinely empty queue stays a plain 200 — never the busy 409, so a dispatcher does not retry forever with nothing to do', async () => {
  const { status, body } = await postRun(SECRET);
  assert.equal(status, 200);
  assert.deepEqual(body, { ok: true, claimed: false });
});

// ── P1 correction (post-Environment/IBL-parity external review): "treat
// every non-empty bounded exit that may leave work queued as requiring
// another wake-up. Under durable dispatch, return a retryable non-2xx even
// if earlier jobs completed." Before this fix, handleRun returned a plain
// 200 for ANY stopReason as long as jobs.length >= 1, silently stranding
// whatever the drain didn't get to. Mocked (via proof-render-worker.mjs's
// own _internals.runOneProofRenderJob DI seam) so this can force
// 'max-iterations' with real progress already made, deterministically and
// fast — no need to enqueue+render the real 25-job queue depth that would
// take to hit the cap for real. ───────────────────────────────────────────

test('max-iterations with a remainder produces a retryable 409, not a 200 a dispatcher would ack and drop', async () => {
  const workerModule = await import('../proof-render-worker.mjs');
  const original = workerModule._internals.runOneProofRenderJob;
  let calls = 0;
  workerModule._internals.runOneProofRenderJob = async () => {
    calls += 1;
    return { claimed: true, jobId: `fake-${calls}`, status: 'done' };
  };
  try {
    const res = await fetch(`${baseUrl}/run`, { method: 'POST', headers: { 'x-proof-render-secret': SECRET } });
    const body = await res.json();
    assert.equal(res.status, 409, 'real progress (25 completed jobs) must NOT be reported as a plain success — the drain stopped without confirming the queue is empty');
    assert.ok(res.headers.get('retry-after'), 'a retryable response must tell the dispatcher when to retry');
    assert.equal(body.stopReason, 'max-iterations');
    assert.equal(body.jobs.length, 25, 'the default iteration cap (DEFAULT_DRAIN_MAX_ITERATIONS)');
    assert.equal(body.ok, true, 'real durable work DID happen this call — `ok` distinguishes that from the zero-progress busy/error cases; the HTTP status code, not `ok`, is what actually signals "retry me"');
    assert.equal(body.claimed, true);
  } finally {
    workerModule._internals.runOneProofRenderJob = original;
  }
});

// ── truthful HTTP results for every worker outcome ───────────────────────

test('a render failure is requeued and the SAME drain reports it truthfully as a retryable 409 delayed — the failure detail stays in the body, never an opaque 500', async () => {
  // Contract update (post-P1 external-review correction): this used to
  // expect a plain 200 with status:'queued' — but the requeue schedules a
  // future-backoff attempt, so acking 200 let a durable dispatcher drop the
  // retry entirely (the exact stranding defect the 'delayed' stop reason
  // closes). The job-level truth (claimed, requeued, error detail) still
  // surfaces in the body; only the HTTP verdict changed from "delivered" to
  // "retry at retryAt".
  const job = await enqueue({ mat: { baseColor: '#abcdef' } });
  const workerModule = await import('../proof-render-worker.mjs');
  const original = workerModule._internals.mkdtemp;
  workerModule._internals.mkdtemp = async () => { throw new Error('simulated ENOSPC'); };
  try {
    const { status, body } = await postRun(SECRET);
    assert.equal(status, 409, 'a requeued failure leaves backoff-delayed work pending — the dispatcher must be told to retry, not acked');
    assert.equal(body.stopReason, 'delayed');
    assert.equal(body.delayed, true);
    assert.ok(body.retryAt, 'delayed must carry the earliest claimable moment');
    assert.equal(body.jobs.length, 1);
    assert.equal(body.jobs[0].jobId, job.jobId);
    assert.equal(body.jobs[0].status, 'queued');
    assert.match(body.jobs[0].error, /simulated ENOSPC/, 'the job-level failure detail must stay visible in the drain report');
  } finally {
    workerModule._internals.mkdtemp = original;
  }
});

// ── shutdown/drain ────────────────────────────────────────────────────────

test('while shutting down, /run is rejected 503 and never attempts a claim — healthz still reports the truth', async () => {
  await enqueue({ mat: { baseColor: '#ff8800' } });
  _internals.setShuttingDownForTest(true);
  try {
    const { status, body } = await postRun(SECRET);
    assert.equal(status, 503);
    assert.equal(body.ok, false);

    const health = await (await fetch(`${baseUrl}/healthz`)).json();
    assert.equal(health.shuttingDown, true);

    // Prove no claim was attempted: the job is still queued afterward.
    const stillQueued = await jobs.listProofRenderJobs(CLIENT_A, 5);
    assert.ok(stillQueued.some((j) => j.status === 'queued'));
  } finally {
    _internals.setShuttingDownForTest(false);
  }
});

// ── unknown route ─────────────────────────────────────────────────────────

test('an unknown route returns 404', async () => {
  const res = await fetch(`${baseUrl}/nope`);
  assert.equal(res.status, 404);
});

// ── 'delayed' (post-P1 external-review correction): pending backoff work
// must produce a retryable non-2xx from /run, never the 200-empty a durable
// dispatcher would ack and drop — the queue is only "empty" when NO
// queued/rendering work exists at all. ─────────────────────────────────────

test('a backoff-delayed queued job makes /run answer a retryable 409 {delayed:true, retryAt} with Retry-After derived from the backoff — never a 200 "empty"', async () => {
  const job = await enqueue({ mat: { baseColor: '#0000ff' } });
  const future = new Date(Date.now() + 90_000).toISOString();
  fakeCtx.adminDb._patch(jobs.COLLECTION, job.jobId, { nextAttemptAt: future, nextAttemptAtTs: null });

  const { status, body } = await postRun(SECRET);
  assert.equal(status, 409, 'delayed pending work must be a retryable non-2xx, not a deliverable 200');
  assert.equal(body.ok, false);
  assert.equal(body.claimed, false);
  assert.equal(body.busy, false);
  assert.equal(body.delayed, true);
  assert.equal(body.stopReason, 'delayed');
  assert.equal(body.retryAt, future);

  const res = await fetch(`${baseUrl}/run`, { method: 'POST', headers: { 'x-proof-render-secret': SECRET } });
  assert.equal(res.status, 409);
  const retryAfter = Number(res.headers.get('retry-after'));
  assert.ok(Number.isFinite(retryAfter) && retryAfter >= 1 && retryAfter <= 90, `Retry-After (${retryAfter}) must be derived from the ~90s backoff window, not the flat immediate-retry hint`);
  assert.ok(retryAfter > 10, 'a 90s backoff must produce a Retry-After beyond the flat 10s used for immediately-retryable stops');
});

test('Retry-After for delayed work is clamped to the 900s top of the backoff ladder even when retryAt is further out', async () => {
  const job = await enqueue({ mat: { baseColor: '#00ffff' } });
  const farFuture = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  fakeCtx.adminDb._patch(jobs.COLLECTION, job.jobId, { nextAttemptAt: farFuture, nextAttemptAtTs: null });

  const res = await fetch(`${baseUrl}/run`, { method: 'POST', headers: { 'x-proof-render-secret': SECRET } });
  assert.equal(res.status, 409);
  assert.equal(Number(res.headers.get('retry-after')), 900);
  const body = await res.json();
  assert.equal(body.delayed, true);
  assert.equal(body.retryAt, farFuture, 'the body still carries the EXACT retryAt for a scheduler that can honor it precisely');
});

test('a drain that processes a job whose transient failure requeues with backoff answers 409 delayed — the completed-work-then-stranded-remainder shape, end to end', async () => {
  await enqueue({ mat: { baseColor: '#123abc' } });
  const originalUpload = artifacts.uploadProofArtifacts;
  artifacts.uploadProofArtifacts = async () => { throw new Error('simulated transient Storage outage'); };
  try {
    const { status, body } = await postRun(SECRET);
    assert.equal(status, 409, 'the SAME drain that requeued the failure must signal retry, never ack the queue as empty');
    assert.equal(body.stopReason, 'delayed');
    assert.equal(body.delayed, true);
    assert.ok(body.retryAt, 'delayed must carry retryAt');
    assert.equal(body.jobs.length, 1);
    assert.equal(body.jobs[0].status, 'queued');
    assert.equal(body.counts.queued, 1);
  } finally {
    artifacts.uploadProofArtifacts = originalUpload;
  }
});
