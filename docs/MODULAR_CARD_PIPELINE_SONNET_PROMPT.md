# Master Sonnet Prompt · Modular Card Pipeline Phase A

You are implementing **Phase A** of the modular card pipeline in the Bballi Portfolio repo.

Repo root:

- `/Users/bballi/Documents/Repos/Bballi_Portfolio`

Primary implementation spec:

- [MODULAR_CARD_PIPELINE_IMPLEMENTATION_SPEC.md](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/MODULAR_CARD_PIPELINE_IMPLEMENTATION_SPEC.md)

Read that spec first, then implement only **Phase A** in this pass.

---

## Objective

Introduce the foundational data model for modular card execution without breaking the current dashboard.

At the end of this phase, the app should:

1. have a canonical module registry
2. store per-client module configuration
3. store per-client module execution state
4. expose both through dashboard bootstrap
5. keep the existing dashboard working exactly as it does now

Do **not** implement the full UI and do **not** split the full runner yet in this phase.

---

## Scope

Implement only:

### 1. Module registry

Create:

- `features/scout-intake/module-registry.js`

This must define initial module metadata for:

- `multi-device-view`
- `social-preview`
- `seo-performance`

Each definition should include:

- `cardId`
- `label`
- `category`
- `dependencies`
- `tech`
- `cacheOnSuccess`
- `retryOnFailure`
- `foundational`

Also export helper functions:

- `getModuleDefinition(cardId)`
- `resolveModuleDependencies(cardIds)`
- `getDefaultModuleConfig()`

Rules:

- `multi-device-view` is the only foundational module in V1
- `social-preview` and `seo-performance` are disabled by default

### 2. Client provisioning seeding

Update:

- `api/_lib/client-provisioning.cjs`

On new client provisioning, seed:

- `client_configs/{clientId}.moduleConfig`
- `dashboard_state/{clientId}.modules`

Required default behavior:

- `multi-device-view.enabled = true`
- `multi-device-view.autoRunOnSignup = true`
- all other Phase A modules disabled

Seed initial execution state like:

```json
{
  "multi-device-view": {
    "enabled": true,
    "status": "queued"
  },
  "social-preview": {
    "enabled": false,
    "status": "disabled"
  },
  "seo-performance": {
    "enabled": false,
    "status": "disabled"
  }
}
```

Do not remove any current provisioning fields.

### 3. Bootstrap expansion

Update:

- `api/_lib/client-provisioning.cjs`
- `app/api/dashboard/bootstrap/route.js`

The dashboard bootstrap response must now include:

- `moduleConfig`
- `moduleState`

Source them from:

- `client_configs/{clientId}.moduleConfig`
- `dashboard_state/{clientId}.modules`

If missing for an older client, provide safe defaults derived from the registry rather than crashing.

### 4. Backward-compatible migration behavior

For old clients who already have data:

- do **not** wipe or rewrite existing dashboard data
- if module state is missing, bootstrap should infer lightweight fallback state where reasonable

Examples:

- if `dashboard_state.artifacts.homepageDeviceMockup` exists, `multi-device-view` can be treated as effectively succeeded in the bootstrap fallback
- if `seoAudit.status` is `ok` or `partial`, `seo-performance` can be treated as effectively succeeded in the bootstrap fallback
- if `siteMeta` exists, `social-preview` can be treated as effectively succeeded in the bootstrap fallback

This fallback can be read-only in Phase A. You do **not** need to run a full migration writeback script yet unless it is clearly low-risk and simple.

### 5. Minimal dashboard read plumbing

Update:

- `DashboardPage.jsx`

Only as needed so the page can safely read:

- `bootstrap.moduleConfig`
- `bootstrap.moduleState`

Do not add the full controls UI yet.
Do not change existing card rendering behavior beyond what is necessary to safely tolerate the new bootstrap shape.

---

## Out of Scope

Do **not** do any of these yet:

- no per-card enable/run UI
- no new `/api/dashboard/modules/*` routes yet
- no large `runner.js` split yet
- no removal of existing onboarding behavior
- no card-by-card execution engine yet
- no route consolidation work
- no feature deletion

If you discover that Phase A cannot be done safely without touching one of those, stop and explain why.

---

## Implementation Notes

### Data shape

Use plain JS objects. Keep fields simple and serializable.

Recommended module state shape:

```js
{
  enabled: true,
  status: 'disabled|idle|queued|running|succeeded|failed',
  lastAttemptRunId: null,
  lastSuccessfulRunId: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastErrorCode: null,
  lastErrorMessage: null,
  warningCodes: [],
  dependencyState: {},
  result: null,
  dataVersionKey: null,
}
```

Phase A can seed minimal values and leave deeper fields null.

### Status rules

For seeding only:

- foundational module on signup: `queued`
- disabled modules: `disabled`

For bootstrap fallback on legacy clients:

- if clear evidence exists, return `succeeded`
- otherwise return `idle` or `disabled` based on registry defaults

### Safety

This repo already has active production fixes in flight. Keep changes minimal.

Do not break:

- dashboard bootstrap
- provisioning
- existing `npm test`
- existing `npm run build`

---

## Files Expected to Change

Likely:

- `/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/module-registry.js`
- `/Users/bballi/Documents/Repos/Bballi_Portfolio/api/_lib/client-provisioning.cjs`
- `/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/dashboard/bootstrap/route.js`
- `/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx`

Possible:

- small new tests for module registry/bootstrap shaping

---

## Acceptance Criteria

Phase A is complete only if all of these are true:

1. a new module registry exists and is the canonical source of default module definitions
2. new client provisioning writes module config and module state
3. dashboard bootstrap returns `moduleConfig` and `moduleState`
4. old clients without module state still bootstrap safely
5. the existing dashboard still loads
6. `npm test` passes
7. `npm run build` passes

---

## Verification Required

Run and report:

```bash
npm test
npm run build
```

If you add tests, mention exactly which new ones were added.

---

## Reporting Format

When done, respond in this format:

- Files changed
- Behavior changed
- Verification run
- Risks / not verified

Do not include long theory in the final answer. Focus on what changed and what remains.

