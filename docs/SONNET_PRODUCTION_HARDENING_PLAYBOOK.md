# Sonnet Production Hardening Playbook

Use this document to direct a Sonnet model through safe, phased hardening of this repository before live production.

The model's primary objective is not raw optimization. The primary objective is to reduce security and performance risk while preserving the current working experience.

## Prime Directive

Do not break working features.

Do not redesign the product.

Do not change user flows unless the phase explicitly calls for it.

Do not modify data contracts, Firestore shapes, auth semantics, or route behavior unless the change is narrowly scoped, verified, and documented.

If you find a problem that requires risky architectural change, stop, explain it, and propose a contained follow-up instead of improvising.

## Repo Context You Must Assume

- Framework: Next.js app router
- Client + server auth stack: Firebase client auth + Firebase Admin
- Large dynamic/admin/API surface under `app/api/**`
- Background and worker-triggered flows exist
- Some preview features intentionally render raw generated HTML
- The codebase already builds, but the test suite has pre-existing failures in `features/scout-intake/skills/__tests__/runner.test.js`

## Global Rules for Every Phase

1. Start by reading the exact files in scope before editing.
2. Prefer narrow diffs over large rewrites.
3. Preserve feature behavior and UI output.
4. Reuse existing helpers before introducing new abstractions.
5. Do not mass-format unrelated files.
6. Do not touch giant unrelated files just because they are messy.
7. After each phase, run only the smallest meaningful verification first, then broader validation.
8. If a phase reveals pre-existing failures, document them separately from regressions you caused.

## Launch-Sensitive Hotspots

Treat these areas as high-risk:

- `api/_lib/auth.cjs`
- `api/_lib/firebase-admin.cjs`
- `app/api/admin/**`
- `app/api/intelligence/run/route.js`
- `app/api/worker/run-brief/route.js`
- `app/api/clients/provision/route.js`
- `app/api/dashboard/reseed-intake/route.js`
- `features/scout-intake/runner.js`
- `features/intelligence/pagespeed.js`
- `api/_lib/browserless.cjs`
- `app/preview/brief/page.jsx`
- `app/preview/scout-config/page.jsx`
- `DashboardPage.jsx`
- `StackedSlidesSection.jsx`

## Phase Sequence

### Phase 0: Baseline Lock

#### Goal

Document the current known-good behavior before cleanup starts.

#### Tasks

- Confirm current `build` and `test` behavior.
- Write down existing failures without fixing them unless they block safe work.
- Inventory sensitive routes:
  - admin
  - dashboard
  - worker
  - intelligence
  - preview
- Create a smoke-test matrix for:
  - `/`
  - `/login`
  - `/dashboard`
  - `/preview/brief`
  - `/preview/scout-config`
  - `/admin`
  - background worker trigger paths

#### Deliverables

- Baseline notes
- Route inventory
- Smoke-test checklist

#### Stop conditions

- Stop if build is red and the cause is unrelated to the phase.
- Stop if route ownership/auth expectations are unclear.

#### Copyable Sonnet Prompt

```text
Phase 0 only. Do not optimize yet.

Read the repo and produce a baseline production-hardening note. Confirm the current build and test state, list existing failures without attempting broad fixes, and inventory the sensitive routes under app/api plus preview/admin/dashboard surfaces. Create a concise smoke-test matrix for the most important user and admin flows.

Constraints:
- No feature changes
- No refactors
- No dependency changes
- Keep output specific to this repo
```

### Phase 1: Security Hardening Without UX Change

#### Goal

Reduce obvious production risk without changing functionality.

#### Focus files

- `api/_lib/auth.cjs`
- `app/api/intelligence/run/route.js`
- `app/api/worker/run-brief/route.js`
- `app/api/clients/provision/route.js`
- `app/api/dashboard/reseed-intake/route.js`
- `app/api/admin/daily-digest/route.js`
- `firebase.js`
- `app/preview/brief/page.jsx`

#### Tasks

