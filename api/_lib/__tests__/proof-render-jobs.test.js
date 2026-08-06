// proof-render-jobs.test.js — Slice 4d. Pure, dependency-injected tests
// against the in-memory fake Firestore (fake-firestore.cjs) — no live
// project, no Playwright, no ffmpeg/ffprobe required. Same pattern as
// studio-templates.test.js/media-jobs.test.js.
//
// Route-level concerns (rejecting a request with no Authorization header)
// are NOT re-tested here — verifyRequestUser (api/_lib/auth.cjs) is an
// existing, unmodified function every other authenticated route in this
// repo already relies on untested-at-the-route-layer (no app/api/**/
// route.js in this repo has its own direct test file — confirmed by
// studio-templates.test.js's own header comment, still true here).
//
// What IS tested here: every invariant createProofRenderJob/claim/renew/
// complete/fail/requeue/get/list actually enforce themselves (ownership,
// client isolation, capability rejection, atomic idempotency, claim-token
// fencing, lease/backoff mechanics) — the same "downstream of a
// successfully-verified caller" scope studio-templates.test.js draws for
// itself.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const jobs = require('../proof-render-jobs.cjs');
const { makeFakeContext } = require('./fake-firestore.cjs');

let fakeCtx;

beforeEach(() => {
  fakeCtx = makeFakeContext();
  jobs.__setTestContext(fakeCtx);
});

afterEach(() => {
  jobs.__setTestContext(null);
});

const CLIENT_A = 'client-a';
const CLIENT_B = 'client-b';
const USER_A = 'user-a1';

const SUPPORTED_CAPABILITIES = { supported: true, unsupportedFeatures: [] };
const UNSUPPORTED_CAPABILITIES = { supported: false, unsupportedFeatures: ['diffusionCamera'] };
const RECIPE = { kind: 'art-scene-v2', schemaVersion: 1, mat: { baseColor: '#7dd3fc' } };
const RENDER_PARAMS = { width: 240, height: 240, fps: 12, durationSeconds: 0.5, warmupFrames: 3 };
const SANITIZED_OUTPUT = { width: 240, height: 240, fps: 12, codec: 'h264', frameCount: 6, duration: 0.5 };

function create(overrides = {}) {
  return jobs.createProofRenderJob({
    clientId: CLIENT_A, ownerUid: USER_A, recipe: RECIPE, warnings: [],
    capabilities: SUPPORTED_CAPABILITIES, renderParams: RENDER_PARAMS, ...overrides,
  });
}

/** Expires both the job's own lease and the singleton lock so the NEXT claim treats it as an orphan. */
function expireLease(job) {
  const past = new Date(Date.now() - 1000).toISOString();
  fakeCtx.adminDb._patch(jobs.COLLECTION, job.jobId, {
    workerLease: { ...job.workerLease, leaseExpiresAt: past },
  });
  fakeCtx.adminDb._patch(jobs.LOCK_COLLECTION, jobs.LOCK_DOC, { leaseExpiresAt: past });
}

// ── Authorization / ownership invariants ────────────────────────────────────

test('createProofRenderJob requires clientId', async () => {
  await assert.rejects(() => create({ clientId: undefined }), (err) => { assert.equal(err.status, 400); return true; });
});

test('createProofRenderJob requires ownerUid', async () => {
  await assert.rejects(() => create({ ownerUid: undefined }), (err) => { assert.equal(err.status, 400); return true; });
});

test('a created job always records the server-supplied clientId/ownerUid, never anything else', async () => {
  const job = await create();
  assert.equal(job.clientId, CLIENT_A);
  assert.equal(job.ownerUid, USER_A);
});

// ── Invalid recipes ──────────────────────────────────────────────────────────

test('createProofRenderJob rejects a missing/non-object recipe', async () => {
  await assert.rejects(() => create({ recipe: null }), (err) => { assert.equal(err.status, 400); return true; });
  await assert.rejects(() => create({ recipe: 'not-an-object' }), (err) => { assert.equal(err.status, 400); return true; });
  await assert.rejects(() => create({ recipe: ['array'] }), (err) => { assert.equal(err.status, 400); return true; });
});

test('createProofRenderJob rejects a missing renderParams object', async () => {
  await assert.rejects(() => create({ renderParams: undefined }), (err) => { assert.equal(err.status, 400); return true; });
});

// ── Unsupported capabilities — never persisted ──────────────────────────────

test('createProofRenderJob rejects an unsupported recipe (capabilities.supported === false) and never persists a job for it', async () => {
  await assert.rejects(
    () => create({ capabilities: UNSUPPORTED_CAPABILITIES }),
    (err) => { assert.equal(err.status, 422); assert.match(err.message, /diffusionCamera/); return true; },
  );
  const list = await jobs.listProofRenderJobs(CLIENT_A);
  assert.equal(list.length, 0, 'a rejected create must leave zero jobs behind');
});

test('createProofRenderJob rejects when capabilities is entirely missing', async () => {
  await assert.rejects(() => create({ capabilities: undefined }), (err) => { assert.equal(err.status, 422); return true; });
});

// ── Full normalize → capability-check → create chain (route-equivalent integration) ──

test('the full route-equivalent chain (normalize → checkCapabilities → reject) never creates a job for a scene requesting an unsupported feature (fx)', async () => {
  const artRecipe = await import('../../../services/studio-render/art-recipe.mjs');
  const artValidation = await import('../../../services/studio-render/art-render-validation.mjs');
  // fx stays capability-gated (unchanged by Phase B's diffusionCamera gate
  // removal — see art-render-validation.mjs's CAPABILITY_CHECKS).
  const normalized = artRecipe.normalizeArtSceneRecipe({ kind: 'art-scene-v2', schemaVersion: 1, scene: { fx: { bloom: true } } });
  const capabilities = artValidation.checkCapabilities(normalized.recipe);
  assert.equal(capabilities.supported, false);
  assert.ok(capabilities.unsupportedFeatures.includes('fx'));
  await assert.rejects(
    () => create({ recipe: normalized.recipe, warnings: normalized.warnings, capabilities }),
    (err) => { assert.equal(err.status, 422); return true; },
  );
});

test('Phase B: the full route-equivalent chain creates a job for a scene requesting Diffusion Camera — the capability gate is gone', async () => {
  const artRecipe = await import('../../../services/studio-render/art-recipe.mjs');
  const artValidation = await import('../../../services/studio-render/art-render-validation.mjs');
  const normalized = artRecipe.normalizeArtSceneRecipe({ kind: 'art-scene-v2', schemaVersion: 1, scene: { diffusionCamera: { enabled: true }, envIntensity: 0 } });
  const capabilities = artValidation.checkCapabilities(normalized.recipe);
  assert.deepEqual(capabilities, { supported: true, unsupportedFeatures: [] });
  const job = await create({ recipe: normalized.recipe, warnings: normalized.warnings, capabilities });
  assert.equal(job.recipe.diffusionCamera.enabled, true);
});

test('the full route-equivalent chain creates a job, preserving normalization warnings, for a supported recipe with a non-built-in artwork (which itself produces a warning)', async () => {
  const artRecipe = await import('../../../services/studio-render/art-recipe.mjs');
  const artValidation = await import('../../../services/studio-render/art-render-validation.mjs');
  const normalized = artRecipe.normalizeArtSceneRecipe({ kind: 'art-scene-v2', schemaVersion: 1, scene: { artworkId: 'some-custom-upload', envIntensity: 0 } });
  const capabilities = artValidation.checkCapabilities(normalized.recipe);
  assert.equal(capabilities.supported, true);
  assert.equal(normalized.warnings.length, 1);
  assert.equal(normalized.warnings[0].field, 'artworkId');

  const job = await create({ recipe: normalized.recipe, warnings: normalized.warnings, capabilities });
  assert.equal(job.warnings.length, 1);
  assert.equal(job.warnings[0].field, 'artworkId');
  assert.deepEqual(job.capabilities, { supported: true, unsupportedFeatures: [] });
});

