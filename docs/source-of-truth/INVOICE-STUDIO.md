# Invoice Studio

Public Studio tool at `/dashboard/studio?tool=invoice` (tab `INVOICE`) — a live, print-correct
invoice/quote/estimate/receipt/credit-note editor with a two-way-editable canvas, curated built-in
themes, browser-local numbering and a saved-clients/items book, and a sanitized logo upload. The
invoice never leaves the browser for a signed-out visitor: rendering, editing, numbering, saved
clients/items, and print/download all happen client-side with zero network calls. Publish to a
hosted URL, server PDF, and the saved-invoices list are admin-only.

Supersedes both prior handoffs as the as-built reference:
[`docs/plans/INVOICE-STUDIO-TOOL-HANDOFF.md`](../plans/INVOICE-STUDIO-TOOL-HANDOFF.md) (P0–P4) and
[`docs/plans/INVOICE-STUDIO-DESIGN-LAYER-HANDOFF.md`](../plans/INVOICE-STUDIO-DESIGN-LAYER-HANDOFF.md)
(Q0–Q4). Read those only for history/rationale; this doc is the current contract.

Retiring the legacy admin `components/dashboard/InvoiceBuilderCard.jsx` mount is a separate,
not-yet-made owner decision — it still exists and still works, unrelated to this tool.

---

## 1. Architecture

```
features/invoices/                          — pure, client-safe renderer + model (no framework import)
  model.js          normalizeInvoice(), computeTotals(), formatMoney(), DOC_KIND_LABELS,
                     resolveInvoiceLabels(), normalizeLocale/normalizeNumberPattern + grammar consts
  registry.js        INVOICE_SECTIONS (14 ids, order/defaultOn), section include/order helpers
  render.js          renderInvoiceDocument() — the ONE renderer; server publish and the Studio
                     canvas both call this, so preview and publish can never drift
  brief-css.js       generated ESM mirror of the shared brief-css.cjs (drift-guarded by test)
  brand-marks.js     HITLOOP logo/signature — admin-only, dynamic-import only, never statically imported
  default-from.js    owner's real identity (email/phone/address) — same admin-only dynamic-import rule
  payment-qr.js      Venmo QR resolver — same rule

app/dashboard/studio/invoice/                — the Studio tool itself (client components + client-safe state)
  InvoiceStudio.jsx   two-pane shell: board (InvoiceCanvas) + rail (InvoiceRail); owns the bridge wiring
  InvoiceCanvas.jsx   renders render.js's output into a srcDoc iframe; zoom/print/download actions
  useInvoiceDraft.js  the ONE shared draft + section-config + theme state; localStorage persistence
  useInvoiceBridge.js the canvas <-> draft live-edit bridge (contenteditable, debounced, derived patches)
  invoice-fields.js   path get/set/parse/format, structureKey() (the re-render gate), index translation
  invoice-seeds.js    publicSeed() (neutral) / adminSeed() (dynamic-imported DEFAULT_DRAFT) — THE
                      privacy boundary; see §4
  book.js             browser-local saved clients/items (localStorage, no network)
  themes/theme-schema.js   the 3 built-in theme presets + normalizeTheme/themeToCss/themeFontsHref
  identity/numbering.js    browser-local sequential invoice numbering
  identity/svg-sanitizer.js  strict allow-list SVG sanitizer for logo upload (policy + DOM driver split)
  rail/*.jsx          one RailCard per registry.js section id (14) + 2 admin-only cards below a divider
  holo/               HoloPaper presentation layer — optional, editor-only, lazy-loaded; see §12
```

Renderer, model, and Studio state are three separate layers on purpose: `render.js` is a pure
function of `(invoice, options) -> html`, called identically by the server publish path
(`app/api/dashboard/custom-briefs/route.js`) and the client canvas
(`InvoiceCanvas.jsx`) — there is exactly one implementation, so preview and publish cannot diverge.

## 2. Canonical invoice shape (as normalized by `model.js`)

`normalizeInvoice(raw, context)` fills every field with a safe default and never throws. Beyond the
original invoice/status/dates/parties/categories/items/totals/terms/payment/meta shape, it now also
carries:

```js
invoice.docKind       // 'invoice' | 'quote' | 'estimate' | 'receipt' | 'creditNote', default 'invoice'
invoice.labels        // allow-listed string map (INVOICE_LABEL_KEYS, 39 keys) — explicit overrides only
invoice.locale        // BCP-47 tag, default 'en-US' — feeds formatMoney/formatDate everywhere in render.js
invoice.numberPattern // default 'INV-{YYYY}-{seq:3}' — grammar: {YYYY} {YY} {MM} {seq:N} (N 1-6)
invoice.logoDataUrl   // validated image data: URL or null (operator-uploaded logo)
```

`DOC_KIND_LABELS` (in `model.js`) holds real terminology for all 5 kinds across 39 label keys (heading,
every fact label, table head, totals/deposit/recommendation/etc. section names). The `invoice` entry
is pinned byte-for-byte to match every string `render.js` used to hardcode, which is what keeps
`docKind` absent + `labels:{}` byte-identical to the pre-Studio golden fixture.
`resolveInvoiceLabels(invoice)` resolves the doc-kind default first, an explicit
`invoice.labels[key]` override second — this is the ONE terminology resolver, consumed by both
`render.js` (the printed document) and `SectionCard.jsx` (the rail's own card titles), so they can
never disagree about what a section is called.

## 3. Two-way canvas editing (`useInvoiceBridge.js`)

The canvas is a same-origin `srcDoc` iframe (`InvoiceCanvas.jsx`), rendered with
`renderInvoiceDocument(invoice, { editable:true, ... })` — every editable leaf carries
`data-inv-field`/`data-inv-type` (+`data-inv-raw` for money/number/date), computed values carry
`data-inv-derived`, sections carry `data-inv-section`, repeatable rows carry `data-inv-row`. No
`<script>` is ever injected; the parent drives `contentDocument` directly.

- **Structural vs. value edits**: `invoice-fields.js`'s `structureKey(invoice, sections, theme)` is
  the ONE re-render gate. A value-only edit (typing) never swaps `srcDoc` — it's patched directly
  into the live DOM by the bridge. A structural edit (section toggle/reorder, add/remove row,
  currency/status, doc-kind/labels/locale/logo presence, or theme id/paper/margins) swaps `srcDoc`
  and the bridge re-attaches.
- **Canvas → draft**: debounced (200ms) `input` → `parseValue` → `draft.applyFieldEdit(path, value,
  'canvas')`, EXCEPT `qty`/`unitPrice` on line items, which route through
  `draft.updateItem`/`updateStandaloneItem` instead (the one place `item.total` is recomputed).
  `currency`/`status` are special-cased to commit only on blur/Enter, never mid-keystroke, since both
  are structural inputs (`structureKey` reads them) and a debounced auto-apply would swap the iframe
  out from under the caret.
- **Draft → canvas**: every `draft.lastEdit` patches the matching non-focused field node; every
  `draft.invoice` change recomputes and patches every `data-inv-derived` node (item totals,
  subtotal/total/balanceDue) via the same `computeTotals()` the renderer itself uses.
  `useInvoiceDraft.js`'s `updateItem`/`updateStandaloneItem` also set `lastEdit` on any qty/unitPrice
  patch specifically so a RAIL-side qty/price edit live-patches the canvas's own "N hrs"/"$X/hr" text,
  not just the derived total.
- **Rendered index ≠ draft index**: `terms`, `recommendation.chips`, `flowSteps`, and any item's
  `subItems` are the four array kinds `normalizeInvoice()` drops blank rows from — a canvas node's
  embedded index may not match the live draft's index for these four. `resolveCanvasEditPath()`
  (`useInvoiceBridge.js`) is the one place that translation happens, via
  `invoice-fields.js`'s `renderedIndexToDraftIndex()`. `categories`/`items`/`standaloneItems` are
  id-keyed and never need translation.
- **Focus sync**: canvas focus opens the owning `RailCard` (via `InvoiceRail.jsx`'s
  `openSection(sectionId)`) and applies a transient highlight to the matching rail input — it does
  NOT call a literal DOM `.focus()` on the rail control, since that would steal focus away from the
  contenteditable node mid-typing. Rail → canvas focus sync (scrolling the canvas to a focused rail
  field) is not implemented.
- **Escape** reverts both the node's displayed text AND writes the pre-edit value back through the
  draft (not just a visual revert — a debounced auto-apply tick may have already written a partial
  edit through before Escape was pressed).
- Collapsed `RailCard` content is inert (native `inert` attribute, `SectionCard.jsx` passes
  `inertWhenClosed`) — Tab navigation skips a closed card's inputs entirely; every other Studio
  tool's `RailCard` usage is unaffected (`inertWhenClosed` is 100% opt-in).
- Eye/reorder controls grow to a true 44×44 hit box under `matchMedia('(pointer: coarse)')`
  (`SectionCard.jsx`'s `useCoarsePointer()`) without changing desktop sizing.

## 4. Privacy boundary (public vs. admin)

`invoice-seeds.js` is the boundary: `publicSeed()` (every signed-out draft) carries zero owner
trace — no name/email/phone/address, "Your name" as a neutral placeholder, no payment method/QR.
`adminSeed()` (today's admin default) is reached ONLY via a dynamic `import()`, so its bytes never
land in a bundle a public visitor downloads. `useInvoiceDraft.js`'s lazy initial state is ALWAYS
`publicSeed()`, regardless of `isAdmin` — no admin-identity frame ever renders while the admin seed's
dynamic import is in flight.

`brand-marks.js` (HITLOOP logo/signature), `default-from.js` (owner's real contact info), and
`payment-qr.js` (Venmo QR) are each reached only through an `isAdmin`-gated dynamic `import()` in
`InvoiceCanvas.jsx`. `render.js` itself never imports any of them — a caller passes the resolved
`brand`/`defaultFrom`/`paymentQr` options explicitly.

**A draft's own `logoDataUrl`** (L9): when an admin's HITLOOP `brand.logo` is present it always
wins; otherwise a non-admin operator's own uploaded `invoice.logoDataUrl` renders instead, with its
own `id="invoice-draft-logo"` (never the reserved `id="invoice-brand-logo"`) and never a
synthesized headline (only `brand.wordmark` ever produces one).

**Verified in a real production build** (`next build --webpack` + `next start`, this repo's `npm run
dev` script forces webpack too — Turbopack's `next build` default rejects a symlinked
`node_modules` outside its project root, unrelated to this tool): none of
`bryanballi@gmail.com`/the owner's phone/the Venmo handle/`HITLOOP_BRAND` appear in any of the
~19 chunks a signed-out visit to `/dashboard/studio?tool=invoice` eagerly loads, while all four
strings do exist elsewhere in the full build (proving the admin code path is real, just correctly
deferred). Loading the production build in the SAME already-signed-in browser profile (a different
port is a different origin, so no session carries over) rendered the fully neutral public seed live
— no HITLOOP mark, "Your name"/blank contact fields, no payment section, a generic "Service" line
item.

## 5. Themes (`themes/theme-schema.js`)

Built-in presets only — `THEME_SCHEMA_VERSION`, `BUILTIN_THEME_PRESETS` (exactly `ledger`,
`editorial`, `studio-dark`), `normalizeTheme(raw)` (only ever returns one of those three or `null` —
never trusts a persisted object's own color/font fields), `themeToCss(theme)`, `themeFontsHref(theme)`.
"Default" is `theme:null`, the only stored representation, byte-identical to the pre-Studio HTML.

| Theme | Paper | Margins | Look |
|---|---|---|---|
| Default (`null`) | fluid | — | today's white/black look, unchanged |
| Ledger | letter | normal | green-accent accounting look, IBM Plex Mono |
| Editorial | letter | wide | serif (Playfair Display), generous margins |
| Studio Dark | fluid | normal | dark ground, on-screen-first |

`render.js`'s `renderInvoiceDocument()` resolves `normalizeTheme(options.theme)` once; a non-null
theme puts `data-invoice-theme="<id>"` on `<html>`, appends `themeToCss(theme)` (colors/fonts +
`@page` geometry) after the static `INVOICE_CSS`, and adds `themeFontsHref(theme)`'s font `<link>`
IN ADDITION TO (never replacing) the default Doto/Space Grotesk/Space Mono link. An independent
`options.paper` (`'letter'|'a4'|'fluid'`) override is honored even with `theme:null` (Letter/A4
geometry on the plain default look) per the renderer contract, though the Cover-card UI only exposes
the 4 named theme choices — no separate paper-size control this round.

**Print pagination**: `.invoice-item-row`/`.invoice-balance` get `break-inside:avoid` (no row or the
totals figure splits across a page); `#invoice-line-items-section` overrides the static
`.invoice-block` no-split rule so a long item list can flow across multiple pages instead of being
forced onto one. All pagination CSS is conditioned on `theme || explicitPaper` so the untouched
Default never gains it (byte-identity). `InvoiceCanvas.jsx`'s `handlePrint` awaits the iframe's own
`document.fonts.ready` (bounded to 1.5s) before calling `print()`, so a themed font has a real chance
to load first. Verified via a real Chromium print-PDF render (not just CSS assertions): a 25-item
Letter invoice under Ledger/Editorial paginates across 3 pages with no split row and an intact
totals block.

## 6. Numbering (`identity/numbering.js`)

Browser-local (`invoice-studio-numbering-v1`), best-effort across tabs (no cross-tab `storage`
listener — optional per the design plan, not built). `reserveNextNumber(docKind, pattern)` is the
one function that mutates state — synchronous, idempotent-safe (two calls always mint two different
numbers). **Reserved only when a New Document is created** (`useInvoiceDraft.js`'s
`startNewInvoice()` calls it exactly once, right after resolving the fresh seed) — never as a side
effect of rendering; a page reload does not increment the counter. Counter buckets are keyed
`docKind:normalizedPattern`. `isDuplicateNumber()` flags a number that collides with an OLDER
`recent` entry (the just-reserved number itself never self-flags).

## 7. Saved clients/items (`book.js`)

Browser-local (`invoice-studio-book-v1`), no network calls of any kind. `saveClient`/`saveItem`
upsert by a case-insensitive-trimmed-name dedupe key (items deliberately exclude price from the key,
so re-saving after a rate change updates in place rather than forking a duplicate). Every write fires
`BOOK_CHANGE_EVENT` on `window`, which `BillToCard`/`LineItemsCard`/`StandaloneItemsCard` each
subscribe to — a client or item saved from any one card shows up in every card's picker without a
page reload. A saved item is inserted into the draft via ONE atomic `draft.updateCategory(...)` /
`draft.updateInvoiceField(...)` patch (`book.js`'s `toDraftItem()` builds the fully-formed row) —
deliberately not `draft.addItem()` followed by a separate `draft.updateItem()`, which would race two
`setState` calls with no safe way to target the just-added row.

## 8. Logo upload + SVG sanitizer (`identity/svg-sanitizer.js`, `rail/LogoControl.jsx`)

PNG/JPEG/WebP pass through as a data URL unmodified (not markup, nothing to sanitize); SVG goes
through a strict ALLOW-LIST sanitizer first. 300 KB cap, rejected (not silently truncated) over size.
Reject-outright (never strip-and-keep-the-rest) on: any element tag not on the allow-list (blocks
`<script>`, `<foreignObject>`, embedded HTML/MathML by construction), any `on*` event-handler
attribute, any `href`/`xlink:href`/`src` that isn't a `#fragment` or an already-inline `data:` URI,
any external `url(...)` in a `style` attribute or `<style>` element, and any `@import`. On success the
ORIGINAL accepted bytes are returned unchanged (no re-serialized "cleaned" copy that could look safe
while still carrying something unexpected). Split into a pure, directly-unit-tested POLICY layer
(allow-lists, URL classification) and a `DOMParser`/`XMLSerializer` DOM-walking driver (browser-only,
verified by hand — this repo's `node --test` has no DOM). Verified live: a `<script>`-tag SVG and an
`onload`-attribute SVG both rejected with a clear inline reason; a clean SVG accepted with
byte-identical decoded content.

## 9. Rail structure

Exactly 14 section `RailCard`s, one per `features/invoices/registry.js` id, rendered in
`draft.sections.order` (not a hardcoded list — the rail re-orders itself live), plus 2 admin-only
cards (`PublishCard`, `SavedInvoicesCard`) below a visual divider. `SectionCard.jsx` owns the eye
toggle, ↑/↓ reorder, the "off" dim, touch-target sizing, and default-title resolution
(`resolveInvoiceLabels`) shared by every card. New controls this round were folded CONTEXTUALLY into
existing cards, never as new top-level cards: Cover owns doc-kind + logo + theme; Invoice details
owns locale + numbering + editable-label overrides; Bill to owns saved clients; Line items/Additional
items own saved-item reuse. Deposit's own dynamic per-invoice heading (`totals.depositLabel`, a
pre-existing override mechanism) is deliberately NOT unified with the new doc-kind label system on
the RAIL side (the rail card still shows "Payment due" regardless of doc kind) — the PRINTED
document's own deposit heading DOES resolve correctly per doc kind
(`render.js`'s `buildDeposit()` treats a `depositLabel` that still equals the literal model-layer
default `'Payment due'` as "unset" and substitutes the resolved doc-kind label). This is a known,
narrow, deliberate rail/canvas terminology mismatch for this one section — fixing it would mean
touching `DepositCard.jsx`, which no lane owned this round.

## 10. Known limitations / deliberately deferred

- A rail-side qty edit patches the canvas's own qty display text as a bare number (e.g. `8`), not
  the renderer's "N hrs" suffix formatting — a cosmetic gap in the generic value-patch path (it
  doesn't know about `renderItemRow()`'s hours-specific suffix convention); self-heals on the next
  structural re-render. The underlying VALUE and the derived total are always correct.
- Rail → canvas focus sync (scrolling/highlighting the canvas node when a rail input gains focus) is
  not implemented — only canvas → rail.
- Cross-tab `storage` event listener for numbering, mobile-keyboard pixel-exact positioning through
  the scaled iframe transform (best-effort `scrollIntoView` instead), a standalone paper-size
  selector independent of theme, and the tool handoff's "first-run click-to-edit hint" were all
  explicitly out of scope or optional this round.
- Paint textures, PNG export, theme JSON import/export, custom theme creation, undo/redo, and hosted
  links/email/recurring invoices remain explicitly out of scope (see the design-layer plan's
  "Explicitly deferred" list). HOLO PAPER is now built — see §12.
- Legacy `InvoiceBuilderCard.jsx` retirement is untouched, pending a separate owner decision.

## 12. HoloPaper presentation layer

Optional presentation mode (docs/plans/INVOICE-STUDIO-HOLOPAPER-HANDOFF.md, the controlling plan —
superseded by this section as the as-built reference now that verification has passed). Renders the
SAME authoritative document — `renderInvoiceDocument()`'s live iframe remains the only invoice
renderer and source of visual truth — with the physical/holographic look and feel of the standalone
Holo Paper tool (`ClothStudio.jsx`), adapted as a bounded, invoice-only Three.js scene. Holo state is
editor-only: it is never read by `renderInvoiceDocument()`, never reaches Print/Download
.html/Publish/saved-invoice payloads, and switching modes never changes invoice data, section order,
theme, numbering, or publish identity.

**Three modes**, all in the existing Cover card (no new top-level rail card):

| Mode | Visible surface | Pointer owner | Editing |
|---|---|---|---|
| Standard (Holo Off, default) | The plain invoice iframe, byte/behavior-identical to before this layer | Invoice DOM | Existing two-way canvas/rail editing |
| Holo On + Interact Off | Live iframe plus a `pointer-events:none` holographic overlay | Invoice DOM | Iframe stays directly editable underneath the overlay |
| Holo On + Interact On | Textured, deformable WebGL cloth | Holo scene | Grab/orbit/fling; rail edits keep refreshing the texture; the iframe is marked `inert`+`aria-hidden` (never remounted — its live DOM and every edit survive the round trip) until interaction is turned back off |

**Architecture** — `app/dashboard/studio/invoice/holo/`:
- `useInvoicePresentation.js` — `{ holoEnabled (persisted, its own `invoice-studio-presentation-v1`
  key, never the draft's), sceneInteractive (ephemeral, always Off on mount), sceneStatus
  ('idle'|'loading'|'ready'|'fallback'), resetViewToken }` + setters. Turning Holo off synchronously
  drops interaction too. `resetViewToken`/`bumpResetView()` exist because CoverCard's Reset View
  button and the scene mounted inside `InvoiceCanvas.jsx` are siblings, not parent/child — both read
  the one hook instance `InvoiceStudio.jsx` owns.
- `invoice-dom-snapshot.js` / `useInvoiceTexture.js` — clones the live, already-rendered iframe
  `contentDocument` (never mutates it, never calls `renderInvoiceDocument()` a second time), strips
  editor-only scaffolding (`contenteditable`, the bridge highlight `<style>`, `<script>`, the PDF
  download link), rasterizes via SVG `<foreignObject>` → base64 `data:` URI `<img>` → `<canvas>`
  (proven live-browser-safe; a `blob:` URI taints the canvas, `data:` does not), downsamples
  aspect-preserving to a 2048px long-axis budget, and hands back `{source: HTMLCanvasElement, width,
  height, revision}`. Generation-tokened + debounced (≤1 capture/250ms) — a stale/slow capture can
  never clobber a newer one, and the last good texture stays visible through any failed/in-flight
  refresh.
- `invoice-holo-scene.js` / `cloth-sim.js` / `holo-material.js` — a frozen, invoice-only scene (NOT
  `ClothStudio.jsx`, never mounted/imported): a top-edge-pinned "hanging sheet" with fixed-step verlet
  cloth motion, tweezer-pinch grab/fling, bounded damped orbit, and a legibility-tuned
  `MeshPhysicalMaterial` holo shader (pearl/white base, restrained intensity/saturation/sparkle, plus
  a luminance-based mask that further dampens the holographic sheen specifically over dark ink/logo
  pixels so printed text stays flatter/readable than the surrounding paper). Public API:
  `createInvoiceHoloScene(container, {onReady, onContextLost}) => {setTexture, setInteractive,
  setReducedMotion, resize, resetView, pause, resume, dispose}`.
- `InvoiceHoloSurface.jsx` — the React lifecycle shell; feature-detects WebGL before ever creating a
  scene and renders an honest inline fallback notice (never a blank canvas) on unsupported WebGL or a
  reported context loss.
- `InvoiceHoloOverlay.jsx` — the H8 code-splitting boundary for BOTH halves at once. A plain hook call
  (`useInvoiceTexture`) can't itself be deferred without breaking the Rules of Hooks, so this thin
  wrapper owns that call and `InvoiceCanvas.jsx` reaches it ONLY via
  `lazy(() => import('./holo/InvoiceHoloOverlay'))`, gated on `holoEnabled && hasLoadedOnce`.
  Verified live (Playwright against the dev server): Standard mode fetches zero
  `three`/`three-stdlib`/holo-named chunks; turning Holo on fetches exactly four new ones
  (`InvoiceHoloOverlay`, `invoice-holo-scene`, `three`, `three-stdlib`).
- `InvoiceCanvas.jsx` — mounts the overlay absolutely-positioned inside `#invoice-studio-paper-shell`;
  builds `refreshKey` from `structureKey` (covers theme/locale/label/logo/section/doc-kind — all
  structural) plus a locally-debounced `bridgeEditTick` fed by a `MutationObserver` on the iframe's own
  `contentDocument.body` (catches value-only bridge edits without a new `draft` prop — P3's contract
  still takes none); `loadTick` bumps independently in `handleFrameLoad` for the "iframe reloaded"
  trigger. `hasLoadedOnce` gates the overlay so a page load with Holo already On (persisted) never
  races the scene against the iframe's own first paint. `prefers-reduced-motion` and Page
  Visibility + an `IntersectionObserver` on the paper shell (tab-hidden or scrolled offscreen) both
  pause the scene's own render loop. `CoverCard.jsx` owns the three visible controls: Holo Paper
  On/Off, Interact with Paper On/Off (dimmed + functionally disabled while Holo is off), and a Reset
  View button visible only while interactive.

**Known, deliberate limitation**: brand webfonts (Doto/Space Grotesk/Space Mono, and
Ledger/Editorial's IBM Plex Mono/Playfair Display) do not apply inside the rasterized Holo texture —
confirmed in a real browser three independent ways (external `<link>`, inline base64 `@font-face`, and
a delayed redraw to rule out a decode race) — and fall back to the CSS's own generic
monospace/sans-serif/serif fallback. Structurally correct and legible, just not brand-accurate. The
plan's pre-authorized escape-hatch dependency (`html-to-image@1.11.13`) was installed and tried
against the same live content and reliably hung (4/4 attempts, 8–58+s with no result) — a rasterizer
that cannot reliably complete violates the pipeline's harder "never block" constraint more severely
than losing font fidelity does, so no dependency was added; the native path ships as-is. See
`invoice-dom-snapshot.js`'s own header for the full documented proof.

**Verified** (real browser, Chromium via Playwright against the dev server + this repo's own
`node --test`, 2026-09-04): all three modes render correctly; a 21-item long invoice renders uncropped
and legible on the Holo surface; Default/Studio Dark themes confirmed rendering correctly on the
surface (Ledger/Editorial share the identical rasterization path); dragging the interactive sheet
visibly deforms the cloth with the invoice texture staying correctly mapped; Reset View appears only
while interactive; turning interaction off restores the iframe (`inert`/`aria-hidden` both cleared,
`srcdoc` untouched, no remount); turning Holo off removes the overlay DOM entirely and restores
Standard's exact appearance; ten rapid On/Off cycles leave zero stray canvases; zero console errors
across the entire run. A production `next build --webpack` from an isolated snapshot of this exact
working tree (tracked + untracked) completes cleanly (134/134 pages, all routes, zero errors). Not
independently re-verified in this pass (unchanged from H1/H2's own review): the exact pixel-level
legibility of the WCAG-contrast requirement on the non-interactive overlay, and mobile/coarse-pointer
44px hit-target sizing for the scene's own touch interaction.

## 13. Verification (as of this doc)

```
node --test app/dashboard/studio/invoice/__tests__/*.test.js app/dashboard/studio/invoice/themes/__tests__/*.test.js app/dashboard/studio/invoice/identity/__tests__/*.test.js features/invoices/__tests__/*.test.js
# 188 pass, 0 fail (181 + 7 new — the H0 numbering/Deposit contract-repair regression tests)
node --test 'app/dashboard/studio/invoice/**/__tests__/**/*.test.js'
# 309 pass, 0 fail (188 above + 121 in holo/__tests__/, the HoloPaper presentation layer's own suite)
npm test
# 3455 pass, 1 fail, 0 regressions — the one failure (services/studio-render/__tests__/
# proof-render-worker.test.mjs, an unrelated pre-existing Studio Final Render test with an async
# temp-file-cleanup race under full-suite parallel load) reproduces 0/29 in isolation; confirmed
# environmental/flaky, not caused by this work.
```

`npm run build` (webpack; Turbopack's default `next build` panics on a symlinked `node_modules`
outside the project root, which only matters for an isolated-snapshot build like this verification
pass, not normal local development) succeeds cleanly from an isolated snapshot of this exact working
tree. The pinned byte-identity test
(`"renderInvoiceHtml is byte-identical with the HITLOOP brand and editable off"` in
`features/invoices/__tests__/invoices.test.js`) passes unmodified — every new option
(`docKind`/`labels`/`locale`/`numberPattern`/`logoDataUrl`/`theme`) defaults to producing the exact
pre-Studio HTML bytes.
