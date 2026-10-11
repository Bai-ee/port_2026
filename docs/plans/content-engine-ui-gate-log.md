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
