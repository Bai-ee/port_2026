// proof-render-worker.mjs — Slice 4d (Studio Roadmap), extended Phase 1
// (STUDIO-DETERMINISTIC-FINAL-RENDER-SONNET-HANDOFF.md). Claims ONE Proof
// render job from the queue (api/_lib/proof-render-jobs.cjs) and drives it
// through services/studio-render/art-render.mjs's local, deterministic
// render pipeline (Playwright + ffmpeg + ffprobe — same one Slice 4c built
// and verified), then uploads the resulting MP4/poster to durable Cloud
// Storage (api/_lib/proof-render-artifacts.cjs) before completing the job.
// Never persists a local filesystem path onto the job record — only the
// sanitized ffprobe metadata (art-render.mjs's own `validateWithFfprobe`
// output) and the artifact's Cloud Storage object paths.
//
// Every mutation (complete/fail/requeue/lease-renewal) is claim-token
// fenced (Codex re-review, P1): this worker passes the exact `claimToken`
// it received from `claimNextProofRenderJob` into every subsequent call, so
// if its lease is ever reclaimed by another worker (it stalled long enough
// to look abandoned, then woke back up), every one of its own completion/
// failure/requeue attempts is rejected rather than corrupting the newer
// claim's state. A heartbeat renews the lease periodically so a genuinely
// still-working render — which can run longer than a single
// LEASE_TIMEOUT_MS window — is never mistaken for an orphan in the first
// place; the heartbeat only buys time, it never bypasses fencing.
//
// ── Failure-safe setup lifecycle (Codex re-review round 3, P1) ─────────────
// mkdtemp, heartbeat startup, the render itself, and completion are ALL
// inside ONE guarded try/catch/finally: if mkdtemp (or any other setup
// step) throws AFTER the job was claimed, the same fenced requeue/failure
// path below still runs — the job is never silently left claimed with
// nothing tracking it. The temp directory is created BEFORE the heartbeat
// starts (so a mkdtemp failure never leaves a dangling, unclearable
// interval behind — there's nothing to clear yet). The heartbeat is always
// cleared in `finally`, whether the try block succeeded, threw, or never
// got as far as starting it. A cleanup (rm) failure is caught and logged
// separately INSIDE `finally` — it must never override an already-computed,
// already-durable `done`/`failed`/`queued` return value (a bare throwing
// `finally` block would otherwise clobber the try block's own return).
//
// NOT wired to any cron/HTTP trigger, Cloud Run deployment, or GPU worker in
// this slice — `runOneProofRenderJob` is a directly-callable, directly-
// testable function. A future slice (not this one) decides how/where it
// actually gets invoked in production (a real Cloud Run worker, most
// likely, given the render pipeline's own Playwright/ffmpeg dependency
// can't run in a Vercel serverless function).
//
// Never touches recipe.mjs/scene.mjs/render.mjs/server.mjs (the live Video
// Promo pipeline/queue) or app/api/dashboard/proof-render/route.js's own
// client-facing create/read/list surface.

import { createRequire } from 'node:module';
import { mkdtemp as mkdtempFs, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderArtScene, ArtRenderError } from './art-render.mjs';

const require = createRequire(import.meta.url);
// Vendored (Phase 3, scripts/vendor-api-lib.mjs), NOT the real api/_lib/ —
// `--source .` builds this service from ONLY this directory (see that
// script's own header comment), so a relative path reaching outside
// services/studio-render/ can never resolve inside the deployed image. Any
// test injecting a fake Firestore/Storage context MUST require these SAME
// vendored paths — see __tests__/proof-render-worker.test.mjs's own require.
const jobs = require('./vendor/api-lib/proof-render-jobs.cjs');
const artifacts = require('./vendor/api-lib/proof-render-artifacts.cjs');
const stills = require('./vendor/api-lib/studio-screen-stills.cjs');

// Real renders can run long; a heartbeat well inside the 330s lease window
// (every 2 minutes) keeps a genuinely-active claim from ever looking
// orphaned. Overridable per-call so tests can use a much shorter interval
// against their own short-lived renders.
const DEFAULT_HEARTBEAT_INTERVAL_MS = 120_000;

