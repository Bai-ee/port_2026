# Sonnet/Opus Master Audit Plan: Production Docs, Data Pipeline, And Launch Feature Wiring

Objective: audit and correct the technical documentation and production feature map for the launch surface only. The launch scope is the **Creative Brief** and **Deliverables** navigation buckets and the admin/dashboard data needed to support those launch features. Locked/non-launch features must not be audited as launch-ready, expanded, or confirmed.

## Model Choice

Recommended:

- Use **Opus** if the task is primarily deep codebase comprehension, architecture reconciliation, and documentation accuracy.
- Use **Sonnet** if the task is primarily repo cleanup, doc editing, and targeted code fixes after the audit.

Best workflow:

1. Opus performs the deep audit and produces the authoritative maps/findings.
2. Sonnet applies doc/code cleanup from the findings.

If only one model is used, choose Opus for the first pass because this task is more about system reasoning than mechanical editing.

## Non-Negotiable Scope

In scope:

- Production launch features in the dashboard navigation buckets:
  - **Creative Brief**
  - **Deliverables**
- Production dashboard/bootstrap data needed by those buckets.
- Admin dashboard data only where it supports launched Creative Brief/Deliverables workflows.
- Docs that describe launch architecture, data flow, route behavior, card wiring, admin surfaces, env/config, and production readiness.
- Data pipeline paths that generate, persist, fetch, render, or download Creative Brief/Deliverable outputs.
- UI design system/components used by the launched buckets.

Out of scope:

- Locked dashboard features.
- Non-launch navigation buckets.
- Future/experimental modules.
- Preview-only tools unless they directly feed launch Creative Brief/Deliverables.
- Claims about locked features being production-ready.

If a locked feature shares infrastructure with launch features, audit only the shared infrastructure and clearly state that the locked feature itself is not launch-confirmed.

## Core Questions To Answer

1. Are the technical docs accurate against code, not just prior claims?
2. What is the real production launch data pipeline from signup/provisioning through Creative Brief and Deliverables?
3. Which dashboard cards are actually wired to real data, which are derived, and which are placeholders?
4. What does the admin dashboard actually pull in for launched features?
5. What data is missing from admin/dashboard views that should be tracked before launch?
6. Are any systems running twice, duplicated, or triggering redundant worker/model/storage/API work?
7. Are Creative Brief and Deliverables routes/components using the current UI design system correctly?
8. Are the launch features using the stack/config/envs documented in the repo?
9. Are there stale docs that describe old scaffolds, old auth behavior, old Stripe behavior, old worker behavior, or locked features as if they are launched?

## Documents To Review

Start with all repo-root production/architecture docs:

- `README.md`
- `PRODUCTION-READINESS-TRACKER.md`
- `SONNET-PRODUCTION-HANDOFF.md`
- `FULL-AUDIT-REPORT.md`
- `ACTION-PLAN.md`
- `FABLE5-REBUILD-PROMPT.md`
- `FABLE5-REPO-MANIFEST.md`
- `FABLE5-SCAFFOLD-PROMPT.md`
- any docs under `docs/` that reference dashboard, brief, deliverables, admin, launch, Firebase, Stripe, workers, or data pipelines

Then inspect code as source of truth.

Do not trust documentation claims unless verified against code.

## Code Areas To Inspect

### Dashboard And Navigation

- `DashboardPage.jsx`
- `app/dashboard/page.jsx`
- `components/dashboard/*`
- `components/dashboard/knowledge-base/*`
- `components/home/*` only if used by production launch flows

Identify:

- Creative Brief bucket cards
- Deliverables bucket cards
- locked nav/card logic
- non-admin gating
- card IDs
- data props used by each launched card
- whether card opens a modal, brief preview, download, or generated asset

### Creative Brief / Deliverables APIs

Inspect routes including, but not limited to:

- `app/api/dashboard/bootstrap/route.js`
- `app/api/dashboard/brief-preview/route.js`
- `app/api/dashboard/creative-brief/run/route.js`
- `app/api/dashboard/marketing-brief/run/route.js`
- `app/api/dashboard/deliverables-zip/route.js`
- `app/api/dashboard/custom-briefs/route.js`
- `app/api/dashboard/custom-briefs/vercel/route.js`
- `app/api/dashboard/knowledge-base/*` only where it feeds launched brief/deliverable context
- `app/api/worker/run-brief/route.js`
- `app/api/worker/render-studio/route.js`

### Pipeline / Shared Runtime

