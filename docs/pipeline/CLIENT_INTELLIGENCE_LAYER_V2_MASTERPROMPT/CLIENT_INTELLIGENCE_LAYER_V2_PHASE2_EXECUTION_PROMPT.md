# Phase 2 Execution Prompt — Client Intelligence Layer V2

You are implementing `Phase 2` of `Client Intelligence Layer V2` in this repository:

- repo: `/Users/bballi/Documents/Repos/Bballi_Portfolio`
- architecture spec: [CLIENT_INTELLIGENCE_LAYER_V2.md](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/CLIENT_INTELLIGENCE_LAYER_V2.md:1)

Phase 1 is complete.  
Do not redo Phase 1.  
Execute `Phase 2` only.

## Mission

Migrate the existing PSI-specific path into the new intelligence layer without breaking current dashboard behavior.

Your `Phase 2` deliverables are:

1. `features/intelligence/pagespeed.js`
2. shared intelligence execution runner
3. `/api/intelligence/run`
4. `/api/intelligence/rerun`
5. reseed fanout update
6. legacy PSI backfill script or migration utility
7. backward-compatible shims for the old PSI routes

## Hard Constraints

Do not do `Phase 3`.  
Do not update `DashboardPage.jsx` yet.  
Do not update admin UI yet.  
Do not inject intelligence into Scout yet.  
Do not remove legacy PSI files/routes yet.

Current dashboard behavior must continue to work exactly as it does today.

## Approved Clarifications

1. `psi-audit.js` output does not map directly to `SourceRecord`.
   You must implement an explicit translation layer.
   Do not spread `seoAudit` blindly into a `SourceRecord`.

2. Keep read-side compatibility intact.
   During `Phase 2`, old reads from `dashboardState.seoAudit` must still work.

3. Prefer shared server functions over unnecessary internal fetch chaining.
   If multiple routes need the same PSI intelligence execution behavior, put it in a shared server module and call that directly.

4. Do not delete:
   - `features/scout-intake/psi-audit.js`
   - `app/api/worker/run-psi/route.js`
   - `app/api/dashboard/rerun-psi/route.js`

   in this phase.
   Convert them to compatibility shims only if needed.

## Required Work

### 1. Create `features/intelligence/pagespeed.js`

This module should:
- call or wrap the existing PSI logic
- translate PSI output into a valid `SourceRecord`
- return:
  - metadata fields
  - `summary`
  - `signals`
  - `facts`
  - `cost`
  - `status`
  - `error`

Rules:
- all current useful PSI data should move into `facts`
- prose interpretation belongs in `summary` and `signals`
- `facts` should preserve the PSI detail needed for future dashboard/admin rendering
- keep raw Lighthouse JSON out of storage

### 2. Create shared intelligence execution runner

Add a shared server-side execution path, for example under:
- `api/_lib/intelligence-runner.cjs`

This runner should:
- resolve source module by `sourceId`
- execute source fetch
- validate `SourceRecord`
- write source doc via Phase 1 store helpers
- append ledger event
- rebuild master digest and ledger
- return structured execution result

### 3. Add `app/api/intelligence/run/route.js`

Auth:
- worker-secret only

Input:

```json
{ "clientId": "...", "sourceId": "...", "runId": "optional" }
```

Behavior:
- call shared intelligence runner
- return success/error payload
- do not perform source-specific PSI logic inline in the route

### 4. Add `app/api/intelligence/rerun/route.js`

Auth:
- Firebase user token

Behavior:
- resolve `clientId` from authenticated user
- require `sourceId`
- invoke shared intelligence runner directly or safely trigger internal run behavior
- return queued/success response as appropriate

### 5. Update `app/api/dashboard/reseed-intake/route.js`

Replace the hardcoded PSI trigger behavior with registry-driven fanout.

Behavior:
- existing intake run trigger stays intact
- intelligence fanout should read source settings if present
- if no settings exist yet, run only default-enabled sources from registry
- for now that likely means PageSpeed only

Do not break:
- existing intake rerun flow
- existing terminal flow
- existing worker run-brief trigger

### 6. Backfill legacy PSI data

Add a migration utility or script that:
- reads existing `dashboard_state/{clientId}.seoAudit`
- converts it to the new `pagespeed-insights` `SourceRecord`
- writes it into `clients/{clientId}/intelligence/sources/pagespeed-insights`
- rebuilds master digest and ledger
- initializes source settings if missing

Requirements:
- idempotent
- safe to rerun
- do not delete old `seoAudit`
- leave old field in place for compatibility

### 7. Convert old PSI routes into compatibility shims

Keep these files:
- `app/api/worker/run-psi/route.js`
- `app/api/dashboard/rerun-psi/route.js`

But update them so they delegate into the new intelligence layer instead of maintaining separate PSI write logic.

Goal:
- one canonical PSI intelligence path
- old routes still function during migration window

## Files You May Modify

- `features/scout-intake/psi-audit.js`
  only if needed for clean reuse, but do not delete it
- `app/api/worker/run-psi/route.js`
- `app/api/dashboard/rerun-psi/route.js`
- `app/api/dashboard/reseed-intake/route.js`
- new intelligence files/routes/libs needed for `Phase 2`

## Files You Must Not Modify Yet

- `DashboardPage.jsx`
- `AdminPage.jsx`
- `app/admin/control/page.jsx`
- `features/scout-intake/runner.js`
- `features/scout-intake/intake-synthesizer.js`

## Acceptance Criteria

`Phase 2` is complete only if all of the following are true:

1. A fresh PSI execution writes a valid `SourceRecord` to:
   `clients/{clientId}/intelligence/sources/pagespeed-insights`

2. The write path updates:
   - source doc
   - ledger event
   - master digest
   - master ledger totals

3. Existing `dashboardState.seoAudit` reads are not broken.
   Current dashboard must still function before `Phase 3`.

4. `app/api/dashboard/reseed-intake/route.js` fans out intelligence execution through the new registry-driven path.

5. Legacy PSI routes still work as compatibility shims.

6. Backfill script runs safely and is idempotent.

7. Tests pass.
   Add tests where practical for:
   - PSI translation
   - shared intelligence runner behavior
   - migration/backfill helper behavior

## Deliverables At End Of Phase 2

Provide:

1. short summary of what changed
2. list of new/modified files
3. tests run and results
4. explicit note confirming whether legacy dashboard fallback remains intact
5. any blockers or questions before `Phase 3`

## Stop Condition

Stop after `Phase 2`.

Do not begin:
- dashboard read-side migration
- admin intelligence panel
- Scout prompt injection
- legacy PSI deletion

Report for approval before `Phase 3`.
