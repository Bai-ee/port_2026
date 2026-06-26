# Marketing Brief Handoff

Last updated: 2026-06-26

## Goal

The dashboard should let a user configure and run a per-client Marketing Brief pipeline from the Marketing Brief card. The flow is intended to reuse the Critters / Not The Rug Scout, Scribe, Guardian quality bar while giving each client customizable Scout instructions, source platforms, watchlists, search rows, and readable founder brief output.

## Current User Expectation

After running the Marketing Brief card, the user expects:

- Scout config is editable from the Marketing Brief card modal.
- Scout source platforms can be checked on/off.
- Approved Client Brain values can seed empty Marketing Brief config fields.
- Saved Marketing Brief settings can be promoted back into Client Brain as feedback decisions.
- Scribe output becomes a proper founder-ready brief, not only raw card rows.
- The designed brief should be readable from the established `Daily Brief` card in the Brief nav bucket.
- The Marketing Brief modal should also have a tab where the generated brief can be read.

## Main Files Touched

- `DashboardPage.jsx`
  - Added Marketing Brief card in the onboarding / Data Visualization card set.
  - Added config state loading/saving/running.
  - Added Scout config modal UI.
  - Added source-platform checkboxes.
  - Added Marketing Brief modal `BRIEF` tab that renders `briefPreviewHtml`.
  - Updated the existing `brief` card to show Marketing Brief rows when marketing data exists.

- `app/api/dashboard/marketing-brief/config/route.js`
  - `GET` / `POST` for `client_configs/{clientId}.marketingBriefConfig`.
  - Normalizes searches, KOLs, competitors, freshness, and `sourcePlatforms`.
  - On `GET`, loads approved Client Brain defaults through `loadClientBrainCardDefaults(..., { cardId:'marketing-brief' })` and fills empty fields only.
  - On `POST`, saves a Client Brain card settings snapshot and promotes durable card settings back into Brain decisions.

- `app/api/dashboard/marketing-brief/run/route.js`
  - Creates a `brief_runs` doc with `pipelineType: 'scout-brief'`.
  - Claims the run locally and calls `runClientPipeline`.
  - Updates `dashboard_state.modules['marketing-brief']`.

- `features/not-the-rug-brief/config-loader.js`
  - Reads `marketingBriefConfig` from Firestore client config.
  - Builds runtime Scout/Scribe/Guardian config from dynamic client settings.
  - Maps enabled source platforms into Scout preferred sources and optional `last30days` sources.

- `features/not-the-rug-brief/xscout.js`
  - Injects custom Scout instructions.
  - Injects enabled source-platform instructions into Scout search and synthesis prompts.

- `api/_lib/run-lifecycle.cjs`
  - `buildDashboardProjection()` now stores Marketing Brief run output under `dashboard_state.marketingBrief`.
  - Sets `modules['marketing-brief']` to succeeded on completion.

- `app/api/dashboard/brief-preview/route.js`
  - Existing route originally only rendered the normal intake `dashboard_state.scribe.brief`.
  - Now falls back to a designed Marketing Brief HTML render when `dashboard_state.marketingBrief` exists.
  - Prefers Marketing Brief render when latest run id matches the Marketing Brief module’s `lastRunId`, or when `?type=marketing` is passed.

## Current Data Flow

1. User opens Marketing Brief card.
2. Dashboard loads config from:
   - `GET /api/dashboard/marketing-brief/config`
   - Firestore: `client_configs/{clientId}.marketingBriefConfig`
   - Approved Client Brain card defaults, applied only to empty config fields.
3. User edits:
   - `sourceFocus`
   - `sourcePlatforms`
   - `searches`
   - `freshnessDays`
   - `kols`
   - `competitors`
   - `scoutInstructions`
   - `agentDataTemplate`
4. User clicks `Run Brief`.
5. Dashboard saves config, then posts to:
   - `POST /api/dashboard/marketing-brief/run`
6. Route calls:
   - `features/not-the-rug-brief/runtime.js`
   - `runClientPipeline({ clientId, clientConfig })`
7. Runtime runs:
   - Scout: `xscout.js`
   - Scribe: `scribe.js`
   - Guardian: called inside Scribe
8. `completeRun()` writes output to:
   - `brief_runs/{runId}`
   - `clients/{clientId}/brief_runs/{runId}`
   - `dashboard_state/{clientId}.marketingBrief`
9. Dashboard fetches designed brief HTML from:
   - `/api/dashboard/brief-preview`
