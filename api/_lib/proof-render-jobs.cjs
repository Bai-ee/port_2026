// proof-render-jobs.cjs — Slice 4d (Studio Roadmap). Job lifecycle for
// art-scene-v2 Proof renders (services/studio-render/art-render.mjs).
//
// Mirrors studio-render-jobs.cjs's own lease/backoff/singleton-queue-lock
// mechanics (same LEASE_TIMEOUT_MS/MAX_ATTEMPTS/BACKOFF_MS ladder, same
// claim-via-transaction + orphan-reclaim-on-expired-lease pattern), but
// reached through ctx() (media-jobs.cjs's own DI seam) so tests can inject
// an in-memory fake (api/_lib/__tests__/fake-firestore.cjs) — unlike
// studio-render-jobs.cjs, which has no test file today.
//
//   queued → rendering → done
//                      → failed
//
// One Firestore doc per job:
//   proof_render_jobs/{jobId}   (a SEPARATE collection from render_jobs —
//   Video Promo's own queue/collection is completely untouched by this file)
//
// This module does NOT itself normalize recipes or check capabilities —
// that's app/api/dashboard/proof-render/route.js's job, using
// services/studio-render/art-recipe.mjs's normalizeArtSceneRecipe and
// art-render-validation.mjs's checkCapabilities/validateRenderParams
// (both pure ESM, no Playwright dependency) BEFORE ever calling
// createProofRenderJob here. This module re-asserts `capabilities.supported`
// as a defense-in-depth invariant of job creation itself, though — no
// unsupported recipe is ever persisted as a job, and there is no
// `allowUnsupportedFeatures` escape hatch anywhere in this file (that
// parameter exists ONLY on the local-testing renderArtScene function,
// never reachable from job creation).
//
// `output` (set by completeProofRenderJob) is ALWAYS the sanitized ffprobe
// metadata object (width/height/fps/codec/frameCount/duration) — never a
// local mp4Path/posterPath. This module has no concept of "the file lives
// at /tmp/..." at all; artifact storage/serving is out of this slice's
// scope entirely (see the Slice 4d checkpoint's own known-limitations note).
//
// ── Claim-token fencing (Codex re-review, P1) ──────────────────────────────
// Every claim (fresh or a reclaim of an orphaned lease) mints a brand new
// `claimToken` (a UUID), stored on BOTH the job's own `workerLease` and the
// singleton lock doc. complete/fail/requeue/renewLease/clearQueueLease all
// REQUIRE the caller's claimToken to match the CURRENTLY stored one — a
// worker that loses its lease (reclaimed by someone else while it was still
// "working", e.g. a zombie process that didn't actually die) can no longer
// complete, fail, requeue, or release the lock out from under whoever holds
// the claim now. Every one of these transitions runs inside a Firestore
// transaction that re-reads the current state and re-checks the token
// before writing anything — never a plain read-then-write.
//
// completeProofRenderJob is the one operation that's ALSO idempotent for
// the SAME claim: a worker that completed successfully but crashed before
// acknowledging can safely call it again with its own (still-matching)
// token and get the same success, because `lastClaimToken` (set at
// completion, never cleared) is checked in addition to the live
// `workerLease.claimToken` (which IS cleared on completion).
//
// No persistence error is ever silently swallowed on the transition itself
// (Codex: "the worker may return done only after completion is durably
// stored") — only the SEPARATE, secondary queue-lock release step logs
// (not silently drops) its own failure, since an unreleased lock still
// self-heals via its own expiry through the orphan-reclaim path.

const { randomUUID, createHash } = require('crypto');
const realFb = require('./firebase-admin.cjs');

const COLLECTION = 'proof_render_jobs';
const LOCK_COLLECTION = 'proof_render_queue_locks';
const LOCK_DOC = 'proof_render';
const IDEMPOTENCY_COLLECTION = 'proof_render_idempotency';
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
// Same values as studio-render-jobs.cjs, reused deliberately (task: "Reuse
// the existing studio-render-jobs lease/backoff/idempotency patterns").
const LEASE_TIMEOUT_MS = 330 * 1000;
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [30_000, 90_000, 3 * 60_000, 8 * 60_000, 15 * 60_000];
// Total render/job deadline (Slice 4f Phase B) — server-owned, not caller-
// controlled (no request/job field can set it), same principle Phase A
// established for the ffmpeg/ffprobe subprocess timeouts. Bounds the ENTIRE
// renderArtScene() call (Chromium launch, navigation, warm-up, frame-by-
// frame capture, encode, probe) — Phase A's own timeouts only ever bounded
// the ffmpeg/ffprobe subprocess phase; this closes the gap its own
// checkpoint recorded. `services/studio-render/proof-render-worker.mjs`
// creates an AbortController from this value and passes its signal into
// renderArtScene(); `api/_lib/proof-render-tasks.cjs` derives the Cloud
// Tasks dispatch deadline FROM this same constant (never a second, silently
// divergent number) so the two stay compatible by construction.
//
// Deliberately NOT bounded by LEASE_TIMEOUT_MS above (this value, 600s, is
// intentionally LARGER than that 330s lease window) — the worker's own
// heartbeat renews the lease every DEFAULT_HEARTBEAT_INTERVAL_MS (120s,
// proof-render-worker.mjs) independently throughout the render, so a
// legitimately still-running job is never mistaken for orphaned regardless
// of how this deadline compares to the lease window; the two mechanisms
// solve different problems (lease: is a WORKER still alive; deadline: has
// THIS render run too long) and don't need a fixed ordering relationship.
// Comfortably under Cloud Tasks' own hard 1800s (30 min) max dispatch
// deadline, which `proof-render-tasks.cjs` must also respect. Generous
// default — no empirical Cloud Run worst-case timing exists yet; the
// Phase C canary's own observed duration should tighten this, not a further
// guess.
const TOTAL_RENDER_DEADLINE_MS = 600_000; // 10 minutes

// --- test seam (media-jobs.cjs's own DI pattern) ---------------------------
let _ctx = null;
function __setTestContext(ctx) { _ctx = ctx; }
function ctx() { return _ctx || realFb; }

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function payloadHash(recipe, renderParams, timeline) {
  // `timeline` (Phase C, "Interrupted export recovery") joins the hashed
  // payload so a same-idempotencyKey request carrying a DIFFERENT timeline
  // (or one that adds/removes a timeline entirely) is treated as a genuine
  // payload change — the existing "same key, different payload -> 409
  // conflict" rule, never a silent stale-timeline replay. Defaulted to
  // `null` so pre-existing call sites (every one before this phase) hash
  // identically to before.
  return createHash('sha256').update(JSON.stringify({ recipe, renderParams, timeline: timeline || null })).digest('hex');
}

