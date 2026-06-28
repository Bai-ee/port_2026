# SOURCE OF TRUTH

Last verified: 2026-06-23 against branch `codex/launch-docs-pipeline-audit`.
This is the single canonical doc for the launch surface (Creative Brief + Deliverables). If another doc disagrees with this one, this one wins; that other doc is stale.

## How to trust this doc

Every load-bearing claim carries one of these tags. Do not upgrade a tag without redoing the check.

- `✓code file:line` — verified by reading the actual code at that location. Reliable.
- `⚠ops` — depends on production/runtime state (Vercel env, remote service health, a live render). **Cannot be verified from this repo.** Treat as unconfirmed until an operator checks the live system.
- `▢scope` — out of launch scope (gated feature); listed for context only, not certified.

Why the distinction: an earlier draft of these docs asserted a runtime fact ("remote render service needs redeploy") by trusting an older doc, and it was wrong. Code facts and runtime facts are not the same kind of claim and are tagged differently here on purpose.

## Stack `✓code package.json`

Next `^16.2.3` in `package.json` / `16.2.9` installed in `package-lock.json` · React `19.2.0` · firebase `12.12.0` · firebase-admin `13.8.0` · stripe `22.2.0` · @anthropic-ai/sdk `0.78.0` · three `0.165.0` · gsap `3.14.2`.

## Launch scope

**Ship:** Creative Brief bucket + Deliverables bucket (8 cards below). **Gated, do not market:** Knowledge Base, Strategy Builder, Leadgen, Social-posting automation, all other nav buckets `▢scope`.

## Navigation & gating `✓code DashboardPage.jsx`

- Bucket config `CAP_STEPS` — `:2256`.
- Non-admin locks every bucket except `deliverables` — `NON_ADMIN_LOCKED_NAV_KEYS :2240`.
- Non-admin card allowlist — `NON_ADMIN_UNLOCKED_CARD_IDS :2218`.
- Card open handler `openCapabilityCard()` ~`:4570`; non-admin asset overlay `#brief-fullscreen-overlay` ~`:11993`.

## Launch cards `✓code DashboardPage.jsx`

| Card | id:line | Route | Data source (in `dashboard_state`) | Status |
|---|---|---|---|---|
| Creative Brief | `onboarding-brief :2259/:8255` | POST `/api/dashboard/creative-brief/run` | `briefSummaries.onboarding`, `artifacts.*`, `siteMeta`, `studioCaptures` | real |
| Executive/Market Brief | `marketing-brief :2258/:8221` | POST `/api/dashboard/marketing-brief/run` | `marketingBrief.*` | real |
| Video Promo | `mockup-studio :7200` | POST `/api/dashboard/studio-render` | `studioCaptures` (latest video) | real |
| Visual Audit | `style-guide :7248` | module runner | `snapshot.visualIdentity.styleGuide` + `analyzerOutputs` | real (dual-source) |
| Social Preview | `social-preview :7499` | module runner | `siteMeta` | real |
| Multi-Device Mock | `multi-device-view :7585` | module runner | `artifacts.homepageDeviceMockup` + `fullPageScreenshots` | real |
| Full Page Images | `cross-device-images :7635` | module runner | `artifacts.fullPageScreenshots` | real |
| Post Me | `post-me :7684` | client POST-to-X | composed: `studioCaptures`+`siteMeta`+`briefSummaries` (`buildPostMeCaption` ~`:4737`) | derived |

All card data comes from one source (`dashboard_state` via `/api/dashboard/bootstrap`); no card double-reads the same field from `brief_runs`. Timers/`onSnapshot` listeners in this surface all clean up.

