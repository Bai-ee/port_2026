# Opportunity Signals — Market Signals elevated search

**Status:** v1 IMPLEMENTED + SHIPPED 2026-07-24. All 6 phases + X/Twitter search (real X API, `client.v2.search`, entitlement confirmed live) — but X is **dashboard-triggered only** (the "Refresh Now" button), never the automated cron, since X spend is paid-per-call and invisible on the Operating Cost card. Reddit/Instagram refresh automatically in the daily cron; X does not. Full SSOT: [`docs/source-of-truth/OPPORTUNITY-SIGNALS-CARD.md`](../source-of-truth/OPPORTUNITY-SIGNALS-CARD.md). Default OFF per client — nothing runs until enabled.
**Created:** 2026-07-24  
**Owner:** Market Signals / automated brief pipeline  
**One-line:** Add an optional per-client Market Signals lane that searches X/Twitter, Reddit, and Instagram for editable buying-signal terms, analyzes the results, and renders opportunity findings in the dashboard brief and automated email.

---

## Product framing

Opportunity Signals is **not onboarding** and **not leadgen discovery**. It is a separate Market Signals elevation for clients who want the system to look for basic public buying-intent terms across social platforms.

The feature should feel like an extension of existing Market Signals search configuration:

- client can turn it on or off
- client can edit the search terms
- client can choose platforms
- system searches existing platform rails
- analyzer turns raw social results into structured opportunity findings
- dashboard brief and automated email can render the result

HITLOOP is only the first/default template. Do not hardcode HITLOOP-specific terms or services into the core feature.

## Core use case

A client wants to find people or companies publicly signaling a possible need. Examples:

- launching a product, redesign, rebrand, or new site
- frustration with AI-generated design/content
- website not converting
- struggling to create content consistently
- hiring a designer, developer, marketer, or agency
- praising a competitor site, product launch, or campaign

For each client, these terms should be editable just like existing Market Signals query rows.

## Non-goals for v1

Do not:

- add this to onboarding
- write to `leadgen_prospects`
- create a CRM pipeline
- create `opportunity_signals` collection
- send outreach
- auto-create emails
- auto-reply on social
- auto-create social posts

V1 is read-only: search, analyze, render, and prove signal quality.

---

## Configuration

Store the feature config under `client_configs/{clientId}.marketingBriefConfig`.

Suggested shape:

```js
opportunitySignals: {
  enabled: false,
  platforms: ['x', 'reddit', 'instagram'],
  queries: [
    {
      label: 'Launch or redesign',
      query: '"launching" OR "redesigning our website" OR "new product site"',
      enabled: true
    },
    {
      label: 'Bad AI design',
      query: '"AI generated website" OR "AI design looks bad" OR "site looks generic"',
      enabled: true
    }
  ],
  maxQueriesPerRun: 4,
  maxItemsPerPlatform: 10,
  includeInEmail: true
}
```

Default template rows can use the HITLOOP-inspired six trigger categories, but they must be copied into editable client config and treated as user-editable data.

Default template categories:

1. Launch, redesign, rebrand, or new product
2. Frustration with AI-generated design/content
3. Website not converting
4. Difficulty producing content consistently
5. Hiring designer, developer, marketer, or agency
6. Positive reactions to a competitor site, product launch, or campaign

---

## Data flow

```text
client Market Signals config
  -> Opportunity Signals search refresh
  -> stored normalized opportunity pool
  -> opportunity analyzer recipe
  -> reportSnapshot opportunity analysis
  -> dashboard brief section
  -> optional automated email section
```

The search step belongs on the Scout/Market Signals side. Recipes must not fetch data.

## Storage locations

Raw/normalized search results:

```js
dashboard_state/{clientId}.marketingBrief.opportunitySignals
```

Suggested shape:

```js
{
  generatedAt: '2026-07-24T00:00:00.000Z',
  platforms: ['x', 'reddit', 'instagram'],
  queriesTried: [
    { label: 'Launch or redesign', query: '...', enabled: true }
  ],
  items: [
    {
      platform: 'x',
      queryLabel: 'Launch or redesign',
      query: '...',
      title: '...',
      text: '...',
      author: '...',
      handle: '...',
      url: '...',
      publishedAt: '...',
      engagement: {},
      source: '...',
      raw: null
    }
  ],
  meta: {
    maxQueriesPerRun: 4,
    maxItemsPerPlatform: 10,
    warnings: []
  }
}
```

Analyzer result:

```js
dashboard_state/{clientId}.marketingBrief.reportSnapshot.opportunitySignalsAnalysis
```

Suggested shape:

```js
{
  text: '<raw recipe output>',
  generatedAt: '2026-07-24T00:00:00.000Z'
}
```

If the renderer can use parsed JSON, also store parsed opportunities when parseable:

```js
{
  text: '...',
  parsed: {
    opportunities: []
  },
  generatedAt: '...'
}
```

---

## Analyzer recipe

Add a new recipe:

