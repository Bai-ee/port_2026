# FABLE 5 — REPO MANIFEST

Orientation map. Verify against actual files; do not trust blindly.

## STACK
Next.js 16 (app router, --webpack), React 19, Firebase (client SDK + firebase-admin),
Anthropic SDK, googleapis, twitter-api-v2, Three.js 0.165 + @react-three/* +
three-stdlib, GSAP, motion. Node test runner. Deploy: Vercel (vercel.json).

## TRUST-BOUNDARY FILES (audit these first)
- `middleware.js` — NOTE: ONLY does markdown content-negotiation rewrites
  (`Accept: text/markdown` → `/md/*.md`). It is NOT an auth gate. Do not assume
  routes are protected by middleware.
- `firebase.js` — Firebase CLIENT config/init (runs in browser bundle — check for
  leaked admin creds / over-broad config).
- `firestore.rules` (77 ln) — the real client-side data authz. Audit every rule for
  multi-tenant leakage; cross-check against server routes.
- `firestore.indexes.json` — query shape; flag unbounded/un-indexed reads.
- `.env.example` — declares expected secrets; confirm none are `NEXT_PUBLIC_*` that
  shouldn't be, and none hardcoded elsewhere.

**Auth model:** firebase-admin is imported PER-ROUTE (no shared auth middleware).
~30+ `route.js` files call firebase-admin / verifyIdToken / getFirestore directly.
→ Highest risk: routes that forget the token check, or trust a client-supplied
`clientId`/tenant id without verifying ownership (IDOR / cross-tenant access).

## API ROUTE GROUPS (app/api/*) — server trust surface
- `account/` — delete, update-client (destructive; verify owner)
- `admin/` — clients, create-client, delete-client, daily-digest, digest-config,
  client-configs, intelligence, requeue, brief-runs, whoami, scout-* (card-copy,
  data-map, map-notes, recent-runs). ADMIN-only. Confirm every route enforces admin,
  not just whoami.
- `analytics/` — homepage
- `brand-system/` — chat, generate-image, scan (Anthropic calls — prompt-injection,
  cost/abuse, SSRF in scan)
- `clients/` — provision
- `dashboard/` — bootstrap, brand-overview/-snapshot, brief-preview, custom-briefs,
  conversation-intake, cancel-intake, reseed-intake, estimate-brief, marketing-brief,
  modules, knowledge-base (upload), local-weather, market-category, events-search,
  newsletter-preview, onboarding, run-skill, scout-run/-test/-config-*, skill-doc,
  strategy-builder. Tenant-scoped. Each must verify caller owns the clientId it acts on.
- `intelligence/` — agent-ready, rerun, run (long-running LLM jobs)
- `leadgen/` — discover, generate, generate-site, generate-mockup, make-dashboard,
  send, onboard, package, prepare-brief, create-estimate, module, fetch-references
  (SSRF?), visual-dna, seed-client-prospect
- `ops/` — overview
- `social-posting/` — route.js, process-due (Twitter post — auth + scheduling abuse,
  who can trigger?)
- `worker/` — run-brief (background job — callable unauthenticated? cron secret?)

## FEATURE LOGIC (features/*) — business logic behind the routes
- `intelligence/` — brief intel, digest, ledger, narrator, store, weather (`_*.js`)
- `knowledge-base/` — chunk, embed, retrieval, store, url (RAG pipeline — injection,
  embedding cost, PII in store)
- `leadgen/` — scraping (content-scraper), estimate gen/render/verify, deploy-preview,
  email-template, asset-manager (SSRF, scraping, outbound email)
- `newsletter/` — aggregator, renderer (.cjs), scribe, store
- `not-the-rug-brief/` — anthropic-client, instagram, reddit, weather, reviews,
  guardian, config-loader (external API ingestion; rate/secret handling)
- `scout-intake/` — anthropic + openai clients, analyzers, brief renderer, card builders
- `social-posting/` — twitter-service.js
- `strategy-builder/` — build-strategy, prompt, schemas, signal-providers

## CLIENT DATA
`clients/<tenant>/` — per-tenant files on disk (`_shared`, `cronauer-law-*`,
`fast-poker`, `twa-*`) ALONGSIDE Firestore. → Audit filesystem path handling for
path traversal via clientId, and consistency of the two stores.

## UI / FRONTEND (repo root *.jsx + components/, dashboard/)
- Marketing pages: HomePage, About, Work, Services (Web/Brand/DesignSystems/SeoGeo/
  AiConsulting), CaseStudies, Process, FAQ, Gallery, Contact.
- Heavy WebGL: `*Swarm.js` / `*SwarmWindow.jsx` (Decent/Holo/Matter/Paper/Product/
  Terrain/Particles) + `sharedParticleGalleryRenderer.js`, `BrainParticleWindow`.
  → Bundle weight, RAF/WebGL-context leaks, mobile cost, code-splitting.
- Dashboard UI: `DashboardPage.jsx`, `AdminPage.jsx`, `components/dashboard/*`,
  `components/ui/*`.
- Auth: `AuthContext.jsx`, `AuthPage.jsx`, `app/login`.
- `lib/`: analytics.js, utils.js, playwright-stub.js.

## KNOWN DOC ARTIFACTS (context, may be stale)
`FULL-AUDIT-REPORT.md`, `ACTION-PLAN.md`, `GEO-ANALYSIS.md`, `README.md`. Read for
intent; verify claims against code.
