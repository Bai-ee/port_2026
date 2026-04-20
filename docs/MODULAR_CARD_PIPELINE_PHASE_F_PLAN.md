# Modular Card Pipeline · Phase F Plan

## Goal

Make the first dashboard experience fully module-native.

On first signup / first dashboard creation:

- only `multi-device-view` should run
- the terminal should only show `multi-device-view` work
- no brief should be generated
- only the `Data Visualization` nav/category should be accessible
- only the `Multi-Device View` card should be visible and enabled
- all other modular cards should remain hidden or locked until explicitly enabled

After first success:

- the user can enable one additional card at a time
- enabling a card should trigger a module-targeted rerun
- the terminal should reflect only that card’s execution path
- previously successful cards should remain stable and should not rerun automatically

This phase is about **execution flow and UX gating**, not new card logic.

---

## Product Rules

1. New-client provisioning must queue only `multi-device-view`.
2. First-run terminal copy must be module-specific, not legacy full-pipeline copy.
3. First-run should not generate or surface a brief.
4. Before additional modules are enabled, non-data-visualization nav items must be hidden or locked.
5. Before additional modules are enabled, only the `Multi-Device View` card should render as an active onboarding card.
6. Enabling a module from the dashboard should:
   - persist config
   - trigger a run for that card only
   - replay the terminal with that module’s stages
7. Successful module results persist until explicitly rerun.
8. Failed modules remain retryable.

---

## What Exists Already

Completed before Phase F:

- Phase A
  - module registry
  - provisioning/module bootstrap shape
  - legacy inference in bootstrap
- Phase B
  - module executors
  - `runModules()`
  - `/api/dashboard/modules/run`
  - module result projection back into current dashboard fields
- Phase C
  - `ModuleCardControls`
  - per-card run/retry UI
- Phase D
  - `/api/dashboard/modules/config`
  - enable toggle
- Phase E
  - module-state description override
  - modal diagnostics
- Logging
  - `modulesSummary` in ops overview

Phase F is the first phase that changes the **overall dashboard experience**.

---

## Core Problem

The current dashboard still mixes:

- legacy provisioning/run semantics
- legacy terminal messaging
- modular card controls layered on top

That means the architecture is partly modular, but the first-run user experience is not yet truly modular.

---

## Phase F Scope

### 1. Provisioning should queue only the foundational module

Refactor provisioning / create-dashboard flow so a new client does **not** kick off the full legacy onboarding path.

Target:

- first run should behave as:
  - module config seeded
  - only `multi-device-view` enabled
  - module state for `multi-device-view` queued/running
  - no broad intake pipeline run

Likely files:

- [api/_lib/client-provisioning.cjs](/Users/bballi/Documents/Repos/Bballi_Portfolio/api/_lib/client-provisioning.cjs)
- [app/api/clients/provision/route.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/clients/provision/route.js)
- [app/api/dashboard/reseed-intake/route.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/dashboard/reseed-intake/route.js)
- [app/api/worker/run-brief/route.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/worker/run-brief/route.js)

Required behavior:

- fresh signup queues only `multi-device-view`
- legacy full-run path remains available for older clients or explicit non-modular flows until removed deliberately

### 2. Terminal must become module-aware

The dashboard terminal should render module-specific stages instead of assuming the old monolithic run.

For `multi-device-view`, terminal stages should look like:

- connect to website
- capture homepage
- generate desktop/tablet/mobile views
- build device mockup
- write layout module

For `social-preview`:

- fetch homepage
- extract social/meta tags
- write preview module

For `seo-performance`:

- run PSI
- run AI SEO
- merge audit results
- write SEO module

Likely files:

- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx)
- [api/_lib/run-lifecycle.cjs](/Users/bballi/Documents/Repos/Bballi_Portfolio/api/_lib/run-lifecycle.cjs)
- possibly [features/scout-intake/runner.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/runner.js) if module progress events need a cleaner shape

Required behavior:

- terminal lines must reflect the module(s) actually being run
- a fresh signup should not show irrelevant stages like brief writing or unrelated card work

### 3. No brief on first stage

The first foundational run should not generate a brief, and the brief nav/card should not appear as active content.

Likely files:

- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx)
- [features/scout-intake/runner.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/runner.js)
- [api/_lib/run-lifecycle.cjs](/Users/bballi/Documents/Repos/Bballi_Portfolio/api/_lib/run-lifecycle.cjs)

Required behavior:

- no brief preview iframe on first run
- no brief-focused hero or default filter on first run
- the user’s first successful experience should be the multi-device card

### 4. Lock/hide dashboard navigation until more modules are enabled

Before additional modules are enabled:

- only `Data Visualization` category/nav should be accessible
- other nav items should be hidden or clearly locked
- only `Multi-Device View` should render in the onboarding grid as active content

