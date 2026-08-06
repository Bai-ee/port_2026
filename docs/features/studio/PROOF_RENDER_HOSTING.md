# Studio Proof Render — Deployment Readiness Design (Slice 4f Phase B)

Status: **design only — nothing in this doc has been deployed, enabled, or run.** No Docker build, `gcloud` command, IAM change, secret creation, flag flip, job enqueue, or paid render has occurred. This is the Phase B deliverable approved after Slice 4f Phase A (ffmpeg/ffprobe process-lifecycle hardening — see `docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-PLAN.md`'s Slice 4f checkpoints) shipped and passed Codex review. Phase C (the actual canary) requires a separate, explicit approval after this document is reviewed.

Mirrors the structure of the sibling doc for the existing GPU service, `docs/features/studio/STUDIO_RENDER_HOSTING.md` — read that first for the Video Promo baseline this design deliberately does **not** touch or share runtime with.

---

## 1. What's being hosted

`services/studio-render/art-render.mjs` (+ `art-scene.mjs`, `art-recipe.mjs`, `art-render-validation.mjs`) and `proof-render-worker.mjs` — the local, deterministic Playwright + ffmpeg + ffprobe Proof render pipeline built in Slices 4a–4e and hardened in Slice 4f Phase A. Today it is a directly-callable, directly-testable Node function (`runOneProofRenderJob`) with a real Firestore job queue (`proof_render_jobs`, Slice 4d) behind an authenticated API (`app/api/dashboard/proof-render/route.js`) and a Studio UI (`ClothStudio.jsx`'s "PROOF RENDER (BETA)" section, flag-gated OFF by default). **Nothing invokes the worker in production yet** — that's the gap this document closes on paper.

## 2. Architecture decision: a separate Cloud Run service, not the shared GPU one

`services/studio-render/server.mjs`/`render.mjs`/`recipe.mjs`/`scene.mjs` back the **live** Video Promo feature on a shared, GPU-backed Cloud Run service (project `human-in-the-loop-a1a19`, region `us-central1`, NVIDIA L4, `--concurrency 1 --max-instances 1`). Two facts settle this:

- **Proof does not need a GPU.** Slice 4b's own feasibility spike proved fixed-timestep determinism on **software WebGL** (SwiftShader, no GPU on the test machine) — the exact rendering path `art-render.mjs` still uses today. Video Promo's GPU requirement is specific to faithfully rendering an *external live website's own* WebGL hero content; Proof renders a bounded, synthetic Three.js scene it fully controls (cloth + lighting + solid background — no glass, no extra catalog elements, no FX; see `art-render-validation.mjs`'s `CAPABILITY_CHECKS`). There is nothing in the Proof pipeline that benefits from real GPU hardware.
- **Co-hosting would create real contention.** The shared service's `concurrency 1`/`max-instances 1` GPU slot exists to bound GPU spend for Video Promo. A Proof worker sharing that slot would either queue behind a live Video Promo render or block one — exactly the shared-infrastructure risk flagged in this Slice's own Phase-plan review before Phase A began.

**Decision: Proof gets its own Cloud Run service, `studio-proof-render`, CPU-only, built from a second Dockerfile in the same source directory — not a new top-level `services/` package.**

- `services/studio-render/Dockerfile.proof` (new, not yet written) — same directory as the existing `Dockerfile`, but copies only the Proof-pipeline files (`art-recipe.mjs`, `art-render-validation.mjs`, `art-render.mjs`, `art-scene.mjs`, `proof-render-worker.mjs`, `vendor/`, plus a new small HTTP entrypoint — see §4) and a real `npm install` (see the packaging gap below). It never copies `server.mjs`/`render.mjs`/`recipe.mjs`/`scene.mjs` — the two Dockerfiles share a source directory purely for developer convenience, not for any runtime coupling.
- `services/studio-render/deploy-cloud-run-proof.sh` (new) — mirrors the existing `deploy-cloud-run.sh`'s cost-control flags (`--min-instances 0`, capped `--max-instances`, `EXIT_AFTER_RENDER` equivalent) but **no `--gpu`/`--gpu-type`**, and `--dockerfile Dockerfile.proof` so `gcloud run deploy --source .` builds the Proof image instead of the GPU one from the same directory.
- Rationale for reusing the directory instead of moving files into a new `services/proof-render/` package: every existing import path (`app/api/dashboard/proof-render/route.js`'s `../../../../services/studio-render/art-recipe.mjs`, the worker, all of Slice 4a–4e's test files under `services/studio-render/__tests__/`) stays correct with zero migration risk. Full deployment isolation (separate Cloud Run **service**, separate scaling, separate IAM, separate cost line, separate incident blast radius) doesn't require a file-layout migration — only a second Dockerfile and a second deploy target.

### A concrete packaging gap this design surfaces (not yet fixed — a Phase C build item)

The current `Dockerfile` has **no `npm install` step at all** — confirmed by inspection; `services/studio-render/package.json` declares zero dependencies. That works today because Video Promo's `render.mjs` never uses Playwright — it drives Chrome via raw CDP over a native `WebSocket` (Node 22 global), spawning the **system apt-installed** `chromium` binary directly (`CHROME_PATH=/usr/bin/chromium`). `art-render.mjs`, by contrast, does `import { chromium } from 'playwright'` — a real npm dependency, currently only present via the **repo root's** `node_modules` (resolved locally through Node's upward module resolution, which won't reach outside a Docker build context rooted at `services/studio-render/`). `Dockerfile.proof` must do one of:

- add `playwright` to `services/studio-render/package.json`, `RUN npm install`, and `RUN npx playwright install --with-deps chromium` (Playwright's own recommended Docker pattern — downloads Playwright's bundled Chromium build into the image), or
- point `chromium.launch({ executablePath: '/usr/bin/chromium' })` at the same system Chromium the GPU Dockerfile already apt-installs, skipping Playwright's own browser download entirely.

Not decided here — a genuine Phase C implementation choice, flagged so it isn't discovered mid-build. (The second option keeps the image smaller and reuses an already-proven apt package; the first is what Slice 4a–4e's local dev/test environment has actually been exercising, so it carries less unverified risk. Leaning toward the second for the deployed image, verified against the first's behavior before committing.)

## 3. Total render/job deadline (the gap Phase A's own checkpoint recorded)

Phase A bounded the ffmpeg/ffprobe **subprocess** phase only (`FFMPEG_TIMEOUT_MS`/`FFPROBE_TIMEOUT_MS` + confirmed SIGTERM→SIGKILL termination). Chromium launch, page navigation to the local static server, warm-up frames, and the frame-by-frame capture loop (`renderArtScene`'s `for` loop over `page.evaluate(...)`) have **no equivalent timeout today** — a stuck `page.evaluate` call (the page's own JS never resolving) would hang the whole render indefinitely, independent of and untouched by Phase A's fix.

**Design:** one outer, server-owned deadline wrapping the **entire** `renderArtScene()` call inside `runOneProofRenderJob` — layered *on top of*, not replacing, the existing subprocess-level timeouts (defense in depth: even if the total deadline had a bug, the inner ffmpeg/ffprobe bounds still hold; even if a subprocess were somehow slower than expected but under its own budget, the outer deadline still catches a genuinely stuck Chromium phase).

- A new constant, e.g. `TOTAL_RENDER_DEADLINE_MS` (proposed default: **600,000ms / 10 minutes** — deliberately generous with no empirical Cloud Run worst-case timing yet; the canary's own job duration should be used to tighten this before any broader rollout, not guessed further).
- Same principle as Phase A: **server-owned, not caller-controlled** — no request/job field can set it.
- On expiry: force-close the Playwright `browser` handle (Playwright's `browser.close()` terminates the underlying Chromium process even mid-operation), reject with a typed error, and let it flow through the **same existing fenced requeue path** Phase A's own worker-level regression test already proved handles an `ArtRenderError` thrown mid-render correctly (heartbeat stops, job requeues) — no new worker-side branching needed, matching how Phase A's ffmpeg/ffprobe timeout required zero changes to `proof-render-worker.mjs` itself.
- Open verification item for Phase C, not resolved here: Playwright's own default per-call timeouts (`page.goto`, `page.waitForFunction`) may already provide partial protection (Playwright's documented default action timeout is commonly 30s, currently unset/implicit in this code) — but `page.evaluate()`'s own timeout semantics need to be verified empirically rather than assumed, since it's the call inside the per-frame capture loop most exposed to a stuck page-side script.

## 4. Trigger

The worker (`runOneProofRenderJob`) is deliberately "not wired to any cron/HTTP trigger" per its own header comment — a future slice's job. This repo already has a working precedent for exactly this shape: `docs/source-of-truth/SITE-RECREATE-CARD.md`'s Cloud Run worker trigger (`app/api/dashboard/site-clone/route.js`'s `triggerWorker(jobId)` — a best-effort, 5-second-bounded `POST` fired right after job creation, gated on both `SITE_CLONE_WORKER_URL` and `SITE_CLONE_SHARED_SECRET` being configured, never blocking or failing job creation if the worker is unreachable or unconfigured — the job just stays `queued` and a manual fallback exists).

**Design, mirroring that pattern exactly:**

- A new small HTTP entrypoint on the Proof service (e.g. `services/studio-render/proof-server.mjs`, not `server.mjs` — that file is Video Promo's own `/render` contract, untouched): `POST /run`, gated by an `x-worker-secret` header against a new `PROOF_RENDER_WORKER_SECRET`. Body can be empty — the worker's own `claimNextProofRenderJob` already claims the oldest runnable job with no `jobId` parameter needed, so the trigger's job is simply "wake up and process whatever's next," not "process job X." `GET /healthz` for Cloud Run's own health check, matching the `site-clone` convention.
- `app/api/dashboard/proof-render/route.js`'s `POST` (`action:'create'`) handler gains a best-effort, short-timeout `triggerProofWorker()` call after `createProofRenderJob` succeeds — fires only if both `PROOF_RENDER_WORKER_URL` and `PROOF_RENDER_WORKER_SECRET` are set in the server env, never blocks or fails the create response either way.
- One Cloud Run request → one claimed-and-processed job → the request returns and the container is free to scale back to zero (`EXIT_AFTER_RENDER`-equivalent behavior), matching the existing "request-per-render" cost shape rather than the service running its own internal polling loop.
- Fallback (Phase C build item, not urgent for an MVP canary): an admin CLI script (`node services/studio-render/run-proof-job.mjs`, mirroring `services/site-clone/run-clone.mjs --job <id>`) that calls `runOneProofRenderJob` directly against production Firestore credentials, for draining the queue by hand if the auto-trigger is ever unconfigured or unreachable.
- **Explicitly not** wired into any existing cron (`pre-digest-refresh`, `daily-digest`, etc.) — Proof rendering is a user-initiated action (a "Generate Proof" click), never a scheduled background job.

## 5. IAM

- Video Promo's `server.mjs` has **zero** Firestore access today — it's a stateless render endpoint (confirmed by reading the file: no `firebase-admin` import anywhere in `server.mjs`/`render.mjs`/`recipe.mjs`/`scene.mjs`). The Proof worker is fundamentally different — it needs Firestore read/write on `proof_render_jobs`, `proof_render_queue_locks`, and `proof_render_idempotency` (Slice 4d's `api/_lib/proof-render-jobs.cjs`).
- **Decision: a dedicated service account** (e.g. `proof-render-worker@human-in-the-loop-a1a19.iam.gserviceaccount.com`) with the same `roles/datastore.user` grant every other server-side Firestore write path in this app already runs under (via `api/_lib/firebase-admin.cjs`'s existing credentials) — not a new privilege model, just a **separate identity** from Video Promo's (currently zero-privilege) one, so a Proof-side incident's audit trail and blast radius stay distinct from Video Promo's.
- Firestore itself has no native per-collection IAM scoping finer than the database level via standard roles — true least-privilege would require custom Firestore Security Rules, which is more machinery than this deployment's risk profile currently justifies (server-side admin SDK access already bypasses client-facing Security Rules entirely, matching how every other `.cjs` Firestore writer in this codebase already operates). Not proposing that here; flagging it as a known ceiling on isolation, not a gap silently accepted.
- Ingress: `--allow-unauthenticated` + the app-level `x-worker-secret` header check (matching **both** existing precedents in this repo — `RENDER_SHARED_SECRET`/`x-render-secret` for Video Promo, `SITE_CLONE_SHARED_SECRET`/`x-worker-secret` for site-clone) — not Cloud Run IAM invoker auth, for consistency and to avoid a second, different auth mechanism in the same codebase.
- New secrets needed (generated the same way as the existing ones, `openssl rand -hex 24`, never reused across services): `PROOF_RENDER_WORKER_SECRET` (Vercel env + Cloud Run env), plus `PROOF_RENDER_WORKER_URL` (Vercel env only, the deployed service's own URL).

## 6. Artifact policy — an open decision, not silently resolved

**Current state (Slice 4c/4d, unchanged by this design):** Proof output is metadata-only. The MP4 + poster render to a throwaway local temp directory inside the worker's own container and are deleted immediately after `validateWithFfprobe` extracts the sanitized `{width, height, fps, codec, frameCount, duration}` object — `completeProofRenderJob` never persists a local path, and an existing test (`proof-render-worker.test.mjs`) explicitly asserts no `/tmp/` or `.mp4` string ever reaches the stored job record.

**This document does not silently change that** — per the original Slice 4d scope note ("do not silently add storage"), the decision below is presented for explicit approval, not assumed:

| | Option A — metadata-only (current) | Option B — durable artifact |
|---|---|---|
| What ships | pass/fail + `{width,height,fps,codec,frameCount,duration}` | the above **plus** a small viewable MP4 + poster |
| Storage cost | $0 | negligible — the UI's own fixed `PROOF_RENDER_PARAMS` (640×360@24fps/3s = 72 frames) produces a file in the low hundreds of KB to a few MB range; even at high volume this is a rounding error next to compute cost |
| New surface | none | Firebase Storage upload (reusing the same upload pattern `api/_lib/studio-render-core.cjs`'s `renderAndStoreStudioVideo` already established for Video Promo output, scoped per-client/per-job instead of per-post) + an explicit **retention policy** (proposed: 7–30 days, swept by a scheduled cleanup, mirroring how other media lifecycles in this app are already bounded) |
| User value | "did this recipe render without error, at the right specs" | that, **plus** an actual small clip to look at — arguably the point of a feature literally named "Generate Proof" |

**Recommendation:** Option B is very likely what "Generate Proof" was meant to deliver — the existing UI copy itself ("proves this exact recipe renders correctly server-side... not a full-quality export," `ClothStudio.jsx:5000`) reads as describing a *viewable* preview, not a silent pass/fail. But it introduces new durable storage + retention/cleanup surface not built in any prior slice, so it needs explicit sign-off here rather than being folded in as an assumed detail of "deployment readiness."

## 7. Observability

Phase A's own diagnostic fields (`sigtermOutcome`/`sigkillOutcome`/`terminationConfirmed`/`terminationSignal`/`exitCode`/`sigkillAttempted`) are already exactly the metric-worthy data a real deployment needs — the Phase C job is to actually **emit** them somewhere durable, not invent new ones.

- **Baseline (ship with Phase C, effectively free):** `console.log`/`console.warn` lines at claim, each heartbeat renewal, render-stage progress (Chromium launch, warm-up, frame N/total, encode start/end, ffprobe validate), final duration, and — on any failure — the full Phase-A error `details` object. Cloud Run captures stdout/stderr into Cloud Logging automatically, matching exactly how Video Promo's own `[diag]`/`[gpu]`/`[render]` lines already work today — zero additional setup.
- **Beyond raw logs:** this repo's existing queryable-cost surface is the Operating Cost card (`app/api/admin/cost-report/route.js`, reading `brief_runs.providerUsage.stageCosts` + `usage_events`) — but by direct inspection, it tracks **LLM call cost only**; it has no Cloud Run/GPU compute line today, for Video Promo **or** anything else. This is a pre-existing gap Proof would inherit, not one it introduces. Flagging as a candidate follow-up (extending cost-report visibility to Cloud Run compute spend generally, benefiting both services) rather than a Phase C blocker.

## 8. Costs

Proof, CPU-only, is fundamentally cheaper than Video Promo's GPU service — no L4 surcharge, no Vulkan/Xvfb overhead, and a smaller render (72 frames at 640×360 vs. Video Promo's live-site captures). This is an **estimate**, explicitly not a substitute for a real measured number:

- Cloud Run CPU-only pricing, scale-to-zero, a render lasting a few seconds per job → almost certainly sub-cent per Proof render, likely lower than Video Promo's own already-tiny measured ~$0.01–0.02/video figure (`STUDIO_RENDER_HOSTING.md` §4).
- **The canary (Phase C) exists specifically to replace this estimate with a real number** — matching this Slice's own round-1 requirement ("a hard canary budget and one low-cost Proof recipe").
- Proposed canary budget ceiling (for the user to confirm/adjust before Phase C, not decided unilaterally here): **$1.00 total**, using the UI's own existing fixed `PROOF_RENDER_PARAMS` recipe (already the smallest/cheapest shape this pipeline supports).
- The existing hosting doc's own cost-control checklist has one item still unchecked for the **already-live** Video Promo service: `[ ] Set a GCP budget alert`. Recommend finally doing this for both services together as part of Phase C readiness, not deferring it further.

## 9. Rollback

Layered, cheapest-and-fastest-first, each one independently sufficient:

1. **UI flag** — `NEXT_PUBLIC_STUDIO_PROOF_RENDER_V1` stays OFF by default even after a canary; broader rollout stays flag-gated. Rollback = flip the env var, no deploy needed.
2. **Trigger** — unset `PROOF_RENDER_WORKER_URL`/`PROOF_RENDER_WORKER_SECRET` in Vercel env → new jobs simply stay `queued` (the same harmless fallback `site-clone` already established), no Cloud Run action needed.
3. **Cloud Run service** — `gcloud run services update studio-proof-render --max-instances 0` (or route traffic to zero) stops the service entirely without any code change.
4. **Full rollback** — because Proof is a **separate Dockerfile and a separate Cloud Run service**, rolling back or deleting its image/revision never touches or redeploys Video Promo's own `server.mjs` image. This is the direct payoff of the §2 architecture decision: a Proof-side rollback has zero blast radius on the live GPU service.

**Explicit non-goal:** no rollback path here should ever require redeploying or rolling back the Video Promo GPU service as a side effect of a Proof-only issue.

## 10. Canary procedure (Phase C — separate explicit approval required, not performed by this document)

**Preconditions:** this document reviewed and approved; the artifact-policy decision (§6) made explicitly; a budget ceiling agreed (§8); `Dockerfile.proof` + `deploy-cloud-run-proof.sh` + `proof-server.mjs` written and reviewed; the Proof Cloud Run service actually deployed (flag still OFF); trigger wiring in place; a GCP budget alert configured for both services.

**Procedure:**
1. Enable the Proof UI via the existing **admin-only query-param preview path** (`?proofRender=1`, mirroring the already-wired `elementsV1Enabled` precedent in `ClothStudio.jsx`) — **not** the global `NEXT_PUBLIC_STUDIO_PROOF_RENDER_V1` env var, so exposure stays limited to one admin session.
2. One real "Generate Proof" click against the fixed, small `PROOF_RENDER_PARAMS` recipe.
3. Verify: the job reaches `done`; output metadata matches the requested dimensions/fps/codec/frame count; Cloud Run logs show the expected claim → heartbeat → render-stage → complete sequence; the real GCP Billing entry appears and is within the agreed ceiling (§8); (if Option B from §6 was chosen) the artifact is genuinely viewable and was written to the agreed storage location with the agreed retention.
4. **Stop.** Report the real numbers (cost, duration, log excerpts). Do not proceed into broader rollout (enabling the global flag, wiring the trigger for all users, raising `max-instances`) without a further, separate explicit approval — matching this Slice's own original stop-gate ("after the canary, before any broader rollout").

---

## What runs where (recap, once Phase C ships — not true today)

```
[Studio "Generate Proof" click]  →  POST /api/dashboard/proof-render {action:'create'}  (Vercel, auth'd)
                                          │ writes proof_render_jobs (queued)
                                          │ best-effort trigger, x-worker-secret
                                          ▼
                              [studio-proof-render service]  (Cloud Run CPU-only, scale-to-zero,
                                          │                    SEPARATE from the GPU studio-render service)
                                          │  claims job, renders, encodes, validates, completes
                                          ▼
                          proof_render_jobs updated: done + sanitized metadata
                                          │  (+ artifact upload, if Option B is approved — §6)
                                          ▼
                          Studio UI polls GET /api/dashboard/proof-render?id=... and shows the result
```