- Standardize secret validation and auth error handling.
- Add or tighten request method/body validation where missing.
- Ensure sensitive responses return safe cache headers.
- Review whether dev-only globals are strictly dev-only.
- Review every `dangerouslySetInnerHTML` use:
  - allow JSON-LD cases
  - flag raw HTML rendering cases
  - do not break preview behavior, but constrain/document risk
- Document which routes depend on:
  - bearer auth
  - worker secret
  - cron secret

#### Deliverables

- Small hardening diff
- Route auth matrix
- Risk notes for raw HTML paths

#### Stop conditions

- Stop if you would need to redesign preview rendering.
- Stop if auth changes would alter existing admin or worker behavior.

#### Copyable Sonnet Prompt

```text
Phase 1 only. Harden security-related edges without changing product behavior.

Read the auth, worker, admin, and preview route files first. Standardize request validation, error handling, and cache-control for sensitive routes. Audit dangerous HTML injection paths and dev-only auth/debug behavior, but do not remove or redesign working preview features unless you can do so with zero behavior change.

Constraints:
- No UI redesign
- No auth model redesign
- No new feature work
- Keep diffs narrow and production-safe
- Explain any risk you choose not to change
```

### Phase 2: Logging, Tracing, and Failure Containment

#### Goal

Make production failures diagnosable before launch.

#### Focus files

- `app/api/clients/provision/route.js`
- `app/api/dashboard/reseed-intake/route.js`
- `app/api/intelligence/run/route.js`
- `app/api/admin/daily-digest/route.js`
- `api/_lib/client-provisioning.cjs`
- `api/_lib/run-lifecycle.cjs`
- `features/scout-intake/runner.js`
- `features/intelligence/pagespeed.js`

#### Tasks

- Ensure logs include stable identifiers:
  - `clientId`
  - `runId`
  - `sourceId`
  - route/action name
- Replace vague console messages with structured, searchable messages.
- Isolate non-fatal failures so a single downstream failure does not collapse unrelated work.
- Document expected timeout ranges and retry expectations for external services.

#### Deliverables

- Improved structured logs
- Failure-path notes
- Timeout and retry checklist

#### Stop conditions

- Stop if adding observability requires new infrastructure.
- Stop if a log change risks leaking secrets or PII.

#### Copyable Sonnet Prompt

```text
Phase 2 only. Improve observability and failure containment for production.

Focus on route handlers, provisioning, background fanout, and long-running intelligence flows. Add structured logging and clearer failure-path handling using existing patterns where possible. Do not introduce new services or change feature behavior. Preserve output contracts.

Constraints:
- No new external dependencies unless absolutely necessary
- No schema changes
- No changes to successful-path behavior
```

### Phase 3: Low-Risk Performance Pass

#### Goal

Cut avoidable client and server overhead without changing the experience.

#### Focus files

- `app/layout.jsx`
- heavy client pages/components
- visual modules using `three`, `@react-three/fiber`, `@react-three/drei`, `gsap`, `motion`
- `app/preview/scout-config/page.jsx`
- `DashboardPage.jsx`

#### Tasks

- Identify heavy modules that can be deferred or isolated.
- Review global font loading and move toward lower-cost loading if possible.
- Reduce repeated client fetches where behavior remains identical.
- Review image handling and any oversized public assets.
- Avoid turning fresh data paths into cached paths unless explicitly safe.

#### Deliverables

- Small performance-focused diff
- Note of any intentionally deferred optimizations
- Before/after reasoning for bundle/runtime wins

#### Stop conditions

- Stop if an optimization changes load order in a way that could break motion, hydration, or auth.
- Stop if you need broad component rewrites to realize the win.

#### Copyable Sonnet Prompt

```text
Phase 3 only. Apply low-risk performance improvements.

Target heavy client code, global font loading, redundant client fetches, and obvious bundle hotspots. Favor lazy loading, isolation, and safer defaults over rewrites. Do not alter visual behavior, auth timing, route semantics, or freshness expectations for user data.

Constraints:
- No UX regressions
- No caching changes for sensitive/user-specific data unless clearly safe
- Keep the work surgical
```

### Phase 4: Componentization and Decomposition

