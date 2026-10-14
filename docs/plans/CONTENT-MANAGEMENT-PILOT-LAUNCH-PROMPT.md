# Owner-pilot launch — orchestrator prompt (no-stop, multi-agent)

> **Superseded 2026-10-14 (multi-client):** owner-only gates, the global content inventory, the single @bai_ee account and Seb/Hitloop defaults described below were replaced; as-built = docs/source-of-truth/CONTENT-PILOT-OPERATIONS.md §1b–1f and docs/plans/MULTI-CLIENT-FINAL-PASS.md.

You are the Sonnet orchestrator. Implement `docs/plans/CONTENT-MANAGEMENT-PILOT-LAUNCH-HARDENING.md` (binding) start to finish, Phases 0–5, as one continuous run. Phase 6 (deployed launch) is NOT in scope — prepare it, do not execute it. Where this prompt and the hardening plan differ, this prompt wins.

## Execution style
- Run all phases in order without stopping for approval. Within each phase, fan out parallel Sonnet sub-agents on disjoint files. Re-spawn a failed sub-agent once, then take the work yourself.
- The orchestrator alone owns: `features/social-posting/twitter-service.js`, `features/social-posting/lifecycle.js`, the reservation/ledger module, route files (`app/api/social-posting/route.js`, `app/api/dashboard/quote-targets/route.js`), `features/content-context/load-content-context.js`, `XContentEngineCard.jsx`, `vercel.json`, all git commits and merges.
- Sub-agent briefs name exact owned files and forbid every git write command (`commit`, `reset`, `checkout`, `cherry-pick`, `stash`, `merge`). A previous run had an agent run `reset --hard`; never again.
- Good-enough working code first: small changes to shared paths, short as-built docs. Fix the underlying shared path — no new wrapper that leaves the race behind. No cosmetic refactors or file-size decomposition.

## Known state (verify, don't assume)
| Item | State |
|---|---|
| Base | worktree `~/Documents/Repos/Bballi_Portfolio-content-mgmt`, branch `feat/content-management` @ `da811b6b` — normalization COMPLETE and committed. Read `docs/plans/CONTENT-MANAGEMENT-ORCHESTRATOR-PROGRESS-HANDOFF.md`, `docs/source-of-truth/CONTENT-MANAGEMENT.md`, `docs/plans/content-management-build-log.md`, `docs/plans/content-management-audit.md` first. |
| Pilot worktree | create `~/Documents/Repos/Bballi_Portfolio-pilot`, branch `feat/content-pilot` from `da811b6b`. Copy `.env.local` (never commit). Dev server: `npm run dev -- -p 3006`. |
| Main checkout `~/Documents/Repos/Bballi_Portfolio` | NEVER edit (unrelated uncommitted media work). Ignore its "work in the main checkout" wording in older docs. |
| `-calendar` (80e4c201), `-content-system` (38f38a38), `-daily-loop`, `-ce-ui`, `-content-mgmt` | do not edit. |
| Baseline | expect ~4888 tests, 2 known failures (vendor-api-lib ×2); `ffprobe validation` and `proof-render-worker` can flake under load. Record actual baseline in Phase 0. |
| Owner client | `bryan-balli-WUoltG84` (@bai_ee). |

