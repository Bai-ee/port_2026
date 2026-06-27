# Production Readiness Tracker

Last updated: 2026-06-26

This document tracks the current production-readiness hardening work for the local `main` branch. It focuses on launch safety, security, scaling, performance, cost controls, and operational concerns.

## Current Status

Overall launch risk after hardening: **Medium until the current branch is preview-smoked and deployed**

Public promotion status: **Local hardening is complete enough for preview.** The committed production baseline is stable, and the local branch now includes a broad but intentional release set spanning brand rename, dashboard UI, generated brief rendering, new public routes, hardened download proxy behavior, and smoke tooling. Build/tests/local smoke pass. Preview E2E still needs a Vercel protection bypass or public preview URL before production promotion.

## 2026-06-26 Strategy Builder Editorial Pack Addendum

Status: **gated feature; locally build-verified; not public launch-certified**

The Strategy Builder JSON upload workflow now requires a full `strategyBuilder.config` pack so imported JSON can hydrate the visible UI controls, not only the embedded editorial strategy object.

Tracked canonical doc:

- `docs/source-of-truth/STRATEGY-BUILDER-EDITORIAL-PACK.md`

Tracked example upload pack:

- `docs/features/editorial-strategy/STRATEGY_BUILDER_CONFIG_PACK.example.json`

Implementation surfaces:

- `components/dashboard/strategy-builder/InputsPane.jsx` — paste/import JSON, validate required config fields, hydrate controls, show JSON/manual source badges.
- `components/dashboard/strategy-builder/SignalToggles.jsx` — signal source badge.
- `app/api/dashboard/strategy-builder/config/route.js` — sanitize and persist config.
- `app/api/dashboard/strategy-builder/generate/route.js` — consume sanitized config, source toggles, campaign controls, events, signals, and normalized editorial strategy.
- `features/editorial-strategy/engine.js` — normalize campaign manifests, schedule policy, assets, narrative rules, and daily recommendation inputs.

Verification:

- `npm run build`: pass locally after the UI + docs update.
- Existing Turbopack NFT trace warning remains on `/api/leadgen/generate`; unrelated to Strategy Builder.

Remaining before upgrading from gated:

- Browser smoke the import flow against a real dashboard account.
- Confirm Firestore persistence for `strategyBuilder.config`, `strategyBuilder.events`, and `strategyBuilder.lastPlan`.
- Generate a plan from the example pack and verify the visible calendar reflects campaign, cadence, CTA, guardrails, source toggles, and signal settings.

## 2026-06-24 Pre-Flight Addendum

### Scope Snapshot

- Current branch: `codex/production-optimization`
- Ahead/staged: **0 commits ahead, 0 staged**
- Working tree: **36 modified + 6 untracked** at pre-flight time
- Nothing ships until intentional files are committed and pushed.

### Pre-Flight Results

- Secrets staged/tracked: **none found**
- TypeScript: **n/a** (`JS` project; no `tsconfig`)
- Migrations: **none**
- Dependencies: **no new packages**; only added `smoke:preview` npm script
- `npm run build`: **pass**
- `git diff --check`: **pass**
- `npm run smoke:routes`: **pass after repair**, 25 routes, 0 failures

### Current Untracked Files

Intentional candidates:

- `app/api/public/hitloop-creative-brief/route.js`
- `app/api/dashboard/deliverable-file/route.js`
- `components/UpRightArrow.jsx`
- `scripts/smoke-preview.mjs`

Do **not** ship:

- `scripts/creative-brief-bryan-balli-WUoltG84.html`
- `scripts/creative-brief-valessa-nhEgZLmg.html`

These are generated creative brief outputs. The `valessa` filename appears to contain real client-identifying data. Added `.gitignore` coverage: `scripts/creative-brief-*.html`.

### New Public/API Surface To Review

#### `/api/public/hitloop-creative-brief`

Status: **needs preview verification**

Purpose: public cached render of HITLOOP's latest Creative Brief for the homepage deliverables hover card.

Runtime envs actually used:

- Firebase Admin envs via `api/_lib/firebase-admin.cjs`

Checks required before production:

- Confirm production Firebase Admin envs are present.
- Confirm the route only ever reads the hardcoded HITLOOP client (`bryan-balli-WUoltG84`) and cannot be parameterized to read other clients.
- Confirm cache behavior (`s-maxage=600`, `stale-while-revalidate=86400`) is acceptable for homepage brief freshness.
- Confirm importing `renderMarketingBriefHtml` from the authed dashboard route does not drag unnecessary runtime code or leak private route behavior.

