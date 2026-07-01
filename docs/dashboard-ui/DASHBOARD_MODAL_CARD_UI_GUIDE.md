# Dashboard Modal Card UI Guide

Status: Draft audit and normalization target
Scope: Client dashboard card detail modals, especially the content inside modal tabs

## Goal

Dashboard card modals should feel like one product system. The REPORT tab is the current quality target: calm, structured, white, document-like, and easy to scan. Non-report tabs should inherit that same surface language instead of introducing separate dark panels, one-off cards, mismatched buttons, yellowed surfaces, or inconsistent padding.

The current visual direction combines the REPORT mini-brief output, the repo glass surface system, and the website controls shown in the latest references: the source URL `Update & Rerun` pill, black-outline `Run Now` / `Details` buttons, the nav `Logout` / `Contact` pills, and the homepage `Meet With Bryan` gradient CTA.

Component iteration page:

- [public/docs/dashboard-modal-component-style-guide.html](/Users/bballi/Documents/Repos/Bballi_Portfolio/public/docs/dashboard-modal-component-style-guide.html:1)
- Dev URL: `/docs/dashboard-modal-component-style-guide.html`

Full-screen video/editor standard:

- [VIDEO_STUDIO_UX_KIT.md](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/dashboard-ui/VIDEO_STUDIO_UX_KIT.md:1)
- Use this for video-editor and motion-studio work. The modal card kit remains the standard for dashboard card detail tabs.

## Two Modal Surfaces — pick one per card

Every card that opens on click uses **exactly one of two surfaces**. Decide which before building. Do not invent a third pattern.

Routing lives in one place: `openCapabilityCard` in [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:7272). Read it before wiring a new card.

### Surface A — Full-Screen Overlay (`#brief-fullscreen-overlay`)

A calm, chrome-light viewer for **one finished thing**: a brief document, an image, or a video. No tabs, no controls, no editing. The client "sees it bigger" and can download/share. This is the **Creative Brief Preview** surface and the only surface non-admin clients ever see.

One shared shell, reused by three React states (all render identical DOM ids):

| State | What it shows | Body element |
| --- | --- | --- |
| `namedBriefView` | Creative Brief / named brief previews (the reference UI) | `#brief-fullscreen-iframe` (brief HTML) |
| `briefFullScreen` | Legacy daily brief | `#brief-fullscreen-iframe` (brief HTML) |
| `deliverableView` | Deliverable assets for clients (image/video) | `.deliverable-view-body` → `<img>` / `<video>` |

Anatomy (do not rename these ids — they are the contract, and the CSS keys off them):

```
#brief-fullscreen-overlay            // fixed, dimmed (rgba(0,0,0,0.6)) + blur(8px) backdrop; click = close
  #brief-fullscreen-container        // 90vw × 90vh white panel, radius 16px (.deliverable-view-container variant for assets)
    #brief-fullscreen-actions        // top-right row
      #brief-fullscreen-download     // ↓ Download (single asset, or Download PDF for briefs)
      #brief-fullscreen-share        // ↗ Share (native share → fallback opens asset)
      #brief-fullscreen-close        // [ ✕ ]
    #brief-fullscreen-iframe         // brief HTML  — OR —
    .deliverable-view-body           // asset body
      .deliverable-view-video        // kind: 'video'
      .deliverable-view-figure       // kind: 'image' (one per item)
        .deliverable-view-img
        .deliverable-view-cap → .deliverable-view-dl
```

Top-right action row is the standard: **Download · Share · Close**. Single-asset only shows Download + Share; multi-image bodies use per-figure `.deliverable-view-dl` links instead of a single top Download.

Wire a card into Surface A by giving it a `deliverableAsset` payload (see any deliverables-bucket card def, e.g. [`post-me`](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:10468)):

```js
deliverableAsset: hasAsset ? {
  title: 'Card Title',
  kind: 'video' | 'image',
  items: [{ src, label, filename }],   // single item = "see it bigger"; multiple = stacked figures
} : null,
```

Non-admin + `deliverableAsset` present ⇒ click opens Surface A automatically. No per-card modal code.

### Surface B — Tabbed Detail Modal (`#tile-detail-modal`, `activeTileModal`)

The admin control surface: tabs, bento cells, config forms, run actions, data rows. Everything below in this guide (the tab contract, pane types, tokens) describes Surface B. **Admin-only** — clients never reach it.

### Decision rule

| Card produces… | Admin sees | Client (non-admin) sees |
| --- | --- | --- |
| A finished document only (Creative Brief) | A (overlay) | A (overlay) |
| A pure asset, no admin controls worth a tabbed modal — **overlay for everyone** (multi-device-view, post-me) | A (overlay) | A (overlay) |
| A client asset **but admins keep a richer modal** (mockup-studio / Video Promo, cross-device-images / Full Page Images, social-preview) | B (tabbed) | A (overlay, via `deliverableAsset`) |
| Analysis/config only, no client asset (seo-performance, design-evaluation, local-weather, email-digest, brand-system, …) | B (tabbed) | nothing (no modal) |

