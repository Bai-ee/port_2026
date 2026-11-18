# Client Brief — build spec (approved direction, 2026-11-18)

Owner direction (verbatim): "I need the provided info placed in a permanent template solution based on existing brief designs."
So: the admin PASTES a client's breakdown text (the daily ChatGPT/MCP breakdown) → HITLOOP renders it into a fixed template built on the existing brief design → publishes a hosted, shareable URL + PDF, exactly like the invoice. Admin-only, per client (the selected/impersonated client). Supersedes CLIENT-BRIEF-PLAN.md where they differ (no live data fetch, no LLM).

## Hard rules for the builder
- Work ONLY in `/Users/baiagentbai/Documents/Repos/Bballi_Portfolio-clientbrief` (branch feat/client-brief). Never cd into or touch `~/Documents/Repos/Bballi_Portfolio` (live dev server). `node_modules` is a symlink; do not npm install.
- No network writes: no Firestore/Storage/Vercel/Browserless calls, no dev-server requests, no push/commit. Tests use injected fakes only. Do not run `next build`.
- Keep the Mac light: run only the targeted test files (`node --test <files>`), not the full suite.
- Minimal diffs; preserve existing behavior of kind `brief` and kind `invoice` byte-for-byte.
- New edited UI containers get stable kebab-case ids (e.g. `id="client-brief-panel"`, `client-brief-paste-input`, `client-brief-preview-frame`, `client-brief-published-list`).

## 1. Parser — `features/client-brief/parse.js` (pure, ESM)
`parseClientBrief(text, { title?, clientName?, asOf? }) -> model`
- Input: pasted Markdown-ish text as ChatGPT writes it. Handle: `#`/`##`/`###` headings; a line that is only `**Heading**` or `**Heading**:`; `**Label (x)**: value` / `Label: value` lines; `-`/`*`/`•`/`1.` bullets; plain paragraphs; `---` rules; inline `**bold**`, `*em*`, `` `code` ``, `[text](https://url)` (http/https only).
- Model: `{ title, clientName, asOf, intro: Paragraph[], sections: [{ heading, blocks: [ {type:'stats', rows:[{label,value}]} | {type:'list', items:[inline]} | {type:'para', text:inline} ] }] }`. Consecutive `Label: value` lines group into one stats block. Text before the first heading becomes `intro` (or a first untitled section).
- Strip any `HITLOOP COMMAND` fenced blocks and other fenced code blocks (internal). Cap input at 50 000 chars; reject empty.
- Deterministic, no LLM, no I/O.

## 2. Renderer — `features/client-brief/render.js` (ESM)
`renderClientBriefHtml(model, { publicUrl?, pdfPath?, generatedAt? }) -> full HTML document`
- Base it on `features/leadgen/estimate-renderer.js` (same `<head>`: Doto/Space Grotesk/Space Mono fonts, `<style>${BRIEF_CSS}</style>` from `features/scout-intake/brief-css.cjs` via createRequire) and reuse the brief CSS classes it and `features/scout-intake/brief-renderer.js` use (cover/hero, section blocks, `stat-row` k/v, mono labels). Read both files first and match their look; add only a small extra `<style>` for things BRIEF_CSS lacks.
- Cover: client name (upper), title (default "Client Brief"), date mark from `asOf`. Sections numbered like the existing brief. Footer: date + "Download PDF" link when `pdfPath` given. NO owner contact details, address, phone, tax id, payment info.
- `<meta name="robots" content="noindex,nofollow">`. Everything escaped; inline markup rendered only from the parser's safe tokens; links get `rel="noopener noreferrer"`.
- Print-friendly (paginated, sections avoid breaking mid-block).