// ── Timeline (Phase C, "Interrupted export recovery") ──────────────────────
// The full per-keyframe recipes never reach this module — only the small,
// already-reduced/validated {totalSeconds, keyframes:[{t, scroll:{...}}]}
// shape services/studio-render/art-timeline.mjs's sanitizeArtTimeline
// produces. These tests exercise createProofRenderJob's own `timeline`
// param directly, plus route-equivalent integration through the real
// sanitize/validate boundary (same pattern the diffusionCamera/fx tests
// above already use for the scene side).

const SANITIZED_TIMELINE = { totalSeconds: 5, keyframes: [{ t: 0, scroll: { scrollPosition: 0, posY: 0 } }, { t: 1, scroll: { scrollPosition: 1, posY: 0.3 } }] };

test('createProofRenderJob persists a supplied (already-reduced) timeline verbatim on the job document', async () => {
  const job = await create({ timeline: SANITIZED_TIMELINE });
  assert.deepEqual(job.timeline, SANITIZED_TIMELINE);
});

test('createProofRenderJob defaults timeline to null when omitted — every pre-existing call site is unaffected', async () => {
  const job = await create();
  assert.equal(job.timeline, null);
});

test('idempotency: the SAME key with the SAME timeline dedupes to the existing job', async () => {
  const first = await create({ idempotencyKey: 'tl-key-1', timeline: SANITIZED_TIMELINE });
  const second = await create({ idempotencyKey: 'tl-key-1', timeline: SANITIZED_TIMELINE });
  assert.equal(second.jobId, first.jobId);
  assert.equal(second.deduped, true);
});

test('idempotency: the SAME key with a DIFFERENT timeline is a 409 conflict — never a silent stale-timeline replay', async () => {
  await create({ idempotencyKey: 'tl-key-2', timeline: SANITIZED_TIMELINE });
  const differentTimeline = { totalSeconds: 5, keyframes: [{ t: 0, scroll: { scrollPosition: 0, posY: 0 } }, { t: 1, scroll: { scrollPosition: 0.4, posY: 0.3 } }] };
  await assert.rejects(
    () => create({ idempotencyKey: 'tl-key-2', timeline: differentTimeline }),
    (err) => { assert.equal(err.status, 409); return true; },
  );
});

test('idempotency: the SAME key, same scene/renderParams, but ADDING a timeline where there was none before is also a conflict (timeline is part of the hashed payload)', async () => {
  await create({ idempotencyKey: 'tl-key-3' }); // no timeline
  await assert.rejects(
    () => create({ idempotencyKey: 'tl-key-3', timeline: SANITIZED_TIMELINE }),
    (err) => { assert.equal(err.status, 409); return true; },
  );
});

test('the full route-equivalent chain (normalize -> sanitizeArtTimeline -> checkArtTimelineCapabilities merge -> create) persists ONLY the reduced timeline — never the full keyframe recipes', async () => {
  const artRecipe = await import('../../../services/studio-render/art-recipe.mjs');
  const artValidation = await import('../../../services/studio-render/art-render-validation.mjs');
  const artTimeline = await import('../../../services/studio-render/art-timeline.mjs');

  const normalized = artRecipe.normalizeArtSceneRecipe({ kind: 'art-scene-v2', schemaVersion: 1, scene: { clothShape: 'device', envIntensity: 0 } });
  // Every OTHER field matches the base scene exactly (envIntensity:0) so
  // only the whitelisted devicePrimary.scrollPosition/posY leaves differ —
  // a keyframe recipe omitting a field would otherwise pick up its own
  // normalized DEFAULT (e.g. envIntensity:0.65), which is a genuine diff,
  // not something this test is about.
  const rawTimeline = { totalSeconds: 3, keyframes: [
    { t: 0, recipe: { clothShape: 'device', envIntensity: 0, devicePrimary: { scrollPosition: 0, posY: 0 } } },
    { t: 1, recipe: { clothShape: 'device', envIntensity: 0, devicePrimary: { scrollPosition: 1, posY: 0.2 } } },
  ] };

  const sanitizedTimeline = artTimeline.sanitizeArtTimeline(rawTimeline);
  const sceneCapabilities = artValidation.checkCapabilities(normalized.recipe);
  const timelineCapabilities = artTimeline.checkArtTimelineCapabilities(normalized.recipe, rawTimeline);
  const unsupportedFeatures = [...sceneCapabilities.unsupportedFeatures, ...timelineCapabilities.unsupportedFeatures];
  assert.deepEqual(unsupportedFeatures, [], 'a whitelist-only timeline on a supported scene must accept cleanly');

  const job = await create({ recipe: normalized.recipe, warnings: normalized.warnings, capabilities: sceneCapabilities, timeline: sanitizedTimeline });
  assert.deepEqual(job.timeline, { totalSeconds: 3, keyframes: [{ t: 0, scroll: { scrollPosition: 0, posY: 0 } }, { t: 1, scroll: { scrollPosition: 1, posY: 0.2 } }] });
  // Structural proof the reduction actually happened — no `recipe` key survives on any persisted keyframe.
  job.timeline.keyframes.forEach((kf) => assert.equal('recipe' in kf, false));
});

test('the full route-equivalent chain rejects with the MERGED unsupported list when both the scene AND the timeline carry unsupported content — never two separate round trips', async () => {
  const artRecipe = await import('../../../services/studio-render/art-recipe.mjs');
  const artValidation = await import('../../../services/studio-render/art-render-validation.mjs');
  const artTimeline = await import('../../../services/studio-render/art-timeline.mjs');

  const normalized = artRecipe.normalizeArtSceneRecipe({ kind: 'art-scene-v2', schemaVersion: 1, scene: { fx: { bloom: true } } });
  // Both keyframes carry the SAME fx.bloom:true as the base scene (fx
  // itself is not part of this phase's timeline whitelist, and isn't what
  // this test is exercising) — only the SECOND keyframe's glass.scale
  // genuinely differs from the base.
  const rawTimeline = { totalSeconds: 3, keyframes: [
    { t: 0, recipe: { fx: { bloom: true } } },
    { t: 1, recipe: { fx: { bloom: true }, glass: { scale: 2 } } },
  ] };

  const sceneCapabilities = artValidation.checkCapabilities(normalized.recipe);
  const timelineCapabilities = artTimeline.checkArtTimelineCapabilities(normalized.recipe, rawTimeline);
  const unsupportedFeatures = [...sceneCapabilities.unsupportedFeatures, ...timelineCapabilities.unsupportedFeatures];
  assert.deepEqual(unsupportedFeatures, ['fx', 'timeline-field:glass.scale'], 'both the scene-level and timeline-level rejections must appear together, in one list');

  await assert.rejects(
    () => create({ recipe: normalized.recipe, warnings: normalized.warnings, capabilities: { supported: false, unsupportedFeatures } }),
    (err) => { assert.equal(err.status, 422); assert.match(err.message, /fx/); assert.match(err.message, /timeline-field:glass\.scale/); return true; },
  );
  assert.equal((await jobs.listProofRenderJobs(CLIENT_A)).length, 0, 'a rejected create must leave zero jobs behind');
});