The overlay-for-everyone set is `OVERLAY_FOR_ALL_CARD_IDS` in [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:2481). Add a card id there to give admins the overlay too; otherwise admins fall through to the tabbed modal.

Practical test when adding a card:
1. Is there a single finished asset/document a client should see bigger? → it needs a `deliverableAsset` (Surface A for clients).
2. Does an admin need tabs/controls/run actions? → it needs a Surface B branch. If not, add the id to `OVERLAY_FOR_ALL_CARD_IDS` so admins get the overlay too.
3. A card may have both (role-split is normal). It must never have a third, bespoke modal.

## UI Kit Coverage Audit

Every unique UI/data pattern found in current dashboard card modal content now has a primitive represented in the UI kit:

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
- Video Studio: documented separately as a full-screen editor shell with export artboard, under-canvas transport, keyframe timeline, floating right rail, render terminal, toasts, and captures.

New modal card development should map its content to one of these primitives first. If it needs a genuinely new pattern, add it to the UI kit and this coverage list before implementing the card UI.

## Current Audit

### Native / closest to target

- `REPORT` tabs rendered through `TileDetailAnalysisContent.jsx` and `renderMiniBriefHtml()`.
- The main modal shell in `DashboardPage.jsx` already uses a consistent bento structure: header, left visual/about column, right content column.
- `tile-detail-tabs`, `tile-detail-tab-content`, `tile-detail-stat-row`, and `mb-config-*` form the best existing foundation.

### Inconsistent areas

- Many tab panes use inline styles instead of a shared pane contract.
- Some tab content uses one-off tinted surfaces while `mb-config-*` still uses dark translucent controls.
- `SocialPostingPanel.jsx` defines a separate `sp-*` visual system.
- `KnowledgeBaseCard.jsx` defines a separate `kb-*` visual system.
- Preview/code panes use different backgrounds: dark markdown preview, `#f8f7f4`, raw white, and transparent pane variants.
- Buttons are split across `tile-foot-rerun-btn`, `tile-solution-expert-cta`, `sb-cta`, `mb-config-mini-btn`, `sp-* button`, and inline anchor styles.
- Empty states are recreated several times with inline flex layouts and slightly different typography.

## Card / Tab Findings

### Standard Analyzer Cards

Cards: `design-evaluation`, `seo-performance`, `social-preview`, `agent-readiness`, generic module reports.

Target:
- Keep REPORT as default.
- Make SOLUTIONS and PROBLEMS use the same report-like density and white paper surfaces.
- Replace neon severity gradients with small restrained status chips unless the gradient CTA is intentionally needed.

### Multi Device View

Tabs: `DESKTOP`, `TABLET`, `MOBILE`

Issues:
- Image panes are edge-to-edge and utility link styling is inline.
- Missing screenshot state uses a plain placeholder.

Normalize:
- Use a shared artifact preview pane with a toolbar row.
- Use one download button style.
- Use the shared empty state for missing captures.

### Local Weather

Tabs: `CONFIG`, `FORECAST`

Issues:
- Uses `mb-config-*`, which currently carries some dark-control styling inside a light modal shell.
- Forecast rows use `config-field`/inline styling instead of modal stat rows.

Normalize:
- Keep the sectioned config layout, but move all inputs and action bars to white glass tokens.
- Forecast should be a stat/data section with a compact summary card at top.

### Survey Status

Tabs: `CHAT`, `DATA`

Issues:
- CHAT embeds the onboarding chat at zero padding while DATA uses the standard stat pattern.

Normalize:
- Keep zero padding only for full embedded chat surfaces.
- DATA should stay as stat rows but include a shared section header and empty state.

### Brand System

Tabs: `MASTER PROMPT`, `JSON`, `DATA`

Issues:
- Prompt and JSON panes use inline `pre` styling.
- Empty states are local inline components.

Normalize:
- Use a shared code/artifact pane: same padding, background, border, mono size, copy/download toolbar.
- DATA stays stat rows.

### Lead Gen Flow Cards

Cards: `client-brief`, `client-mockup`, `client-site`, `client-estimate`

Issues:
- Preview panes use one-off centered layouts and mixed paper/card backgrounds.
- Data tabs are consistent enough but rely on inline `wordBreak`.
- Estimate config uses the same dark `mb-config-*` tokens as other config areas.

Normalize:
- Use shared preview states: document preview, image preview, external URL preview, iframe-blocked preview.
- Use shared data row overflow behavior instead of inline styles.
- Keep estimate configuration as sectioned config, but restyle with light glass tokens.

### Admin Cards

Cards: `email-digest`, `email-settings`, `create-client`

Issues:
- Email preview and settings rely on `mb-config-*`; the structure is fine, but the color language needs alignment.

Normalize:
- Use the same tabbed container and sectioned config contract as Weather/Estimate.
- Action bar should match the white modal background, not dark sticky fade.

### Strategy Builder / Market Category

Components: `StrategyBuilderCard.jsx`, strategy-builder panes, `MarketCategoryPanel.jsx`

Issues:
- These are closest to a reusable app-panel system, but `sb-*` is parallel to `mb-config-*`.

