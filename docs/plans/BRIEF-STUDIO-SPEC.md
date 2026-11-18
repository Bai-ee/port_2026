# Brief Studio — build spec (owner direction, 2026-11-18)

Bryan, after seeing v2: the client brief has the wrong visual template. Adopt the INVOICE look and feel, lay the content out by section headers designed like the briefs, optimize the PDF to fit as much content per page as possible with proper formatting, keep the same OG meta design tool as the invoice builder, and build it as its OWN Studio tool based on the Invoice Studio template.

Branch `feat/brief-studio` (off origin/main 06a57f99). Read first: `docs/source-of-truth/INVOICE-STUDIO.md` (whole doc, esp. §1 architecture, §4 privacy boundary, §5 themes, §9 rail), `docs/source-of-truth/CLIENT-BRIEF.md` (as-built v2: data, routes, OG, update-in-place, MCP, registry actions), `app/dashboard/studio/StudioPage.jsx` (tool switch ~2342/2368), `app/dashboard/studio/studio-tools-meta.js`, `app/dashboard/studio/invoice/*` (InvoiceStudio, InvoiceCanvas, useInvoiceDraft, rail/InvoiceRail, rail/PublishCard, rail/SavedInvoicesCard, themes/theme-schema.js), `features/invoices/render.js` (the ONE renderer pattern, INVOICE_CSS, hero/block/facts), `features/scout-intake/brief-renderer.js` (brief section header design: eyebrow label + section number + Doto heading), `features/client-brief/*`.

## Hard rules for the builder
- Work only in `/Users/baiagentbai/Documents/Repos/Bballi_Portfolio-clientbrief`. Never touch `~/Documents/Repos/Bballi_Portfolio`. No network/Firestore/Storage/Vercel/dev server; no commit/push; no `next build`; targeted tests only; no new libraries.
- Invoice Studio and invoice/brief kinds stay byte-for-byte unchanged (invoice golden/fixture tests must pass). Do not refactor invoice files; import from them, or add exports in place without changing output.
- `/dashboard/studio` is intentionally PUBLIC (Holo Paper, Invoice, Loop run signed out). Do NOT add an auth redirect to the route.
- Keep every v1/v2 safety property from CLIENT-BRIEF.md (random slug, exact resolve, no-store + noindex, brain off, doc-before-PDF, unpublish deletes PDF, update-in-place guards, 409 reverse guard, non-admins never see client briefs, digest/bundle ignore them, 20/day MCP+registry cap).

## 1. New Studio tool `brief`
- `?tool=brief`, tab label `CLIENT BRIEF`, entry in `studio-tools-meta.js` (generic copy; reuse an existing OG image path if no new asset). The tab shows ONLY for admins (`isAdmin`); a non-admin or signed-out visitor hitting `?tool=brief` sees a short "Admin only" panel (no data, no publish, no fetches). No route redirect.
- Files under `app/dashboard/studio/brief/`: `BriefStudio.jsx` (same shell/layout as InvoiceStudio: canvas left, rail right, same narrow/mobile behaviour), `BriefCanvas.jsx` (live preview of the document HTML, same frame/zoom/paper presentation as InvoiceCanvas but NO contenteditable/two-way bridge, NO HoloPaper), `useBriefDraft.js` (draft state + localStorage persistence like useInvoiceDraft: client, title, markdown, theme, OG fields; per-browser), `rail/BriefRail.jsx` with cards built from the SAME rail primitives (`components/rail-ui.jsx`, `rail-field-controls.jsx`, `SectionCard` look):
  1. **Client** — admin client picker (GET `/api/admin/clients`, as the dashboard does); all publish/list calls use `?as=<clientId>` via the same impersonation the dashboard uses. Default = the client in `?as=` if present.
  2. **Content** — title input + large markdown textarea (paste ChatGPT's breakdown) + character count.
  3. **Theme** — the invoice themes (theme-schema.js: same built-in themes, same picker UI).
  4. **Publish** — clone of invoice `PublishCard.jsx`'s publishing half: public toggle, Publish / Update (update in place on the loaded brief's slug), copy link, open, download PDF, AND the identical OG share-image editor + live preview (subhead, headline lines, extra lines, hide subhead; `og-preview` client-brief branch already exists).
  5. **Saved briefs** — like SavedInvoicesCard: list this client's client briefs (GET `?kind=client-brief`), open in editor (loads markdown/title/OG/theme), unpublish / republish / delete.
- Wording "Admin" divider like the invoice rail.

