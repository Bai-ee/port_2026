# UI Starting Point Style Guide

This document is the canonical starting point for new UI work in this repository.

These components are finalized standards. New requests should start from one of these patterns before introducing any new surface language, spacing system, or interaction model.

## Rule Of Use

- Start from these templates first.
- Reuse their construction, proportions, and surface language unless the request clearly requires a new pattern.
- Prefer extending these components over inventing parallel one-off styles.
- If a new component needs a card, pill CTA, filter row, or internal product shell, it should inherit from the patterns below.

## Surface System

### 1. `data-stack-panel`

Use this as the default marketing panel shell.

Purpose:
- full-width section shell
- homepage stacked panels
- large marketing/product showcase sections

Construction:
- translucent warm-neutral glass panel
- `rgba(245, 241, 223, 0.18)` background family
- `blur(24px)` backdrop treatment
- inset white highlight / border treatment
- rounded large panel shell
- content aligned to the shared `max(10vw, calc((100% - 810px) / 2))` page gutters

Source:
- [docs/INTERNAL_PAGE_BACKGROUND_SYSTEM.md](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/INTERNAL_PAGE_BACKGROUND_SYSTEM.md:1)
- [StackedSlidesSection.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/StackedSlidesSection.jsx:1309)
- [Header.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/Header.jsx:48)

Default use:
- homepage product sections
- showcase panels
- any large glass section that sits above the animated background system

### 2. Shared card surface

This is the default card language for internal product cards and homepage capability cards.

Core token set:
- `background: rgba(255,255,255,0.5)`
- `border: 1px solid rgba(212, 196, 171, 0.82)`
- `box-shadow: 0 1px 0 rgba(255,255,255,0.65), inset 0 1px 0 rgba(255,255,255,0.4)`

Shared token source:
- [pageSurfaceSystem.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/pageSurfaceSystem.js:1)

This surface appears in:
- `#auth-card`
- `[data-capability-card]`
- internal modal cards in the dashboard

## Finalized Components

### 1. `#auth-card`

Use this as the default auth / onboarding / gated-entry card.

Purpose:
- sign in
- sign up
- create-dashboard entry
- simple protected-route access cards

Construction:
- mounted inside the internal product shell with `InternalPageBackground`
- uses `internalPageGlassCardStyle`
- max width `30rem`
- padding `clamp(1.25rem, 5vw, 2rem)`
- radius `1.1rem`
- additional soft elevation layered on top of the shared card surface
- branded top row with signature mark, mono eyebrow, and circular back control
- scrolling marquee title band
- compact form stack under the heading

Source:
- [AuthPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/AuthPage.jsx:150)
- [AuthPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/AuthPage.jsx:215)
- [AuthPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/AuthPage.jsx:477)
- [pageSurfaceSystem.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/pageSurfaceSystem.js:7)
- [InternalPageBackground.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/InternalPageBackground.jsx:1)

Default use:
- login
- signup
- onboarding checkpoint
- restricted-access explanation card
- modal-like internal setup card

Do not use it for:
- dense dashboards
- multi-column data views
- broad marketing content blocks

### 2. `[data-capability-card]`

Use this as the default feature / capability / add-on card.

Purpose:
- marketing capability grids
- product feature summaries
- add-on/service tiles
- cards that need a small icon block plus heading/body copy

Construction:
- 2-column grid: `auto 1fr`
- icon or media block on the left
- text stack on the right
- padding `clamp(1rem, 2vw, 1.35rem)`
- min height `clamp(7rem, 14vw, 9rem)`
- radius `1.1rem`
- shared card surface tokens
- warm-neutral typography: dark title, softer brown body copy

Subparts:
- badge/media block
- title
- supporting body copy
- optional embedded media or extended content

Source:
- [StackedSlidesSection.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/StackedSlidesSection.jsx:1384)
- [StackedSlidesSection.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/StackedSlidesSection.jsx:1975)

Default use:
- homepage capability listings
- feature explainers
- product modules
- any new card-based UI that needs to feel native to this repo

### 3. `#panel-hero-cta`

Use this as the default premium CTA pill in marketing contexts.

Purpose:
- primary homepage CTA
- panel CTA
- sticky CTA clones
- compact, high-signal action links

Construction:
- inline-flex pill
- gradient multi-color fill
- fully rounded `999px` radius
- white text
- layered highlight/shadow treatment
- includes circular avatar on the left
- includes small arrow glyph on the right
- default width cap `min(100%, 14.75rem)` in hero usage

Source:
- [StackedSlidesSection.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/StackedSlidesSection.jsx:1330)
- [StackedSlidesSection.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/StackedSlidesSection.jsx:1879)
- [StackedSlidesSection.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/StackedSlidesSection.jsx:1897)

Default use:
- primary conversion actions on marketing surfaces
- sticky CTA variants
- in-panel action anchors