#### `/api/dashboard/deliverable-file`

Status: **hardened locally; preview verification required**

Purpose: same-origin download proxy for Firebase Storage deliverables, including multi-file zip support.

Runtime envs actually used:

- none directly

Original risk:

- The route is unauthenticated and currently accepts arbitrary HTTPS URLs on broad Storage host suffixes, up to 12 files at 25 MB each. That creates an abuse/cost vector and can turn the app into a public Storage download/zip proxy.

Fix applied locally:

- Restricted Storage URLs to the configured Firebase Storage bucket.
- Added a narrow same-site public media allowance for configured-site `/img/*` assets only.
- Added IP-based rate limiting.
- Reduced max files to 8, per-file cap to 15 MB, and total ZIP input cap to 50 MB.
- Rejects mixed invalid URL batches instead of silently filtering them.
- Avoids logging full tokenized asset URLs.

### Brand Rename / User-Visible Change

Status: **document and verify**

The working tree includes a visible rename from `HIT Agency` to `HITLOOP`. If this ships:

- Update launch notes/changelog if maintained.
- Verify metadata, schema, OG tags, header/footer, admin digest labels, and public creative brief copy are consistent.
- Confirm old public references do not remain where they would confuse users.

### Branch / Commit Hygiene

Status: **must clean before production**

Recommended commit split:

1. `chore(brand): rename HIT Agency to HITLOOP`
2. `feat(briefs): add public HITLOOP creative brief route`
3. `feat(deliverables): add hardened deliverable download proxy`
4. `ui(dashboard): refine creative brief previews and fullscreen actions`
5. `test(smoke): add preview smoke runner`

Do not combine the generated brief artifacts with any production commit.

## Verification Snapshot

Latest checks run locally:

- `npm test`: **pass**, 491 tests, 0 failures
- `npm audit --audit-level=moderate`: **pass**, 0 vulnerabilities
- `npm run build`: **pass** on 2026-06-24 current working tree
- `git diff --check`: **pass**
- `npm run smoke:routes`: **pass** after repair, 25 routes, 0 failures

Build still emits one Turbopack NFT tracing warning for `/api/leadgen/generate`. The trace was reduced materially and no longer contains the app/public bulk, but the warning text remains.

## Fixed

### Security

- Removed `WORKER_SECRET` as a generic admin bypass.
- Kept worker-secret auth explicit to worker/cron-style routes only.
- Added shared `isAdminEmail()` lookup backed by the `admins` Firestore collection.
- Replaced hardcoded admin checks in client and dashboard server routes.
- Hardened Studio URL inputs before Browserless execution.
- Added defense-in-depth URL validation inside the Browserless screenshot helper.
- Replaced direct `fetch(url)` in embeddability checks with SSRF-safe fetch.
- Hardened deliverables ZIP fetches:
  - exact/true-subdomain Storage host matching
  - SSRF-safe fetch
  - per-asset byte cap
  - total ZIP input byte cap
- Added binary response size enforcement to `safe-fetch`.
- Kept Stripe tier selection server-authoritative.
- Added server-side subscription tier to Stripe price-ID mapping.
- Added provisioning rate limits by IP and UID.

### Scaling And Cost

- Knowledge Base text, URL, and file ingestion now stores the item first and queues embedding after response with `after()`.
- Homepage analytics rate limit reduced from 200 to 60 anonymous events per IP per hour.
- Homepage hover previews no longer idle-load hidden video and iframe assets.
- Added `scripts/` to `.vercelignore`.
- Added generated client/script tracing excludes in `next.config.mjs`.
- Added `/api/social-posting/process-due` to Vercel cron.

### UX And Resilience

- Dashboard provisioning no longer fails open into a broken dashboard.
- Added retryable workspace-check failure state.
- Added `/api/health`.
- Added `/api/health` to route smoke coverage.
- Migrated `middleware.js` to `proxy.js` for the Next 16 convention.

### Dependencies

- Ran `npm audit fix`.
- Added targeted npm overrides for remaining transitive `postcss` and `uuid` advisories.
- Current audit result: 0 vulnerabilities.

## Remaining Concerns

### Medium

#### Deliverable File Proxy Abuse Risk

Status: **hardened locally; verify on preview**

The new `app/api/dashboard/deliverable-file/route.js` route originally could fetch and zip arbitrary URLs on broad Firebase/Google Storage host suffixes. It now limits Storage fetches to the configured bucket, allows only configured-site `/img/*` public media, rate-limits by IP, caps per-file and total ZIP input bytes, and rejects invalid URL batches.

Recommended next step:

