# Content Management — Phase 0 ownership audit (2026-10-11)

Base: `feat/content-management` @ 882d5582. Baseline `npm test`: 4522 tests / 2 known failures (vendor-api-lib); after Stage B merge 4621 (social-archive +99). Two load-flaky tests (`ffprobe validation…`, `proof-render-worker`) pass in isolation.

## Ownership table

| concern | producers | consumers | store | write path | duplicate? | chosen owner | change needed | risk |
|---|---|---|---|---|---|---|---|---|
| X cadence / floors / caps / engine targets | x-strategy `plan-inputs.js`; `slots.js` (floors default `{quote-react:1}`, `TIER_1_MAX_POSTS=7` clamps plan's 1–16); `daily-loop/config.js` (`MAX_SUGGESTIONS=3`, `SLOT_TIMES`); `engine-quota.js` defaults; `plan-day.js` (own defaults, tier `posts>=8?2:1`); `content-plan.js`/`todayPreview` (no floors/caps passed); calendar route (global `content_system_config/x`); `generate-plan.js` (`postsPerDay`, own times); `PlanPanel` picker | runner, chat, Plan tab, Strategy preview, week calendar | `x_strategy_plans` (+ fallbacks above) | `strategy-plan-apply` | YES (≥8 sources) | `x_strategy_plans` via `resolvePlanInputs` | calendar + previews read resolved plan; remove silent clamp (warn instead); Strategy Builder warns, never schedules | med |
| Shared input context | runner `loadDailyLoopInputs` (scan, packages demo-set, Brain, SB, corpora, plan); chat tools (`get_evaluation`,`get_plan`,`get_today_run`,`search_inventory` = full global inventory, no Brain/SB/scan) | runner, chat | various | read-only | YES (two loaders, different scopes, plan read 3×/turn) | new `loadContentContext` | one loader, versions hash; chat gets `get_context` tool; runner adapter keeps legacy shape | med |
| Brain approval | per consumer (runner status+`requireApproved`; chat none; voice-resolver falls back unlabeled to `brand-voice.json`) | | `clients/{id}/client_brain` | Brain card | partial | approved Brain only | thrown load ⇒ explicit caveat not silent `''`; label fallback | low |
| Campaign (Strategy Builder) | `generate-plan.js` → `dashboard_state.strategyBuilder.lastPlan`; `push` route schedules items directly via `social-posting schedule` (no plan/caps/spacing) | runner (hints only) | `dashboard_state` | `strategy-builder/push` | YES (second schedule) | SB = intent/constraints | push goes through shared allocator; contradiction ⇒ visible warning | med |
| Saved post / edit / approval / schedule | Copywriter, Schedule Posts, route `draft/schedule/post-now`, reply drafts, daily-digest (video + suggested post), `createDraftFromItem`, `saveSuggestionDraft` (atomic `createDraftPostOnce`), quote-targets draft, Discogs ingest, x-oauth bookmarks, scripts | calendar, sweeper, approval page | `social_posts` | `createSocialPost` (random id, no idempotency) except one producer | YES: only `saveSuggestionDraft` idempotent; `createDraftFromItem`/Discogs/digest read-then-create races; `findDraft`/`findExistingDraft` not client-scoped | one service wrapping existing fns | `ensureDraft` (stable idempotency key + client-scoped lookup), extra provenance fields, approval invalidation on any material edit, clearance recheck, reply guard | HIGH |
| Lifecycle states | `twitter-service.js` | | | | n/a | existing machine: draft→approved→scheduled/queued→posting→posted; failed/needs_review/expired/rejected/awaiting_approval | approved-edit invalidation only covers `approved` (not scheduled/queued/awaiting_approval, nor selfReply/media/replyTo edits); `postNow`/`publishApprovedPost` skip `assertSchedulable`; their failures omit `retryable/errorClass` | HIGH |
| Scheduling / slots | `planRecordSchedule` (Discogs), `allocateEngines`/`buildDayPlan` (no pending copies, daily-loop passes no `recentPosts`), CalendarPanel (no check), digest `schedulePost`, quote day-plan | publisher | `social_posts` | `updateSocialPost`/`schedulePost` (validate only approval/story/text — no spacing/cap/collision) | YES (spacing implemented 3×) | new pure `allocatePostSlot` + enforcement at the two write functions | package-collision (same `packageId` in draft/approved/scheduled/queued/posting/needs_review or posted in recycle window); recent posts incl. scheduled; expiry | HIGH |
| Evergreen cooldown | `match.js`/`ledger.js`; scheduler copy (different normalization) | | package `lastPostedAt` | | YES (2 copies) | `match.js` rules, exposed to allocator | pending/scheduled copies must count | med |
| Opportunity expiry | `packageEligibility` (save time only); quote window 36h in select/rank | | | | | allocator + sweep | recheck `expiresAt` at schedule; at delivery ⇒ `needs_review` (never post) | med |
| Reply targets | `create-reply-drafts`, daily-loop `replyTo`, quote drafts | publisher | `social_posts.replyTo` | | | publisher guard | `replyTo` rows currently publish as standalone originals — block schedule/publish (⇒ `needs_review`) until threading supported | HIGH |
| Metrics / results | `performance` on row (null at create), `recordPackagePosted`, `engine-performance` (per-engine only), backfill script (manual) | PerformancePanel | row + package | | | existing | post-level results join (post→package→opportunity→strategy), posted/pending/failed split, missing ≠ 0, caveats | low |
| Input status / worker | refresh request lease (per request), scan `generatedAt` (only in x-calendar card), no global worker heartbeat, no Brain status in engine UI | | | | | new aggregator | strip: Brain, strategy validity, account-data age, scan freshness, refresh status (queued/unknown, never "online") | low |
| Chat | `agent/tools.js` (5 read, 8 propose; confirm-before-write, `claude-sonnet-4-6`, `logAnthropicCall`, daily cap) | | `x_strategy_chats` | `strategy-proposal-decide` | | keep | add queue/opportunity/context/results read tools, selected-item prop; no schedule/publish tool | med |
| Calendar (month WIP) | `80e4c201` | | | `approveAndSchedule`, `rejectDraft` (additive) | | **decision below** | | |

## Client isolation (confirmed)
Global: `x_content_packages`, `content_system_config/x`; handle-keyed corpora default `bai_ee`/`seb__design`; `findDraft`/`findExistingDraft` unscoped; `getSocialPost` skips check when `clientId` falsy; chat/content-plan/week-calendar/inventory-list not owner-gated. Keyed OK: plans, chats, runs, `social_posts` queue, `dashboard_state`, Brain. Loader labels inventory/corpora `scope:'global'`; `assertOwnerClient` stays.

## Configured sweepers / model & network calls
- `vercel.json`: `process-due` daily `40 13`; digest/render/reconcile crons daily. Not changed.
- `.github/workflows/social-publish-sweep.yml` `*/30`, inert unless `vars.SOCIAL_PUBLISH_ENABLED=='true'` (unverifiable from code). Vercel daily cron also calls `process-due` ⇒ two publish paths (claim makes overlap safe). launchd publish-due plist documented RETIRED. None touched.
- Model calls: `enhancePost` (copywriter only), daily-loop model drafter (off in my checks), strategy chat (sonnet-4-6). Scheduling/allocation/calendar: none. Publish path = X API (mock-only in tests).

## Month-calendar WIP decision: ADOPT UI ONLY
`80e4c201` service edits are additive in text (`rejectDraft`, `approveAndSchedule`, 2 route actions, read-only `month-calendar` action, exports in `week-calendar.js`) but `approveAndSchedule` is a new go-live path that bypasses nothing yet adds no clearance/collision recheck, and it deletes `CalendarPanel.jsx`. Take `MonthCalendarPanel`/`PostSheet`/`calendar-bits`/`month-calendar.js` + its 12 tests; re-implement approve-and-schedule/reject through the shared lifecycle service (clearance + collision + reply guard). Keep `CalendarPanel.jsx` until the month panel passes the Phase 4 walkthrough. Resolve `XContentEngineCard.jsx` by hand.

## Behaviour changes to existing production paths (all via shared service, legacy-compatible)
1. Editing `scheduled`/`queued`/`awaiting_approval` text/media/selfReply/replyTo voids approval (new rows carrying `lifecycleVersion`; legacy rows without it keep today's behaviour for the `approved`-only rule).
2. `schedulePost`/`updateSocialPost(scheduledAt)` run collision + clearance + reply guard + spacing/cap check; legacy opt-out flag `force` not offered.
3. `replyTo` rows can no longer be scheduled/published as originals.
4. `createDraftFromItem`/Discogs lookups become client-scoped and cover all open statuses.
5. `postNow`/`publishApprovedPost` failures gain `retryable/errorClass`.
Daily-digest auto-publish row and approval-token flow: unchanged (characterized).

## Baseline failures
`vendor-api-lib` ×2 (known). Flaky under full-suite load: `ffprobe validation…`, `proof-render-worker` (pass alone).