test('the Final Render duration contract: timelineDurationMismatch rejects a mismatched durationSeconds BEFORE a job is ever created (route-equivalent)', async () => {
  const artTimeline = await import('../../../services/studio-render/art-timeline.mjs');
  const sanitizedTimeline = artTimeline.sanitizeArtTimeline({ totalSeconds: 8, keyframes: [{ t: 0, recipe: { devicePrimary: {} } }, { t: 1, recipe: { devicePrimary: {} } }] });
  // A timeline-driven Final Render's own durationSeconds must equal totalSeconds.
  assert.equal(artTimeline.timelineDurationMismatch(sanitizedTimeline, 8), false, 'a matching duration is accepted');
  assert.equal(artTimeline.timelineDurationMismatch(sanitizedTimeline, 5), true, 'a mismatched duration must be rejected — the route never reaches createProofRenderJob in that case');
});

// ── Client isolation ─────────────────────────────────────────────────────────

test('client B cannot read client A\'s job by id — getProofRenderJob returns null, identical to a genuinely missing id', async () => {
  const job = await create();
  const readByOwner = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
  const readByStranger = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_B });
  assert.ok(readByOwner);
  assert.equal(readByStranger, null);
});

test('client B does not see client A\'s jobs in listProofRenderJobs', async () => {
  await create();
  const listedByA = await jobs.listProofRenderJobs(CLIENT_A);
  const listedByB = await jobs.listProofRenderJobs(CLIENT_B);
  assert.equal(listedByA.length, 1);
  assert.equal(listedByB.length, 0);
});

// ── Atomic enqueue idempotency (Codex re-review, P1) ────────────────────────

test('idempotencyKey: the same key + the same payload returns the EXISTING job, not a new one', async () => {
  const first = await create({ idempotencyKey: 'button-click-1' });
  const second = await create({ idempotencyKey: 'button-click-1' });
  assert.equal(second.jobId, first.jobId);
  assert.equal(second.deduped, true);
  const list = await jobs.listProofRenderJobs(CLIENT_A);
  assert.equal(list.length, 1, 'a deduped request must never create a second job');
});

test('idempotencyKey: the same key + a DIFFERENT payload is a 409 conflict, never silently overwritten or ignored', async () => {
  await create({ idempotencyKey: 'button-click-1' });
  await assert.rejects(
    () => create({ idempotencyKey: 'button-click-1', recipe: { ...RECIPE, mat: { baseColor: '#ff0000' } } }),
    (err) => { assert.equal(err.status, 409); return true; },
  );
  const list = await jobs.listProofRenderJobs(CLIENT_A);
  assert.equal(list.length, 1, 'a conflicting key must never create a second job either');
});

test('idempotencyKey: two SIMULTANEOUS creates with the same key produce exactly one job (atomic, not a query-then-create race)', async () => {
  const [a, b] = await Promise.all([
    create({ idempotencyKey: 'double-click' }),
    create({ idempotencyKey: 'double-click' }),
  ]);
  assert.equal(a.jobId, b.jobId);
  const list = await jobs.listProofRenderJobs(CLIENT_A);
  assert.equal(list.length, 1, 'a genuine race on the same key must still resolve to exactly one job');
});

test('idempotencyKey is scoped to clientId: the same key from a different client creates its own separate job', async () => {
  const a = await create({ idempotencyKey: 'shared-key' });
  const b = await jobs.createProofRenderJob({
    clientId: CLIENT_B, ownerUid: 'user-b1', recipe: RECIPE, warnings: [],
    capabilities: SUPPORTED_CAPABILITIES, renderParams: RENDER_PARAMS, idempotencyKey: 'shared-key',
  });
  assert.notEqual(a.jobId, b.jobId);
});

test('without idempotencyKey (the default), distinct explicit creates always make separate jobs', async () => {
  const first = await create();
  const second = await create();
  assert.notEqual(first.jobId, second.jobId);
  const list = await jobs.listProofRenderJobs(CLIENT_A);
  assert.equal(list.length, 2);
});

test('idempotencyKey must be a non-empty string within the length bound', async () => {
  await assert.rejects(() => create({ idempotencyKey: '' }), (err) => { assert.equal(err.status, 400); return true; });
  await assert.rejects(() => create({ idempotencyKey: 'x'.repeat(201) }), (err) => { assert.equal(err.status, 400); return true; });
});

// assertValidIdempotencyKey is the single source of truth the route uses
// directly (Codex re-review round 3, P2) to REQUIRE a key at the
// authenticated production boundary — tested here independent of
// createProofRenderJob (which only validates a key IF one is supplied).
test('assertValidIdempotencyKey rejects missing, numeric, object, empty, and oversized keys; accepts a well-formed one', () => {
  for (const bad of [undefined, null, 42, {}, [], '', '   ', 'x'.repeat(jobs.MAX_IDEMPOTENCY_KEY_LENGTH + 1)]) {
    assert.throws(
      () => jobs.assertValidIdempotencyKey(bad),
      (err) => { assert.equal(err.status, 400); return true; },
      `expected ${JSON.stringify(bad)} to be rejected`,
    );
  }
  assert.doesNotThrow(() => jobs.assertValidIdempotencyKey('a-valid-key-123'));
  assert.doesNotThrow(() => jobs.assertValidIdempotencyKey('x'.repeat(jobs.MAX_IDEMPOTENCY_KEY_LENGTH)));
});

// ── Concurrent claims ────────────────────────────────────────────────────────

test('two concurrent claim calls against ONE queued job resolve to exactly one winner', async () => {
  const job = await create();
  const [a, b] = await Promise.all([
    jobs.claimNextProofRenderJob({ workerId: 'w1' }),
    jobs.claimNextProofRenderJob({ workerId: 'w2' }),
  ]);
  const winners = [a, b].filter(Boolean);
  assert.equal(winners.length, 1, 'exactly one concurrent claim must succeed');
  assert.equal(winners[0].jobId, job.jobId);
  assert.equal(winners[0].status, 'rendering');
  assert.equal(winners[0].attempts, 1);
  assert.ok(winners[0].workerLease.claimToken, 'a claim must always mint a claimToken');
});

test('claiming when nothing is queued returns null', async () => {
  const claimed = await jobs.claimNextProofRenderJob({ workerId: 'w1' });
  assert.equal(claimed, null);
});

test('the singleton queue lease blocks a second claim while a DIFFERENT job is actively rendering', async () => {
  await create();
  await create();
  const first = await jobs.claimNextProofRenderJob({ workerId: 'w1' });
  assert.ok(first);
  const second = await jobs.claimNextProofRenderJob({ workerId: 'w2' });
  assert.equal(second, null, 'an active lease on another job must block a new claim');
});

// ── isProofRenderQueueLeaseActive (P1-B, Production lifecycle hardening) ────

test('isProofRenderQueueLeaseActive is false when nothing has ever been claimed', async () => {
  assert.equal(await jobs.isProofRenderQueueLeaseActive(), false);
});

test('isProofRenderQueueLeaseActive is true while a claim is actively held, and false again once it completes', async () => {
  const job = await create();
  assert.equal(await jobs.isProofRenderQueueLeaseActive(), false);
  const claimed = await jobs.claimNextProofRenderJob({ workerId: 'w1' });
  assert.equal(await jobs.isProofRenderQueueLeaseActive(), true);
  await jobs.completeProofRenderJob(job.jobId, claimed.workerLease.claimToken, SANITIZED_OUTPUT);
  assert.equal(await jobs.isProofRenderQueueLeaseActive(), false, 'clearQueueLease on completion must release the lock');
});

