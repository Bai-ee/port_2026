# GBP Reputation Card — Source of Truth

Last verified: 2026-06-25 against branch `main`.
Canonical doc for the **Google Business Profile Reputation** feature. If another doc disagrees, this one wins.

Tags: `✓code file:line` = verified in code · `▢scope` = planned, not built.

## What it is

A local-business reputation feature: monitors GBP reviews, flags reviews that need owner replies (negatives first), drafts reply copy, and surfaces profile-completeness + local-SEO gaps with one priority action.

**It is NOT a standalone dashboard tile.** It ships as a **toggle inside the Market Signals card** ("what we're listening to"), and renders a block in that card's REPORT tab. v1 is **diagnostic + reply drafts only — nothing publishes to Google.**

Plan / phase roadmap: [`docs/plans/GBP-REPUTATION-CARD-PLAN.md`](../plans/GBP-REPUTATION-CARD-PLAN.md).
Related: [`MARKET-SIGNALS-AND-SCOUT-PROJECTION.md`](./MARKET-SIGNALS-AND-SCOUT-PROJECTION.md).

## Where to find it (UI)

1. Dashboard → open **Market Signals** card (`signals`, growth nav "WHAT'S GOING ON IN THE MARKET").
2. **SOURCES** tab → **"05 · Local Reputation"** section → toggle **Google Business Profile** ON.
3. **REPORT** tab → the **Local Reputation** block renders.

## File map

| Concern | File | Notes |
|---|---|---|
| Pure analyzer (source of truth) | `features/gbp-reputation/analyzer.js` `✓code` | `analyzeGbpReputation(raw)` → normalized shape. Deterministic, no LLM, no I/O. |
| Local-SEO checklist | `features/gbp-reputation/seo-checklist.js` `✓code` | 25 items / 5 categories, tokenized `{{brand}}`/`{{site}}`. `resolveChecklist(completedIds, opts)`. |
| Reply templates | `features/gbp-reputation/reply-templates.js` `✓code` | positive/neutral/negative drafts. `suggestReply(review, {brand,phone})`. |
| Rosita's mock payload | `features/gbp-reputation/rositas-mock.js` `✓code` | `ROSITAS_GBP_PAYLOAD` + `ROSITAS_GBP_DISCONNECTED`. Raw GBP review shape. |
| Analyzer adapter | `features/scout-intake/analyzers/gbp-reputation.js` `✓code` | `run({card,sharedResults})` → standard analyzer envelope. Reads `sharedResults.externalSignals.googleBusinessProfile`. |
| Analyzer registration | `features/scout-intake/analyzers/index.js` `✓code` | `REGISTRY['gbp-reputation']`. |
| Card contract | `features/scout-intake/card-contract.js` `✓code` | id `gbp-reputation`, tier `paid`, `analyzer.impl='gbp-reputation'`, `sourceField='externalSignals.googleBusinessProfile'`. |
| Static fallback copy | `features/scout-intake/card-static-copy.js` `✓code` | `'gbp-reputation'` entry. |
| **Client report data** | `lib/gbpReputationReport.js` `✓code` | **Precomputed ESM copy** of the analyzer output for Rosita's. See gotcha below. |
| Toggle + report block (UI) | `DashboardPage.jsx` `✓code` | `signals-local-reputation-section`, `toggleGbpReputation`, `renderGbpReputationBlock`. State: `marketingBriefConfig.gbpReputation.enabled`. |
| Tests | `features/gbp-reputation/__tests__/gbp-reputation.test.js` `✓code` | analyzer states + adapter + contract + drift guard. |

## Data flow

```
raw GBP payload (Rosita's mock today; live OAuth later ▢scope)
        │
        ▼
analyzeGbpReputation(raw)  ── deterministic ──►  normalized shape
        │                                              │
   (server/pipeline)                              (client UI)
        │                                              │
 scout-intake analyzer adapter                 lib/gbpReputationReport.js (precomputed)
 reads externalSignals.googleBusinessProfile          │
        │                                       renderGbpReputationBlock()
        ▼                                       in Market Signals REPORT tab
 standard analyzer envelope → Scribe (copy)
```

The analyzer runs automatically for `paid` tier inside `runAnalyzers` (`pickCards` includes paid cards). With no GBP data it degrades cleanly to a setup-needed signal — it never throws.

## Normalized shape (analyzer output)

```js
{
  connected, setupRequired,
  locationName, profileUrl, ratingAverage, reviewCount,
  unrepliedCount, negativeUnrepliedCount,
  newestReviews[], reviewsNeedingReply[], negativeReviews[],
  suggestedReplies[{ reviewName, reviewer, rating, sentiment, draft }],
  profileHealth{ hasWebsite, hasPhone, hasHours, hasPhotos, hasRecentPosts, hasMenuOrProducts },
  profileGaps[], seoChecklist{ completed, total, priorityItems[] },
  riskLevel,        // 'setup' | 'urgent' | 'attention' | 'healthy'
  priorityAction{ label, reason, severity }   // severity: setup|high|medium|low
}
```

**Priority precedence (deterministic):** negative-unreplied (`urgent`/high) → any unreplied (`attention`/medium) → profile/SEO gaps (`healthy`/low) → all clear (`healthy`/low). Disconnected/null → `setup`.

## ⚠ Gotcha: client cannot import the CJS analyzer

`features/gbp-reputation/` has `package.json {"type":"commonjs"}` (so `node --test` and CJS `require()` work). Importing any file from that dir into the **client** `DashboardPage.jsx` breaks `next dev --webpack`: React Fast Refresh injects `import.meta.webpackHot` into the module, which is illegal in a CJS script (`Module parse failed: Cannot use 'import.meta' outside a module`). `next build` does NOT catch this — only dev does.

**Rule:** the client renders from `lib/gbpReputationReport.js` (ESM, governed by root `type:module`), a **precomputed** copy of the analyzer output. A drift-guard test asserts it deep-equals `analyzeGbpReputation(ROSITAS_GBP_PAYLOAD)`. **If you change the analyzer or the mock, regenerate it:**

```bash
node -e "const fs=require('fs');const {analyzeGbpReputation}=require('./features/gbp-reputation/analyzer');const {ROSITAS_GBP_PAYLOAD}=require('./features/gbp-reputation/rositas-mock');fs.writeFileSync('lib/gbpReputationReport.js','export const ROSITAS_GBP_REPORT = '+JSON.stringify(analyzeGbpReputation(ROSITAS_GBP_PAYLOAD),null,2)+';\n')"
```

(The test will fail loudly if you forget.)

## How to extend

- **Add a real client (e.g. Rosita's once created):** write its GBP payload to `dashboard_state.externalSignals.googleBusinessProfile` (raw review shape). The pipeline analyzer picks it up via `sourceField`. For the live UI, replace the precomputed client import with per-client projection plumbing (today it's hardcoded to the Rosita's mock).
- **Add live GBP data (Phase 4 ▢scope):** OAuth + pull location/reviews/posts → normalize to the raw payload shape → store in `externalSignals.googleBusinessProfile`. Keep OAuth/publishing out of the analyzer (stays pure).
- **Change reply tone:** edit `reply-templates.js`; Scribe rewrite for brand voice is Phase 5 (`▢scope`).
- **Change the checklist:** edit `seo-checklist.js` (keep `{{brand}}`/`{{site}}` tokens).

## Phase status

- ✅ Phase 1-3 (analyzer + mock + contract + Market Signals toggle/report).
- ▢scope Phase 4 (OAuth), Phase 5 (Scribe rewrite + Guardian checks), Phase 6 (publish-with-approval). See plan doc.
