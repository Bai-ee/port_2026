// proof-server.mjs — Phase 3 (STUDIO-DETERMINISTIC-FINAL-RENDER-SONNET-
// HANDOFF.md). HTTP entrypoint for the dedicated, CPU-only studio-proof-
// render Cloud Run service — completely separate from server.mjs (the GPU
// Video Promo service, untouched by this file). Wraps proof-render-
// worker.mjs's `drainProofRenderJobs` (P1 follow-up checkpoint, "worker
// drain"): one authenticated POST /run now claims+processes jobs
// SEQUENTIALLY until the queue is genuinely empty or a stop condition
// fires (see drainProofRenderJobs' own header for the full list), not just
// one job per request — dispatched by an external trigger (api/_lib/
// proof-render-dispatch.cjs's local/direct-POST strategy is the only one
// actually implemented today; Cloud Tasks or an equivalent durable queue
// remains a documented, unimplemented stub — see that module's own header).
// This file only needs to be safely callable, repeatedly and concurrently,
// by whatever calls it.
//
// Not deployed by this Phase — Dockerfile.proof/deploy-cloud-run-proof.sh
// exist and this file runs/tests locally, but no `gcloud run deploy` has
// been executed. See the handoff's Phase 7 stop gate.

import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { drainProofRenderJobs } from './proof-render-worker.mjs';

const PORT = Number(process.env.PORT) || 8080;
// Read lazily (not module-top-level) so a test can set
// process.env.PROOF_RENDER_SHARED_SECRET before calling isAuthorized/
// handleRun without needing to re-import this module per test case.
function currentSecret() { return process.env.PROOF_RENDER_SHARED_SECRET || ''; }
const SERVICE_NAME = 'studio-proof-render';

// Constant-time secret comparison (Phase 3 requirement, explicit) — same
// discipline as api/_lib/auth.cjs's own safeSecretEquals, reimplemented
// locally rather than imported: this service is built from ONLY this
// directory (`--source .`, see deploy-cloud-run-proof.sh's own comment,
// mirroring deploy-cloud-run.sh's established reasoning), so nothing outside
// services/studio-render/ can be a runtime import here without a vendoring
// step this one small function doesn't warrant.
function safeSecretEquals(provided, configured) {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  if (typeof configured !== 'string' || configured.length === 0) return false;
  const providedBuffer = Buffer.from(provided);
  const configuredBuffer = Buffer.from(configured);
  if (providedBuffer.length !== configuredBuffer.length) return false;
  return timingSafeEqual(providedBuffer, configuredBuffer);
}

function isAuthorized(req) {
  const secret = currentSecret();
  if (!secret) return false; // never "open" by omission — a missing configured secret authorizes NOTHING
  const header = req.headers['x-proof-render-secret'];
  return safeSecretEquals(Array.isArray(header) ? header[0] : header, secret);
}

function send(res, code, body) {
  const json = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(json);
}

let shuttingDown = false;
let server;

// In-process drain guard (P1 follow-up checkpoint: "worker drain closes the
// dispatch race"). A drain now runs SEQUENTIALLY across potentially many
// jobs (drainProofRenderJobs, proof-render-worker.mjs) inside ONE /run
// request, which reopens exactly the race P1-B's own Firestore-lock-based
// `busy` check was built for: the singleton lock (proof-render-jobs.cjs) is
// only held DURING an individual job's render — it is genuinely free in the
// gap BETWEEN this drain's own iterations. Without a SEPARATE guard here, a
// second /run arriving in one of those gaps could slip in, start its OWN
// drain, and race the first. `draining` is set synchronously, before any
// `await`, so Node's single-threaded execution makes the check-and-set
// atomic with respect to any other concurrently-arriving request — there is
// no scheduling window in which two requests can both observe it `false`.
// Reset in `finally` no matter how the drain ends (success, error, or an
// exception from drainProofRenderJobs itself), so a request can never leave
// this worker permanently un-drainable.
let draining = false;

/**
 * One drainProofRenderJobs() call — potentially many jobs, sequentially —
 * translated into a truthful HTTP result.
 *
 * `stopReason: 'empty'` is the ONLY outcome that means the queue is
 * CONFIRMED empty — no queued/rendering work exists at all (post-P1
 * external-review correction: a backoff-delayed requeue now surfaces as
 * 'delayed', never 'empty'). That's the only case that's ever a plain 200
 * (whether or not any jobs were processed first).
 *
 * Every OTHER stop reason (P1 correction, post-Environment/IBL-parity
 * external review: "treat every non-empty bounded exit that may leave work
 * queued as requiring another wake-up") — 'delayed', 'busy',
 * 'shutting-down', 'deadline', 'max-iterations', or 'error' — means the drain stopped
 * WITHOUT that confirmation, so a queued remainder may still exist. A
 * durable dispatcher (Cloud Tasks) must be told to retry in EVERY one of
 * those cases, REGARDLESS of whether this call already completed real,
 * durable work first. The PREVIOUS version of this function only checked
 * this for the zero-jobs-processed case — a drain that processed one job
 * and then hit 'deadline'/'max-iterations'/'busy'/'error' on a LATER
 * iteration returned a plain 200, which a dispatcher reads as "delivered,
 * no retry needed," silently stranding whatever was left behind it. That
 * bug is what this function now closes: the retryable branch below fires
 * on `stopReason`, never on `jobs.length`.
 *
 * `error` still gets its own distinct 500 (a genuine infrastructure fault,
 * not just "ran out of budget") — everything else in the retryable family
 * is a 409 with a `Retry-After` hint, matching the 'busy' contract this
 * response shape already established (Codex P1-B round). Both codes are
 * safe to retry by construction: claiming is idempotent/fenced
 * (proof-render-jobs.cjs), so a retried dispatch can never duplicate or
 * corrupt whatever this call already completed.
 */