- Verify valid HITLOOP deliverable downloads and invalid-host rejection on preview.

#### Turbopack NFT Trace Warning

Status: **partially mitigated**

The `/api/leadgen/generate` function still triggers a Turbopack warning:

> Encountered unexpected file in NFT list

The trace is now much smaller and mostly Firebase/Google runtime dependency closure:

- total files in route NFT: 5,532
- `node_modules`: 5,475
- `api`: 48
- `features`: 3
- `app`: 0
- `public`: 0

Recommended next step:

- Split leadgen disk-writing helpers away from runtime route imports, or move leadgen generation to a separate service/job.
- Re-check Vercel function size after deployment build.

#### Production Environment Verification

Status: **not verified for the new 2026-06-24 route surface**

Must verify before promotion:

- `WORKER_SECRET`
- `CRON_SECRET`
- `SOCIAL_POSTING_CRON_SECRET` if separate from `CRON_SECRET`
- all Stripe tier price IDs:
  - `STRIPE_PRICE_ID_WEEKLY`
  - `STRIPE_PRICE_ID_WEEKLY_PLUS`
  - `STRIPE_PRICE_ID_DAILY`
  - `STRIPE_PRICE_ID_CONTINUOUS`
  - `STRIPE_PRICE_ID_STUDIO`
- `STRIPE_WEBHOOK_SECRET`
- Firebase Admin envs
- Browserless envs
- OpenAI/Anthropic envs
- Studio render service envs
- Firebase Admin envs for `/api/public/hitloop-creative-brief`

Smoke tooling envs are **not production runtime requirements**:

- `PREVIEW_SMOKE_*`
- `ROUTE_SMOKE_*`
- `VERCEL_*` used only by local scripts/tooling

#### Observability And Alerts

Status: **basic logging exists, alerting not confirmed**

Recommended before launch:

- Alert on Vercel 5xx spikes.
- Alert on worker queue age/depth.
- Alert on Browserless failure rate and spend.
- Alert on Stripe webhook failures.
- Monitor Firestore read/write volume.
- Monitor OpenAI/Anthropic spend.

#### Social Posting Cron Auth

Status: **cron path added**

Need to confirm Vercel Cron sends the expected bearer token in production for `/api/social-posting/process-due`. If not, align this route with the daily-digest cron auth helper.

### Low

#### Dirty Working Tree

Status: **production blocker until resolved**

Current pre-flight found 36 modified + 6 untracked files. Generated creative briefs must not be committed:

- `scripts/creative-brief-bryan-balli-WUoltG84.html`
- `scripts/creative-brief-valessa-nhEgZLmg.html`

Recommended before deploy:

- Decide which assets are intentional.
- Commit intentional assets.
- Ignore or remove generated local diagnostics and client outputs.
- Run `git status --short` before promotion.

#### Route Smoke Harness Stale/Hanging

Status: **fixed locally**

`npm run smoke:routes` was previously green but then hung locally and expected old UI copy. It now logs per-route progress, uses direct fetch for `/api/health`, has an unref'd overall timeout, and matches current copy.

Recommended before deploy:

- Keep it as a launch gate and run it before merge/deploy.

#### Admin UI Loading Behavior

Status: **improved, but can polish**

Admin status now comes from `/api/admin/whoami`, but the client may briefly render as non-admin before the admin lookup returns.

Recommended follow-up:

- Add an explicit `adminLoading` state if the flicker is visible in production.

#### Route Smoke Console Noise

Status: **non-blocking**

Latest smoke run passed, but recorded console noise:

- homepage analytics 429s caused by repeated local smoke runs after lowering the rate limit
- `/api/health` browser favicon 404

Recommended follow-up:

- Make API smoke routes use direct `fetch` instead of browser navigation.
- Or suppress known non-page resource noise for API routes.

## Suggested Next Fixes

1. Stage only intentional release files and commit.
2. Deploy a preview and run non-mutating preview smoke with a Vercel bypass secret or public custom-domain preview.
3. Verify `/api/public/hitloop-creative-brief` and `/api/dashboard/deliverable-file` on preview.
4. Run mutating preview smoke only after confirming it targets test/preview resources.
5. Verify Vercel production/preview envs against the required env list.
6. Confirm cron auth for all cron routes in Vercel logs.
7. Add basic alerts for 5xx, worker failures, Stripe webhook failures, and spend spikes.
8. Consider moving leadgen generation to a job/service boundary if the NFT warning persists in Vercel.

## Detailed Pre-Production Optimization Plan

Work this plan in order. Do not promote `main` until Phase 0-4 are complete and verified. Phase 5-7 can run in parallel if the earlier gates stay green.