function idempotencyDocId(clientId, idempotencyKey) {
  return createHash('sha256').update(`${clientId}:${idempotencyKey}`).digest('hex');
}

/**
 * The single source of truth for "is this a well-formed idempotencyKey" —
 * a non-empty string of at most MAX_IDEMPOTENCY_KEY_LENGTH characters.
 * Used internally by createProofRenderJob (when a key IS supplied) AND
 * directly by app/api/dashboard/proof-render/route.js, which requires one
 * unconditionally (Codex re-review round 3, P2: the authenticated
 * production API must always use atomic idempotency — missing, numeric,
 * object, empty, or oversized keys all return 400, never silently coerced
 * to "no key at all"). Throws (never returns false) so both callers get
 * the exact same rejection behavior from one place.
 */
function assertValidIdempotencyKey(key) {
  if (typeof key !== 'string' || !key.trim() || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw httpError(`idempotencyKey must be a non-empty string of at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`, 400);
  }
}

function isLeaseActive(job, nowMs = Date.now()) {
  if (!job || job.status !== 'rendering') return false;
  const expires = Date.parse(job.workerLease?.leaseExpiresAt || '');
  return Number.isFinite(expires) && expires > nowMs;
}

function isQueueLeaseActive(lock, nowMs = Date.now()) {
  const expires = Date.parse(lock?.leaseExpiresAt || '');
  return Number.isFinite(expires) && expires > nowMs;
}

function nextBackoffMs(attempts) {
  const index = Math.max(0, Math.min(BACKOFF_MS.length - 1, Number(attempts || 1) - 1));
  return BACKOFF_MS[index];
}

function lockRef() {
  return ctx().adminDb.collection(LOCK_COLLECTION).doc(LOCK_DOC);
}

/**
 * Releases the singleton queue lock — but ONLY if it's still held by
 * `claimToken` (never a bare jobId match: the SAME jobId can be reclaimed
 * with a NEW token after an orphan recovery, and a stale worker must not be
 * able to clear the newer claimant's lock). Failure here is logged, not
 * silently dropped, but does NOT retroactively undo an already-durable job
 * transition — an unreleased lock still expires on its own and becomes
 * reclaimable through the normal orphan-recovery path.
 */
async function clearQueueLease(jobId, claimToken) {
  if (!jobId || !claimToken) return;
  const fb = ctx();
  try {
    await fb.adminDb.runTransaction(async (tx) => {
      const ref = lockRef();
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const lock = snap.data();
      if (lock?.jobId !== jobId || lock?.claimToken !== claimToken) return; // not ours (or superseded) — never touch it
      tx.set(ref, {
        jobId: null, workerId: null, claimToken: null, leaseExpiresAt: null,
        releasedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }, { merge: true });
    });
  } catch (err) {
    console.warn(`[proof-render-jobs] failed to release the queue lock for ${jobId}: ${err?.message}`);
  }
}

/**
 * Create a Proof render job in 'queued' state. `recipe`/`warnings`/
 * `capabilities`/`renderParams` must already be normalized/validated by the
 * caller. `clientId`/`ownerUid` must be the server-resolved values from the
 * verified caller context — never trust anything the client could forge
 * (same discipline as api/_lib/studio-templates.cjs's own create path).
 *
 * `idempotencyKey`, when supplied, is a caller-chosen, bounded string
 * (<= 200 chars) scoped to `clientId`. The FIRST create for a given
 * (clientId, idempotencyKey) pair persists BOTH the job and a deterministic
 * idempotency record inside ONE transaction — so two simultaneous creates
 * with the same key can never both "win" (Firestore transactions serialize
 * conflicting read-then-write attempts; the loser's retry sees the record
 * the winner already committed). A repeat call with the SAME key and the
 * SAME recipe+renderParams payload returns the existing job
 * (`{ ...job, deduped: true }`); the SAME key with a DIFFERENT payload is a
 * 409 conflict — never silently overwritten, never silently ignored.
 * Omitting `idempotencyKey` (the default) creates a brand new job every
 * call, with no dedup at all — distinct explicit user actions always get
 * distinct jobs unless the caller opts into idempotent-replay semantics.
 *
 * `renderKind` (Phase 4, STUDIO-DETERMINISTIC-FINAL-RENDER-SONNET-HANDOFF.md)
 * is a plain label — `'proof'` (the default, every pre-existing call site
 * unchanged) or `'final'` — distinguishing the small fixed-profile Proof
 * check from a real Final Render. Both share this exact same queue/job
 * model (never a parallel renderer/queue); this field exists purely so a
 * client polling its OWN job list (listProofRenderJobs) can tell the two
 * apart without inferring it from renderParams' width/height. Not itself
 * an authorization or capability gate — the route layer decides what
 * renderParams a given renderKind is allowed to carry, this module just
 * records the label it was told.
 *
 * `timeline` (Phase C, "Interrupted export recovery" — STUDIO-
 * DETERMINISTIC-FINAL-RENDER-SONNET-HANDOFF.md), when supplied, must
 * already be the SMALL, REDUCED shape services/studio-render/art-
 * timeline.mjs's sanitizeArtTimeline produces (`{totalSeconds,
 * keyframes:[{t, scroll:{scrollPosition, posY}}...]}`) — validated against
 * the base recipe by the route's own checkArtTimelineCapabilities BEFORE
 * this is ever called, same "already normalized/validated by the caller"
 * discipline `recipe` itself gets. The FULL per-keyframe recipes never
 * reach this module (or get persisted) at all — this field is deliberately
 * small. Defaults to `null` (no timeline), so every pre-existing call site
 * is unaffected.
 */
