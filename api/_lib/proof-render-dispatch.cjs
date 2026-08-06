// proof-render-dispatch.cjs — P1-A (Production lifecycle hardening round).
//
// The gap this closes: creating a Proof/Final Render job (proof-render-
// jobs.cjs's createProofRenderJob) only ever writes a `queued` Firestore
// doc — nothing has ever woken the worker automatically. Today a queued job
// sits until a human manually POSTs the worker's own /run endpoint
// (services/studio-render/proof-server.mjs), a step Cloud Tasks (or an
// equivalent durable dispatch mechanism) was explicitly never wired up for
// ("not done" — see that file's own header comment).
//
// One seam, `dispatchProofRenderJob(jobId)`, called from app/api/dashboard/
// proof-render/route.js right after a job is created — same call site, same
// shape this codebase already ships for the structurally identical
// site-clone worker trigger (app/api/dashboard/site-clone/route.js's own
// triggerWorker). Job durability lives entirely in Firestore; nothing in
// this module has any bearing on whether a job is ever lost — a dispatch
// failure just leaves the job `queued`, exactly as it is today, remaining
// claimable by any later POST /run (manual or auto-dispatched).
//
// EXPLICITLY BEST-EFFORT, not non-blocking and not durable (external review
// correction, post-Environment/IBL-parity round — an earlier version of
// this comment said "never blocks," which was imprecise): this call is
// AWAITED by the route (see that file's own call site) and, in 'local'
// mode, the worker's /run now runs a full sequential drain (potentially
// many jobs) rather than claiming just one — dispatchViaLocalPost's own
// 5-second AbortController timeout is a REAL bounded-blocking wait added to
// every "create a Proof/Final Render job" response, not a fire-and-forget
// call that returns instantly. "Best-effort" here means ONLY: never fails
// or indefinitely blocks job creation, and never guarantees delivery — a
// dropped/timed-out/unimplemented dispatch attempt is simply lost with no
// retry queue behind it (that's what "not durable" means: no redelivery
// semantics at all, unlike Cloud Tasks). The job stays safely `queued`
// either way and is picked up by the next successful dispatch, a manual
// POST /run, or the worker-drain's own retryable-409 contract eventually
// prompting another call — never silently lost, but also never guaranteed
// a timely wake-up by this mechanism alone. Reducing the actual latency
// this adds (not just the wording) is tracked as a separate P2 fix.
//
// Strategy is chosen by env config, checked in this order:
//
//   1. Cloud dispatch (production; durable Cloud Tasks) — gated on
//      PROOF_RENDER_TASKS_QUEUE, IMPLEMENTED as of Phase 7 item 1 (see
//      dispatchViaCloudTasks below for the full delivery/auth/config
//      contract). Runtime prerequisite is an IAM grant
//      (roles/cloudtasks.enqueuer on the dispatching identity) plus the
//      queue itself — both cloud mutations behind the Phase 7 approval
//      gate; until they exist, a set env var fails loudly in the logs and
//      the job stays queued — it deliberately never silently falls back to
//      the local strategy below (that URL may not even be the right one
//      for whatever environment set this var).
//   2. Local/direct dispatch (dev today; also a legitimate production
//      mechanism until Cloud dispatch ships — this is the SAME shape
//      site-clone's own trigger already uses in production, not a dev-only
//      shortcut) — a direct authenticated POST to PROOF_RENDER_WORKER_URL's
//      own /run, gated on that var plus PROOF_RENDER_SHARED_SECRET (the
//      SAME shared secret proof-server.mjs's own isAuthorized() checks —
//      one secret value, set in both the caller's and the worker's env,
//      matching SITE_CLONE_SHARED_SECRET's own established convention).
//   3. Neither configured — a harmless no-op. The job just stays queued for
//      a manual POST /run, exactly today's behavior.
//
// A 409/429 from the worker (P1-B, this same hardening round: the worker is
// already claimed/rendering) is NOT treated as a dispatch failure here —
// it means a worker is already active and will pick up other queued work
// once free; only genuinely unexpected statuses are logged.
//
// Delayed/backoff work (post-P1 external-review correction): the worker's
// /run now answers a retryable 409 with `delayed: true`, `retryAt`, and a
// Retry-After derived from the earliest backoff expiry whenever pending
// work exists that isn't claimable yet — never a 200 "empty" a dispatcher
// would ack and drop. The eventual Cloud Tasks implementation MUST honor
// that contract by scheduling/redelivering its task at-or-after `retryAt`
// (Cloud Tasks' own retry-with-backoff on non-2xx plus Retry-After gets
// this for free; an explicit scheduleTime works too). This direct/local
// mode stays EXPLICITLY BEST-EFFORT: it fires once at job creation, does
// not schedule anything for later, and therefore still cannot guarantee a
// wake-up at retryAt for a backoff-delayed retry — a delayed 409 here just
// means the retry rides the next dispatch/manual /run, exactly like every
// other non-durable-delivery limitation this header already documents.

