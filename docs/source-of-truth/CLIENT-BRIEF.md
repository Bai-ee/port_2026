# Client Brief (as built)

Admin pastes a client's breakdown text (the daily ChatGPT/MCP breakdown) -> HITLOOP parses it deterministically, renders it into a fixed template built on the existing brief design, and publishes a hosted, shareable URL plus PDF, like the invoice. Admin-only, per client (the selected/impersonated client). No live data fetch, no LLM. Build spec: `docs/plans/CLIENT-BRIEF-BUILD-SPEC.md`.

## Flow
1. Dashboard > Briefs bucket > card `CLIENT BRIEF` (card id `client-brief-publisher`; `client-brief` is already the DESIGNER "Design Brief" card). Admin only.
2. `ClientBriefCard.jsx`: title, paste textarea, Preview (iframe `srcdoc` of server HTML), Publish (confirm names the client), list of this client's client briefs.
3. `POST /api/dashboard/custom-briefs` `{ kind:'client-brief', text, title?, public:true }`. Server parses + renders; the client never sends HTML. Client = admin's effective client from bootstrap (a `clientId` in the body is ignored).
4. Preview: same POST with `preview:true` returns `{ html }` and writes nothing (no Firestore, Storage, PDF).

## Files
- `features/client-brief/parse.js` - pure parser -> `{ title, clientName, asOf, intro, sections[{heading, blocks}] }`. Blocks: `stats` (consecutive `Label: value` / `**Label**: value`), `list` (`ordered` true for `1.` lists, rendered as `<ol>`), `para`. The model is Firestore-safe: no array directly contains an array (`intro: [{tokens}]`, `items: [{tokens}]`). Inline tokens `b/em/code/link`; only http(s) links survive. Fenced blocks (incl. HITLOOP COMMAND) stripped; empty rejected; cap 50 000 chars.
- `features/client-brief/render.js` - template over `BRIEF_CSS` (cover, numbered sections, stat rows). noindex, everything escaped, links `rel="noopener noreferrer"`, no owner contact/payment info. Print rules let long sections flow and avoid mid-block breaks.
- `features/client-brief/publish.js` - pure decisions: slug generator, fuzzy-resolve guard, GET visibility, parse+render wrapper.
- `app/api/dashboard/custom-briefs/route.js` - `handleClientBriefPost`, `PATCH`, GET filter, `serializeBriefDoc` keeps kind `client-brief`.
- `app/briefs/_lib/custom-briefs.js` - exact-id/exact-slug resolution for client briefs; `briefPrivacyHeaders`.
- `app/briefs/[clientId]/[briefSlug]/{route,pdf/route,og-image/route}.js` - `cache-control: no-store` + `X-Robots-Tag: noindex, nofollow` for client briefs.
- `app/api/dashboard/custom-briefs/vercel/route.js` - rejects client briefs (no Vercel side effects).
- `features/intelligence/_digest-brief-link.js`, `features/x-strategy/brief-bundle.js` - skip client briefs when picking the newest public brief.
- `components/dashboard/ClientBriefCard.jsx`, `DashboardPage.jsx`, `lib/dashboard/tile-config.js` (CUSTOM_DETAIL_CARD_IDS).

## Privacy
- Doc id AND `publicBriefSlug` = `client-brief-<YYYYMMDD>-<16 hex>` (64 random bits), never derived from the title.
- Public resolution of a client brief is by exact doc id / exact `publicBriefSlug` only; hyphen-variant and compacted-title fallbacks skip client briefs.
- `addToClientBrain` is forced false (no Client Brain ingest). No Vercel calls.
- Non-admins never receive client briefs from GET. Admins get them (public or not) only with `?kind=client-brief`; the default GET list keeps its previous shape (public, non-client-brief) so existing consumers are unchanged.
- OG label defaults to `HITLOOP` (not the owner's name).

## Unpublish semantics
- `PATCH { briefSlug, public:false }` (admin): sets `public:false`, deletes the stored PDF object (and the brief-runs prefixes), clears `pdfArtifact` / `pdfUrl`. The public page, `/pdf` and `/og-image` then 404.
- `PATCH { briefSlug, public:true }`: republish; the PDF re-renders lazily on the next `/pdf` request.
- `DELETE` (existing) still removes the doc, PDF artifacts and any brain references.
- Publish order: Firestore doc first, then the PDF, then the doc is updated with `pdfArtifact`/`pdfUrl`. A failed PDF is a warning (doc stays; `/pdf` renders lazily). A failed doc write renders no PDF.
- If unpublish cannot delete the stored PDF, the doc is still set `public:false` but keeps `pdfArtifact`/`pdfUrl` and the response carries a `warning`.
- DELETE resolves a client brief by exact id / exact public slug only.
- PDF is rendered at publish via `persistBriefPdfArtifact` in `edge-to-edge` mode; the `/pdf` route's lazy path works for this kind.

## MCP (owner server)
`publish_client_brief {clientId, text, title?}` / `unpublish_client_brief {clientId, briefSlug}` / `list_client_briefs {clientId}` (`features/mcp/tools/client-brief.js`) call this same route in-process with the owner's authorization and `?as=<clientId>`, then verify the response's `clientId` matches. Example prompt to ChatGPT (connected to `/api/mcp`): "Make a client brief for Not The Rug from this: <pasted breakdown>" -> returns the hosted URL and PDF link. Only on explicit request; text is client-facing.

## Tests (`node --test`, fakes only)
- `features/client-brief/__tests__/parse.test.js`, `render.test.js`, `publish.test.js`
- `app/api/dashboard/custom-briefs/__tests__/client-brief-route.test.js` (+ `next-server-stub-hooks.mjs`, test-only resolver for `next/server`)
- `features/x-strategy/__tests__/brief-bundle.test.js` (client-brief case)
- `features/mcp/__tests__/client-brief-tools.test.js` (MCP tools, fake route)
- Regression: `features/invoices/__tests__/*.test.js`, `features/leadgen/__tests__/*.test.js`

## Known limits
- The digest/bundle "newest public brief" queries are `limit(20)` then filtered, so 20+ newer public client briefs could hide an older ordinary brief.
- Not verified in a real browser or a real Browserless PDF render (no network/dev server in the build sandbox).
