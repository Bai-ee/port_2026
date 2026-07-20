# Site Recreate Card — as-built

Last updated: 2026-07-20 (Phases 1–3 shipped this session; Phase 4 pending).
Source plan: [`docs/plans/SITE-RECREATE-AUTOMATION-PLAN.md`](../plans/SITE-RECREATE-AUTOMATION-PLAN.md).
Frozen manual runbook this ports: [`docs/SHOPIFY-TO-PAYLOAD-AUTOMATION.md`](../SHOPIFY-TO-PAYLOAD-AUTOMATION.md) (Phase A only — Phase B/Payload is explicitly out of scope, see plan Phase 5).

## What it does

Admin submits a live site URL (Shopify / Squarespace / Wix / generic static). The clone engine mirrors it into an exact offline static recreation — same pages, images, copy, checkout/tracking stripped — and delivers:

1. A **live Vercel preview** the admin/client can browse.
2. A **downloadable zip** of the static site.
3. An **upsell CTA** ("Contact Your Human") for DNS transfer + hosting.

Payload CMS seeding and self-serve/DNS automation are explicitly later phases (plan Phase 5–6), not built.

## Architecture

```
SiteRecreateCard.jsx (dashboard card, website bucket, admin-only)
        │  create / status / list
        ▼
app/api/dashboard/site-clone/route.js  ── clone_jobs (Firestore, via api/_lib/clone-jobs.cjs)
        │
        │  Phase 2: admin runs the CLI by hand
        │  Phase 4 (pending): Cloud Run polls automatically
        ▼
services/site-clone/run-clone.mjs  (claims the job, runs the A1–A7 pipeline)
        │
        ▼
api/_lib/site-clone-publish.cjs  ── Storage (zip) + Vercel (live preview)
        │
        ▼
clone_jobs/{jobId} updated → card listener/poll picks up the result
```

`cardId` join key: `site-recreate` (card def, `CUSTOM_DETAIL_CARD_IDS`, route, Firestore collection all key off it — same pattern as every other dashboard card, see [`CREATIVE-BRIEF-DELIVERABLES-WIRING.md`](CREATIVE-BRIEF-DELIVERABLES-WIRING.md)).

## Files

| File | Role |
|---|---|
| `DashboardPage.jsx` — card def (`id: 'site-recreate'`, `category: 'website'`), spread `...(isAdmin ? [...] : [])` | Tile definition, admin-only |
| `lib/dashboard/tile-config.js` — `CUSTOM_DETAIL_CARD_IDS` | Suppresses generic REPORT/SOLUTIONS/PROBLEMS/DATA tabs |
| `components/dashboard/SiteRecreateCard.jsx` | Single custom panel: URL input + attestation, run status, preview iframe, download, upsell, run history |
| `api/_lib/clone-jobs.cjs` (+ `__tests__/clone-jobs.test.js`) | `clone_jobs` Firestore lifecycle — create/claim/log/complete/fail/requeue, mirrors `media-jobs.cjs` mechanics minus the singleton lock (see below) |
| `app/api/dashboard/site-clone/route.js` | `create` (admin-gated), `status`/`list` (open reads) |
| `services/site-clone/profiles/*.json` | Per-platform detect markers, render mode, asset-host allowlist, commerce killlist/href patterns |
| `services/site-clone/lib/*.mjs` | Pipeline stages — `discover`, `download`, `mirror`, `finalize`, `strip`, `fix-inline-scripts`, `verify`, `compress`, `package`, `http`, `profile` |
| `services/site-clone/run-clone.mjs` | CLI entry (`--url` ad-hoc / `--job <id>` Firestore-backed), orchestrates the pipeline + publish |
| `api/_lib/site-clone-publish.cjs` | Zip → Storage, site → Vercel preview (content-addressable upload, see gotcha below) |

## Data model — `clone_jobs/{jobId}`

```
{ jobId, clientId, targetUrl, platform, status: queued|processing|verifying|done|failed,
  ownershipAttested: true, attempts, workerLease, createdAt/updatedAt,
  pages: [{path, localFile}], assetCount, totalBytes,
  verifyReport: {pagesChecked, consoleErrors, httpErrors, navClickOk, dataLocalizedCount, pass, details[]},
  zip: {storagePath, downloadUrl, bytes},
  preview: {vercelUrl, deploymentId, projectName} | null,
  log: [{t, line}], error }
```