- `api/_lib/client-provisioning.cjs`
- `api/_lib/run-lifecycle.cjs`
- `api/_lib/browserless.cjs`
- `api/_lib/device-mockup.cjs`
- `api/_lib/studio-render-core.cjs`
- `api/_lib/studio-render-jobs.cjs`
- `api/_lib/storage-artifacts.cjs`
- `api/_lib/brief-fallback.cjs`
- `features/scout-intake/runner.js`
- `features/scout-intake/brief-renderer*`
- `features/scout-intake/brief-sections.cjs`
- `features/scout-intake/module-brief-builder*`
- any feature module imported by the launched Creative Brief/Deliverables paths

### Admin / Ops Surfaces

- `AdminPage.jsx`
- `OpsOverviewPage.jsx`
- `app/admin/*`
- `app/api/admin/*`
- `app/api/ops/overview/route.js`
- `api/_lib/ops-overview.cjs`

Audit only admin data relevant to launched Creative Brief/Deliverables:

- clients
- dashboard state
- brief runs
- worker status
- render jobs
- deliverable artifacts
- custom briefs
- daily digest if it references launch deliverables

### Config / Rules / Env

- `firebase.js`
- `firebase.json`
- `firestore.rules`
- `firestore.indexes.json`
- `vercel.json`
- `.env.example`
- `next.config.mjs`
- `package.json`

Confirm docs accurately reflect:

- Next/React/Firebase versions
- Stripe tier envs
- worker/cron secrets
- Browserless/studio render services
- Firebase collections used by launch features
- Firestore indexes needed by launch queries
- cron routes actually configured

## Audit Method

### Step 1: Build A Launch Feature Inventory

Produce a table:

| Bucket | Card/Feature | Component | Route/API | Data Source | Writes | Status |
|---|---|---|---|---|---|---|

Rules:

- Include only Creative Brief and Deliverables launch cards/features.
- Mark each as:
  - `real`
  - `derived`
  - `placeholder`
  - `admin-only`
  - `locked/out-of-scope`
- Locked/out-of-scope items should appear only if they are visible in code next to launched cards, and they must not be treated as launch-confirmed.

### Step 2: Map The Data Pipeline

Create an end-to-end map:

1. signup/auth
2. client provisioning
3. dashboard bootstrap
4. run queue creation
5. worker claim/run lifecycle
6. site evidence / module generation
7. Creative Brief generation
8. artifact generation
9. Storage/Firestore persistence
10. dashboard card rendering
11. Deliverables preview/download/ZIP
12. admin visibility/ops tracking

For each step, identify:

- code entry point
- input data
- output data
- Firestore collection/doc path
- Storage path if applicable
- worker/cron/model/third-party service involved
- retry/idempotency behavior
- whether it can run twice
- whether duplicate work is possible

### Step 3: Detect Duplicates And Double Runs

Specifically search for:

- duplicate calls to `/api/worker/run-brief`
- duplicate initial run creation in signup/provisioning
- duplicate Studio render enqueue/processing
- duplicate Knowledge Base embedding calls from launch flows
- repeated Browserless screenshots for the same client/run
- duplicate card data derived from both `dashboard_state` and `brief_runs`
- redundant admin reads that pull the same collection repeatedly
- repeated client bootstrap requests from mounted components
- any interval/poll/subscription that does not clean up

Suggested searches:

```bash
rg -n "run-brief|queueInitial|initialRun|claimRun|completeRun|render-studio|studio-render|embedKnowledgeItemChunks|browserless|dashboard_state|brief_runs|setInterval|setTimeout|onSnapshot|useEffect"
```

### Step 4: Compare Admin Dashboard Claims To Reality

Produce a table:

| Admin Surface | Data Claimed | Data Actually Queried | Missing Launch Data | Fix Needed |
|---|---|---|---|---|

Focus on launch-relevant data only:

- client list
- current dashboard state
- latest Creative Brief
- brief run history
- deliverable artifact refs
- Studio/render job state
- errors/warnings
- worker queue state
- Stripe/payment status only if surfaced in launch dashboard/admin

### Step 5: UI Design System Audit

Inspect only the UI used by Creative Brief and Deliverables launch buckets.

Confirm:

- no card-in-card layout regressions
- no locked feature text presented as available
- mobile layout does not overlap
- buttons/icons match established patterns
- loading/empty/error states exist for launched cards
- downloadable deliverables have clear states when missing
- non-admin launch view is coherent and does not show admin-only actions

Do not redesign unrelated pages.

### Step 6: Documentation Reconciliation

For every technical doc, mark:

- accurate
- stale
- partially accurate
- should be archived
- should be rewritten

Update or create docs so they reflect actual launch code:

Recommended final docs:

- `PRODUCTION-READINESS-TRACKER.md`
- `LAUNCH-DATA-PIPELINE.md`
- `CREATIVE-BRIEF-DELIVERABLES-WIRING.md`
- `ADMIN-DASHBOARD-DATA-MAP.md`
- `PRODUCTION-LAUNCH-CHECKLIST.md`

