# Opportunity Signals thread — session handoff

**Purpose:** continuity note for picking this body of work back up later. This is NOT a feature SSOT (those already exist, linked below) — it's the "what happened, why, and what's left" for the whole thread that built Opportunity Signals + Proof Builder.

**Thread span:** 2026-07-24 (all work below), captured 2026-07-28.
**Shipped on:** `main`, commits `569453cd` (Opportunity Signals + X search) and `1f1b7f18` (Proof Builder) — both confirmed still in `main`'s history as of 2026-07-28.

⚠️ **Branch note (2026-07-28):** at the time this doc was written, the working tree was on `feat/social-auto-publish`, well ahead of `1f1b7f18` with unrelated shipped work (a per-client auto-publish/email-approval feature, Vercel Hobby packaging fixes, etc. — commits `401a424d` through `17b6d725`). There were also uncommitted local changes to studio files (`app/dashboard/studio/page.jsx`, `services/studio-render/*`) that belong to other in-progress work, not this thread. **Don't assume this doc's "current state" is still current — run `git log --oneline -20` and `git status` first.**

---

## The arc, in order

1. **Reviewed the project CLAUDE.md** against the actual repo state — found the `/recreate` landing page marked "PLANNED" when it had already shipped, and found stale hard-coded line numbers pointing at code that had moved. Both flagged; the doc drift itself is the lesson (line numbers in a living doc rot fast — cite symbol names, not line numbers).

2. **Reviewed `docs/x-content/README.md`** (a manual, X-only, passive capture bucket) against the user's vision for turning public conversations into flagged opportunities. Wrote `docs/plans/OPPORTUNITY-SCOUT-PLAN.md` — a plan-only doc, since superseded by a more refined version the user wrote independently (see next).

3. **User handed off `docs/plans/OPPORTUNITY-SIGNALS-MARKET-SIGNALS-PLAN.md`** — a fully-specified implementation plan (config shape, search/analyzer/storage flow, v1 non-goals, a master prompt). Implemented all 6 phases: config, search refresh (Reddit/Instagram via ScrapeCreators), analyzer recipe, `recipe-run` wiring, worker/cron integration, dashboard REPORT block + email section, settings UI. Verified live with real search + real Anthropic calls before shipping. **Shipped as commit `569453cd`** (this commit already includes the X work from step 4 below — there was only one ship point for the base feature + X together, not two).

4. **User asked to add X/Twitter search**, toggle all platforms in the UI, and confirm the data actually reaches email + the marketing brief. Read `docs/source-of-truth/X-API-AND-PROFILE-OPERATIONS.md` first (mandatory per repo rule before any X work) — found no ScrapeCreators X-search endpoint exists, so X requires the real X API. Asked the user two clarifying questions (X API tier, cron-automation scope) before writing code, since X spend is real and invisible on the Operating Cost card. User answered: entitlement is "paid per use, already working," and explicitly chose **manual-only** (not the automated cron) for X. Built `searchXPosts` in `twitter-service.js`, verified entitlement live (real 10-result test call), then found and fixed a real gap: the search step was previously unreachable from "Generate Report" at all (only cron/admin Email-Digest triggered it) — added the dedicated **Refresh Now** button/route to fix that and to keep X's cost deliberate and visible. Verified the render pipeline against real captured analyzer output (including a fence-wrapping quirk the model exhibited). **Shipped as part of commit `569453cd`.**

5. **User handed off `docs/plans/OPPORTUNITY-SIGNALS-PROOF-BUILDER-PLAN.md`** — the next layer, explicitly scoped as separate from search/analysis: don't let the product jump from "post found" to "AI-written reply" without first identifying what proof makes the response true. Implemented the Proof Builder route, prompt/runner (deliberately kept OUT of the shared `recipes.js` registry), Client Brain proof-context loading (reading the raw structured brain directly, since the shared string-context helper silently drops testimonials/workHistory), and UI (a "Build Proof" button + inline panel per opportunity card). The evidence-before-response rule is enforced twice — once in the prompt, once in code as a safety net. Verified live: HITLOOP's own Client Brain turned out to be `status: draft` (unapproved, empty proof) — a real, useful finding, since it proved the no-context path works correctly, and a second synthetic-rich-context test proved the system stays conservative even when a plausible proof match exists. **Shipped as commit `1f1b7f18`.**

---

## Doc index for this thread