test('isProofRenderQueueLeaseActive is false once an active lease has expired (orphaned, not busy)', async () => {
  await create();
  const claimed = await jobs.claimNextProofRenderJob({ workerId: 'w1' });
  expireLease(claimed);
  assert.equal(await jobs.isProofRenderQueueLeaseActive(), false, 'an expired lease must read as not-busy — it is reclaimable, not stuck');
});

// ── Expired leases (stale-lease recovery) ───────────────────────────────────

test('a rendering job whose lease has expired is reclaimable (orphan recovery), and gets a BRAND NEW claimToken', async () => {
  const job = await create();
  const claimed = await jobs.claimNextProofRenderJob({ workerId: 'w1' });
  const oldToken = claimed.workerLease.claimToken;
  expireLease(claimed);
  const reclaimed = await jobs.claimNextProofRenderJob({ workerId: 'w2' });
  assert.ok(reclaimed, 'an orphaned job with an expired lease must be reclaimable');
  assert.equal(reclaimed.jobId, job.jobId);
  assert.equal(reclaimed.attempts, 2, 'a reclaim counts as another attempt');
  assert.notEqual(reclaimed.workerLease.claimToken, oldToken, 'a reclaim must mint a fresh claimToken, never reuse the old one');
});

// ── Claim-token fencing (Codex re-review, P1) ───────────────────────────────

test('a stale worker cannot COMPLETE a job after its lease has been reclaimed by a newer claim', async () => {
  const job = await create();
  const first = await jobs.claimNextProofRenderJob({ workerId: 'w1' });
  const staleToken = first.workerLease.claimToken;
  expireLease(first);
  const reclaimed = await jobs.claimNextProofRenderJob({ workerId: 'w2' });
  const currentToken = reclaimed.workerLease.claimToken;

  await assert.rejects(
    () => jobs.completeProofRenderJob(job.jobId, staleToken, SANITIZED_OUTPUT),
    (err) => { assert.equal(err.status, 409); return true; },
  );
  const current = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
  assert.equal(current.status, 'rendering', 'the stale completion attempt must never have touched the job');
  assert.equal(current.workerLease.claimToken, currentToken, 'the newer claim must remain untouched');
});

// Each of these gets its own test (not interleaved in one) because the
// singleton queue lease only ever allows ONE actively-rendering job at a
// time — a second, independent claim/expire/reclaim sequence in the SAME
// test would be legitimately blocked by the first sequence's still-active
// (just-reclaimed) lock, which is correct product behavior, not something
// to work around inside a single test.

test('a stale worker cannot FAIL a job after its lease has been reclaimed by a newer claim', async () => {
  const job = await create();
  const first = await jobs.claimNextProofRenderJob({ workerId: 'w1' });
  const staleToken = first.workerLease.claimToken;
  expireLease(first);
  await jobs.claimNextProofRenderJob({ workerId: 'w2' });
  await assert.rejects(
    () => jobs.failProofRenderJob(job.jobId, staleToken, new Error('stale failure report')),
    (err) => { assert.equal(err.status, 409); return true; },
  );
  const after = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
  assert.equal(after.status, 'rendering', 'a stale fail() must never touch the job the newer claim owns');
});

test('a stale worker cannot REQUEUE a job after its lease has been reclaimed by a newer claim', async () => {
  const job = await create();
  const first = await jobs.claimNextProofRenderJob({ workerId: 'w3' });
  const staleToken = first.workerLease.claimToken;
  expireLease(first);
  await jobs.claimNextProofRenderJob({ workerId: 'w4' });
  await assert.rejects(
    () => jobs.requeueProofRenderJob(job.jobId, staleToken, new Error('stale requeue attempt')),
    (err) => { assert.equal(err.status, 409); return true; },
  );
  const after = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
  assert.equal(after.status, 'rendering', 'a stale requeue() must never touch the job the newer claim owns');
});

test('a stale worker cannot clear the queue lock held by a newer claim — a matching jobId alone is not enough, the claimToken must match too', async () => {
  const job = await create();
  const first = await jobs.claimNextProofRenderJob({ workerId: 'w1' });
  const staleToken = first.workerLease.claimToken;
  expireLease(first);
  const reclaimed = await jobs.claimNextProofRenderJob({ workerId: 'w2' });
  const currentToken = reclaimed.workerLease.claimToken;

  await jobs.clearQueueLease(job.jobId, staleToken); // must be a no-op — same jobId, wrong token
  const lockAfterStaleAttempt = fakeCtx.adminDb._raw(jobs.LOCK_COLLECTION, jobs.LOCK_DOC);
  assert.equal(lockAfterStaleAttempt.claimToken, currentToken, 'the current claimant\'s lock must survive a stale clear attempt');

  await jobs.clearQueueLease(job.jobId, currentToken); // legitimate — must actually clear it
  const lockAfterRealClear = fakeCtx.adminDb._raw(jobs.LOCK_COLLECTION, jobs.LOCK_DOC);
  assert.equal(lockAfterRealClear.claimToken, null);
});

test('a persistence failure during completion propagates as a real rejection — the worker may never report done unless it is durably stored', async () => {
  const job = await create();
  const claimed = await jobs.claimNextProofRenderJob({ workerId: 'w1' });
  const claimToken = claimed.workerLease.claimToken;

  const realRunTransaction = fakeCtx.adminDb.runTransaction.bind(fakeCtx.adminDb);
  fakeCtx.adminDb.runTransaction = async () => { throw new Error('simulated Firestore outage'); };
  try {
    await assert.rejects(
      () => jobs.completeProofRenderJob(job.jobId, claimToken, SANITIZED_OUTPUT),
      (err) => { assert.match(err.message, /simulated Firestore outage/); return true; },
    );
  } finally {
    fakeCtx.adminDb.runTransaction = realRunTransaction;
  }

  const current = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
  assert.equal(current.status, 'rendering', 'a failed persistence attempt must never leave (or be reportable as) the job done');
});

test('completion remains idempotent for the SAME active claim: calling it twice with the identical claimToken AND identical output is a harmless no-op, not an error', async () => {
  const job = await create();
  const claimed = await jobs.claimNextProofRenderJob({ workerId: 'w1' });
  const claimToken = claimed.workerLease.claimToken;
  await jobs.completeProofRenderJob(job.jobId, claimToken, SANITIZED_OUTPUT);
  await assert.doesNotReject(() => jobs.completeProofRenderJob(job.jobId, claimToken, SANITIZED_OUTPUT));
  const done = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
  assert.equal(done.status, 'done');
  assert.deepEqual(done.output, SANITIZED_OUTPUT);
});

test('a repeated completion from the SAME claim carrying DIFFERENT output metadata is a 409 conflict, never silently accepted', async () => {
  const job = await create();
  const claimed = await jobs.claimNextProofRenderJob({ workerId: 'w1' });
  const claimToken = claimed.workerLease.claimToken;
  await jobs.completeProofRenderJob(job.jobId, claimToken, SANITIZED_OUTPUT);
  const differentOutput = { ...SANITIZED_OUTPUT, frameCount: 999 };
  await assert.rejects(
    () => jobs.completeProofRenderJob(job.jobId, claimToken, differentOutput),
    (err) => { assert.equal(err.status, 409); assert.match(err.message, /Conflicting completion/); return true; },
  );
  const stored = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
  assert.deepEqual(stored.output, SANITIZED_OUTPUT, 'the original, first-completed output must remain untouched by the conflicting attempt');
});

// ── Lease renewal / heartbeat ────────────────────────────────────────────────

