# Content Engine UI gate log

## U1 (tokens, primitives, shared xce-* restyle)
- npm test: 4511 tests, 4509 pass, 2 fail (vendor-api-lib only) — same as baseline.
- Diff review: XContentEngineCard.jsx changes limited to the `<style jsx global>` block; no JSX/handler/id edits.
- Visual: all 8 tabs at 1280/400, zero console errors, no horizontal overflow. Shots: docs/plans/content-engine-ui-shots/U1/.
- Behaviour smoke: styles only; tab switching exercised by the shot script.

## U2 (shell / IA)
- npm test: 4511 tests; 4509 pass / 2 fail (vendor-api-lib). One run showed a 3rd failure that did not reproduce on rerun (flaky, unrelated to UI).
- Diff review: XContentEngineCard.jsx only; shell-only state (More menu open/close), tabs array-mapped with identical ids/handlers, TABS + xce-last-tab + data loading untouched.
- Visual: 8 tabs x 1280/400, zero console errors, no horizontal overflow, bottom nav sticky in-flow (does not cover content). Shots: docs/plans/content-engine-ui-shots/U2/.
- Note: Next dev overlay "4 Issues" pre-exists (baseline).
- Open: phone controls do not carry canonical tab ids; desktop tab-row ids stay in DOM at all widths for QA.

## Merge: feat/daily-content-loop into feat/content-engine-ui (before U3a)
- Pre-merge: `git status` clean on feat/content-engine-ui at 5281c3c8. `git merge feat/daily-content-loop` (11ce37f6, X Strategy build through T7 + handoff) → clean merge, merge commit 971df330, no conflicts.
- Coherence: XContentEngineCard.jsx kept the U2 shell and the Strategy tab (TABS has 'strategy' first; `<StrategyPanel … onPlanChanged>`; plan tab `onOpenStrategy={() => setTab('strategy')}`; phone nav has Chat → 'strategy').
- npm test after merge: 4522 tests, 4520 pass, 2 fail (vendor-api-lib only) — equals the daily-content-loop branch's final count.
- Constraint carried into U3a: the inputs-panel source labels (`rows store, pulled <date>` / `committed file <path>` / `… (rows store unavailable)` / `no stored rows`, rendered from inputs.js via DailySuggestionsPanel's #daily-run-inputs-panel) must stay visible — restyle them, don't drop them.

## U3 (Strategy / Today / Content / Calendar+Results+Clients, parallel)
- npm test (merged tree incl. T6/T7): 4522 tests, 4520 pass / 2 fail (vendor-api-lib only).
- Fresh reviewer vs master plan §0 + audit: PASS. No new call actions/payloads; nothing writes/spends newly; no Omit items built; prompt chips fill-only; Undo = existing strategy-plan-revert(version-1), Restore vN unchanged.
- Visual: 8 tabs x 400 zero console errors, no page-level horizontal overflow (card scrollWidth 358 vs 350 = bottom-nav full-bleed margin, internal only). Shots: docs/plans/content-engine-ui-shots/U3/.
- Orchestrator addition: clientName prop passed to StrategyPanel (header chip).
- Follow-ups from review go into U4: dead seriesLabel, stale PlanPanel comment, orphaned CSS, stale undoNote.

## U4 (integration + QA)
- Reviewer cleanups applied: dead seriesLabel removed, stale PlanPanel comment fixed, History Restore clears stale undo note.
- Not done (harmless): orphaned xce-* CSS (slot-list, engine-count, week-grid, perf-row, dl-controls) still shares multi-selector lines in XContentEngineCard.jsx; InventoryPanel overrides xce-inv-* in its own prefixed global block.
- npm test: 4522 tests, 4520 pass / 2 fail (vendor-api-lib only).
- Visual: 8 tabs at 1280, 700, 400 — zero console errors, no page-level horizontal overflow. Shots (5.3MB, >3MB cap so NOT committed): /private/tmp/claude-501/ce-ui-scratch/U4-shots/
- Behaviour smoke: tab switching + render of all tabs verified live; write/model/schedule paths deliberately not exercised (stubbed). Code-level review: no handler/payload changes.