// ── Total render/job deadline (Phase 1, STUDIO-DETERMINISTIC-FINAL-RENDER-
// SONNET-HANDOFF.md) ────────────────────────────────────────────────────
// Server-owned, never caller-controlled — sourced from proof-render-jobs.cjs's
// own TOTAL_RENDER_DEADLINE_MS (one constant, never a second silently
// divergent number). One AbortController is created per claimed job,
// started the moment the claim is won, and bounds the ENTIRE render +
// artifact-upload lifecycle:
//   - render (Chromium launch/navigate/warm-up/frame-capture/ffmpeg/ffprobe):
//     genuinely cooperative — renderArtScene's own `signal` plumbing force-
//     closes the browser and reuses the ffmpeg/ffprobe SIGTERM/SIGKILL
//     escalation (art-render.mjs), so an abort actually STOPS in-flight work.
//   - artifact upload: the Storage SDK (@google-cloud/storage 7.x) has no
//     AbortSignal hook on file().save(), so this phase cannot force-cancel
//     an in-flight PUT the same way. What IS enforced: the worker never
//     blocks past the deadline waiting on it (raceUploadAgainstDeadline
//     below rejects the moment the signal fires, even if the underlying
//     HTTP call is still running in the background) — matching the
//     handoff's requirement to bound the worker's own lifecycle, not a
//     literal socket-level abort this dependency doesn't expose.
const DEFAULT_TOTAL_DEADLINE_MS = jobs.TOTAL_RENDER_DEADLINE_MS;

/**
 * Rejects with a typed ArtRenderError the moment `signal` aborts, even if
 * `promise` is still pending — never resolves/rejects with `promise`'s own
 * result once aborted. `promise` itself is NOT cancelled (can't be — see
 * this file's own deadline comment above); if it later succeeds in the
 * background after this has already rejected, the resulting Storage objects
 * are real but never referenced by any job (their claim already moved on to
 * requeue/fail) — a genuine orphan this function cannot itself clean up
 * (there is no `artifact` object here to hand to deleteProofArtifacts).
 * Scoped-per-claim (artifactStoragePath) so this is harmless, not a
 * collision risk, and is exactly what Phase 2's retention sweep exists to
 * eventually reclaim.
 */
function raceUploadAgainstDeadline(promise, signal, phaseMessage) {
  if (signal.aborted) {
    return Promise.reject(new ArtRenderError(`Render aborted: the total render/job deadline was exceeded ${phaseMessage}.`, { aborted: true }));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new ArtRenderError(`Render aborted: the total render/job deadline was exceeded ${phaseMessage}.`, { aborted: true }));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (err) => { signal.removeEventListener('abort', onAbort); reject(err); },
    );
  });
}

// DI seam (Codex re-review round 3, P1) — lets a test simulate mkdtemp
// failing (e.g. a full disk) without needing an actually-full disk. Real
// production code always goes through the real node:fs/promises mkdtemp;
// only a test replaces `_internals.mkdtemp`.
//
// `runOneProofRenderJob` is added to this SAME seam (P1 correction, post-
// Environment/IBL-parity external review — new, not pre-existing) so
// drainProofRenderJobs' OWN per-iteration deadline-clamping logic can be
// tested precisely and fast, without a real Chromium render per iteration:
// ES module exports are read-only live bindings to external importers (you
// cannot do `import * as m from './x.mjs'; m.someExportedFn = fake` the way
// this codebase's CJS modules allow reassigning `module.exports` properties
// directly), so drainProofRenderJobs calls `_internals.runOneProofRenderJob`
// — a plain mutable object property — instead of the bare function name,
// exactly mirroring the `_internals.mkdtemp` pattern already established
// here. Real production code always goes through the real function below;
// only a test ever replaces `_internals.runOneProofRenderJob`.
export const _internals = {
  mkdtemp: (...args) => mkdtempFs(...args),
  runOneProofRenderJob: (...args) => runOneProofRenderJob(...args),
};