Do not preserve stale scaffold-era claims unless clearly labeled historical.

## Required Deliverables

At the end, produce:

1. **Launch Feature Inventory**
   - Creative Brief and Deliverables only
   - card/component/API/data source/status

2. **Data Pipeline Map**
   - end-to-end, code-referenced
   - every write/read path
   - duplicate/double-run risk notes

3. **Admin Data Map**
   - what admin pulls
   - what admin does not pull
   - missing launch telemetry

4. **Docs Accuracy Report**
   - doc-by-doc status
   - exact corrections made
   - docs archived or marked stale

5. **UI Design System Launch Audit**
   - launched buckets only
   - mobile/desktop/error/empty/loading checks

6. **Fix PR/Branch**
   - doc corrections
   - small code fixes only if needed to make tracking accurate
   - no broad feature work

## Suggested Branch

```bash
git checkout -b codex/launch-docs-pipeline-audit
```

## Verification Commands

Run after any edits:

```bash
npm audit --audit-level=moderate
npm test
npm run build
npm run smoke:routes
```

If UI code changes are made, also perform a browser pass on:

- `/`
- `/login`
- `/dashboard`
- `/dashboard/studio` only if it supports launched Deliverables
- any preview route used by launched Creative Brief/Deliverables

## Master Prompt For Sonnet/Opus

Use this prompt directly:

```text
You are auditing this repo for public production launch readiness, but only for the launched Creative Brief and Deliverables dashboard navigation buckets. Locked features and non-launch buckets are explicitly out of scope and must not be documented as production-ready.

Your job is to verify the technical documentation and production data pipeline against the actual code. Do not trust existing docs unless the code confirms them.

Create a new branch named codex/launch-docs-pipeline-audit.

Tasks:

1. Inventory every launched Creative Brief and Deliverables card/feature. For each, identify the component, route/API, data source, Firestore collections, Storage paths, worker/model/third-party dependencies, current status, and whether it is real, derived, placeholder, admin-only, or locked/out-of-scope.

2. Map the full launch data pipeline from signup/provisioning through dashboard bootstrap, run queue creation, worker execution, Creative Brief generation, artifact generation, Storage/Firestore persistence, dashboard rendering, Deliverables preview/download/ZIP, and admin visibility.

3. Identify any duplicate or double-run risks: duplicate worker triggers, duplicate brief runs, duplicate Studio renders, duplicate embedding calls, repeated Browserless captures, repeated dashboard bootstrap/admin reads, or uncleaned polling/subscriptions. Fix small obvious issues only if they are safe and directly related to launched Creative Brief/Deliverables. Otherwise document them with file/line references.

4. Audit the admin dashboard and ops routes only for launch-relevant data. Document what admin actually pulls in, what it does not pull in, and what telemetry is missing for Creative Brief/Deliverables launch confidence.

5. Audit the UI design system only for launched Creative Brief and Deliverables views. Confirm mobile/desktop layout, loading/empty/error states, non-admin gating, admin-only controls, and download/missing-asset states. Do not redesign unrelated areas.

6. Review all technical docs for accuracy. Update, replace, or mark stale any docs that misrepresent the current stack, auth model, Stripe tier model, worker/cron model, Firebase collections/rules/indexes, Browserless/Studio render flow, Knowledge Base role, admin dashboard data, or Creative Brief/Deliverables wiring.

7. Produce or update these docs:
   - PRODUCTION-READINESS-TRACKER.md
   - LAUNCH-DATA-PIPELINE.md
   - CREATIVE-BRIEF-DELIVERABLES-WIRING.md
   - ADMIN-DASHBOARD-DATA-MAP.md
   - PRODUCTION-LAUNCH-CHECKLIST.md

8. Run verification:
   npm audit --audit-level=moderate
   npm test
   npm run build
   npm run smoke:routes

Output:
- concise executive summary
- changed docs/files
- launch feature inventory
- pipeline map
- admin data map
- duplicate/double-run findings
- UI/design-system findings
- remaining blockers before public launch
- verification results

Constraints:
- Do not include locked features as production launch scope.
- Do not delete ambiguous files without classifying them first.
- Do not expose secrets.
- Do not force-push or rewrite main.
- Keep edits scoped to docs and small launch-surface fixes.
```

## Completion Criteria

The audit is complete when:

- docs match actual code
- launched Creative Brief/Deliverables wiring is fully mapped
- admin data visibility is documented
- double-run/duplication risks are listed or fixed
- locked features are clearly excluded
- verification commands pass
- remaining launch blockers are explicit and actionable
