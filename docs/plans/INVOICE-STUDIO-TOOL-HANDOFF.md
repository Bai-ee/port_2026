# Invoice Studio — public Studio tool with a live-editable invoice canvas

> **⚠️ SUPERSEDED.** All phases below (through P6) are now as-built and verified — see
> [`docs/source-of-truth/INVOICE-STUDIO.md`](../source-of-truth/INVOICE-STUDIO.md) for the current
> contract. Kept here for the P0–P4 design rationale only; do not treat anything below as
> outstanding work.

Status (2026-09-03, historical): **P0–P4 are AS-BUILT and in the working tree (uncommitted). P5 and P6 are NOT
built.** The tool mounts at `/dashboard/studio?tool=invoice`, renders client-side, and the rail
edits the draft — but canvas text is not yet editable and nothing syncs canvas→rail. Owner approval
required before each remaining phase.

Verified as-built: renderer client-safe via `features/invoices/brief-css.js` (ESM mirror; the
`features/scout-intake/` copy is deleted — that directory's `"type":"commonjs"` pin broke the
webpack client build); `brand`/`defaultFrom`/`paymentQr` all caller-supplied and absent by default;
the public client chunk contains **zero** owner identity, brand marks, or payment QR (checked in the
built chunk, not just at runtime); publish output byte-identical to pre-Studio via a golden fixture;
`npm test` 3209/3209.

Audience: multiple Sonnet implementer agents working in parallel lanes.

---

## 1. Objective

Rebuild the admin **Invoice Builder** card as a **public Studio tool**
(`/dashboard/studio?tool=invoice`, tab `INVOICE`), alongside HOLO PAPER / Paint / Loops:

- **Canvas (left/center)** = the live invoice, presented as a document on the Studio board.
- **Right rail (collapsible)** = every option, as `RailCard`s.
- **Direct editing in the canvas** — click text in the preview, type, it updates. Rail and canvas
  are two views of one draft: editing either updates the other, both directions, no caret loss.

**Public, like Loop Studio: the invoice never leaves the browser.** Rendering happens client-side,
so anyone can build, edit, print and download an invoice with no account and no server call.
Publishing to a hosted URL + server PDF + the saved-invoice list stay admin-only (they write
Firestore/Vercel and spend Browserless).

### Non-goals (v1)
- No new API route, no new collection, no change to published-invoice HTML/PDF bytes.
- No canvas drag-reorder (rail ↑/↓ is the reorder control).
- No accounts, no server-side storage for public users.
- Retiring `components/dashboard/InvoiceBuilderCard.jsx` is a **separate owner decision** (P7).

---

## 2. Current architecture (verified)

| Piece | Location | Notes |
|---|---|---|
| Card (to be ported) | `components/dashboard/InvoiceBuilderCard.jsx` (961L) | Sections 01–10, `.vrk-scope` |
| Draft seed | `features/invoices/default-draft.js` | ⚠️ seeds owner identity — see §3 P0 |
| Pure model | `features/invoices/model.js` | Client-safe. `normalizeInvoice`, `computeTotals`, `formatMoney`, `DEFAULT_FROM` |
| Registry | `features/invoices/registry.js` | Client-safe. Section include/order |
| Renderer | `features/invoices/render.js` (587L) | ⚠️ **Only** server-ism is `createRequire` → `brief-css.cjs` (11.7KB). Entry `renderInvoiceDocument(invoice, options) → { html, renderedSections, skippedSections, estimatedHeightPx }` |
| Brand marks | `features/invoices/brand-marks.js` (57KB) | HITLOOP logo + owner signature, baked into `hero()` unconditionally |
| Payment QR | `features/invoices/payment-qr.js` (16KB) | Owner's Venmo handle + QR |
| Route | `app/api/dashboard/custom-briefs/route.js` | `verifyAdminRequest`. Publish + Browserless PDF + `GET ?kind=invoice` list. Its `preview:true` branch (route.js:538) becomes redundant for the Studio |
| Renderer consumers | route.js:517, `features/invoices/__tests__/`, (harness `app/preview/invoice/page.jsx` goes through the route) | Small blast radius |
| Studio shell | `app/dashboard/studio/StudioPage.jsx` (3210L) | Tabs :2325, tool branch :2343, `authedFetch` :686, `isAdmin` :478 |
| Tool metadata | `app/dashboard/studio/studio-tools-meta.js` | Keep in sync with the tool switch |
| Layout model | `app/dashboard/studio/paint/PaintStudio.jsx` (821L) | Copy this shape: board absolute `right: railW`, rail absolute right, stacked when narrow |
| Shared rail kit | `app/dashboard/studio/components/rail-ui.jsx` | `GLASS`, `ui`, `RailCard`, `Slider` — do not redefine |
| Rail entrance | `app/dashboard/studio/components/useRailReveal.js` | `useRailReveal()` on the rail inner column |