**Card ⇄ pipeline data contract** `✓code`: `cardId` is the single join key across the system — it names the module (`module-registry.js`), the projection branch that writes `dashboard_state` (`run-lifecycle.cjs:822 projectModuleResult`), and the card that reads it (`DashboardPage.jsx`). Three producers write `dashboard_state`: (A) scout modules → `run-lifecycle.cjs:822`, (B) studio render → `studio-render-core.cjs:27`, (C) brief summarizer → `briefSummaries`/`marketingBrief`. Full per-card write→read trace + "how to add/change a card" recipe in [CREATIVE-BRIEF-DELIVERABLES-WIRING.md](CREATIVE-BRIEF-DELIVERABLES-WIRING.md#card--pipeline-data-contract).

## Pipeline `✓code` (files confirmed to exist)

`provision/route.js:17` → `queueInitialBriefRun (client-provisioning.cjs:181)` → `bootstrap/route.js:31` → `worker/run-brief/route.js:113` → brief/artifact gen → `dashboard_state` + Storage → cards → `deliverables-zip/route.js:55`. Studio: `studio-render/route.js:60` → `worker/render-studio/route.js:72` → Cloud Run GPU `⚠ops STUDIO_RENDER_URL`. Full map: [LAUNCH-DATA-PIPELINE.md](LAUNCH-DATA-PIPELINE.md).

## Duplicate / double-run posture `✓code`

- Signup run — safe: deterministic runId + atomic `.create()` (`client-provisioning.cjs` ~`:218`).
- Studio render — safe: `createRenderJob` window-dedupes (`studio-render-jobs.cjs:64–90`).
- KB reindex embed — safe + `▢scope`: only re-embeds `pending`/`error` chunks (`features/knowledge-base/embed.js:156`).
- User brief-run routes — **minor real gap**: `creative-brief/run` uses fresh `.doc()` (`:64`), no "already-running" guard → rapid direct POSTs stack runs. UI-guarded; worker serial. Harden post-launch.

## Collections `✓code` (launch)

`clients`, `clients/{id}/brief_runs`, `brief_runs`, `users`, `members`, `client_configs`, `dashboard_state`, `render_jobs`, `browserless_requests`, `usage_events`, `admins`. Out of scope: `chunks`/`knowledge_items`, `social_posts`, `leadgen_prospects` `▢scope`.

## Cron `✓code vercel.json`

`/api/admin/daily-digest` `0 13 * * *` · `/api/worker/render-studio` `15 13 * * *` · `/api/social-posting/process-due` `*/15 * * * *`.

## Admin telemetry `✓code`

Pulls: client list, brief run history, run detail, dashboard state, artifact refs, cost. **Does not pull `render_jobs`** — no admin/ops surface reads it (grep-confirmed); render works but queue health is invisible to ops. Detail: [ADMIN-DASHBOARD-DATA-MAP.md](ADMIN-DASHBOARD-DATA-MAP.md).

## Open items — none are hard blockers

- `⚠ops` Confirm `STUDIO_RENDER_URL`/`STUDIO_RENDER_SECRET` in Vercel prod. Set in `.env.local`, read at `studio-render-core.cjs:86`; blank in `.env.example` is an expected template. Render verified working 2026-06-23.
- `⚠ops` Confirm Stripe price IDs + webhook secret in prod; run a test payment.
- Gap (not blocker): add admin visibility for `render_jobs`.
- Gap (not blocker): "already-running" guard on user brief-run routes.

## What this doc does NOT certify

- Live production env values, remote GPU service health, Stripe live mode — all `⚠ops`, require an operator on the live system.
- Gated features `▢scope` — code may exist but is not E2E-certified here. Strategy Builder / Editorial Pack tracking lives in [STRATEGY-BUILDER-EDITORIAL-PACK.md](STRATEGY-BUILDER-EDITORIAL-PACK.md).
- Anything in `docs/` not linked from this file — assume stale until checked against code.

## Canonical doc set

This file → [PRODUCTION-LAUNCH-CHECKLIST.md](PRODUCTION-LAUNCH-CHECKLIST.md) · [LAUNCH-DATA-PIPELINE.md](LAUNCH-DATA-PIPELINE.md) · [CREATIVE-BRIEF-DELIVERABLES-WIRING.md](CREATIVE-BRIEF-DELIVERABLES-WIRING.md) · [EXECUTIVE-BRIEFS-RUN-BRIEFS-WIRING.md](EXECUTIVE-BRIEFS-RUN-BRIEFS-WIRING.md) · [VIDEO-REMIX-EDITVIDEOS-BRIDGE.md](VIDEO-REMIX-EDITVIDEOS-BRIDGE.md) · [MARKET-SIGNALS-AND-SCOUT-PROJECTION.md](MARKET-SIGNALS-AND-SCOUT-PROJECTION.md) · [EMAIL-DIGEST-CARD.md](EMAIL-DIGEST-CARD.md) · [ADMIN-DASHBOARD-DATA-MAP.md](ADMIN-DASHBOARD-DATA-MAP.md) · [PRODUCTION-READINESS-TRACKER.md](PRODUCTION-READINESS-TRACKER.md) · [DOCS-ACCURACY-REPORT.md](DOCS-ACCURACY-REPORT.md). Gated feature tracking: [STRATEGY-BUILDER-EDITORIAL-PACK.md](STRATEGY-BUILDER-EDITORIAL-PACK.md). SEO: [../seo/GEO-ANALYSIS.md](../seo/GEO-ANALYSIS.md).

## Active Supporting Docs

These are active but not launch-certification docs:

- Gated Client Brain / Company Brain: [../company-brain/README.md](../company-brain/README.md)
- Marketing Brief feature docs: [../features/marketing-brief/README.md](../features/marketing-brief/README.md)
- Strategy Builder / Editorial Pack feature docs: [../features/editorial-strategy/README.md](../features/editorial-strategy/README.md)
- Mockup Studio feature docs: [../features/studio/README.md](../features/studio/README.md)
