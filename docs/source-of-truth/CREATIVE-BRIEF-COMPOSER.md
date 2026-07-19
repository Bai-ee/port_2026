# Creative Brief Composer — SSOT

As-built 2026-07-18/19 (commits `b3e916ba` → `d0b6957e`). The admin **Brief Composer** card
(`creative-brief-composer`, Admin bucket) organizes the new-signup Creative Brief: every element
toggles on/off and reorders, two layouts A/B (Classic / Simple), live preview. **The saved config is
global — it IS the brief every new signup gets**, across the dashboard popup, PDF, published
`/briefs/*` pages, and the public homepage sample.

## 1. Config

- **Doc:** `system_flags/creative_brief_config` → `{ layout: 'classic'|'simple', include: {id: bool}, order: {group: [ids]} }`.
- **Module:** `features/scout-intake/creative-brief-config.cjs` — section registries
  (`CREATIVE_BRIEF_GROUPS` classic, `SIMPLE_BRIEF_GROUPS` simple), `defaultCreativeBriefConfig`,
  `normalizeCreativeBriefConfig` (unknown ids dropped, missing ids appended **at the end** of saved
  order with their default on/off), `loadCreativeBriefConfig` (any failure ⇒ defaults).
- **Absent doc = exact as-built classic output.** Defaults are zero-risk.
- Items with `hasHeading` auto-register an `` `<id>:heading` `` include (section heading toggles
  independently of its content). Items with `defaultOff` start unchecked but stay available.
- ⚠️ The client must NEVER import this `.cjs` (the `import.meta`/Fast-Refresh trap — same as
  `features/gbp-reputation`). The registry ships to the UI via the admin GET.
- Layout scope: the flag affects the **onboarding brief only**; executive/named briefs ignore it.

## 2. Admin surface

- **Route:** `app/api/admin/creative-brief-config` — GET `{config, groups, simpleGroups, layouts}`,
  POST saves normalized `{layout, include, order}`. Admin-gated (`verifyAdminRequest`).
- **Card:** `components/dashboard/CreativeBriefComposerCard.jsx` (`CreativeBriefComposerView`),
  wired in `DashboardPage.jsx` (card def in the admin block, modal branch on
  `activeTileModal.cardId === 'creative-brief-composer'`, id registered in the single-panel +
  edit-icon sets). Mirrors the Email Digest card UI: `.vrk-scope` toggle-card grid, ↑/↓ order
  buttons, `H · Heading` chip, Layout (A/B) segmented control, explicit Save.
- Child-group awareness: a group whose key equals an item id in the layout's page-list group
  (`pages` / `sb-pages`) is that page's element group — when the page is off, its cards dim and say
  "saved, but hidden" (a child toggle can't resurface content while its parent page is off; that
  once read as a broken toggle).
- Mobile (≤480px): shell + sections collapse to the single gutter, index chip hidden, preview
  edge-to-edge (`#creative-brief-composer-shell`, `#creative-brief-composer-preview-shell`,
  `#creative-brief-composer-root` rules in the `dashboardCss` MOBILE WIDTH block).

## 3. Preview mechanics (the traps live here)

- Preview iframe = the public sample route `app/api/public/hitloop-creative-brief`
  (HITLOOP data, no auth) with `?v=<Date.now()>&layout=<selected>&fit=1`.
- `?layout=` overrides the saved layout only — lets the composer A/B before saving. Switching to
  the preview tab auto-saves dirty edits first, so preview == saved == what signups get.
- ⚠️ **`fit=1` is load-bearing.** The iframe is content-height-sized (no inner scroll — the modal
  scrolls the whole brief). That makes `100vh` INSIDE the iframe equal the full document height, so
  classic's `min-height:100vh` poster pages balloon on every re-measure and the brief "populates
  then disappears". `fit=1` makes the route inject
  `section.page:not(.sb-sec){min-height:min(100vh,860px)!important}` — preview-only; real renders
  never get it. Client side: `measurePreview` re-measures at 600/1500/3500ms (late media) with a
  60k sanity ceiling.