### Facts that constrain the design
1. `render.js` is **one `createRequire` away from being client-safe** — every other import
   (`model`, `registry`, `payment-qr`, `brand-marks`) is already ESM and import-free.
2. `normalizeInvoice` **preserves `id`** on categories and items (`model.js:60,72`) — stable paths.
3. It **drops rows** in `flowSteps` (`platform || label`), `subItems` (`name`), and `normalizeList`
   (terms, chips) → rendered index ≠ draft index for those four arrays.
4. `normalizeItem` **substitutes fallbacks** — blank name renders `Item N`, `qty` defaults 1.
5. A `srcdoc` iframe is **same-origin**, so the parent can drive its DOM directly — no injected
   script, no `postMessage` layer.

---

## 3. Locked decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Preview renders client-side**, in-browser, from the same `render.js` the server publishes with | Public = no auth, no server cost, no abuse surface; and one implementation means preview/PDF can't drift |
| D2 | Make `render.js` client-safe: replace the `createRequire` with an ESM import of a **generated `features/scout-intake/brief-css.js` mirror** + drift-guard test (the `lib/gbpReputationReport.js` idiom). `.cjs` stays the source for its 4 server consumers | Zero server behavior change; unlocks the client |
| D3 | Canvas = `srcdoc` iframe (style isolation from BRIEF_CSS), driven by **direct `contentDocument` access**. No injected script, no `postMessage` | Same-origin by spec; deletes a whole message layer |
| D4 | **Text edits never re-render the iframe.** Only *structural* changes do (section toggle/reorder, add/remove row, currency, status), gated by a `structureKey` | Re-render destroys the caret. Cheap now, but still wrong |
| D5 | One shared `invoice-fields.js` owns path get/set, type, parse, format, and rendered↔draft index mapping. Rail inputs AND canvas edits both go through it | Single definition of "consistent" |
| D6 | Derived values (`totals.*`, item `total`) recompute via `computeTotals` and patch into their canvas nodes | Instant feedback |
| D7 | **Tool is public.** Publish / server PDF / saved-invoice list are the only admin-gated affordances | The ask |
| D8 | Renderer gains a **`brand` option** (`{ logo, signature }`, default `null`) and identity/QR defaults are **admin-only seeds**. Public seed is neutral placeholder text | A stranger's invoice must never carry the owner's logo, signature, phone, email, or Venmo QR |
| D9 | Public output = **browser print** (`frame.contentWindow.print()`) + **Download .html**. Public drafts persist in `localStorage` only | No server writes for anonymous users |
| D10 | `brand-marks.js` (57KB) and `payment-qr.js` (16KB) are **dynamically imported, admin path only** | Keeps the public bundle small and the owner's marks off strangers' machines |
| D11 | Existing dashboard card stays live through P6 | No regression while the new surface is unproven |
| D12 | Rail card set mirrors the card's 01–10 sections, one `RailCard` each | Muscle memory, smaller review diff |
| D13 | `normalizeInvoice(raw, { defaultFrom })` — defaults to `DEFAULT_FROM` (server publish unchanged); the public client passes `null` so blank `from.*` stays blank | **Found in P0:** `model.js:113` `normalizeFromParty` backfills every blank `from` field with the owner's real email/phone/address, and `renderInvoiceDocument` calls it on every render. `brand:null` does not cover this — a public visitor renders the owner's contact info until they fill in their own |

---

## 4. Contracts (write these FIRST — every lane codes against them)

### 4.1 `app/dashboard/studio/invoice/invoice-fields.js` (client-safe)

