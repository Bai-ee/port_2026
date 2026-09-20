# Invoice Studio — Product Fundamentals + Design Layer handoff

> **⚠️ SUPERSEDED.** Q0–Q4 are complete and verified (181 invoice-scoped + 3327 full-suite tests,
> 0 failures; byte-identity to the pre-Studio golden fixture preserved) — see
> [`docs/source-of-truth/INVOICE-STUDIO.md`](../source-of-truth/INVOICE-STUDIO.md) for the current
> contract. Kept here for the phase-by-phase design rationale only; do not treat anything below as
> outstanding work or re-run the master prompt in §7.

Status (historical): **READY FOR EXECUTION — not yet implemented.** Execute continuously through Q0–Q4;
request owner input only for a genuine blocker or required scope decision.
Audience: one orchestrating Claude session using parallel Sonnet implementation agents.
Builds on [`INVOICE-STUDIO-TOOL-HANDOFF.md`](INVOICE-STUDIO-TOOL-HANDOFF.md), whose P0–P4
implementation and privacy contracts remain binding. This document supersedes that handoff as the
execution plan; its P5 bridge contract remains the source specification for live editing.

---

## 0. Verified current state (2026-09-03)

Branch: `feat/brief-rendered-scrape-phase-1`. The Studio and invoice work is uncommitted alongside
unrelated workstreams; preserve all existing changes. Implementation must happen in this current
checkout because a branch-only Git worktree would omit the uncommitted baseline.

| Area | State |
|---|---|
| Shared draft/field seam | Built: `invoice-fields.js`, `useInvoiceDraft.js`, `invoice-seeds.js` |
| Renderer | Built: client-safe ESM renderer, brand/editable options, `data-inv-*` annotations |
| Studio shell/canvas/rail | Built and publicly mounted; 10 rail cards including admin-only publish/saved invoices |
| Two-way canvas bridge | **Not built**; `useInvoiceBridge.js` does not exist |
| Design/document fundamentals | **Not built** |
| Hardening/SSOT | **Not built** |
| Legacy dashboard card retirement | Owner decision; out of this pass |

Verified command:

```sh
node --test app/dashboard/studio/invoice/__tests__/*.test.js features/invoices/__tests__/*.test.js
# 63 pass, 0 fail
```

Important baseline facts:

- The current invoice is a fluid web document. Its invoice-specific stylesheet overrides the shared
  brief palette to **white paper and black ink**.
- The renderer already emits `@page { margin:12mm; }`, but no explicit Letter/A4 size or robust
  multi-page geometry.
- Current fonts are Doto, Space Grotesk, and Space Mono, hardcoded in CSS. Doto is not in
  `GOOGLE_FONT_CATALOG`; the untouched default renderer must keep loading it directly.
- `theme:null` must reproduce today's complete HTML bytes exactly. Never regenerate the golden
  fixture.
- `InvoiceCanvas.jsx` currently recomputes `structureKey(invoice, sections)` and passes only the
  existing renderer options. Q0 must create the complete data path for every new option.
- The immediately preceding rail build reported `npm test` at **3209 pass, 0 fail** plus a live
  browser acceptance pass. This review independently reconfirmed the invoice subset at 63/63.
  Invoice tests remain the per-phase gate; any later full-suite failure must be classified against
  the reported clean baseline and the execution environment.

---

## 1. Round objective and scope

Ship a credible zero-signup invoice product: direct editing, professional document variants,
identity/numbering/local reuse, curated design presets, and print-correct PDF output. Keep the
implementation local-first and preserve the public/admin privacy boundary.

### In scope — mandatory this round

