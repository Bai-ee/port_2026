# Production Launch Checklist — Creative Brief & Deliverables

Last updated: 2026-06-24
Companion to [PRODUCTION-READINESS-TRACKER.md](PRODUCTION-READINESS-TRACKER.md). Scope: launch the Creative Brief and Deliverables buckets only; all other buckets stay gated.

## Launch Scope (explicit)

**In scope (ship):** Creative Brief bucket (`onboarding-brief`, `marketing-brief`), Deliverables bucket (`mockup-studio`, `social-preview`, `multi-device-view`, `cross-device-images`, `style-guide`, `post-me`), the bootstrap/provisioning data behind them, admin visibility for those runs.

**Out of scope (keep gated, do NOT market as ready):** Knowledge Base, Strategy Builder, Leadgen, Social posting automation, all non-launch nav buckets. Code may be present but is not E2E-certified.

## Gates (must pass before public promotion)

- [ ] `npm audit --audit-level=moderate` — 0 vulnerabilities
- [ ] `npm test` — green
- [ ] `npm run build` — passes
- [ ] `npm run smoke:routes` or `npm run smoke:preview` — passes with current UI copy/redirect expectations
- [ ] Preview deploy inspected (function sizes; `/api/leadgen/generate` NFT warning bounded)
- [ ] Stripe test payment + webhook verified on preview
- [ ] Admin access verified via `admins` collection (`/api/admin/whoami` → admin:true)
- [ ] Cron routes confirmed in Vercel logs (daily-digest, render-studio, social-posting)
- [ ] Worker queue drains cleanly
- [ ] No accidental local artifacts in deploy (`git status --short`)
- [ ] No generated creative brief exports committed (`scripts/creative-brief-*.html`)
- [ ] Public HITLOOP creative brief route reviewed and verified
- [ ] Deliverable file proxy hardened or kept out of the release

## Production Env Verification

- [ ] `WORKER_SECRET`, `CRON_SECRET`, `SOCIAL_POSTING_CRON_SECRET`
- [ ] Stripe price IDs: `STRIPE_PRICE_ID_WEEKLY`, `_WEEKLY_PLUS`, `_DAILY`, `_CONTINUOUS`, `_STUDIO`; `STRIPE_WEBHOOK_SECRET`
- [ ] **`STUDIO_RENDER_URL` + `STUDIO_RENDER_SECRET`** — blank in `.env.example`; render-studio cron 500s if unset. **Blocker for Video Promo deliverable.**
- [ ] Browserless: `BROWSERLESS_TOKEN` (+ optional `BROWSERLESS_BASE_URL`)
- [ ] Firebase Admin envs; Anthropic env
- [ ] Firebase Admin envs specifically confirmed for `/api/public/hitloop-creative-brief`
- [ ] Move hardcoded fallbacks out of `daily-digest/route.js` (VERCEL_PROJECT_ID ~22, VERCEL_TEAM_ID ~23, GA4_PROPERTY_ID ~24) into env or confirm intentional.

Smoke-test-only envs are not production runtime requirements:

- `PREVIEW_SMOKE_*`
- `ROUTE_SMOKE_*`
- `VERCEL_*` used by local scripts/tooling

## 2026-06-24 Pre-Flight Items

Pre-flight found 0 commits ahead and 0 staged files. The current branch has a broad uncommitted working tree, so no code ships until intentional files are staged, committed, pushed, previewed, and smoke-tested.

Do not commit:

- `scripts/creative-brief-bryan-balli-WUoltG84.html`
- `scripts/creative-brief-valessa-nhEgZLmg.html`

Current `.gitignore` includes `scripts/creative-brief-*.html` to prevent generated client brief exports from being accidentally tracked.

New public/API surface requiring review:

- `app/api/public/hitloop-creative-brief/route.js`
  - Confirm it only reads the hardcoded HITLOOP client.
  - Confirm Firebase Admin envs in Vercel production.
  - Confirm cache behavior is acceptable for homepage freshness.
- `app/api/dashboard/deliverable-file/route.js`
  - Harden before production or exclude from the release.
  - Restrict to the project bucket/known asset references.
  - Add rate limiting and total ZIP byte cap.
  - Avoid making the app a public arbitrary Storage download/zip proxy.

Visible launch copy change:

- Full brand rename `HIT Agency` → `HITLOOP`.
- Verify metadata, schema, OG tags, header/footer, admin digest, dashboard copy, and public creative brief copy are consistent.

## Known Launch Blockers

None hard. The Studio render path is wired and verified working end-to-end (manual render confirmed 2026-06-23). Items below are ops checks and gaps, not blockers:

1. **Confirm `STUDIO_RENDER_URL` / `STUDIO_RENDER_SECRET` in Vercel production env.** They are set locally in `.env.local` and read at `studio-render-core.cjs:86`; `.env.example` is a blank template (expected). Just verify the prod project has them. *Ops check, not a code blocker.*
2. **Telemetry gap (not a blocker):** `render_jobs` is not read by any admin/ops surface (only dashboard/worker paths read it). Rendering works; admin just can't see queue depth/failures. Add `/api/admin/studio-jobs` or fold into ops-overview if launch needs render observability (see [ADMIN-DASHBOARD-DATA-MAP.md](ADMIN-DASHBOARD-DATA-MAP.md)).

> Correction (2026-06-23): an earlier draft listed "remote render service needs redeploy" as a blocker, sourced from `docs/PRODUCTION_READINESS_MASTER_DOC.md` (2026-06-18). That claim is stale — live render works. Verified against code/runtime, not the doc.

## Recommended Hardening (post-launch, non-blocking)

- Add "already-running" guard to `creative-brief/run` and `marketing-brief/run` (return 409 if `dashboard_state.modules['marketing-brief'].status` is queued/running) — prevents direct-API queue stacking. See [LAUNCH-DATA-PIPELINE.md](LAUNCH-DATA-PIPELINE.md) Risks.
- Pre-aggregated `platform_metrics` doc to cut redundant `clients`/`brief_runs` full scans.
- `usage_events` index (`clientId ASC, createdAt DESC`).
- Observability: alerts on 5xx, worker queue age, Browserless failure/spend, Stripe webhook failures.
- Update route smoke harness so it logs per-route progress, has an overall timeout, and matches current UI copy.

## Docs Status (this audit)

- **Source of truth:** PRODUCTION-READINESS-TRACKER.md; docs/PRODUCTION_READINESS_MASTER_DOC.md (Studio-launch scope).
- **New (this audit):** LAUNCH-DATA-PIPELINE.md, CREATIVE-BRIEF-DELIVERABLES-WIRING.md, ADMIN-DASHBOARD-DATA-MAP.md, this checklist.
- **Stale / should archive:** ACTION-PLAN.md, FULL-AUDIT-REPORT.md (SEO, superseded by GEO-ANALYSIS.md), FABLE5-*.md (task specs, not status), docs/PRODUCTION_HARDENING_PLAN.md. README.md is a stub.
- See [DOCS-ACCURACY-REPORT.md](DOCS-ACCURACY-REPORT.md) for the doc-by-doc verdicts.
