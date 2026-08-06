import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { normalizeArtSceneRecipe, ArtRecipeValidationError } from '../../../../services/studio-render/art-recipe.mjs';
import { checkCapabilities, validateRenderParams, getFinalRenderPreset, finalRenderFamilyForRecipe, ArtRenderError } from '../../../../services/studio-render/art-render-validation.mjs';
import { sanitizeArtTimeline, checkArtTimelineCapabilities, timelineDurationMismatch } from '../../../../services/studio-render/art-timeline.mjs';

const require = createRequire(import.meta.url);
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');
const jobs = require('../../../../api/_lib/proof-render-jobs.cjs');
const { projectArtifactView, withSignedUrls } = require('../../../../api/_lib/proof-render-view.cjs');
const { dispatchProofRenderJob } = require('../../../../api/_lib/proof-render-dispatch.cjs');
const { startDeviceScreenStillUpload, finalizeDeviceScreenStillUpload, deviceScreenStillExists } = require('../../../../api/_lib/studio-screen-stills.cjs');
const { resolveDeviceLiveUrl } = require('../../../../api/_lib/proof-render-live-url.cjs');

// Slice 4d — the authenticated API boundary for the Proof-render job queue.
// Client-facing only: create/read/list. Claim/complete/fail/requeue are
// WORKER-side operations (services/studio-render/proof-render-worker.mjs +
// api/_lib/proof-render-jobs.cjs) never exposed here — a dashboard client
// can enqueue and check on its own Proof renders, never drive the queue
// directly. No Studio "Generate Proof" UI wiring this slice (that's 4e); no
// Cloud Run deployment; nothing here imports Playwright — this route only
// ever imports art-recipe.mjs/art-render-validation.mjs, both pure ESM with
// no Playwright/fs/child_process dependency (see art-render-validation.mjs's
// own header comment for why that extraction exists).
export const dynamic = 'force-dynamic';

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveContext(request) {
  const decoded = await verifyRequestUser(makeReqShim(request));
  const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  if (!context.userProfile) { const e = new Error('No user record.'); e.status = 404; throw e; }
  if (!context.clientId) { const e = new Error('No client context.'); e.status = 400; throw e; }
  return { decoded, context };
}

export async function GET(request) {
  let resolved;
  try {
    resolved = await resolveContext(request);
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }
  const { context } = resolved;
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  try {
    if (id) {
      // getProofRenderJob is clientId-scoped — a foreign-client id resolves
      // to null, identical to a genuinely missing one (never leaks whether
      // another tenant's job exists).
      const job = await jobs.getProofRenderJob(id, { clientId: context.clientId });
      if (!job) return json({ error: 'Job not found.' }, 404);
      const view = await withSignedUrls(projectArtifactView(job), job);
      return json({ ok: true, job: view });
    }
    const list = await jobs.listProofRenderJobs(context.clientId, 20);
    return json({ ok: true, jobs: list.map((job) => projectArtifactView(job)) });
  } catch (err) {
    return json({ error: err.message || 'Request failed.' }, err.status || 500);
  }
}