async function createProofRenderJob({
  clientId, ownerUid, recipe, warnings, capabilities, renderParams, idempotencyKey = null, renderKind = 'proof', timeline = null,
}) {
  if (!clientId) throw httpError('clientId is required to create a Proof render job.', 400);
  if (!ownerUid) throw httpError('ownerUid is required to create a Proof render job.', 400);
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) {
    throw httpError('recipe is required and must be a plain object.', 400);
  }
  if (!renderParams || typeof renderParams !== 'object') {
    throw httpError('renderParams is required.', 400);
  }
  // Defense in depth — the route must have already rejected an unsupported
  // recipe (no allowUnsupportedFeatures path exists here at all), but this
  // invariant is re-checked so a job can never be persisted without it,
  // regardless of what any future caller of this module might skip.
  if (!capabilities || capabilities.supported !== true) {
    throw httpError(
      `Recipe requests unsupported feature(s): ${(capabilities?.unsupportedFeatures || []).join(', ') || 'unknown'}.`,
      422,
    );
  }
  if (idempotencyKey != null) assertValidIdempotencyKey(idempotencyKey);

  const hash = payloadHash(recipe, renderParams, timeline);
  const fb = ctx();

  function buildJobDoc(jobId, now) {
    return {
      jobId, clientId, ownerUid, status: 'queued', renderKind,
      recipe, recipeHash: hash, warnings: warnings || [], capabilities, renderParams,
      timeline: timeline || null,
      idempotencyKey: idempotencyKey || null,
      output: null, artifact: null, error: null,
      attempts: 0, workerLease: null, lastClaimToken: null, nextAttemptAt: null,
      createdAt: now, updatedAt: now,
      createdAtTs: fb.FieldValue.serverTimestamp(),
      nextAttemptAtTs: fb.FieldValue.serverTimestamp(),
      startedAt: null, completedAt: null,
    };
  }

  if (!idempotencyKey) {
    const jobId = `proof_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const doc = buildJobDoc(jobId, new Date().toISOString());
    await fb.adminDb.collection(COLLECTION).doc(jobId).set(doc);
    return doc;
  }

  const idRef = fb.adminDb.collection(IDEMPOTENCY_COLLECTION).doc(idempotencyDocId(clientId, idempotencyKey));
  let outcome = null;
  await fb.adminDb.runTransaction(async (tx) => {
    const idSnap = await tx.get(idRef);
    if (idSnap.exists) {
      const existing = idSnap.data();
      if (existing.payloadHash !== hash) { outcome = { kind: 'conflict' }; return; }
      outcome = { kind: 'existing', jobId: existing.jobId };
      return;
    }
    const jobId = `proof_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const doc = buildJobDoc(jobId, now);
    tx.set(fb.adminDb.collection(COLLECTION).doc(jobId), doc);
    tx.set(idRef, { clientId, idempotencyKey, jobId, payloadHash: hash, createdAt: now, createdAtTs: fb.FieldValue.serverTimestamp() });
    outcome = { kind: 'created', doc };
  });

  if (outcome.kind === 'conflict') {
    throw httpError('idempotencyKey was already used with a different request payload.', 409);
  }
  if (outcome.kind === 'created') return outcome.doc;

  const jobSnap = await fb.adminDb.collection(COLLECTION).doc(outcome.jobId).get();
  return { ...jobSnap.data(), deduped: true };
}

/**
 * Read-only peek at the singleton Proof-render lock — no transaction, no
 * claim attempt. Added for P1-B (Production lifecycle hardening round):
 * proof-server.mjs's own handleRun needs to tell "genuinely nothing to
 * claim" apart from "a worker already holds the lease" so it can respond
 * with a status a durable task dispatcher will actually retry (409/429)
 * instead of a 200 it would read as delivered and never retry — see that
 * file's own handleRun comment. Deliberately NOT folded into
 * claimNextProofRenderJob's own return value (kept additive) so every
 * existing caller/test of that function's job-or-null contract is
 * untouched.
 */
async function isProofRenderQueueLeaseActive() {
  const fb = ctx();
  const snap = await lockRef().get();
  return isQueueLeaseActive(snap.exists ? snap.data() : null, Date.now());
}

/** A queued job's next-attempt gate in epoch ms (0 = due immediately) — the ONE parse shared by the claim filter, the claim transaction re-check, and the delay peek below, so they can never disagree on when a job becomes runnable. */
function jobNextAttemptMs(data) {
  return data.nextAttemptAtTs?.toMillis
    ? data.nextAttemptAtTs.toMillis()
    : (data.nextAttemptAt ? Date.parse(data.nextAttemptAt) : 0);
}

/**
 * Read-only peek: does pending work exist that just isn't claimable RIGHT
 * NOW, and when does the earliest piece become claimable? Added for the
 * post-P1 external-review correction ("stopReason:'empty' currently means
 * 'nothing runnable right now', not 'no queued jobs exist'"): after a
 * transient failure requeues a job with a 30–900s backoff, the very next
 * claim finds nothing runnable, the worker reported the queue EMPTY, /run
 * returned 200, the dispatcher acked, and no future wake-up ever came — the
 * retry/backoff state machine was defeated. This peek is how the worker
 * tells that state apart from a genuinely empty queue.
 *
 * Mirrors claimNextProofRenderJob's own candidate filters EXACTLY (same
 * status reads, same attempts<MAX_ATTEMPTS cut, same jobNextAttemptMs
 * parse) so "delayed" can never claim-loop forever on work the claim path
 * would never take:
 *   - queued, attempts<MAX, future nextAttemptAt → pending; claimable at
 *     that nextAttemptAt.
 *   - queued, attempts<MAX, already due → pending; claimable now (a claim
 *     race lost between reads — retry immediately).
 *   - rendering, attempts<MAX, ACTIVE lease → pending; reconsider at
 *     leaseExpiresAt (if its owner completes sooner, the retry simply finds
 *     a genuinely empty queue then; if the owner died, that is exactly when
 *     the orphan becomes reclaimable).
 *   - rendering, attempts<MAX, expired lease → pending; reclaimable now.
 *   - anything at attempts>=MAX_ATTEMPTS → ignored, exactly like the claim
 *     filter (requeueProofRenderJob already terminal-fails exhausted jobs).
 *
 * Returns `{ retryAtMs, retryAt }` (earliest claimable moment, never in the
 * past) when such pending work exists, or `null` when the queue is
 * genuinely empty. Deliberately additive — same contract-preservation
 * reasoning as isProofRenderQueueLeaseActive above.
 */