/**
 * Claims the oldest runnable job (if any) and renders it to completion or
 * failure/requeue. Returns `{ claimed: false, busy }` when the queue has
 * nothing runnable right now — `busy: true` when the singleton lease is
 * currently held by an active worker (P1-B, Production lifecycle hardening
 * round: this call genuinely couldn't claim anything, but a durable task
 * dispatcher must retry rather than treat this like a truly empty queue —
 * see proof-server.mjs's own handleRun). When the lease is open but pending
 * work exists that just isn't claimable YET (a backoff-requeued job whose
 * nextAttemptAt is still in the future, or a rendering job under another
 * worker's active lease), returns `{ claimed: false, busy: false,
 * delayed: true, retryAt }` — the post-P1 external-review correction: this
 * state used to be indistinguishable from a genuinely empty queue, so a
 * transiently-failed job's own backoff window turned into "empty" → /run
 * 200 → dispatcher ack → no future wake-up, defeating the retry state
 * machine. Plain `{ claimed: false, busy: false }` now means the queue is
 * GENUINELY empty. Otherwise returns `{ claimed: true, jobId, status, ... }`.
 * `status` is `'done'`, `'queued'` (requeued for retry), `'failed'`
 * (terminal), or `'lost-claim'` (this invocation's own claim was fenced out
 * from under it before it could even record the outcome — nothing more this
 * call can legitimately do to the job).
 *
 * A job only ever reaches `'done'` with a durable Cloud Storage artifact
 * already uploaded (Phase 1) — `completeProofRenderJob` is never called
 * without one. Upload failure flows through the SAME fenced requeue/backoff
 * path a render failure already does (no special-casing needed: it's just
 * another exception raised inside the same try block).
 */
