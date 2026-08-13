# Creative Brief & Deliverables — Card Wiring Map

Last updated: 2026-06-23
Scope: the **Creative Brief** and **Deliverables** dashboard navigation buckets only. Locked buckets are listed for context but are out of launch scope. Verified against code, not prior docs.

## Navigation Model

- Bucket config: `DashboardPage.jsx` `CAP_STEPS` (~2256–2298), colors `CAP_BUCKET_COLOR` (Deliverables `#14b8a6`, Creative Brief `#2a2420`).
- Non-admin gating: `NON_ADMIN_LOCKED_NAV_KEYS` (~2240) locks every bucket except `deliverables`. `NON_ADMIN_UNLOCKED_STEPS = { deliverables: {0} }`.
- Non-admin card allowlist: `NON_ADMIN_UNLOCKED_CARD_IDS` (~2218–2235).
- Nav column DOM: `#capability-nav-col` (~11333); pinned static for non-admins via `capability-nav-col--static`.
- Card open handler: `openCapabilityCard()` (~4570–4624). Non-admins with a `deliverableAsset` open the full-screen overlay `#brief-fullscreen-overlay` (~11993); admins open the tile detail modal.

## Launch Card Inventory

| Bucket | Card | id | Component (DashboardPage.jsx) | Route/API | Data Source (`dashboard_state` unless noted) | On click | States | Status |
|---|---|---|---|---|---|---|---|---|
| Creative Brief + Deliverables | Creative Brief | `onboarding-brief` | ~8250–8282 | POST `/api/dashboard/creative-brief/run` | `briefSummaries.onboarding.summary`, `artifacts.homepageDeviceMockup`, `artifacts.fullPageScreenshots`, `siteMeta.ogImage`, `studioCaptures` (computed `creativeBriefReady`) | Full-screen brief HTML, or asset overlay (non-admin) | loading `marketingBriefRunning`; error `marketingBriefError`; empty "Run to build" | **real** (derived readiness flags) |
| Creative Brief | Executive/Market Brief | `marketing-brief` | ~8200–8249 | POST `/api/dashboard/marketing-brief/run` | `marketingBrief.headline`, `marketingBrief.content.x_post`; fallback labels from `briefSummaries.onboarding` | Named brief preview | loading/error as above | **real** |
| Deliverables | Video Promo | `mockup-studio` | ~7199–7246 | POST `/api/dashboard/studio-render` (RUN VIDEO) | `studioCaptures` (latest video) | Asset overlay (video) | loading `mockupStudioRenderLoading`; error `mockupStudioRenderError` | **real** |
| Deliverables | Social Preview | `social-preview` | ~7499–7541 | module runner | `siteMeta` (ogImage/title/desc) | Asset overlay (image) | empty "No site meta captured"; no explicit loading | **real** |
| Deliverables | Multi-Device Mock | `multi-device-view` | ~7585–7630 | module runner | `artifacts.homepageDeviceMockup` + `artifacts.fullPageScreenshots` | Asset overlay (carousel) | empty "Device view requires…"; no explicit loading | **real** |
| Deliverables | Full Page Images | `cross-device-images` | ~7631–7656 | module runner | `artifacts.fullPageScreenshots` (desktop/tablet/mobile) | Asset overlay (carousel); bulk download | empty same as above | **real** |
| Deliverables | Visual Audit / Brand Snapshot | `style-guide` | ~7248–7349 | module runner | `snapshot.visualIdentity.styleGuide` + `analyzerOutputs['design-evaluation']` | Admin detail modal; inspection only (no download) | empty "Run Visual Audit" | **real** (dual-source, see risk) |
| Deliverables | Post Me | `post-me` | ~7662–7708 | POST to X composer (client action) | composed from `studioCaptures` (video) + `siteMeta` (image) + `briefSummaries` (caption via `buildPostMeCaption` ~4737) | Footer buttons only (POST TO X, generate copy/video) | loading `postMeLoading`/`postMeCopyLoading`; inline status | **derived** (multi-source fallback chain) |

## Data-Source Notes / Risks