test('renewProofRenderLease extends leaseExpiresAt (job + singleton lock) without changing claimToken, for an active claim', async () => {
  const job = await create();
  const claimed = await jobs.claimNextProofRenderJob({ workerId: 'w1' });
  const claimToken = claimed.workerLease.claimToken;
  // Backdate the "original" expiry well before what a fresh renewal would
  // produce (now + LEASE_TIMEOUT_MS, ~330s out) — a real claim-then-renew
  // pair is seconds to minutes apart in production, but this test runs in
  // sub-millisecond time, where Date.now() at claim and Date.now() at renew
  // can legitimately be the exact same millisecond tick. Backdating removes
  // that race without weakening what's actually being proven (renewal
  // extends the expiry into the future relative to where it was).
  const originalExpiry = new Date(Date.now() + 1000).toISOString();
  fakeCtx.adminDb._patch(jobs.COLLECTION, job.jobId, { workerLease: { ...claimed.workerLease, leaseExpiresAt: originalExpiry } });

  const renewed = await jobs.renewProofRenderLease(job.jobId, claimToken);
  assert.equal(renewed.claimToken, claimToken);
  assert.ok(Date.parse(renewed.leaseExpiresAt) > Date.parse(originalExpiry), 'the renewed lease must extend further into the future');

  const current = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
  assert.equal(current.workerLease.claimToken, claimToken, 'renewal must not mint a new token');
  assert.equal(current.workerLease.leaseExpiresAt, renewed.leaseExpiresAt);

  const lock = fakeCtx.adminDb._raw(jobs.LOCK_COLLECTION, jobs.LOCK_DOC);
  assert.equal(lock.leaseExpiresAt, renewed.leaseExpiresAt, 'the singleton lock lease must be extended in step, so it does not itself expire mid-render');
});

test('renewProofRenderLease rejects a stale claimToken exactly like every other fenced operation', async () => {
  const job = await create();
  const claimed = await jobs.claimNextProofRenderJob({ workerId: 'w1' });
  const claimToken = claimed.workerLease.claimToken;
  await jobs.completeProofRenderJob(job.jobId, claimToken, SANITIZED_OUTPUT);
  await assert.rejects(
    () => jobs.renewProofRenderLease(job.jobId, claimToken),
    (err) => { assert.equal(err.status, 409); return true; },
  );
});

// ── Retries / backoff / terminal failure ────────────────────────────────────

test('requeueProofRenderJob schedules a future retry and clears the lease', async () => {
  const job = await create();
  const claimed = await jobs.claimNextProofRenderJob({ workerId: 'w1' });
  const claimToken = claimed.workerLease.claimToken;
  const result = await jobs.requeueProofRenderJob(job.jobId, claimToken, new Error('transient render error'));
  assert.equal(result.requeued, true);
  assert.equal(result.exhausted, false);
  assert.ok(result.nextAttemptAt);

  const current = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
  assert.equal(current.status, 'queued');
  assert.equal(current.workerLease, null);
  assert.match(current.error, /transient render error/);
});

test('after MAX_ATTEMPTS, requeueProofRenderJob transitions to the terminal failed state instead of retrying again', async () => {
  // A real reclaim-after-backoff loop would need to wait out real backoff
  // delays (30s+) between attempts to get reclaimed — instead, directly
  // simulate "this job has already been attempted MAX_ATTEMPTS times" by
  // patching the fake store, then prove the boundary transition on the
  // NEXT requeue call. The "schedules a future retry" test above already
  // covers the backoff-scheduling side of this on its own.
  const job = await create();
  const claimed = await jobs.claimNextProofRenderJob({ workerId: 'w1' });
  const claimToken = claimed.workerLease.claimToken;
  fakeCtx.adminDb._patch(jobs.COLLECTION, job.jobId, { attempts: jobs.MAX_ATTEMPTS });
  const result = await jobs.requeueProofRenderJob(job.jobId, claimToken, new Error('final attempt failed'));
  assert.equal(result.exhausted, true);
  assert.equal(result.requeued, false);
  const final = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
  assert.equal(final.status, 'failed');
  assert.match(final.error, /final attempt failed/);
});

// ── Completion / failure ────────────────────────────────────────────────────

test('completeProofRenderJob sets status=done, stores the sanitized output metadata, and clears the lease', async () => {
  const job = await create();
  const claimed = await jobs.claimNextProofRenderJob({ workerId: 'w1' });
  await jobs.completeProofRenderJob(job.jobId, claimed.workerLease.claimToken, SANITIZED_OUTPUT);
  const done = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
  assert.equal(done.status, 'done');
  assert.deepEqual(done.output, SANITIZED_OUTPUT);
  assert.equal(done.workerLease, null);
});

test('failProofRenderJob sets status=failed with a sanitized error and clears the lease', async () => {
  const job = await create();
  const claimed = await jobs.claimNextProofRenderJob({ workerId: 'w1' });
  await jobs.failProofRenderJob(job.jobId, claimed.workerLease.claimToken, new Error('ffmpeg exited non-zero'));
  const failed = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /ffmpeg exited non-zero/);
  assert.equal(failed.workerLease, null);
});

// ── Output metadata persistence — never a local filesystem path ────────────

test('toClientView never exposes a local filesystem path, workerLease/claimToken identity, or the internal recipeHash/lastClaimToken', async () => {
  const job = await create();
  const claimed = await jobs.claimNextProofRenderJob({ workerId: 'w1' });
  await jobs.completeProofRenderJob(job.jobId, claimed.workerLease.claimToken, SANITIZED_OUTPUT);
  const stored = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
  const view = jobs.toClientView(stored);
  const serialized = JSON.stringify(view);
  assert.ok(!serialized.includes('/tmp/'), 'no local temp path leaked into the client view');
  assert.ok(!('workerLease' in view));
  assert.ok(!('recipeHash' in view));
  assert.ok(!('lastClaimToken' in view));
  assert.deepEqual(view.output, SANITIZED_OUTPUT);
});

// ── Artifact storage (Slice 4f Phase B) — completeProofRenderJob's optional
// 4th argument, and toClientView's projection of it ─────────────────────────

const SANITIZED_ARTIFACT = {
  mp4StoragePath: 'proof-render-artifacts/client-a/proof_123/proof.mp4',
  posterStoragePath: 'proof-render-artifacts/client-a/proof_123/poster.jpg',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  retentionDays: 7,
};

test('completeProofRenderJob stores artifact storage paths when supplied, alongside output', async () => {
  const job = await create();
  const claimed = await jobs.claimNextProofRenderJob({ workerId: 'w1' });
  await jobs.completeProofRenderJob(job.jobId, claimed.workerLease.claimToken, SANITIZED_OUTPUT, SANITIZED_ARTIFACT);
  const done = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
  assert.equal(done.status, 'done');
  assert.deepEqual(done.artifact, SANITIZED_ARTIFACT);
});

test('completeProofRenderJob omitting artifact (the default, 3-arg call — every pre-existing call site) stores artifact:null, unchanged from before this Slice', async () => {
  const job = await create();
  const claimed = await jobs.claimNextProofRenderJob({ workerId: 'w1' });
  await jobs.completeProofRenderJob(job.jobId, claimed.workerLease.claimToken, SANITIZED_OUTPUT);
  const done = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
  assert.equal(done.artifact, null);
});

