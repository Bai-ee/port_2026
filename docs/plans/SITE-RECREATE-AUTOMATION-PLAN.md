# Site Recreate Automation — Implementation Plan

> **Status:** PLAN — awaiting approval. Implementer: Sonnet thread, one phase at a time.
> **Source runbook (frozen reference):** [`docs/SHOPIFY-TO-PAYLOAD-AUTOMATION.md`](../SHOPIFY-TO-PAYLOAD-AUTOMATION.md) — the proven manual process (Rosita's, Shopify). This plan productizes it.
> **Accuracy bar:** the Rosita's run — 211 assets, 0 console errors, pixel-faithful. Every automated run must hit the same A6 verification gate.

---

## Objective

Let a user (initially: admin on the user's behalf) submit a live site URL (Shopify / Squarespace / Wix / generic static), and get back:

1. An **exact static recreation** — same pages, same images, same copy, checkout/tracking stripped.
2. A **live preview** of the recreated site they can browse.
3. A **downloadable zip** of the static site.
4. An **upsell CTA** — contact Bryan / a human for DNS transfer + hosting.
5. (Later phase) A **Payload CMS** layer on top so content becomes editable.

Managed from a **new card in the `website` bucket**. v1 scope = recreation + preview + download + upsell. Payload and DNS automation are explicitly later phases.

---

## Current relevant architecture (reuse, don't rebuild)

| Existing piece | Where | Reuse as |
|---|---|---|
| `website` bucket | `DashboardPage.jsx` card defs (`category: 'website'`, ~L7576+) | Home for the new card |
| Card recipe | `docs/source-of-truth/CREATIVE-BRIEF-DELIVERABLES-WIRING.md` § how to add a card | Follow exactly (cardId join key, `CUSTOM_DETAIL_CARD_IDS`, component in `components/dashboard/`) |
| Durable job queue + external-worker lease | `api/_lib/media-jobs.cjs` (`media_jobs`, queued→processing→done/failed, lease + backoff) | Template for `clone_jobs` — same lifecycle, new collection |
| External-worker bridge model | EditVideos bridge (`editvideos-bridge.cjs` + reconcile) | Pattern proof: heavy work runs OUTSIDE Vercel; Vercel owns only the job record + status |
| Cloud Run service scaffold | `services/studio-render/` (Dockerfile, `deploy-cloud-run.sh`, `server.mjs`, Playwright/Chromium in-container) | Template for `services/site-clone/` (no GPU needed) |
| URL safety | `api/_lib/safe-fetch.cjs` `validateUrl` | SSRF guard on every submitted URL |
| Artifact storage | `api/_lib/storage-artifacts.cjs` `saveBufferArtifact` | Zip + verify-report storage (client-scoped paths) |
| Static deploy to Vercel via API | `api/_lib/vercel-briefs.cjs` (`hitloop-<slug>-<hash>` projects, `VERCEL_AUTH_TOKEN`) | Template for publishing the recreated site as a live preview URL |
| Shared run terminal + minimized chip | `runWithTerminal` / `#run-active-indicator-chip` in `DashboardPage.jsx` (Email Digest SSOT §5b) | Run UX for clone jobs — do NOT invent a new terminal |
| Screenshot capture | `api/_lib/browserless.cjs` | Fallback preview (before/after screenshots) if Vercel deploy path is deferred |

**Cost note:** Phase A pipeline is pure mechanical (no LLM) → zero Anthropic spend, nothing to instrument with `logAnthropicCall`. If a later phase adds LLM extraction (Payload seeding), it MUST be instrumented per `OPERATING-COST-CARD.md`.

---

## Proposed direction

**One sentence:** port the runbook's Phase A into a parameterized Node pipeline (`services/site-clone/`), drive it through a `media_jobs`-style Firestore queue from a new `site-recreate` card, publish results as a Vercel preview + Storage zip, and defer Payload (Phase B) to its own workstream.

### Engine: Node, not Python

The runbook used Python (BeautifulSoup/Pillow/Playwright). The repo is Node; the worker should be too:
- HTML parse/rewrite: `cheerio` (BeautifulSoup equivalent; **new dep, worker-only** — lives in `services/site-clone/package.json`, never in the main app deps).
- Downloads: native `fetch`/`undici`.
- Image recompress: `sharp` (already used by Payload/repo ecosystem).
- Verify: Playwright (already in the studio-render container pattern).

Guard against the runbook's A5 serialization gotcha in the Node port too: after serialization, scan inline scripts for embedded `<script` text and truncate (`s.replace(/<script[\s\S]*$/, '')`) — cheerio can reproduce the same class of artifact.

### Platform profiles (generalize beyond Shopify)

`services/site-clone/profiles/*.json` — one per platform + `generic`:

```jsonc
{
  "platform": "shopify",
  "detect": ["Shopify.theme", "cdn.shopify.com"],        // markers in fetched HTML
  "renderMode": "static",                                 // static = curl HTML is complete
  "assetHosts": ["{origin}", "cdn.shopify.com", "cdnjs.cloudflare.com", "fonts.shopify*", "fonts.g*"],
  "commerceKilllist": ["trekkie", "portable-wallets", "shop_events_listener", "monorail",
    "shop-cart-sync", "web-pixels-manager", "shopifycloud/storefront", "consent-tracking",
    "customer_authentication", "shop-js/loader.init-shop-cart-sync"],
  "commerceHrefPatterns": ["/cart", "/checkout", "/account", "/challenge"],
  "pageDiscovery": ["sitemap", "nav"]
}
```

- **Shopify** → direct port of the runbook killlist/hosts. `renderMode: "static"`.
- **Squarespace / Wix** → `renderMode: "rendered"`: fetch pages via Playwright `page.content()` (these platforms are JS-rendered; raw curl HTML is incomplete). Killlists: Squarespace analytics/commerce beacons; Wix `thunderbolt` runtime scripts that phone home. These two profiles will need iteration on a real target site — build them minimal, tune on first real run.
- **generic** → allowlist = origin only + common CDN/font hosts, empty killlist, `renderMode: "rendered"` (safest default).

Detection: fetch the homepage once, match `detect` markers, fall back to `generic`. Store the detected platform on the job doc.

### Pipeline stages (direct port of the runbook's automation sketch)

```
runClone(job)
  ├─ discoverPages()      # sitemap.xml + nav parse; cap page count (default 15)
  ├─ downloadPages()      # A1 — curl-equivalent or Playwright per renderMode
  ├─ mirrorAssets()       # A2 — allowlist hosts, query-hash filenames, CSS url()/@import recursion
  ├─ finalizeLinks()      # A3 — internal hrefs → local files; commerce hrefs → "#" + data-localized
  ├─ stripScripts()       # A4 — killlist decompose; NEVER touch local theme assets
  ├─ fixInlineScripts()   # A5 — trailing-<script>-in-inline-script truncation guard
  ├─ verifyStatic()       # A6 — GATE: serve site/, Playwright every page: 0 console errors,
  │                       #      0 4xx/5xx, nav click test, data-localized present.
  │                       #      Gate fail ⇒ job `failed` with the report attached. No silent pass.
  ├─ compressImages()     # A7 — sharp in place, SAME filenames (references stay valid)
  └─ packageAndPublish()  # zip → Storage; site/ → Vercel preview deploy; report → job doc
```

Every stage appends a line to `job.log[]` (timestamped) — this is what streams into the shared run terminal.

### Data model

`clone_jobs/{jobId}` (new collection; clone of `media_jobs` shape — reuse its lease/backoff mechanics, do not fork the logic loosely):

```
{ jobId, clientId, targetUrl, platform, status: queued|processing|verifying|done|failed,
  attempts, leaseExpiresAt, createdAt/updatedAt,
  ownershipAttested: bool,          // user confirmed they own/control the site
  pages: [{path, localFile}], assetCount, totalBytes,
  verifyReport: {consoleErrors, httpErrors, pagesChecked, pass},
  zip: {storagePath, downloadUrl, bytes},
  preview: {vercelUrl, deploymentId} | {screenshots: [...]},   // fallback shape
  log: [{t, line}], error }
```

Storage paths (client-scoped, matching repo convention):
`clients/{clientId}/site-clone/{jobId}/site.zip` and `.../verify-report.json`.

### Card: `site-recreate` (website bucket)

- Card def in `DashboardPage.jsx`: `id: 'site-recreate'`, `category: 'website'`, label `SITE RECREATE` (suggest number `SR`, title "Recreate My Site"). Add to `CUSTOM_DETAIL_CARD_IDS` (single top panel, no generic tabs — Copywriter pattern).
- Component: `components/dashboard/SiteRecreateCard.jsx`, white-theme single-column per `public/docs/dashboard-modal-component-style-guide.html`. **Mobile width standard applies** (mount in the standard container, no extra horizontal padding ≤480px).
- Sections (top → bottom), each with a stable DOM id:
  1. `#site-recreate-url-input-row` — URL input + detected-platform chip + **ownership attestation checkbox** (required) + RECREATE button.
  2. `#site-recreate-run-status-panel` — job status from a Firestore listener on the job doc; live log lines route through the shared `runWithTerminal` overlay (prop-drilled like `AdminEmailDigestView`); closing mid-run minimizes to the existing `#run-active-indicator-chip`.
  3. `#site-recreate-preview-panel` — iframe of `preview.vercelUrl` (or screenshot strip fallback) + "Open in new tab".
  4. `#site-recreate-download-row` — DOWNLOAD ZIP (signed URL) + verify-report summary line ("6 pages · 211 assets · 0 errors").
  5. `#site-recreate-upsell-panel` — "Ready to go live? A human transfers your DNS and hosts this for you." → contact CTA (mailto Bryan v1; reuse the digest `contactHuman` copy pattern).
- Job creation is **admin-gated in v1** (mutations admin-only, reads open — Media Library pattern). Non-admins see the card + any existing results read-only. Lifting the gate is a later, deliberate step (spend/abuse surface).

### API route

`app/api/dashboard/site-clone/route.js` — actions:
- `create` — `validateUrl` (SSRF guard), require `ownershipAttested`, write `clone_jobs` doc `queued`. Admin-gated.
- `status` / `list` — job doc reads for the card.
- `download` — mint signed URL for the zip.
- (Phase 4) `lease` / `complete` — worker endpoints, shared-secret header, mirroring the EditVideos bridge contract.

**Nothing heavy runs in Vercel.** The route only manages job records.

### Where the worker runs (phased)

- **Phase 2:** local CLI — `node services/site-clone/run-clone.mjs --job <id>` (or `--url` for ad-hoc). Leases from Firestore exactly like the EditVideos worker. Admin runs it on submit. This proves the engine before any deploy.
- **Phase 4:** containerize with the `studio-render` Dockerfile/deploy pattern → Cloud Run (CPU-only, no GPU); triggered per-job. Submit → done with zero human touch.

---

## Keep vs change

**Keep untouched:** all existing website-bucket cards; browserless capture flows; `vercel-briefs.cjs` behavior for briefs (extend via a sibling module, don't modify its brief paths); `media_jobs`; anything Payload-related in the runbook (Phase B untouched in v1).

**New:** `site-recreate` card + component; `clone_jobs` collection + `api/_lib/clone-jobs.cjs`; `app/api/dashboard/site-clone/route.js`; `services/site-clone/` (engine + profiles + CLI); `api/_lib/site-clone-publish.cjs` (Vercel static deploy, modeled on vercel-briefs).

**Change (minimal):** `DashboardPage.jsx` — card def + `CUSTOM_DETAIL_CARD_IDS` + component mount + terminal prop-drill. That's the whole diff surface in the main app.

---

## Files likely involved

| File | Phase | New/Edit |
|---|---|---|
| `DashboardPage.jsx` (card def, custom-card wiring) | 1 | Edit |
| `components/dashboard/SiteRecreateCard.jsx` | 1 | New |
| `api/_lib/clone-jobs.cjs` (+ `__tests__/clone-jobs.test.js`) | 1 | New |
| `app/api/dashboard/site-clone/route.js` | 1 | New |
| `services/site-clone/` — `run-clone.mjs`, `lib/{discover,mirror,finalize,strip,verify,compress,package}.mjs`, `profiles/*.json`, `package.json` | 2 | New |
| `api/_lib/site-clone-publish.cjs` | 3 | New |
| `services/site-clone/{Dockerfile,deploy-cloud-run.sh,server.mjs}` | 4 | New |
| `docs/source-of-truth/SITE-RECREATE-CARD.md` (SSOT, written as-built at end of Phase 3) | 3 | New |

---

## Risks

1. **Legal/abuse — cloning arbitrary sites.** Mitigations: ownership attestation required on every job; admin-gated creation in v1; `validateUrl` SSRF guard; per-client job cap. This is the reason v1 stays admin-gated.
2. **JS-rendered platforms (Wix/Squarespace) won't match Shopify fidelity on day one.** The runbook proved Shopify only. `renderMode: "rendered"` + generic profile is the safety net; expect profile tuning per platform on first real targets. Ship Shopify-accurate first, treat other platforms as "best effort until tuned."
3. **Verify gate false failures** — third-party scripts that survive the killlist can 4xx offline. The A6 gate must attach the full report on failure so tuning the killlist is a data-driven loop, not guesswork.
4. **Vercel preview deploy limits** — ~23MB/200+ files per site is fine for the deployment API, but many jobs accumulate projects. Name-hash per client+job, and delete the preview project when a job is re-run. Screenshot fallback exists if this path stalls.
5. **Asset-size blowups** — a media-heavy target could be hundreds of MB. Hard caps in the engine: max pages (15), max total bytes (150MB), max single asset (25MB); exceeding → fail with a clear log line, never a silent partial mirror.
6. **`services/site-clone` deps leaking into the main build** — cheerio/playwright live only in the worker's own `package.json`; the Vercel app never imports from `services/`. (Same trap class as the GBP CJS/ESM split.)
7. **Payload scope creep.** Phase B (CMS) is a real second product. This plan deliberately fences it to Phase 5+ with its own plan doc; the extraction step likely needs LLM help to generalize beyond restaurant menus (→ cost instrumentation required).

---

## Recommended phase order

Each phase stops for approval before the next.

- **Phase 1 — Card + job plumbing (main app only).** Card def, `SiteRecreateCard.jsx`, `clone-jobs.cjs` + tests, `site-clone` route (`create`/`status`/`list`). Jobs sit `queued`. Verify: card renders both buckets/viewports, job doc appears, non-admin is read-only. No engine yet.
- **Phase 2 — Clone engine (local CLI).** `services/site-clone/` full A1–A7 port + Shopify/generic profiles + the A6 gate. Acceptance: **re-run Rosita's end-to-end and match the runbook — all pages, ~211 assets, 0 console errors, working zip.** This is the fidelity challenge; do not proceed until it passes.
- **Phase 3 — Delivery UX.** `site-clone-publish.cjs` Vercel preview deploy; card preview iframe + download + verify summary + upsell CTA; write the SSOT doc as-built. Acceptance: submit URL → (admin runs CLI) → preview + zip + CTA visible in the card.
- **Phase 4 — Full automation.** Containerize on the studio-render pattern → Cloud Run; `lease`/`complete` worker contract; submit-to-done untouched. Acceptance: job completes with no human step.
- **Phase 5 (separate workstream, own plan doc) — Payload layer.** Runbook Phase B: extraction generalization (likely LLM-assisted → `logAnthropicCall`), template scaffold (never `create-payload-app` headless), Turso option, seeded-CMS zip as a second deliverable. Not started until Phases 1–4 are stable.
- **Phase 6 (future) — self-serve + DNS.** Lift admin gate behind pricing/limits; automate the DNS/hosting handoff currently served by the upsell CTA.

---

## Approval recommendation

Approve Phases 1–3 as the v1 commitment (card → proven engine → delivery UX); Phase 4 when engine fidelity is trusted; Phase 5 gets its own plan later. Start with **Phase 1 only**.
