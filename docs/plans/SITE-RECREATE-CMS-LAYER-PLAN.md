# Site Recreate — CMS Layer (Payload + Turso) Plan

> **Status:** SHIPPED 2026-07-20 — but as the **exact-mirror overlay**, not the generic-blocks
> model this plan describes. Mid-execution the user rejected the rebuilt frontend ("the 3100
> version is different than the one we replicated") and directed: render the mirrored site
> itself and add the admin to IT. As-built truth = `docs/source-of-truth/SITE-RECREATE-CARD.md`
> § Phase 5 (tokenized `{{slot:…}}` templates + `lib/overlay.mjs` + a catch-all render route).
> The sections below are the original plan, kept for the scaffold/versions/gotchas that DID ship.
> Phase 5 of [`SITE-RECREATE-AUTOMATION-PLAN.md`](SITE-RECREATE-AUTOMATION-PLAN.md).
> **Source runbook:** [`docs/SHOPIFY-TO-PAYLOAD-AUTOMATION.md`](../SHOPIFY-TO-PAYLOAD-AUTOMATION.md) Phase B (proven manually on Rosita's).

## Objective

Every completed clone job gains a second deliverable: a **Payload 3 + Next.js project on
libSQL (local file by default, Turso via env)** seeded from the mirrored site, so the
user gets a `/admin` WYSIWYG to edit content. Downloadable as `cms.zip` from the card.

**Expectation (stated to user):** the CMS frontend is a brand-faithful editable rebuild
(content, images, colors, fonts) — NOT the pixel-exact theme. The static mirror remains
the exact deliverable. Same trade the manual Rosita's run made.

## Deltas from the runbook

- **Node, not Python** — extraction with cheerio, same engine repo (`services/site-clone/`).
- **Generic data model, not restaurant-specific** — runbook B3's MenuSections/MenuItems
  were Rosita's-vertical. Productized model works for any site:
  - Collections: `users` (auth), `media` (upload), `pages` (title, slug, `sections` blocks).
  - Blocks: `hero` (heading/subheading/image), `content` (richText), `imageBlock` (media+alt).
  - Global: `site-settings` (name, tagline, phone, email, address, social[], footerText, logo).
- **Deterministic extraction, no LLM** — headings/paragraphs/images walked in document
  order per page; settings from title/tel:/mailto:/social hrefs; brand colors from
  theme-color + CSS custom props; fonts from @font-face families. Zero Anthropic spend.
- Scaffold from **static templates** (`cms-template/`, `{{PLACEHOLDER}}` substitution) —
  runbook gotcha #1 (never `create-payload-app` headless). Versions pinned per runbook:
  Payload 3.86.0 family, next 15.4.11, react 19.1.0 (gotcha #2).

## Pieces

| Piece | File(s) |
|---|---|
| B1 extract | `services/site-clone/lib/extract.mjs` → `content-data.json`, `pages-data.json`, `image-map.json`, `brand.json` |
| B2–B5 scaffold | `services/site-clone/cms-template/` (package.json, payload.config.ts, (payload) boilerplate, (frontend) generic block renderer + brand CSS vars, seed.ts, README) |
| B6 orchestrate | `services/site-clone/build-cms.mjs` — `--job <id>` (or `--dir`+`--url`): extract → scaffold → copy media (skip `.heic`, gotcha #3) → write seed-data → zip (no node_modules) → Storage upload → job doc `cms:{storagePath,downloadUrl,bytes}` |
| B7 verify | `--verify` flag: npm install + seed + `next dev` + curl `/ /admin` all-200 gate; run once on Rosita's as acceptance |
| Card | `SiteRecreateCard.jsx` download panel: second button "Download CMS (editable)" when `job.cms.downloadUrl` |

Seeded rich text = minimal valid Lexical JSON (paragraph/text nodes). Frontend renders
blocks with a small serializer. Seed is idempotent (wipe pages/media first), admin user
`admin@<project>.local` / `changeme123`, creds + Turso switch documented in the zip README.
libSQL `file:` is cwd-relative (gotcha #7) — README pins all commands to project root.

## Out of scope (future)

- Theme-exact editable overlay (edit-in-place on the mirrored HTML).
- Hosted Turso provisioning + deploy automation (today: env-switch instructions only).
- LLM-assisted vertical models (menus, product catalogs) — needs cost instrumentation.