```
FIELD_PATHS — addressable set; each { path, type, label, section, editable }
  type ∈ 'text' | 'multiline' | 'money' | 'number' | 'date' | 'enum' | 'derived'

Path grammar (dot + bracket; ids for keyed rows, indices for string rows):
  invoiceNumber | currency | status | issueDate | dueDate | paymentTerms | poNumber
  servicePeriod.start | servicePeriod.end
  projectTitle | projectSubtitle | notes
  from.{name,legalName,taxId,email,phone,site,address}
  billTo.{name,contact,email,address}
  categories[<catId>].name
  categories[<catId>].items[<itemId>].{name,note,qty,unitPrice,costLabel}
  categories[<catId>].items[<itemId>].subItems[<i>].{name,cost}
  standaloneItems[<itemId>].{…same as items}
  totals.{subtotal,discount,discountLabel,tax,taxLabel,total,deposit,depositLabel,
          amountPaid,monthlyLabel,monthlyValue,oneTimeLabel,oneTimeValue}
  recommendation.{name,body} | recommendation.chips[<i>]
  flowSteps[<i>].{platform,color,label,tech}
  terms[<i>] | payment.{method,instructions,link}

API:
  getAtPath(draft, path) / setAtPath(draft, path, value) -> NEW draft (immutable)
  parseValue(type, rawText)            // money: strip $ , spaces
  formatValue(type, value, currency)   // money via model.formatMoney
  fieldMeta(path) -> { type, section, editable }
  structureKey(draft, sections) -> string    // §4.3
  renderedIndexToDraftIndex(kind, list, renderedIndex)
    // kind ∈ 'terms' | 'chips' | 'flowSteps' | 'subItems'; mirrors model.js's filters
```

**As-built notes (P0, deviations from the draft contract above — later lanes code against THESE):**
- `renderedIndexToDraftIndex` takes the **raw array**, not the draft: `subItems` has no single
  owner array addressable from the draft root. Callers already hold `draft.terms`,
  `draft.recommendation.chips`, `draft.flowSteps`, or one item's `.subItems`.
- `totals.monthlyValue` / `totals.oneTimeValue` are typed `'text'`, not `'money'` — `computeTotals`
  passes them through `cleanString` as free text, so a `normalizeInvoice()` round trip stays lossless.
- `useInvoiceDraft`'s `normalizeInvoiceShape(raw, base)` takes the base seed (two seeds now exist),
  and `updateItem`/`updateStandaloneItem` recompute `total` centrally on any qty/unitPrice patch —
  canvas edits must NOT duplicate that math.
- Section ids come live from `features/invoices/registry.js` (client-safe, pure ESM) instead of the
  hand-duplicated list the admin card had to carry. Do not reintroduce a local copy.
- No `FIELD_PATHS` entries for derived-only values (`item.total`, balance) — `type:'derived'` is
  supported by `parseValue`/`formatValue` if a later lane needs to register them.

**Tests** (`app/dashboard/studio/invoice/__tests__/invoice-fields.test.js`): get/set round-trip per
path family; money round-trip (`"$1,234.50"` → `1234.5` → `"$1,234.50"`); index mapping with holes
in all four filtered arrays.

### 4.2 Canvas ⇄ draft binding (`useInvoiceBridge.js`)

Parent-side only — the iframe stays a dumb document.

| Direction | Mechanism |
|---|---|
| attach | after each render, `frame.contentDocument.querySelectorAll('[data-inv-field]')` → set `contenteditable="plaintext-only"`, attach `input`/`blur`/`keydown`/`focus` listeners |
| canvas → draft | `input` (debounced 200ms) → `parseValue` → `applyFieldEdit(path, value, 'canvas')` |
| draft → canvas | `patchNodes([{path, display}])` → set `textContent`, **skipping the focused node** |
| commit | `blur`/Enter → reformat the node from state (money/date normalize on exit) |
| focus sync | canvas `focus` → open the owning `RailCard` + highlight; rail focus → scroll/focus the canvas node |
| Esc | revert node to last committed value |
| height | `ResizeObserver` on `contentDocument.documentElement` → size the iframe |

