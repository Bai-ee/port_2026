# Vercel Hobby Readiness — Implementation Plan

This is the source-of-truth execution plan for preparing the current codebase
for a clean Vercel Hobby deployment.

This plan is intentionally opinionated:

- fix the **real build blocker first**
- add a standard verification gate
- deploy and verify before refactoring route structure
- only consolidate API routes if Vercel actually reports a function-count problem
- only cut features if route consolidation is proven necessary and still cannot reach the target cleanly

If the plan conflicts with older notes or speculative audits, this plan wins.

---

## 1. Current verified state

### Real blocker

`next build` currently fails because Turbopack cannot resolve the absolute
`require(path.resolve(...))` import in:

- [features/intelligence/_store.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/intelligence/_store.js:13)

Current failing line:

```js
const fb = require(path.resolve(__dirname, '../../api/_lib/firebase-admin.cjs'));
```

This is the only currently verified ship-stop.

### Important non-blocking facts

1. Route-file count is **not automatically** a deploy blocker for this Next.js repo.
   Vercel’s current docs say Next.js bundles dynamic code into the fewest number
   of functions possible. Still, we are choosing to reduce route count anyway so
   the project stays well within Hobby expectations and is easier to maintain.

2. Heavy routes already define route-level `maxDuration` where it matters:
   - [app/api/worker/run-brief/route.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/worker/run-brief/route.js:5)
   - [app/api/intelligence/run/route.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/intelligence/run/route.js:5)
   - [app/api/intelligence/rerun/route.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/intelligence/rerun/route.js:5)

3. `public/` is locally huge because of ignored artifacts, but tracked `public/`
   weight is currently about `86 MB`, so it is not today’s main blocker.

4. `next.config.mjs` is effectively empty and should be hardened, but it is not
   the primary cause of build failure.

---

## 2. Execution goals

### Goal A — Make the app build cleanly

The repo must pass:

```bash
npm run build
```

### Goal B — Standardize verification

The repo must have a default test command:

```bash
npm test
```

using the existing `node:test` suites.

### Goal C — Reduce API route surface

The app currently has **25** route handlers under `app/api/**/route.js`.

Raw route-file count is not a guaranteed Vercel blocker for Next.js, so route
reduction is **not** a default execution step in this plan.

Instead, the target is conditional:

> If and only if Vercel rejects deployment specifically because of bundled
> function count, reduce the filesystem route-handler count to **12 or fewer**
> without removing user-visible capability, unless feature removal is explicitly
> approved.

### Goal D — Only ask for feature cuts if necessary

If the route-handler target cannot be reached cleanly by consolidation alone,
stop and ask before removing any feature, admin tool, or dashboard capability.

---

## 3. Non-negotiable rules

1. Fix the build blocker before touching route consolidation.

2. Do not remove functionality silently.

3. Do not keep compatibility shim route files if the route-count target depends
   on deleting them. Thin proxy routes still count.

4. Before deleting any existing endpoint, update all known in-repo callers first.

5. If any route appears to be used externally or manually outside the app and that
   cannot be proven safe to delete, stop and ask.

6. Prefer consolidation over redesign.

7. Prefer server-only boundaries over framework hacks.

8. Do not consolidate routes preemptively just for “cleanliness”.

9. Keep diffs focused and phased. Do not mix API consolidation with unrelated UI work.

---

## 4. Verified current route surface

Current route files:

### Worker / ops / provisioning

- `app/api/worker/run-brief/route.js`
- `app/api/ops/overview/route.js`
- `app/api/clients/provision/route.js`

### Intelligence

- `app/api/intelligence/run/route.js`
- `app/api/intelligence/rerun/route.js`

### Dashboard

- `app/api/dashboard/bootstrap/route.js`
- `app/api/dashboard/onboarding/route.js`
- `app/api/dashboard/brief-preview/route.js`
- `app/api/dashboard/scout-config-preview/route.js`
- `app/api/dashboard/reseed-intake/route.js`
- `app/api/dashboard/cancel-intake/route.js`
- `app/api/dashboard/scout-config-regenerate/route.js`
- `app/api/dashboard/scout-run/route.js`

### Admin

