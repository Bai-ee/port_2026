# Client Brief (on-demand, forwardable) — plan

Status: DRAFT for Bryan's approval. Branch `feat/client-brief`, worktree `~/Documents/Repos/Bballi_Portfolio-clientbrief` (off origin/main 7c643220). Nothing built yet.

## Objective
One click (per client) produces a client-facing brief of the same info ChatGPT pulls daily over MCP, rendered in the Invoice Studio document look, published to a hosted URL Bryan can forward, with a PDF download. Admin only, on demand, no schedule.

## What ChatGPT actually reads each day (prod `mcp_audit`, last 14 days, ~14:00 UTC)
- **Not The Rug** via client MCP (`/api/client-mcp`, `features/client-mcp/tools.js`): `get_daily_update` (opener), `get_site_stats`, `get_visitor_sessions`, `get_leads`, `get_email_captures`, `get_applicants`, `get_content_calendar`.
- **Critters Quest** (`paradice-dbBQCHUX`) and **Hitloop** (`bryan-balli-WUoltG84`) via owner MCP (`/api/mcp`): `get_daily_brief`, `get_client_overview`, `strategy_get_calendar`, `strategy_get_brief`.
- So "across clients" today = 3 clients, 2 different MCP shapes. Only clients with a row in `features/client-mcp/data-sources.json` have website numbers (NTR = nottherug.com/api/stats; Hitloop = UE site via HITLOOP analytics).

## Current relevant architecture
- **Client-safe builder already exists:** `get_daily_update` composes site stats (today/yesterday/7d) + marketing status + scheduled posts + latest brief blurb, written to never mention HITLOOP or other clients. Its pieces (`fetchSiteStats`, `siteUpdate`, `readPosts`, `readTodayPlan`, `projectBrief`) are the right source.
- **Owner `get_daily_brief`** (`features/mcp/tools/playbook.js`) is internal (suggestions, proposal cards, freshness) — NOT client-facing. Use only its today-plan/queue numbers.
- **Invoice publish = Briefs bucket storage:** `POST /api/dashboard/custom-briefs` (`verifyAdminRequest`, kind `invoice`) renders with `renderInvoiceDocument` (`features/invoices/render.js`, shared `BRIEF_CSS` + themes) and writes `clients/{id}/custom_briefs/{doc}`. Public page `/briefs/<clientSlug>/<briefSlug>` (only when `public: true`), PDF `/briefs/.../pdf` (Browserless, cached to Storage as `pdfArtifact`, invoice single-page mode), OG image route, DELETE removes doc + Storage + KB refs.
- **Dashboard:** `invoice-builder` card is `category: 'admin'` (Admin bucket, admin-only nav key). Briefs bucket = `marketing-brief` / `onboarding-brief` / `past-briefs`.

## Proposed direction
- **Where it lives: Admin bucket**, new card `client-brief` ("CLIENT BRIEF") next to Invoice Builder. Reason: admin-only, on-demand, cross-client (client picker inside the card), same as invoices. Published briefs are stored in the same `custom_briefs` collection (new kind `client-brief`), so they also appear under that client's saved briefs list without a second UI. The Briefs bucket is client-facing (non-admins see it) — wrong home for a cross-client admin tool.
- **Data per client (all free reads):**
  1. Website (if a source row exists): visits/leads today + yesterday, 7-day booked/inquiries/applicants, top sources/pages, from the `get_daily_update` + `get_site_stats` builders. **Counts only — no lead names/emails/phones in the brief** (PII; forwarding a URL must not leak people data).
  2. Marketing: latest brief headline/summary + age (`dashboard_state.projectBrief`), posts out last 7 days, scheduled next 7 days (count + next 3 excerpts), today's plan tracks.
  3. Optional "Notes from HITLOOP" free-text box Bryan types before publishing.
  Clients without a site source (e.g. Critters Quest) get the marketing sections only; null numbers print "n/a", never 0.