Recommended implementation:

- derive `enabledModuleIds` from `moduleConfig`
- derive `visibleOnboardingCards` from enabled modular cards plus any foundational summary you explicitly keep
- gate category filters based on whether they contain any enabled/renderable cards

Likely files:

- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx)

Required behavior:

- first-run dashboard feels intentionally narrow, not half-empty
- the user is guided through modular activation instead of seeing a wall of unavailable cards

### 5. Enabling a card should trigger a module-specific rerun

Phase D already added config writes. Phase F should make the UX flow cohesive:

- user enables a card
- card config updates
- dashboard reruns that card
- terminal shows only that card’s activity

Recommended behavior:

- `Enable` action can remain two-step internally:
  - config write
  - then module run
- but UX should feel like one deliberate action

Possible implementation choices:

- keep separate toggle + run controls but auto-run after enable
- or convert `Enable` into `Enable & Run`

Preferred for smoothness:

- `Enable` should immediately trigger the first run for that card

Likely files:

- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx)
- [components/dashboard/ModuleCardControls.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/components/dashboard/ModuleCardControls.jsx)

### 6. Preserve prior successful modules

Phase F must preserve the Phase B/D rule:

- if a module already succeeded, do not rerun it automatically
- only rerun on explicit user action

This applies especially when new cards are enabled later.

---

## Dashboard State Rules For Phase F

### Fresh client, pre-run

Expected:

```json
{
  "moduleConfig": {
    "multi-device-view": { "enabled": true, "autoRunOnSignup": true },
    "social-preview": { "enabled": false, "autoRunOnSignup": false },
    "seo-performance": { "enabled": false, "autoRunOnSignup": false }
  },
  "moduleState": {
    "multi-device-view": { "enabled": true, "status": "queued" },
    "social-preview": { "enabled": false, "status": "disabled" },
    "seo-performance": { "enabled": false, "status": "disabled" }
  }
}
```

### After first success

Expected:

- `multi-device-view.status = succeeded`
- `social-preview.status = disabled`
- `seo-performance.status = disabled`
- only Multi-Device card visible/active

### After enabling `social-preview`

Expected:

- `social-preview.enabled = true`
- `social-preview.status = running|queued` during run
- terminal shows only social preview module stages
- on success, `siteMeta` is projected and card appears live

---

## File-Level Work Plan

### A. Provisioning / run dispatch

Review and likely modify:

- [app/api/clients/provision/route.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/clients/provision/route.js)
- [app/api/dashboard/reseed-intake/route.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/dashboard/reseed-intake/route.js)
- [app/api/worker/run-brief/route.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/worker/run-brief/route.js)
- [api/_lib/client-provisioning.cjs](/Users/bballi/Documents/Repos/Bballi_Portfolio/api/_lib/client-provisioning.cjs)

Goal:

- new-client run path should dispatch only foundational module execution

### B. Terminal line generation

Review and likely modify:

- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx)
- [api/_lib/run-lifecycle.cjs](/Users/bballi/Documents/Repos/Bballi_Portfolio/api/_lib/run-lifecycle.cjs)

Goal:

- add module-aware event/line mapping
- add module-specific labels for each modular card

### C. Visibility / navigation gating

Review and likely modify:

- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx)

Goal:

- only show `Data Visualization` area and `Multi-Device View` at first
- hide or lock all other nav groups until more cards are enabled

### D. Enable-and-run UX

Review and likely modify:

- [components/dashboard/ModuleCardControls.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/components/dashboard/ModuleCardControls.jsx)
- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx)

Goal:

- enabling a module should smoothly become a run experience, not just a config toggle

---

## Acceptance Criteria

Phase F is complete only if all of these are true:

1. A brand-new signup/dashboard creation queues only `multi-device-view`.
2. The terminal UI for that first run shows only module-relevant steps.
3. No brief is generated or foregrounded during the first modular run.
4. Only `Data Visualization` is accessible at first.
5. Only `Multi-Device View` is visible/active at first among modular onboarding cards.
6. Enabling `social-preview` or `seo-performance` triggers only that module’s run.
7. The terminal reflects the enabled module during that rerun.
8. Previously successful modules are not rerun automatically.
9. `npm test` passes.
10. `npm run build` passes.

---

## Risks

1. The current provisioning and worker flow may still be tightly coupled to `brief_runs`.
2. The terminal currently reads legacy run/event semantics, so module scoping may require a careful compatibility layer rather than a quick conditional.
3. Hiding cards/nav too aggressively could make older clients feel broken if the gating logic is not scoped to new modular onboarding states.

---

## Recommendation

Implement Phase F in this order:

1. module-native new-client dispatch
2. terminal module-awareness
3. nav/card gating
4. enable-and-run smoothing

Do not try to redesign all card text or all admin flows in the same pass.

