# Opportunity Signals — Source of Truth

Last verified: 2026-07-24 against branch `main`.
Canonical doc for the **Opportunity Signals** feature. If another doc disagrees, this one wins.

Tags: `✓code file:line` = verified in code · `▢scope` = planned, not built.

## What it is

A public buying-signal scan: searches a client's editable query rows (launch/redesign, AI-design frustration, site-not-converting, hiring a designer/dev/agency, praising a competitor, etc.) across X/Reddit/Instagram, scores what it finds as client opportunities (trigger, likely problem, relevant service, non-pitch response angle), and renders them in the dashboard REPORT tab and an optional email section.

**It is NOT a standalone dashboard tile, not onboarding, and not leadgen discovery.** It ships as a **toggle inside the Market Signals card** ("06 · Opportunity Signals"), same pattern as GBP Reputation. **v1 is read-only** — it finds and scores, it never posts, replies, drafts outreach, or writes to `leadgen_prospects`/any CRM.

Plan / build history: [`docs/plans/OPPORTUNITY-SIGNALS-MARKET-SIGNALS-PLAN.md`](../plans/OPPORTUNITY-SIGNALS-MARKET-SIGNALS-PLAN.md) (the implementation handoff + acceptance criteria). Earlier framing doc (superseded — kept for the original "why"): [`docs/plans/OPPORTUNITY-SCOUT-PLAN.md`](../plans/OPPORTUNITY-SCOUT-PLAN.md).
Related: [`MARKET-SIGNALS-AND-SCOUT-PROJECTION.md`](./MARKET-SIGNALS-AND-SCOUT-PROJECTION.md) · [`SEARCHABLE-PLATFORMS.md`](./SEARCHABLE-PLATFORMS.md) · [`X-API-AND-PROFILE-OPERATIONS.md`](./X-API-AND-PROFILE-OPERATIONS.md) · [`EMAIL-DIGEST-CARD.md`](./EMAIL-DIGEST-CARD.md).

## Where to find it (UI)

1. Dashboard → open **Market Signals** card (`signals`).
2. **SOURCES** tab → **"06 · Opportunity Signals"** section → toggle **Opportunity Signals** ON.
3. Pick platforms (X / Reddit / Instagram), edit query rows (or use the default template), set max queries/items, set the email toggle → **Save**.
4. Click **Refresh Now** to search immediately (see §X below for why this button exists).
5. Turn the `opportunity-signals` recipe ON under **"04 · Analysis Skills"**, then **Generate Report** (or **Update report only**) → the **REPORT** tab renders the **Opportunity Signals** block.

## ⚠️ X/Twitter — read this before touching the search step

There is **no ScrapeCreators endpoint for X search** (only profile/user-tweets/tweet/transcript/community — see [`docs/x-content/README.md`](../x-content/README.md)). X search uses the **real X API** (`features/social-posting/twitter-service.js` → `searchXPosts`, `client.v2.search`, OAuth 1.0a user-context, the same credentials `@bai_ee` already uses for posting). Confirmed live 2026-07-24: the enrolled account **is** entitled to the recent-search endpoint (10 real results returned on a test query).

Per [`X-API-AND-PROFILE-OPERATIONS.md`](./X-API-AND-PROFILE-OPERATIONS.md) §3: **X API spend is paid per call and invisible on the Operating Cost card.** Because of that:

- **X only searches from a deliberate dashboard click — never the automated daily cron.** `refreshOpportunitySignals(clientId, { allowX })` silently drops `'x'` from the platform list (with a warning in the stored `meta.warnings`) unless `allowX: true` is passed.
- The **only** caller that passes `allowX: true` is `app/api/dashboard/opportunity-signals/refresh/route.js` `✓code` — the **Refresh Now** button in the settings section.
- `app/api/worker/pre-digest-refresh/route.js` `✓code` calls `refreshOpportunitySignals(clientId)` with no options (`allowX` defaults `false`), so both the Vercel cron and the Email Digest's "Run & Send" refresh Reddit/Instagram automatically but **never** touch X.
- The settings UI shows a cost note next to the platform row when X is toggled on (`opportunity-signals-x-cost-note`).