async function peekProofRenderQueueDelay() {
  const fb = ctx();
  const nowMs = Date.now();

  let earliestMs = null;
  const consider = (candidateMs) => {
    if (earliestMs === null || candidateMs < earliestMs) earliestMs = candidateMs;
  };

  // Same paged scans as claimNextProofRenderJob (Phase 7 item 2) — the
  // delay peek must see the SAME candidate set the claim path can reach,
  // or "delayed" and "claimable" could disagree past the old 50-doc window.
  const queuedScan = await scanStatusDocs(fb, 'queued', (doc) => {
    const data = doc.data();
    if (Number(data.attempts || 0) >= MAX_ATTEMPTS) return false;
    const next = jobNextAttemptMs(data);
    consider(Number.isFinite(next) ? Math.max(next, nowMs) : nowMs);
    return true;
  });
  const renderingScan = await scanStatusDocs(fb, 'rendering', (doc) => {
    const data = doc.data();
    if (Number(data.attempts || 0) >= MAX_ATTEMPTS) return false;
    if (!isLeaseActive(data, nowMs)) { consider(nowMs); return true; }
    const leaseEnd = Date.parse(data.workerLease?.leaseExpiresAt || '');
    consider(Number.isFinite(leaseEnd) ? Math.max(leaseEnd, nowMs) : nowMs);
    return true;
  });

  // A BOUNDED scan means unseen docs exist — "empty" cannot be confirmed
  // (Codex Phase 7 review, P1). Report a short retry so the dispatcher
  // comes back; each retry advances the persisted round-robin cursor, so
  // an eligible doc past any head of permanently-ineligible ones is
  // reached in at most ceil(total/MAX_QUEUE_SCAN_DOCS) calls.
  if ((queuedScan.bounded || renderingScan.bounded)) {
    consider(nowMs + 30_000);
  }

  if (earliestMs === null) return null;
  return {
    retryAtMs: earliestMs,
    retryAt: new Date(earliestMs).toISOString(),
    ...(queuedScan.bounded || renderingScan.bounded ? { scanBounded: true } : {}),
  };
}

/**
 * Claim the oldest runnable queued job if the singleton Proof-render lease
 * is open — verbatim mechanics from studio-render-jobs.cjs's own
 * claimNextRenderJob: candidates are due `queued` jobs PLUS orphaned
 * `rendering` jobs whose lease has expired (stale-lease recovery, so a
 * killed worker never permanently freezes the queue); claim itself happens
 * inside one transaction that re-checks the singleton lock, the target
 * job's own claimability, and that no OTHER job is actively leased, so two
 * concurrent claim calls resolve to exactly one winner. Every claim
 * (including a reclaim of the SAME jobId) mints a brand new `claimToken`.
 */
// ── Paged queue scanning (Phase 7 item 2 — the pre-production hardening
// note both Codex reviews tracked: a flat `.limit(50)` meant candidate
// selection and delay detection went blind past ~50 simultaneously-pending
// docs). Pages through an equality-only status query with a raw
// DocumentSnapshot `startAfter` cursor and NO explicit orderBy — exactly
// the no-new-composite-index shape listDoneJobsWithArtifacts (P2-1)
// established; Firestore's implicit __name__ order makes the cursor stable.
// Bounded by MAX_QUEUE_SCAN_DOCS per status per call (a backstop far above
// any real single-tenant backlog — and LOGGED when hit, never a silent
// cap), pages sized to the old flat limit so the common small-queue case
// still costs exactly one read per status. ────────────────────────────────
const QUEUE_SCAN_PAGE_SIZE = 50;
const MAX_QUEUE_SCAN_DOCS = 500;
// Persisted round-robin scan cursor (Codex Phase 7 review, P1: "later docs
// surface as earlier ones drain" is FALSE for a head of permanently-
// ineligible docs — ≥MAX_QUEUE_SCAN_DOCS exhausted records would hide an
// eligible job behind them forever if every call restarted at the
// beginning). When a scan hits its bound, the position is persisted here
// and the NEXT call resumes AFTER it (wrapping to the beginning once the
// end is reached), so successive calls are guaranteed to reach every doc
// regardless of how many permanently-ineligible ones sit ahead of it.
// Combined with peekProofRenderQueueDelay treating a bounded scan as
// RETRYABLE (never a confirmed-empty), the dispatcher's own retries drive
// the cursor forward until the eligible doc is found.
const SCAN_CURSOR_DOC = 'proof-render-scan-cursor';

/**
 * Paged status scan with round-robin resume AND cross-call sweep
 * accounting. `visit(doc)` must return whether the doc is RELEVANT (could
 * EVER become claimable — attempts < MAX_ATTEMPTS), which is what lets a
 * completed clean sweep CERTIFY emptiness.
 *
 * Exact-boundary liveness (Codex Phase 7 follow-up, P1): hitting the cap at
 * exactly `scanned === MAX_QUEUE_SCAN_DOCS` proves nothing by itself — a
 * status holding exactly 500 (or any multiple) permanently-ineligible docs
 * would otherwise read "bounded" forever, /run would 409 forever, and the
 * Cloud Task would never complete. Two mechanisms close it:
 *   1. LOOKAHEAD: at the cap, one extra 1-doc probe after the last visited
 *      doc distinguishes "more remain" from "that was the final document".
 *   2. SWEEP ACCOUNTING: the cursor doc records where the current sweep
 *      (one full rotation) began and whether ANY relevant doc has been
 *      seen since. When a later call's coverage reaches back around to the
 *      sweep start — or a head-probe shows the head IS the sweep start —
 *      the union of the sweep's calls has covered every doc: a CLEAN sweep
 *      (zero relevant docs) certifies the queue genuinely empty
 *      (bounded:false with no candidates), ending the retry loop. A sweep
 *      that did see relevant docs just resets — those docs were acted on
 *      by whichever call visited them.
 */
