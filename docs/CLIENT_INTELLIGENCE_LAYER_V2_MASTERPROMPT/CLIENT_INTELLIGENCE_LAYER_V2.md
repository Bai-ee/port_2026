# Client Intelligence Layer V2

Owner: Bai-ee / Bballi_Portfolio  
Status: Approved for handoff  
Execution rule: Execute `Phase 1` only. Stop and report before `Phase 2`.

## Objective

Build a formal Client Intelligence Layer that:

1. Sits between external intelligence fetchers and Scout synthesis.
2. Allows new sources to plug in without changing dashboard or pipeline contracts.
3. Stores per-source intelligence cleanly, without overloading `dashboard_state`.
4. Produces two read projections from shared underlying data:
   - `Scout briefing`: compact, deduped, LLM-ready evidence
   - `Admin view`: dense, operational, human-readable source status, cost, and freshness
5. Replaces the current PSI-specific `dashboardState.seoAudit` write path with a source-based model.

Outcome:
- each client has one intelligence namespace
- each source writes independently
- Scout and admin read stable derived projections
- new source modules can be added with minimal surface change

## Current State

Existing code:
- PSI normalizer: [features/scout-intake/psi-audit.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/psi-audit.js:1)
- PSI worker route: [app/api/worker/run-psi/route.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/worker/run-psi/route.js:1)
- PSI rerun route: [app/api/dashboard/rerun-psi/route.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/dashboard/rerun-psi/route.js:1)
- reseed fanout: [app/api/dashboard/reseed-intake/route.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/dashboard/reseed-intake/route.js:18)
- Scout runner: [features/scout-intake/runner.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/runner.js:1)
- synthesizer: [features/scout-intake/intake-synthesizer.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/intake-synthesizer.js:1)
- dashboard UI: [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:718)
- admin control surface: [app/admin/control/page.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/admin/control/page.jsx:1), [AdminPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/AdminPage.jsx:1)

Current issue:
- PSI is a one-off path
- intelligence data is mixed into `dashboard_state`
- there is no shared source contract
- adding future sources would create more ad-hoc branches

## Revised Target Architecture

```text
External fetchers
(features/intelligence/*.js)
        |
        v
   SourceRecord
(per source, validated)
        |
        v
clients/{clientId}/intelligence/
  ├─ master               // meta, digest, totals, source settings
  ├─ sources/{sourceId}   // one doc per source
  └─ events/{eventId}     // optional event ledger, append-only

Read projections
  ├─ Scout briefing projection
  └─ Admin intelligence projection
```

Key correction:
- do not store all source facts, digest, and ledger history in one giant master doc
- store each source separately
- keep `master` small and stable

## Canonical Storage Model

### Locations

- `clients/{clientId}/intelligence/master`
- `clients/{clientId}/intelligence/sources/{sourceId}`
- `clients/{clientId}/intelligence/events/{eventId}`

### `master` doc

```js
{
  meta: {
    schemaVersion: '2.0.0',
    clientId: string,
    updatedAt: FirestoreTimestamp,
    pipelineInjection: boolean,
    briefingTokenEst: number
  },

  sourceSettings: {
    [sourceId]: {
      enabled: boolean,
      refreshPolicy: 'manual' | 'on-intake' | 'hourly' | 'daily' | 'weekly'
    }
  },

  digest: {
    briefingBullets: string[],
    positives: string[],
    gaps: string[],
    risks: string[],
    generatedAt: string,
    totalTokenEst: number
  },

  ledger: {
    totals: {
      usd30d: number,
      quotaUnits30d: number,
      auditsCount30d: number
    },
    byProvider: {
      [provider]: {
        usd30d: number,
        quotaUnits30d: number,
        auditsCount30d: number,
        lastFetchedAt: string | null
      }
    }
  }
}
```

### `sources/{sourceId}` doc

```js
{
  id: string,
  provider: string,
  version: string,
  status: 'live' | 'queued' | 'error' | 'off',
  enabled: boolean,

  fetchedAt: string | null,
  durationMs: number | null,

  cost: {
    usd: number,
    quotaUnits: number,
    model: string | null,
    inputTokens: number | null,
    outputTokens: number | null
  },

  summary: string,
  signals: string[],
  facts: object,

  nextRefreshHint: 'manual' | 'hourly' | 'daily' | 'weekly' | string,
  error: string | null
}
```

