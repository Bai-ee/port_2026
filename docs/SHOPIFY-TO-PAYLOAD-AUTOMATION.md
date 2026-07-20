# Runbook: Clone a Shopify site → local static mirror → Payload CMS on Turso

This document is a **reproducible spec** for another agent (or a script) to
automate what was done by hand for `rositas.com`. It has two independent
deliverables:

1. **Phase A — Static mirror**: an exact, offline copy of a live Shopify site
   with checkout/tracking stripped.
2. **Phase B — CMS rebuild**: a Payload 3 + Next.js site (database on **Turso /
   libSQL**) whose content is seeded from that site and editable in `/admin`.

Everything is parameterized so it generalizes to any Shopify storefront, with
Rosita's used as the worked example.

---

## 0. Inputs / parameters

Define these once; every step reads from them.

| Var | Rosita's value | Meaning |
|---|---|---|
| `TARGET_URL` | `https://rositas.com/` | Site to clone |
| `PAGES` | `/`, `/pages/menu-2`, `/pages/catering`, `/pages/history`, `/pages/contact`, `/pages/contact-us` | Pages to mirror (discover via sitemap/nav) |
| `BRAND` | teal `#2f4f59`, orange `#e4571e`, cream `#f3ece1`; fonts Lobster Two + Space Mono | Colors/fonts for the CMS frontend |
| `PROJECT` | `rositas` | Slug for output folders / DB name |

**Environment prerequisites** (verify before starting):
- Node 20+ (`node -v`), npm, `python3` with `pip`
- `pip install beautifulsoup4 requests pillow --break-system-packages`
- `pip install playwright` + a Chromium (for verification screenshots)
- Disk: static mirror ≈ 35 MB pre-compression; Payload `node_modules` ≈ 860 MB

---

## Phase A — Static mirror

### A1. Download the page HTML
`curl` each page in `PAGES` with a real desktop User-Agent into `raw-<slug>.html`.
All returned HTTP 200 for Rosita's. The theme was identified from the markup:
`Shopify.theme = {"name":"Crave", ...}` — useful for knowing asset paths.

### A2. Mirror assets + rewrite URLs — `mirror.py`
A Python script (BeautifulSoup + requests) that, for each page:
- Parses every asset reference: `link[href]`, `script[src]`, `img[src|srcset|data-src]`,
  `source[srcset]`, `video/audio[src|poster]`, inline `style` `url(...)`, `<style>` blocks.
- Normalizes URLs (`//` → `https:`, relative → absolute) and downloads only from an
  **allowlist of asset hosts** (`rositas.com`, `cdn.shopify.com`, `cdnjs.cloudflare.com`,
  `fonts.shopify*`, `fonts.g*`). External links (social, maps) are left intact.