function resolveDispatchMode(env = process.env) {
  if (String(env.PROOF_RENDER_TASKS_QUEUE || '').trim()) return 'cloud-tasks';
  const url = String(env.PROOF_RENDER_WORKER_URL || '').trim();
  const secret = String(env.PROOF_RENDER_SHARED_SECRET || '').trim();
  if (url && secret) return 'local';
  return 'none';
}

// ── Cloud Tasks (Phase 7 item 1 — durable delivery, implemented) ──────────
//
// A REST call to cloudtasks.googleapis.com creating one HTTP task per
// dispatch, targeting the worker's own POST /run with the same shared
// secret header direct mode uses. Durability comes from the QUEUE, not this
// call: once the task is created, Cloud Tasks owns delivery — a transient
// Vercel→Cloud Run failure, a worker cold start, or a busy/delayed 409 all
// become queue-level retries (the queue's retryConfig backoff eventually
// lands at-or-after any delayed retryAt; see the deployment audit in the
// handoff for the recommended queue settings). Retried delivery is safe by
// construction: claiming is idempotent/fenced, and /run's own contract
// (200 empty / 409 retryable) tells the queue exactly when to stop.
//
// Auth mirrors firebase-admin.cjs's two credential paths exactly (see that
// module's initAdminApp comment): explicit FIREBASE_ADMIN_* service-account
// envs on Vercel, Application Default Credentials on Cloud Run — via
// google-auth-library (already shipped transitively by firebase-admin; no
// new dependency).
//
// Config (all four required in cloud-tasks mode; anything missing fails
// loudly through the best-effort wrapper's log, and the job stays queued):
//   PROOF_RENDER_TASKS_QUEUE      — full queue name:
//                                   projects/<p>/locations/<l>/queues/<q>
//   PROOF_RENDER_WORKER_URL       — the worker service base URL (same var
//                                   direct mode uses)
//   PROOF_RENDER_SHARED_SECRET    — the /run secret (same var direct mode uses)
//   PROOF_RENDER_TASKS_INVOKER_SA — service-account email the task runs AS
//                                   (Codex Phase 7 review, P1): the worker
//                                   is deployed --no-allow-unauthenticated,
//                                   so Cloud Run IAM rejects any request
//                                   without a valid OIDC token BEFORE
//                                   proof-server.mjs ever sees the shared
//                                   secret. Every task therefore carries
//                                   oidcToken {serviceAccountEmail,
//                                   audience=worker URL} — Google's
//                                   documented pattern for private Cloud
//                                   Run targets. IAM prerequisites (see the
//                                   deployment audit): this SA needs
//                                   roles/run.invoker on the worker
//                                   service; the DISPATCHING identity needs
//                                   iam.serviceAccounts.actAs on this SA;
//                                   and the Cloud Tasks service agent needs
//                                   roles/iam.serviceAccountTokenCreator on
//                                   it. The shared-secret header stays as
//                                   defense in depth.
//
// Task DEDUPLICATION (Codex Phase 7 review, P2): every task is created with
// the deterministic name <queue>/tasks/job-<jobId> — Cloud Tasks' own
// supported dedup mechanism — so an idempotent create replay (same job)
// can never enqueue a SECOND durable task; the resulting 409
// ALREADY_EXISTS is treated as success. (Task-name tombstones last ~1h
// after completion; within that window a completed job needs no new task —
// the original delivery already drained it — and a job requeued by backoff
// is redelivered by the QUEUE's own retry of the original task, never by a
// second create.)
const TASKS_QUEUE_NAME_RE = /^projects\/[^/]+\/locations\/[^/]+\/queues\/[^/]+$/;
// The worker's own request budget is ~660s (proof-render-worker.mjs
// DEFAULT_REQUEST_DEADLINE_MS); the task's dispatch deadline must outlive
// it or Cloud Tasks retries a drain that is still legitimately working.
// Cloud Tasks caps HTTP dispatchDeadline at 30min — 900s sits comfortably
// between the two.
const TASKS_DISPATCH_DEADLINE_SECONDS = 900;