test('a repeated completion from the SAME claim carrying a DIFFERENT artifact (output identical) is still a 409 conflict', async () => {
  const job = await create();
  const claimed = await jobs.claimNextProofRenderJob({ workerId: 'w1' });
  const claimToken = claimed.workerLease.claimToken;
  await jobs.completeProofRenderJob(job.jobId, claimToken, SANITIZED_OUTPUT, SANITIZED_ARTIFACT);
  const differentArtifact = { ...SANITIZED_ARTIFACT, mp4StoragePath: 'proof-render-artifacts/client-a/proof_123/OTHER.mp4' };
  await assert.rejects(
    () => jobs.completeProofRenderJob(job.jobId, claimToken, SANITIZED_OUTPUT, differentArtifact),
    (err) => { assert.equal(err.status, 409); assert.match(err.message, /Conflicting completion/); return true; },
  );
  const stored = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
  assert.deepEqual(stored.artifact, SANITIZED_ARTIFACT, 'the original artifact must remain untouched by the conflicting attempt');
});

test('a repeated completion from the SAME claim with IDENTICAL output AND identical artifact is still a harmless no-op', async () => {
  const job = await create();
  const claimed = await jobs.claimNextProofRenderJob({ workerId: 'w1' });
  const claimToken = claimed.workerLease.claimToken;
  await jobs.completeProofRenderJob(job.jobId, claimToken, SANITIZED_OUTPUT, SANITIZED_ARTIFACT);
  await assert.doesNotReject(() => jobs.completeProofRenderJob(job.jobId, claimToken, SANITIZED_OUTPUT, SANITIZED_ARTIFACT));
});

test('toClientView projects artifact as hasArtifact + expiresAt only — never the raw storage paths', async () => {
  const job = await create();
  const claimed = await jobs.claimNextProofRenderJob({ workerId: 'w1' });
  await jobs.completeProofRenderJob(job.jobId, claimed.workerLease.claimToken, SANITIZED_OUTPUT, SANITIZED_ARTIFACT);
  const stored = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
  const view = jobs.toClientView(stored);
  assert.deepEqual(view.artifact, { hasArtifact: true, expiresAt: SANITIZED_ARTIFACT.expiresAt });
  const serialized = JSON.stringify(view);
  assert.ok(!serialized.includes('mp4StoragePath'), 'the raw storage path key must never appear in the client view');
  assert.ok(!serialized.includes(SANITIZED_ARTIFACT.mp4StoragePath), 'the raw storage path value must never appear in the client view');
});

test('toClientView reports hasArtifact:false when no artifact was ever stored', async () => {
  const job = await create();
  const claimed = await jobs.claimNextProofRenderJob({ workerId: 'w1' });
  await jobs.completeProofRenderJob(job.jobId, claimed.workerLease.claimToken, SANITIZED_OUTPUT);
  const stored = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
  const view = jobs.toClientView(stored);
  assert.deepEqual(view.artifact, { hasArtifact: false });
});

// ── Retention sweep primitives (Phase 2, STUDIO-DETERMINISTIC-FINAL-RENDER-
// SONNET-HANDOFF.md) — listDoneJobsWithArtifacts/clearExpiredProofRenderArtifact
// are the two DB-access primitives api/_lib/proof-render-retention.cjs
// orchestrates; its own test file covers the sweep LOGIC (expiry comparison,
// per-job error isolation) against these already-proven primitives.

test('listDoneJobsWithArtifacts returns only done jobs that have an artifact, never a queued/rendering/failed job or a done job with none', async () => {
  const withArtifact = await create();
  const claimed1 = await jobs.claimNextProofRenderJob({ workerId: 'w1' });
  await jobs.completeProofRenderJob(withArtifact.jobId, claimed1.workerLease.claimToken, SANITIZED_OUTPUT, SANITIZED_ARTIFACT);

  const withoutArtifact = await create();
  const claimed2 = await jobs.claimNextProofRenderJob({ workerId: 'w2' });
  await jobs.completeProofRenderJob(withoutArtifact.jobId, claimed2.workerLease.claimToken, SANITIZED_OUTPUT);

  await create(); // stays queued — never claimed/completed

  const candidates = await jobs.listDoneJobsWithArtifacts({ limit: 50 });
  const ids = candidates.map((j) => j.jobId);
  assert.ok(ids.includes(withArtifact.jobId));
  assert.ok(!ids.includes(withoutArtifact.jobId));
  assert.equal(candidates.length, 1);
});

// ── P2-1 fix: pagination reproduces + closes the starvation bug ────────────
// tick() forces Date.now() to actually advance between job creations —
// createProofRenderJob's own jobId is `proof_${Date.now()}_${randomUUID
// suffix}`, so two jobs created within the SAME millisecond sort by their
// RANDOM suffix, not creation order. Same established pattern this file's
// sibling test (proof-render-artifacts.test.js's mintReadUrls test) already
// uses for the identical reason — a real, deterministic clock tick, not a
// hack specific to this test.
function tick() {
  return new Promise((resolve) => { setTimeout(resolve, 2); });
}

test('P2-1: a full page of artifact-less done jobs no longer starves a later done job that DOES have an artifact', async () => {
  // Reproduces the exact bug, not just a generic pagination check: the OLD
  // implementation ran ONE `.limit(limit).get()` call and filtered for
  // `.artifact` AFTER truncating. Here `limit` (5) exactly equals the
  // number of artifact-less jobs created first — under the OLD code, that
  // single call would return EXACTLY those 5 (all artifact-less), filter
  // to zero candidates, and never even read the 6th job at all, on this
  // call or any repeat of it (no persisted cursor). pageSize:5 makes this
  // fix's own FIRST internal page identical to what the old single-shot
  // query would have fetched — the only difference is that the fix keeps
  // paging afterward instead of stopping there.
  for (let i = 0; i < 5; i += 1) {
    const job = await create();
    const claimed = await jobs.claimNextProofRenderJob({ workerId: `w-noartifact-${i}` });
    await jobs.completeProofRenderJob(job.jobId, claimed.workerLease.claimToken, SANITIZED_OUTPUT); // no artifact — fills the first page
    await tick();
  }
  const candidateWithArtifact = await create();
  const claimedLast = await jobs.claimNextProofRenderJob({ workerId: 'w-withartifact' });
  await jobs.completeProofRenderJob(candidateWithArtifact.jobId, claimedLast.workerLease.claimToken, SANITIZED_OUTPUT, SANITIZED_ARTIFACT);

  const candidates = await jobs.listDoneJobsWithArtifacts({ limit: 5, pageSize: 5 });
  const ids = candidates.map((j) => j.jobId);
  assert.ok(ids.includes(candidateWithArtifact.jobId), 'the artifact-having job sitting past a full page of artifact-less jobs must still be reached — the OLD implementation would have returned [] here, permanently, on every repeat call');
  assert.equal(candidates.length, 1);
});

test('P2-1: maxScanned still bounds the scan even when nothing satisfying `limit` has been found yet — the scan itself cannot run unbounded', async () => {
  for (let i = 0; i < 4; i += 1) {
    const job = await create();
    const claimed = await jobs.claimNextProofRenderJob({ workerId: `w-cap-${i}` });
    await jobs.completeProofRenderJob(job.jobId, claimed.workerLease.claimToken, SANITIZED_OUTPUT); // no artifact
    await tick();
  }
  // Created LAST (latest doc ID, deterministically thanks to tick()) — sits
  // past maxScanned:4, so a properly bounded scan must never reach it, even
  // though it genuinely has an artifact and `limit` (50) is nowhere near hit.
  const beyondCap = await create();
  const claimedBeyond = await jobs.claimNextProofRenderJob({ workerId: 'w-beyond-cap' });
  await jobs.completeProofRenderJob(beyondCap.jobId, claimedBeyond.workerLease.claimToken, SANITIZED_OUTPUT, SANITIZED_ARTIFACT);

  const candidates = await jobs.listDoneJobsWithArtifacts({ limit: 50, pageSize: 2, maxScanned: 4 });
  assert.equal(candidates.length, 0, 'the artifact-having job is 5th by creation/doc-ID order — past maxScanned:4 — the bound must stop the scan before ever reaching it');
});