- Two-way live canvas editing, including touch/mobile focus behavior.
- Print-correct Letter and A4 output with sane margins and row/totals pagination.
- Public logo upload: PNG/JPEG/WebP and sanitized SVG, 300 KB maximum.
- Document kinds: Invoice, Quote, Estimate, Receipt, Credit Note.
- Editable visible labels.
- Locale-aware dates and currency formatting; default `en-US` remains today's output.
- Sequential browser-local numbering patterns, with duplicate detection.
- Browser-local saved clients and saved items with autofill.
- Four curated built-in themes: Default, Ledger, Editorial, Studio Dark.
- Existing Print/Save PDF and Download HTML actions.
- Preserve the completed 14-card, one-card-per-section rail. New controls are folded into their
  relevant section cards rather than added as global cards.
- Privacy, byte-identity, mobile, bundle, and documentation hardening.

### Explicitly deferred

- HOLO PAPER/PAPER mode, three.js, cloth physics, foil, drape, and artwork-library handoff.
- Paint recipes, generated paper textures, p5 integration.
- PNG/raster export and `html-to-image`.
- Theme JSON import/export and custom theme creation.
- Undo/redo.
- Public hosted links/email, hosted themed invoices, payments, reminders, recurring invoices.
- Layout systems that structurally reflow content, brand-kit-from-URL, thumbnails, AI autofill,
  community presets, and per-token color controls/contrast UI.

No new runtime dependency is required by this plan.

---

## 2. Locked decisions

| # | Decision |
|---|---|
| L1 | The current white/black invoice is the Default theme. `theme:null` is the only stored representation of Default and is byte-identical to today. |
| L2 | Themes are built-in presets only. They override fonts/colors/paper/margins; they do not change DOM structure or layout system. |
| L3 | The untouched default keeps the current Doto/Space Grotesk/Space Mono link. A non-null theme loads its catalog fonts plus the current default faces needed by untouched shared CSS. |
| L4 | The persisted v2 snapshot is exactly `{ v:2, invoice, sections, theme, savedAt }`. `theme` is separate from `invoice`; all document semantics live inside `invoice`. |
| L5 | New invoice fields are `docKind`, `labels`, `locale`, `numberPattern`, and `logoDataUrl`. `normalizeInvoice()` validates and preserves them. |
| L6 | Q0 owns the complete plumbing: storage migration, structural render key, `InvoiceStudio` props, and `InvoiceCanvas` renderer options. No later lane invents a second state path. |
| L7 | `structureKey(invoice, sections, theme)` includes doc kind, labels, locale, logo, theme id/paper/margins, plus today's structural fields. Value edits still patch in place through the bridge. |
| L8 | Paper options are `fluid`, `letter`, and `a4`. Null/default remains today's HTML. Only explicit non-fluid output adds size/geometry overrides. |
| L9 | Admin `brand.logo` wins over a draft logo. Public drafts never import owner brand/default/payment modules. |
| L10 | SVG uploads preserve accepted raw bytes but must first pass a strict sanitizer: reject scripts, event handlers, foreign content, external href/src, external CSS URLs, and unsafe data types. |
| L11 | Number sequences are browser-local, best-effort across tabs, and scoped by normalized pattern + document kind. A number is reserved when New Document is created, not on every render. |
| L12 | Saved clients/items are browser-local only. No account sync, API route, Firestore collection, or admin-publish schema expansion in this pass. |
| L13 | Parallel work starts only after Q0. Each lane owns exact production and test files; shared files are changed by the orchestrator during integration, not concurrently. |
| L14 | The completed rail architecture is locked: 14 section cards render from `draft.sections.order`; Publish/Saved Invoices remain below the admin divider. Do not add Identity, Labels, Theme, or Saved Data cards. |
| L15 | Controls live contextually: Cover owns document kind/logo/theme; Invoice details owns locale/numbering/label overrides; Bill to owns saved clients; Line items and Additional items own saved-item reuse. |
| L16 | `resolveInvoiceLabels(invoice)` is the one terminology resolver used by the renderer and rail. Document-kind defaults resolve first, explicit editable-label overrides second. |
| L17 | Mobile/accessibility is part of Q1: section visibility/reorder controls need touch-sized hit areas, and collapsed card contents must not remain keyboard-focusable while visually hidden. |