## Decisions already made by the owner (do not re-ask)
1. **Vercel is now Pro, not Hobby.** The 12-function cap and daily-only cron limit no longer apply. Publisher: the existing Vercel cron `process-due`, changed in `vercel.json` to every 15 minutes (`*/15 * * * *`). Set `STALE_DUE_MS` (`twitter-service.js:290`, currently 26h) to a value comfortably above the new period (e.g. 2h) and update its characterization test + comment. This is a local commit only — it takes effect on deploy. Keep the GitHub `social-publish-sweep.yml` as the documented fallback, disabled (`SOCIAL_PUBLISH_ENABLED` unset) — exactly ONE publisher active; document why. Still: do not edit other crons, `.vercelignore`, or `maxDuration` tiers; prefer existing routes over new route files. Update `docs/source-of-truth/VERCEL-HOBBY-DEPLOYMENT.md` with a short "now on Pro" note (don't rewrite it).
2. **Reply scheduling block applies to NEW posts only.** Revert normalization's all-rows "reply rows can't be scheduled" guard so legacy reply rows (no `lifecycleVersion: 2`) schedule as before; v2 reply posts stay blocked from standalone scheduling/publishing. Characterization tests prove legacy parity.
3. **Manual scheduling enforces the plan by default.** Keep an explicit override only if cheap: owner-only, a visible "override plan" confirm, audited on the post (`planOverride: {by, at, reason}`). Otherwise remove the override.

## Concrete design guidance (use unless code proves it wrong; log deviations)
- **Owner boundary (Phase 1):** one shared capability check (`requirePilotOwner` or similar, in an existing lib dir) layered on the existing admin context: allowlists from env `PILOT_OWNER_UIDS` and `PILOT_CLIENT_IDS` (names only in docs; local defaults to the owner). Resolve clientId server-side; never trust body/UI/model clientId. Apply at the Content Management boundary (quote-targets content actions, chat tools, approve-and-schedule/reject-draft, month-calendar). Copywriter, Schedule Posts and Social Auto-Publish approval tokens keep working for other clients — audit, don't blanket-gate.
- **Reservations (Phase 2):** Firestore transaction over a per-client per-day ledger doc (e.g. `x_schedule_ledger/{clientId}_{YYYY-MM-DD}` on the CT axis; also read the adjacent day when spacing crosses midnight) holding occupied slots + engine counts, plus a package reservation doc (`x_package_reservations/{clientId}_{packageId}`). Every scheduler (web, approve-and-schedule, Discogs records scheduler, daily loop, Strategy Builder push) goes through it. Release on reject, unschedule, reschedule, expiry and terminal delivery. No composite indexes (repo rule).
- **Revisions:** add `revision` (int) to `social_posts`; missing = 0. Material edits and approvals require the expected revision; `approveAndSchedule` uses an atomic transition, never a whole-doc restore. Repeated requests return the existing result.
- **Ambiguous publish outcome** ⇒ `needs_review`, never auto-retry. Document reconciliation by platform ID.

## Phase order and owner sign-in
Phases 0 → 1 → 2 → 3 → 5 run first (no browser needed). Phase 4's live walkthrough needs the owner signed in (agents never enter credentials): start the dev server on :3006 at the beginning of Phase 4, write `READY FOR SIGN-IN: http://localhost:3006` to the build log and your output, then continue all remaining non-browser work (Phase 4 code fixes, docs, migration report, review) while waiting. Run the browser walkthrough when a signed-in session is available; if it never becomes available, mark the walkthrough NOT VERIFIED and finish everything else. Do not fake it with SSR renders.

Phase 4 must also cover the normalization leftovers: PostSheet focus trap/restore; remove or confirm-gate the single-key `A` approve+schedule hotkey; show `awaiting_approval` and `needs_review` on the calendar; month proposals respect `expiresAt`; after the walkthrough passes, delete orphaned `components/dashboard/x-content/CalendarPanel.jsx` and the unused `week-calendar` action.

## Authorizations
- Local commits on `feat/content-pilot` only. No push, deploy, workflow/worker/launchd activation, or env changes on Vercel.
- Firestore: **read-only** reads of owner rows are allowed for the Phase 3 legacy dry-run report (`docs/plans/content-pilot-legacy-report.md`). No live row mutation, migration or cancellation. Walkthrough writes: ≤5 draft posts prefixed `[CM test]` for the owner client, plus `x_strategy_*` and reservation/ledger docs they create; list them for cleanup in the handoff. Never approve-and-schedule a test row into a slot the live cron could publish — use a time ≥30 days out or reject it afterwards (the local dev cron does not run, but production shares Firestore).
- Model calls: ≤10 / $0.50 total (`claude-sonnet-4-6`), each logged in the build log. Prefer fixtures.
- No X API, no ScrapeCreators, no publishing; publisher in tests is a mock. No `client_configs` or Brain changes.
- Never run `npm run build` while a dev server runs in the same worktree — stop it first (or build in a throwaway copy) and restart after.

## Gate per phase
Failure-case tests (competing schedulers, concurrent edit during approval, duplicate action, stale approval, wrong-client read/write/late response, reply/clearance/expiry, crash recovery, reservation release) → full `npm test` at baseline → fresh read-only reviewer sub-agent on the phase diff → fix substantive findings → build-log entry in `docs/plans/content-pilot-build-log.md` → commit. Cut an item after 3 failed attempts; log it as a limit.

## Hard stops (the only reasons to stop)
1. New uncommitted changes appear in the `-calendar`, `-content-system` or `-content-mgmt` worktrees.
2. An item needs a guardrail breach (push/deploy/publish/X API/paid beyond budget/client_configs/Brain/live-row mutation): mark it BLOCKED, continue; stop only when nothing else remains.
3. A characterization test of existing live behaviour can't stay green: revert that change, mark BLOCKED, continue.
Everything else: decide, log, continue.

## Final handoff (in the build log and your final message)
Worktree/branch/commits; resolved vs remaining findings; what was browser-verified vs fixture-tested vs assumed; simple owner walkthrough; production runbook (env names, cron cadence, the one active publisher, local scan worker, spend visibility, indexes/bundling); deploy + rollback procedure; legacy dry-run report summary with the exact authorization needed to apply it; `[CM test]` cleanup list; separate customer-access checklist (doc only, access stays disabled); repo-map line for `CLAUDE.md`. Never call it production-ready from local tests.