## 2. One renderer — `features/client-brief/render.js` v3
`renderClientBriefDocument(model, options)` used identically by the Studio canvas and the server publish route (same "one renderer" rule as invoices). Output = the INVOICE document look:
- Same `<head>` fonts, `BRIEF_CSS` + `INVOICE_CSS` (export INVOICE_CSS / needed helpers from `features/invoices/render.js` in place, no output change), theme CSS via `themeToCss(normalizeTheme(theme))` + `themeFontsHref`, same paper/page frame, same cover/hero composition as the invoice (eyebrow/doc label "CLIENT BRIEF", big Doto title, client name, date, brand mark slot), same meta strip style (Client · Date · Prepared by HITLOOP), same footer style.
- Brand: the HITLOOP brand mark may be passed in as an option (admin-only dynamic import, as InvoiceCanvas does with brand-marks.js); NEVER `default-from.js` owner contact info, payment/Venmo QR, tax id, address or phone.
- Content: parsed markdown (keep `features/client-brief/parse.js` blocks, faithful, in source order). Each `##` heading starts a SECTION rendered with the briefs' section header design (eyebrow "SECTION 0N" label + section title in the brief heading style, from brief-renderer.js), followed by that section's blocks rendered in the invoice body type styles (paragraphs, lists, GFM tables in the invoice table style, quotes, code, hr, links). Content before the first `##` goes in an intro block under the cover. `#` H1 = title (not repeated if equal). `###`+ are sub-headings inside a section. No reordering, no grouping, no dropped content.
- Sections flow; NO one-section-per-page, no forced page breaks, no full-height pages, no gradient blobs.

## 3. PDF: dense, properly formatted
- Paginated (Letter or A4 — pick what the invoice/brief PDFs use for the owner; document it), small sensible margins, compact print type scale (~10-10.5pt body), cover compressed to a header band on page 1 in print (content starts on page 1), sections NOT forced to new pages, `break-after: avoid` on headings / section headers, `break-inside: avoid` on table rows, list items, quotes, short paragraphs; table headers repeat; orphans/widows 3.
- Use Browserless pdfMode `'default'` (no injected layout CSS) unless you find the invoice mode better; do NOT edit `api/_lib/browserless.cjs`. Store `layoutVersion: 3`; lazy `/pdf` keeps old modes for v1/v2 docs.
- Verify locally with Playwright (`require('playwright')` from the repo node_modules) printing a long sample (≥3 sections, a 15-row table, lists) to PDF; report page count and save PNG/PDF to /private/tmp/claude-501/-Users-baiagentbai/eccde9fc-d227-4fd7-998c-1ff38c0fa78a/scratchpad/brief-studio-sample.{pdf,png}. Aim: no near-empty pages, no split rows.

## 4. Server + data
- `custom-briefs` POST client-brief: accept optional `theme` (validated via normalizeTheme); render with v3 renderer; store `theme`, `layoutVersion: 3`. Update-in-place keeps everything as in v2. Old v1/v2 docs keep their stored HTML.
- MCP `publish_client_brief` + registry `briefs.client.publish`: optional `theme` (built-in theme id only); otherwise unchanged. Results unchanged.

## 5. Dashboard Admin card
- `client-brief-publisher` card (Admin section) becomes a launcher like `invoice-builder`: `footerAction` OPEN STUDIO → `/dashboard/studio?tool=brief` (carry `?as=` for the selected client). Its panel: short description + Open Studio button + the saved-briefs list (reuse). Remove the old inline editor (ClientBriefCard's paste/preview/OG UI) — no orphaned code.

## 6. Tests (fakes only)
Renderer: invoice look markers (INVOICE_CSS present, theme CSS applied, cover/meta strip), `##` → brief-style section headers in order, nothing dropped (every block text appears in order), no owner contact/payment strings, escaping/XSS, print CSS rules present (no forced page breaks; avoid rules), theme validation. Route: theme stored/validated, layoutVersion 3, update keeps slug, v2 docs untouched. Studio: tool registered in studio-tools-meta + StudioPage switch, admin-only gating (non-admin renders Admin-only panel without fetches) — follow existing studio test patterns in `app/dashboard/studio/__tests__`. MCP/registry theme arg. Invoice tests unchanged and passing. Theme literal scan (`lib/theme-migration/__tests__/*.test.js`) passing.
Run: `node --test features/client-brief/__tests__/*.test.js app/api/dashboard/custom-briefs/__tests__/*.test.js features/mcp/__tests__/*.test.js features/x-strategy/__tests__/client-brief-actions.test.js features/invoices/__tests__/*.test.js app/dashboard/studio/__tests__/*.test.* app/dashboard/studio/invoice/__tests__/*.test.* lib/theme-migration/__tests__/*.test.js` (adjust globs to existing).

## 7. Docs
Update `docs/source-of-truth/CLIENT-BRIEF.md` (v3 as-built: Studio tool, renderer, PDF, card launcher) and add a short "Brief Studio" pointer in INVOICE-STUDIO.md only if a shared export was added there.

Report: files changed, screenshots/PDF paths + page count, test commands + counts, anything uncertain.
