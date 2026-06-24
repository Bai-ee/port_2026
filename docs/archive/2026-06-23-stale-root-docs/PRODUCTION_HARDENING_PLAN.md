# Production Hardening Plan

## Objective

Prepare this codebase for live production by reducing security, performance, and maintainability risk without changing product behavior, user flows, copy, layout intent, or data shape unless a phase explicitly calls for it.

This plan is intentionally conservative. The rule is: preserve the current working experience first, then harden, then optimize.

## Current Baseline

- `npm run build` passes on April 23, 2026.
- `npm test` is not fully green on April 23, 2026.
- Existing failing tests:
  - `features/scout-intake/skills/__tests__/runner.test.js`
  - `parseFrontMatter: parses seo-depth-audit.md without error`
  - `buildSourcePayloads: all 14 source ids are present`

Implication: do not begin cleanup by touching the `scout-intake/skills` path. First stabilize baseline and protect unrelated work from introducing new failures.

## Repo-Specific Risk Map

### Highest-risk runtime surfaces

- Auth and admin access:
  - `api/_lib/auth.cjs`
  - `api/_lib/firebase-admin.cjs`
  - `app/api/admin/**`
  - `app/api/intelligence/run/route.js`
  - `app/api/worker/run-brief/route.js`
- Background and provisioning flows:
  - `app/api/clients/provision/route.js`
  - `app/api/dashboard/reseed-intake/route.js`
  - `api/_lib/client-provisioning.cjs`
  - `api/_lib/run-lifecycle.cjs`
- Heavy pipeline and external IO:
  - `features/scout-intake/runner.js`
  - `features/intelligence/pagespeed.js`
  - `api/_lib/browserless.cjs`
  - `features/not-the-rug-brief/xscout.js`

### Highest-risk maintainability hotspots

- Very large files that should be decomposed without changing behavior:
  - `DashboardPage.jsx`
  - `StackedSlidesSection.jsx`
  - `app/preview/scout-config/page.jsx`
  - `app/api/admin/daily-digest/route.js`
- Inline styles and large client components increase regression risk and bundle weight.

### Security watch items already visible

- Raw HTML injection paths:
  - `app/preview/brief/page.jsx`
  - structured data `dangerouslySetInnerHTML` usages across `app/**/layout.jsx`
- Dev escape hatch exposed in browser:
  - `firebase.js` sets `window.__auth` in development
- Secret-based worker flows:
  - `WORKER_SECRET`
  - `CRON_SECRET`
  - `VERCEL_API_TOKEN`
  - `RESEND_API_KEY`
- No visible centralized middleware or shared request hardening layer.

### Performance watch items already visible

- Large client pages and heavy animation/rendering surfaces.
- Several no-store fetches and dynamic routes that may be appropriate but need review.
- Google Fonts are linked manually in `app/layout.jsx` instead of using a more optimized loading path.
- Heavy libs in the dependency graph:
  - `three`
  - `@react-three/fiber`
  - `@react-three/drei`
  - `gsap`
  - `motion`
  - `sharp`

## Non-Negotiable Guardrails

1. No feature changes disguised as cleanup.
2. No auth semantics changes without explicit verification of every affected route.
3. No schema or Firestore shape changes without migration notes and rollback path.
4. No broad visual rewrites.
5. No “optimize everything” pass. Work in narrow phases with measurable outcomes.
6. One phase per PR or isolated change batch.
7. Build and targeted verification must pass before moving to the next phase.
8. If a cleanup introduces uncertainty, stop and document instead of guessing.

## Order of Work

### Phase 0: Freeze Baseline and Add Safety Rails

Difficulty: Easy

Goals:

- Record the current build/test baseline.
- Add a launch checklist document.
- Add a route inventory for admin, worker, dashboard, and preview endpoints.
- Add a low-risk verification matrix covering:
  - public pages
  - login/auth
  - dashboard
  - preview routes
  - admin routes
  - worker-triggered flows

Do first because:

- Cleanup without a frozen baseline is how working apps get broken.

### Phase 1: Security Hardening Without Behavioral Change

Difficulty: Easy to Medium

Goals:

- Centralize auth and secret validation helpers.
- Add input validation and method guards to API routes that currently parse JSON ad hoc.
- Standardize `cache-control` and error response patterns for sensitive endpoints.
- Audit and document every route that accepts:
  - bearer token auth
  - worker secret auth
  - cron secret auth
- Review `dangerouslySetInnerHTML` usage and distinguish:
  - safe JSON-LD cases
  - high-risk HTML injection cases