- Saves each asset to `site/assets/<host>/<path>` (query strings hashed into the
  filename so `?v=` variants don't collide).
- **Recurses into CSS**: rewrites `url()` and `@import` inside every downloaded
  stylesheet and pulls those assets too (this is how the Lobster Two `@font-face`
  files got captured).
- Rewrites each tag/attribute to the local relative path and writes `soup-<slug>.html`.

Result for Rosita's: **211 assets**. Only failures were a bare preconnect host and a
non-existent `gsap.min.css` (harmless).

### A3. Rewrite internal links + strip checkout — `finalize.py`
For each `soup-*.html`:
- Rewrite internal `<a href="/pages/...">` → local `menu.html` / `history.html` / etc.
  (via a `PATH_TO_LOCAL` map). Unknown internal paths → `index.html`.
- **Neutralize commerce**: any href ending `/cart`, containing `/checkout`, or starting
  `/account` / `/challenge` → `href="#"` + `data-localized` marker.
- Forms with `action` containing `/cart` or `/checkout` → `action="#"`, `onsubmit="return false"`.
- `button[name=add]` / checkout buttons → `type=button`, `onclick="return false"`.

### A4. Remove phone-home scripts — `cleanup.py`
- Neutralize account/auth links (`customer_authentication`, `/account`).
- `decompose()` every `<script>` whose src/body matches an analytics/wallet killlist:
  `trekkie`, `portable-wallets` (Apple/Google Pay), `shop_events_listener`, `monorail`,
  `shop-cart-sync`, `web-pixels-manager`, `shopifycloud/storefront`, `consent-tracking`,
  `customer_authentication`. **Never** remove local `assets/…` theme scripts (they drive the UI).
- A second targeted pass removes the checkout ESM loader
  (`shop-js/loader.init-shop-cart-sync`, which dynamically imports 96+ missing checkout
  modules), the invalid `gsap.min.css` link, and the 0-byte theme `gsap.js`.

### A5. Fix a serialization artifact (gotcha)
BeautifulSoup's `html.parser` absorbed a trailing `<script src="…gsap.js">` **as text
inside** the preceding inline config script, which the browser then tried to parse as JS
→ `Uncaught SyntaxError: Unexpected identifier 'src'`. Fix: for any inline script whose
string contains `<script`, cut everything from `<script` onward
(`re.sub(r'<script[\s\S]*$', '', s.string)`).

### A6. Verify (automated gate)
Serve `site/` (`python3 -m http.server`) and load every page with Playwright headless.
**Acceptance = 0 console errors and 0 HTTP 4xx/5xx across all pages**, plus a click test
(visible nav link → correct local page) and a check that `data-localized` cart elements exist.
Full-page screenshots were compared against the live look.

### A7. Shrink to fit delivery
Images were 32.7 MB of ~34 MB. Recompress in place with Pillow (JPEG q=85 progressive;
large PNGs quantized to 256 colors) — filenames unchanged so references stay valid →
32.7 MB → 22.9 MB. Re-verify screenshots for artifacts, then `zip`.

**Phase A deliverable:** `rositas-local.zip` — `site/` + `serve.py` + `README.md`;
runs fully offline via `python3 serve.py` → `http://localhost:8000`.

---

## Phase B — Payload CMS on Turso

### B1. Extract structured content (the reusable data layer)
Three JSON files parsed from the mirror with BeautifulSoup:
- `menu-data.json` — walk `<h2>`/`<h3>` in document order; `<h2>` matching a known
  section list opens a section, **any other `<h2>` closes the current section**
  (this boundary rule is what stopped "Daily Specials" leaking into "Postres");
  each `<h3>` = item, description = first text sibling. → 8 sections, 66 items.
- `content-data.json` — site settings (name, tagline, phone, email, address, hours rows,
  social), home blurbs (hero, lunch specials, story), history paragraphs.
- `image-map.json` — content photos (`/cdn/shop/files|products/…`) in document order per
  page, so specific images can be assigned to hero/cards/history slots; `.heic` skipped
  (sharp/browsers can't render them reliably).

### B2. Scaffold Payload (gotcha: don't use the interactive CLI here)
`npx create-payload-app` requires a TTY and **hung/failed in the sandbox** even under
`script -qec`. **Resolution: build the project manually** — more reliable and gives full
control of the Turso adapter. Files created by hand:

- `package.json` (`"type":"module"`), deps pinned to **Payload 3.86.0** family +
  `@payloadcms/db-sqlite`, `@payloadcms/next`, `@payloadcms/richtext-lexical`,
  `@payloadcms/ui`, `next` (**must be ≥15.4.11** — Payload 3.86 peer range;
  15.4.4 fails `ERESOLVE`), `react`/`react-dom` 19.1.0, `sharp`, `tsx`, `cross-env`.
- `next.config.mjs` → `withPayload(nextConfig)`.
- `tsconfig.json` with paths `@/*` → `src/*` and `@payload-config` → `src/payload.config.ts`.
- Standard Payload App-Router boilerplate under `src/app/(payload)/`:
  `layout.tsx`, `admin/[[...segments]]/page.tsx` + `not-found.tsx`, `admin/importMap.js`,
  `api/[...slug]/route.ts`, `api/graphql/route.ts`, `api/graphql-playground/route.ts`,
  `custom.scss`. (These are copy-paste from the Payload blank template — stable per version.)

### B3. Data model
`src/payload.config.ts` wires collections + globals + the DB adapter.

**Collections:** `Users` (auth), `Media` (upload; `imageSizes` thumbnail/card/hero;
`staticDir` = `public/media`), `MenuSections` (title, order, subtitle),
`MenuItems` (name, `relationship`→section, description, price, order, `upload`→image).
**Globals:** `SiteSettings` (name/logo/contact/hours array/social),
`HomePage`, `HistoryPage`, `CateringPage`.

### B4. Turso / libSQL adapter (the key bit)
Payload's SQLite adapter is libSQL-based, so **the same config drives a local file OR
hosted Turso** — switch via env:
```ts
db: sqliteAdapter({
  client: {
    url: process.env.DATABASE_URI || 'file:./rositas.db',
    authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  },
}),
```
`.env` defaults to `file:./rositas.db` (offline). For cloud: `turso db create <name>`,
`turso db show --url`, `turso db tokens create` → set `DATABASE_URI=libsql://…` +
`DATABASE_AUTH_TOKEN`, then `npm run seed`.

### B5. Frontend (server components reading the DB)
`src/app/(frontend)/` — `layout.tsx` builds header + footer from `SiteSettings`;
`page.tsx` (home), `menu/`, `history/`, `catering/`, `contact/` each call
`getPayload({config})` → `findGlobal` / `find` and render. `styles.css` holds the brand
system (CSS vars + `next/font/google` Lobster Two + Space Mono). Media rendered via `doc.url`.

### B6. Seed — `src/seed.ts` (`npm run seed`)
Manually loads `.env` (tsx doesn't), `getPayload({config})`, then: create admin user
(`admin@rositas.local` / `changeme123`); wipe menu collections for idempotency; upload
images via `payload.create({collection:'media', filePath})` with a path→id cache;
`updateGlobal` for settings/home/history/catering; `create` sections then items.
Auto-creates the SQLite schema on first run (drizzle push).

### B7. Verify (automated gate)
`npm run dev`; curl `/ /menu /history /catering /contact /admin` → all **200**;
Playwright: screenshot frontend (0 errors), log into `/admin`, confirm Menu Items list
shows "1-…of 66" and Site Settings global is populated.

**Phase B deliverable:** `rositas-cms.zip` (excl. `node_modules`, `.next`) — ships a
pre-seeded `rositas.db` + `public/media`, so `npm install && npm run dev` works immediately.

---

## How to automate this end-to-end

Turn the manual runbook into a parameterized pipeline. Suggested shape:

```
clone-shopify.py --url $TARGET_URL --out ./$PROJECT
  ├─ discover_pages()        # parse /sitemap.xml + nav instead of a hardcoded list
  ├─ download_pages()        # A1
  ├─ mirror_assets()         # A2  (mirror.py logic as a module)
  ├─ finalize_links()        # A3
  ├─ strip_commerce()        # A4  (killlist as config)
  ├─ fix_inline_scripts()    # A5
  ├─ verify_static()         # A6  ← GATE: fail the run if errors>0
  └─ compress_and_zip()      # A7

build-cms.py --data ./$PROJECT --brand brand.json --db turso|file
  ├─ extract_content()       # B1  (section list + brand as params)
  ├─ scaffold_payload()      # B2  (write files from templates — NOT the CLI)
  ├─ write_models()          # B3
  ├─ write_frontend()        # B5  (brand.json drives colors/fonts)
  ├─ seed()                  # B6
  └─ verify_cms()            # B7  ← GATE
```

**Parameterize:** target URL, page-discovery, brand tokens, the section-title list
(or auto-derive from `<h2>`s), the commerce killlist, and DB target (file vs Turso).

**Multi-agent split** (if handing to a fleet):
- Agent 1 *Mirror* — Phase A, returns the static zip + a verify report.
- Agent 2 *Extract* — Phase B1, returns the three JSON files (schema-validated).
- Agent 3 *CMS build* — Phases B2–B6, returns the project.
- Agent 4 *Verify* (adversarial) — runs A6 + B7 gates independently; only pass if
  0 console errors, all routes 200, item count matches the extracted JSON.

**Gotchas to bake in as guards:**
1. Don't use `create-payload-app` in a headless/sandbox env — scaffold from templates.
2. Pin `next` to the Payload peer range (≥15.4.11 for 3.86) or `npm install` ERESOLVE-fails.
3. Skip `.heic` images (sharp/browser can't decode); prefer jpg/png.
4. The BeautifulSoup trailing-`<script>` artifact (A5) — always run the inline-script fix.
5. Keep the section-boundary rule (B1) or non-menu `<h2>` content leaks into the last section.
6. Recompress images in place (same filenames) so URL rewrites stay valid.
7. libSQL `file:./x.db` is cwd-relative — run seed and dev from the same project root.

---

## Artifact inventory (this run)

Static mirror scripts: `mirror.py`, `finalize.py`, `cleanup.py` (+ inline fixes).
Extracted data: `menu-data.json` (66 items/8 sections), `content-data.json`, `image-map.json`.
CMS project: `rositas-cms/` (Payload 3.86 + Next 15.4.11 + libSQL/Turso), seeded DB + media.
Deliverables: `rositas-local.zip` (offline static site), `rositas-cms.zip` (CMS).