test('clearExpiredProofRenderArtifact clears artifact only when it deep-equals expectedArtifact, and returns whether it actually cleared', async () => {
  const job = await create();
  const claimed = await jobs.claimNextProofRenderJob({ workerId: 'w1' });
  await jobs.completeProofRenderJob(job.jobId, claimed.workerLease.claimToken, SANITIZED_OUTPUT, SANITIZED_ARTIFACT);

  const mismatch = { ...SANITIZED_ARTIFACT, mp4StoragePath: 'proof-render-artifacts/client-a/proof_123/OTHER.mp4' };
  const skipped = await jobs.clearExpiredProofRenderArtifact(job.jobId, mismatch);
  assert.equal(skipped, false, 'a mismatched expectedArtifact must never clear a still-current (different) artifact');
  const stillThere = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
  assert.deepEqual(stillThere.artifact, SANITIZED_ARTIFACT);

  const cleared = await jobs.clearExpiredProofRenderArtifact(job.jobId, SANITIZED_ARTIFACT);
  assert.equal(cleared, true);
  const gone = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
  assert.equal(gone.artifact, null);
  assert.equal(gone.status, 'done', 'clearing the artifact must never change the job status itself');
});

test('clearExpiredProofRenderArtifact on a missing job is a harmless no-op (returns false, never throws)', async () => {
  const cleared = await jobs.clearExpiredProofRenderArtifact('does-not-exist', SANITIZED_ARTIFACT);
  assert.equal(cleared, false);
});

// ── Total render/job deadline constant (Slice 4f Phase B) ──────────────────

test('TOTAL_RENDER_DEADLINE_MS is exported, positive, and comfortably under Cloud Tasks\' own 30-minute max dispatch deadline', () => {
  assert.ok(Number.isFinite(jobs.TOTAL_RENDER_DEADLINE_MS));
  assert.ok(jobs.TOTAL_RENDER_DEADLINE_MS > 0);
  // Cloud Tasks' own hard ceiling is 1800s (30 min) — proof-render-tasks.cjs
  // derives its dispatch deadline FROM this constant plus a buffer, so this
  // constant alone must already leave real headroom under that ceiling.
  assert.ok(jobs.TOTAL_RENDER_DEADLINE_MS < 1_800_000, 'must leave headroom under Cloud Tasks\' 30-minute max dispatch deadline once a buffer is added on top');
});

test('toClientView returns null for a null job (never throws)', () => {
  assert.equal(jobs.toClientView(null), null);
});

// ── renderKind (Phase 4, STUDIO-DETERMINISTIC-FINAL-RENDER-SONNET-HANDOFF.md)

test('createProofRenderJob defaults renderKind to "proof" — every pre-existing call site (no renderKind arg) is unchanged', async () => {
  const job = await create();
  assert.equal(job.renderKind, 'proof');
  const view = jobs.toClientView(job);
  assert.equal(view.renderKind, 'proof');
});

test('createProofRenderJob records renderKind:"final" when explicitly passed', async () => {
  const job = await create({ renderKind: 'final' });
  assert.equal(job.renderKind, 'final');
  const stored = await jobs.getProofRenderJob(job.jobId, { clientId: CLIENT_A });
  assert.equal(stored.renderKind, 'final');
  assert.equal(jobs.toClientView(stored).renderKind, 'final');
});

// ── peekProofRenderQueueDelay (post-P1 external-review correction: "queued
// but not runnable yet" must be distinguishable from a genuinely empty
// queue, or a backoff-requeued job's own delay window reads as "empty" →
// /run 200 → dispatcher ack → no future wake — defeating retry/backoff) ────

test('peekProofRenderQueueDelay returns null for a genuinely empty queue', async () => {
  assert.equal(await jobs.peekProofRenderQueueDelay(), null);
});

test('peekProofRenderQueueDelay returns null once every job is terminal (done/failed) — terminal work is not pending work', async () => {
  const job = await create();
  const claimed = await jobs.claimNextProofRenderJob({ workerId: 'w1' });
  await jobs.completeProofRenderJob(job.jobId, claimed.workerLease.claimToken, SANITIZED_OUTPUT);
  assert.equal(await jobs.peekProofRenderQueueDelay(), null);
});

test('peekProofRenderQueueDelay reports a backoff-delayed queued job with retryAt === its own nextAttemptAt', async () => {
  const job = await create();
  const future = new Date(Date.now() + 90_000).toISOString();
  fakeCtx.adminDb._patch(jobs.COLLECTION, job.jobId, { nextAttemptAt: future, nextAttemptAtTs: null });

  assert.equal(await jobs.claimNextProofRenderJob({ workerId: 'w1' }), null, 'test setup: the delayed job must not be claimable');
  const delay = await jobs.peekProofRenderQueueDelay();
  assert.ok(delay, 'a backoff-delayed job is PENDING work, never an empty queue');
  assert.equal(delay.retryAt, future);
  assert.equal(delay.retryAtMs, Date.parse(future));
});

test('peekProofRenderQueueDelay reports a due-now queued job (lost claim race) as retryable immediately, not empty', async () => {
  await create();
  const before = Date.now();
  const delay = await jobs.peekProofRenderQueueDelay();
  assert.ok(delay, 'a due queued job is pending work');
  assert.ok(delay.retryAtMs >= before && delay.retryAtMs <= Date.now() + 1000, 'retryAt for due work is effectively now');
});

test('peekProofRenderQueueDelay reports a rendering job under an ACTIVE lease with retryAt === its leaseExpiresAt', async () => {
  await create();
  const claimed = await jobs.claimNextProofRenderJob({ workerId: 'w1' });
  const delay = await jobs.peekProofRenderQueueDelay();
  assert.ok(delay, 'an in-flight rendering job is pending work, never an empty queue');
  assert.equal(delay.retryAt, claimed.workerLease.leaseExpiresAt);
});

test('peekProofRenderQueueDelay picks the EARLIEST claimable moment across multiple delayed jobs', async () => {
  const jobA = await create();
  const jobB = await create({ idempotencyKey: 'peek-multi-b' });
  const sooner = new Date(Date.now() + 30_000).toISOString();
  const later = new Date(Date.now() + 600_000).toISOString();
  fakeCtx.adminDb._patch(jobs.COLLECTION, jobA.jobId, { nextAttemptAt: later, nextAttemptAtTs: null });
  fakeCtx.adminDb._patch(jobs.COLLECTION, jobB.jobId, { nextAttemptAt: sooner, nextAttemptAtTs: null });

  const delay = await jobs.peekProofRenderQueueDelay();
  assert.equal(delay.retryAt, sooner);
});

test('peekProofRenderQueueDelay ignores jobs at or past MAX_ATTEMPTS — exactly like the claim filter, so delayed can never retry-loop on unclaimable work', async () => {
  const job = await create();
  const future = new Date(Date.now() + 60_000).toISOString();
  fakeCtx.adminDb._patch(jobs.COLLECTION, job.jobId, {
    attempts: jobs.MAX_ATTEMPTS, nextAttemptAt: future, nextAttemptAtTs: null,
  });
  assert.equal(await jobs.peekProofRenderQueueDelay(), null, 'an exhausted job is not pending work');
});

// ── Queue pagination past the old 50-doc window (Phase 7 item 2) ───────────