- **Format:** same document shell as the invoice (cover/hero, facts, stat blocks, theme, fonts, brand mark, contact footer, print CSS). Add `renderClientBriefDocument(model, options)` in `features/client-brief/render.js` that reuses the invoice primitives. Requires a small extraction of shared helpers (`esc`, `hero`, `block`, `facts`, `stat`, CSS) out of `features/invoices/render.js` into `features/documents/` — **invoice output must stay byte-identical (existing golden fixture test is the guard).**
- **Generation: deterministic, no LLM.** Template wording from numbers + the stored brief headline. LLM cost $0. Only cost = one Browserless PDF render on first PDF download (existing per-render cost, same as invoices). No X API, no paid syncs.
- **Hosted URL:** reuse custom-briefs publish + `/briefs/...` routes. `publicBriefSlug` = `<client>-brief-<YYYY-MM-DD>-<16 hex from crypto.randomBytes>` (unguessable). `noindex,nofollow` meta + `X-Robots-Tag` for kind `client-brief`; no OG image fetch of private numbers beyond title. **Revoke:** Unpublish (set `public:false`, 404 immediately, PDF route too) and Delete (existing DELETE). Snapshot is frozen at publish time (stored HTML), so a forwarded link never changes.
- **PDF:** existing `/pdf` route; add `client-brief` to the paginated mode (A4/Letter pages, not invoice single-page).
- **Admin gating:** POST/DELETE already `verifyAdminRequest`; new preview route `POST /api/admin/client-brief/preview` (admin, returns HTML, writes nothing); card is `category: 'admin'`.
- **Optional later (not in this plan's build):** an owner-MCP tool so ChatGPT can ask "make the NTR brief" → creates a proposal card Bryan confirms (MCP stays write-free).

## Keep vs change
- Keep: invoice renderer output, custom-briefs storage/public/PDF routes, client MCP + owner MCP tools (untouched), Briefs bucket.
- Change: extract shared document helpers; add kind `client-brief` to custom-briefs POST + PDF mode + noindex; new builder/renderer/card.

## Files likely involved
`features/client-brief/{data.js,render.js}` (new), `features/documents/*` (new, extracted), `features/invoices/render.js` (import from shared), `features/client-mcp/tools.js` (export builders only, no behavior change), `app/api/admin/client-brief/preview/route.js` (new), `app/api/dashboard/custom-briefs/route.js`, `app/briefs/[clientId]/[briefSlug]/{route.js,pdf/route.js}`, `DashboardPage.jsx` (card def + panel `#admin-client-brief-panel`), `components/dashboard/admin/ClientBriefCard.jsx` (new), tests, SSOT `docs/source-of-truth/CLIENT-BRIEF.md`.

## Risks
- Shell extraction could change invoice bytes → golden test must pass unchanged before anything else.
- PII: people data must never reach the brief; test asserts no email/phone fields in the model.
- Wrong-client data: builder takes one clientId; test that site source is resolved per clientId (NTR has two client ids mapped to one site).
- Localhost uses prod creds: preview reads prod (fine); **publish writes prod Firestore/Storage → needs Bryan's OK even for a test**. Tests use mocks/emulated deps only.
- Brief numbers fetched live from nottherug.com at preview time; a site outage → section says "not available", never zeros.

## Tests
Unit: data builder (null-not-zero, no PII keys, per-client source, no-site client), renderer (snapshot, escapes, theme), slug entropy + noindex, custom-briefs POST kind `client-brief` (mocked admin + Firestore), unpublish → 404, invoice golden fixture unchanged. Full `npm test` vs baseline (7451 pass / 77 known fails). `smoke:routes`.

## Recommended phase order (stop for approval + Fable review after each)
- **P1 Data builder + renderer (no UI, no routes):** extract shared shell (invoice byte-identical), `buildClientBriefModel(clientId)`, `renderClientBriefDocument`. Output: local HTML samples rendered from mocked data for Bryan to eyeball.
- **P2 Routes:** admin preview route; custom-briefs kind `client-brief` (random slug, noindex, paginated PDF, unpublish). Tests only, no prod writes.
- **P3 Admin card UI:** client picker → preview → notes → Publish → copy URL / Download PDF / Unpublish. Localhost check with preview only.
- **P4 Rollout (each step needs Bryan's OK):** one real publish for NTR on localhost (prod write) → Bryan reviews link + PDF → PR → merge → deploy. Nothing is sent to a client by us; Bryan forwards.
- P5 (optional, separate approval): owner-MCP "propose client brief" card.

## Approval needed
1. Admin bucket card (vs Briefs bucket). 2. Counts-only, no people data. 3. No LLM (template wording). 4. Start P1.