#### Goal

Make the hardest files safer to maintain without changing what they do.

#### Priority files

- `app/preview/scout-config/page.jsx`
- `DashboardPage.jsx`
- `StackedSlidesSection.jsx`
- `app/api/admin/daily-digest/route.js`

#### Tasks

- Split view-only sections into dedicated components.
- Extract pure helpers and constants first.
- Keep prop contracts stable.
- Avoid combining refactor and logic changes in the same patch.
- For routes, extract utility functions before touching behavior.

#### Deliverables

- Component/module split with minimal behavior change
- Notes describing what moved and what stayed the same

#### Stop conditions

- Stop if a file cannot be split without unclear side effects.
- Stop if refactoring would mix structural and behavioral changes.

#### Copyable Sonnet Prompt

```text
Phase 4 only. Decompose the largest risk-heavy files into smaller components and utilities without changing behavior.

Prioritize structural extraction over logic edits. Move constants, pure helpers, and presentational sections first. Preserve prop contracts, route outputs, and rendered markup as much as possible. If a refactor would change behavior, stop and document instead of guessing.

Constraints:
- No feature changes
- No visual redesign
- No mixed refactor-plus-logic patches
```

### Phase 5: Runtime, Data Access, and Background Flow Audit

#### Goal

Reduce server-side production risk in expensive or long-running paths.

#### Focus files

- `app/api/admin/daily-digest/route.js`
- `features/scout-intake/runner.js`
- `features/intelligence/pagespeed.js`
- `api/_lib/browserless.cjs`
- `api/_lib/client-provisioning.cjs`

#### Tasks

- Review full-collection Firestore reads and identify safer alternatives.
- Confirm long-running paths have explicit timeout and degradation behavior.
- Review background trigger reliability and where work can be dropped.
- Document rate-limited or flaky external dependencies and their fallback behavior.

#### Deliverables

- Runtime risk audit
- Safe targeted fixes if they are low-risk
- Deferred-risk list for larger architecture work

#### Stop conditions

- Stop if the fix would require a queueing redesign, schema redesign, or major ops infrastructure.

#### Copyable Sonnet Prompt

```text
Phase 5 only. Audit runtime-heavy and data-heavy production paths.

Focus on Firestore read patterns, long-running external service calls, background trigger reliability, and safe timeout/degradation behavior. Prefer documentation and contained fixes over architecture changes. Do not redesign the system unless the risk is impossible to address incrementally.

Constraints:
- Preserve contracts
- No schema migrations
- No queueing redesign unless explicitly requested
```

### Phase 6: Final Verification and Launch Readiness

#### Goal

Prove the cleanup did not damage the live-ready experience.

#### Tasks

- Re-run build.
- Re-run relevant tests.
- Re-run smoke-test matrix.
- Verify public pages, auth, dashboard, preview, admin, and worker flows.
- Produce a concise launch note:
  - what changed
  - what remains risky
  - rollback sequence
  - required env vars

#### Deliverables

- Launch-readiness summary
- Known-risk list
- Rollback note

#### Copyable Sonnet Prompt

```text
Phase 6 only. Verify production readiness after hardening work.

Run the smallest relevant validation first, then broader checks. Summarize what changed, what remains risky, what is intentionally deferred, and how to roll back safely if launch issues occur. Keep the focus on preserving the working live experience.

Constraints:
- No new refactors in this phase
- Verification and reporting only, unless a tiny fix is required to restore baseline
```

## What Sonnet Should Explicitly Avoid

- Large dependency changes
- Replacing Firebase auth or admin patterns
- Rewriting the preview system
- Mixing component refactors with logic rewrites
- Touching giant visual files and admin/runtime files in the same patch
- Broad caching changes
- Silent changes to route auth
- Any “cleanup” that lacks a verification story

## What Good Output Looks Like

A good Sonnet phase result should include:

- a narrow diff
- a brief summary of what was hardened
- explicit note on what was intentionally not changed
- exact verification run
- remaining risks

If Sonnet cannot complete a phase safely, the correct behavior is to stop and report, not improvise.
