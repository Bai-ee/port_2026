# Phase 5 Execution Prompt — Client Intelligence Layer V2

You are implementing `Phase 5` of `Client Intelligence Layer V2` in this repository:

- repo: `/Users/bballi/Documents/Repos/Bballi_Portfolio`
- architecture spec: [CLIENT_INTELLIGENCE_LAYER_V2.md](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/CLIENT_INTELLIGENCE_LAYER_V2.md:1)
- Phase 4 prompt reference: [CLIENT_INTELLIGENCE_LAYER_V2_PHASE4_EXECUTION_PROMPT.md](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/CLIENT_INTELLIGENCE_LAYER_V2_PHASE4_EXECUTION_PROMPT.md:1)

Phases 1 through 4 are complete.  
Do not redo earlier phases.  
Execute `Phase 5` only.

## Mission

Add opt-in Scout prompt injection so stored client intelligence can be used to enrich synthesis when explicitly enabled per client.

Your `Phase 5` deliverables are:

1. runner support for intelligence briefing injection
2. synthesizer support for an `intelligenceBriefing` input
3. prompt composition change that inserts the briefing immediately before site evidence
4. strict feature-flag behavior via `pipelineInjection`
5. zero behavior change when injection is disabled

## Hard Constraints

Do not do `Phase 6`.  
Do not delete legacy PSI routes/files yet.  
Do not remove legacy dashboard fallback yet.  
Do not redesign the intelligence storage model.  
Do not redesign admin controls.  
Do not broaden injection to all clients by default.

Default behavior must remain `OFF`.

## Approved Clarifications

1. Injection is controlled per client via stored intelligence metadata:
   - `master.meta.pipelineInjection === true`

2. When injection is off, Scout prompt behavior must remain byte-identical or functionally identical to current production behavior.

3. The injected intelligence block must appear immediately before the site evidence section in the synthesis prompt.

4. Use the stored intelligence digest / briefing output.
   Do not regenerate intelligence prose at prompt time.

5. This phase does not include deleting legacy PSI-specific paths.

## Required Work

### 1. Update `features/scout-intake/runner.js`

Add opt-in intelligence read support.

Behavior:
- resolve the client’s intelligence master/source data as needed
- if `pipelineInjection === true`, build an `intelligenceBriefing` string from stored digest output
- pass `intelligenceBriefing` into the synthesizer call
- if the intelligence layer is missing or empty, do not fail the pipeline; just omit injection

Requirements:
- current run flow must still succeed without intelligence data
- injection must be non-fatal
- no additional dashboard writes are needed in this phase

### 2. Update `features/scout-intake/intake-synthesizer.js`

Add support for an optional `intelligenceBriefing` argument.

Behavior:
- when absent: prompt remains unchanged
- when present: inject a dedicated section immediately before site evidence

Use a clear preface like:

```text
Additional intelligence gathered outside the crawl:
```

Then include the briefing block.

Requirements:
- do not bury this inside arbitrary prompt text
- keep the insertion deterministic
- do not inject raw JSON
- inject concise, prose-ready briefing content only

### 3. Build the injected briefing from stored digest

Use the stored intelligence digest, not raw source facts.

Preferred input:
- `master.digest.briefingBullets`

If useful, format as:

```text
=== SITE INTELLIGENCE BRIEFING ===
- ...
- ...
- ...
```

Requirements:
- deterministic ordering
- concise
- safe token footprint
- no recomputation of source intelligence in runner

### 4. Preserve non-injected behavior

This is critical.

When `pipelineInjection !== true`:
- the prompt should remain unchanged
- the runner should not add intelligence content
- output should behave exactly as current production

### 5. Keep admin toggle as the source of truth

The admin control surface from Phase 4 already manages pipeline injection state.

Requirements:
- runner must read the stored flag
- do not create a second flag source
- do not introduce user-level override behavior in this phase

## Files You May Modify

- `features/scout-intake/runner.js`
- `features/scout-intake/intake-synthesizer.js`
- supporting intelligence read helpers if needed
- narrow helper files used only to build the briefing string

## Files You Must Not Modify Yet

- `DashboardPage.jsx`
- `AdminPage.jsx`
- legacy PSI deletion paths
- storage architecture introduced in earlier phases

## Acceptance Criteria

`Phase 5` is complete only if all of the following are true:

1. With `pipelineInjection=false`, Scout prompt behavior remains unchanged.
2. With `pipelineInjection=true`, the prompt includes the intelligence briefing block immediately before site evidence.
3. The injected block is built from stored digest output, not raw source facts and not regenerated prose.
4. Missing intelligence data does not break the pipeline.
5. Injection is client-specific and controlled solely by stored intelligence metadata.
6. Tests pass.

Add tests where practical for:
- runner injection gating logic
- prompt composition with and without intelligence
- briefing string formatting
- missing-intelligence non-fatal behavior

## Manual QA Expectations

Manual QA should confirm:

1. Client with injection off:
   - prompt has no intelligence block
   - output behavior matches current baseline

2. Client with injection on:
   - prompt includes the intelligence block in the correct location
   - synthesis output references at least one concrete intelligence-derived fact or implication

Manual QA notes should be included in the final Phase 5 report.

## Deliverables At End Of Phase 5

Provide:

1. short summary of what changed
2. list of new/modified files
3. tests run and results
4. explicit confirmation that non-injected clients are unchanged
5. manual QA findings for at least one injected case
6. any blockers or questions before `Phase 6`

## Stop Condition

Stop after `Phase 5`.

Do not begin:
- legacy PSI deletion
- final cleanup migration
- removing compatibility shims

Report for approval before `Phase 6`.
