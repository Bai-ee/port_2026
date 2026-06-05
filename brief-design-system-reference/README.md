# Brief Design System Reference

Self-contained reference copy of the dashboard brief/report design system.

## Start here

- `features/scout-intake/mini-brief-renderer.mjs`
  - The single-page card report design system used by Social Preview, Market Category, Visual DNA, SEO, Agent Readiness, and other Report tabs.
  - Exports `MINI_BRIEF_CSS` and `renderMiniBriefHtml()`.

- `features/scout-intake/mini-briefs/`
  - Data adapters that convert card/module data into the renderer's section schema.
  - `card-report-adapter.mjs` is the generic adapter used for standard dashboard cards.
  - `social-preview-adapter.mjs` is the original Social Preview report reference.

- `app/preview/mini-brief/page.jsx`
  - Preview page showing how the mini-brief renderer is used in a route.

## Full Brief Reference

- `docs/brief.html`
  - Static full-page HTML example of the original designed brief.

- `features/scout-intake/brief-renderer.js`
  - Full intake brief renderer.

- `features/scout-intake/brief-css.cjs`
  - Shared CSS export for the full brief preview route.

## Notes

This folder is a snapshot for reference and copying. Runtime code still lives in the original app paths.