- `app/api/admin/clients/route.js`
- `app/api/admin/client-configs/route.js`
- `app/api/admin/brief-runs/route.js`
- `app/api/admin/scout-recent-runs/route.js`
- `app/api/admin/whoami/route.js`
- `app/api/admin/requeue/route.js`
- `app/api/admin/scout-data-map/route.js`
- `app/api/admin/scout-card-copy/route.js`
- `app/api/admin/scout-map-notes/route.js`
- `app/api/admin/intelligence/route.js`
- `app/api/admin/intelligence/update-source/route.js`
- `app/api/admin/intelligence/toggle-injection/route.js`

---

## 5. Contingency route-consolidation target

This section is intentionally **contingency-only**.

Do not execute this section unless a real Vercel deployment fails with a
function-count-related error. Keep this mapping as a prepared fallback, not the
default plan.

Target route surface after consolidation:

1. `app/api/worker/run-brief/route.js`
2. `app/api/ops/overview/route.js`
3. `app/api/clients/provision/route.js`
4. `app/api/intelligence/route.js`
5. `app/api/dashboard/state/route.js`
6. `app/api/dashboard/actions/route.js`
7. `app/api/admin/query/route.js`
8. `app/api/admin/scout/route.js`
9. `app/api/admin/intelligence/route.js`

This gets the route surface well below `12`.

### Mapping strategy

#### Intelligence

Consolidate:

- `/api/intelligence/run`
- `/api/intelligence/rerun`

Into:

- `/api/intelligence`

With action-based dispatch, e.g.:

- `POST /api/intelligence?action=run`
- `POST /api/intelligence?action=rerun`

#### Dashboard reads

Consolidate:

- `/api/dashboard/bootstrap`
- `/api/dashboard/brief-preview`
- `/api/dashboard/scout-config-preview`

Into:

- `/api/dashboard/state`

With explicit read actions, e.g.:

- `GET /api/dashboard/state?view=bootstrap`
- `GET /api/dashboard/state?view=brief-preview`
- `GET /api/dashboard/state?view=scout-config-preview`

Do **not** fold `onboarding` into a read-oriented `state` route. It currently
has both `GET` and `POST`, and if consolidation is needed later it should stay
standalone or move into an actions-oriented route.

#### Dashboard mutations

Consolidate:

- `/api/dashboard/reseed-intake`
- `/api/dashboard/cancel-intake`
- `/api/dashboard/scout-config-regenerate`
- `/api/dashboard/scout-run`

Into:

- `/api/dashboard/actions`

With explicit mutation actions, e.g.:

- `POST /api/dashboard/actions?action=reseed-intake`
- `POST /api/dashboard/actions?action=cancel-intake`
- `POST /api/dashboard/actions?action=scout-config-regenerate`
- `POST /api/dashboard/actions?action=scout-run`

#### Admin read/query surface

Consolidate:

- `/api/admin/clients`
- `/api/admin/client-configs`
- `/api/admin/brief-runs`
- `/api/admin/scout-recent-runs`
- `/api/admin/whoami`

Into:

- `/api/admin/query`

Using query or action dispatch:

- `GET /api/admin/query?entity=clients`
- `GET /api/admin/query?entity=client-configs`
- `GET /api/admin/query?entity=brief-runs`
- `GET /api/admin/query?entity=scout-recent-runs`
- `GET /api/admin/query?entity=whoami`

Do **not** put `requeue` into a route named `query`. If consolidation is needed,
keep mutations in an actions-oriented admin route.

#### Admin actions

Consolidate:

- `/api/admin/requeue`

Into:

- `/api/admin/actions`

Using action dispatch:

- `POST /api/admin/actions?action=requeue`

#### Admin scout tooling

Consolidate:

- `/api/admin/scout-data-map`
- `/api/admin/scout-card-copy`
- `/api/admin/scout-map-notes`

Into:

- `/api/admin/scout`

With:

- `GET /api/admin/scout?view=data-map`
- `GET /api/admin/scout?view=card-copy`
- `GET/POST/PATCH/DELETE /api/admin/scout?view=map-notes`

#### Admin intelligence

Consolidate:

- `/api/admin/intelligence`
- `/api/admin/intelligence/update-source`
- `/api/admin/intelligence/toggle-injection`

Into a single:

- `/api/admin/intelligence`

With action dispatch for mutations:

- `GET /api/admin/intelligence`
- `POST /api/admin/intelligence?action=update-source`
- `POST /api/admin/intelligence?action=toggle-injection`

---