**Do not** wire X into the automated refresh path without re-reading the X-API SSOT and confirming spend expectations again — that doc's own checklist applies.

## File map

| Concern | File | Notes |
|---|---|---|
| Search refresh (Reddit/Instagram/X) | `features/scout-intake/opportunity-signals-search.js` `✓code` | `refreshOpportunitySignals(clientId, {allowX})` — reads client config, caps queries/items, dedupes by URL, persists. Reddit/Instagram via `scrapecreators-client.js`; X via a dynamic `import()` of `twitter-service.js` (ESM from this CJS module). |
| X search client | `features/social-posting/twitter-service.js` `✓code` | `searchXPosts(query, {limit})` — `client.v2.search`, 403 = tier not entitled (treated as a hard stop, matches `fetchHandleTimelines`'s existing convention). |
| Manual refresh route (the only `allowX:true` caller) | `app/api/dashboard/opportunity-signals/refresh/route.js` `✓code` | Auth + rate-limited POST. Powers the **Refresh Now** button. |
| Analyzer recipe | `features/intelligence/analysis-recipes/opportunity-signals.md` + registered in `recipes.js` `✓code` | `contentKind: 'opportunity-pool'`. JSON-first `{opportunities[], dataQuality}`. Client-agnostic — `relevantService`/`possibleResponse` are grounded in the supplied CLIENT CONTEXT (positioning + Client Brain voice), never a hardcoded brand. |
| Recipe execution | `app/api/dashboard/recipe-run/route.js` `✓code` | `contentFor()` returns `marketingBrief.opportunitySignals` for this recipe; 409 when the pool is empty; persists to `reportSnapshot.opportunitySignalsAnalysis`. |
| Worker integration | `app/api/worker/pre-digest-refresh/route.js` `✓code` | `refreshOpportunitySignals` in the `signals` phase, `refreshOpportunitySignalsAnalysis` (new fn, mirrors `refreshRedditAnalysis`) in the `analysis` phase. Both skip cleanly (no cost) when the client's toggle is off. |
| Config | `app/api/dashboard/marketing-brief/config/route.js` `✓code` | `marketingBriefConfig.opportunitySignals` — `normalizeOpportunitySignals()`; omitted field preserves prior save (same convention as `events`/`localSignals`). |
| Canonical projection | `features/intelligence/_brief-intel.js` `✓code` | `projectBrief().opportunitySignalsAnalysis` — same pattern as `redditAnalysis`/`instagramAnalysis`. Extend here, never re-read `reportSnapshot` in a consumer. |
| Email section | `app/api/admin/daily-digest/route.js` `✓code` | `buildOpportunitySignalsBriefSection()`, gated by `include.opportunitySignals` (default off) **and** the feature's own `enabled`/`includeInEmail`. Caps at the top 3 opportunities. |
| Digest include key | `features/intelligence/_digest-config.js` `✓code` | `INCLUDE_KEYS` + `DEFAULT_INCLUDE.opportunitySignals: false`; legacy `marketingBrief` coarse key expands to include it. |
| Dashboard REPORT block | `components/dashboard/MarketSignalsReportBlocks.jsx` `✓code` | `OpportunitySignalsBlock` — mirrors `RedditAnalysisBlock`'s structure (meta grid, cards, gaps, prose fallback), one card per opportunity. |
| Settings UI | `DashboardPage.jsx` `✓code` | `signals-opportunity-signals-section` — enable toggle, platform buttons, `mu-query-list` editable rows, max query/item inputs, include-in-email toggle, **Refresh Now** + Save. |

## Data flow

```
client Market Signals config (opportunitySignals: enabled, platforms, queries[], maxQueriesPerRun, maxItemsPerPlatform, includeInEmail)
        │
        ▼
refreshOpportunitySignals(clientId, {allowX})           ◄── cron / Run&Send: allowX=false (Reddit+Instagram only)
  searches enabled platforms × enabled query rows        ◄── Refresh Now button: allowX=true (adds X)
  normalizes + dedupes by URL, caps per platform
        │
        ▼
dashboard_state/{clientId}.marketingBrief.opportunitySignals   (the stored pool)
        │
        ▼
opportunity-signals recipe (via recipe-run, interactive "04 Analysis Skills" / Generate Report)
  scores: trigger strength, client fit, recency, reachability, evidence quality, reputational-risk deduction
        │
        ▼
dashboard_state/{clientId}.marketingBrief.reportSnapshot.opportunitySignalsAnalysis
        │
   ┌────┴─────┐
   ▼          ▼
REPORT tab   Email digest (if include.opportunitySignals + feature includeInEmail)
```

## Normalized pool item shape

```js
{ platform, queryLabel, query, title, text, author, handle, url, publishedAt, engagement, source, raw: null }
```

## Analyzer output shape

```js
{
  opportunities: [{
    opportunity, company, person, platform, url, currentTrigger, likelyProblem,
    relevantService, possibleResponse, confidence, score, followUpSuggestion, riskNotes,
  }],
  dataQuality: { itemsAnalyzed, overallConfidence, gaps[] },
}
```

## Verified live (2026-07-24)

- Reddit + Instagram search: real results returned (20 items across 3 query rows, one Instagram row returned a legitimate zero-result 404 that ScrapeCreators did **not** charge for).
- X search: entitlement confirmed live (10 real results via `client.v2.search`).
- Analyzer: real Anthropic call over the real search pool produced grounded, scored opportunities (a $500–800 Reddit hiring post scored 9/10; correctly flagged when it had no X data rather than inventing any).
- Render pipeline: `parseRecipeAnalysis` correctly extracts the JSON block even when the model wraps its response in a ` ```json ` fence (contrary to the prompt's explicit instruction not to) — verified against the actual captured live output.

## Non-goals (v1)

- No write to `leadgen_prospects`, no CRM/pipeline/status tracking.
- No automated posting, replying, or outreach drafting.
- No onboarding integration — this is a Market Signals opt-in only.
- HITLOOP's six trigger categories are only the **default template** copied into each client's editable config — never hardcoded core logic. `relevantService`/`possibleResponse` in the analyzer prompt explicitly draw from the supplied CLIENT CONTEXT, not a fixed brand.

## How to extend

- **Add a platform:** add a `search<Platform>()` to the relevant client (`scrapecreators-client.js` for ScrapeCreators-backed platforms, `twitter-service.js`-style for anything needing its own paid API), add it to `SUPPORTED_PLATFORMS` in `opportunity-signals-search.js`, add the job-dispatch branch, add the checkbox in the settings UI.
- **Change the scoring rubric or output fields:** edit `opportunity-signals.md` AND its embedded twin in `recipes.js` (serverless can't read the `.md` at runtime — keep them in sync, matching every other recipe in this file).
- **Track X cost properly:** today only a stored-pool warning + this doc note make X spend visible; there is no ledger entry. Adding one means extending `app/api/admin/cost-report/route.js` with an X API line — not done, `▢scope`.

## Phase status

- ✅ Phases 1–6 (config, search incl. X, analyzer, recipe-run, worker integration, email + dashboard render, settings UI) — all live, build-verified, and functionally verified with real live data (search + analyzer + render parsing).
- ▢scope Cost ledger for X API spend on the Operating Cost card.
- ▢scope Silent-truncation follow-through: no bootstrap-side hydration of a prior `opportunity-signals` recipe run from Firestore on page load (mirrors existing `reddit-analysis`/`instagram-analysis` — the dashboard REPORT tab shows the last run from local session state, not auto-rehydrated from `reportSnapshot` on refresh; this matches the existing convention for those two recipes, not a new gap).
