# Admin content POC readiness — 2026-10-18

Reviewed local HEAD `3c25a7dd`, including PR #31 in its history, starting from `docs/plans/CONTENT-SYSTEM-STATUS-2026-10-18.md`. Existing uncommitted documentation was preserved. No production actions, paid refreshes, or publishing were performed.

**Decision: not ready for a live end-to-end admin POC.** A supervised draft-only walkthrough is reasonable with agent undo disabled. Fix the findings below before demonstrating unattended fill or live scheduling. This is a focused integration review, not certification of every registry action or production deployment.

## Findings

### P1 — Scheduled daily fill is never invoked

`app/api/worker/daily-loop/route.js:109` checks `handlers.dailyFill`, and line 117 calls it. However, `features/x-strategy/route-handlers.js:1436` returns `dailyFillDeps` but does not export the enclosed `dailyFill` function. `createStrategyHandlersFromDb` returns that same handler object.

Every successfully initialized cron fill therefore returns `ok:true, skipped:'daily-fill-unavailable'` before reading tracks. The manual preview/write paths can work while automatic calendar population never runs. This is a confirmed wiring defect, beyond the status document's “cron unverified” qualification.

Validation: constructed the actual handler factory with inert dependencies; `typeof handlers.dailyFill` was `undefined`, while `typeof handlers.dailyFillDeps` was `object`.

Fix: expose the function or invoke `runDailyFillForCron` with the returned dependencies. Test the actual factory-to-cron contract, including a second run and failure reporting. Missing fill capability must not look like successful completion.

### P1 — Agent undo can re-arm publishing without confirmation

`features/x-strategy/agent/action-runtime.js:496–508` restores complete snapshots through the document store. It does not apply tier resolution, typed confirmation, lifecycle transitions, or schedule validation. `queue.post.unschedule` is tier 1 with a full `social_posts` snapshot (`agent/catalog/queue.js`).

An agent can unschedule a previously scheduled post and then call `undo_action`. This restores `status:'scheduled'`, its old time, approval hash, and old revision directly. If the time has passed, the restored row can become immediately due. The prior scheduling consent does not authorize silently reversing a later cancellation. This also bypasses current slot/collision checks. The compare and restore are separate operations, so concurrent edits can be overwritten between them.

Validation: actual catalog and runtime with the memory store and an injected unschedule mutation; `undo` returned `{ok:true, restored:1}` and restored the scheduled row, without a proposal or typed input.

Fix: refuse raw snapshot restoration that arms publishing. Use lifecycle-aware undo with transactional revision checks; any restored publishing intent must require the same owner confirmation as scheduling.

### P1 — High-res media swaps leave scheduled posts with stale approval

`app/api/dashboard/quote-targets/route.js:858–864` merges media and increments revision while retaining status, schedule, review stamp and approval hash. The staged-original completion path repeats this at `app/api/archive/commands/worker/route.js:93`. Approved and scheduled posts are explicitly eligible for this operation.

`features/social-posting/lifecycle.js:64` includes `mediaUrl` in the approval hash. Its delivery check at line 93 blocks a changed hash. Therefore a scheduled post upgraded to a different original URL still looks scheduled but is parked for review when due. Re-approving an already-approved row also returns early in `approveDraft`, leaving the stale hash unchanged.

Validation: applied the same media-only patch to a v2 scheduled record using the real `contentHash` and `deliveryBlock` functions; delivery returned `approval-stale` while the row remained scheduled.

Fix: route both immediate and worker attachment through the shared material-edit transition. Clear approval and schedule, increment revision, release any schedule reservation as required, and surface the need for renewed approval. Cover draft, approved, and scheduled rows through the real adapters.

### P2 — Paid refresh aliases bypass the single Refresh panel

`features/x-strategy/agent/catalog/ops.js:63–68` registers watchlist and opportunity refresh as paid action cards without `viaRefreshPanel`. Individual X Monitor syncs have the same behavior. `action-runtime.js` only redirects entries explicitly marked with that flag.

These operations still require a confirmation card; this is not evidence of unconfirmed spend. However, confirming them invokes routes within the chat request, bypassing the documented Refresh panel confirm row and its execution workflow. This contradicts the status document's hard rule and preserves timeout/retry risk for long refreshes.

Validation: the real registry/runtime returned `proposal.kind:'action'` for `signals.watchlist.pull`, `signals.opportunities.refresh`, and `xmonitor.sync-profile`, rather than a refresh proposal.

Fix: map all supported refresh aliases to appropriate Refresh groups, or explicitly revise the product contract and implement equivalent execution safeguards. Do not imply every paid refresh uses the panel while these aliases remain available.

## Verification and limits

- Focused registry/runtime, daily fill, high-res and calendar-draft suites: **77/77 passed**.
- Expanded X strategy, content inventory and social posting suites: **1,317/1,318 passed**. The failure is the documented `chat-queue` post-edit executor test at line 147 (`undefined.id` at line 165).
- Broad `npm test` was attempted; render tests encounter `listen EPERM` on localhost in this sandbox, alongside the documented Telegram/chat failures. No clean full-suite result is claimed. Logs: `/tmp/admin-poc-full-tests.log`; focused logs: `/tmp/admin-poc-content-tests.log`.
- No new production build, authenticated browser walkthrough, live cron inspection, paid spend reconciliation, or real agent route execution was completed. Existing live-verification claims in the status doc were not independently repeated.
- The updated placeholder-approval documentation matches `approveInMemory`: approval strips blocking placeholders. Direct schedule paths retain placeholder guards. This does not establish every lifecycle path is correct.

## Acceptance gate after fixes

1. With an isolated client/store, run the real cron wiring: drafts appear; repeating the same fill does not duplicate them; failed fill cannot report healthy completion. Then inspect the next deployed cron execution and durable run state.
2. Drive Strategy chat through create → edit → approve → typed schedule → unschedule. Attempt undo after cancellation and after a concurrent edit; it must not silently re-arm publishing or overwrite newer data.
3. Attach a staged original and a worker-completed original to both approved and scheduled posts. Confirm visible approval invalidation and successful owner re-approval before scheduling.
4. Exercise refresh aliases and verify a single review/confirm flow, accurate completion reporting and spend ledger accounting with one explicitly owner-authorized paid run.
5. Check client isolation across home, UE and NTR, including displayed X identity. Perform a final publish only with the owner's explicit typed confirmation and verify the resulting X post and stored metrics.

Documentation commits or a PR would preserve the handoff, but would not resolve these readiness blockers. No commit or PR was created during this review.
