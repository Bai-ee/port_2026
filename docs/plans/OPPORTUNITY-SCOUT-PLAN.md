# Opportunity Scout — social buying-signals → prospect pipeline

**Status:** Phase 0 (recon) in progress. Plan-only until Phase 1 is approved.
**Created:** 2026-07-24
**One-line:** Turn public conversations into flagged, persisted, actionable opportunities for HITLOOP, riding the existing Scout search + recipe engine + leadgen store — not a parallel silo.

> Origin: the manual `docs/x-content/` capture bucket (v0, passive archive) + the user's opportunity-flagging vision. This doc productizes that vision onto rails we already run.

---

## Core thesis
This is **not a new system** — it's a **bridge between two existing systems that don't currently talk**:
- `features/leadgen/` (prospector, scorer, discover, estimate + mockup + outreach generators) already prospects for HITLOOP.
- The Market Signals recipe engine (`reply-targets`, reddit/instagram analyzers, the `recipe-run` content router) already searches X/Reddit/Instagram and drafts replies.

Nothing today hunts **social buying-signals** and routes them into the prospect store. That gap is the opportunity.

## Review: README (v0) vs the vision
`docs/x-content/README.md` is deliberately manual + passive: manual capture (`fetch-x-thread.mjs` + browser-pasted replies), **X only**, one thread per `.md`, output is an archive to read later. No trigger-search, no scoring, no persistence, no follow-up, no outputs. The vision is the **active** version. The bucket proved the capture mechanic; this plan makes it a system.

## Objective
Flag, persist, and action HITLOOP opportunities from public conversations, using the existing search + recipe + leadgen rails. Build **HITLOOP-first** (self as client via `homeClientId`) on the **multi-tenant recipe rails**, so any client can later run "find people expressing need for *my* category."

---

## The 6 triggers → query taxonomy
Capture posts where founders/teams express:
1. A launch, redesign, rebrand, or new product
2. Frustration with AI-generated design
3. A website that is not converting
4. Difficulty producing content consistently
5. Hiring a designer, developer, or creative agency
6. Positive reactions to a competitor's site or campaign

## Opportunity tag schema (analyzer output)
Each flagged item:
- `opportunity` — one-line what/why
- `company`
- `person` (@handle / name)
- `currentTrigger` — the public thing they said
- `likelyProblem`
- `relevantService` — the HITLOOP service that fits
- `possibleResponse` — the angle (not a hard pitch)
- `followUpDate`
- `source` / `url` / `confidence` / `score`

## The 3 outputs per opportunity
- **Public post** — HITLOOP's POV on the problem, no direct pitch → Copywriter (`social_posts`).
- **Tailored reply** — useful observation in the conversation → `create-reply-drafts` (`social_posts` w/ `replyTo`).
- **Private outreach** — "here's what I noticed + what I'd improve" → leadgen `email-template` → Gmail **draft**.

---

## Current relevant architecture (what we reuse)
- **Search:** `features/scout-intake/external-scouts/scrapecreators-client.js` (`searchReddit`/`searchInstagram`, prod-safe) + X-via-last30days. Already gated, already costs credits.
- **Analyzer rails:** `app/api/dashboard/recipe-run/route.js` assembles a per-`contentKind` content pool and runs a registered recipe — **writes nothing**. Adding a recipe = one entry in `features/intelligence/analysis-recipes/recipes.js` + one pool builder.
- **Closest existing recipe:** `reply-targets` — same *shape* (score candidates, draft a response per item), different *intent* (prospecting for HITLOOP vs engagement triage for a client).
- **Prospect CRM + generators:** `features/leadgen/` — `prospector.js`, `scorer.js`, `discover`, `estimate-generator.js`, `email-template.js`, `gmail-client.js`.
- **Output paths:** `create-reply-drafts` (social_posts + `replyTo`), Copywriter (social_posts), leadgen `email-template` → Gmail draft.
- **Self-client:** `homeClientId` in `features/intelligence/_digest-config.js`.

## Keep vs change
- **Keep:** manual x-content bucket (reference/proof), recipe-run router, leadgen generators, ScrapeCreators-not-X-API read rule, drafts-only / gated-write discipline.
- **Change (small, additive):** +1 analyzer recipe, +1 query set, +1 pool builder, +1 persistence path, reuse output paths. No new pipeline.

## Files likely involved
- `features/intelligence/analysis-recipes/recipes.js` + new `opportunity-scout.md` (`contentKind: 'opportunity-pool'`).
- `app/api/dashboard/recipe-run/route.js` (assemble the opportunity pool from the buying-signal query set).
- `features/scout-intake/external-scouts/scrapecreators-client.js` (buying-signal query helper).
- `features/leadgen/*` (persistence: extend prospect store with `source:'social-signal'` + tag fields + `followUpDate`/`status`).
- Surface: Market Signals toggle + REPORT block first; promote to a leadgen/prospect view later.
- Output wiring: `create-reply-drafts`, Copywriter, leadgen `email-template`/`gmail-client`.