---

## 3. Contracts established in Q0

### 3.1 Canonical invoice additions

```js
invoice.docKind       // 'invoice' | 'quote' | 'estimate' | 'receipt' | 'creditNote'
invoice.labels        // normalized allow-listed string map; absent/{} uses current text
invoice.locale        // supported BCP-47 tag, default 'en-US'
invoice.numberPattern // default 'INV-{YYYY}-{seq:3}'
invoice.logoDataUrl   // null or validated image data URL
```

`DOC_KIND_LABELS`, `INVOICE_LABEL_KEYS`, and `resolveInvoiceLabels(invoice)` live in
`features/invoices/model.js` and are the single source of defaults:

```js
{
  title,
  numberLabel,
  invoiceDetails,
  statusLabel,
  issueLabel,
  dueLabel,
  paymentTermsLabel,
  poNumberLabel,
  servicePeriodLabel,
  currencyLabel,
  billedByLabel,
  tradingAsLabel,
  addressLabel,
  emailLabel,
  phoneLabel,
  siteLabel,
  taxIdLabel,
  billToLabel,
  clientLabel,
  contactLabel,
  summaryLabel,
  categoriesLabel,
  lineItemsLabel,
  taskLabel,
  hoursLabel,
  rateLabel,
  amountLabel,
  additionalItemsLabel,
  totalsLabel,
  subtotalLabel,
  discountLabel,
  taxLabel,
  totalLabel,
  amountPaidLabel,
  balanceLabel,
  paymentDueLabel,
  recommendationLabel,
  flowLabel,
  termsLabel,
  paymentLabel,
  notesLabel,
}
```

The editable label allow-list is declared once in `model.js`. Document-kind defaults are resolved
first; explicit `invoice.labels[key]` overrides second. Empty/invalid values fall back safely.
The section cards use the same resolved labels for their titles where a printed heading exists.
`Cover` and `Contact footer` remain stable editor-only card names because those sections print no
heading. The registry retains baseline/default labels but its hints must accurately describe the
current renderer.

`formatMoney(value, currency = 'USD', locale = 'en-US')` and the date formatter accept locale
without changing existing two-argument/default output.

### 3.2 Theme contract

`app/dashboard/studio/invoice/themes/theme-schema.js` is client-safe and pure:

```js
THEME_SCHEMA_VERSION = 1

ThemePreset = {
  id: 'ledger' | 'editorial' | 'studio-dark',
  label: string,
  version: 1,
  fonts: { display: <catalog id>, body: <catalog id>, mono: <catalog id> },
  colors: { paper: '#hex', ink: '#hex', inkSoft: '#hex', accent: '#hex', line: '#hex' },
  paper: 'letter' | 'a4' | 'fluid',
  margins: 'tight' | 'normal' | 'wide',
  why: string,
}

normalizeTheme(raw) -> ThemePreset | null // only known built-ins survive
themeToCss(theme) -> string
themeFontsHref(theme) -> string
BUILTIN_THEME_PRESETS -> three non-default stored presets
```

The Design subsection inside `CoverCard` displays four choices. “Default” writes `null`; the other
three write their frozen preset. No separate Theme card and no import/export UI.

### 3.3 Renderer contract

```js
renderInvoiceDocument(invoice, {
  ...existingOptions,
  theme: ThemePreset | null,
  paper: 'letter' | 'a4' | 'fluid' | null, // optional explicit override; theme.paper wins
})
```

Document kind, labels, locale, numbering, and logo are read from normalized `invoice`. Theme is an
editor-only option in this round. New options omitted + new invoice fields absent must produce the
existing golden bytes.

Theme CSS is emitted after `INVOICE_CSS` and must retarget all relevant hardcoded invoice selectors,
including root/body ground, cards, text, status/paid colors, QR ground, and font-family selectors.
Scoping only `.invoice-sheet` is insufficient for `html/body`; use a theme marker on `<html>` or
`body` only for non-null themes.