Rule:
- every fetcher returns a validated `SourceRecord`
- `SourceRecord` is output-only
- runtime enable/disable behavior is controlled by `master.sourceSettings`, not by reading whether a source doc already exists

### `events/{eventId}` doc

Preferred over array storage.

```js
{
  at: string,
  sourceId: string,
  provider: string,
  kind: 'fetch' | 'error' | 'manual-rerun',
  usd: number,
  quotaUnits: number,
  durationMs: number | null,
  note: string | null,
  runId: string | null
}
```

Reason:
- avoids `arrayUnion` problems
- naturally ordered
- easier to trim/query
- no hot-array contention

## Source Contract

Every intelligence source module must export a fetch function that returns a valid `SourceRecord`.

Example:

```js
{
  id: 'pagespeed-insights',
  provider: 'google-pagespeed-v5',
  version: '1.0.0',
  status: 'live',
  enabled: true,
  fetchedAt: '2026-04-12T21:59:10Z',
  durationMs: 34200,
  cost: {
    usd: 0,
    quotaUnits: 1,
    model: null,
    inputTokens: null,
    outputTokens: null
  },
  summary: 'Mobile performance is poor while SEO fundamentals are strong.',
  signals: [
    'Mobile performance score 44/100',
    'LCP is well above good threshold',
    'Top fix: reduce unused JavaScript',
    'SEO baseline is strong but hygiene gaps remain'
  ],
  facts: {
    strategy: 'mobile',
    websiteUrl: 'https://critters.quest/',
    scores: {},
    coreWebVitals: {},
    labCoreWebVitals: {},
    opportunities: [],
    seoFlags: [],
    accessibilityFlags: [],
    bestPracticesFlags: [],
    insights: [],
    diagnostics: {},
    thirdParties: [],
    cruxDistributions: {},
    lighthouseMeta: {}
  },
  nextRefreshHint: 'manual',
  error: null
}
```

## New Files

- `features/intelligence/index.js`
  - source registry
  - `getSourceModule(sourceId)`
  - `listRegisteredSources()`

- `features/intelligence/_contract.js`
  - validates `SourceRecord`
  - throws field-level validation errors

- `features/intelligence/pagespeed.js`
  - PSI source module
  - replaces logic in current `psi-audit.js`

- `features/intelligence/_digest.js`
  - pure function
  - generates `digest` from source docs

- `features/intelligence/_ledger.js`
  - recalculates totals from recent events
  - no array mutation logic

- `features/intelligence/_store.js`
  - read/write helpers
  - `upsertSource(clientId, sourceRecord)`
  - `setSourceSetting(clientId, sourceId, patch)`
  - `setPipelineInjection(clientId, enabled)`
  - `appendEvent(clientId, event)`

- `api/_lib/intelligence-runner.cjs`
  - shared server function to execute a source, validate output, write source doc, append event, rebuild digest/totals

- `app/api/intelligence/run/route.js`
  - worker-secret gated internal execution route
  - thin wrapper around shared runner

- `app/api/intelligence/rerun/route.js`
  - auth’d user-facing rerun route
  - resolves client from user
  - calls shared runner or internal route

- `app/api/admin/intelligence/route.js`
  - admin-only read API
  - paginated list or single-client detail

## Files To Modify

- [app/api/dashboard/reseed-intake/route.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/dashboard/reseed-intake/route.js:18)
  - replace hardcoded PSI trigger with registry-driven fanout
  - use `master.sourceSettings`
  - default behavior for first run:
    - if no settings exist, run only default-enabled sources from registry

- [app/api/dashboard/rerun-psi/route.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/dashboard/rerun-psi/route.js:17)
  - convert to backward-compatible shim
  - forward to intelligence rerun with `sourceId: 'pagespeed-insights'`

- [app/api/worker/run-psi/route.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/worker/run-psi/route.js:1)
  - keep temporarily as shim
  - migrate logic into shared intelligence runner

- `api/_lib/client-provisioning.cjs`
  - bootstrap should read intelligence namespace
  - return `bootstrap.intelligence`
  - back-compat fallback to `dashboardState.seoAudit` if intelligence source missing

- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:718)
  - read SEO card from `bootstrap.intelligence.sources['pagespeed-insights']`
  - fallback to `dashboardState.seoAudit`
  - keep UI contract stable during migration

