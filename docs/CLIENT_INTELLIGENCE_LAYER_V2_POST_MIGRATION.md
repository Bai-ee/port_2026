# Client Intelligence Layer V2 — Post-Migration Reference

Status: Complete  
Scope: Canonical reference for the intelligence layer after Phases 1–6

## Purpose

This document records the final, canonical paths and rules for the Client Intelligence Layer after the V2 migration.

Use this doc when:
- adding a new intelligence source
- updating dashboard reads
- updating admin intelligence controls
- tracing the Scout injection path
- deciding whether a change belongs in intelligence, dashboard state, or Scout

## Canonical Write Path

The intelligence layer is now the canonical write path for external client intelligence.

Primary storage:
- `clients/{clientId}/intelligence/master`
- `clients/{clientId}/intelligence/sources/{sourceId}`
- `clients/{clientId}/intelligence/events/{eventId}`

Current PSI/PageSpeed source:
- [features/intelligence/pagespeed.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/intelligence/pagespeed.js:1)

Shared execution runner:
- [api/_lib/intelligence-runner.cjs](/Users/bballi/Documents/Repos/Bballi_Portfolio/api/_lib/intelligence-runner.cjs:1)

Worker/internal execution route:
- [app/api/intelligence/run/route.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/intelligence/run/route.js:1)

User rerun route:
- [app/api/intelligence/rerun/route.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/intelligence/rerun/route.js:1)

Source registry:
- [features/intelligence/index.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/intelligence/index.js:1)

Contract and storage helpers:
- [features/intelligence/_contract.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/intelligence/_contract.js:1)
- [features/intelligence/_store.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/intelligence/_store.js:1)
- [features/intelligence/_digest.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/intelligence/_digest.js:1)
- [features/intelligence/_ledger.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/intelligence/_ledger.js:1)

Rule:
- new external intelligence should write through the intelligence runner and store helpers
- do not add new source-specific writes to `dashboard_state`

## Canonical Read Paths

### Dashboard

The dashboard now prefers intelligence-backed data.

Primary dashboard read path:
- bootstrap intelligence payload returned from client provisioning/bootstrap helpers

Key files:
- [api/_lib/client-provisioning.cjs](/Users/bballi/Documents/Repos/Bballi_Portfolio/api/_lib/client-provisioning.cjs:1)
- [api/_lib/intelligence-bootstrap-utils.cjs](/Users/bballi/Documents/Repos/Bballi_Portfolio/api/_lib/intelligence-bootstrap-utils.cjs:1)
- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:1)

Current SEO card behavior:
- prefers intelligence-derived PSI data
- retains a legacy fallback to `dashboardState.seoAudit`

### Admin

The gated admin control surface is the canonical human control plane.

Key files:
- [app/admin/control/page.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/admin/control/page.jsx:1)
- [AdminPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/AdminPage.jsx:1)
- [app/api/admin/intelligence/route.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/admin/intelligence/route.js:1)
- [app/api/admin/intelligence/update-source/route.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/admin/intelligence/update-source/route.js:1)
- [app/api/admin/intelligence/toggle-injection/route.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/admin/intelligence/toggle-injection/route.js:1)

### Scout Injection

The Scout pipeline reads intelligence only when explicitly enabled per client.

Key files:
- [features/scout-intake/runner.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/runner.js:1)
- [features/scout-intake/intake-synthesizer.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/intake-synthesizer.js:1)

Rule:
- `master.meta.pipelineInjection === true` enables briefing injection
- when disabled, Scout behavior remains unchanged

## Remaining Intentional Fallback

One legacy read fallback remains intentionally in place:

- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:720)

Why it remains:
- older clients may still have `dashboardState.seoAudit`
- production-wide backfill completeness was not verifiable from the migration environment
- the fallback is read-only and harmless for migrated clients

Rule:
- do not remove this fallback unless production data confirms all relevant clients have intelligence-backed PSI source docs

## What Was Removed

These PSI-specific legacy files/routes were removed during Phase 6:
- `app/api/worker/run-psi/route.js`
- `app/api/dashboard/rerun-psi/route.js`
- `features/scout-intake/psi-audit.js`

Implication:
- intelligence is now the canonical PSI execution path
- do not reintroduce PSI-specific worker or rerun routes

## Adding The Next Source

To add a new intelligence source:

1. Create `features/intelligence/<source>.js`
   - export a fetch function that returns a valid `SourceRecord`

2. Register it in:
   - [features/intelligence/index.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/intelligence/index.js:1)

3. Ensure the source returns:
   - `summary`
   - `signals`
   - `facts`
   - `cost`
   - `status`
   - `error`

4. Use the shared runner:
   - do not create a one-off route or one-off Firestore write path

5. Expose it through existing admin intelligence controls
   - enable/disable
   - rerun
   - pipeline injection remains at the master level, not per-source prompt hacks

6. Only update dashboard/admin rendering if the new source needs user-facing presentation
   - storage and execution should work without changing Scout or dashboard contracts

Rule:
- a new source should be “drop-in” at the storage/execution layer
- UI additions are optional and should follow from the stored source data, not custom source plumbing

## Source Record Rule

Every intelligence source must conform to the shared `SourceRecord` contract.

Do not:
- write raw source payloads directly to dashboard state
- bypass the validator
- store custom ad-hoc source objects outside the intelligence namespace

## Operational Boundaries

Use intelligence when the data is:
- external
- source-specific
- refreshable independently
- useful to dashboard, admin, or Scout

Do not use intelligence when the data is:
- core dashboard projection data already owned by Scout normalization
- purely UI-local
- transient request state

## Suggested Next Work

The migration is complete. The next logical work is source expansion, not more migration.

Good next candidates:
- competitor scan
- social signal scan
- review sentiment
- backlink profile

Each should be added as a new source module through the existing intelligence contract.