### 3.4 Draft/storage/render wiring

- Read `invoice-studio-draft-v2` first.
- If absent, read v1 once and migrate to `{v:2, invoice, sections, theme:null}`.
- Do not delete v1 until the v2 write succeeds.
- `useInvoiceDraft()` returns `invoice`, `sections`, `theme`, `setTheme`, and one computed
  `structureKey` covering all full-render inputs.
- `InvoiceStudio` passes `theme` and `structureKey` to `InvoiceCanvas`.
- `InvoiceCanvas` uses the supplied key as its render-effect dependency and passes `theme` to the
  renderer. It must not maintain a second, divergent key calculation.

### 3.5 Local book and numbering

```js
invoice-studio-book-v1 = {
  v: 1,
  clients: [{ id, name, contact, email, address, updatedAt }],
  items: [{ id, name, note, qty, unitPrice, costLabel, updatedAt }],
}

invoice-studio-numbering-v1 = {
  v: 1,
  counters: { [docKind + ':' + normalizedPattern]: number },
  recent: [{ number, docKind, createdAt }],
}
```

Pattern grammar is limited to `{YYYY}`, `{YY}`, `{MM}`, and `{seq:N}` where N is 1–6. Unknown or
malformed tokens return a validation error rather than silently producing a broken number.

---

## 4. Phases and exclusive ownership

### Q0 — Foundation and contracts (blocking, orchestrator only)

Owns:

- `invoice/themes/theme-schema.js` and its new test file.
- `features/invoices/model.js` contract additions and a new dedicated model-contract test file.
- `features/invoices/registry.js` baseline label/hint corrections and its existing tests.
- `invoice/useInvoiceDraft.js`, `invoice/invoice-fields.js` and their existing tests.
- Plumbing hunks in `InvoiceStudio.jsx` and `InvoiceCanvas.jsx`.
- `invoice/rail/SectionCard.jsx` default-title resolution only.

Work:

- Correct state migration and establish the contracts in §3.
- Route theme and the canonical structural key through the canvas.
- Add renderer option plumbing without a visible UI change.
- Correct stale registry descriptions to match the as-built Cover, Summary, Additional items,
  Payment due, and Contact footer sections.
- Make `SectionCard` obtain printed section titles from `resolveInvoiceLabels(draft.invoice)` while
  keeping Cover/Contact footer as editor-only fixed names. Existing card props may remain as fallback
  strings during migration, but cannot become a second source of truth.

Accept:

- Invoice tests pass (63 existing plus new tests).
- A v1 draft migrates to v2 with `theme:null`.
- Default renderer output remains byte-identical.
- No visible Studio change.

Continue directly to Q1 when Q0 acceptance checks pass. Do not require owner testing or approval.

### Q1 — Two-way editing and mobile (Lane E, one Sonnet agent)

Owns:

- `invoice/useInvoiceBridge.js` and a new bridge test file.
- The pre-reserved bridge wiring hunk in `InvoiceStudio.jsx`.
- `invoice/rail/SectionCard.jsx` touch-target changes.
- An additive `inertWhenClosed`/equivalent hunk in `components/rail-ui.jsx`; other Studio tools must
  remain byte/behavior-equivalent when they omit the new prop.

Implement the tool handoff P5 contract: input/blur/Enter/Escape behavior, draft-to-canvas patches,
derived-field updates, structural reattachment, rail focus, and cleanup. Add touch focus and
`visualViewport`-aware scroll behavior without moving state ownership into the bridge.
Give the eye and reorder controls touch-sized hit areas on narrow/coarse-pointer layouts. Prevent
collapsed section-card inputs from receiving keyboard focus while hidden, then open the card before
the bridge focuses its target.

Accept:

- Desktop and touch edits round-trip without replacing the iframe during typing.
- Canvas focus opens and focuses the owning rail field.
- Mobile keyboard does not strand the active field behind the viewport.
- No listener duplication after structural rerenders.
- Collapsed card inputs are skipped by keyboard navigation; opening restores focusability.
- Eye/reorder controls have at least a 44×44 CSS-pixel hit area on touch layouts without making the
  desktop rail visually bulky.
- Public canvas contains no owner identity.

Continue directly to Q2 when Q1 acceptance checks pass. Do not require owner testing or approval.

### Q2 — Two parallel product lanes

#### Lane B — Document identity

Owns:

- New `invoice/identity/*` helpers and tests.
- `invoice/rail/LogoControl.jsx`.
- `invoice/rail/CoverCard.jsx` identity/logo subsection only.
- `invoice/rail/InvoiceMetaCard.jsx` document numbering/locale/editable-label subsections.
- New SVG sanitizer module and tests.
- `features/invoices/render.js` document-semantics hunks and a new dedicated
  `features/invoices/__tests__/invoice-identity.test.js`.
- The admin publish-title default hunk in `invoice/rail/InvoiceRail.jsx`.

Implements document kind, editable labels, locale selection, numbering pattern/next number,
duplicate warning, and sanitized logo upload. It consumes Q0 model/draft contracts and does not edit
`model.js`, `InvoiceCanvas.jsx`, or existing shared test files. After Lane B returns, the orchestrator
owns the small `useInvoiceDraft.startNewInvoice()` integration that calls Lane B's tested numbering
helper exactly once. The publish UI uses the resolved document title (`Quote 123`, etc.) while the
API discriminator remains `kind:'invoice'`.

#### Lane C — Saved clients/items

Owns:

- `invoice/book.js` and `invoice/__tests__/book.test.js`.
- Saved-client controls in `invoice/rail/BillToCard.jsx`.
- Saved-item controls in `invoice/rail/LineItemsCard.jsx` and
  `invoice/rail/StandaloneItemsCard.jsx`.
- `invoice/rail/ItemFieldsEditor.jsx`.

Implements quota-safe storage, dedupe/update/delete, client autofill, and item insertion/autofill.

Integration rule: Lane B and Lane C production files are disjoint. The orchestrator inspects and
integrates both results, performs the number-reservation hook wiring, runs all invoice tests, and
owns any resulting repair. Agents never merge over one another.

Accept:

- A blank draft can render every document kind with correct default terminology.
- Explicit label overrides win in both the rendered document and corresponding rail-card titles.
- `de-DE` visibly changes dates/money while default `en-US` is unchanged.
- New Document reserves one sequential number; rerenders do not increment it.
- A sanitized SVG logo renders and survives HTML download; unsafe/external SVG is rejected.
- Saved clients/items survive reload and autofill without network calls.
- The rail still contains exactly the 14 ordered section cards plus the existing admin-only cards;
  no Identity, Labels, Theme, or Saved Data card is added.

Continue directly to Q3 when Q2 acceptance checks pass. Do not require owner testing or approval.

### Q3 — Themes and print (Lane T, one Sonnet agent)

Owns:

- `features/invoices/render.js` and a new dedicated renderer-theme test file.
- The design/theme subsection of `invoice/rail/CoverCard.jsx`.
- The pre-reserved print-action hunk in `InvoiceCanvas.jsx`.

Implement Default/null plus Ledger, Editorial, and Studio Dark. Add Letter/A4/margin print geometry,
`break-inside:avoid` safeguards on item rows and totals, and a print helper that awaits
`document.fonts.ready` with a bounded timeout before calling `print()`.

Accept:

- Golden fixture unchanged for omitted options and `theme:null`.
- Every preset renders its expected font/color variables.
- Default continues loading Doto even though Doto is not in the shared catalog.
- A 25-item Letter invoice has no split item row or split totals block in Chrome print preview.
- Letter and A4 report the intended `@page` size/margins.
- Dark theme remains readable in screen and print-color-adjust output.

Continue directly to Q4 when Q3 acceptance checks pass. Do not require owner testing or approval.