async function scanStatusDocs(fb, status, visit) {
  const cursorRef = fb.adminDb.collection(LOCK_COLLECTION).doc(SCAN_CURSOR_DOC);
  const cursorSnap = await cursorRef.get();
  const state = (cursorSnap.exists && cursorSnap.data()[status]) || {};
  const resumeAfterId = state.cursor || null;
  const sweepStartId = state.sweepStartId || null;
  const priorSweepRelevant = Boolean(state.sweepRelevant);

  let cursor = null;
  if (resumeAfterId) {
    const resumeSnap = await fb.adminDb.collection(COLLECTION).doc(resumeAfterId).get();
    if (resumeSnap.exists) cursor = resumeSnap; // vanished cursor doc → start from the beginning
  }
  const startedAtHead = !cursor;

  const pageQuery = (after) => {
    let q = fb.adminDb.collection(COLLECTION).where('status', '==', status).limit(QUEUE_SCAN_PAGE_SIZE);
    if (after) q = q.startAfter(after);
    return q.get();
  };

  const seenIds = new Set();
  let scanned = 0;
  let lastDoc = null;
  let wrapped = startedAtHead;
  let firstVisitedId = null;
  let thisCallRelevant = false;
  let fullCoverage = false;     // THIS call saw every matching doc
  let sweepBoundaryMet = false; // coverage reached back around to the sweep's own start
  let capHit = false;

  while (scanned < MAX_QUEUE_SCAN_DOCS) {
    // eslint-disable-next-line no-await-in-loop -- sequential cursor pagination by construction
    const snap = await pageQuery(cursor);
    let stop = false;
    for (const doc of snap.docs) {
      if (seenIds.has(doc.id)) { fullCoverage = true; stop = true; break; } // wrap met our own tail
      if (!startedAtHead && sweepStartId && doc.id === sweepStartId) sweepBoundaryMet = true;
      seenIds.add(doc.id);
      if (!firstVisitedId) firstVisitedId = doc.id;
      if (visit(doc)) thisCallRelevant = true;
      scanned += 1;
      lastDoc = doc;
      if (scanned >= MAX_QUEUE_SCAN_DOCS) { capHit = true; stop = true; break; }
    }
    if (stop) break;
    if (snap.docs.length < QUEUE_SCAN_PAGE_SIZE) {
      // Natural end. Wrap once if we started mid-collection; else complete.
      if (!wrapped) { wrapped = true; cursor = null; continue; }
      fullCoverage = true;
      break;
    }
    cursor = snap.docs[snap.docs.length - 1];
  }

  if (capHit && !fullCoverage) {
    // LOOKAHEAD (mechanism 1): was that genuinely the final document?
    const probe = await fb.adminDb.collection(COLLECTION).where('status', '==', status).limit(1).startAfter(lastDoc).get();
    const probeDoc = probe.docs.find((d) => !seenIds.has(d.id)) || null;
    if (!probeDoc) {
      if (wrapped) {
        fullCoverage = true; // started at (or wrapped to) the head and consumed everything up to the true end
      } else {
        // Resumed mid-collection and hit the true end exactly at the cap —
        // the unseen region is the head. One head-probe closes the sweep
        // question without spending another page budget.
        const head = await fb.adminDb.collection(COLLECTION).where('status', '==', status).limit(1).get();
        const headDoc = head.docs[0] || null;
        if (!headDoc) fullCoverage = true; // nothing at the head at all
        else if (seenIds.has(headDoc.id)) fullCoverage = true;
        else if (sweepStartId && headDoc.id === sweepStartId) sweepBoundaryMet = true;
      }
    }
  }

  const sweepComplete = fullCoverage || sweepBoundaryMet;
  const sweepRelevant = priorSweepRelevant || thisCallRelevant;
  // bounded=false (empty is certifiable / nothing unseen matters) when:
  //   - fullCoverage: THIS call saw every matching doc — every candidate
  //     was visited right here; or
  //   - a completed sweep saw ZERO relevant docs across all its calls —
  //     nothing exists that could ever become claimable.
  // A completed sweep that DID see relevant docs cannot certify (an
  // earlier call's candidate may sit outside this call's window) — it
  // stays bounded and the sweep resets, so rotation keeps making progress.
  const certifiedNoRelevant = sweepComplete && !sweepRelevant;
  const bounded = !fullCoverage && !certifiedNoRelevant;

  // Persist sweep state. Three cases:
  //   - fullCoverage / certified-empty → reset everything (fresh start).
  //   - sweep complete but it SAW relevant docs → reset the sweep
  //     ACCOUNTING but KEEP the rotation position (cursor = last visited):
  //     resetting to the head here would bounce every follow-up call back
  //     over the same ineligible head and starve a candidate living just
  //     past the window — the exact livelock class this P1 closes.
  //   - still mid-sweep → carry both forward.
  const nextState = (fullCoverage || certifiedNoRelevant)
    ? { cursor: null, sweepStartId: null, sweepRelevant: false }
    : sweepComplete
      ? { cursor: lastDoc ? lastDoc.id : null, sweepStartId: null, sweepRelevant: false }
      : { cursor: lastDoc ? lastDoc.id : resumeAfterId, sweepStartId: sweepStartId || firstVisitedId || null, sweepRelevant };
  const stateChanged = JSON.stringify(nextState) !== JSON.stringify({ cursor: resumeAfterId, sweepStartId, sweepRelevant: priorSweepRelevant });
  if (stateChanged) {
    await cursorRef.set({ [status]: nextState, updatedAt: new Date().toISOString() }, { merge: true });
  }
  if (bounded) {
    console.warn(`[proof-render-jobs] queue scan for status '${status}' hit its ${MAX_QUEUE_SCAN_DOCS}-doc window — resuming after ${nextState.cursor} next call (round-robin sweep); a bounded scan is reported RETRYABLE, and a completed clean sweep certifies genuine emptiness.`);
  }
  return { scanned, bounded };
}

async function claimNextProofRenderJob({ workerId = null } = {}) {
  const fb = ctx();
  const nowMs = Date.now();

  const queuedRunnable = [];
  const orphaned = [];
  // Visitors return RELEVANCE (attempts < MAX_ATTEMPTS — could this doc
  // EVER become claimable), which feeds the scan's sweep accounting; a
  // completed sweep with zero relevant docs certifies genuine emptiness.
  await scanStatusDocs(fb, 'queued', (doc) => {
    const data = doc.data();
    const attempts = Number(data.attempts || 0);
    if (attempts >= MAX_ATTEMPTS) return false;
    const next = jobNextAttemptMs(data);
    if (!Number.isFinite(next) || next <= nowMs) queuedRunnable.push({ ref: doc.ref, id: doc.id, data });
    return true;
  });
  await scanStatusDocs(fb, 'rendering', (doc) => {
    const data = doc.data();
    if (Number(data.attempts || 0) >= MAX_ATTEMPTS) return false;
    if (!isLeaseActive(data, nowMs)) orphaned.push({ ref: doc.ref, id: doc.id, data });
    return true;
  });

  const runnable = [...queuedRunnable, ...orphaned]
    .sort((a, b) => String(a.data.createdAt || '').localeCompare(String(b.data.createdAt || '')));

  if (!runnable.length) return null;

  const selected = runnable[0];
  const lease = {
    workerId: workerId || `proof-worker-${nowMs}`,
    claimToken: randomUUID(),
    leasedAt: new Date(nowMs).toISOString(),
    leaseExpiresAt: new Date(nowMs + LEASE_TIMEOUT_MS).toISOString(),
  };

  let claimed = null;
  await fb.adminDb.runTransaction(async (tx) => {
    const lref = lockRef();
    const [jobSnap, lockSnap, renderingSnap] = await Promise.all([
      tx.get(selected.ref),
      tx.get(lref),
      tx.get(fb.adminDb.collection(COLLECTION).where('status', '==', 'rendering').limit(20)),
    ]);
    if (lockSnap.exists && isQueueLeaseActive(lockSnap.data(), nowMs)) return;
    if (!jobSnap.exists) return;
    if (renderingSnap.docs.some((doc) => doc.id !== selected.id && isLeaseActive(doc.data(), nowMs))) return;

    const job = jobSnap.data();
    const claimable = job.status === 'queued' || (job.status === 'rendering' && !isLeaseActive(job, nowMs));
    if (!claimable) return;
    const attempts = Number(job.attempts || 0);
    if (attempts >= MAX_ATTEMPTS) return;
    if (job.status === 'queued') {
      const next = jobNextAttemptMs(job);
      if (Number.isFinite(next) && next > nowMs) return;
    }

    tx.set(selected.ref, {
      status: 'rendering', attempts: fb.FieldValue.increment(1), workerLease: lease,
      startedAt: job.startedAt || lease.leasedAt, updatedAt: lease.leasedAt, error: null,
    }, { merge: true });
    tx.set(lref, {
      jobId: selected.id, workerId: lease.workerId, claimToken: lease.claimToken, leasedAt: lease.leasedAt,
      leaseExpiresAt: lease.leaseExpiresAt, updatedAt: lease.leasedAt,
    }, { merge: true });
    claimed = { ...job, jobId: selected.id, status: 'rendering', attempts: attempts + 1, workerLease: lease };
  });

  return claimed;
}