```js
id: 'opportunity-signals',
label: 'Opportunity Signals',
contentKind: 'opportunity-pool'
```

The recipe should analyze only supplied search results and produce structured opportunities.

Expected JSON-first output:

```js
{
  "opportunities": [
    {
      "opportunity": "one-line summary",
      "company": "company if visible, otherwise null",
      "person": "person or handle",
      "platform": "x|reddit|instagram",
      "url": "source URL",
      "currentTrigger": "what they publicly said",
      "likelyProblem": "inferred need, grounded in the source",
      "relevantService": "client-relevant service/category, not hardcoded HITLOOP",
      "possibleResponse": "useful non-pitch angle",
      "confidence": "high|medium|low",
      "score": 0,
      "followUpSuggestion": "what to review or do next",
      "riskNotes": "spam/reputation/context risk"
    }
  ],
  "dataQuality": {
    "itemsAnalyzed": 0,
    "overallConfidence": "high|medium|low",
    "gaps": []
  }
}
```

Scoring should be opportunity-specific, not leadgen-local-business scoring. Suggested rubric:

- trigger strength
- fit to the client category/services
- recency
- reachable person/company
- source evidence quality
- reputational risk

---

## Implementation phases

### Phase 1 — Config and search refresh

Add config support for `marketingBriefConfig.opportunitySignals`.

Create a Scout-side function such as:

```js
refreshOpportunitySignals(clientId)
```

Responsibilities:

- read client config
- skip when disabled
- resolve enabled platforms and enabled query rows
- cap queries with `maxQueriesPerRun`
- search X/Twitter, Reddit, and Instagram using existing platform rails
- normalize all results into one item shape
- dedupe by URL, or fallback key of platform + author + text
- write to `dashboard_state/{clientId}.marketingBrief.opportunitySignals`
- log warnings and cost metadata where current pipeline supports it

Important: use existing platform clients. Do not introduce a new crawler or scraper if the current pipeline already has X/Twitter, Reddit, and Instagram access.

### Phase 2 — Analyzer recipe and recipe-run support

Add `opportunity-signals` recipe.

Update `app/api/dashboard/recipe-run/route.js`:

- treat `contentKind: 'opportunity-pool'` as a stored-pool recipe that does not require `agentData`
- add prerequisite error when no stored opportunity pool exists
- add `contentFor()` branch that returns the opportunity pool
- persist successful result to `marketingBrief.reportSnapshot.opportunitySignalsAnalysis`

### Phase 3 — Worker integration

Update `app/api/worker/pre-digest-refresh/route.js`.

During the `signals` phase:

```js
refreshOpportunitySignals(clientId)
```

During the `analysis` phase:

```js
refreshOpportunitySignalsAnalysis(clientId)
```

Match existing worker conventions:

- best-effort
- never blocks the whole digest
- respects client toggle
- logs usage/cost for analyzer calls
- writes freshness metadata
- disabled clients pay no extra search or analyzer cost

### Phase 4 — Dashboard/report render

Add an Opportunity Signals block to the Market Signals/report surface.

Render:

- top 3-6 opportunities
- platform/source link
- trigger quote or summary
- likely problem
- confidence/score
- possible response angle
- generated timestamp
- empty state when no strong opportunities exist

Keep UI scoped to read-only review. No CRM controls in v1.

### Phase 5 — Automated email section

Add an optional automated email digest section.

Suggested heading:

```text
Opportunity Signals
```

Render top high-confidence items only, usually 3.

Example item:

```text
@person / Company
Signal: "We're redesigning our site..."
Likely need: conversion-focused launch support
Suggested move: reply with a useful teardown angle
Source: Reddit/X/Instagram link
```

Gate the email section with `opportunitySignals.includeInEmail` or the digest include settings, depending on the existing pattern.

### Phase 6 — Settings UI

Expose settings where Market Signals settings currently live:

- toggle: Opportunity Signals on/off
- platform checkboxes: X/Twitter, Reddit, Instagram
- editable query rows
- add/remove rows
- restore default template
- max queries per run
- max items per platform
- include in automated email
- preview/test search if an existing Market Signals source-test pattern can be reused

---

## Acceptance criteria

- A client can enable/disable Opportunity Signals.
- A client can edit opportunity search query rows.
- A client can choose X/Twitter, Reddit, and Instagram platforms.
- Disabled clients incur no extra search or analyzer cost.
- Refresh pipeline searches enabled platforms using enabled queries.
- Results are stored under that client's Marketing Signals state.
- Analyzer produces structured opportunities from stored results.
- Dashboard/report shows an Opportunity Signals section.
- Automated email can include the section when enabled.
- HITLOOP terms are only a starting template, not hardcoded logic.
- No onboarding, leadgen prospect writes, CRM persistence, auto-send, or auto-reply behavior is added in v1.

---

## Files likely involved