let _cachedAuth = null;
async function getGoogleAccessToken(env) {
  const { GoogleAuth } = require('google-auth-library');
  if (!_cachedAuth) {
    const hasExplicit = env.FIREBASE_ADMIN_PROJECT_ID && env.FIREBASE_ADMIN_CLIENT_EMAIL && env.FIREBASE_ADMIN_PRIVATE_KEY;
    _cachedAuth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      ...(hasExplicit ? {
        credentials: {
          client_email: env.FIREBASE_ADMIN_CLIENT_EMAIL,
          // Same \n-unescaping firebase-admin.cjs's parsePrivateKey performs
          // for Vercel-stored keys.
          private_key: String(env.FIREBASE_ADMIN_PRIVATE_KEY).replace(/\\n/g, '\n'),
        },
        projectId: env.FIREBASE_ADMIN_PROJECT_ID,
      } : {}),
    });
  }
  return _cachedAuth.getAccessToken();
}

/**
 * Creates one Cloud Task delivering POST /run to the worker. `scheduleTime`
 * (optional ISO string) schedules delivery at-or-after that moment — the
 * hook a future delayed-retryAt redelivery can use; plain job-creation
 * dispatch omits it (deliver ASAP). Throws on ANY failure (bad config,
 * auth, non-2xx create) — the best-effort wrapper below owns catching.
 */