/**
 * Renews an active claim's lease (heartbeat), extending `leaseExpiresAt`
 * without changing `claimToken` — for renders that can run longer than a
 * single LEASE_TIMEOUT_MS window. Fenced exactly like every other
 * transition: throws if the job isn't currently 'rendering' under THIS
 * claimToken (a lease that's already been reclaimed by someone else can't
 * be renewed by the worker that lost it).
 */
async function renewProofRenderLease(jobId, claimToken, { leaseTimeoutMs = LEASE_TIMEOUT_MS } = {}) {
  if (!jobId) throw httpError('jobId is required.', 400);
  if (!claimToken) throw httpError('claimToken is required.', 400);
  const fb = ctx();
  const ref = fb.adminDb.collection(COLLECTION).doc(jobId);
  const lref = lockRef();
  let renewed = null;
  await fb.adminDb.runTransaction(async (tx) => {
    const [jobSnap, lockSnap] = await Promise.all([tx.get(ref), tx.get(lref)]);
    if (!jobSnap.exists) throw httpError('Job not found.', 404);
    const job = jobSnap.data();
    if (job.status !== 'rendering' || job.workerLease?.claimToken !== claimToken) {
      throw httpError('Stale claim: cannot renew a lease this worker no longer holds.', 409);
    }
    const nowMs = Date.now();
    const leaseExpiresAt = new Date(nowMs + leaseTimeoutMs).toISOString();
    const nowIso = new Date(nowMs).toISOString();
    tx.set(ref, { workerLease: { ...job.workerLease, leaseExpiresAt }, updatedAt: nowIso }, { merge: true });
    if (lockSnap.exists && lockSnap.data()?.claimToken === claimToken) {
      tx.set(lref, { leaseExpiresAt, updatedAt: nowIso }, { merge: true });
    }
    renewed = { jobId, claimToken, leaseExpiresAt };
  });
  return renewed;
}

/**
 * Complete a job. `output` must already be the SANITIZED ffprobe metadata
 * object (width/height/fps/codec/frameCount/duration) — this function has
 * no concept of a local filesystem path and never stores one.
 *
 * Fenced: requires the job to be 'rendering' under THIS claimToken. A
 * stale worker (lease reclaimed by someone else) cannot complete a job it
 * no longer owns — the transaction throws instead. Idempotent for the SAME
 * claim only: a repeat call with the identical claimToken after the job is
 * ALREADY 'done' (via `lastClaimToken`, which persists even after
 * `workerLease` is cleared) is a harmless no-op — BUT only when the
 * repeated `output` is identical to what's already stored. A repeat call
 * from the same claim carrying DIFFERENT output metadata is a conflict
 * (something's genuinely wrong — the same claim reporting two different
 * results), rejected with 409 rather than silently accepted (Codex
 * re-review round 3). The job-status transition itself is never swallowed
 * on failure — a caller can trust a resolved promise means the completion
 * is durably stored.
 */
/**
 * `artifact`, when supplied (Slice 4f Phase B), is `{mp4StoragePath,
 * posterStoragePath, expiresAt, retentionDays}` from
 * `api/_lib/proof-render-artifacts.cjs`'s `uploadProofArtifacts` — cloud
 * Storage object paths only, NEVER a local filesystem path (that invariant,
 * already enforced for `output`, now extends to `artifact` too). Optional
 * and defaults to `null` so every existing call site/test that only ever
 * passed three arguments keeps working unchanged.
 */
async function completeProofRenderJob(jobId, claimToken, output, artifact = null) {
  if (!jobId) throw httpError('jobId is required.', 400);
  if (!claimToken) throw httpError('claimToken is required.', 400);
  const fb = ctx();
  const ref = fb.adminDb.collection(COLLECTION).doc(jobId);
  await fb.adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw httpError('Job not found.', 404);
    const job = snap.data();
    const isActiveClaim = job.status === 'rendering' && job.workerLease?.claimToken === claimToken;
    const isRepeatOfOwnCompletion = job.status === 'done' && job.lastClaimToken === claimToken;
    if (!isActiveClaim && !isRepeatOfOwnCompletion) {
      throw httpError('Stale claim: this worker no longer holds the active lease for this job.', 409);
    }
    if (isRepeatOfOwnCompletion) {
      const storedJson = JSON.stringify({ output: job.output ?? null, artifact: job.artifact ?? null });
      const newJson = JSON.stringify({ output: output ?? null, artifact: artifact ?? null });
      if (storedJson !== newJson) {
        throw httpError('Conflicting completion: this claim already completed with different output/artifact data.', 409);
      }
      return; // genuinely identical repeat — no-op
    }
    const now = new Date().toISOString();
    tx.set(ref, {
      status: 'done', output: output || null, artifact: artifact || null, error: null, workerLease: null,
      lastClaimToken: claimToken, completedAt: now, updatedAt: now,
    }, { merge: true });
  });
  await clearQueueLease(jobId, claimToken);
}

/**
 * Mark a job as a terminal failure with a sanitized message. Fenced like
 * completeProofRenderJob (including the same same-claim idempotent-repeat
 * allowance for `failed`).
 */
