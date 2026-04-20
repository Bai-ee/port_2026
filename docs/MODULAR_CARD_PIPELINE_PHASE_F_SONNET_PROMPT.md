# Master Sonnet Prompt · Modular Card Pipeline Phase F

You are implementing **Phase F** of the modular card pipeline in the Bballi Portfolio repo.

Repo root:

- `/Users/bballi/Documents/Repos/Bballi_Portfolio`

Primary specs:

- [MODULAR_CARD_PIPELINE_IMPLEMENTATION_SPEC.md](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/MODULAR_CARD_PIPELINE_IMPLEMENTATION_SPEC.md)
- [MODULAR_CARD_PIPELINE_PHASE_F_PLAN.md](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/MODULAR_CARD_PIPELINE_PHASE_F_PLAN.md)

Read both first. Implement only **Phase F** in this pass.

---

## Objective

Make the initial dashboard experience truly modular.

At the end of this phase:

1. a brand-new client/dashboard should run only `multi-device-view`
2. the terminal should show only module-relevant work for the active module
3. no brief should be generated or foregrounded during the first foundational run
4. only `Data Visualization` should be accessible at first
5. only `Multi-Device View` should be active/visible at first among the modular onboarding cards
6. enabling `social-preview` or `seo-performance` should trigger that module’s own rerun flow

---

## Scope

Implement only:

### 1. New-client dispatch should be foundational-only

Audit the current create-dashboard / signup / provisioning flow and make sure a fresh client queues only the foundational module:

- `multi-device-view`

Do not let the first-run path fire the old broad onboarding pipeline unless the flow is explicitly legacy.

Likely files:

- `app/api/clients/provision/route.js`
- `app/api/dashboard/reseed-intake/route.js`
- `app/api/worker/run-brief/route.js`
- `api/_lib/client-provisioning.cjs`

Rules:

- keep backward compatibility for existing clients
- do not delete the legacy full pipeline yet unless it is clearly unused and safe to remove

### 2. Terminal must be module-aware

Update the dashboard terminal/progress experience so it reflects the actual module being run.

Examples:

- `multi-device-view`
  - connect
  - fetch page
  - capture screenshots
  - build device mockup
  - write layout module
- `social-preview`
  - fetch page
  - extract social metadata
  - write preview module
- `seo-performance`
  - run PageSpeed
  - run AI SEO
  - merge SEO module results

Likely files:

- `DashboardPage.jsx`
- `api/_lib/run-lifecycle.cjs`
- possibly `features/scout-intake/runner.js`

Rules:

- do not show unrelated legacy stages during a module-only run
- preserve compatibility for older `brief_runs` data where necessary

### 3. No brief on stage one

The first foundational run must not generate or foreground the brief.

Rules:

- no brief preview iframe on first modular run
- no default `brief`-centric view for a new client
- the user’s first successful experience should center on the `Multi-Device View` result

Likely files:

- `DashboardPage.jsx`
- any route/worker file currently causing the initial broad synthesis flow

### 4. Lock/hide navigation and cards until more modules are enabled

Update the dashboard UI so that before more modules are enabled:

- only `Data Visualization` is accessible
- other nav groups are hidden or clearly locked
- only `Multi-Device View` is visible/active among the modular onboarding cards

Rules:

- this gating should be driven by module config/state
- do not break existing/legacy clients who already have broader successful data
- prefer narrow gating for fresh/new modular onboarding states

### 5. Enable should smoothly become enable-and-run

When a disabled card is enabled:

- persist the config change
- trigger that module’s run
- refresh bootstrap
- replay the terminal for that module

You may keep separate internal API calls if needed, but the user experience should feel like a single action.

Likely files:

- `components/dashboard/ModuleCardControls.jsx`
- `DashboardPage.jsx`

---

## Out of Scope

Do **not** do any of these in Phase F:

- no new cards/modules beyond the current three modular cards
- no route consolidation
- no redesign of the entire admin panel
- no full removal of legacy pipeline paths unless clearly safe and necessary
- no broad copy-system rewrite

If you discover that a legacy path must be touched to make Phase F work, do the minimal safe change and note it clearly.

---

## Implementation Rules

1. Keep the live dashboard contract intact.
   - The current UI still reads top-level fields like `siteMeta`, `seoAudit`, and `artifacts.*`
   - Do not break those projections

2. Preserve successful module results.
   - Do not rerun successful cards unless the user explicitly reruns them

3. Scope gating carefully.
   - New/fresh modular onboarding clients should get the narrow first-run experience
   - Existing clients with already-populated cards should not suddenly lose visibility without intent

4. Keep terminal output factual.
   - terminal lines should map to the actual module run path
   - avoid cosmetic legacy lines when the module path is being used

5. Do not generate a brief in the first foundational flow.

---

## Files Expected to Change

Likely:

- `/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx`
- `/Users/bballi/Documents/Repos/Bballi_Portfolio/components/dashboard/ModuleCardControls.jsx`
- `/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/clients/provision/route.js`
- `/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/dashboard/reseed-intake/route.js`
- `/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/worker/run-brief/route.js`
- `/Users/bballi/Documents/Repos/Bballi_Portfolio/api/_lib/client-provisioning.cjs`
- `/Users/bballi/Documents/Repos/Bballi_Portfolio/api/_lib/run-lifecycle.cjs`
- `/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/runner.js`

Possible:

- small tests for gating / module-state behavior

---

## Acceptance Criteria

Phase F is complete only if:

1. a fresh signup/dashboard creation runs only `multi-device-view`
2. the terminal UI shows only `multi-device-view` work on that run
3. no brief is generated or foregrounded in that first run
4. only `Data Visualization` is accessible at first
5. only the `Multi-Device View` onboarding card is active/visible at first
6. enabling `social-preview` triggers only `social-preview`
7. enabling `seo-performance` triggers only `seo-performance`
8. terminal replay reflects the enabled card/module
9. successful cards are not rerun automatically
10. `npm test` passes
11. `npm run build` passes

---

## Verification Required

Run and report:

```bash
npm test
npm run build
```

Also provide a manual verification summary for:

1. fresh signup / fresh create-dashboard flow
2. first-run terminal output
3. first-run visible nav/cards
4. enable `social-preview`
5. enable `seo-performance`

Use this final response format:

- Files changed
- Behavior changed
- Verification run
- Risks / not verified