## Risks
- **Cost:** trigger queries are a *new* search spend on top of Scout (X spend is semi-invisible). → cap query count, dry-run first, run under the gated Scout run, surface on Operating Cost.
- **Signal noise:** need-detection is false-positive-prone. → confidence-scored, human-gated; nothing auto-acts.
- **Outreach/reputation:** cold outreach off scraped posts is a spam/brand risk. → **drafts only, never auto-send**; honor X-write + email-send gates.
- **Scope creep into a full CRM:** cap at flag → follow-up fields → status. No deal pipelines in v1.
- **Positioning layer** (content series / "Signal Review" service) is marketing, not infra — separate, gated.

---

## Phases
- **Phase 0 — recon (no code):** confirm leadgen prospect schema + how `discover` sources today, confirm `homeClientId` resolution, pick persistence target (extend `prospects` vs new `opportunities` collection). Output: 1-page as-built + schema decision (appended below).
- **Phase 1 — read-only analyzer:** add `opportunity-scout` recipe + buying-signal query set + pool builder; render a REPORT block. Writes nothing — proves flag *quality* before persistence. Gate the extra search spend.
- **Phase 2 — persist + follow-up:** write flagged opportunities to the leadgen store (tag schema + `status` + `followUpDate`), dedupe, lightweight review surface.
- **Phase 3 — 3 outputs:** per-opportunity "Draft public post / Draft reply / Draft outreach" reusing Copywriter + `create-reply-drafts` + leadgen email (all drafts, gated).
- **Phase 4 — productize (decision-gated):** "From the Loop" recurring content series + paid "Signal Review" monthly deliverable via the brief/estimate renderers.

## Approval state
- Phase 0: **approved, in progress.**
- Phase 1: pending review of Phase 0 findings.
- Phases 2–4: not approved.

---

## Phase 0 findings

### Leadgen prospect store (as-built)
- Collection **`leadgen_prospects`**, doc ID = **`placeId`** (Google Maps place_id).
- Source today = **SerpAPI Google Maps** (`prospector.js`) → **local brick-and-mortar businesses** by vertical + geo (home base hardcoded `DeKalb, IL`, `constants.js` `GEO_PRIORITY`). Dedupe by place_id; quality floor = `minRating`/`minReviews`.
- Shape: `placeId, name, vertical, phone/email/website/address, lat/lng, rating, reviewCount, businessStatus, campaignId, source:'serpapi_google_maps', stage:'discovered', score, contactedAt, outcome`.
- Pipeline stages (`PIPELINE_STAGES`): discovered → scored → onboarding → auditing → audited → generating → ready → packaged → contacted. Tiers hot/warm/cool/cold by score (`tierFromScore`).

### ⚠️ Schema mismatch — the load-bearing Phase 0 result
A **social opportunity has no `place_id`, no geo, no rating/reviews** — it's keyed by person/handle + post URL. It does **not** fit `leadgen_prospects` (dedupe-by-place_id, geo filter, rating floor all N/A). Forcing it in = square peg.

**Decision: new collection `opportunity_signals`**, doc ID = a stable hash of `person + trigger + url`. Carry the opportunity tag schema + `status` + `followUpDate`, but **deliberately mirror leadgen's `stage`/`score`/tier/`outcome` vocabulary** so both prospect types can share the downstream generators (estimate/email-template/mockup) and a unified review UI later. Local-biz pipeline stays **untouched** (no regression); the social lane evolves independently. Matches the repo's parallel-but-aligned-store pattern.

### recipe-run extension point (as-built)
- Router = `contentFor(recipeId)` switches on `getRecipe(recipeId)?.contentKind`. Add `contentKind:'opportunity-pool'` → new `buildOpportunityPool(...)`.
- **Every current pool is built from already-stored `marketingBrief` data — `recipe-run` never fetches.** `recipes.js` header states the rule explicitly: *recipes do NOT fetch data and do NOT replace Scout.*
- **Therefore the buying-signal search must be a Scout-side step, not the recipe.** Phase 1 = a small search step (mirrors `refreshPlatformSignals` / `pre-digest-refresh`) that runs the trigger queries via `scrapecreators-client` (`searchReddit`/`searchInstagram`) + the X path, writes an `opportunitySignals` blob into `dashboard_state.marketingBrief`, and the recipe reads it via `contentFor`. Keeps Scout-fetches / recipe-analyzes cleanly separated.
- `recipe-run` already: rate-limits, logs usage (`logUsage` module `market-insights`), and grounds every run with **positioning + Client Brain voice**. Run the analyzer under **`homeClientId`** and HITLOOP's own voice grounds it for free.
- Results persist to `marketingBrief.reportSnapshot.<key>` per recipeId → `opportunity-scout` needs its own reportSnapshot key + a render fn (same as `reddit-analysis`/`instagram-analysis`).

### `homeClientId`
Confirmed as a real concept in `_digest-config.js` (defaults to email-resolved client). Phase 1 runs under it; resolve the actual value at runtime.

### Net effect on the phase plan
- Phase 1 gains an explicit **"search is a Scout step, not the recipe"** sub-task (the trigger-query search writer + the `opportunity-pool` reader). Cost gate applies to that search step.
- Phase 2's persistence target is now decided: **new `opportunity_signals` collection**, vocabulary-aligned with `leadgen_prospects` — not an extension of it.
- No blockers found. Phase 1 is safe to build read-only.