- **Single source of truth for cards is `dashboard_state`** delivered by `/api/dashboard/bootstrap`. Cards compute readiness locally; they do not double-read from `brief_runs` for the same field. Duplicate-source risk is low across the bucket.
- **`post-me` (medium-high):** caption falls through 4 sources (`buildPostMeCaption` ~4737–4751). If all empty the card renders blank. Behavior is intentional fallback, not a bug — monitor source availability.
- **`style-guide` (medium):** reads extracted tokens and analyzer verifications from two independent pipelines that can briefly diverge if the analyzer completes after extraction. Display-only; not launch-blocking.
- **Polling/subscriptions:** all `setInterval` and Firestore `onSnapshot` listeners in this surface clean up (studioCaptures listener ~4505 returns `unsub`; brief-run listener ~5932; bootstrap polls ~5278/5288 clear on unmount). **No leaked timers/subscriptions found.**

## Admin-only controls in this surface

- Brief tier gating: `briefCardLocked()` (~4629) via `BRIEF_TIER_ACCESS` from `features/scout-intake/brief-sections.cjs`.
- Admin-only cards adjacent to launch buckets: `email-digest`, `email-settings`, `create-client`, `gpu-render-service`, `submit-custom-brief` (~8285–8359). Non-admins never see the rich tile detail modal (gated at ~4602).

## UI Design-System Launch Checks

- Loading/empty/error states present on 7/8 launch cards; `social-preview` and `multi-device-view`/`cross-device-images` rely on empty-state copy rather than an explicit spinner (acceptable — data arrives via bootstrap, not an in-card fetch).
- Non-admin view is coherent: only Deliverables is interactive; admin-only actions are hidden, not merely disabled.
- Deliverable overlay supports single-asset download and per-item download for carousels; missing-asset cards show explicit empty copy rather than broken thumbnails.
- Minor polish (non-blocking): deliverable overlay has no back/breadcrumb affordance; close is background-click or close button only.

See [LAUNCH-DATA-PIPELINE.md](LAUNCH-DATA-PIPELINE.md) for how this data is produced and [ADMIN-DASHBOARD-DATA-MAP.md](ADMIN-DASHBOARD-DATA-MAP.md) for admin visibility.

---

# Card ⇄ Pipeline Data Contract

This is the part that makes change/add efficient: the full trace from "what produces the data" to "what renders it." **`cardId` is the single join key across the whole system** — the same string names the module that runs, the projection branch that writes `dashboard_state`, and the card that reads it.

## The 4-layer chain (per card)

1. **Define** — `features/scout-intake/module-registry.js` `REGISTRY[cardId]` declares `dependencies` (pipeline steps) + `tech` (services) + `foundational`.
2. **Run** — `features/scout-intake/runner.js` executes the module → `{ cardId, ok, result }`.
3. **Write (project)** — `api/_lib/run-lifecycle.cjs:822` `projectModuleResult()` switches on `result.cardId` and writes a specific `dashboard_state` path.
4. **Read (render)** — `DashboardPage.jsx` card with matching `id` reads that `dashboard_state` path.

## Three producer paths

Not every card comes from the scout module pipeline. There are exactly three producers writing into `dashboard_state`:

- **A — Scout module pipeline** (`run-lifecycle.cjs:822 projectModuleResult`): most deliverable cards.
- **B — Studio render pipeline** (`api/_lib/studio-render-core.cjs:27 appendCaptureRef`): writes `dashboard_state.studioCaptures`. Feeds Video Promo + Post Me video.
- **C — Brief summarizer** (`features/scout-intake/brief-summarizer.js`): writes `dashboard_state.briefSummaries[type]` and `marketingBrief`. Feeds Creative Brief + Executive Brief.

## Per-card trace (verified `file:line`)

| Card (`id`) | Producer | Module def | Write location → `dashboard_state` path | Card reads |
|---|---|---|---|---|
| `multi-device-view` | A | `module-registry.js:4` (deps: site-fetch, screenshots, device-mockup) | `run-lifecycle.cjs:825` → `projectScreenshotArtifacts :784` → `artifacts.homepageScreenshot` / `homepageScreenshots` / `fullPageScreenshots` / `homepageDeviceMockup` | `artifacts.homepageDeviceMockup` + `fullPageScreenshots` |
| `cross-device-images` | A (no own module) | — reuses `multi-device-view` output | same as above (`fullPageScreenshots`) | `artifacts.fullPageScreenshots` |
| `social-preview` | A | `module-registry.js:14` (deps: site-fetch, site-meta) | `projectModuleResult` → `siteMeta` + `onboard.socialPreview`; also `evidence` (page crawl, see below) | `siteMeta` |
| `style-guide` | A | `module-registry.js:44` (deps: design-system-extractor, style-guide-synthesizer) | `run-lifecycle.cjs:841` → `snapshot.visualIdentity.styleGuide`; verifications via `design-evaluation` → `analyzerOutputs['design-evaluation']` (`:849`) | `snapshot.visualIdentity.styleGuide` + `analyzerOutputs['design-evaluation']` |
| `mockup-studio` (Video Promo) | B | — (studio recipe, not a scout module) | `studio-render-core.cjs:37 appendCaptureRef` → `studioCaptures` | `studioCaptures` (latest video) |
| `post-me` | B + C (derived) | — | reads B `studioCaptures` + C `briefSummaries` + `siteMeta`; composed in-card `buildPostMeCaption` ~`DashboardPage.jsx:4737` | composed |
| `onboarding-brief` (Creative Brief) | C | — | `brief-summarizer.js` → `briefSummaries.onboarding`; readiness also keys off A artifacts + B studioCaptures | `briefSummaries.onboarding` + artifacts + studioCaptures |
| `marketing-brief` (Executive Brief) | C | — | scout-brief pipeline → `marketingBrief` | `marketingBrief.*` |