No singleton queue lock (unlike `media_jobs`): site-clone jobs don't share one exclusive resource (no single FFmpeg worker), so `claimCloneJob`/`claimNextCloneJob` rely purely on each job's own transactional claim. `claimCloneJob(jobId)` is the CLI's `--job <id>` path; `claimNextCloneJob()` exists for Phase 4's Cloud Run poll loop.

## Pipeline (`services/site-clone/lib/`, ported from the runbook's A1–A7)

| Stage | File | Runbook step |
|---|---|---|
| Discover pages | `discover.mjs` | new (runbook used a hardcoded page list) |
| Download page HTML | `download.mjs` | A1 |
| Mirror assets | `mirror.mjs` | A2 |
| Finalize links | `finalize.mjs` | A3 |
| Strip scripts | `strip.mjs` | A4 |
| Fix inline scripts | `fix-inline-scripts.mjs` | A5 |
| Verify (GATE) | `verify.mjs` | A6 |
| Compress images | `compress.mjs` | A7 |
| Write + zip | `package.mjs` | — |

**Platform profiles** (`profiles/*.json`) generalize the runbook beyond Shopify: `detect` markers (homepage HTML substrings), `renderMode` (`static` = curl-equivalent fetch is complete; `rendered` = needs Playwright — Squarespace/Wix/generic), `assetHosts` allowlist (supports a trailing-`*` wildcard and an `{origin}` placeholder), `commerceKilllist` (substring match against script src/text — decompose on match), `commerceHrefPatterns` (substring match against pathname — neutralize to `href="#" data-localized="true"`). Squarespace/Wix profiles are **minimal, unproven** — built per the plan's Risk #2, tune on the first real target.

**Page discovery** (`discover.mjs`): tries `/sitemap.xml` first, falls back to homepage nav-link parsing. ⚠️ **Sitemap-index gotcha** — Shopify (and most storefront platforms) publish a sitemap *index* (separate sub-sitemaps for products/collections/blogs/pages), not a flat list. Recreating a marketing site should mirror the **pages** sub-sitemap only — following product/collection sub-sitemaps would try to mirror an entire commerce catalog and blow past the page cap with irrelevant content. `discoverViaSitemap()` detects an index (`sitemapindex > sitemap > loc`) and specifically follows the sub-sitemap whose URL contains "pages"; falls back to nav-parsing if none exists. Sub-sitemap URLs can carry required pagination query params (`?from=...&to=...`) — always fetch the `<loc>` verbatim.

**A6 verify gate**: serves the recreated site over a local static HTTP server, loads every page with headless Playwright, and requires **0 console errors + 0 HTTP 4xx/5xx** across all pages. No silent pass — a failing report is attached to the job (`failCloneJob(jobId, ..., {verifyReport})`). Also runs a best-effort nav click-test (first *visible* internal link, excluding self-links — a hidden off-canvas menu-drawer link is never Playwright-actionable and will just time out) and counts `data-localized` markers. Only console/HTTP errors gate the pass/fail; `navClickOk` is informational.

## Known killlist drift (Shopify) — found via the real Rosita's re-run

