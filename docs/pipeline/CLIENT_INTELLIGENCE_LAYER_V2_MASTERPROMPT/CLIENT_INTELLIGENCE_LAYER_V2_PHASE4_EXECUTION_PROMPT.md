# Phase 4 Execution Prompt — Client Intelligence Layer V2

You are implementing `Phase 4` of `Client Intelligence Layer V2` in this repository:

- repo: `/Users/bballi/Documents/Repos/Bballi_Portfolio`
- architecture spec: [CLIENT_INTELLIGENCE_LAYER_V2.md](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/CLIENT_INTELLIGENCE_LAYER_V2.md:1)
- Phase 3 prompt reference: [CLIENT_INTELLIGENCE_LAYER_V2_PHASE3_EXECUTION_PROMPT.md](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/CLIENT_INTELLIGENCE_LAYER_V2_PHASE3_EXECUTION_PROMPT.md:1)

Phases 1 through 3 are complete.  
Do not redo earlier phases.  
Execute `Phase 4` only.

## Mission

Build the admin intelligence control surface on top of the existing intelligence storage and bootstrap work.

Your `Phase 4` deliverables are:

1. admin intelligence read API
2. intelligence panel inside the gated admin control surface
3. source-level actions:
   - re-run
   - enable
   - disable
   - pipeline injection toggle
4. ledger display
5. Scout briefing preview
6. recent events display
7. persisted normalization of source settings so admin UI never operates on raw `{}` settings

## Hard Constraints

Do not do `Phase 5`.  
Do not inject intelligence into Scout yet.  
Do not remove legacy PSI routes/files yet.  
Do not remove legacy dashboard fallback yet.  
Do not redesign the admin shell or route structure beyond what is needed to add the intelligence panel.

The existing gated admin control route must remain the operational control surface:
- `/admin/control`

## Approved Clarifications

1. `bootstrap.intelligence.sources` and `bootstrap.intelligence.sourceSettings` are already present and sufficient for the admin panel.
   No additional bootstrap shape redesign is required unless you discover a concrete gap.

2. Source settings should no longer remain read-normalized only.
   Phase 4 must persist normalized settings so raw `{}` settings are not surfaced in admin UI.

3. `orderBy('at', 'desc')` on the events collection does not require composite index work by itself.
   Do not add unnecessary index migrations in this phase.

4. Build the intelligence admin UI once in [AdminPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/AdminPage.jsx:1).
   Do not duplicate logic in [app/admin/control/page.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/admin/control/page.jsx:1), which is only the auth-gated route wrapper.

## Required Work

### 1. Add admin intelligence API

Create:
- `app/api/admin/intelligence/route.js`

Auth:
- admin-only, same authorization standard as the other admin APIs

Behavior:
- support either:
  - list mode
  - single-client mode via `clientId`
- return intelligence payloads suitable for the admin panel

Minimum response shape:

```js
{
  clients: [
    {
      clientId,
      companyName,
      websiteUrl,
      intelligence: {
        master,
        sources,
        sourceSettings,
        recentEvents
      }
    }
  ]
}
```

You may paginate if needed, but keep implementation pragmatic.

### 2. Build the intelligence panel in `AdminPage.jsx`

Add a new top-level section to the gated admin control surface.

Target DOM ids:
- `#intelligence-panel-shell`
- `#intelligence-client-selector`
- `#intelligence-sources-table`
- `#intelligence-source-row-{sourceId}`
- `#intelligence-cost-ledger`
- `#intelligence-briefing-preview`
- `#intelligence-recent-events`
- `#intelligence-injection-toggle`

The panel must show, for the selected client:
- client identity
- website URL
- schema version
- updated timestamp
- pipeline injection state
- briefing token estimate
- source table with status, cost, freshness, and action buttons
- ledger totals
- recent events
- Scout briefing preview

### 3. Source actions

Implement source-level admin actions:
- `Re-run`
- `Enable`
- `Disable`
- `Toggle pipeline injection`

Requirements:
- actions must persist to Firestore
- changes should reflect in UI quickly
- reuse existing intelligence store/helpers when possible
- do not create parallel inconsistent mutation paths

If needed, add narrow admin action routes such as:
- `app/api/admin/intelligence/update-source/route.js`
- `app/api/admin/intelligence/toggle-injection/route.js`

Keep them scoped and admin-only.

### 4. Persist normalized source settings

Phase 3 only normalized settings on read.
In Phase 4, fix this at the stored-data level.

Requirement:
- if a source setting is `{}`, normalize and persist:

```js
{ enabled: true, refreshPolicy: 'manual' }
```

This may be done:
- lazily during admin read
- via store helper on update
- or via a narrow one-time normalization pass

Goal:
- admin UI should never operate on raw empty settings objects

### 5. Render ledger and recent events

Show:
- 30d intelligence totals
- per-provider totals if available
- recent event list

Use existing intelligence data model.
Do not add charts in this phase.
Text + counts + timestamps are sufficient.

### 6. Render Scout briefing preview

Render the current digest text from intelligence master.

Requirements:
- readable
- copyable
- no re-generation in UI
- purely sourced from stored digest

### 7. Keep current admin behavior intact

The existing client list, queue, failed runs, and run detail functionality in `AdminPage.jsx` must continue to work.

Do not regress:
- client list loading
- queue inspection
- failed run inspection
- config detail view
- run detail view
- requeue/run actions

The intelligence section should be additive.

## Files You May Modify

- `AdminPage.jsx`
- `app/api/admin/intelligence/route.js`
- existing or new admin-only intelligence action routes
- `features/intelligence/_store.js`
- helper files supporting admin intelligence rendering

## Files You Must Not Modify Yet

- `DashboardPage.jsx`
- `features/scout-intake/runner.js`
- `features/scout-intake/intake-synthesizer.js`
- legacy PSI deletion paths
- Scout prompt injection paths

## Acceptance Criteria

`Phase 4` is complete only if all of the following are true:

1. Admin can load intelligence data per client from a dedicated admin API.
2. The gated admin control page includes a visible intelligence panel.
3. The panel shows source rows with status, cost, age, and actions.
4. `Re-run`, `Enable`, `Disable`, and `Toggle pipeline injection` persist successfully.
5. Source settings are normalized and persisted, not only read-normalized.
6. Ledger totals render correctly.
7. Recent events render in descending order.
8. Scout briefing preview renders stored digest content.
9. Existing admin functionality remains intact.
10. Tests pass.

Add tests where practical for:
- admin intelligence API shaping
- source settings normalization persistence
- admin action handlers
- client selection / panel rendering helpers

## Deliverables At End Of Phase 4

Provide:

1. short summary of what changed
2. list of new/modified files
3. tests run and results
4. explicit confirmation that existing admin controls still work
5. any blockers or questions before `Phase 5`

## Stop Condition

Stop after `Phase 4`.

Do not begin:
- Scout prompt injection
- runner/synthesizer intelligence prompt integration
- legacy PSI deletion

Report for approval before `Phase 5`.
