# Prelaunch Hardening Handoff

## Goal

Bring the current launch candidate to a public-launch baseline by fixing the launch-blocking security, abuse, cost, privacy, and dependency risks found in the blockers-first audit.

Do not broaden scope into visual redesign or feature expansion. Preserve current product behavior unless a change is needed to close a launch risk.

## Current State

- The worktree is dirty and contains intentional local launch-candidate changes.
- The app is a Next.js App Router project deployed on Vercel with Firebase Auth, Firestore, Firebase Admin SDK, Storage, Stripe, OpenAI, Anthropic/Kimi, Browserless, PageSpeed, social APIs, leadgen, dashboard, worker, admin, and public brief surfaces.
- `npm test` passed 425 tests during the audit.
- `npm run build` passed, but Turbopack warned that `app/api/leadgen/generate/route.js` traces dynamic filesystem usage through `features/leadgen/client-folder.js`.
- `npm audit` reported 17 vulnerabilities, including 1 critical and 3 high.

## Branching Workflow

1. Preserve current local product state on a snapshot branch.
2. Create a hardening branch from that snapshot.
3. Keep commits grouped by risk area:
   - dependency patches
   - leadgen authorization
   - Firestore rules
   - rate limits and quotas
   - SSRF protection
   - Stripe hardening
   - public brief privacy
   - tests and CI gates

Recommended branch names:

```bash
codex/prelaunch-current-snapshot
codex/launch-hardening
```

Before committing, confirm `.env.local` and any real secrets are not staged.

## Launch Blockers

### 1. Patch Dependency Vulnerabilities

Problem:
- `npm audit` reported a critical `protobufjs` advisory, high-severity Next.js advisories, high `@grpc/grpc-js` advisories, and moderate transitive issues.

Implementation:
- Run `npm audit fix` first.
- If `firebase-admin@14` or other breaking upgrades are required, handle them intentionally.
- Verify `next`, `firebase-admin`, Google/Firebase transitives, `protobufjs`, `@grpc/grpc-js`, `postcss`, `fast-xml-parser`, `qs`, and `uuid` are no longer carrying critical/high findings.

Acceptance:
- `npm audit` has no critical or high findings.
- `npm test` passes.
- `npm run build` passes.

### 2. Lock Down Leadgen Authorization

Problem:
- Normal signed-in users can access operator-grade leadgen routes.
- Several routes accept arbitrary `placeId` and use the Admin SDK to read/mutate `leadgen_prospects`.
- Some actions can trigger paid API calls, Vercel deploys, Gmail sends, or long-running generation.

High-risk files:
- `app/api/leadgen/configs/route.js`
- `app/api/leadgen/discover/route.js`
- `app/api/leadgen/generate/route.js`
- `app/api/leadgen/generate-site/route.js`
- `app/api/leadgen/generate-mockup/route.js`
- `app/api/leadgen/package/route.js`
- `app/api/leadgen/send/route.js`
- `app/api/leadgen/visual-dna/route.js`
- `app/api/leadgen/module/route.js`
- `app/api/leadgen/create-estimate/route.js`
- `app/api/leadgen/fetch-references/route.js`
- `app/api/leadgen/prepare-brief/route.js`

Implementation:
- Treat operator leadgen routes as admin-only by default.
- Use `verifyAdminRequest` for global config, arbitrary prospect, Gmail send, Vercel deploy, discovery, generation, package, and module routes.
- If a leadgen route must remain customer-facing, it must:
  - resolve `clientId` via `getEffectiveClientContext`
  - only operate on `leadgen_prospects/client:{clientId}`
  - ignore caller-supplied arbitrary `placeId`
  - enforce per-client quotas and cooldowns
- Return `403` for signed-in non-admin users attempting operator actions.

Acceptance:
- Non-admin signed-in users cannot read or write global leadgen config.
- Non-admin signed-in users cannot act on arbitrary `leadgen_prospects/{placeId}`.
- Admin users can still perform operator workflows.
- Customer routes, if retained, can only touch the signed-in user's synthetic client prospect.