async function failProofRenderJob(jobId, claimToken, error) {
  if (!jobId) throw httpError('jobId is required.', 400);
  if (!claimToken) throw httpError('claimToken is required.', 400);
  const fb = ctx();
  const ref = fb.adminDb.collection(COLLECTION).doc(jobId);
  await fb.adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw httpError('Job not found.', 404);
    const job = snap.data();
    const isActiveClaim = job.status === 'rendering' && job.workerLease?.claimToken === claimToken;
    const isRepeatOfOwnFailure = job.status === 'failed' && job.lastClaimToken === claimToken;
    if (!isActiveClaim && !isRepeatOfOwnFailure) {
      throw httpError('Stale claim: this worker no longer holds the active lease for this job.', 409);
    }
    if (isRepeatOfOwnFailure) return;
    const now = new Date().toISOString();
    tx.set(ref, {
      status: 'failed',
      error: String(error?.message || error || 'Proof render failed.').slice(0, 500),
      workerLease: null, lastClaimToken: claimToken, completedAt: now, updatedAt: now,
    }, { merge: true });
  });
  await clearQueueLease(jobId, claimToken);
}

/**
 * Requeue a claimed job for retry with exponential backoff, or transition it
 * to the terminal 'failed' state once MAX_ATTEMPTS is exhausted — the same
 * backoff ladder as studio-render-jobs.cjs's own requeueRenderJob, now
 * fenced: requires the job to be 'rendering' under THIS claimToken, so a
 * stale worker's own failure-handling code can never requeue (or corrupt)
 * a job a newer claim already owns.
 */
async function requeueProofRenderJob(jobId, claimToken, error = null) {
  if (!jobId) throw httpError('jobId is required.', 400);
  if (!claimToken) throw httpError('claimToken is required.', 400);
  const fb = ctx();
  const ref = fb.adminDb.collection(COLLECTION).doc(jobId);

  let outcome = null;
  await fb.adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw httpError('Job not found.', 404);
    const job = snap.data();
    if (job.status !== 'rendering' || job.workerLease?.claimToken !== claimToken) {
      throw httpError('Stale claim: this worker no longer holds the active lease for this job.', 409);
    }
    const attempts = Number(job.attempts || 0);
    const now = new Date();
    if (attempts >= MAX_ATTEMPTS) {
      tx.set(ref, {
        status: 'failed',
        error: String(error?.message || error || 'Proof render failed after retry budget was exhausted.').slice(0, 500),
        workerLease: null, lastClaimToken: claimToken, completedAt: now.toISOString(), updatedAt: now.toISOString(),
      }, { merge: true });
      outcome = { requeued: false, exhausted: true, nextAttemptAt: null };
      return;
    }
    const nextAt = new Date(now.getTime() + nextBackoffMs(attempts));
    tx.set(ref, {
      status: 'queued',
      error: String(error?.message || error || 'Proof render will retry.').slice(0, 500),
      workerLease: null, nextAttemptAt: nextAt.toISOString(), nextAttemptAtTs: nextAt,
      completedAt: null, updatedAt: now.toISOString(),
    }, { merge: true });
    outcome = { requeued: true, exhausted: false, nextAttemptAt: nextAt.toISOString() };
  });
  await clearQueueLease(jobId, claimToken);
  return outcome;
}

/** Fetch a single job, scoped to its owning client. Returns null if missing/foreign — never leaks whether a foreign job exists. */
async function getProofRenderJob(jobId, { clientId } = {}) {
  if (!jobId) return null;
  const fb = ctx();
  const snap = await fb.adminDb.collection(COLLECTION).doc(jobId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (clientId && data.clientId !== clientId) return null;
  return data;
}

// Per-page Firestore round-trip size for listDoneJobsWithArtifacts' own
// internal pagination (P2-1 fix, below) — deliberately the same 50 the
// function's own `limit` default used to mean before the fix, now just the
// page size of ONE round-trip rather than the whole result.
const LIST_DONE_WITH_ARTIFACTS_PAGE_SIZE = 50;
// The "the scan itself cannot run unbounded" ceiling (P2-1) — a generous
// cap on TOTAL 'done' docs examined across every page of ONE call,
// independent of how many of them turn out to have an artifact. Sized well
// above any realistic per-sweep volume at this app's scale so it almost
// never actually binds; it exists purely so a pathological backlog of
// already-cleared ('done', artifact:null forever) jobs can't turn one call
// into an unbounded full-collection read.
const MAX_LIST_DONE_WITH_ARTIFACTS_SCANNED = 500;

/**
 * Bounded, un-indexed candidate list for the retention sweep (Phase 2,
 * STUDIO-DETERMINISTIC-FINAL-RENDER-SONNET-HANDOFF.md) — a single-field
 * `status=='done'` query (same "no composite index" discipline every other
 * query in this file already follows, e.g. claimNextProofRenderJob's own
 * `status=='queued'`), filtered to jobs that actually still have an artifact
 * IN MEMORY rather than via a second Firestore filter on a nested field
 * (`artifact.expiresAt`), which would need a composite index. The caller
 * (api/_lib/proof-render-retention.cjs) does the actual expiresAt<=now
 * comparison.
 *
 * ── P2-1 fix (pagination, "retention scanning can permanently starve older
 * artifacts") ────────────────────────────────────────────────────────────
 * This used to be a single `.limit(limit).get()` call, filtered to
 * artifact-having jobs AFTER truncation — so a `limit`-sized page that
 * happened to be full of already-cleared ('done', artifact:null forever
 * once correctly swept once) jobs silently returned FEWER than `limit`
 * candidates, or zero, while jobs further into the collection that still
 * genuinely have an artifact were never even READ, let alone considered.
 * Worse: since the query has no persisted cursor between separate calls,
 * every subsequent sweep re-ran the EXACT SAME query and got the EXACT
 * SAME first page — those later jobs could be starved indefinitely, not
 * just delayed.
 *
 * Fixed by walking FORWARD through the collection across multiple
 * `LIST_DONE_WITH_ARTIFACTS_PAGE_SIZE`-sized pages within this ONE call,
 * via a `startAfter` DocumentSnapshot cursor, until it has collected
 * `limit` artifact-having candidates, run out of matching docs, or hit
 * `maxScanned` (the unbounded-scan guard). Deliberately NOT an explicit
 * `.orderBy()` — that would turn this into an equality-filter-plus-
 * different-field-orderBy compound query, which (per this project's own
 * firestore.indexes.json, which already declares exactly that shape for
 * OTHER collections, e.g. media_jobs/render_jobs' clientId+createdAtTs)
 * needs a composite index that does not exist for `proof_render_jobs`.
 * `startAfter` with a raw DocumentSnapshot cursor and no explicit orderBy()
 * uses Firestore's own default implicit order (by document ID/`__name__`,
 * ascending) — stable and deterministic across calls, and backed only by
 * the automatic single-field index `status` already has, so this needs NO
 * new index. (If a human wants explicit creation-order pagination instead
 * of default document-ID order, that requires adding a composite index to
 * firestore.indexes.json and deploying it — not done here.)
 */
async function listDoneJobsWithArtifacts({
  limit = 50, maxScanned = MAX_LIST_DONE_WITH_ARTIFACTS_SCANNED, pageSize = LIST_DONE_WITH_ARTIFACTS_PAGE_SIZE,
} = {}) {
  const fb = ctx();
  const collection = fb.adminDb.collection(COLLECTION);
  const candidates = [];
  let scanned = 0;
  let cursor = null;

  while (candidates.length < limit && scanned < maxScanned) {
    const thisPageSize = Math.min(pageSize, maxScanned - scanned);
    let query = collection.where('status', '==', 'done').limit(thisPageSize);
    if (cursor) query = query.startAfter(cursor);
    // eslint-disable-next-line no-await-in-loop -- deliberately sequential cursor-following (each page depends on the previous page's last doc), not fan-out
    const snap = await query.get();
    if (!snap.docs.length) break; // collection exhausted — nothing left to scan
    scanned += snap.docs.length;
    for (const doc of snap.docs) {
      const data = doc.data();
      if (data.artifact) {
        candidates.push(data);
        if (candidates.length >= limit) break; // never collect more than the caller asked for, even mid-page
      }
    }
    cursor = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < thisPageSize) break; // short page — collection exhausted
  }

  return candidates;
}