Normalize:
- Promote `sb-section`, `sb-label`, `sb-hint`, `sb-input`, `sb-select`, `sb-seg`, `sb-cta`, and `sb-notice` into the shared modal tab system.
- Use these as the default internal controls for future non-report tab content.

### Knowledge Base

Component: `KnowledgeBaseCard.jsx`

Issues:
- Separate `kb-panel`, `kb-result-card`, chip, and citation styling.
- Good layout, but it should inherit shared section/card/chip tokens.

Normalize:
- Convert `kb-panel` to the shared modal section card.
- Convert result cards to the shared result-list card pattern.
- Keep search/chat workflow but use one control/button system.

### Social Posting

Component: `SocialPostingPanel.jsx`

Issues:
- Fully separate `sp-*` visual system.
- Button, input, panel, notice, and queue item styles do not inherit modal tab tokens.

Normalize:
- Convert compose/agents/queue to shared modal panels.
- Use icon buttons for diagnostics/process-due and standard secondary/primary buttons for post actions.
- Use shared notice, empty, and status chip styles.

## Normalized Modal Tab Contract

Every tab should compose from these primitives:

1. `tile-detail-bento-cell tile-detail-tabbed-container`
2. `tile-detail-tabs`
3. `tile-detail-tab`
4. `tile-detail-tab-content`
5. one of the standard pane types below

### Pane Types

- Report pane: iframe/doc output, no extra inner card.
- Data pane: section heads plus `tile-detail-stat-row`.
- Config pane: stacked sections with labels, inputs, action bar.
- Artifact pane: toolbar plus document/image/code preview surface.
- App pane: two-column operational workflow using shared section cards.
- Empty pane: centered mono kicker plus short plain-language body.

## Shared Tokens To Enforce

Use the shared internal card/glass surface as the base:

- `background: rgba(255,255,255,0.5)`
- `border: 1px solid rgba(42, 36, 32, 0.12)`
- `box-shadow: 0 1px 0 rgba(255,255,255,0.65), inset 0 1px 0 rgba(255,255,255,0.4)`
- `backdrop-filter: blur(28px)`
- card radius: `8px` for nested panels, `1rem` only for top-level modal cells
- tab labels: mono, uppercase, 10px, `0.08em` letter spacing
- body copy: `var(--font-ui)`, 13px to 15px, neutral secondary text
- data values: right aligned on desktop, left aligned on mobile
- primary CTA: one per visible tab, blue/purple/pink gradient fill, animated border, no oversized diagonal decoration
- secondary actions: website black-outline button style for `Run Now`, `Details`, and similar card footer commands
- source controls: rounded URL pill with globe icon, large readable URL text, and right-aligned `Update & Rerun` action
- form controls: white field background, mono labels, readable compact input text, 8px field radius
- toggles/segments: white shell with dark active state and consistent spacing

Avoid:

- dark input/control fields inside light modal tab panes
- one-off inline pane backgrounds
- nested decorative cards
- new button systems for each card
- unbounded `pre` blocks without shared overflow treatment

## Implementation Plan

1. Create shared modal tab primitives in a dashboard UI module.
   - Suggested file: `components/dashboard/modal-ui.jsx`
   - Exports: `ModalTabShell`, `ModalSection`, `ModalField`, `ModalActionBar`, `ModalEmptyState`, `ModalArtifactPane`, `ModalDataRows`, `ModalCodeBlock`, `ModalButton`.

2. Move the shared CSS out of `DashboardPage.jsx`.
   - Suggested file: `components/dashboard/modal-ui.css` or a colocated CSS module.
   - Keep the existing class names as compatibility aliases during migration.

3. Restyle `mb-config-*` and `sb-*` to one light glass control language.
   - Prefer `sb-*` as the base for forms and controls.
   - Keep `mb-config-*` as aliases until all existing markup is migrated.

4. Migrate cards in this order.
   - Low risk: Brand System, Multi Device, Weather, Survey DATA.
   - Medium risk: Client Brief, Client Mockup, Client Site, Client Estimate.
   - Higher touch: Knowledge Base, Social Posting, Strategy Builder.

5. Add a development rule.
   - New dashboard modal tab content must use the primitives above.
   - If a new tab needs a new primitive, add it to this guide and the shared UI module in the same change.

## Pilot

First card: `strategy-builder`

Why:
- includes tabs, source toggles, segmented controls, inputs, sliders, lists, post rows, export buttons, queue actions, and empty states
- exercises the highest number of reusable UI primitives without touching unrelated card data contracts

Review target:
- approve the scoped `dashboard-modal-pilot` direction first
- then promote the accepted primitives into shared modal UI classes and migrate the remaining cards

## Acceptance Checklist

- Every tab has the same outer padding rhythm.
- Every nested panel uses the same white glass surface and 8px radius.
- Every primary, secondary, icon, and destructive action maps to one button family.
- Every empty state uses one shared component.
- Every code/pre/document preview uses one artifact pane.
- Config panes never use dark controls unless the entire modal switches to a dark terminal mode.
- Mobile stacks without clipped text, horizontal overflow, or hidden action bars.
- New card work links back to this guide from the PR or implementation prompt.
