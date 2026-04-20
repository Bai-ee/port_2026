# Modular Card Pipeline Implementation Spec

## Goal

Move onboarding from one broad intake run into a modular card system where:

- users start with one foundational card
- cards can be enabled one at a time
- successful cards persist and are not rerun automatically
- failed cards can be retried independently
- the dashboard explains which tech each card uses and why a card did or did not render

This spec is written against the current codebase and names the files that should be changed.

> **Before authoring a new card module, read [`PRODUCTION_HARDENING/CARD_MODULE_VERCEL_GOTCHAS.md`](./PRODUCTION_HARDENING/CARD_MODULE_VERCEL_GOTCHAS.md).** It covers Vercel-specific runtime traps (static assets not in the lambda, deployment-protected URLs, `after()` for post-response work, warning-object shape, screenshot variant key mapping) that have each burned a full debug cycle.

---

## Product Rules

1. First run should only execute the foundational card.
2. Default foundational card: `multi-device-view`.
3. A successful card should keep showing its last successful result until the user explicitly reruns it.
4. A failed card should show its failure reason and a retry action.
5. A disabled card should explain what it does, what data it uses, and what tech it requires.
6. Running one card should not rerun unrelated cards.
7. Shared prerequisites may still run when needed, but only to satisfy dependencies for the selected card.

---

## Current Architecture

Current intake is centered around:

- [features/scout-intake/runner.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/runner.js)
- [api/_lib/run-lifecycle.cjs](/Users/bballi/Documents/Repos/Bballi_Portfolio/api/_lib/run-lifecycle.cjs)
- [api/_lib/client-provisioning.cjs](/Users/bballi/Documents/Repos/Bballi_Portfolio/api/_lib/client-provisioning.cjs)
- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx)

Today, one run attempts to produce many card inputs at once:

- site fetch + crawl
- screenshots
- device mockup
- PSI
- AI SEO
- synthesis
- style guide
- analyzer outputs
- scribe output

This is the root cause of:

- high first-run cost
- fragile first-run UX
- card-to-card coupling
- unnecessary reruns
- unclear failure attribution

---

## Target Architecture

Add a module system where each onboarding card maps to a module definition.

Each module defines:

- id
- card id
- label
- dependencies
- required inputs
- produced outputs
- underlying tech/services
- persistence policy
- retry policy

The pipeline becomes:

1. user enables a card
2. backend resolves required dependencies
3. only required steps run
4. successful module result is persisted separately
5. dashboard renders from module state, not from “did the giant run happen”

---

## Firestore Schema

Recommended storage location:

- primary config/state: `client_configs/{clientId}`
- dashboard projection: `dashboard_state/{clientId}`

### 1. Module configuration

Store in:

- `client_configs/{clientId}.moduleConfig`

Shape:

```json
{
  "multi-device-view": {
    "enabled": true,
    "autoRunOnSignup": true
  },
  "social-preview": {
    "enabled": false,
    "autoRunOnSignup": false
  },
  "seo-performance": {
    "enabled": false,
    "autoRunOnSignup": false
  }
}
```

### 2. Module execution state

Store in:

- `dashboard_state/{clientId}.modules`

Shape:

```json
{
  "multi-device-view": {
    "status": "idle|queued|running|succeeded|failed|disabled",
    "enabled": true,
    "lastAttemptRunId": "run_abc",
    "lastSuccessfulRunId": "run_xyz",
    "lastAttemptAt": "serverTimestamp",
    "lastSuccessAt": "serverTimestamp",
    "lastErrorCode": "mockup_generation_failed",
    "lastErrorMessage": "Mockup generation failed: ...",
    "warningCodes": ["mockup_source_missing"],
    "dependencyState": {
      "site-fetch": "succeeded",
      "screenshots": "succeeded",
      "device-mockup": "failed"
    },
    "result": {
      "mockupUrl": "https://...",
      "desktopUrl": "https://...",
      "tabletUrl": "https://...",
      "mobileUrl": "https://..."
    },
    "dataVersionKey": "run_xyz"
  }
}
```

### 3. Optional per-module history

If needed later:

- `clients/{clientId}/module_runs/{moduleRunId}`