### Q4 — Hardening and documentation (orchestrator)

- Run all invoice tests and compare the golden fixture without regeneration.
- Run `npm test`; classify unrelated environment failures and prove no new invoice regression.
- Run `npm run build` only when no dev server shares the checkout. If one does, construct an isolated
  temporary snapshot containing the exact current tracked and untracked working state; do not build
  a branch-only worktree that silently omits the uncommitted Invoice Studio files.
- Manual signed-out and admin pass at `/dashboard/studio?tool=invoice` on desktop and narrow width.
- Confirm the rail still renders from `draft.sections.order`; eye/reorder behavior, open state, and
  bridge focus remain correct after document-kind and theme changes.
- Bundle audit: public invoice chunk excludes `brand-marks`, `payment-qr`, `default-draft`, p5, and
  eagerly-loaded three.js.
- Confirm logo/SVG privacy behavior and localStorage failure handling.
- Write `docs/source-of-truth/INVOICE-STUDIO.md`, update the repo documentation pointer, and mark
  both invoice handoffs superseded by the SSOT after final verification passes.
- Leave legacy card retirement untouched.

Definition of done: all invoice tests green, build clean in a safe checkout or exact isolated
snapshot, default golden bytes unchanged, manual checks recorded, bundle audit clean, and SSOT written.

---

## 5. Do not touch

- `ClothStudio.jsx`, `PaintStudio.jsx`, `LoopStudio.jsx`, all `paint/*`, and all PAPER/three.js code.
- `brief-css.cjs`, `brief-css.js`, and the golden fixture.
- `api/_lib/browserless.cjs` and the custom-brief publish/PDF branch.
- Existing admin publish/storage schema beyond passing today's invoice/sections payload.
- The legacy `InvoiceBuilderCard` mount.
- The locked 14-card section-driven rail structure. Contextual controls may be added only in the
  section cards assigned by §4.
- Any unrelated uncommitted workstream shown by `git status`.
- No deploy, cron edit, paid API call, new API route, Firestore collection, package install, or commit.

---

## 6. Verification commands

```sh
node --test app/dashboard/studio/invoice/__tests__/*.test.js features/invoices/__tests__/*.test.js
npm test
npm run build # only with no dev server in that checkout; otherwise use an exact isolated snapshot
npm run dev   # manual signed-out + admin, desktop + narrow, print preview
```

---

## 7. Master Claude prompt

Copy the fenced prompt below into a new Claude session from this repository:

```text
You are the orchestrating implementer for Invoice Studio in this repository. Use multiple Sonnet
agents exactly as directed by the approved master plan. Work in the current checkout because the
Invoice Studio baseline is uncommitted and a normal branch-only worktree would omit it. Never
discard, reset, overwrite, commit, deploy, or modify unrelated user changes. For the final build,
use this checkout only if no dev server shares it; otherwise construct an isolated temporary snapshot
that contains the exact tracked and untracked working state.

READ COMPLETELY BEFORE EDITING:
1. CLAUDE.md
2. docs/plans/INVOICE-STUDIO-TOOL-HANDOFF.md, especially §4 and P5
3. docs/plans/INVOICE-STUDIO-DESIGN-LAYER-HANDOFF.md — this is the controlling execution plan
4. The existing code under app/dashboard/studio/invoice/** and features/invoices/**
5. The specific reused modules named by the controlling plan

BASELINE FIRST:
- Run:
  node --test app/dashboard/studio/invoice/__tests__/*.test.js features/invoices/__tests__/*.test.js
- Expect at least the verified 63 existing passes and 0 failures before your changes. Report the
  exact count. If an invoice test fails, stop and report it. The immediately preceding completed
  build reported the full npm test suite at 3209/3209; classify any difference rather than assuming
  it is unrelated environment noise.
- Record git status and protect every unrelated uncommitted path.

EXECUTION AND AGENT RULES:
- Execute Q0 through Q4 in order in one uninterrupted run. Do not ask the owner to test or approve
  between phases. Continue automatically whenever the current phase's acceptance checks pass.
- Q0 is blocking and owned by you, the orchestrator. Do not spawn Q1/Q2/Q3 agents before its
  contracts and tests are green.
- Q1: spawn one Sonnet agent for Lane E with only Q1 ownership and acceptance criteria.
- Q2: spawn two Sonnet agents in parallel, one for Lane B and one for Lane C. Give each only its
  exact ownership; their production files are disjoint. You own the post-agent number-reservation
  hook wiring. Neither agent may overwrite the other or add a new top-level rail card.
- Q3: after Q2 integration and acceptance checks pass, spawn one Sonnet agent for Lane T.
- Q4 is owned by you.
- Every agent must report: files touched, tests added, tests run, acceptance checks passed/failed,
  browser-only checks still needed, and any scope/ownership conflict. An agent must stop rather than
  edit outside its ownership.
- Before accepting any agent result, inspect its diff, reject scope drift, integrate deliberately,
  and rerun the full invoice test command yourself.

NON-NEGOTIABLE PRODUCT CONTRACTS:
- The existing white/black default invoice is the baseline. theme:null and omitted new fields must
  remain byte-identical to the golden fixture. Never regenerate the fixture.
- Canonical persisted v2 snapshot and state/render plumbing are exactly §3 of the controlling plan.
  Do not invent parallel state or a second structural-key calculation.
- Document semantics live in invoice; theme is separate. DOC_KIND_LABELS and editable-label keys
  have one source of truth in model.js. resolveInvoiceLabels(invoice) is consumed by both renderer
  and rail; hardcoded document-kind terminology must not become a second source of truth.
- Preserve the completed rail: exactly 14 section cards rendered from draft.sections.order, followed
  by the existing admin divider/cards for admins. Fold controls contextually into Cover, Invoice
  details, Bill to, Line items, and Additional items as assigned by the plan. Do not create Identity,
  Labels, Theme, or Saved Data cards.
- Preserve the public/admin privacy boundary. Public chunks and output must not contain owner
  identity, HITLOOP marks, default draft data, or payment QR assets.
- SVG must be sanitized per L10 before storage/render. Reject active content and all external
  resource references.
- Numbering is browser-local and reserved only on New Document, never during render.
- Saved clients/items are browser-local only.
- Built-in themes only: Default/null, Ledger, Editorial, Studio Dark. No JSON import/export.
- On touch layouts, section eye/reorder controls require at least 44×44 hit areas. Collapsed card
  controls must not remain keyboard-focusable while hidden; preserve other Studio tools through an
  additive opt-in RailCard API.
- This round has no HOLO PAPER, Paint texture, PNG export, html-to-image, undo/redo, share/email,
  new API surface, or new dependency.
- Do not touch anything in §5 of the controlling plan.

VERIFICATION DISCIPLINE:
- After each lane and integration: run all invoice tests.
- For default rendering: byte-compare against the existing golden fixture.
- Q3 requires a real Chrome print-preview check for a 25-item Letter invoice; automated CSS-string
  assertions alone are insufficient.
- Q4: run npm test and classify failures against the recorded baseline; run npm run build only in a
  checkout with no live dev server, using an exact isolated snapshot if necessary; perform
  signed-out/admin and desktop/narrow manual checks; inspect the public bundle.
- Never claim a browser, print, mobile-keyboard, or bundle check passed unless you actually ran it.

FINAL REPORT FORMAT:
1. Outcome
2. Files changed
3. Tests and exact counts
4. Manual acceptance evidence
5. Known limitations/blockers
6. Diff/ownership audit
7. Final readiness statement

Start with the baseline and Q0, then continue through Q1–Q4 without waiting for owner input. Pause
only for a genuine blocker that cannot be resolved safely within the approved plan. Return once the
entire plan is implemented and final verification is complete.
```