Rules: re-attach after every `srcdoc` swap; never write back on focus/blur alone (fact §2.4 —
renderer fallbacks would become real content); every edit carries an origin so it is never echoed
back into the surface it came from.

### 4.3 Re-render policy

`structureKey = hash(sections.include + sections.order + currency + status + ordered row ids +
row counts of terms/chips/flowSteps/subItems)`.

- Changed → re-render the document (client-side, ~instant) and swap `srcdoc`, then re-attach.
- Unchanged → **no re-render**; values propagate as node patches / rail patches per §4.2.
- A structural edit while a text node is focused: blur first, then re-render.

### 4.4 Renderer changes (`features/invoices/render.js`)

1. **Client-safe** (D2): `import { BRIEF_CSS } from '../scout-intake/brief-css.js'`.
2. **`brand` option**: `{ logo, signature }`, default `null` → `hero()` and the footer omit the
   marks entirely when absent. Server publish passes the HITLOOP marks explicitly.
3. **`editable` option**, default off — adds only attributes, no script:
   - `data-inv-field="<path>"` + `data-inv-type` on each text-bearing leaf;
     `data-inv-raw="<unformatted>"` for money/number/date.
   - `data-inv-derived="<path>"` for computed values (patch-in only, not editable).
   - `data-inv-section="<sectionId>"` on section wrappers; `data-inv-row="<kind>:<idOrIndex>"` on
     repeatable rows.
4. With `editable` off **and** the HITLOOP `brand` passed, output must be **byte-identical to today**.

**As-built notes (P1 — later lanes code against THESE):**
- `features/scout-intake/package.json` pins `"type": "commonjs"`, so the generated mirror uses
  `exports.BRIEF_CSS = "..."` (a property assignment `cjs-module-lexer` detects for named-export
  interop), NOT `export const`. `render.js`'s static `import { BRIEF_CSS }` works unchanged.
  Regenerate with `node scripts/sync-brief-css.mjs`; the drift test guards it.
- Byte-identity is pinned to a frozen golden fixture
  `features/invoices/__tests__/fixtures/invoice-baseline-pre-studio.html` (the directory was
  untracked, so there was no commit to diff against). Do not regenerate that fixture to make a
  failing test pass — a diff against it means published invoices changed.
- `brand-marks.js` now exports `HITLOOP_BRAND`; `custom-briefs/route.js` passes it so publish is
  unchanged. Nothing else may import it on a public path.
- **Not annotated, because the renderer never emits them as visible body text:**
  `projectTitle` / `projectSubtitle` (only feed `<head><title>`) and
  `totals.monthlyLabel|monthlyValue|oneTimeLabel|oneTimeValue`. The rail can still edit them; they
  are simply not click-to-edit on the canvas until a section builder renders them. **Verify against
  `buildProjectSummary` (defaultOn:false) before treating this as final.**
- `payment.handle` IS rendered (`stat('Send to', …)`) but is missing from the §4.1 grammar — add it.
- `totals.balanceDue` is annotated `data-inv-derived`.
- Row `kind` vocabulary: `category` / `item` / `standaloneItem` are id-keyed; `subItems` / `chips` /
  `flowSteps` / `terms` are index-keyed, matching `renderedIndexToDraftIndex`.