V1 does not need this if `brief_runs` remains the execution log and `dashboard_state.modules` keeps latest module state.

---

## Module Registry

Create:

- [features/scout-intake/module-registry.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/module-registry.js)

Suggested shape:

```js
module.exports = {
  'multi-device-view': {
    cardId: 'multi-device-view',
    label: 'Multi-Device View',
    category: 'onboarding',
    dependencies: ['site-fetch', 'screenshots', 'device-mockup'],
    tech: ['browserless', 'firebase-storage', 'python-mockup'],
    cacheOnSuccess: true,
    retryOnFailure: true,
    foundational: true,
  },
  'social-preview': {
    cardId: 'social-preview',
    label: 'Social Preview Check',
    category: 'onboarding',
    dependencies: ['site-fetch', 'site-meta'],
    tech: ['html-fetch', 'meta-parser'],
    cacheOnSuccess: true,
    retryOnFailure: true,
  },
  'seo-performance': {
    cardId: 'seo-performance',
    label: 'SEO + Performance Snapshot',
    category: 'onboarding',
    dependencies: ['site-fetch', 'pagespeed', 'ai-seo'],
    tech: ['pagespeed-insights', 'anthropic', 'ai-seo-audit'],
    cacheOnSuccess: true,
    retryOnFailure: true,
  }
};
```

Also include helper functions:

- `getModuleDefinition(cardId)`
- `resolveModuleDependencies(cardIds)`
- `isFoundationalModule(cardId)`

---

## Endpoint Contracts

### 1. Update module settings

Add:

- `POST /api/dashboard/modules/config`

Request:

```json
{
  "cardId": "seo-performance",
  "enabled": true
}
```

Response:

```json
{
  "ok": true,
  "cardId": "seo-performance",
  "enabled": true
}
```

Purpose:

- enable/disable a card
- persist user intent

### 2. Run selected module(s)

Add:

- `POST /api/dashboard/modules/run`

Request:

```json
{
  "cardIds": ["multi-device-view"],
  "force": false
}
```

Behavior:

- resolve dependencies
- queue only needed work
- skip already-succeeded modules unless `force: true`
- the route owns skip/force logic by reading current `dashboard_state.modules`
- the runner itself should execute only the module ids it is given; it should not decide whether a prior success should be skipped

Response:

```json
{
  "ok": true,
  "queuedModules": ["multi-device-view"],
  "skippedModules": [],
  "runId": "brief_run_123"
}
```

### 3. Retry failed module

Can use same endpoint:

```json
{
  "cardIds": ["seo-performance"],
  "force": true
}
```

### 4. Bootstrap

Keep:

- `GET /api/dashboard/bootstrap`

But expand response shape to include:

```json
{
  "moduleConfig": { ... },
  "moduleState": { ... }
}
```

This should come from:

- `client_configs.moduleConfig`
- `dashboard_state.modules`

---

## Pipeline Refactor

### A. New execution entry point

Refactor:

- [features/scout-intake/runner.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/runner.js)

Add:

- `runModules({ clientId, runId, websiteUrl, moduleIds })`

This should replace the current all-in-one assumption.

Important:

- `runModules()` is a pure executor for the requested module ids
- route handlers or callers own skip/retry/force behavior
- successful-card caching policy should be enforced before calling `runModules()`, not inside it

### B. Split shared steps from card modules

Create:

- `features/scout-intake/modules/shared/site-fetch.js`
- `features/scout-intake/modules/shared/site-meta.js`
- `features/scout-intake/modules/shared/screenshots.js`
- `features/scout-intake/modules/shared/device-mockup.js`
- `features/scout-intake/modules/shared/pagespeed.js`
- `features/scout-intake/modules/shared/ai-seo.js`
- `features/scout-intake/modules/shared/synthesis.js`
- `features/scout-intake/modules/shared/style-guide.js`

Create card orchestrators:

- `features/scout-intake/modules/multi-device-view.js`
- `features/scout-intake/modules/social-preview.js`
- `features/scout-intake/modules/seo-performance.js`
- later:
  - `style-guide.js`
  - `business-model.js`
  - `industry.js`
  - `priority-signal.js`

### C. Result contract

Each module should return:

```js
{
  ok: true,
  cardId: 'multi-device-view',
  status: 'succeeded',
  warningCodes: [],
  result: {
    mockupUrl: '...',
    screenshots: { ... }
  },
  artifacts: [ ... ],
}
```

Or on failure:

```js
{
  ok: false,
  cardId: 'seo-performance',
  status: 'failed',
  errorCode: 'pagespeed_failed_timeout_origin_slow',
  errorMessage: 'The page was reachable, but the audit timed out...',
  warningCodes: ['pagespeed_failed_timeout_origin_slow']
}
```

---

## Run Lifecycle Changes

Refactor:

- [api/_lib/run-lifecycle.cjs](/Users/bballi/Documents/Repos/Bballi_Portfolio/api/_lib/run-lifecycle.cjs)

Current issue:

- dashboard projection assumes one run produces one large state blob

Target:

- projection should merge module-level results without erasing successful prior module outputs
- module execution must update both:
  - `dashboard_state.modules.*`
  - the top-level dashboard fields the current UI already reads

### Required changes

1. Add `modules` projection block under `dashboard_state`
2. Merge module results per card instead of resetting the full onboarding state
3. Preserve existing module metadata like `enabled` when writing execution results
4. Only update artifacts/data related to the card/module that ran
5. Preserve previous successful module results across unrelated reruns

### Example

If `seo-performance` reruns and succeeds:

- update `dashboard_state.modules['seo-performance']`
- update top-level `dashboard_state.seoAudit` if that legacy bridge is still needed
- do not clear:
  - `homepageDeviceMockup`
  - `snapshot.visualIdentity`
  - `siteMeta`
  - unless dependency policy explicitly requires refresh

### Legacy bridge mapping

Until the dashboard is fully migrated to render directly from `moduleState.result`,
successful module runs must also project into the existing top-level dashboard fields:

- `multi-device-view`
  - `artifacts.homepageScreenshot`
  - `artifacts.homepageScreenshots`
  - `artifacts.fullPageScreenshots`
  - `artifacts.homepageDeviceMockup`
- `social-preview`
  - `siteMeta`
- `seo-performance`
  - `seoAudit`
  - `analyzerOutputs['seo-performance'].skills['ai-seo-audit']`

This bridge keeps the current UI live while Phase C adds module-aware card controls
and later rendering can be migrated to module-native state.

---

## Client Provisioning Changes

Refactor:

- [api/_lib/client-provisioning.cjs](/Users/bballi/Documents/Repos/Bballi_Portfolio/api/_lib/client-provisioning.cjs)

### On first signup

Today:

- client is provisioned
- a broad intake run is queued

Target:

- client is provisioned
- module config is seeded
- only foundational module is enabled
- first run queues only the foundational module

Seed:

```json
{
  "moduleConfig": {
    "multi-device-view": { "enabled": true, "autoRunOnSignup": true },
    "social-preview": { "enabled": false, "autoRunOnSignup": false },
    "seo-performance": { "enabled": false, "autoRunOnSignup": false }
  }
}
```

Initial `dashboard_state.modules`:

```json
{
  "multi-device-view": { "status": "queued", "enabled": true },
  "social-preview": { "status": "disabled", "enabled": false },
  "seo-performance": { "status": "disabled", "enabled": false }
}
```

---

## Dashboard UI Changes

Primary file:

- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx)

### 1. Card controls

Add per-card controls:

- enable toggle
- run button
- retry button
- last success timestamp
- failure reason
- tech used

### 2. Card state model

Each card should render from module state:

- `disabled`
- `ready`
- `queued`
- `running`
- `succeeded`
- `failed`

### 3. Foundational first-run dashboard

When only foundational module exists:

- show dashboard with only:
  - foundational card
  - brief/context tile
  - disabled remaining cards

### 4. Details modal

Each card modal `DATA` tab should show:

- module status
- last run id
- last success id
- exact warning codes
- exact error code/message
- dependency states
- tech/services used

---

## Recommended UI Components

Create:

- `components/dashboard/CardModuleControls.jsx`
- `components/dashboard/CardTechList.jsx`
- `components/dashboard/CardRunStatePill.jsx`
- `components/dashboard/ModuleEnableToggle.jsx`

