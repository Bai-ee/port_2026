# Phase 3 Execution Prompt — Client Intelligence Layer V2

You are implementing `Phase 3` of `Client Intelligence Layer V2` in this repository:

- repo: `/Users/bballi/Documents/Repos/Bballi_Portfolio`
- architecture spec: [CLIENT_INTELLIGENCE_LAYER_V2.md](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/CLIENT_INTELLIGENCE_LAYER_V2.md:1)
- Phase 2 prompt reference: [CLIENT_INTELLIGENCE_LAYER_V2_PHASE2_EXECUTION_PROMPT.md](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/CLIENT_INTELLIGENCE_LAYER_V2_PHASE2_EXECUTION_PROMPT.md:1)

Phases 1 and 2 are complete.  
Do not redo earlier phases.  
Execute `Phase 3` only.

## Mission

Move the dashboard read-side from the legacy PSI field to the new intelligence namespace while preserving complete backward compatibility.

Your `Phase 3` deliverables are:

1. bootstrap support for intelligence data
2. dashboard read-side migration to `bootstrap.intelligence`
3. SEO + Performance card sourced from intelligence with fallback to `dashboardState.seoAudit`
4. inline rendering of the expanded PSI facts already captured in Phase 2
5. Phase 2 cleanup adjustments that are explicitly approved for this phase only:
   - seed full default source settings shape if still missing
   - add basic reseed-intelligence fanout observability

## Hard Constraints

Do not do `Phase 4`.  
Do not modify admin UI yet.  
Do not inject intelligence into Scout yet.  
Do not remove legacy PSI routes/files yet.  
Do not remove `dashboardState.seoAudit` fallback yet.

Current dashboard behavior must remain usable during and after the migration.

## Approved Clarifications

1. The dashboard should now prefer:
   - `bootstrap.intelligence.sources['pagespeed-insights']`
   and fall back to:
   - `dashboardState.seoAudit`

2. Reuse the compatibility translator from Phase 2 where helpful.
   If `features/intelligence/pagespeed.js` exposes `sourceToDashboardSeoAudit`, that is the preferred bridge for preserving old row-building semantics while migrating incrementally.

3. No Firestore composite index work is needed for `events.orderBy('at', 'desc')` alone.

4. If source settings are currently backfilled as `{}`, normalize them in this phase to:

```js
{ enabled: true, refreshPolicy: 'manual' }
```

5. The reseed-intelligence fanout may remain fire-and-forget in this phase, but it must no longer fail silently.
   Add explicit logs and a minimal observable failure path.

## Required Work

### 1. Update bootstrap to return intelligence

Modify the dashboard bootstrap path so it reads:
- `clients/{clientId}/intelligence/master`
- `clients/{clientId}/intelligence/sources/*`

and returns a new `bootstrap.intelligence` object shaped for the dashboard.

Minimum returned shape:

```js
{
  master: { meta, sourceSettings, digest, ledger },
  sources: {
    [sourceId]: SourceRecord
  }
}
```

Requirements:
- do not break any existing bootstrap fields
- if intelligence data is missing, bootstrap should still succeed
- if intelligence exists but `pagespeed-insights` is missing, dashboard must still fall back to legacy `dashboardState.seoAudit`

### 2. Update `DashboardPage.jsx`

Migrate the SEO + Performance card so it:
- prefers `bootstrap.intelligence.sources['pagespeed-insights']`
- falls back to `dashboardState.seoAudit`

Do not remove the existing card.
Do not move it out of the approved card order.
Do not introduce a modal.

The card should remain inline and full-width per the current dashboard pattern.

### 3. Expand the SEO + Performance card inline

Use the intelligence source `facts`, `summary`, and `signals` to render a richer inline card.

At minimum, the card should surface:
- source summary
- performance / SEO / accessibility / best practices scores
- Core Web Vitals
- lab CWV if present
- top opportunities
- top SEO flags
- top accessibility flags
- top best-practices flags
- key diagnostics
- top third parties if present
- fetched timestamp / freshness

Guidelines:
- prioritize readable, high-signal rows over dumping raw JSON
- keep the current card shell and dashboard visual language intact
- no modal and no separate drill-down page in this phase
- use compact table rows consistent with the existing dashboard intake card pattern

### 4. Preserve full backward compatibility

If the intelligence source is unavailable, malformed, or partially missing:
- fall back to `dashboardState.seoAudit`
- if neither exists, preserve the current unavailable/work-needed behavior

The dashboard must not regress for existing clients during the migration window.

### 5. Normalize source settings default shape

If the Phase 2 backfill or write paths created empty source settings objects, normalize them to:

```js
{ enabled: true, refreshPolicy: 'manual' }
```

This may be done in:
- bootstrap read normalization
- store normalization
- or a narrow migration utility

Do not introduce a breaking shape change.

### 6. Add fanout observability to reseed

Update the reseed intelligence fanout path so failures are observable.

Minimum requirement:
- explicit structured logging for source fanout failures
- include `clientId` and `sourceId`

Preferred if easy and safe:
- append an intelligence `error` event when a source trigger fails

Do not redesign the execution model in this phase.

## Files You May Modify

- `api/_lib/client-provisioning.cjs`
- dashboard bootstrap helper files used by the dashboard route
- `DashboardPage.jsx`
- `features/intelligence/pagespeed.js`
- `features/intelligence/_store.js`
- `app/api/dashboard/reseed-intake/route.js`
- small helper files needed to support the above

## Files You Must Not Modify Yet

- `AdminPage.jsx`
- `app/admin/control/page.jsx`
- `features/scout-intake/runner.js`
- `features/scout-intake/intake-synthesizer.js`
- legacy PSI route/file deletion

## Acceptance Criteria

`Phase 3` is complete only if all of the following are true:

1. Dashboard bootstrap returns intelligence data when present.
2. The SEO + Performance card prefers the intelligence source doc.
3. The SEO + Performance card still works when only `dashboardState.seoAudit` exists.
4. When neither source exists, the card still renders the current unavailable/work-needed state.
5. The card now surfaces the richer PSI data inline using dashboard-safe formatting.
6. Existing dashboard layout and approved component styling are preserved.
7. Empty source settings are normalized to the full default shape.
8. Reseed intelligence fanout failures are visible in logs and no longer silent.
9. Tests pass.

Add tests where practical for:
- bootstrap intelligence mapping
- dashboard fallback selection logic
- PSI card row-building helpers
- source settings normalization

## Deliverables At End Of Phase 3

Provide:

1. short summary of what changed
2. list of new/modified files
3. tests run and results
4. explicit note confirming that legacy dashboard fallback remains intact
5. any blockers or questions before `Phase 4`

## Stop Condition

Stop after `Phase 3`.

Do not begin:
- admin intelligence panel
- admin intelligence API UI integration
- Scout prompt injection
- legacy PSI deletion

Report for approval before `Phase 4`.