async function handleRun(req, res) {
  if (shuttingDown) return send(res, 503, { ok: false, error: 'shutting down' });
  if (!isAuthorized(req)) return send(res, 401, { ok: false, error: 'unauthorized' });

  if (draining) {
    res.setHeader('retry-after', '10');
    return send(res, 409, {
      ok: false, claimed: false, busy: true,
      error: 'A drain is already in progress on this worker — retry shortly.',
    });
  }

  draining = true;
  try {
    const result = await drainProofRenderJobs({
      workerId: `${SERVICE_NAME}-${process.pid}-${Date.now()}`,
      isShuttingDown: () => shuttingDown,
    });

    if (result.stopReason === 'empty') {
      if (result.jobs.length === 0) return send(res, 200, { ok: true, claimed: false });
      const last = result.jobs[result.jobs.length - 1];
      return send(res, 200, {
        ok: true, claimed: true, jobId: last.jobId, status: last.status,
        ...(last.error ? { error: last.error } : {}),
        jobs: result.jobs, counts: result.counts, stopReason: result.stopReason,
      });
    }

    if (result.stopReason === 'error') {
      console.error(`[proof-server] /run drain hit an infrastructure error${result.jobs.length ? ` after processing ${result.jobs.length} job(s)` : ' before claiming any work'}: ${result.error}`);
      return send(res, 500, {
        ok: false, error: result.error, stopReason: 'error',
        ...(result.jobs.length ? { jobs: result.jobs, counts: result.counts } : {}),
      });
    }

    // 'delayed' | 'busy' | 'shutting-down' | 'deadline' | 'max-iterations'
    // — a real, temporary stop condition. Already-processed jobs (if any)
    // are durable and reported here for observability, but queued/pending
    // work remains (or its state is unconfirmed), so this is ALWAYS
    // retryable, never a plain success — the exact fix for the P1
    // stranding gap above. 'delayed' (post-P1 external-review correction)
    // is the backoff case: pending work exists but none of it is claimable
    // until `retryAt`, so Retry-After is derived from that timestamp
    // (clamped to [1s, 900s] — 900s is the top of the requeue backoff
    // ladder) instead of the flat 10s the immediately-retryable reasons
    // use. A durable dispatcher (Cloud Tasks, once wired) should schedule
    // its redelivery at-or-after `retryAt`; a plain-retry dispatcher just
    // honoring Retry-After lands at the same place.
    const retryAfterSeconds = result.stopReason === 'delayed' && result.retryAt
      ? Math.min(900, Math.max(1, Math.ceil((Date.parse(result.retryAt) - Date.now()) / 1000)))
      : 10;
    res.setHeader('retry-after', String(retryAfterSeconds));
    return send(res, 409, {
      ok: result.jobs.length > 0, claimed: result.jobs.length > 0, busy: result.stopReason === 'busy',
      delayed: result.stopReason === 'delayed',
      ...(result.retryAt ? { retryAt: result.retryAt } : {}),
      stopReason: result.stopReason, jobs: result.jobs, counts: result.counts,
      error: `Drain stopped early (${result.stopReason}) before confirming the queue is empty — retry to continue draining any remaining queued work.`,
    });
  } catch (err) {
    console.error(`[proof-server] /run failed unexpectedly: ${err?.message}`);
    return send(res, 500, { ok: false, error: err?.message || String(err) });
  } finally {
    draining = false;
  }
}

server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    return send(res, 200, { ok: true, service: SERVICE_NAME, shuttingDown });
  }
  if (req.method === 'POST' && req.url === '/run') {
    return handleRun(req, res);
  }
  return send(res, 404, { ok: false, error: 'not found' });
});

function shutdownSoon(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[proof-server] ${reason} — draining, no new /run work accepted`);
  // No forced-exit timer the way server.mjs uses for its single-render-per-
  // container model: a render+upload cycle here can legitimately run up to
  // TOTAL_RENDER_DEADLINE_MS (proof-render-jobs.cjs), and Cloud Run itself
  // already enforces the container's own request/shutdown timeout — an
  // additional shorter local timer here would just race that and risk
  // killing a render mid-upload for no benefit.
  server?.close(() => process.exit(0));
}

// Only actually bind a port / register signal handlers when this file is
// run directly (`node proof-server.mjs`, or the Dockerfile.proof CMD) —
// never as a side effect of being imported. This is what lets
// __tests__/proof-server.test.mjs import `server`/`shuttingDown` state and
// drive real HTTP requests against its own ephemeral `server.listen(0)`,
// with a fake Firestore/Storage context injected exactly like every other
// worker-layer test in this repo, instead of needing a live Cloud Run
// service or a subprocess.
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  process.once('SIGTERM', () => shutdownSoon('SIGTERM'));
  process.once('SIGINT', () => shutdownSoon('SIGINT'));
  server.listen(PORT, () => {
    console.log(`${SERVICE_NAME} listening on :${PORT} (auth ${currentSecret() ? 'on' : 'OFF — every /run request will be rejected'})`);
  });
}

export { server, shutdownSoon, isAuthorized, safeSecretEquals };
// Test-only introspection/control of shutdown state (module-level `let`
// can't be exported live otherwise) — mirrors proof-render-worker.mjs's own
// `_internals` DI-seam naming convention. `setShuttingDownForTest` exists
// ONLY so a test can exercise handleRun's 503-during-drain branch WITHOUT
// calling the real `shutdownSoon` (which calls `server.close()` then
// `process.exit(0)` — invoking that for real inside a test process would
// kill the whole test run, not just this one server instance).
export const _internals = {
  isShuttingDown: () => shuttingDown,
  setShuttingDownForTest: (value) => { shuttingDown = value; },
};
