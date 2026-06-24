# Dashboard Modal UI Handoff

Purpose: continue normalizing the client dashboard card modal UI in another LLM without losing the current design decisions.

## Current Objective

The user wants all card modal tab content to inherit one consistent UI system before that system is applied across existing cards. The current workflow is:

1. Iterate on the standalone UI kit page.
2. Let the user review and tweak the kit.
3. Only after approval, migrate existing card/modal content to shared primitives.

Do not aggressively restyle every card yet unless the user explicitly approves applying the UI kit.

## Review URL

When the dev server is running:

- `/docs/dashboard-modal-component-style-guide.html`
- Full local URL: `http://127.0.0.1:3000/docs/dashboard-modal-component-style-guide.html`

Source file:

- [public/docs/dashboard-modal-component-style-guide.html](/Users/bballi/Documents/Repos/Bballi_Portfolio/public/docs/dashboard-modal-component-style-guide.html:1)

## Design Direction

Use a clean white dashboard theme. Do not introduce yellow, beige, cream, tan, sand, or warm-paper surfaces.

Core visual rules:

- White glass surfaces with neutral gray borders.
- Nested panels use 8px radius.
- UI should be compact and native to a dashboard, not oversized or “clownish.”
- Copy and labels should remain readable, but controls should not look like hero UI.
- The homepage black-outline button style is the reference for secondary actions.
- The homepage `Meet with Bryan` CTA is the reference for the animated comet border.

Primary CTA rule:

- Only one gradient-filled primary CTA should be visible per screen/tab.
- It uses the shared masked conic comet border from `colors.css`.

Field action rule:

- Field-level actions such as `Update & Rerun`, `Search`, `Save Config`, `Post Now`, and `Queue` can also use the animated comet border.
- These stay white-filled, not gradient-filled, so they do not compete with the page's one primary CTA.

## Key Files

Style guide and tracking:

- [public/docs/dashboard-modal-component-style-guide.html](/Users/bballi/Documents/Repos/Bballi_Portfolio/public/docs/dashboard-modal-component-style-guide.html:1)
- [docs/DASHBOARD_MODAL_COMPONENT_STYLE_GUIDE.md](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/DASHBOARD_MODAL_COMPONENT_STYLE_GUIDE.md:1)
- [docs/DASHBOARD_MODAL_CARD_UI_GUIDE.md](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/DASHBOARD_MODAL_CARD_UI_GUIDE.md:1)
- [docs/UI_STARTING_POINT_STYLE_GUIDE.md](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/UI_STARTING_POINT_STYLE_GUIDE.md:1)

Pilot implementation:

- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:14300)
- [components/dashboard/StrategyBuilderCard.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/components/dashboard/StrategyBuilderCard.jsx:1)
- [components/dashboard/strategy-builder/InputsPane.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/components/dashboard/strategy-builder/InputsPane.jsx:1)
- [components/dashboard/strategy-builder/CalendarPane.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/components/dashboard/strategy-builder/CalendarPane.jsx:1)
- [components/dashboard/strategy-builder/PushPane.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/components/dashboard/strategy-builder/PushPane.jsx:1)
- [components/dashboard/strategy-builder/PacingStrip.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/components/dashboard/strategy-builder/PacingStrip.jsx:1)
- [components/dashboard/strategy-builder/SignalToggles.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/components/dashboard/strategy-builder/SignalToggles.jsx:1)

Important existing CSS source:

- [colors.css](/Users/bballi/Documents/Repos/Bballi_Portfolio/colors.css:1)

`colors.css` contains the canonical CTA comet-border implementation:

- `@property --cta-angle`
- `@keyframes cta-border-spin`
- `.cta-pill-btn::before` with a masked `conic-gradient`

Do not replace this with a simple border-box gradient or an unmasked pseudo-element.

## UI Kit Coverage

The current UI kit accounts for these existing dashboard modal patterns:

- Standard analyzer cards: report pane, solutions/problem rows, data rows, audit inventory rows, status chips.
- Multi Device: screenshot/image preview pane, toolbar download/open actions, missing artifact empty state.
- Local Weather and scout config slices: compact white fields, selects, textareas, action bars, field-level animated update/run buttons, status notices.
- Survey Status and Brand System: embedded chat pane, data rows, code/pre artifact pane, JSON/prompt text surfaces.
- Lead gen cards: document preview, image mockup preview, external preview link, iframe/PDF document frame, message/code pane, download action.
- Client Estimate and Custom Briefs: multi-section config, code textarea, checkbox rows, file drop/upload, saved artifact cards, public/PDF/deploy action buttons.
- Conversation Intake and Events Search: long textarea ingest, digest/search field actions, tagged result cards, event result cards, error states.
- Marketing Brief: summary metric cards, platform toggles, per-platform result buckets, search plan rows, source platform statuses, latest output stat rows.
- Knowledge Base: text/url/upload ingest tabs, file upload, semantic search results, highlighted matches, citation chips, distance pill, chat answer panel, item rows.
- Social Posting: composer, character count, optimize/draft/post/schedule actions, diagnostics list, agent cards, queue cards.
- Strategy Builder: source toggles, segmented controls, sliders, pacing strip, calendar/post rows, inline edit, regen, queue/schedule all, export rows.
- Market Category and Newsletter: category override/data rows, report frame, email/newsletter iframe preview, details rows.

If a future card needs a new pattern, add it to the UI kit and update the coverage docs before implementing the card UI.

## Current Primitive Sizing

Recent adjustment: the user said the UI was too large.

Current target sizes in the kit:

- Standard input/select: about `54px` high, `16px` text.
- Textarea: about `132px` min height, `16px` text.
- Primary CTA: about `52px` high, `16px` text.
- Field action button: about `46px` high, `16px` text.
- Segmented button: about `44px` high, `13px` text.
- Table body: about `14px` text.
- Source URL pill: about `64px` high, `20px` URL text.

Keep any future changes in this density range unless the user asks otherwise.

## Completed Work

- Created the standalone HTML UI kit page.
- Added source-of-truth docs for component style and card UI coverage.
- Switched the kit and pilot away from warm/yellow surfaces to white/neutral.
- Replaced broken CTA animation with the actual masked conic comet-border technique.
- Added field-level animated border buttons.
- Reduced oversized controls and typography.
- Audited existing card/modal content and expanded the kit to cover unique patterns.
- Applied a scoped Strategy Builder pilot via `#strategy-builder-card-shell.dashboard-modal-pilot` in `DashboardPage.jsx`.

## Verification Already Run

Commands previously passed:

```bash
curl -I http://127.0.0.1:3000/docs/dashboard-modal-component-style-guide.html
npm run build
```

Expected warnings during build:

- Next.js middleware convention deprecation warning.
- Turbopack NFT tracing warning from `features/leadgen/client-folder.js` via `app/api/leadgen/generate/route.js`.

These warnings are unrelated to the UI kit work.

Browser verification:

- The style guide route loaded in the in-app browser.
- Field action buttons were verified to have `::before` running `cta-border-spin`.
- The UI kit had one gradient-filled `.cta-pill-btn` primary.

## Known Repo State / Caution

The worktree may contain unrelated dirty changes. Do not revert unrelated files.

Known unrelated or pre-existing dirty areas seen during this work:

- `features/not-the-rug-brief/runtime.js`
- `features/not-the-rug-brief/scribe.js`
- untracked dashboard/intake/events files

Files touched by this UI work include:

- `DashboardPage.jsx`
- strategy-builder component files
- docs listed above
- `public/docs/dashboard-modal-component-style-guide.html`

Before making broader migrations, run `git status --short` and inspect any files you plan to edit.

## Recommended Next Steps

1. Ask the user to review the latest UI kit page.
2. Tweak only the UI kit until the user approves.
3. Once approved, extract shared primitives into a real dashboard modal UI layer.
   - Suggested component file: `components/dashboard/modal-ui.jsx`
   - Suggested CSS file: `components/dashboard/modal-ui.css`
4. Migrate cards incrementally, starting with the Strategy Builder pilot.
5. Then migrate lower-risk cards:
   - Brand System
   - Multi Device
   - Local Weather
   - Survey DATA
   - Newsletter
6. Then migrate higher-touch cards:
   - Marketing Brief config
   - Knowledge Base
   - Social Posting
   - Client Estimate / Custom Briefs

## Migration Rule

When migrating existing cards, map existing content to UI kit primitives. Do not replicate sample UI copy exactly. The kit is the visual vocabulary, not the final content.

Avoid:

- Adding new inline styles when a primitive exists.
- New local button/input/table systems.
- Warm/yellow/tan surfaces.
- Unmasked conic pseudo-elements.
- Multiple gradient-filled primary CTAs in one visible tab.

