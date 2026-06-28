# Mobile Width Standard — dashboard cards & modals

Status: **ACTIVE** (2026-06-27). Canonical rule for how dashboard card content uses
horizontal space on phones. Applies to every card modal, current and future.

> Seed doc for a future `/mobile-width` skill. The "Skill seed" section at the
> bottom is the spec that skill would enforce.

## The problem it fixes

Card modals nest several padded containers:

```
#tile-detail-modal-overlay   (outer gutter)
  └ #tile-detail-modal-card
      └ .tile-detail-bento-cell            (the white card surface, 1px border)
          └ .tile-detail-tab-content       (tab body padding)
              └ .vrk-scope .section / .list-card / .sg-card   (inner section padding)
```

Each layer adds horizontal padding. On a 375px phone (iPhone SE) the paddings
compound — observed `.tile-detail-tab-content` rendered at **349px** inside a
**375px** viewport, and inner section cards subtracted ~16–24px more, so the
actual text column was ~310px. Content looked cramped and floated in a narrow
strip with wide empty gutters.

## The rule

**On phones (≤480px), the entire modal padding chain collapses to ONE small
gutter** so content spans nearly the full viewport width.

- Single gutter token: `--mobile-gutter: 8px` (declared on `#tile-detail-modal-overlay`).
- Every standard container uses `var(--mobile-gutter)` for its horizontal padding
  at ≤480px instead of its desktop padding.
- Inner section/list cards keep only a small vertical padding + the same gutter
  horizontally — they do **not** stack their own large left/right padding on top.

Desktop and tablet are unchanged. This is presentation-only.

## Where it lives (as-built)

`DashboardPage.jsx` → the `dashboardCss` template literal (NOT `dashboard.css`,
which is an unimported mirror):

- `#tile-detail-modal-overlay { --mobile-gutter: 8px; }` — the token.
- `@media (max-width: 480px)` block labeled **"MOBILE WIDTH STANDARD"** — applies
  the token across the shared containers: `.tile-detail-tab-content`,
  `#tile-detail-bento-about`, `#tile-detail-bento-data`, `#tile-detail-bento-image-cell`,
  `#tile-detail-modal-header`, and the `.vrk-scope` panels/sections/list/upload rows.
- It sits right after the existing `@media (max-width: 600px)` "modal-content
  mobile hardening" block, so at ≤480px the tighter values win (later rule, same
  specificity).

There is also a `@media (max-width: 560px)` block in `.vrk-scope` that already
tightens the Video Remix panel; the ≤480px standard tightens it further.

## How new cards inherit it (the contract)

A new card gets the standard **for free** if it:

1. Mounts its content inside the **standard containers** — `.tile-detail-tab-content`
   (tabbed cards) or a `.tile-detail-bento-cell` (hero/about/data cells), or a
   `.vrk-scope` panel for the Video-Remix-style layout.
2. Does **not** add its own large horizontal padding on mobile. Inner section
   cards should use `padding: 10px var(--mobile-gutter)` (or inherit), not a
   fixed `16px+` left/right.
3. Lets grids collapse: 2-up `field-grid`/`toggle-grid` → 1 column on mobile;
   thumbnail grids may stay 2-up (scannability) but nothing fixed-width.
4. Uses `min-width: 0; max-width: 100%` on any flex/grid child that holds long
   unbreakable strings (mono ids, URLs) so it can't push the row wider than the
   viewport.

If a card needs a different gutter, override `--mobile-gutter` on that card's
scope — do not hardcode a new padding value.

## Verify

- DevTools → iPhone SE (375px). Open each card modal. The inner content column
  should be ≥ viewport − ~20px (≈355px), not ~310–349px.
- No horizontal scrollbar inside any modal.
- `npm run build` clean.

## Skill seed (`/mobile-width`)

A future skill would, given a card or modal component:

1. **Audit** — at 375px, measure each container in the padding chain; flag any
   whose horizontal padding exceeds `--mobile-gutter` or that introduces a fixed
   `min-width`/non-wrapping row.
2. **Enforce** — rewrite offending paddings to `var(--mobile-gutter)`; collapse
   fixed-column grids to 1 column (or 2-up for thumbnails); add `min-width:0;
   max-width:100%` to long-string children.
3. **Guard** — add the card's scope to the ≤480px standard block if it isn't
   already covered by the shared containers.
4. **Report** — before/after inner content width at 375px; confirm no h-scroll.

Acceptance: inner content width ≥ viewport − 2×`--mobile-gutter`; zero horizontal
overflow; desktop diff = none.