### What the Creative Brief is allowed to call "missing" (2026-08-12)

The Creative Brief cover (`briefSummaries.onboarding`) is the only brief that makes claims about what a client's site does or does not have, so its evidence bundle is built differently from every other composition. Three things feed it, and all three had to be fixed together:

1. **Page content** — `dashboard_state.evidence` (h1/h2/nav/CTA/body/social/contact per page). Previously the summarizer's data bag never included it (`brief-summary-runner.mjs`), so the brief saw only meta tags plus one-line module roll-ups and reported real on-page CTAs, copy and social links as absent from the site. The bag now passes `evidence` + `modules`, and `buildBriefSummaryEvidence` emits a `## site-content` block for `onboarding` only — every other brief type is byte-identical.
2. **Where that evidence comes from on a signup run** — the narrow Creative Brief run (`trigger: 'signup' | 'creative-brief'`) runs only `multi-device-view` + `social-preview` (`app/api/worker/run-brief/route.js`), so `runIntakePipeline`'s crawl never happens. `social-preview` already fetches the page for its meta tags; it now returns the trimmed crawl on its envelope as `siteEvidence` and `projectModuleResult` writes it to `dashboard_state.evidence`. Envelope-only — `updateModuleState` persists a fixed field set, so it never lands inside `modules['social-preview']`.
3. **Captured vs missing** — a `## CAPTURE STATUS` block states whether the crawl ran, came back thin (JS-rendered site), or never ran, plus which modules failed or never ran. The system prompt forbids reporting a non-captured input as a site gap. ⚠️ A JS-rendered site (client-rendered SPA) yields a `thin` crawl no matter what — the brief will correctly say "not captured", but reading those sites needs a rendered/browserless fetch, which is not built.

Rule of thumb when editing any of this: something is only "missing from the site" when the input that would have found it ran successfully and came back empty.

> Note the asymmetry: `style-guide`/`design-evaluation` both write `snapshot.visualIdentity.styleGuide` (the second keeps it in sync — `run-lifecycle.cjs:851`), which is the "dual-source" divergence risk noted above. The projection uses `ref.update()` with dot-paths (not `set(merge)`) so a `snapshot.*` write doesn't wipe sibling fields like `snapshot.brandOverview` — see the comment at `run-lifecycle.cjs:818`.

## Recipes

**To add a new Deliverables card backed by a scout module:**
1. Add `REGISTRY['my-card'] = { cardId, dependencies, tech, foundational }` in `module-registry.js`.
2. Implement the module so `runner.js` returns `{ cardId: 'my-card', ok, result }`.
3. Add a `if (result.cardId === 'my-card')` branch in `projectModuleResult` (`run-lifecycle.cjs:822`) writing your `dashboard_state` path.
4. Add the card object (`id: 'my-card'`) in `DashboardPage.jsx` reading that path; add the id to `NON_ADMIN_UNLOCKED_CARD_IDS` (`:2218`) if client-visible, and to the right `CAP_STEPS` bucket (`:2256`).
5. If it's a downloadable deliverable, populate `deliverableAsset` so the overlay opens.

**To change where a card gets its data:** change the write path in step 3 and the read in step 4 together — they must reference the same `dashboard_state` key. Nothing else reads across them.

**To add a video/image deliverable (path B):** no module needed — emit a capture via `appendCaptureRef` (`studio-render-core.cjs:27`) and read `studioCaptures` in the card.

This contract is the efficient-change guarantee: one join key (`cardId`), one write switch (`projectModuleResult`), one read site (the card). If you touch a field, grep the field name to find both ends.