async function dispatchViaCloudTasks(jobId, env, { fetchImpl = fetch, getTokenImpl = getGoogleAccessToken, scheduleTime = null } = {}) {
  const queue = String(env.PROOF_RENDER_TASKS_QUEUE || '').trim();
  const workerUrl = String(env.PROOF_RENDER_WORKER_URL || '').trim().replace(/\/$/, '');
  const secret = String(env.PROOF_RENDER_SHARED_SECRET || '').trim();
  const invokerSa = String(env.PROOF_RENDER_TASKS_INVOKER_SA || '').trim();
  if (!TASKS_QUEUE_NAME_RE.test(queue)) {
    throw new Error(`PROOF_RENDER_TASKS_QUEUE must be a full queue name (projects/<p>/locations/<l>/queues/<q>); got "${queue}".`);
  }
  if (!workerUrl) throw new Error('PROOF_RENDER_WORKER_URL is required for Cloud Tasks dispatch (it is the task target).');
  if (!secret) throw new Error('PROOF_RENDER_SHARED_SECRET is required for Cloud Tasks dispatch (the worker rejects unauthenticated /run).');
  if (!invokerSa) {
    throw new Error('PROOF_RENDER_TASKS_INVOKER_SA is required for Cloud Tasks dispatch — the worker is a PRIVATE Cloud Run service; without an OIDC token its IAM layer rejects the task before /run ever runs.');
  }

  const token = await getTokenImpl(env);
  if (!token) throw new Error('Could not obtain a Google access token for Cloud Tasks.');

  // Deterministic task id = dedup (see header). jobId's own charset
  // (proof_<ms>_<hex>) is already task-name-safe; guarded anyway.
  const taskId = `job-${String(jobId).replace(/[^A-Za-z0-9_-]/g, '-')}`;

  const res = await fetchImpl(`https://cloudtasks.googleapis.com/v2/${queue}/tasks`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      task: {
        name: `${queue}/tasks/${taskId}`,
        dispatchDeadline: `${TASKS_DISPATCH_DEADLINE_SECONDS}s`,
        ...(scheduleTime ? { scheduleTime } : {}),
        httpRequest: {
          httpMethod: 'POST',
          url: `${workerUrl}/run`,
          headers: { 'x-proof-render-secret': secret },
          oidcToken: { serviceAccountEmail: invokerSa, audience: workerUrl },
        },
      },
    }),
  });
  if (res.status === 409) {
    // ALREADY_EXISTS — the deterministic name did its job: a durable task
    // for this job is already queued (or recently completed). Success.
    return;
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Cloud Tasks task creation failed (${res.status}) for job ${jobId}: ${detail.slice(0, 300)}`);
  }
}

/** Direct authenticated POST to the worker's own /run — mirrors site-clone route.js's own triggerWorker exactly (5s-bounded, best-effort). */
async function dispatchViaLocalPost(jobId, env, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  const url = String(env.PROOF_RENDER_WORKER_URL || '').trim().replace(/\/$/, '');
  const secret = String(env.PROOF_RENDER_SHARED_SECRET || '').trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${url}/run`, {
      method: 'POST',
      headers: { 'x-proof-render-secret': secret },
      signal: controller.signal,
    });
    // 409/429 (P1-B's own busy signal) is expected, healthy contention, not
    // a dispatch failure — only warn on a genuinely unexpected status.
    if (!res.ok && res.status !== 409 && res.status !== 429) {
      console.warn(`[proof-render-dispatch] worker /run returned ${res.status} for job ${jobId}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Best-effort wake-up call after a Proof/Final Render job is created. Never
 * throws — every failure (network, timeout, unimplemented cloud strategy,
 * unexpected non-2xx) is caught and logged here, so a dispatch problem can
 * never FAIL the job-creation response. It CAN still add real latency to
 * that response (up to dispatchViaLocalPost's own 5s timeout in 'local'
 * mode) — "best-effort" describes the failure/delivery contract, not the
 * timing one; see this module's own header for the full correction. The
 * job is already durably `queued` in Firestore by the time this is called,
 * and remains claimable by any later POST /run regardless of what happens
 * in this function.
 */
/**
 * Returns an OBSERVABLE dispatch status instead of swallowing failures
 * (Codex Phase 7 review, P1: a caught Cloud Tasks failure used to leave
 * the route returning a plain success while no task existed to wake the
 * queued job): `{ mode, dispatched, reason? , error? }`. Still NEVER
 * throws — a dispatch problem must never fail job creation — but the
 * caller now surfaces `dispatched:false` (mode !== 'none') to the client,
 * whose retry of the SAME idempotent create resolves to the SAME job and
 * re-attempts dispatch (the deterministic task name makes that replay
 * dedup-safe on the Cloud Tasks side).
 */
async function dispatchProofRenderJob(jobId, { env = process.env, fetchImpl } = {}) {
  const mode = resolveDispatchMode(env);
  if (mode === 'none') return { mode, dispatched: false, reason: 'not-configured' };
  try {
    if (mode === 'cloud-tasks') await dispatchViaCloudTasks(jobId, env, { ...(fetchImpl ? { fetchImpl } : {}) });
    else await dispatchViaLocalPost(jobId, env, { fetchImpl });
    return { mode, dispatched: true };
  } catch (err) {
    console.warn(`[proof-render-dispatch] dispatch failed for job ${jobId} (mode=${mode}): ${err?.message || err}`);
    return { mode, dispatched: false, error: String(err?.message || err).slice(0, 300) };
  }
}

module.exports = {
  dispatchProofRenderJob,
  resolveDispatchMode,
  // Test-only introspection of the individual strategies (DI seam, mirrors
  // proof-render-worker.mjs's own `_internals` naming convention).
  _internals: { dispatchViaCloudTasks, dispatchViaLocalPost },
};