### 3. Tighten Firestore Rules

Problem:
- `firestore.rules` allows any authenticated user to read non-`client:*` `leadgen_prospects`.
- `leadgen_configs` is readable by any authenticated user.
- Non-client prospect docs can be updated by any authenticated user for `starred` and `generation`.

File:
- `firestore.rules`

Implementation:
- Restrict operator `leadgen_prospects` and `leadgen_configs` from normal client users.
- Keep client synthetic docs readable only when `resource.data.clientId == callerClientId()`.
- Keep writes server-owned unless a specific client-owned field is required.
- Add Firestore emulator tests for normal user, cross-client user, and admin-like cases.

Acceptance:
- Normal signed-in users cannot read operator prospects or global configs.
- Client users can only read their own `client:{clientId}` prospect.
- Cross-client access fails.

### 4. Add Rate Limits And Cost Quotas

Problem:
- Public and signed-in routes can trigger expensive or high-volume operations without rate limits.

Public or low-friction surfaces:
- `app/api/payments/create-payment-intent/route.js`
- `app/api/payments/create-subscription/route.js`
- `app/api/intelligence/agent-ready/route.js`
- `app/api/analytics/homepage/route.js`

Signed-in expensive surfaces:
- OpenAI image generation
- OpenAI embeddings
- Anthropic/Kimi generation
- Browserless capture
- PageSpeed
- leadgen generation/deploy
- knowledge-base ingest
- dashboard module runs

Implementation:
- Add one shared server-side rate-limit helper.
- Back it with a production-safe shared store: Firestore, Redis, Vercel KV, or another durable store already available to the app.
- Rate-limit by route class:
  - anonymous IP + route
  - signed-in uid + route
  - clientId + provider/action
- Add daily provider quotas by clientId.
- Add provider kill switches via env and/or admin config.
- Return `429` with a stable JSON error.

Acceptance:
- Repeated requests hit `429`.
- Quota exceeded states do not call paid providers.
- Usage logging includes provider, model/action, clientId/user, and cost estimate where available.

### 5. Add SSRF Protection

Problem:
- User-provided URLs are fetched by public and signed-in routes.
- Current URL checks allow generic `http` and `https` without private network blocking.

High-risk files:
- `app/api/intelligence/agent-ready/route.js`
- `features/scout-intake/agent-ready/_fetch.js`
- `features/knowledge-base/url.js`
- `features/scout-intake/site-fetcher.js`
- `features/intelligence/pagespeed.js`
- `features/leadgen/content-scraper.js`
- `features/leadgen/asset-manager.js`
- public brief PDF fallback fetches, if external URLs remain supported

Implementation:
- Add a shared URL validation and fetch wrapper.
- Block:
  - `localhost`
  - `127.0.0.0/8`
  - `0.0.0.0`
  - `10.0.0.0/8`
  - `172.16.0.0/12`
  - `192.168.0.0/16`
  - link-local and metadata IPs
  - IPv6 loopback/private/link-local equivalents
  - non-http(s) schemes
- Resolve DNS where needed before fetch.
- Re-check each redirect target.
- Enforce timeout and max response size.

Acceptance:
- Private/internal URLs are rejected before fetch.
- Redirects to private/internal URLs are rejected.
- Large responses are stopped before unbounded memory growth.

### 6. Harden Stripe Payment Setup

Problem:
- Anonymous routes create Stripe customers, subscriptions, and payment intents using only email input.
- Webhook stores subscription state but does not store processed event IDs.

Files:
- `app/api/payments/create-subscription/route.js`
- `app/api/payments/create-payment-intent/route.js`
- `app/api/payments/webhook/route.js`

Implementation:
- Add rate limits to both create routes.
- Add idempotency keys for Stripe calls.
- Dedupe existing incomplete payment intents/subscriptions by email and purpose.
- Store processed webhook event IDs before/after successful handling to avoid replay duplicate effects.
- Validate `STRIPE_PRICE_ID` and webhook secret in production startup/runtime checks.

