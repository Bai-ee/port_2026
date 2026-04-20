# Vercel Hobby Readiness — Master Prompt (Claude Sonnet Handoff)

Paste this into a fresh Claude Sonnet session as the first message. Do not remove sections.

---

## Role

You are implementing the **Vercel Hobby Readiness** workstream inside the
Bballi Portfolio codebase.

This is an execution task, not a brainstorming session.

Your job is to:

1. fix the verified production build blocker
2. add a standard verification gate
3. deploy and verify before restructuring routes
4. only consolidate API routes if Vercel actually reports a function-count problem
5. stop and ask before removing any feature to hit the route-count target

---

## Canonical source of truth

Read this first and treat it as canonical:

- [docs/PRODUCTION_HARDENING/VERCEL_HOBBY_READINESS_PLAN.md](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/PRODUCTION_HARDENING/VERCEL_HOBBY_READINESS_PLAN.md:1)

If the plan and the code disagree, surface the mismatch before editing.

If the plan and an older review disagree, the plan wins.

---

## Hard operating rules

1. **Fix the build blocker first.**
   Do not start route consolidation until `npm run build` passes.

2. **Do not treat raw route-file count as proof of deploy failure.**
   The current route count is not itself a verified blocker. Do not start route
   consolidation unless a real deploy demonstrates that it is necessary.

3. **No silent feature cuts.**
   If route consolidation alone cannot reach `<= 12`, stop and ask before
   removing any feature, admin tool, or dashboard capability.

4. **No compatibility proxy routes if the target depends on deleting them.**
   Thin wrappers still count as route files.

5. **Update callers before deleting old routes.**
   Search the repo and migrate all known in-repo callers first.

6. **Preserve auth and scoping.**
   Do not weaken request verification or Firestore access boundaries while consolidating routes.

7. **Prefer minimal diffs.**
   This is not a broad architecture rewrite.

8. **Do not consolidate routes preemptively for style.**

9. **Do not invent new dependencies unless absolutely required.**

10. **Verification is mandatory.**
   Run tests and build after each meaningful phase.

11. **Report clearly at every phase boundary and stop.**
    Do not roll through multiple phases without explicit approval.

---

## Verified current context

### Real current build blocker

`next build` fails because of:

- [features/intelligence/_store.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/intelligence/_store.js:13)

Current failing pattern:

```js
const fb = require(path.resolve(__dirname, '../../api/_lib/firebase-admin.cjs'));
```

Start there.

### Important repo facts you must respect

- Long-running routes already use route-level `maxDuration` in:
  - [app/api/worker/run-brief/route.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/worker/run-brief/route.js:5)
  - [app/api/intelligence/run/route.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/intelligence/run/route.js:5)
  - [app/api/intelligence/rerun/route.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/intelligence/rerun/route.js:5)

- [next.config.mjs](/Users/bballi/Documents/Repos/Bballi_Portfolio/next.config.mjs:1) is nearly empty; the most useful immediate improvement is `turbopack.root`.

- [package.json](/Users/bballi/Documents/Repos/Bballi_Portfolio/package.json:5) has no `test` script even though many `node:test` files exist.

- [.env.example](/Users/bballi/Documents/Repos/Bballi_Portfolio/.env.example:1) still contains real Firebase web config values and should be converted to placeholders during hygiene cleanup.

---

## Current route surface

You are reducing this route surface:

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

## Target route surface

Reduce the route-handler filesystem count to `<= 12` only if Phase 4 proves
that this is required for deployment.

Preferred consolidated target:

1. `app/api/worker/run-brief/route.js`
2. `app/api/ops/overview/route.js`
3. `app/api/clients/provision/route.js`
4. `app/api/intelligence/route.js`
5. `app/api/dashboard/state/route.js`
6. `app/api/dashboard/actions/route.js`
7. `app/api/admin/query/route.js`
8. `app/api/admin/scout/route.js`
9. `app/api/admin/intelligence/route.js`

Preferred consolidation mappings:

- `/api/intelligence/run` + `/api/intelligence/rerun` → `/api/intelligence`
- dashboard reads → `/api/dashboard/state` except `onboarding`, which should not
  be folded into a read-oriented route if consolidation is needed
- dashboard mutations → `/api/dashboard/actions`
- admin reads → `/api/admin/query`
- admin mutations like `requeue` → `/api/admin/actions`
- admin scout tools → `/api/admin/scout`
- admin intelligence mutations → consolidated `/api/admin/intelligence`

If you cannot reach `<= 12` cleanly without feature removal, stop and ask.

---

## Required implementation order

### Phase 1 — Build blocker

1. Fix [features/intelligence/_store.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/intelligence/_store.js:13)
2. Re-run:

```bash
npm run build
```

If the relative require fix is not enough, inspect and repair the import chain so the module stays server-only.

### Phase 2 — Test command

Add a standard `npm test` script in [package.json](/Users/bballi/Documents/Repos/Bballi_Portfolio/package.json:5) using the existing `node:test` suites.

Do not add `--experimental-test-coverage`.

Run:

```bash
npm test
npm run build
```

### Phase 3 — Minimal config hardening

Add `turbopack.root` in [next.config.mjs](/Users/bballi/Documents/Repos/Bballi_Portfolio/next.config.mjs:1).

Only add additional config if justified by actual code usage.

Run:

```bash
npm test
npm run build
```

### Phase 4 — Deploy and verify

Attempt a real Vercel preview deploy after Phases 1–3.

If deploy succeeds, stop and report that route consolidation is unnecessary.

If deploy fails, confirm whether the failure is specifically about bundled
function count before touching the route surface.

Run:

```bash
npm test
npm run build
```

### Phase 5 — Conditional route consolidation

Only execute this phase if Phase 4 proves route consolidation is required.

Use the contingency mappings from the plan, but consolidate only the minimum
needed to clear the actual deploy error.

Do not fold `onboarding` into a `state` route and do not put `requeue` into a
route named `query`.

Run:

```bash
npm test
npm run build
```

### Phase 6 — Hygiene cleanup

1. Replace real Firebase web config values in [.env.example](/Users/bballi/Documents/Repos/Bballi_Portfolio/.env.example:1) with placeholders.
2. Audit tracked `public/` weight and reduce it where safe.

Run final verification:

```bash
npm test
npm run build
```

---

## What NOT to do

- Do not start with route consolidation before fixing the build.
- Do not start with route consolidation before attempting a real deploy after Phases 1–3.
- Do not keep old route files around as “temporary shims” if the count target depends on deleting them.
- Do not remove features without asking first.
- Do not claim a Vercel Hobby blocker unless you have direct evidence.
- Do not add `next/image` config unless `next/image` is actually in use.
- Do not weaken auth or Firestore scoping to make consolidation easier.
- Do not mix unrelated refactors into this workstream.

---

## Reporting format

Before editing:

- **Phase**
- **Scope**
- **First step**
- **Risks**

After editing:

- **Files changed**
- **Behavior changed**
- **Routes removed / routes added**
- **Verification run**
- **Current route count**
- **Risks / not verified**
- **Acceptance**

Keep reports concise and factual.

---

## Stop-and-ask conditions

Stop and ask before continuing if:

1. Hitting `<= 12` route handlers requires removing a feature.
2. A route appears to have external consumers that cannot be confidently migrated.
3. A route merge would materially complicate auth, ownership checks, or data scoping.
4. The build blocker cannot be solved locally and instead suggests a larger server-boundary problem.
5. The Phase 4 deploy succeeds, making route consolidation unnecessary.

When you stop, present:

- what changed
- what count is currently reachable
- what routes remain
- what feature or behavior would need approval to cut

---

## What to do first in the new session

1. Say you have read:
   - the master plan
   - the route inventory
   - the build blocker location
2. Restate that Phase 1 is to fix `_store.js` and make `npm run build` pass.
3. State explicitly that route consolidation is conditional and will not begin until after a real deploy check.
4. List the first three concrete actions.
5. Wait for approval to proceed.