### Card footer behavior

For `succeeded`:

- show `Live`
- show `Re-run` secondary action

For `failed`:

- show `Failed`
- show `Retry`

For `disabled`:

- show `Disabled`
- show `Enable`

For `never-run`:

- show `Ready`
- show `Run`

---

## Description System Changes

Files:

- [features/scout-intake/card-description-builder.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/card-description-builder.js)
- [features/scout-intake/card-description-builder.mjs](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/card-description-builder.mjs)

Current issue:

- descriptions assume one shared run context

Target:

- descriptions should incorporate module state

Examples:

### Disabled

`This card is turned off. Enable it to capture device screenshots and generate a layout review.`

### Failed

`This run could not produce screenshots, so the layout review is still incomplete. Retry the capture to generate the multi-device preview.`

### Succeeded

`Desktop, tablet, and mobile layouts were captured successfully. This card is showing the latest completed run.`

---

## Logging and Error Visibility

Add module-specific logging to:

- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx)
- [api/_lib/ops-overview.cjs](/Users/bballi/Documents/Repos/Bballi_Portfolio/api/_lib/ops-overview.cjs)

### Required visible fields

For every card:

- `module status`
- `last error code`
- `last error message`
- `warning codes`
- `dependency failures`
- `artifacts/data captured`

This solves “why didn’t this render for client A but did for client B?”

---

## Recommended V1 Module Order

Implement in this order:

1. `multi-device-view`
2. `social-preview`
3. `seo-performance`

Reason:

- strongest user-visible value
- highest current operational cost
- most common failure/debug pain

After that:

4. `style-guide`
5. `business-model`
6. `industry`
7. `visibility-snapshot`
8. `priority-signal`

---

## Migration Strategy

Do not break existing clients.

### Migration rule

If old `dashboard_state` already contains usable data, seed `modules` from it.

Examples:

- if `artifacts.homepageDeviceMockup` exists:
  - `modules['multi-device-view'].status = 'succeeded'`
- if `seoAudit.status` is `ok` or `partial`:
  - `modules['seo-performance'].status = 'succeeded'`
- if `siteMeta` exists:
  - `modules['social-preview'].status = 'succeeded'`

This can be done lazily during bootstrap or by a one-off migration script.

---

## Implementation Sequence

### Phase A

- add module registry
- add moduleConfig + moduleState schema
- expose them in bootstrap

Files:

- `features/scout-intake/module-registry.js`
- `api/_lib/client-provisioning.cjs`
- `app/api/dashboard/bootstrap/route.js`

### Phase B

- split runner into module-aware execution
- support running only `multi-device-view`

Files:

- `features/scout-intake/runner.js`
- `features/scout-intake/modules/*`
- `api/_lib/run-lifecycle.cjs`

### Phase C

- add dashboard module controls UI
- add card states

Files:

- `DashboardPage.jsx`
- new `components/dashboard/*`

### Phase D

- add per-card run endpoint
- wire enable/run/retry actions

Files:

- `app/api/dashboard/modules/config/route.js`
- `app/api/dashboard/modules/run/route.js`

### Phase E

- extend description builder for module lifecycle states
- add richer per-card diagnostics in UI

Files:

- `features/scout-intake/card-description-builder.js`
- `DashboardPage.jsx`

---

## Acceptance Criteria

V1 is complete when:

1. new signup runs only `multi-device-view`
2. dashboard appears with that one successful card if it completes
3. `social-preview` and `seo-performance` can be enabled and run independently
4. successful cards do not rerun unless explicitly requested
5. failed cards show exact reason and retry action
6. dashboard explains why a card is disabled, missing, failed, or live

---

## Open Decisions

1. Should one `brief_run` continue to be the umbrella run object for all module executions, or should card/module runs become separate documents?

Recommended V1:

- keep `brief_runs`
- add module-level status under `dashboard_state.modules`
- avoid a full run model rewrite yet

2. Should enabling a card auto-run it immediately?

Recommended V1:

- no
- separate `Enable` and `Run` for clarity

3. Should foundational card remain `multi-device-view`?

Recommended V1:

- yes
- it gives the strongest first visual and validates the site capture stack early