Do not use it for:
- plain internal utility buttons
- admin actions
- destructive actions

### 4. `#hero-panel-filter-pills`

Use this as the default filter/tag/toggle row for marketing panels.

Purpose:
- category switching
- content lens toggles
- pill-based filter rows
- lightweight mode switches

Construction:
- centered wrapping row
- spaced chip layout with generous vertical breathing room
- chips use mono typography
- inactive chip: soft neutral fill and border
- active chip: dark fill with light text
- chips remain small and dense, not oversized tabs

Source:
- [StackedSlidesSection.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/StackedSlidesSection.jsx:1343)
- [StackedSlidesSection.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/StackedSlidesSection.jsx:2207)
- [StackedSlidesSection.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/StackedSlidesSection.jsx:2216)
- [StackedSlidesSection.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/StackedSlidesSection.jsx:2231)

Default use:
- marketing panel filters
- chip-based mode toggles
- simple content-category switches

Do not use it for:
- high-density app tabs
- permission-critical toggles
- forms that need explicit selected-state labels

### 5. `#cmo-dashboard-table`

Use this as the default embedded marketing/service comparison table.

Purpose:
- “what you get / powered by” breakdowns
- compact deliverable tables
- wide card tables embedded inside feature cards

Construction:
- lives inside the wide `data-capability-card` variant
- appears under a top border divider with extra spacing
- 3-column structure:
  - left: deliverable / outcome
  - center: directional arrow
  - right: system / engine / owner
- small uppercase table headers
- soft row dividers
- warm-neutral text colors consistent with the capability card
- may be followed by an inline URL input + CTA row

Source:
- [StackedSlidesSection.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/StackedSlidesSection.jsx:1459)
- [StackedSlidesSection.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/StackedSlidesSection.jsx:1495)

Default use:
- embedded service breakdowns
- deliverable mappings
- compact capability tables on marketing/product pages

Do not use it for:
- operational admin tables
- high-density analytics tables
- client dashboard data grids with many sortable fields

### 6. `#dashboard-source-cta-row`

Use this as the default inline source-input plus action row for product and dashboard surfaces.

Purpose:
- website source entry
- inline URL capture
- source refresh / rerun controls
- compact input-plus-CTA actions inside cards or dashboard sections

Construction:
- rounded full-pill container
- soft white glass fill
- subtle border and shallow shadow
- left utility icon
- transparent inline text input in the middle
- right-aligned gradient CTA pill
- always remains on one line
- fills the full width of the space it is given
- mobile keeps a normal pill height, not a compressed dot/button state
- smallest breakpoint must still show CTA copy
- approved smallest-copy fallback is `Rerun`
- arrow remains visible on mobile
- no standalone success-message row under the control in the approved dashboard UI

Source:
- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:1149)
- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:2475)
- [StackedSlidesSection.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/StackedSlidesSection.jsx:1494)

Default use:
- dashboard source controls
- compact “enter URL then run” interactions
- inline utility rows that need a productized input + action treatment

Do not use it for:
- long forms
- dense admin filters
- multi-field search/filter toolbars

### 7. `#founders-top-strip`

Use this as the default fixed internal top nav when a dashboard or product page should visually align to the homepage nav.

Purpose:
- dashboard top navigation
- internal pages that should inherit homepage nav language
- fixed glass nav bars that sit above the page content rather than inside a content card

Construction:
- fixed to the top of the viewport
- full-width nav shell
- inner rail constrained to the same page width as the dashboard content
- signature mark on the left
- two visible actions on the right
- approved dashboard labels are `Homepage` and `Logout`
- should feel like the homepage nav, not like a utility strip or admin toolbar
- dashboard-only controls may remain implemented off-screen/hidden if logic must be preserved, but they are not part of the approved visible nav

Source:
- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:1082)
- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:1747)
- [Header.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/Header.jsx:48)

Default use:
- fixed internal dashboard nav
- product pages that should normalize to homepage navigation styling

Do not use it for:
- admin tables with dense operator controls
- sub-section tabs
- in-card header rows

### 8. `#founders-hero-numeric` marquee headline

Use this as the default large dashboard hero headline treatment.

Purpose:
- primary dashboard headline slot
- large brand/system statement at the top of an internal page
- animated copy that should retain the repo's display typography

Construction:
- uses the existing large `#founders-hero-numeric` display scale
- scrolling marquee replaces the former numeric readout entirely
- animation must be smooth for short and long copy alike
- marquee distance/duration are measured from rendered text width
- duplicate copies are generated to fully cover the shell width at each breakpoint
- do not use reset-based JS loops that visibly hesitate at the loop point

Source:
- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:1110)
- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:1904)

Default use:
- dashboard hero headline
- large moving statement copy on internal product pages

### 9. `#founders-hero-meta`

Use this as the default compact line-item stack paired with the dashboard hero headline.