### Phase 0 — Freeze And Triage The Working Tree

Goal: make the release diff intentional and reviewable.

Tasks:

- Confirm current branch and base: `git status --short --branch`, `git log --oneline --decorate -5`.
- Remove or ignore generated client outputs:
  - `scripts/creative-brief-bryan-balli-WUoltG84.html`
  - `scripts/creative-brief-valessa-nhEgZLmg.html`
- Keep `.gitignore` entry `scripts/creative-brief-*.html`.
- Categorize the 36 modified + 6 untracked files into:
  - brand rename
  - public creative brief route
  - deliverable proxy
  - dashboard/brief UI
  - smoke tooling
  - unrelated/pre-existing edits
- Split into focused commits or a focused PR stack. Do not ship one large mixed commit unless time forces it.

Verification:

- `git status --short --untracked-files=all` shows only intentional untracked files.
- `git diff --stat` is understandable by category.
- Generated client brief HTML files are absent from staged changes.

### Phase 1 — Security And Abuse Hardening

Goal: close public-route and client-data exposure risks before production.

Tasks:

- Harden `app/api/dashboard/deliverable-file/route.js`:
  - restrict to the configured Firebase Storage bucket/project, not broad Storage host suffixes
  - add IP rate limiting
  - add a total ZIP byte cap
  - limit file count and fail closed when the total cap is exceeded
  - avoid logging full tokenized asset URLs
  - consider signed short-lived download tokens instead of raw `u=` passthrough
- Review `app/api/public/hitloop-creative-brief/route.js`:
  - confirm no `clientId`, URL, or query parameter can change the hardcoded HITLOOP client
  - confirm only public/homepage-safe fields render
  - confirm cache headers are acceptable
- Review `DashboardPage.jsx` Share button behavior:
  - if blob-open remains, confirm `briefPreviewHtml` is fully escaped and script-free
  - otherwise prefer opening the server public brief URL instead of a blob HTML copy
- Review iframe sandbox changes:
  - keep `allow-scripts` off unless required
  - only allow popups where the brief/download CTA needs it

Verification:

- Add targeted tests or smoke probes for rejected deliverable proxy URLs.
- Manually verify a valid deliverable still downloads.
- Confirm arbitrary external Storage URLs are rejected.
- Confirm public HITLOOP brief cannot expose another client.

### Phase 2 — Runtime Environment And Preview Deploy

Goal: ensure preview and production have the envs the changed runtime actually needs.

Tasks:

- Confirm Vercel production/preview envs:
  - Firebase Admin envs for public creative brief route
  - Stripe price IDs and webhook secret
  - Browserless envs
  - Studio render envs
  - worker/cron secrets
- Treat `PREVIEW_SMOKE_*`, `ROUTE_SMOKE_*`, and local `VERCEL_*` as tooling-only unless a runtime route explicitly imports them.
- Create a fresh Vercel preview from the cleaned branch.
- Either configure a Vercel protection bypass secret or use an intentional public custom-domain preview for smoke tests.

Verification:

- Preview build is Ready.
- `/api/health` on preview returns app JSON, not Vercel SSO HTML.
- `/api/public/hitloop-creative-brief` returns expected HITLOOP HTML on preview.

### Phase 3 — Test Tooling Repair

Goal: make the launch gates trustworthy again.

Tasks:

- Update `scripts/smoke-routes.mjs`:
  - current homepage/login/dashboard copy
  - per-route progress logging
  - overall timeout
  - direct `fetch` for API-only routes
  - clear failure output instead of silent hangs
- Keep `scripts/smoke-preview.mjs`:
  - Vercel protection bypass support
  - non-mutating default mode
  - mutating mode only for preview/test resources
- Decide whether both scripts are needed. If yes, document when to use each.

Verification:

- `npm run smoke:routes` completes locally.
- `PREVIEW_SMOKE_BASE_URL=<preview> npm run smoke:preview` passes non-mutating checks.
- Mutating smoke is run only after confirming test Stripe/Firebase/worker resources.

### Phase 4 — Build, Test, Audit, And Smoke

Goal: restore objective launch confidence.

Required commands:

- `npm audit --audit-level=moderate`
- `npm test`
- `npm run build`
- `npm run smoke:routes`
- `PREVIEW_SMOKE_BASE_URL=<preview> npm run smoke:preview`

Manual checks:

- Home/login/dashboard redirects.
- Admin access via `admins` collection.
- Public HITLOOP brief loads and does not leak other clients.
- Deliverable downloads work and abuse cases fail closed.
- Creative Brief and Deliverables nav buckets only; locked buckets remain gated.

