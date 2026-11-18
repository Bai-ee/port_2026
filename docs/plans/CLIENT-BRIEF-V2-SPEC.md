# Client Brief v2 — build spec (owner changes, 2026-11-18)

Branch `feat/client-brief-v2` (off origin/main 6ddf529b, which has v1 = PR #102). Read `docs/source-of-truth/CLIENT-BRIEF.md` first (v1 as-built).

Owner changes, in his words condensed: do NOT invent a new layout.

## Hard rules for the builder
- Work only in `/Users/baiagentbai/Documents/Repos/Bballi_Portfolio-clientbrief`. Never touch `~/Documents/Repos/Bballi_Portfolio`. No network, Firestore, Storage, Vercel or dev-server calls; no commit/push; no `next build`; no full `npm test` (targeted test files only). node_modules is a symlink; do not install anything; no new libraries.
- Keep invoice and plain `brief` kinds byte-for-byte unchanged. Keep v1's safety properties (random slug, exact-match resolve, no-store + noindex, brain off, doc-before-PDF, unpublish deletes PDF, non-admins never see client briefs, digest/bundle ignore them, MCP daily cap).
- Theme rule: no new hex/rgba literals in themed files (`lib/theme-migration/__tests__/ws6-js-scan.test.js`); use `var(--t-*)` tokens in dashboard UI.

## 1. Layout = exactly what Bryan pastes
Replace v1's restructuring parser/renderer with a faithful Markdown renderer:
- `features/client-brief/parse.js`: Markdown → a flat, ordered block list, in source order. Blocks: heading (level 1-6), paragraph, blockquote, unordered list, ordered list (keep start number; one level of nesting is enough, deeper nests flatten), table (GFM pipe tables with header row + alignment), thematic break (`---`, `***`), fenced code (render as preformatted text; do NOT strip it any more, except keep stripping a fenced block whose info string or first line is `HITLOOP COMMAND`). Inline: bold, italic, bold-italic, inline code, links (http/https/mailto only; anything else renders as text), line breaks. No raw HTML (escaped as text). No sections, no grouping of `Label: value` lines, no reordering, no numbering.
- Firestore-safe model: no array directly inside an array (keep the `assertFirestoreSafe` test helper; e.g. table rows as `[{ cells: [{ tokens:[...] }] }]`). Store `sourceText` (truth), `blocks`, `html`.
- `features/client-brief/render.js`: one continuous document. House fonts and colours only: the same font stack and colour variables the shared brief CSS uses (`features/scout-intake/brief-css.cjs`: Doto for headings, Space Grotesk body, Space Mono labels/code; its ink/paper colour variables). You may include BRIEF_CSS for its variables/fonts but must NOT use its cover/section/full-page layout: no cover page, no hero, no section numbers, no gradient blob pages, no one-section-per-page. A small header (client name + date, in the house label style) and footer (date + "Download PDF" link) are allowed. Readable max width (~760px), sensible spacing, tables with borders from the house ink colour.
- PDF matches the page: `@media print` with the same flow, paginated naturally (letter/A4), headings avoid being orphaned at page bottom, table rows and list items avoid breaking mid-item. Check `api/_lib/browserless.cjs` (the edge-to-edge mode injects CSS such as overflow:hidden / break-inside rules around ~810-830) and make sure client-brief PDFs flow across pages: if needed add a `client-brief` pdfMode there that injects nothing layout-changing, and use it at publish and in the lazy `/pdf` route.
- Keep `<meta name="robots" content="noindex,nofollow">`, escaping, no owner contact details.

## 2. Placement: ADMIN section
- Move the card from the Briefs bucket to the Admin section: `category: 'admin'`, admin-only, placed next to `invoice-builder` in `DashboardPage.jsx`. Keep id `client-brief-publisher` and panel `#client-brief-panel`. Remove the Briefs-bucket entry and anything that only existed for that placement (e.g. the RUN BRIEF exclusion if no longer needed). Keep `CARD_ACTION_EDIT` / `CUSTOM_DETAIL_CARD_IDS` correct. Grep how `invoice-builder` is listed in tile-config / tier-access-config and mirror it.
- The card acts on the selected client (`apiPath` impersonation), as now.

## 3. Publishing features = the invoice creator's
Mirror the publishing half of Invoice Studio's `app/dashboard/studio/invoice/rail/PublishCard.jsx` (title, slug handling is NOT needed because slugs are random, public toggle, publish/update, copy link, open, download PDF, saved list) and its OG share-image editor:
- OG fields exactly as invoices: `ogLabel`, `ogSubhead`, `hideOgSubhead`, `ogTitleLines` (2), `ogLines` (2), with the same limits and the same "prefill once when all empty" behaviour (prefill from the brief title + client name + first paragraph).
- Live OG preview: extend `app/api/dashboard/custom-briefs/og-preview/route.js` to accept `kind:'client-brief'` (`{ title, clientName, ogLabel, ... }`, no invoice required for this kind) with a client-brief meta builder in `app/briefs/_lib/custom-briefs.js` next to `buildInvoiceOgPreviewMeta`, rendered by the same `renderOgImageJpeg`. Admin-only, writes nothing. The invoice branch must behave exactly as before.
- Stored + served: publish/update stores the OG fields on the doc; the public page's `<head>` gets the same kind of link-preview metadata invoices get (og:title, og:description, og:image → the `/og-image` route, twitter:card summary_large_image, canonical). Find how invoice briefs produce their head meta and og-image (`app/briefs/[clientId]/[briefSlug]/route.js`, `og-image/route.js`, `_lib/custom-briefs.js`, `_lib/og-image-render.js`) and reuse it. The OG image route must use the stored client-brief OG fields. Keep no-store + noindex for this kind (noindex does not block link-preview unfurls).
- Edit/update: the card can load a saved client brief (its `sourceText` + title + OG fields) back into the editor and re-publish to the SAME slug (update in place: re-render html, re-render the PDF, keep the URL). Add this to POST (e.g. `briefSlug` of an existing client brief for that client → update; otherwise create with a new random slug). Never let an update target a non-client-brief doc or another client's doc.
- Unpublish / Republish / Delete as v1.
- Do NOT port invoice layout/editing features (sections, line items, themes, canvas, HoloPaper, numbering).

## 4. MCP
- `publish_client_brief` accepts optional `ogLabel`, `ogSubhead`, `hideOgSubhead`, `ogTitleLines` (≤2), `ogLines` (≤2), and optional `briefSlug` to update an existing client brief in place. Returns publicUrl, pdfUrl, ogImageUrl, briefSlug.
- `list_client_briefs` / `unpublish_client_brief` keep working with the new doc shape. Update the tool descriptions, `features/mcp/guide.js`, `features/mcp/instructions.js`, `docs/source-of-truth/HITLOOP-MCP-SERVER.md`.

## 5. Tests (fakes only)
Update/replace v1 tests: markdown fidelity (each block type in order; nothing reordered or grouped; tables; ordered list start; code blocks kept; HITLOOP COMMAND stripped; raw HTML/`javascript:` escaped), Firestore-safe model, renderer has no cover/section pages and uses house fonts, print CSS present, client-brief pdfMode used at publish + lazy /pdf, og-preview client-brief branch (admin-only, writes nothing) + invoice branch unchanged, OG fields stored and present in public head meta, update-in-place keeps slug and rejects other clients/kinds, card placement category admin, MCP OG args + update. Run: `node --test features/client-brief/__tests__/*.test.js app/api/dashboard/custom-briefs/__tests__/*.test.js features/mcp/__tests__/*.test.js features/invoices/__tests__/*.test.js features/x-strategy/__tests__/brief-bundle.test.js lib/theme-migration/__tests__/*.test.js` plus any briefs/og tests you touch.

## 6. Docs
Update `docs/source-of-truth/CLIENT-BRIEF.md` to the v2 as-built.

Report: files changed, behaviour changes, test commands + counts, anything uncertain.
