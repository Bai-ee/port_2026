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