- ⚠️ **Empty optional fields emit no `data-inv-field`** (the renderer's honest-empty skip). So a
  blank field cannot be clicked into on the canvas — it must be filled from the rail first. For a
  canvas-first tool that is a hole: P5 should emit click-to-fill placeholder nodes **in editable
  mode only**, which never reach publish because publish renders with `editable:false`.
- ⚠️ **Client-bundle import is NOT yet proven.** Node ESM import is verified; the webpack/Next
  client path needs `npm run build` (blocked while a dev server is live — use a worktree). Lane C
  hits this first: if it fails, that is the fallback point, not a surprise.

---

## 5. File ownership (prevents collisions)

| Lane | Owns (exclusive write) | 
|---|---|
| **A — renderer** | `features/invoices/render.js`, `features/scout-intake/brief-css.js` (new, generated), its drift test, `features/invoices/__tests__/*`, the `brand` argument at `custom-briefs/route.js:517` |
| **B — shell** | `app/dashboard/studio/studio-tools-meta.js`, the 3 hunks in `StudioPage.jsx` (import, tab array, tool branch), `public/img/og/studio-invoice.jpg` |
| **C — canvas** | `app/dashboard/studio/invoice/InvoiceStudio.jsx`, `invoice/InvoiceCanvas.jsx` |
| **D — rail** | `app/dashboard/studio/invoice/rail/*.jsx` |
| **E — bridge** | `app/dashboard/studio/invoice/useInvoiceBridge.js` |
| **P0 — shared** | `invoice-fields.js`, `useInvoiceDraft.js`, `invoice-seeds.js`, their tests |

⚠️ `StudioPage.jsx` (3210L) and `render.js` are each edited by **exactly one lane**.

---

## 6. Phases

Each phase ends with a **stop for owner approval**. No deploy, no cron, no paid API call.

### P0 — Shared seam + public seed (1 agent, blocking)
Create `app/dashboard/studio/invoice/`:
- `invoice-fields.js` (§4.1) + tests.
- `useInvoiceDraft.js` — draft + section config + every mutator ported from the card
  (`defaultInvoice`, `normalizeInvoiceShape`, `normalizeSectionsShape`, add/remove/update for
  categories, items, sub-items, standalone, terms, chips, flow steps), plus `structureKey`,
  `dirty`, and origin-tagged `applyFieldEdit(path, value, origin)`.
- **`invoice-seeds.js`** — `publicSeed()` (neutral placeholders: `from` = empty/"Your name",
  no `payment.qr`, no brand marks, generic project text) and `adminSeed()` (today's
  `DEFAULT_DRAFT`). ⚠️ `DEFAULT_DRAFT`, `DEFAULT_FROM`, `PAYMENT_QR_CODES` and `brand-marks` must be
  unreachable from the public path — test it.
- `localStorage` draft persistence (versioned key `invoice-studio-draft-v1`, quota-safe try/catch).

**Accept:** `npm test` green; a grep proves the public path imports neither `brand-marks` nor
`payment-qr` nor `DEFAULT_DRAFT`.

### P1 — Renderer: client-safe + brand + annotations (lane A, parallel with P2)
Implement §4.4.
**Accept:**
- Drift test: ESM `brief-css.js` === `require('brief-css.cjs').BRIEF_CSS`.
- Byte-identity test: today's output vs `{ brand: HITLOOP_MARKS }` with `editable` off.
- `brand: null` emits no logo/signature and no data URI at all.
- `editable:true` emits `data-inv-field` for a known path set; nothing when off.
- Existing invoice tests unchanged and green.

### P2 — Studio shell (lane B, parallel with P1)
- `studio-tools-meta.js`: `invoice` entry (title `Invoice Studio`, public-facing description,
  image `/img/og/studio-invoice.jpg`).
- `StudioPage.jsx`: `dynamic(() => import('./invoice/InvoiceStudio'), { ssr:false })`;
  `['invoice','INVOICE']` in the tab array (**public — no `isAdmin` guard**); tool branch passing
  `isNarrow`, `railW={RAIL_W}`, `isAdmin`, `authedFetch`, `user`.

**Accept:** `npm run build` clean; tab visible signed-out; stub tool mounts board + rail.

### P3 — Canvas (lane C, after P0)
`InvoiceStudio.jsx` + `InvoiceCanvas.jsx`, layout copied from `PaintStudio.jsx`.
- Render locally: `renderInvoiceDocument(draft, { sections, editable:true, brand })` → `srcdoc`.
- `structureKey`-gated re-render (§4.3); sheet as paper (white page, shadow, fit-to-width, zoom
  50/75/100/fit); iframe auto-height; skipped-section hint; render-error boundary.
- Public actions row: **Print / Save PDF** (`contentWindow.print()`), **Download .html**,
  **New invoice**, autosave indicator.

**DOM ids:** `invoice-studio-board`, `invoice-studio-artboard-area`, `invoice-studio-paper-shell`,
`invoice-studio-preview-frame`, `invoice-studio-zoom-row`, `invoice-studio-actions-row`,
`invoice-studio-skipped-hint`.

**Accept:** signed-out user can build and print an invoice; zero network requests in the tab.

### P4 — Rail (lane D, after P0; parallel with P3)
`invoice/rail/` — one file per card on `RailCard` + `rail-ui` tokens, bound through
`invoice-fields`: `DetailsCard`, `PartiesCard`, `LineItemsCard`, `StandaloneItemsCard`,
`TotalsCard`, `RecommendationFlowCard`, `TermsPaymentNotesCard`, `SectionsCard` (toggles + ↑/↓),
plus **admin-only** `PublishCard` + `SavedInvoicesCard` (rendered only when `isAdmin`, logic ported
verbatim from the card, same endpoints/payload).
- Rail shell `position:absolute; right:0; width:railW; overflowY:auto`, inner column with
  `useRailReveal()`; ids `invoice-studio-rail`, `invoice-studio-rail-inner`,
  `invoice-rail-<name>-card`.

**Accept:** every card field is reachable; a signed-out user sees no publish affordance; an admin
publishes a document identical to the card's.

### P5 — Two-way live edit (lane E, after P1 + P3 + P4)
`useInvoiceBridge.js` per §4.2, plus canvas affordances: hover outline on editable nodes, a
first-run "click any text to edit" hint, Esc to revert.

**Accept (manual, `npm run dev`):**
1. Type in canvas → rail updates, caret never jumps.
2. Type in rail → canvas updates live.
3. Edit a qty in canvas → item total, subtotal, total update instantly.
4. Toggle a section → exactly one re-render; caret-safe.
5. Admin publish after canvas-only edits → published HTML has the typed values, **no** `data-inv-*`,
   and the HITLOOP marks present.
6. Signed-out print output carries **no** owner identity, signature, or Venmo QR.

### P6 — Hardening + docs
- Byte-compare publish: card vs Studio, same draft → identical HTML.
- Bundle check: public tool must not pull `brand-marks`/`payment-qr` (inspect the chunk).
- Dirty-guard on tool switch/tab close; narrow-screen pass; `prefers-reduced-motion`.
- Update `CLAUDE.md` and write `docs/source-of-truth/INVOICE-STUDIO.md`.

### P7 — Card retirement (OWNER DECISION — do not start unprompted)

---

## 7. Risks and traps

| Risk | Mitigation |
|---|---|
| **Owner identity leaking to public users** (email, phone, signature, Venmo QR, HITLOOP logo) | D8/D10 + P0 seed split + P1 `brand:null` + P5 accept #6 + P6 bundle check |
| `brief-css` ESM mirror drifting from the `.cjs` | Generated + drift-guard test (P1) |
| Published output changing | Byte-identity test; `editable` off by default |
| Caret loss / inputs fighting | D4 + focused-node skip + origin tagging |
| Rendered index ≠ draft index (terms, chips, flowSteps, subItems) | `renderedIndexToDraftIndex` + tests |
| Renderer fallbacks (`Item N`, qty 1) written back as content | Emit only on real `input` events |
| Money round-trip corruption (`$1,234.50`) | `data-inv-raw` + shared `parseValue`/`formatValue` |
| Client bundle bloat on a public route | Tool already dynamic-imported; admin assets dynamic |
| Anonymous user losing work | `localStorage` autosave + explicit Download .html |
| Two agents editing `StudioPage.jsx` | §5 exclusive ownership |
| Studio dev traps | Restart `npm run dev` after `.cjs` edits; never edit a Studio file mid-render |

## 8. Do not touch

`ClothStudio.jsx`, `LoopStudio.jsx`, `PaintStudio.jsx`, `app/dashboard/studio/loop/*`,
`edittrax_player/`, `services/loopcore/`, the mockup rail in `StudioPage.jsx`,
`api/_lib/browserless.cjs`, the publish/PDF branch of `custom-briefs/route.js`, `brief-css.cjs`
itself, and every uncommitted workstream in `git status`.

## 9. Verification

```
npm test        # fields, seed isolation, brief-css drift, renderer byte-identity
npm run build   # packaging sanity (docs/source-of-truth/VERCEL-HOBBY-DEPLOYMENT.md)
npm run dev     # manual: /dashboard/studio?tool=invoice signed-out AND as admin
```
Never run `npm run build` in the main repo while a dev server is live — use a worktree.