| Doc | What it's for |
|---|---|
| [`docs/plans/OPPORTUNITY-SCOUT-PLAN.md`](OPPORTUNITY-SCOUT-PLAN.md) | Superseded early framing — kept for the original "why," not the as-built. |
| [`docs/plans/OPPORTUNITY-SIGNALS-MARKET-SIGNALS-PLAN.md`](OPPORTUNITY-SIGNALS-MARKET-SIGNALS-PLAN.md) | The real implementation handoff for the search+analyzer feature, now marked shipped. |
| [`docs/source-of-truth/OPPORTUNITY-SIGNALS-CARD.md`](../source-of-truth/OPPORTUNITY-SIGNALS-CARD.md) | **Canonical as-built** for Opportunity Signals (search, X gate, config, render, file map). |
| [`docs/plans/OPPORTUNITY-SIGNALS-PROOF-BUILDER-PLAN.md`](OPPORTUNITY-SIGNALS-PROOF-BUILDER-PLAN.md) | The Proof Builder implementation handoff, now marked shipped. |
| [`docs/source-of-truth/OPPORTUNITY-SIGNALS-PROOF-BUILDER.md`](../source-of-truth/OPPORTUNITY-SIGNALS-PROOF-BUILDER.md) | **Canonical as-built** for Proof Builder (evidence rule, file map, output shape). |
| This doc | The thread-level continuity note — start here, then follow into the two SSOT docs above for as-built detail. |

Session memory (for the assistant, not tracked in git): `opportunity-signals-card.md` and `opportunity-signals-proof-builder.md` in the Claude Code memory store — same content distilled to durable "why" notes.

## Key decisions worth knowing before touching this again

- **X search is dashboard-triggered only, never the automated cron.** `refreshOpportunitySignals(clientId, {allowX})` defaults `allowX` to `false`; only the Refresh Now route passes `true`. This was an explicit user choice (offered "full cron automation" as an alternative, they picked manual-only) because X API spend is paid-per-call and invisible on the Operating Cost card. Don't change this without re-raising the cost-visibility tradeoff.
- **Proof Builder is deliberately not a registered analysis recipe.** It doesn't appear in "04 · Analysis Skills" — it runs per-selected-opportunity from its own button. Registering it in `recipes.js`'s `RECIPES` catalog would let someone enable it report-wide, where it would run over the wrong content.
- **The shared `loadClientBrainContext` string helper drops `proof.testimonials`/`proof.workHistory`** (its `buildUseForContext` only surfaces `projects`/`metrics`). Proof Builder reads the raw structured brain directly via `readClientBrainDoc` instead. If another feature needs testimonials/workHistory from Client Brain, it'll hit the same gap — worth fixing at the source (`features/client-brain/store.cjs`) rather than re-solving per-consumer.
- **HITLOOP's own Client Brain is `status: draft`, not approved, with empty `proof.*`** (confirmed live 2026-07-24). Any demo of Proof Builder's "found real proof" path needs either that brain populated + approved, or a different client that already has one.

## Open items — where a future session would pick this up

From the Opportunity Signals SSOT (`▢scope`):
- No X-spend ledger on the Operating Cost card — X cost is visible only via a UI note + docs, not tracked numerically. Would mean extending `app/api/admin/cost-report/route.js`.

From the Proof Builder SSOT (`▢scope`):
- Not wired into the automated email digest.
- No proof-plan history — only the latest plan per client is persisted (deliberate, to avoid unbounded `dashboard_state` growth), so a keyed map (`proofBuilderRuns[opportunityId]`) would be needed for history.

From the original vision (`docs/plans/OPPORTUNITY-SCOUT-PLAN.md`), still not built and each one is a real product/policy decision, not just code:
- The "3 outputs" per opportunity (public post / tailored reply / private outreach) — Proof Builder deliberately stops at a response *framework*, never a draft. Turning that framework into an actual draft (even a human-reviewed one) is explicitly out of scope for both shipped features and would need fresh user sign-off given the reply/outreach non-goals stated in both plan docs.
- The recurring "Signals from the Loop" content series and the paid "Signal Review" monthly deliverable — marketing/positioning ideas from the original review, never scoped into an implementation plan.
- Populating and approving HITLOOP's own Client Brain, so Proof Builder's richer path is what actually runs for HITLOOP itself in production (today it runs the no-context path).