- `client_configs/{clientId}.marketingBriefConfig` data shape
- Market Signals settings UI components
- `features/scout-intake/external-scouts/scrapecreators-client.js`
- existing X/Twitter search/watchlist client files
- `features/intelligence/analysis-recipes/recipes.js`
- new recipe prompt file under `features/intelligence/analysis-recipes/`
- `app/api/dashboard/recipe-run/route.js`
- `app/api/worker/pre-digest-refresh/route.js`
- dashboard/report render components
- `app/api/admin/daily-digest/route.js`
- `features/intelligence/_brief-intel.js`
- source-of-truth docs for Market Signals / email digest, if maintained

---

## Master prompt for Sonnet

You are working in `/Users/bballi/Documents/Repos/Bballi_Portfolio`.

Implement **Opportunity Signals** as an optional elevated Market Signals feature using the existing pipeline. This is not onboarding and not leadgen. Do not write to `leadgen_prospects`, do not create a CRM, and do not send or draft outreach in this pass.

Read this plan first:

```text
docs/plans/OPPORTUNITY-SIGNALS-MARKET-SIGNALS-PLAN.md
```

Then inspect the existing implementation before editing:

- `app/api/worker/pre-digest-refresh/route.js`
- `app/api/dashboard/recipe-run/route.js`
- `features/intelligence/analysis-recipes/recipes.js`
- `features/intelligence/_platform-signals.js`
- `features/intelligence/_brief-intel.js`
- `features/scout-intake/external-scouts/scrapecreators-client.js`
- existing Market Signals settings UI
- `app/api/admin/daily-digest/route.js`
- docs/source-of-truth files for Market Signals and the email digest if they are kept current

Build v1 only:

1. Add per-client config under `marketingBriefConfig.opportunitySignals`:
   - `enabled`
   - `platforms`
   - editable `queries`
   - `maxQueriesPerRun`
   - `maxItemsPerPlatform`
   - `includeInEmail`

2. Add a Scout/Market Signals refresh step:
   - create `refreshOpportunitySignals(clientId)` or equivalent
   - read config
   - skip cleanly when disabled
   - run enabled query rows across enabled X/Twitter, Reddit, and Instagram rails already available in the repo
   - cap query count and item count
   - normalize results into one shape
   - dedupe results
   - write to `dashboard_state/{clientId}.marketingBrief.opportunitySignals`
   - keep this best-effort and non-blocking

3. Add an analyzer recipe:
   - recipe id `opportunity-signals`
   - label `Opportunity Signals`
   - `contentKind: 'opportunity-pool'`
   - JSON-first output with `opportunities[]` and `dataQuality`
   - ground every opportunity in supplied content
   - score based on trigger strength, client fit, recency, reachability, evidence quality, and reputational risk
   - do not hardcode HITLOOP services; use client context/config where available

4. Update `app/api/dashboard/recipe-run/route.js`:
   - support `contentKind: 'opportunity-pool'`
   - do not require `agentData` for this recipe
   - return a useful 409 when no opportunity pool exists
   - persist successful analysis to `marketingBrief.reportSnapshot.opportunitySignalsAnalysis`

5. Update `app/api/worker/pre-digest-refresh/route.js`:
   - run the search refresh in the `signals` phase
   - run the analyzer in the `analysis` phase
   - follow existing best-effort worker patterns
   - log analyzer usage/cost consistently with existing recipes
   - disabled clients must pay no extra cost

6. Add rendering:
   - dashboard/report Opportunity Signals block in the Market Signals area
   - automated email section when enabled
   - show top high-confidence items only in email
   - include source links, trigger, likely problem, confidence/score, and suggested response angle
   - add a clean empty state

7. Add settings UI:
   - enable/disable toggle
   - platform checkboxes
   - editable query rows
   - add/remove rows
   - restore default template
   - max query/item controls if consistent with existing settings UX
   - include-in-email toggle

Constraints:

- Keep the implementation additive and aligned with current Market Signals patterns.
- Do not introduce a parallel crawler or new platform abstraction unless the existing rails cannot support this.
- Recipes must not fetch data.
- Do not add persistence collection or CRM status tracking in this pass.
- Do not add automated posting, replying, email drafting, or sending.
- Preserve existing behavior for clients with the feature disabled.
- Add focused tests or smoke checks appropriate to the codebase.

Acceptance criteria:

- Client can turn Opportunity Signals on/off.
- Client can edit opportunity query rows.
- Enabled refresh searches existing X/Twitter, Reddit, and Instagram rails.
- Stored normalized pool appears under `marketingBrief.opportunitySignals`.
- Analyzer runs from stored pool and writes `reportSnapshot.opportunitySignalsAnalysis`.
- Dashboard/report can render the section.
- Automated email can include the section when enabled.
- Disabled clients incur no extra search/analyzer cost.
- No onboarding or leadgen behavior is changed.

After implementation, report:

- files changed
- behavior added
- how to enable it for a client
- tests/smoke checks run
- any platform-specific gaps, especially if X/Twitter search has a narrower existing interface than Reddit/Instagram
