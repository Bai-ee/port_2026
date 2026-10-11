# Content Engine UI gate log

## U1 (tokens, primitives, shared xce-* restyle)
- npm test: 4511 tests, 4509 pass, 2 fail (vendor-api-lib only) — same as baseline.
- Diff review: XContentEngineCard.jsx changes limited to the `<style jsx global>` block; no JSX/handler/id edits.
- Visual: all 8 tabs at 1280/400, zero console errors, no horizontal overflow. Shots: docs/plans/content-engine-ui-shots/U1/.
- Behaviour smoke: styles only; tab switching exercised by the shot script.
