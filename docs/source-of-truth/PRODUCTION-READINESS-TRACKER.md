# Production Readiness Tracker

Last updated: 2026-06-23

This document tracks the current production-readiness hardening work for the local `main` branch. It focuses on launch safety, security, scaling, performance, cost controls, and operational concerns.

## Current Status

Overall launch risk after hardening: **Medium**

Public promotion status: **Much safer than the initial review, but not a blind ship.** The major security and dependency blockers have been addressed. Remaining concerns are mostly deployment-trace noise, operational monitoring, manual production env verification, and working-tree hygiene.

## Verification Snapshot

Latest checks run locally:

- `npm test`: **pass**, 491 tests, 0 failures
- `npm audit --audit-level=moderate`: **pass**, 0 vulnerabilities
- `npm run build`: **pass**
- `npm run smoke:routes`: **pass**, 25 routes, 0 failures

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

Status: **not verified in this pass**

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

Status: **still dirty**

There are pre-existing and new untracked artifacts, especially:

- `scripts/*`
- `public/img/dash.png`
- `public/img/deliverables/*`
- `components/home/HeroDeliverableDeck.jsx`
- `skills-lock.json`

Recommended before deploy:

- Decide which assets are intentional.
- Commit intentional assets.
- Ignore or remove local diagnostics.
- Run `git status --short` before promotion.

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

1. Verify Vercel production/preview envs against the required env list.
2. Deploy to preview and inspect function size/output traces.
3. Confirm cron auth for all cron routes in Vercel logs.
4. Add basic alerts for 5xx, worker failures, Stripe webhook failures, and spend spikes.
5. Clean or intentionally commit the current untracked assets.
6. Consider moving leadgen generation to a job/service boundary if the NFT warning persists in Vercel.

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
- smoke routes pass
- preview deploy inspected
- Stripe test payment and webhook verified
- admin access verified through `admins` collection
- cron routes verified in Vercel logs
- worker queue drains successfully
- no accidental local artifacts included in deploy