export async function runOneProofRenderJob({
  workerId, heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS, totalDeadlineMs = DEFAULT_TOTAL_DEADLINE_MS,
} = {}) {
  const job = await jobs.claimNextProofRenderJob({ workerId });
  if (!job) {
    // A second, cheap read — never inside claimNextProofRenderJob's own
    // transaction — distinguishes "nothing was ever runnable" from "a
    // worker is actively holding the lease right now" (including the race
    // where a runnable job existed but a concurrent caller won it between
    // this call's own read and its claim attempt: by the time we get here,
    // the winner's lease is already committed).
    const busy = await jobs.isProofRenderQueueLeaseActive();
    if (busy) return { claimed: false, busy };
    // Lease is open yet nothing was claimable — either genuinely empty, or
    // pending work exists whose time just hasn't come (backoff-delayed
    // requeue, another worker's still-active per-job lease). Tell those
    // apart so the caller can schedule/accept a retry instead of acking an
    // "empty" that strands the delayed job (external-review P1 correction).
    const delay = await jobs.peekProofRenderQueueDelay();
    if (delay) return { claimed: false, busy: false, delayed: true, retryAt: delay.retryAt };
    return { claimed: false, busy: false };
  }
  const claimToken = job.workerLease.claimToken;

  // Started the instant the claim is won, so it bounds mkdtemp/render/
  // upload as one whole lifecycle — never re-armed per phase.
  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(() => deadlineController.abort(), totalDeadlineMs);

  let heartbeat = null;
  let outDir = null;
  try {
    // Temp dir created BEFORE the heartbeat starts. If THIS throws, nothing
    // has been started yet — the outer catch below still runs the fenced
    // requeue/failure path, and `finally` has nothing to clear/clean up.
    outDir = await _internals.mkdtemp(path.join(os.tmpdir(), 'proof-render-worker-'));

    if (heartbeatIntervalMs > 0) {
      heartbeat = setInterval(() => {
        jobs.renewProofRenderLease(job.jobId, claimToken).catch((err) => {
          console.warn(`[proof-render-worker] lease renewal failed for ${job.jobId}: ${err?.message}`);
        });
      }, heartbeatIntervalMs);
    }

    // Pinned device-screen still (Slice F2) — downloaded from the client's
    // own content-addressed Storage object into THIS job's scratch dir
    // BEFORE the render starts (the page loads it as a local file with
    // zero network; downloadDeviceScreenStill re-verifies the content
    // hash). A missing/corrupted object throws HERE and flows through the
    // existing fenced requeue/failure path — a pinned screen is never
    // silently rendered blank.
    let deviceScreenStillPath;
    const pinnedStill = job.recipe?.devicePrimary?.screenStill;
    if (pinnedStill) {
      deviceScreenStillPath = path.join(outDir, `pinned-screen-still.${pinnedStill.ext}`);
      await stills.downloadDeviceScreenStill({ clientId: job.clientId, still: pinnedStill, destPath: deviceScreenStillPath });
    }

    const { width, height, fps, durationSeconds, warmupFrames } = job.renderParams;
    const result = await renderArtScene({
      recipe: job.recipe, width, height, fps, durationSeconds, warmupFrames, outDir,
      deviceScreenStillPath,
      // Timeline (Phase C) — the already-reduced/validated {totalSeconds,
      // keyframes:[{t, scroll:{scrollPosition, posY}}]} shape the route
      // persisted on the job (proof-render-jobs.cjs's own createProofRenderJob
      // doc comment); `null` for every job created before this phase or
      // without an active timeline.
      timeline: job.timeline || null,
      signal: deadlineController.signal,
      // allowUnsupportedFeatures is NEVER passed — createProofRenderJob
      // already refuses to persist a job for an unsupported recipe, and no
      // production code path here ever needs the local-testing-only escape
      // hatch.
    });

    // Live device-screen capture metadata ("Live URL wired to Final Render"
    // wiring round, requirement 5) — renderArtScene returns `liveCapture`
    // (url/frameCount/readiness/scrollInfo/gpu — see art-render.mjs's own
    // comment) whenever the recipe's device screen sourced a real live URL.
    // It used to be computed and then discarded here — never reaching
    // completeProofRenderJob — so a software-rendering fallback (or any
    // other live-capture diagnostic, e.g. the GPU probe's own renderer
    // string) had nowhere durable to surface; a caller could only infer it
    // from how long the job took. Merged onto the sanitized ffprobe
    // metadata ONLY when present — a non-live recipe's persisted output
    // stays byte-identical to before this change (see this file's own test
    // asserting `stored.output` deep-equals the ffprobe metadata exactly).
    const completionOutput = result.liveCapture
      ? { ...result.metadata, liveCapture: result.liveCapture }
      : result.metadata;

    // Artifact upload (Phase 1) — a job must never say 'done' without a
    // durable MP4/poster already in Cloud Storage. Deadline-bounded (see
    // raceUploadAgainstDeadline's own comment for why this is "the worker
    // stops waiting," not a literal in-flight abort — the Storage SDK gives
    // us no lower-level hook for the latter). claimToken-scoped path (see
    // artifactStoragePath's own comment) so a losing claim's upload can
    // never physically overwrite a winning claim's artifact.
    const artifact = await raceUploadAgainstDeadline(
      artifacts.uploadProofArtifacts({
        clientId: job.clientId, jobId: job.jobId, claimToken, mp4Path: result.mp4Path, posterPath: result.posterPath,
      }),
      deadlineController.signal,
      'during artifact upload',
    );

    try {
      // Not wrapped in the OUTER catch — if this throws (a genuine
      // persistence failure, or this claim having been fenced out by a
      // newer worker), the artifact we just uploaded to OUR claim-scoped
      // path can never become authoritative. Clean it up here (best-effort,
      // never allowed to mask completeErr) rather than leaving it to the
      // not-yet-built retention sweep — see artifactStoragePath's own
      // comment for the full race this closes.
      await jobs.completeProofRenderJob(job.jobId, claimToken, completionOutput, artifact);
    } catch (completeErr) {
      await artifacts.deleteProofArtifacts(artifact).catch((cleanupErr) => {
        console.warn(`[proof-render-worker] failed to clean up an orphaned (never-authoritative) artifact for ${job.jobId}: ${cleanupErr?.message}`);
      });
      throw completeErr;
    }
    return { claimed: true, jobId: job.jobId, status: 'done', metadata: completionOutput, artifact };
  } catch (err) {
    try {
      const requeueResult = await jobs.requeueProofRenderJob(job.jobId, claimToken, err);
      return {
        claimed: true, jobId: job.jobId,
        status: requeueResult?.exhausted ? 'failed' : 'queued',
        error: err?.message || String(err),
      };
    } catch (fencingErr) {
      // This claim was fenced out (reclaimed by a newer worker) before we
      // could even record our own failure, or the requeue attempt itself
      // hit a genuine persistence error — either way, nothing more this
      // invocation can legitimately do to this job.
      return { claimed: true, jobId: job.jobId, status: 'lost-claim', error: fencingErr?.message || String(fencingErr) };
    }
  } finally {
    clearTimeout(deadlineTimer);
    if (heartbeat) clearInterval(heartbeat);
    if (outDir) {
      try {
        await rm(outDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        // Logged, never allowed to override the try block's own return
        // value — a throwing `finally` would otherwise clobber an
        // already-durable done/failed/queued result.
        console.warn(`[proof-render-worker] failed to clean up scratch dir ${outDir}: ${cleanupErr?.message}`);
      }
    }
  }
}

// ── Drain (P1 follow-up checkpoint, "worker drain closes the dispatch
// race") ────────────────────────────────────────────────────────────────
//
// P1-A's dispatch call is fire-and-forget: it wakes the worker, but does
// not itself guarantee every currently-queued job gets processed — a job
// enqueued WHILE the worker is already busy on a different job used to just
// sit there until the NEXT job's own dispatch (or a manual /run) happened
// to wake the worker again. drainProofRenderJobs closes that gap from the
// worker side: one authenticated /run now claims+processes jobs
// SEQUENTIALLY — done, requeued, failed, or lost-claim — immediately trying
// the NEXT one, until the queue is genuinely empty or one of a small set of
// stop conditions below fires. A single job's own outcome (including
// failure) NEVER aborts the drain; only end-of-queue, contention, shutdown,
// the deadline budget, the iteration cap, or a genuine INFRASTRUCTURE-level
// exception does.
//
// Iteration cap (25) — deliberately modest for an HTTP-request-scoped drain
// — contrast with scripts/drain-proof-queue.mjs's own 200-iteration CLI
// drain, a human-supervised tool with no request/response wall-clock
// constraint. Comfortably covers any realistic queue depth this app
// actually produces while still bounding a pathological "many tiny jobs"
// case from running unbounded inside one HTTP request.
const DEFAULT_DRAIN_MAX_ITERATIONS = 25;

// ── Request-level deadline (P1 correction, post-Environment/IBL-parity
// external review) ─────────────────────────────────────────────────────────
// The PREVIOUS version of this budget (DEFAULT_DRAIN_DEADLINE_MS, 240s) was
// only ever checked BETWEEN iterations and never changed what budget an
// iteration ITSELF received — every claimed job got a full, fresh
// TOTAL_RENDER_DEADLINE_MS (600s), regardless of how much of the outer
// budget was already spent. The review's own example: a job starting at
// t=239s (just under the old 240s check) could still run until t≈839s,
// well past the 660s Cloud Run request timeout this service is deployed
// with (deploy-cloud-run-proof.sh's own TIMEOUT) — the comments even said
// so ("raising [the Cloud Run timeout] ... is a deploy-config decision
// intentionally left to a human") without actually bounding the request
// from THIS side at all. That's fixed now: DEFAULT_REQUEST_DEADLINE_MS is a
// real ceiling on the ENTIRE drain call's wall-clock time, and each
// iteration's own per-job deadline is `min(totalDeadlineMs, remaining
// request budget)` — never a full fresh budget regardless of elapsed time.
// A job that claims with only a few seconds of remaining budget genuinely
// only gets a few seconds before its OWN AbortController fires (see
// runOneProofRenderJob) — it is never silently given more than the request
// itself can still afford.
//
// 630_000ms = 660_000ms (the Cloud Run request timeout this service is
// configured with) minus a 30s margin for the HTTP response write-out +
// network round trip once the drain loop itself decides to stop — the
// request must finish comfortably inside Cloud Run's own limit, not race it.
const DEFAULT_DRAIN_MAX_ITERATIONS_MARGIN_MS = 30_000;
const DEFAULT_REQUEST_DEADLINE_MS = 660_000 - DEFAULT_DRAIN_MAX_ITERATIONS_MARGIN_MS;

/**
 * Sequentially claims+processes jobs via runOneProofRenderJob until a stop
 * condition fires. Returns:
 *   {
 *     stopReason: 'empty' | 'delayed' | 'busy' | 'shutting-down' |
 *                 'deadline' | 'max-iterations' | 'error',
 *     jobs: [{ jobId, status, error? }, ...],   // every job this call itself processed, in order
 *     counts: { done, queued, failed, lostClaim },
 *     iterations,                                // number of claim attempts made (>= jobs.length)
 *     retryAt?,                                   // set only when stopReason === 'delayed'
 *     error?,                                     // set only when stopReason === 'error'
 *   }
 *
 * Stop reasons:
 *   'empty'          — no queued/rendering work exists AT ALL (post-P1
 *                       external-review correction: this no longer fires
 *                       for "nothing runnable right now"). The ONLY stop
 *                       reason that confirms the queue is genuinely empty —
 *                       see proof-server.mjs's own handleRun for why every
 *                       other reason below is treated as retryable
 *                       regardless of `jobs.length`.
 *   'delayed'         — pending work exists but none of it is claimable
 *                        yet (backoff-requeued job with a future
 *                        nextAttemptAt, or a rendering job under another
 *                        worker's still-active lease). `retryAt` carries
 *                        the earliest moment any of it becomes claimable —
 *                        the exact signal a durable dispatcher needs to
 *                        schedule/redeliver at-or-after that time instead
 *                        of acking the queue as empty and stranding the
 *                        retry (the drain itself never busy-waits out a
 *                        backoff window).
 *   'busy'            — the singleton lease is held by someone else right
 *                        now. Should not occur from proof-server.mjs's own
 *                        dispatch, which holds an in-process guard against a
 *                        second concurrent drain on the SAME process (see
 *                        that file's own `draining` flag) — but a genuinely
 *                        separate process (e.g. the manual CLI drain script
 *                        run at the same time) can still produce this.
 *   'shutting-down'   — `isShuttingDown()` returned true before starting the
 *                        next iteration (checked between iterations only —
 *                        a job already in flight is never aborted).
 *   'deadline'        — `requestDeadlineMs` elapsed before starting the next
 *                        iteration. Unlike before this correction, this is
 *                        now a REAL bound on total request time, not just a
 *                        between-iterations check with no effect on
 *                        in-flight budgets — see this section's own header.
 *   'max-iterations'  — the iteration cap was reached; more work may still
 *                        be queued.
 *   'error'           — a genuine INFRASTRUCTURE-level exception (NOT a
 *                        job's own outcome — runOneProofRenderJob already
 *                        converts every job-specific failure into a
 *                        requeued/failed/lost-claim RESULT, never a thrown
 *                        exception; only claimNextProofRenderJob/
 *                        isProofRenderQueueLeaseActive throwing BEFORE a
 *                        claim even happens reaches here). Whatever jobs
 *                        were already processed before the error stay in
 *                        `jobs`/`counts` — this never discards already-
 *                        durable work.
 *
 * A single job's own status (including 'failed'/'lost-claim') NEVER stops
 * the loop by itself — only the six conditions above do.
 */
export async function drainProofRenderJobs({
  workerId,
  maxIterations = DEFAULT_DRAIN_MAX_ITERATIONS,
  requestDeadlineMs = DEFAULT_REQUEST_DEADLINE_MS,
  heartbeatIntervalMs,
  totalDeadlineMs = DEFAULT_TOTAL_DEADLINE_MS,
  isShuttingDown = () => false,
} = {}) {
  const startedAt = Date.now();
  const processedJobs = [];
  const counts = { done: 0, queued: 0, failed: 0, lostClaim: 0 };
  let iterations = 0;
  let stopReason = null;
  let errorMessage;
  let retryAt;

  while (iterations < maxIterations) {
    if (isShuttingDown()) { stopReason = 'shutting-down'; break; }
    const remainingRequestMs = requestDeadlineMs - (Date.now() - startedAt);
    if (remainingRequestMs <= 0) { stopReason = 'deadline'; break; }

    iterations += 1;
    // This iteration's own per-job deadline: never more than the per-job
    // ceiling (totalDeadlineMs), and never more than whatever's actually
    // left of the REQUEST's own budget — the fix for the exact gap the
    // external review found (see this section's own header comment).
    const perJobDeadlineMs = Math.min(totalDeadlineMs, remainingRequestMs);
    let result;
    try {
      result = await _internals.runOneProofRenderJob({ workerId, heartbeatIntervalMs, totalDeadlineMs: perJobDeadlineMs });
    } catch (err) {
      stopReason = 'error';
      errorMessage = err?.message || String(err);
      break;
    }

    if (!result.claimed) {
      stopReason = result.busy ? 'busy' : (result.delayed ? 'delayed' : 'empty');
      if (result.delayed) retryAt = result.retryAt;
      break;
    }

    processedJobs.push({ jobId: result.jobId, status: result.status, ...(result.error ? { error: result.error } : {}) });
    if (result.status === 'done') counts.done += 1;
    else if (result.status === 'queued') counts.queued += 1;
    else if (result.status === 'failed') counts.failed += 1;
    else if (result.status === 'lost-claim') counts.lostClaim += 1;
    // Loop continues regardless of THIS job's own outcome — requirement 2.
  }

  if (!stopReason) stopReason = 'max-iterations';
  return {
    stopReason, jobs: processedJobs, counts, iterations,
    ...(retryAt ? { retryAt } : {}),
    ...(errorMessage ? { error: errorMessage } : {}),
  };
}