Purpose:
- client/account metadata
- tier/status line items
- bottom-mounted source control row paired to the hero

Construction:
- compact mono line items with separators
- approved visible rows are `CLIENT`, `ACCOUNT`, and `TIER`
- `TIER` value may be clickable and underlined
- website source control sits as the bottom row inside this same container
- `INDUSTRY` and `MODEL` do not belong in this line-item stack anymore

Source:
- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:1127)
- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:1971)

### 10. `#capability-grid` compact intake-card system

Use this as the default compact dashboard card grid for intake-derived content.

Purpose:
- brand/system intake summaries
- structured dashboard cards that surface normalized client inputs
- small dashboard cards that should stay compact instead of expanding into large desktop marketing cards

Construction:
- outer grid is a bordered card field with rounded perimeter
- grid container clips the outer corners so the top-left, top-right, bottom-left, and bottom-right cards inherit rounded outer edges regardless of column count
- cards use the compact/mobile-scale `cmo-dashboard-card` feel, even on larger screens
- cards use placeholder image blocks rather than video thumbs
- cards are table-driven and custom to the content they summarize

Approved top-card family:
- `#tile-brand-tone`
- `#tile-style-guide`
- `#tile-industry`
- `#tile-business-model`
- `#tile-priority-signal`
- `#tile-draft-post`
- `#tile-content-angle`
- `#tile-content-opportunities`

Important rule:
- `INDUSTRY` and `MODEL` are represented as cards, not hero line items

Source:
- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:938)
- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:1217)
- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:2017)

## Standard Composition Patterns

### Marketing product panel

Start here for most homepage and showcase requests:

1. `data-stack-panel`
2. hero text row
3. `panel-hero-cta`
4. `hero-panel-filter-pills`
5. capability grid of `data-capability-card`
6. optional wide card with `cmo-dashboard-table`
7. optional inline `dashboard-source-cta-row`

Source:
- [StackedSlidesSection.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/StackedSlidesSection.jsx:1309)

### Internal product page

Start here for login, onboarding, dashboard entry, and protected routes:

1. `InternalPageBackground`
2. `founders-top-strip` if the page should visually normalize to the homepage nav
3. hero shell with `founders-hero-numeric` marquee plus `founders-hero-meta`
4. `auth-card` or another card using the shared internal card surface
5. `capability-grid` for compact intake/data cards when the page is dashboard-like

Source:
- [docs/INTERNAL_PAGE_BACKGROUND_SYSTEM.md](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/INTERNAL_PAGE_BACKGROUND_SYSTEM.md:9)

## Table Guidance

There are two default table families in this repo:

### Marketing table

Use `#cmo-dashboard-table` when the table is part of a pitch, product explanation, or service breakdown.

### Operational table

Use the admin table pattern when the table is for real system data, queue state, or operator workflows.

Source:
- [AdminPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/AdminPage.jsx:689)
- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:1913)

Operational table characteristics:
- tighter data density
- mono headers
- more explicit row separators
- less decorative treatment
- optimized for scanning, not persuasion

## Default Decision Rules

When a new UI request comes in:

- If it is login, onboarding, or account entry: start with `#auth-card`.
- If it is a feature tile, service card, or add-on card: start with `[data-capability-card]`.
- If it needs a premium CTA on a marketing surface: start with `#panel-hero-cta`.
- If it needs category chips or lightweight panel toggles: start with `#hero-panel-filter-pills`.
- If it needs an embedded explanatory table on a marketing page: start with `#cmo-dashboard-table`.
- If it needs a compact source-input plus action control: start with `#dashboard-source-cta-row`.
- If it needs a full-page marketing shell: start with `data-stack-panel`.
- If it needs a fixed internal nav that should match the homepage: start with `#founders-top-strip`.
- If it needs a large internal dashboard headline: start with the `#founders-hero-numeric` marquee pattern.
- If it needs dashboard metadata near the hero: start with `#founders-hero-meta`.
- If it needs compact dashboard summary cards: start with `#capability-grid` and the approved intake-card family.

## Non-Negotiables

- Do not introduce a new card surface if the shared card surface already fits.
- Do not create a new pill CTA style if `panel-hero-cta` can be reused.
- Do not invent a new chip system before trying `hero-panel-filter-pills`.
- Do not invent a new inline URL-plus-CTA row before trying `#dashboard-source-cta-row`.
- Do not build marketing tables in the admin table style.
- Do not build internal auth/setup surfaces on a flat black or plain white background when the internal background system applies.
- Do not put `INDUSTRY` or `MODEL` back into the hero line-item stack.
- Do not turn the approved fixed dashboard nav back into an in-canvas panel.
- Do not use a glitch-prone reset loop for the dashboard hero marquee.
- Do not square off the capability grid perimeter; the outer grid corners should remain rounded.

If a request cannot start from one of these patterns, document why before introducing a new base component.