## 6. Phased implementation order

### Phase 1 — Fix the build blocker

#### Scope

- [features/intelligence/_store.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/intelligence/_store.js:13)
- any direct import-chain files needed if the relative require alone is insufficient

#### Deliverables

1. Replace the `path.resolve(__dirname, ...)` import with a normal relative require.
2. If needed, tighten server-only import boundaries so this module is not pulled through the wrong graph.
3. Run `npm run build` until it passes.

#### Acceptance

- `npm run build` succeeds
- no new behavior change
- no route changes yet

### Phase 2 — Add verification gate

#### Scope

- [package.json](/Users/bballi/Documents/Repos/Bballi_Portfolio/package.json:5)
- possibly a lightweight test-selection wrapper if needed

#### Deliverables

1. Add `npm test`
2. Point it to the existing `node:test` suites
3. Exclude `node_modules`
4. Confirm tests run cleanly

#### Acceptance

- `npm test` succeeds
- `npm run build` still succeeds

### Phase 3 — Minimal Next config hardening

#### Scope

- [next.config.mjs](/Users/bballi/Documents/Repos/Bballi_Portfolio/next.config.mjs:1)

#### Deliverables

1. Add `turbopack.root`
2. Only add other hardening that is justified by actual repo usage

#### Acceptance

- build still passes
- lockfile-root warning is resolved or explicitly improved

### Phase 4 — Deploy and verify

#### Scope

- deployment verification
- route-surface validation only if the deploy reports a real limit

#### Deliverables

1. Attempt a real Vercel preview deploy after Phases 1–3.
2. Record whether deploy succeeds or fails.
3. If it fails, confirm whether the failure is specifically about bundled
   function count or a different production issue.

#### Acceptance

- preview deploy attempted
- deploy result documented
- if deploy succeeds, route consolidation is skipped
- if deploy fails for a different reason, route consolidation is not started prematurely

### Phase 5 — Conditional route consolidation

This phase only exists if Phase 4 proves route consolidation is required.

#### Scope

- only the minimum route groups needed to clear a verified Vercel function-count error
- all internal callers of those specific routes

#### Deliverables

1. Use the contingency mappings in Section 5 only as needed.
2. Consolidate the smallest possible set of routes to clear the actual deploy error.
3. Migrate all known in-repo callers.
4. Remove superseded route files only after callers are updated.

#### Acceptance

- route-handler count is reduced only if required
- deploy blocker is actually addressed
- build + tests pass
- post-change deploy succeeds

### Phase 6 — Hygiene and final predeploy cleanup

#### Scope

- `.env.example`
- tracked `public/` payload
- optional lightweight documentation updates

#### Deliverables

1. Replace real Firebase example values with placeholders
2. Audit tracked `public/` assets and remove/move anything nonessential
3. Re-run final verification

#### Acceptance

- clean example env file
- tracked static payload reduced or at least documented
- `npm test && npm run build` both pass

---

## 7. When to stop and ask first

Stop and ask before proceeding if any of the following becomes true:

1. Reducing to `<= 12` route handlers requires removing a user-visible feature.
2. A route appears to have external consumers that cannot be safely migrated.
3. Consolidation would substantially worsen authorization clarity or data scoping.
4. Build fixes require a larger runtime/bundling refactor than a localized server-only boundary cleanup.
5. Phase 4 deploy succeeds, making route consolidation unnecessary.

If any of those happen, present:

- what target count is reachable without feature cuts
- which routes remain
- which features would need to be removed or moved client-side
- the safest options from there

---

## 8. Verification checklist

The final pass for this workstream should include:

```bash
npm test
npm run build
```

For Phase 2, plain `node --test` coverage is sufficient. Do not add
`--experimental-test-coverage` unless explicitly requested later.

Manual smoke tests:

1. `/`
2. authenticated dashboard bootstrap
3. onboarding read/write flow
4. scout-config preview / regenerate flow
5. SEO/intelligence rerun flow
6. admin clients / runs / scout data map / scout card copy / intelligence panels

---

## 9. Final outcome expected

At the end of this workstream, the repo should have:

- a passing production build
- a standard test command
- a verified Vercel preview deploy result
- a smaller API route surface only if the deploy proved it was necessary
- a route-handler count at or below `12` only if consolidation is actually needed
- an explicit human approval pause if feature removal is required