- Review dev-only globals like `window.__auth` and ensure they cannot leak into production behavior.

Start with:

- `api/_lib/auth.cjs`
- `app/api/intelligence/run/route.js`
- `app/api/worker/run-brief/route.js`
- `app/api/clients/provision/route.js`
- `app/api/dashboard/reseed-intake/route.js`
- `app/api/admin/daily-digest/route.js`
- `app/preview/brief/page.jsx`

### Phase 2: Observability and Failure Containment

Difficulty: Medium

Goals:

- Normalize structured logging for route failures, worker triggers, and background fanout.
- Ensure long-running flows log a stable run id, client id, and source id.
- Add safe timing and failure metrics around:
  - provisioning
  - reseed fanout
  - intelligence runs
  - Pagespeed and browserless calls
- Make failure modes explicit rather than silent or console-only.

Why this matters:

- Production incidents are harder than code cleanup. Observability first reduces blind debugging later.

### Phase 3: Low-Risk Performance Wins

Difficulty: Medium

Goals:

- Reduce client bundle cost where possible without changing UX.
- Prefer route-level or component-level lazy loading for heavy visual modules.
- Review manual font loading in `app/layout.jsx`.
- Review image optimization and asset sizes.
- Identify repeated client fetches that can be consolidated without changing freshness guarantees.

Best candidates:

- heavy visual/animation components
- large preview pages
- global font loading
- unnecessary client-only logic in routes that could stay server-side

### Phase 4: Componentization and File Decomposition

Difficulty: Medium to Hard

Goals:

- Break giant files into stable, testable components and utility modules.
- Preserve props, behavior, and DOM contract as much as possible.
- Move inline helpers into colocated modules before changing logic.

Primary targets:

- `app/preview/scout-config/page.jsx`
- `DashboardPage.jsx`
- `StackedSlidesSection.jsx`
- `app/api/admin/daily-digest/route.js`

Rule:

- refactor shape first, logic second, if at all.

### Phase 5: Server Runtime and Data Access Hardening

Difficulty: Hard

Goals:

- Audit Firestore reads that currently fetch full collections where aggregation or paging would be safer.
- Review background trigger patterns and ensure request lifecycles do not silently drop work.
- Add explicit timeouts, retries, and circuit-breaker-style guardrails for expensive external services.
- Review secrets and env requirements with startup documentation.

Primary targets:

- `app/api/admin/daily-digest/route.js`
- `features/scout-intake/runner.js`
- `features/intelligence/pagespeed.js`
- `api/_lib/browserless.cjs`
- `api/_lib/client-provisioning.cjs`

### Phase 6: Pre-Launch Verification and Rollback Readiness

Difficulty: Hard

Goals:

- Re-run build and full test suite.
- Run manual smoke tests for critical journeys.
- Confirm logs for admin and worker flows are actionable.
- Produce a rollback note:
  - which files changed
  - which env vars are required
  - which routes are most sensitive
  - what to disable first if incidents occur

## Easy-to-Difficult Update Ladder

### Easy

- Add missing docs and checklists.
- Standardize API error payloads and status codes.
- Add shared request parsing helpers.
- Add route-by-route auth annotations.
- Add response `cache-control` for sensitive JSON endpoints.
- Add tighter console/error context with stable ids.

### Medium

- Extract shared route wrappers for auth, JSON parsing, and safe responses.
- Split giant pages into presentational subcomponents.
- Replace scattered request parsing and secret checks with shared helpers.
- Lazy-load non-critical visual modules.
- Reduce duplicate client fetch patterns.

### Hard

- Rework background orchestration and fanout reliability.
- Reduce Firestore full-collection scans in admin reporting paths.
- Add stronger HTML sanitization strategy for preview/document rendering.
- Untangle large pipeline modules while preserving their output contract.

## Definition of Done

The hardening effort is done only when:

1. `npm run build` passes.
2. Test failures are either fixed or explicitly documented as pre-existing and unchanged.
3. Critical public, dashboard, admin, and worker flows are smoke-tested.
4. Auth and secret handling are centralized and documented.
5. High-risk HTML injection paths are documented and either constrained or explicitly accepted.
6. Giant files have a decomposition plan even if all of them are not yet split.
7. Every change batch has a rollback story.

## Recommended Execution Style

- Keep every phase small enough to review in one sitting.
- Prefer additive wrappers and helpers over rewrites.
- When in doubt, move code before changing code.
- Treat admin and worker routes as production infrastructure, not app pages.
- Optimize for “boring and reliable” over cleverness.
