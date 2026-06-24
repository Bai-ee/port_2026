# Master Prompt — Execute Client Intelligence Layer V2

You are implementing `Client Intelligence Layer V2` in this repository:

- repo: `/Users/bballi/Documents/Repos/Bballi_Portfolio`
- architecture spec: [CLIENT_INTELLIGENCE_LAYER_V2.md](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/CLIENT_INTELLIGENCE_LAYER_V2.md:1)

## Mission

Execute `Phase 1` of the architecture spec only.

Do not start `Phase 2`.
Do not partially begin migration work.
Do not touch PSI runtime behavior yet.
Do not wire new routes yet unless they are strictly required scaffolding for `Phase 1`.

Your job is to build the contract and storage foundation so that `Phase 2` can be executed cleanly.

## Phase 1 Scope

Implement only the following:

1. Create the intelligence module scaffolding:
   - `features/intelligence/index.js`
   - `features/intelligence/_contract.js`
   - `features/intelligence/_digest.js`
   - `features/intelligence/_ledger.js`
   - `features/intelligence/_store.js`

2. Define the canonical storage model:
   - `clients/{clientId}/intelligence/master`
   - `clients/{clientId}/intelligence/sources/{sourceId}`
   - optional support for `clients/{clientId}/intelligence/events/{eventId}` in store helpers

3. Implement `SourceRecord` validation:
   - field-level validation errors
   - strict enough to prevent malformed source outputs
   - no source-specific PSI assumptions in the shared validator

4. Implement pure digest generation:
   - deterministic
   - deduped
   - token-capped
   - no I/O
   - no async

5. Implement ledger helpers:
   - totals aggregation
   - provider totals aggregation
   - no `arrayUnion` ring buffer design
   - event helpers can assume subcollection storage

6. Implement Firestore store helpers:
   - `getMaster(clientId)`
   - `getSource(clientId, sourceId)`
   - `listSources(clientId)`
   - `upsertSource(clientId, sourceRecord)`
   - `setSourceSetting(clientId, sourceId, patch)`
   - `setPipelineInjection(clientId, enabled)`
   - `appendEvent(clientId, event)`
   - `rebuildMasterDigestAndLedger(clientId)`

7. Add tests for pure functions where practical:
   - `_digest`
   - `_ledger`
   - validator edge cases

## Constraints

- Do not migrate PSI yet.
- Do not modify:
  - `features/scout-intake/psi-audit.js`
  - `app/api/worker/run-psi/route.js`
  - `app/api/dashboard/rerun-psi/route.js`
  - `DashboardPage.jsx`
  - `features/scout-intake/runner.js`
  - `features/scout-intake/intake-synthesizer.js`
  unless required for harmless import-safe scaffolding only.

- Do not change runtime behavior of the current dashboard.
- Do not remove any legacy paths.
- Do not begin backfill logic.
- Do not add admin UI yet.

## Implementation Guidance

- Follow the storage boundaries in [CLIENT_INTELLIGENCE_LAYER_V2.md](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/CLIENT_INTELLIGENCE_LAYER_V2.md:1) exactly.
- Keep `master` small.
- Keep `SourceRecord` output-focused.
- Keep runtime settings in `master.sourceSettings`, not in source existence checks.
- Keep digest generation pure and fast.
- Keep ledger aggregation deterministic.
- Prefer small reusable helpers over large monolithic files.

## Deliverables

At the end of Phase 1, provide:

1. A short summary of what was added.
2. A list of created files.
3. Any tests run and their result.
4. Any assumptions or open questions that should be approved before `Phase 2`.

## Stop Condition

Stop immediately after Phase 1 is complete.

Do not continue into:
- PSI source migration
- new intelligence routes
- dashboard integration
- admin panel integration
- Scout prompt injection

Report for approval before Phase 2.
