# Phase 6 Execution Prompt — Client Intelligence Layer V2

You are implementing `Phase 6` of `Client Intelligence Layer V2` in this repository:

- repo: `/Users/bballi/Documents/Repos/Bballi_Portfolio`
- architecture spec: [CLIENT_INTELLIGENCE_LAYER_V2.md](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/CLIENT_INTELLIGENCE_LAYER_V2.md:1)
- Phase 5 prompt reference: [CLIENT_INTELLIGENCE_LAYER_V2_PHASE5_EXECUTION_PROMPT.md](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/CLIENT_INTELLIGENCE_LAYER_V2_PHASE5_EXECUTION_PROMPT.md:1)

Phases 1 through 5 are complete.  
Do not redo earlier phases.  
Execute `Phase 6` only.

## Mission

Finalize the migration by removing legacy PSI-specific compatibility paths and making the intelligence layer the single canonical source of truth.

Your `Phase 6` deliverables are:

1. remove legacy PSI-specific route/file dependencies
2. remove old `dashboardState.seoAudit` read/write compatibility code where safe
3. keep the dashboard and admin behavior intact on the intelligence path
4. leave the system in a single-path, maintainable state

## Hard Constraints

Do not redesign the intelligence architecture.  
Do not redesign dashboard or admin UI.  
Do not broaden feature scope beyond cleanup and deprecation removal.  
Do not remove intelligence storage or admin controls.  
Do not introduce new product behavior unrelated to cleanup.

This phase is cleanup only.

## Preconditions

Before removing legacy paths, verify all of the following:

1. Intelligence source writes are live and stable.
2. Dashboard read-side is already using intelligence with fallback.
3. Admin intelligence controls are working.
4. Scout prompt injection is working when enabled.
5. There is no remaining production dependency on the old PSI-specific path.

If any of those are not true, stop and report instead of deleting compatibility code.

## Required Work

### 1. Remove legacy PSI-specific files and routes

Delete or fully retire the legacy PSI-specific path once it is no longer needed:

- `features/scout-intake/psi-audit.js`
- `app/api/worker/run-psi/route.js`
- `app/api/dashboard/rerun-psi/route.js`

If a file cannot be deleted safely because of remaining imports, remove the remaining dependencies first and then delete it.

Do not leave dead shims in place unless you discover an actual unresolved dependency.

### 2. Remove legacy `dashboardState.seoAudit` write behavior

Any remaining code that writes new PSI results into:

- `dashboard_state/{clientId}.seoAudit`

should be removed.

After this phase, the canonical write target must be:

- `clients/{clientId}/intelligence/sources/pagespeed-insights`

### 3. Remove legacy dashboard fallback only if safe

If the migration is fully complete and all clients can rely on intelligence-backed reads, remove the old fallback from:

- `DashboardPage.jsx`
- bootstrap intelligence compatibility helpers

If you cannot prove this is safe, keep the fallback and report that Phase 6 cannot fully delete it yet.

Preferred outcome:
- dashboard reads only from intelligence

But safety is more important than purity.

### 4. Remove obsolete compatibility helpers

Delete any helper code that exists only for transitional compatibility, for example:
- PSI shape roundtrip helpers used only to preserve old `seoAudit`
- old translation helpers that are no longer referenced
- legacy route-specific compatibility branches

Do not delete helpers still required by the dashboard/admin intelligence path.

### 5. Clean up docs/comments where needed

Update any internal comments or docs that still describe the old PSI-specific route as canonical.

This is light cleanup only:
- remove stale comments
- update references if they would mislead future maintainers

Do not do broad documentation rewrites unless directly necessary.

## Files You May Modify

- `DashboardPage.jsx`
- dashboard/bootstrap helpers
- legacy PSI route files
- legacy PSI utility files
- intelligence helpers where compatibility code can now be removed
- narrow docs/comments that still point to the old path

## Acceptance Criteria

`Phase 6` is complete only if all of the following are true:

1. Legacy PSI-specific files/routes are removed or fully retired.
2. No new writes go to `dashboardState.seoAudit`.
3. The intelligence path is the single canonical PSI path.
4. Dashboard still works.
5. Admin intelligence controls still work.
6. Scout injection still works.
7. Tests pass.
8. No dead imports or orphaned compatibility helpers remain.

Add tests or update tests where practical to reflect the removal of legacy paths.

## Deliverables At End Of Phase 6

Provide:

1. short summary of what was removed
2. list of deleted/modified files
3. tests run and results
4. explicit confirmation of whether legacy dashboard fallback was removed or intentionally retained
5. any residual cleanup still deferred, if any

## Stop Condition

Stop after `Phase 6`.

At the end, report whether the Client Intelligence Layer migration is fully complete.