- [AdminPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/AdminPage.jsx:28)
  - add intelligence panel here
  - do not duplicate logic in route wrapper

- [features/scout-intake/runner.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/runner.js:1)
  - optional intelligence briefing injection when enabled

- [features/scout-intake/intake-synthesizer.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/intake-synthesizer.js:1)
  - accept `intelligenceBriefing`
  - inject into prompt only when provided

## Admin UI Additions

Implement once in [AdminPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/AdminPage.jsx:28).

New section: `Client Intelligence`

Per-client panel should show:
- client identity
- schema version
- last updated
- pipeline injection toggle
- source table
- ledger totals
- Scout briefing preview
- recent events

Suggested DOM ids:
- `#intelligence-panel-shell`
- `#intelligence-client-selector`
- `#intelligence-sources-table`
- `#intelligence-source-row-{sourceId}`
- `#intelligence-cost-ledger`
- `#intelligence-briefing-preview`
- `#intelligence-recent-events`
- `#intelligence-injection-toggle`

Actions:
- `Re-run`
- `Enable`
- `Disable`
- `Toggle pipeline injection`

## Migration Strategy

### Backfill

- read each existing `dashboard_state/{clientId}.seoAudit`
- wrap as `SourceRecord`
- write to `clients/{clientId}/intelligence/sources/pagespeed-insights`
- generate `master.digest`
- initialize `master.sourceSettings.pagespeed-insights`

### Read-side compatibility

- dashboard/bootstrap prefers intelligence source doc
- falls back to old `dashboardState.seoAudit`

### Write-side cutover

- after backfill, new PSI writes go only to intelligence namespace
- leave old read fallback in place for two releases
- then remove legacy field reads/writes

## Phased Execution

### Phase 1 — Contract + storage

- create `_contract.js`, `_store.js`, `_digest.js`, `_ledger.js`, `index.js`
- create shared storage model with `master` + `sources`
- unit test digest and ledger logic
- no behavior change yet

### Phase 2 — PageSpeed migration

- move PSI logic into `features/intelligence/pagespeed.js`
- implement shared intelligence runner
- add `/api/intelligence/run` and `/api/intelligence/rerun`
- backfill existing PSI data
- switch reseed fanout to registry-driven execution

### Phase 3 — Dashboard read-side

- update bootstrap to return intelligence
- update SEO card to read from intelligence with fallback

### Phase 4 — Admin control

- add `/api/admin/intelligence`
- add intelligence panel to `AdminPage.jsx`
- implement rerun/enable/disable/toggle actions

### Phase 5 — Scout injection

- add opt-in intelligence briefing injection
- keep off by default
- validate quality per client before enabling broadly

### Phase 6 — Cleanup

- deprecate and remove legacy PSI-specific routes/files after migration window

## Acceptance Criteria

### Phase 1

- valid `SourceRecord` writes to `sources/{sourceId}`
- invalid `SourceRecord` fails with field-level validation
- digest generation is deterministic and token-capped
- master doc remains small and projection-focused

### Phase 2

- PSI run writes a valid `pagespeed-insights` source doc
- digest and ledger totals update
- backfill migrates legacy PSI data
- reseed fanout runs default-enabled registered sources

### Phase 3

- SEO card reads new source doc successfully
- fallback to old field still works if new source missing

### Phase 4

- admin panel lists all registered sources
- rerun/enable/disable/pipeline-injection actions persist within seconds
- briefing preview matches current digest
- recent events query returns latest entries in order

### Phase 5

- with injection off, Scout prompt is unchanged
- with injection on, prompt includes briefing before site evidence
- output reflects at least one external intelligence fact in manual QA

## Deferred / Out Of Scope

- charts in admin
- cron scheduling
- desktop PSI variant
- non-PSI fetchers beyond stubs
- per-source digest token budgets
- client self-serve intelligence controls

## Success Signal

After implementation:
- a new intelligence source is added by creating one `features/intelligence/<source>.js` module plus registry entry
- no dashboard schema rewrite is needed
- no Scout pipeline rewrite is needed
- admin gets per-client visibility into source freshness, status, and cost
- Scout can optionally consume a stable intelligence briefing

## Execution Directive

Execute `Phase 1` only.  
Stop and report for approval before `Phase 2`.