test('claimNextProofRenderJob finds a runnable job beyond the first 50-doc page — the pre-scale blindness both reviews tracked', async () => {
  const created = [];
  for (let i = 0; i < 60; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    created.push(await create({ idempotencyKey: `page-claim-${i}` }));
  }
  // Make every job on the FIRST implicit-__name__ page unrunnable (attempts
  // exhausted) so the only claimable work sits beyond it.
  const sortedIds = created.map((j) => j.jobId).sort();
  const runnableId = sortedIds[sortedIds.length - 1];
  for (const id of sortedIds) {
    if (id !== runnableId) fakeCtx.adminDb._patch(jobs.COLLECTION, id, { attempts: jobs.MAX_ATTEMPTS });
  }
  const claimed = await jobs.claimNextProofRenderJob({ workerId: 'pager' });
  assert.ok(claimed, 'the runnable job past page 1 must be found');
  assert.equal(claimed.jobId, runnableId);
});

test('peekProofRenderQueueDelay sees the earliest retryAt even when it sits beyond the first page', async () => {
  const created = [];
  for (let i = 0; i < 60; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    created.push(await create({ idempotencyKey: `page-peek-${i}` }));
  }
  const sortedIds = created.map((j) => j.jobId).sort();
  const far = new Date(Date.now() + 800_000).toISOString();
  const soon = new Date(Date.now() + 60_000).toISOString();
  for (const id of sortedIds) fakeCtx.adminDb._patch(jobs.COLLECTION, id, { nextAttemptAt: far, nextAttemptAtTs: null });
  // The EARLIEST retry lives on the lexicographically-LAST doc — invisible
  // to a flat 50-doc read.
  fakeCtx.adminDb._patch(jobs.COLLECTION, sortedIds[sortedIds.length - 1], { nextAttemptAt: soon, nextAttemptAtTs: null });

  const delay = await jobs.peekProofRenderQueueDelay();
  assert.equal(delay.retryAt, soon, 'the earliest claimable moment must come from beyond page 1');
});

// ── Bounded-scan honesty + round-robin cursor (Codex Phase 7 review, P1:
// a head of >= MAX_QUEUE_SCAN_DOCS permanently-ineligible docs must never
// hide an eligible job forever, and a bounded scan must never read as a
// confirmed-empty queue) ───────────────────────────────────────────────────

test('an eligible job behind 500+ permanently-exhausted docs: the bounded first scan reports RETRYABLE (never empty), and the cursor-advanced second call CLAIMS it', async () => {
  const total = jobs.MAX_QUEUE_SCAN_DOCS + 5;
  const created = [];
  for (let i = 0; i < total; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    created.push(await create({ idempotencyKey: `head-${i}` }));
  }
  const sortedIds = created.map((j) => j.jobId).sort();
  // The ONLY eligible job sits past the scan bound in implicit __name__
  // order; everything ahead of it is permanently exhausted (never drains).
  const eligibleId = sortedIds[sortedIds.length - 2];
  for (const id of sortedIds) {
    if (id !== eligibleId) fakeCtx.adminDb._patch(jobs.COLLECTION, id, { attempts: jobs.MAX_ATTEMPTS });
  }

  const first = await jobs.claimNextProofRenderJob({ workerId: 'bounded-1' });
  if (first === null) {
    // First scan window missed it — the peek MUST refuse to certify empty…
    const delay = await jobs.peekProofRenderQueueDelay();
    assert.ok(delay, 'a bounded scan can never yield a null (confirmed-empty) peek while unseen docs exist');
    assert.equal(delay.scanBounded, true);
    assert.ok(delay.retryAtMs <= Date.now() + 31_000, 'bounded-unknown retries soon, not after a long backoff');
    // …and the persisted round-robin cursor makes the NEXT call reach it.
    const second = await jobs.claimNextProofRenderJob({ workerId: 'bounded-2' });
    assert.ok(second, 'the cursor-advanced call must reach past the ineligible head');
    assert.equal(second.jobId, eligibleId);
  } else {
    // Random ids happened to place the eligible doc inside the first
    // window — the claim itself must have found it.
    assert.equal(first.jobId, eligibleId);
  }
});

test('after a full-coverage scan the cursor is cleared — small queues keep single-pass behavior and never resume mid-collection', async () => {
  await create({ idempotencyKey: 'small-queue' });
  const claimed = await jobs.claimNextProofRenderJob({ workerId: 'small' });
  assert.ok(claimed);
  const cursor = fakeCtx.adminDb._raw(jobs.LOCK_COLLECTION, jobs.SCAN_CURSOR_DOC);
  assert.ok(!cursor || !cursor.queued || !cursor.queued.cursor, 'no persisted resume point after an unbounded scan');
});

// ── Exact-boundary liveness (Codex Phase 7 follow-up, P1): a status
// holding exactly MAX_QUEUE_SCAN_DOCS — or any multiple — permanently-
// ineligible docs must EVENTUALLY certify genuinely empty, never 409
// forever. Lookahead probe + clean-sweep certification are the mechanisms.

async function createExhausted(count, keyPrefix) {
  const created = [];
  for (let i = 0; i < count; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    created.push(await create({ idempotencyKey: `${keyPrefix}-${i}` }));
  }
  for (const j of created) fakeCtx.adminDb._patch(jobs.COLLECTION, j.jobId, { attempts: jobs.MAX_ATTEMPTS });
  return created;
}

test('EXACTLY 500 permanently-ineligible docs: the lookahead probe proves the cap was the true end — first peek already certifies genuinely empty', async () => {
  await createExhausted(jobs.MAX_QUEUE_SCAN_DOCS, 'exact500');
  assert.equal(await jobs.claimNextProofRenderJob({ workerId: 'exact' }), null);
  const delay = await jobs.peekProofRenderQueueDelay();
  assert.equal(delay, null, 'exactly-at-the-cap with nothing beyond must be CONFIRMED empty, not bounded forever');
});

test('1000 permanently-ineligible docs: the clean-sweep certification converges to genuinely empty within a few calls — never a permanent 409 loop', async () => {
  await createExhausted(jobs.MAX_QUEUE_SCAN_DOCS * 2, 'exact1000');
  let certified = false;
  for (let call = 0; call < 4; call += 1) {
    // eslint-disable-next-line no-await-in-loop
    assert.equal(await jobs.claimNextProofRenderJob({ workerId: `sweep-${call}` }), null, 'nothing is ever claimable');
    // eslint-disable-next-line no-await-in-loop
    const delay = await jobs.peekProofRenderQueueDelay();
    if (delay === null) { certified = true; break; }
    assert.equal(delay.scanBounded, true, 'until the sweep completes, the state must be RETRYABLE (never a false empty)');
  }
  assert.ok(certified, 'the sweep must certify genuine emptiness within a bounded number of calls — the Cloud Task must be able to complete');
});

test('1000 ineligible docs hiding ONE eligible job: rotation still finds and claims it within a few calls', async () => {
  const created = await createExhausted(jobs.MAX_QUEUE_SCAN_DOCS * 2, 'hide1');
  const eligible = created[created.length - 1];
  fakeCtx.adminDb._patch(jobs.COLLECTION, eligible.jobId, { attempts: 0 });
  let claimed = null;
  for (let call = 0; call < 4 && !claimed; call += 1) {
    // eslint-disable-next-line no-await-in-loop
    claimed = await jobs.claimNextProofRenderJob({ workerId: `find-${call}` });
  }
  assert.ok(claimed, 'the eligible job must be reached by cursor rotation');
  assert.equal(claimed.jobId, eligible.jobId);
});