Verification:

- All required commands pass.
- Any skipped mutating smoke items are documented with reason and owner.
- Screenshots/artifacts saved outside tracked source folders.

### Phase 5 — Performance And Scalability Optimization

Goal: reduce launch latency, cold-start, and cost risk.

Tasks:

- Investigate Turbopack NFT warning from `/api/leadgen/generate`.
- Keep non-launch Leadgen routes out of public launch messaging.
- Avoid importing large route graphs into public routes where possible.
- Confirm public creative brief render is cached and not hammering Firestore.
- Cap deliverable proxy memory/CPU work for zips.
- Confirm dashboard brief preview auto-scroll timers/listeners clean up reliably.

Verification:

- Preview function traces inspected.
- No function bundles unexpectedly include local/generated client folders.
- Public route response times acceptable under repeated requests.

### Phase 6 — UX And Accessibility Polish

Goal: avoid visible launch criticism.

Tasks:

- Revisit `app/dashboard/page.jsx` signed-out blank redirect state; add a minimal fallback if redirect takes longer than a short delay.
- Verify dashboard mobile top padding after `#founders-shell` changes.
- Verify Creative Brief fullscreen title/actions on mobile.
- Verify tile brief preview is scrubbable without accidental fullscreen opens.
- Verify brand rename text is consistent across metadata, schema, nav, footer, admin digest, and public brief.

Verification:

- Browser screenshots desktop/mobile for homepage, login, dashboard signed-out redirect, dashboard authenticated, Creative Brief fullscreen.
- No obvious text overlap or blank states.

### Phase 7 — Release, Monitoring, And Rollback

Goal: ship with an escape hatch.

Tasks:

- Merge focused release branch into `main`.
- Push and verify Vercel production deployment SHA matches `main`.
- Run production non-mutating smoke after deploy.
- Monitor logs for:
  - 5xx
  - Stripe webhook failures
  - Browserless failures
  - Studio render failures
  - worker queue depth/age
  - Firestore read/write spikes
- Keep rollback target identified in Vercel before promotion.

Verification:

- `vercel inspect hitloop.agency` shows Ready and expected commit SHA.
- `/api/health` passes on production.
- Admin access for `bryanballi@gmail.com` verified after deploy.
- Rollback URL/deployment identified.

## Launch Scope Docs (2026-06-23 audit)

Code-verified launch maps for the Creative Brief & Deliverables buckets:

- [PRODUCTION-LAUNCH-CHECKLIST.md](PRODUCTION-LAUNCH-CHECKLIST.md) — scope, gates, env, blockers
- [LAUNCH-DATA-PIPELINE.md](LAUNCH-DATA-PIPELINE.md) — signup→download pipeline + duplicate-run findings
- [CREATIVE-BRIEF-DELIVERABLES-WIRING.md](CREATIVE-BRIEF-DELIVERABLES-WIRING.md) — card/component/API/data-source map
- [ADMIN-DASHBOARD-DATA-MAP.md](ADMIN-DASHBOARD-DATA-MAP.md) — admin telemetry, pulled vs missing
- [DOCS-ACCURACY-REPORT.md](DOCS-ACCURACY-REPORT.md) — doc-by-doc verdicts

Launch-specific items surfaced by that audit (none are hard blockers; Studio render verified working end-to-end on 2026-06-23):

- Ops check: confirm `STUDIO_RENDER_URL` / `STUDIO_RENDER_SECRET` are set in Vercel production. They are set in `.env.local` and read at `studio-render-core.cjs:86`; the blank entries in `.env.example` are an expected template, not a missing prod value.
- Telemetry gap (not a blocker): `render_jobs` is read only by dashboard/worker paths, not by any admin/ops surface — add an admin endpoint or fold into ops-overview if render observability is needed.
- Minor: user brief-run routes (`creative-brief/run`, `marketing-brief/run`) lack an "already-running" guard; rapid direct POSTs stack queued runs. UI-guarded; harden post-launch.

> Correction: an earlier draft listed "remote render service needs redeploy" sourced from `docs/PRODUCTION_READINESS_MASTER_DOC.md` (2026-06-18). Stale — live render works.

## Launch Gate

Before public promotion, require:

- tests pass
- build passes
- audit clean
- smoke routes or preview smoke pass with current copy/redirect expectations
- preview deploy inspected
- Stripe test payment and webhook verified
- admin access verified through `admins` collection
- cron routes verified in Vercel logs
- worker queue drains successfully
- no accidental local artifacts included in deploy