10. The designed Marketing Brief is visible in:
   - Daily Brief card preview when latest run is Marketing Brief.
   - Marketing Brief card modal `BRIEF` tab.
11. Saving config writes a `cardSettingsSnapshot` into Client Brain and, when promoted, updates approved/suggested Brain decisions with `acquisition.method = feedback`.

## Important Current Behavior

Marketing Brief output is not currently stored under `dashboard_state.scribe.brief`. It is stored under:

```js
dashboard_state/{clientId}.marketingBrief = {
  status,
  headline,
  scoutBrief: {
    timestamp,
    humanBrief,
    delta,
    agentData
  },
  content,
  contentOpportunities,
  guardianFlags,
  providerName,
  generatedAtIso
}
```

The established designed preview route now knows how to render that shape.

## Source Platforms

The UI exposes these source toggles:

- `web`
- `x`
- `reddit`
- `instagram`
- `youtube`
- `tiktok`
- `hackernews`

Default enabled:

```js
['web', 'x', 'reddit', 'instagram']
```

Runtime mapping:

- `web` affects broad web/news search.
- `x`, `reddit`, `instagram`, `youtube`, `tiktok`, `hackernews` are passed as preferred sources.
- Social platforms also feed `last30days.sources` when enabled.
- Disabled platforms are explicitly described to Scout as out of scope except for incidental broad web/news coverage.

## Client Brain Defaults And Feedback

Marketing Brief / Market Signals is the first structured Client Brain default consumer.

Read-time behavior:

- The config route loads Brain defaults through `loadClientBrainCardDefaults(context.clientId, { cardId: 'marketing-brief' })`.
- Defaults fill only empty fields.
- Manual card settings are not overwritten.
- The response includes `clientBrainDefaults.fields` and `clientBrainDefaults.appliedFields`.

Save-time behavior:

- The config route saves `marketingBriefConfig` as the card's canonical run config.
- It also calls `saveClientBrainCardSettingsSnapshot(..., { cardId: 'marketing-brief', promote: true })`.
- Promoted values update Brain decisions for search keywords, topics, competitors, handles/platforms, market categories, and identity name.
- Promotion is non-fatal: if Brain save fails, the card config still saves and remains canonical for its own runs.

Precedence:

```text
manual card setting
  > approved Client Brain decision
  > company/default template
  > hardcoded fallback
```

## Known Caveats

- The designed Marketing Brief render in `brief-preview/route.js` is a custom HTML renderer, not the full original intake `brief-renderer.js`.
- It visually follows the established brief style but is not yet a shared renderer module.
- `reporter.js` in `features/not-the-rug-brief` still writes local markdown/html files for static Not The Rug style reports, but the Marketing Brief route currently does not use Reporter output for dashboard display.
- `last30days` is local-tool dependent. If it is unavailable in production, Scout should continue with web search and cached/empty social context.
- Build passes, but there is a pre-existing Turbopack warning from `features/leadgen/client-folder.js` via `next.config.mjs`.

## Verification

Latest verification performed:

```bash
npm run build
curl -I http://127.0.0.1:3000/
```

Result:

- Build passed.
- Localhost responded `HTTP/1.1 200 OK`.
- Existing Turbopack NFT warning remains unrelated.

## Recommended Next Work

0. Keep this handoff aligned with `docs/features/marketing-brief/README.md` and `docs/source-of-truth/MARKET-SIGNALS-AND-SCOUT-PROJECTION.md`.
1. Make `/api/dashboard/brief-preview?type=marketing` explicitly used by the Marketing Brief modal so old intake briefs and marketing briefs can coexist without ambiguity.
2. Consider extracting the Marketing Brief HTML renderer from `app/api/dashboard/brief-preview/route.js` into a reusable module.
3. Add a `Knowledge Sources` layer for durable assets like white papers:
   - Store full source outside prompts.
   - Store a compressed memory summary.
   - Retrieve only relevant chunks when daily Scout findings match.
4. Decide whether Marketing Brief should also write a normalized `dashboard_state.scribe.brief` compatibility projection, or keep the cleaner `dashboard_state.marketingBrief` separation.
5. Add a run-history picker for Marketing Brief outputs so users can view older daily briefs.

## Quick Answer To The Latest Confusion

The reason the user did not originally see the Scribe brief in the Brief bucket was that Marketing Brief output was saved under `dashboard_state.marketingBrief`, while the existing Brief card preview only looked for `dashboard_state.scribe.brief`.

That has been bridged by updating `/api/dashboard/brief-preview` to render `dashboard_state.marketingBrief` when appropriate.