- ⚠️ The sample route is CDN-cached (`s-maxage=600` + a **day** of stale-while-revalidate) — any
  preview URL must carry a globally unique `v` (timestamp), never a session-relative counter.
- Dev: both the sample route and the admin route evict `creative-brief-config.cjs` from the require
  cache per request (same pattern as brief-preview's `STALE_CJS`); restart `npm run dev` if edits
  still don't show.

## 4. Render architecture (`app/api/dashboard/brief-preview/route.js`)

- `handleGet` loads the config once and passes `creativeBriefConfig` into
  `renderMarketingBriefHtml`. The public sample route does the same (its `renderMarketingBriefHtml`
  is dynamically imported from this file).
- Inside `renderCreativeBriefSummary`: content fragments build once, then assemble per config as
  keyed **`pageBuilders`** — sec-nums number at build time in final order, so toggling/reordering
  never breaks numbering. Classic assembly is untouched code.
- Label parsing: `CB_LABELS` accepts legacy labels (Headline, What This Site Is, Decision, …) AND
  the Simple-era labels (Key Insight, Current Positioning, The Decision, What to Clarify Next).
  Simple builders prefer new labels, fall back to legacy — every existing client renders fully
  without regeneration. **Pending phase:** upgrade the summarizer prompt
  (`features/scout-intake/brief-summarizer.js` onboarding format, ~L421) to emit the new labels
  natively + tone rules (AI-assisted not AI-powered, no em dashes, 2–3 sentence paragraphs).

## 5. Simple layout (Nothing-style flat system)

Per the user's spec + `/nothing-design`: **everything is line items — labels, dividers, lead text,
numbered rows, thumbnail rows. Nothing may look like Classic.**

- `body.sb-body` (simple only): flat warm off-white (no radial gradients), flat ink CTA pill
  (no gradient/spin), `.cb-deco` + signature image hidden.
- Sections = `section.page.sb-sec`: content-height document flow, no sec-nums/ornaments; headers
  are Space Mono ALL-CAPS 13px labels over a hairline `.rule`. Cover (`.cover--simple`) is a
  compact header block at every size; ONE Doto hero moment (the cover date, "July 18, 2026" form);
  **The Decision keeps the single visually-distinct pull-quote.**
- List primitives: `sbNumList` → `01 — item` rows (Clarify Next, Decision points, What's Missing,
  Opportunity, Services S01…, share checklist) and `.sb-dl-row` → thumbnail-size media · label ·
  one-liner · one download (deliverables D01–D06, featured media, share preview).
- Classic-only components (never in simple): the X-post card mock, the faux share card, the
  `cb-alert` risk box + tag chips, the pull-quote contact lede + signature block, big deliverable
  media cards.
- Nothing missing vs classic: What's Missing / The Opportunity / You're Onboarded copy exist as
  simple sections (default OFF — Clarify Next distills the same content until the summarizer emits
  a dedicated list); What We Offer is a section (default ON).

## 6. Post-signup flow

- When the signup chain succeeds and the terminal countdown finishes (existing
  `chainBriefRevealPendingRef` effect in `DashboardPage.jsx`), the new user lands on the
  DELIVERABLES bucket **with the Creative Brief popup already open** (named onboarding render
  preferred, main brief fallback — same preference as clicking the card). One-shot per session
  (`autoOpenedBriefRef` — note this ref pre-existed; do not redeclare it). Re-open = the Creative
  Brief card or its Details button (Details is active for non-admins on unlocked
  deliverable/brief cards).
- The brief popup renders `briefShellHtml` (CTA-stripped); Share/standalone keeps the CTA.
- The full-screen brief/asset viewer (`#brief-fullscreen-container`) uses `dvh` + `max-height` and
  goes near-full-width ≤480px (iOS `vh` counts the collapsed browser chrome — `90vh` used to clip
  the close button off-screen).

## 7. Verify checklist

Preview both layouts via `?layout=` on the sample route; confirm `fit=1` styles appear ONLY with
the param; a fresh signup should end in the brief popup; toggling any section off/on + reordering
must renumber cleanly; `npm test` covers config normalize (`creative-brief-config.test.js`).