The runbook's original killlist (`shop-js/loader.init-shop-cart-sync`) no longer matches Shopify's current checkout-preload script. Re-running the pipeline against the live `rositas.com` (the plan's own acceptance target) surfaced two real gaps, both fixed in `profiles/shopify.json`:

1. **`perf-kit`** — Shopify's performance-monitoring script (`shopifycloud/perf-kit/shopify-perf-kit-*.min.js`), not present in the original runbook's killlist.
2. **`checkouts/internal`** — the current checkout-preload script (`checkouts/internal/preloads.<hash>.js`) that speculatively prefetches ~10 `shopifycloud/checkout-web` chunks at runtime; these 404 offline and were the actual replacement for the runbook's stale `shop-js/loader.init-shop-cart-sync` reference.

**Lesson for future re-verification:** Shopify's checkout/analytics script paths change over time. If the A6 gate starts failing on new `checkout-web`/`perf-kit`-style 404s against a fresh target, that's killlist drift, not an engine bug — inspect the failing page's mirrored `<script>` tags for the new script name and add it to `commerceKilllist`.

## Verified acceptance run (2026-07-20)

Re-ran the CLI (`node services/site-clone/run-clone.mjs --url https://rositas.com/`) end-to-end against the plan's own reference target:

- **11 pages** discovered (the site has grown since the runbook: `contact`, `order`, `specials`, `groups`, `menu-2`, `history`, `catering`, `reviews`, `press`, `contact-us`, plus `/`) — vs the runbook's original 6.
- **216 assets**, 24.1 MB post-compression (runbook: 211 assets, 22.9 MB) — same ballpark, consistent with 11 vs 6 pages.
- **0 console errors, 0 HTTP errors, navClickOk: true, 22 `data-localized` markers.**
- Working zip (unzip + `node serve.mjs` smoke-tested locally); Vercel preview deploy end-to-end tested for real (Storage upload + live `*.vercel.app` deployment confirmed serving the recreated site), then torn down (test project deleted, test Storage objects removed) since it was scratch verification, not a real client run.

## Vercel publish gotcha (Phase 3)

Vercel's deployment-creation endpoint (`POST /v13/deployments`) caps **inline `data`** at a 10 MB total request body. A full clone (~200+ files, ~24 MB) blows past that immediately (`400 Request body too large. Limit: 10mb`). Fix: upload every file individually to the content-addressable `POST /v2/files` endpoint (raw bytes + an `x-vercel-digest` SHA1 header), then create the deployment referencing files by `{file, sha, size}` instead of inlining bytes. `site-clone-publish.cjs` does this — do **not** revert to inline `data` for this card's deploy path. (`vercel-briefs.cjs`'s single-HTML brief deploy is unaffected — one small file never hits the cap — and was left untouched per the plan's "extend via a sibling module" instruction.)

Vercel publish is **best-effort**: if `VERCEL_AUTH_TOKEN`/`VERCEL_API_TOKEN` isn't configured, or the deploy fails, the job still completes with a `zip` and `preview: null` — it never fails the whole job over a preview-only problem.

## Admin gating

Job **creation** is admin-gated at the API route (`requireAdmin` before `action=create`); reads (`status`/`list`) are open to any authenticated user, matching the Media Library pattern described in the plan. In practice the card is **admin-only end-to-end**: the card def is spread only `...(isAdmin ? [...] : [])` (same pattern as the `x-profile` card), so non-admins never see even a locked tile for it — a deliberately stricter posture than the plan's literal "non-admins see existing results read-only," chosen because cloning arbitrary third-party sites is a legal/abuse surface (plan Risk #1). Revisit if/when a real non-admin use case needs read access.

## Running it (Phase 2/3 — local CLI, no automation yet)

```bash
# Ad-hoc, no Firestore — for engine development/verification
node services/site-clone/run-clone.mjs --url https://example.com

# Against a real queued job (admin submitted via the card)
node services/site-clone/run-clone.mjs --job <jobId>
```

Output for `--job` mode: claims the job (`clone-jobs.cjs`), streams progress into `job.log[]` (which the card's run terminal polls and displays), runs the full pipeline, publishes (Storage + Vercel), and completes/fails the job doc.

## Caps (plan Risk #5)

Hard limits in `run-clone.mjs`: max 15 pages, max 150 MB total mirrored bytes, max 25 MB per single asset. Exceeding any of these throws with a clear message — never a silent partial mirror.

## Phase 4 — Cloud Run automation (as-built, not yet deployed)

**Design departs from the plan's literal "lease/complete worker endpoints" wording** — documented here deliberately, not a silent drift. The EditVideos bridge's `lease`/`complete` HTTP contract exists because EditVideos is a *separate repository* without direct Firestore trust. `services/site-clone/` lives in *this* monorepo and already has direct Firestore access proven out in Phase 2 (the CLI calls `clone-jobs.cjs` functions directly). Reusing that same direct-access path for the Cloud Run worker is simpler and avoids re-deriving a bridge contract this codebase doesn't need. The only genuinely new piece is the **trigger** (how a Cloud Run request gets started at all):

1. `services/site-clone/server.mjs` — HTTP wrapper, `POST /clone` gated by an `x-worker-secret` header (`SITE_CLONE_SHARED_SECRET`, same shared-secret pattern as `studio-render`'s `RENDER_SHARED_SECRET`, not Cloud Run IAM). Body `{jobId}`; internally calls `runForJob(jobId)` (the same function the CLI's `--job` path now calls — `run-clone.mjs` was refactored to export it) and returns `{ok, jobId, zip, preview}` or `{ok:false, reason}`. `GET /healthz` for Cloud Run's health check.
2. `app/api/dashboard/site-clone/route.js` — after `create` succeeds, `triggerWorker(jobId)` fires a best-effort, 5s-bounded `POST` to `SITE_CLONE_WORKER_URL` if both that and `SITE_CLONE_SHARED_SECRET` are configured. Never blocks or fails job creation on an unreachable/unconfigured worker — the job just stays `queued`, and the Phase 2 admin CLI remains a working fallback.
3. `services/site-clone/Dockerfile` — CPU-only (no GPU, unlike `studio-render`). Base image `mcr.microsoft.com/playwright:v1.61.0-noble` (Chromium + all system libs preinstalled, version-matched to the root `playwright` dep) + `apt-get install zip` (for `package.mjs`'s `zipSite()`). **Build context is the repo root**, not this directory — unlike `studio-render`'s `cd "$(dirname "$0")"` pattern — because the image needs `api/_lib/{clone-jobs,site-clone-publish,firebase-admin,storage-artifacts,safe-fetch}.cjs` copied in alongside `services/site-clone/`, preserving the exact repo-relative directory layout so every existing `require('../../api/_lib/...')` resolves unchanged from local dev.
4. `services/site-clone/package.json` — new, lists only the extra deps this worker needs (`cheerio`, `sharp`, `playwright`, `firebase-admin`) for the container's own `npm install`; local CLI usage still resolves these from the repo root's `node_modules` as before (unaffected).
5. `services/site-clone/deploy-cloud-run.sh` — mirrors `studio-render`'s cost controls (`min-instances 0`, capped `max-instances`, `--allow-unauthenticated` + app-level shared-secret auth instead of Cloud Run IAM) but CPU/memory only (no `--gpu`), longer timeout (long clone runs), and passes `FIREBASE_ADMIN_*` + `SITE_CLONE_SHARED_SECRET` + `VERCEL_AUTH_TOKEN`/`VERCEL_TEAM_ID` as env vars.

**Verified locally (2026-07-20), without touching GCP:**
- `docker build -f services/site-clone/Dockerfile .` from the repo root succeeds — base image pull, `zip` install, `npm install` (208 packages), the two-stage `COPY` (api/_lib files + services/site-clone/) all work as designed.
- `docker run` the built image, hit `GET /healthz` → `{"ok":true}`; `POST /clone` with no/wrong secret → `401`; with the right secret and no `jobId` → a clean 400-style JSON error. Confirms the container boots, every `require`/`import` in the dependency graph resolves inside the image (no module-not-found), and the auth layer works identically to running `server.mjs` directly with plain Node.
- Test container/image removed after verification.

**Not done / explicitly deferred:** an actual `gcloud run deploy` (real Cloud Run service, real spend, needs `GCP_PROJECT` + a generated `SITE_CLONE_SHARED_SECRET` + Firebase Admin creds as Cloud Run env vars); setting `SITE_CLONE_WORKER_URL`/`SITE_CLONE_SHARED_SECRET` in Vercel's env so the route's `triggerWorker` actually fires. Until both of those deliberate steps happen, the feature runs exactly as Phase 2/3 left it — admin submits, admin runs the CLI by hand.

## Phase status

- **Phase 1 (card + job plumbing)** — shipped. Card renders, admin-gated create, `clone_jobs` doc appears, non-admin sees nothing (stricter than spec, see Admin gating above).
- **Phase 2 (clone engine, local CLI)** — shipped, verified against the real Rosita's re-run (see above). Fidelity bar met.
- **Phase 3 (delivery UX + publish)** — shipped. Card's preview/download/upsell panels were already built in Phase 1 (anticipating this data); `site-clone-publish.cjs` verified end-to-end for real, then torn down.
- **Phase 4 (Cloud Run automation)** — shipped, code-verified locally; **not deployed** (a real `gcloud run deploy` is a deliberate infra-spend decision, not something to fire automatically). See below.
- **Phase 5 (Payload layer)** and **Phase 6 (self-serve + DNS)** — explicitly out of scope per the plan; Phase 5 needs its own plan doc, Phase 6 has no concrete design yet.