/**
 * Clears `artifact` on a job whose Storage objects the retention sweep just
 * deleted — transactionally guarded against `expectedArtifact` (a deep-equal
 * check, not just existence) so a job that was somehow re-completed with a
 * DIFFERENT artifact between the sweep's list and delete steps is never
 * clobbered; the caller has already deleted `expectedArtifact`'s own Storage
 * objects by the time this is called, so a mismatch here means "someone
 * else's newer artifact is now live — leave it alone" (returns `false`,
 * not an error — the sweep is expected to just skip and move on). Not
 * claim-token fenced (unlike every worker-facing mutation above) — this is
 * an out-of-band retention action, not a render-lifecycle transition; a
 * 'done' job has no active claim to fence against.
 */
async function clearExpiredProofRenderArtifact(jobId, expectedArtifact) {
  if (!jobId) throw httpError('jobId is required.', 400);
  const fb = ctx();
  const ref = fb.adminDb.collection(COLLECTION).doc(jobId);
  let cleared = false;
  await fb.adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const job = snap.data();
    if (JSON.stringify(job.artifact || null) !== JSON.stringify(expectedArtifact || null)) return;
    tx.set(ref, { artifact: null, updatedAt: new Date().toISOString() }, { merge: true });
    cleared = true;
  });
  return cleared;
}

/** List recent jobs for a client, newest first — always clientId-scoped, never cross-tenant. */
async function listProofRenderJobs(clientId, limit = 20) {
  if (!clientId) return [];
  const fb = ctx();
  const snap = await fb.adminDb
    .collection(COLLECTION)
    .where('clientId', '==', clientId)
    .orderBy('createdAtTs', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((doc) => doc.data());
}

/**
 * Client-facing projection — an explicit allowlist (never a blocklist) so a
 * future field added to the job document doesn't silently leak until
 * someone remembers to exclude it. Omits `workerLease` (internal worker
 * identity + claimToken), `recipeHash`/`lastClaimToken` (internal
 * dedupe/fencing keys), and the Firestore-Timestamp scheduling fields
 * (`createdAtTs`/`nextAttemptAtTs`/`nextAttemptAt`) — none of these are
 * local filesystem paths, but they're internal queue mechanics, not
 * client-relevant data. `output` is passed through as-is because it is
 * ALREADY guaranteed path-free by construction (see completeProofRenderJob).
 *
 * `artifact` (Slice 4f Phase B) is deliberately projected as `hasArtifact`/
 * `expiresAt` only — the stored `mp4StoragePath`/`posterStoragePath` are
 * cloud Storage object paths, never exposed directly (same discipline
 * `api/_lib/studio-glb-assets.cjs` already established: mint a FRESH signed
 * read URL at request time instead of ever persisting or forwarding a raw
 * path or an expiry-sensitive URL). The route layer calls
 * `proof-render-artifacts.cjs`'s `mintReadUrls` separately (an async
 * operation this synchronous projection can't perform) and attaches
 * `artifact.mp4Url`/`artifact.posterUrl` itself when `hasArtifact` is true.
 */
function toClientView(job) {
  if (!job) return null;
  return {
    jobId: job.jobId,
    clientId: job.clientId,
    ownerUid: job.ownerUid,
    status: job.status,
    renderKind: job.renderKind || 'proof',
    recipe: job.recipe,
    warnings: job.warnings,
    capabilities: job.capabilities,
    renderParams: job.renderParams,
    output: job.output,
    artifact: job.artifact ? { hasArtifact: true, expiresAt: job.artifact.expiresAt } : { hasArtifact: false },
    error: job.error,
    attempts: job.attempts,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    deduped: job.deduped || undefined,
  };
}

module.exports = {
  COLLECTION,
  LOCK_COLLECTION,
  LOCK_DOC,
  IDEMPOTENCY_COLLECTION,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  MAX_ATTEMPTS,
  MAX_QUEUE_SCAN_DOCS,
  SCAN_CURSOR_DOC,
  TOTAL_RENDER_DEADLINE_MS,
  LIST_DONE_WITH_ARTIFACTS_PAGE_SIZE,
  MAX_LIST_DONE_WITH_ARTIFACTS_SCANNED,
  createProofRenderJob,
  assertValidIdempotencyKey,
  claimNextProofRenderJob,
  isProofRenderQueueLeaseActive,
  peekProofRenderQueueDelay,
  clearQueueLease,
  renewProofRenderLease,
  completeProofRenderJob,
  failProofRenderJob,
  requeueProofRenderJob,
  getProofRenderJob,
  listProofRenderJobs,
  listDoneJobsWithArtifacts,
  clearExpiredProofRenderArtifact,
  toClientView,
  __setTestContext,
};