## 3. Publish path — `app/api/dashboard/custom-briefs/route.js` + `app/briefs/**`
Add kind `client-brief` alongside `invoice` (do not change other kinds' behavior):
- POST body `{ kind:'client-brief', text, title?, public:true }`: admin only (existing `verifyAdminRequest`), client = existing bootstrap effective client (do NOT accept clientId from body). Server parses + renders (never trusts client HTML). Client name from the client doc.
- Doc id AND publicBriefSlug contain a random token: `client-brief-<YYYYMMDD>-<crypto.randomBytes(8).toString('hex')>`; never derived from the title. In `app/briefs/_lib/custom-briefs.js` resolve, for docs with kind `client-brief`, ONLY by exact doc id / exact publicBriefSlug — skip the hyphen-variant and compacted-title fallbacks.
- Store the kind as `client-brief` (fix the collapse to `'brief'` at POST and in `serializeBriefDoc`). Store `sourceText` (the paste) and `model`.
- `addToClientBrain` forced false. No Vercel side effects.
- PDF: rendered at publish via existing `persistBriefPdfArtifact` with paginated (`edge-to-edge`) mode; the `/pdf` route's lazy path also works for this kind.
- Preview: POST `{ kind:'client-brief', text, preview:true }` returns `{ html }` and writes NOTHING (no Firestore, no Storage, no PDF).
- Unpublish: new `PATCH` (admin) `{ briefSlug, public:false }` → set `public:false` AND delete the stored PDF artifact (Storage object) + clear pdfUrl/pdfArtifact. Republish = PATCH `public:true` (PDF re-renders lazily on next /pdf). DELETE keeps working.
- GET: admins get their client's `client-brief` docs including unpublished ones (so they can republish/delete); non-admin users must NOT receive `client-brief` docs at all.
- Public page + `/pdf` + `/og-image` for kind `client-brief`: `cache-control: no-store`, `X-Robots-Tag: noindex, nofollow`.
- Kind filter: `features/intelligence/_digest-brief-link.js` (~36-51) and `features/x-strategy/brief-bundle.js` (~309-314) must ignore `client-brief` docs when picking "newest public brief".

## 4. Admin card — Briefs bucket
- `DashboardPage.jsx`: new card `id:'client-brief'`, `category:'brief'`, admin-only (`...(isAdmin ? [...] : [])`), placed right after `submit-custom-brief`. label `CLIENT BRIEF`, rows: Client (selected client name), Input "Paste breakdown", Output "Hosted URL + PDF", Access "Admin only". Panel: `activeTileModal.cardId === 'client-brief' && <ClientBriefCard user={user} apiPath={apiPath} clientName={...} />`. Add it to any admin-unlock lists the same way `submit-custom-brief` is (grep how that card is gated).
- `components/dashboard/ClientBriefCard.jsx` (follow `InvoiceBuilderCard.jsx` patterns for auth token + `apiPath`): title input (default "Client Brief"), large textarea, Preview button (iframe srcdoc of preview HTML), Publish button (confirm dialog naming the client), list of this client's client briefs: date, title, status Public/Unpublished, Copy link, Open, Download PDF, Unpublish/Republish, Delete. Uses existing dashboard styles (`mu-btn-outline` etc.).

## 5. Tests (node:test, fakes only)
- `features/client-brief/__tests__/parse.test.js`: headings, bold-label lines, stats grouping, bullets, links (javascript: rejected), fenced/HITLOOP COMMAND stripped, empty/oversize rejected, a realistic NTR daily-update sample.
- `features/client-brief/__tests__/render.test.js`: noindex, escaping (`<script>` in paste stays text), uses BRIEF_CSS, no owner contact strings, PDF link present when given, snapshot-ish structural asserts.
- Route-level tests where the existing test patterns allow (look in `app/**/__tests__`, `api/**/__tests__` for custom-briefs tests and mirror their mocking): slug has 16 hex + not from title; title/hyphen fallback does not resolve a client-brief; preview writes nothing; addToClientBrain false; non-admin GET excludes client-brief; unpublish deletes PDF artifact; digest-link and brief-bundle skip client-brief. If a route is not unit-testable without heavy mocking, extract the decision logic into a small pure helper in `features/client-brief/` and test that.
- Invoice + existing brief tests still pass: run `node --test features/invoices/__tests__/*.test.js features/leadgen/__tests__/*.test.js` plus any custom-briefs / briefs / digest-brief-link / brief-bundle tests you touched.

## 6. Docs
`docs/source-of-truth/CLIENT-BRIEF.md` (as-built: flow, files, routes, privacy, unpublish semantics, tests).

## Report back
Files changed, behavior per kind, test commands + pass/fail counts, anything not done or uncertain. Do not commit.