Acceptance:
- Repeated payment setup calls do not create unbounded Stripe objects.
- Replayed webhook events are ignored safely.
- Missing Stripe env fails clearly.

### 7. Fail Closed For Cron/Admin Digest

Problem:
- `app/api/admin/daily-digest/route.js` allows cron auth when `CRON_SECRET` is missing.

Implementation:
- In production, `CRON_SECRET` must be set.
- Missing `CRON_SECRET` should return `401` for scheduled execution.
- Preview/send-now paths should still require admin auth.

Acceptance:
- Production-mode test with missing `CRON_SECRET` returns `401`.
- Valid cron secret works.
- Admin preview still works with admin auth.

### 8. Make Public Briefs Private By Default

Problem:
- Custom briefs default to public and public routes serve HTML/PDF/OG image without auth when `public !== false`.

Files:
- `app/api/dashboard/custom-briefs/route.js`
- `app/briefs/_lib/custom-briefs.js`
- `app/briefs/[clientId]/[briefSlug]/route.js`
- `app/briefs/[clientId]/[briefSlug]/pdf/route.js`

Implementation:
- Change new brief default to `public: false`.
- Add an explicit publish action or `public: true` confirmation path.
- Confirm public route only resolves published briefs.
- Avoid exposing internal IDs, prompts, provider costs, unpublished drafts, or client-private dashboard state.

Acceptance:
- Newly created custom briefs are not publicly reachable.
- Explicitly published briefs are reachable.
- Unpublished PDFs and OG images return `404`.

## Important But Not Launch-Blocking If Time Is Tight

### Dashboard Performance

Problem:
- `DashboardPage.jsx` is about 23k lines / 1.05 MB.
- Built JS chunks were about 4.9 MB uncompressed and 1.46 MB gzipped in the audit.

Implementation:
- Split dashboard surfaces by route/modal/tool.
- Lazy-load admin, leadgen, brief preview, studio, payment, and custom brief editors.
- Defer iframe previews until visible.
- Keep the current UI behavior while reducing initial dashboard payload.

Acceptance:
- Initial dashboard JS payload is materially reduced.
- Mobile dashboard still loads and authenticates.
- Main dashboard route remains usable on slow network.

### Admin/Ops Pagination

Problem:
- Admin and ops routes read full collections.

Files:
- `app/api/admin/clients/route.js`
- `api/_lib/ops-overview.cjs`
- `api/_lib/client-provisioning.cjs`

Implementation:
- Add pagination or server-side aggregates.
- Avoid loading all clients/runs/configs/dashboard states on every admin view.

Acceptance:
- Admin routes stay bounded at 1,000+ users.

## Test Plan

Required before launch:

```bash
npm test
npm run build
npm audit
```

Add or extend tests for:

- route auth matrix:
  - anonymous
  - signed-in non-admin
  - admin
  - worker secret
- Firestore rules:
  - same-client read
  - cross-client denial
  - operator leadgen denial
- SSRF:
  - localhost
  - private IPv4
  - private IPv6
  - metadata IP
  - redirect to private IP
- Stripe:
  - duplicate setup requests
  - webhook replay
  - invalid signature
- Rate limits and quotas:
  - anonymous route limit
  - signed-in provider quota
  - provider kill switch
- Public briefs:
  - private by default
  - publish makes reachable
  - unpublish hides HTML/PDF/OG image

## Manual Smoke Checklist

Run after automated tests:

- Sign up / log in.
- Dashboard bootstrap loads.
- Onboarding can save answers.
- A normal user cannot access admin/leadgen operator endpoints.
- Admin can switch clients.
- Payment setup starts once and repeated clicks do not create duplicates.
- Public brief is hidden before publish and visible after publish.
- One AI/provider action works under quota.
- Quota exceeded path returns useful UI feedback.
- Cron route rejects missing/invalid secret.

## Non-Goals

- Do not redesign the dashboard.
- Do not change pricing/product tiers except where needed for safe gating.
- Do not rewrite the leadgen system; add authorization boundaries first.
- Do not remove existing admin/operator workflows unless no safe gate is practical.