export async function POST(request) {
  let resolved;
  try {
    resolved = await resolveContext(request);
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }
  const { decoded, context } = resolved;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const action = body?.action;
  const KNOWN_ACTIONS = ['create', 'create-final', 'pin-device-screen-start', 'pin-device-screen-finalize'];
  if (!KNOWN_ACTIONS.includes(action)) {
    return json({ error: `Unknown action: ${action}` }, 400);
  }

  // ── Pin flow (Slice F2, direct-upload transport — Codex correction:
  // Vercel Functions cap request bodies at 4.5MB, so image bytes can never
  // ride this route's JSON body). 'pin-device-screen-start' mints a
  // short-lived tenant-scoped signed WRITE URL for a temp staging object;
  // the browser PUTs the bytes straight to Storage; 'pin-device-screen-
  // finalize' downloads the temp object server-side, sniffs/validates/
  // hashes the REAL bytes (claimed type never trusted), enforces per-client
  // pin-rate + stored-bytes quotas, writes the canonical content-addressed
  // still, and deletes the temp object best-effort. The returned reference
  // is what the Studio puts into devicePrimary.screenStill (clearing
  // captureUrl/uploadAssetId — those raw sources stay capability-rejected).
  if (action === 'pin-device-screen-start') {
    try {
      const grant = await startDeviceScreenStillUpload({ clientId: context.clientId, contentType: body.contentType, bytes: body.bytes });
      return json({ ok: true, ...grant }, 201);
    } catch (err) {
      return json({ error: err.message || 'Upload grant failed.' }, err.status || 500);
    }
  }
  if (action === 'pin-device-screen-finalize') {
    try {
      const still = await finalizeDeviceScreenStillUpload({ clientId: context.clientId, tempId: body.tempId });
      return json({ ok: true, screenStill: still }, 201);
    } catch (err) {
      return json({ error: err.message || 'Pin failed.' }, err.status || 500);
    }
  }

  try {
    // Live device-screen URL — SSRF-validated the SAME way
    // app/api/public/studio-device-capture/route.js already validates a
    // user-submitted URL (https-default scheme, safe-fetch.cjs's own
    // validateUrl) BEFORE it is ever normalized into a persisted recipe
    // ("Live URL wired to Final Render" wiring round, requirement 3). Runs
    // for BOTH 'create' and 'create-final' — a raw devicePrimary.liveUrl
    // reaching this route at all must be safe, regardless of which action
    // carries it. Only touches a genuine device scene that actually
    // supplied a liveUrl string; every other request is untouched. A
    // rejected URL fails the WHOLE request precisely here, with a
    // dedicated message — never silently falls through to a generic
    // capability rejection or (worse) an unvalidated fetch target reaching
    // the worker.
    if (body?.scene?.clothShape === 'device' && body.scene.devicePrimary && typeof body.scene.devicePrimary === 'object') {
      try {
        const resolvedLiveUrl = await resolveDeviceLiveUrl(body.scene.devicePrimary.liveUrl);
        if (resolvedLiveUrl !== undefined) {
          body = { ...body, scene: { ...body.scene, devicePrimary: { ...body.scene.devicePrimary, liveUrl: resolvedLiveUrl } } };
        }
      } catch (err) {
        return json({ error: err.message }, err.status || 400);
      }
    }

    let renderParams;
    if (action === 'create') {
      // Render params validated FIRST, server-side, against the same bounded
      // Proof limits (width/height/fps/durationSeconds/warmupFrames) the
      // local render pipeline itself enforces — passed through EXACTLY as
      // received, never Number()-coerced first (Codex re-review, P2: a
      // numeric STRING like "200" must be rejected exactly like a direct
      // validateRenderParams call would reject it, not silently coerced into
      // an accepted number). The only default ever applied is warmupFrames
      // when the key is genuinely OMITTED (`undefined`) — an explicit `null`
      // or a bad value still passes through unchanged and is rejected by the
      // validator on its own terms, never silently defaulted over.
      renderParams = {
        width: body.width,
        height: body.height,
        fps: body.fps,
        durationSeconds: body.durationSeconds,
        warmupFrames: body.warmupFrames === undefined ? 3 : body.warmupFrames,
      };
    } else {
      // 'create-final' (Phase 4) — the caller NEVER supplies raw width/
      // height/fps here at all; only `presetId` (one of a fixed,
      // server-owned allowlist) and `durationSeconds` (still bounded by
      // validateRenderParams below, same as every other request — "reuse
      // the Studio's selected duration where supported" doesn't mean
      // unbounded). This is the literal mechanism behind the handoff's
      // "an allowlisted, server-validated preset rather than arbitrary
      // client-controlled resource values" requirement: there is no code
      // path from an arbitrary body.width to a Final Render job's
      // width — it can only ever be one of FINAL_RENDER_PRESETS' own
      // fixed values.
      const preset = getFinalRenderPreset(body.presetId);
      if (!preset) {
        return json({ error: `Unknown or missing Final Render presetId: ${JSON.stringify(body.presetId)}.` }, 400);
      }
      renderParams = {
        width: preset.width, height: preset.height, fps: preset.fps,
        durationSeconds: body.durationSeconds,
        warmupFrames: body.warmupFrames === undefined ? 3 : body.warmupFrames,
      };
    }
    validateRenderParams(renderParams);

    // Normalize through art-recipe.mjs BEFORE persistence — the recipe
    // stored on the job is always the validated/clamped/allowlisted one,
    // never the caller's raw body.
    const normalized = normalizeArtSceneRecipe({ kind: 'art-scene-v2', schemaVersion: 1, scene: body.scene });

    // Capability-checked and REJECTED BY DEFAULT if unsupported — this
    // route never accepts (or even reads) an allowUnsupportedFeatures
    // override; that parameter exists only on the local-testing
    // renderArtScene function, never in the production Proof/Final Render
    // job path (both actions share this exact same gate).
    // Capture Frame parity round: an ACTIVE capture frame owns the Final
    // Render output aspect (the export IS the frame's crop). The check is
    // SERVER-owned — a client presetId whose family disagrees with the
    // recipe is rejected precisely, never silently re-aimed.
    if (action === 'create-final') {
      const expectedFamily = finalRenderFamilyForRecipe(normalized.recipe);
      if (!String(body.presetId).startsWith(`${expectedFamily}-`)) {
        return json({
          error: `presetId "${body.presetId}" does not match this recipe's output family "${expectedFamily}" (${normalized.recipe.frameId !== 'off' ? `active capture frame '${normalized.recipe.frameId}'` : `sheet aspect '${normalized.recipe.clothAspect}'`} owns the output aspect).`,
        }, 400);
      }
    }

    // Timeline (Phase C, "Interrupted export recovery") — an explicit
    // top-level field, mirroring Master Saves' own "never nested into
    // captureSceneRecipe" precedent (app/dashboard/studio/elements/
    // master-saves.js): a keyframe's own `recipe` IS a captureSceneRecipe()
    // snapshot, so nesting the timeline INTO the scene it travels alongside
    // would recurse. `sanitizeArtTimeline` reduces the untrusted, full
    // client submission down to the small {totalSeconds, keyframes:[{t,
    // scroll:{scrollPosition, posY}}]} shape this render pass persists and
    // interpolates — see services/studio-render/art-timeline.mjs's own
    // header for why the full per-keyframe recipes never leave this route.
    // Zero keyframes (an empty/absent/malformed submission) is treated
    // identically to "no timeline at all" — no duration check, no
    // capability contribution, nothing persisted on the job.
    const sanitizedTimeline = body.timeline ? sanitizeArtTimeline(body.timeline) : { totalSeconds: 0, keyframes: [] };
    const hasTimeline = sanitizedTimeline.keyframes.length > 0;

    // Duration contract (mirrors exportTimeline's own — Quick Export's
    // timeline-driven capture runs for timelineDuration(timeline), never
    // the videoSeconds dial): a timeline-driven FINAL RENDER must run for
    // exactly the submitted timeline's own totalSeconds. The client sends
    // durationSeconds = totalSeconds for a timeline submission; a mismatch
    // is rejected loudly rather than either side silently winning. Proof's
    // own durationSeconds is a fixed, small, deterministic-check profile
    // (PROOF_RENDER_PARAMS, ClothStudio.jsx) that intentionally never
    // varies with the timeline length — a Proof with an active timeline
    // simply plays the FIRST slice of it, so no match is required there.
    if (hasTimeline && action === 'create-final' && timelineDurationMismatch(sanitizedTimeline, body.durationSeconds)) {
      return json({
        error: `durationSeconds (${JSON.stringify(body.durationSeconds)}) must equal the submitted timeline's totalSeconds (${sanitizedTimeline.totalSeconds}) for a timeline-driven Final Render.`,
      }, 400);
    }

    const capabilities = checkCapabilities(normalized.recipe);
    // Timeline capability check — the honesty core (art-timeline.mjs's own
    // checkArtTimelineCapabilities): deep-diffs each keyframe's normalized
    // recipe against the normalized base scene, precisely rejecting any
    // differing field this render pass doesn't yet tween (only
    // devicePrimary.scrollPosition/posY are implemented this phase) by dot
    // path, and rejecting varying camera poses across keyframes as
    // `timeline-orbit-pose`. Merged into ONE response with the scene-level
    // capability check below — never a second, separate 422 round trip —
    // so the caller's existing unsupported-list UI shows every rejected
    // name at once (the same never-short-circuit contract checkCapabilities
    // itself follows).
    const timelineCapabilities = hasTimeline
      ? checkArtTimelineCapabilities(normalized.recipe, body.timeline)
      : { supported: true, unsupportedFeatures: [] };
    const unsupportedFeatures = [...capabilities.unsupportedFeatures, ...timelineCapabilities.unsupportedFeatures];
    if (unsupportedFeatures.length > 0) {
      return json({
        error: `Recipe requests unsupported feature(s): ${unsupportedFeatures.join(', ')}.`,
        capabilities: { supported: false, unsupportedFeatures },
      }, 422);
    }

    // idempotencyKey is REQUIRED at this route (Codex re-review round 3,
    // P2) — missing, numeric, object, empty, or oversized keys are all
    // rejected with 400 here (via the SAME assertValidIdempotencyKey the
    // module uses internally — one source of truth for the rule), never
    // silently coerced to null (a coerced null would fall through to
    // createProofRenderJob's non-idempotent path, defeating the whole
    // point of requiring one at the authenticated production boundary).
    // createProofRenderJob itself still accepts an omitted key for
    // internal/test callers that genuinely want a plain, non-idempotent
    // create — that flexibility stays at the module layer only; this route
    // always uses atomic idempotency.
    //
    // Slice 4e's own job: generate ONE UUID per deliberate "Generate Proof"
    // click and resend that SAME UUID only when retrying that one action
    // (a new click is a new UUID) — not decided or built here. Final
    // Render's own client-side equivalent follows the identical pattern.
    jobs.assertValidIdempotencyKey(body.idempotencyKey);

    // Pinned screen still (Slice F2): the reference must resolve to a REAL
    // object under THIS client's own prefix before a job may exist — a
    // dangling/foreign/mistyped reference fails here, at submission, never
    // as a mid-render surprise. Existence is clientId-scoped, so another
    // tenant's hash can never be referenced (indistinguishable from
    // missing).
    const pinnedStill = normalized.recipe.devicePrimary?.screenStill;
    if (pinnedStill) {
      const exists = await deviceScreenStillExists({ clientId: context.clientId, still: pinnedStill });
      if (!exists) {
        return json({ error: 'devicePrimary.screenStill does not reference a pinned screen still owned by this client. Pin the image first (action: pin-device-screen).' }, 422);
      }
    }

    const job = await jobs.createProofRenderJob({
      clientId: context.clientId,
      ownerUid: decoded.uid,
      recipe: normalized.recipe,
      warnings: normalized.warnings,
      capabilities,
      renderParams,
      idempotencyKey: body.idempotencyKey,
      renderKind: action === 'create-final' ? 'final' : 'proof',
      // Only the small, already-validated REDUCED timeline is ever
      // persisted — see sanitizedTimeline's own comment above.
      timeline: hasTimeline ? sanitizedTimeline : null,
    });
    // P1-A (Production lifecycle hardening round) — a queued job no longer
    // waits on a human to POST the worker's own /run by hand. EXPLICITLY
    // best-effort — never FAILS this response — but NOT non-blocking and
    // NOT durable (external review correction: an earlier version of this
    // comment claimed "never blocks," which was wrong): this call is
    // awaited, and in 'local' dispatch mode adds up to ~5s of real latency
    // to this response while the worker's /run (now a full sequential
    // drain, not a single claim) is attempted — see proof-render-
    // dispatch.cjs's own header for the full contract and the tracked P2
    // fix to reduce this latency. Only fires for a job that is ACTUALLY
    // queued right now — a deduped idempotent replay onto an already-done/
    // failed/rendering job has nothing new to wake a worker for. Applies to
    // both Proof and Final Render jobs alike: they share this exact same
    // queue/worker (renderKind is just a label).
    // Dispatch status is OBSERVABLE in the response (Codex Phase 7 review,
    // P1): a queued job whose wake-up task could not be created must not
    // masquerade as a fully-delivered success — the client surfaces
    // `dispatched:false` and retries the SAME idempotent create, which
    // resolves to the SAME job and re-attempts dispatch (dedup-safe: the
    // task name is deterministic per job).
    let dispatch = null;
    if (job.status === 'queued') dispatch = await dispatchProofRenderJob(job.jobId);
    return json({ ok: true, job: jobs.toClientView(job), ...(dispatch ? { dispatch } : {}) }, job.deduped ? 200 : 201);
  } catch (err) {
    if (err instanceof ArtRecipeValidationError || err instanceof ArtRenderError) {
      return json({ error: err.message }, 400);
    }
    return json({ error: err.message || 'Request failed.' }, err.status || 400);
  }
}
