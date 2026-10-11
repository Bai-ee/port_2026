# Content Management normalization — build log

Worktree `~/Documents/Repos/Bballi_Portfolio-content-mgmt`, branch `feat/content-management` (from `feat/daily-content-loop` @ 6012feec). Dev server `:3005`.

## Stage A (2026-10-11)
- Calendar + content-system worktrees verified clean at WIP commits `80e4c201` / `38f38a38`. Not touched.
- Baseline `npm test`: 4522 tests, 2 failures (the 2 known vendor-api-lib tests). Matches expectation.

## Stage B — merge `6eb9dfd8` (social-archive timeline)
- Conflicts: `quote-targets/route.js` (kept both import sets + both action branches), `XContentEngineCard.jsx` (kept U2 shell; `timeline` tab id added to `MORE_TABS` + `MOBILE_MORE_TABS`; both CSS blocks kept).
- Decision: `__fixtures__/x/**` are gitignored by the repo-wide `data/` rule and were never committed in `6eb9dfd8`, so 6 X-adapter tests failed. Copied the synthetic fixtures read-only from the content-system worktree and `git add -f`'d them (24K, "Fixture User", example.invalid URLs).
- Tests after: 4621 total; social-archive 95/95. Full-suite run showed 2 additional load-flaky failures (`ffprobe validation…`, `proof-render-worker`) that pass in isolation (worker 29/29) — environmental, not caused by the merge.
- Fresh reviewer on the resolution: no findings.
- ⚠️ Live check on :3005 NOT DONE: dashboard redirects to `/login`; agent may not enter credentials. Needs the owner to sign in once at http://localhost:3005 (Chrome session) — then rerun the live gate. Marked NOT VERIFIED until then.

## Phase 0 — audit + characterization
- Audit: `docs/plans/content-management-audit.md` (5 parallel read-only agents; table + behaviour-change list).
- Month-calendar WIP `80e4c201`: **ADOPT UI ONLY** (decision + reasons in the audit). Agent note: it ran `git cherry-pick -n` then `--abort`/`reset --hard` in this worktree to test applicability; tree was fully committed beforehand so nothing was lost (verified HEAD 882d5582 clean, `.env.local` intact). Process lapse logged; future agent briefs forbid git writes.
- Characterization tests (committed BEFORE any behaviour change; unmodified production code): 10 files, ~159 tests — lifecycle (31), copywriter/schedule-posts/approval-token+route/auto-publish row (65), item-actions/daily-loop-review/discogs-scheduler/engine-quota+slots/plan-inputs (63). Known gaps pinned as `CURRENT (known gap): …` — when a phase fixes one, the pinned test is updated deliberately in the same commit and called out.
- Full suite: 4779 tests, only the 2 known vendor-api-lib failures.
- Limit: `findDraft` in quote-targets route is a closure; characterized via its caller only.

## Phase 1 — one plan + shared context
- New `features/content-context/load-content-context.js`: `loadContentContext` (wraps the runner's `loadDailyLoopInputs`, reads the plan doc ONCE, adds per-input `{source, asOf, usable, caveats, version, scope}` + a `versions.hash`), `summarizeContentContext`, `resolveCalendarEngineConfig`.
- Runner (`handleDailyRun`) now reads inputs via the shared loader (`.raw` = legacy shape, same fingerprint). Brain load throw is captured as an explicit caveat (`usable:false`) instead of a silent `''`.
- Chat: new read tool `get_context` (+ prompt mention); `search_inventory` unchanged (still global; the context flags inventory `scope:'global'`).
- Week calendar: saved plan's `engineTargets` win ONLY when a plan doc with targets exists; otherwise legacy `content_system_config/x`. Behaviour change for plan-doc clients (global override no longer merged for them).
- Plan ≥8/day: runner still caps at 7 (characterized); now emits a visible `plan-clamped` gap + a plan caveat instead of cutting silently.
- Strategy Builder contradicting the saved plan's posts/day ⇒ caveat "The plan wins"; it never schedules anything in this loader. (SB `push` route scheduling is addressed in Phase 3 via the shared allocator.)
- Review (fresh Sonnet): no blockers. Fixed: NaN ages no longer read as fresh; corpora-handle-scope caveat; stale comments. Open (accepted): chat `get_context` is admin-gated, not owner-gated (as all other strategy chat tools); output has counts/dates only.
- Tests: +17 (loader 13, get_context tool 2, plan-clamped 2); updated `agent-tools.test.js` deliberately (5→6 read tools, 13→14 schemas). Full suite 4796 tests, only the 2 known failures.
- Live check: NOT VERIFIED (login wall, see Stage B).

## Phase 2 — one post lifecycle
- New pure `features/social-posting/lifecycle.js` (status sets, `packageClearance`, `replyBlock`, `findPackageCollision`, `isMaterialEdit`, `deliveryBlock`) used by `twitter-service.js`.
- Decision (compat): `lifecycleVersion: 2` is OPT-IN, set by the shared producers (`ensureDraftPost`, daily-loop save). Legacy rows keep today's publish/edit behaviour (pinned by characterization). Schedule-time guards apply to every row because they only refuse a NEW scheduling action.
- Service additions: `ensureDraftPost` (stable key → one durable draft; terminal rows roll to the next key generation), `findOpenPostForPackage` (client-scoped, any open status), additive provenance (`idempotencyKey, runId, suggestionId, strategyVersion, channel, expiresAt, lifecycleVersion`).
- New rules: reply rows cannot be scheduled (threading unsupported); clearance revoked (`never-public` / package `approval.rejected`) blocks scheduling and, for v2, delivery (⇒ `needs_review`, platform never called); one package can't be scheduled twice per client (`package-already-pending`); v2: any material edit (text/self-reply/media/reply target) of approved/scheduled/queued voids approval + schedule, v2 scheduling requires prior approval; v2 expired window ⇒ `needs_review`; `postNow`/`publishApprovedPost` failures stored `retryable:false` + `errorClass`.
- Producers rewired: `createDraftFromItem` (reuse any open row, client-scoped lookup, `ensureDraft` key `item:<pkg>`), `saveSuggestionDraft` (provenance + v2), Discogs `findExistingDraft` (client-scoped). Route `findDraft` now `findOpenPostForPackage(context.clientId, …)`.
- Characterization updated deliberately (prefix `PHASE 2:`): post-now/approved-publish failure fields (3 tests), item-actions gaps (approved row now reused, client-scoped lookup, 3 tests), daily-loop review provenance.
- Review (fresh Sonnet): no blockers. Fixed: (1) terminal-row key wedge → key generations; (2) `approval.state:'needed'` no longer blocks an already-approved post (legacy compat); (4) `needs_review` no longer wedges a package; (5) edit + resent schedule time stays draft. Documented limits: collision check is read-then-write (concurrent schedulers can still race); legacy reply drafts can no longer be scheduled (previously went out standalone) and already-scheduled legacy reply rows still publish unchanged (v2-only delivery guard) — flagged for the handoff.
- Tests: +23 (`lifecycle-phase2.test.js`) +provenance/discogs tests; full suite 4826, only the 2 known failures.

## Phase 3 — unified schedule + reuse
- New pure `features/x-content-inventory/allocate-slot.js` (`allocatePostSlot`: occupied/spacing/per-day/engine caps, package collision, expiry; `recentPostsFromQueue` adapter onto engine-quota's axis = CT wall clock as UTC epoch). Records scheduler (`discogs-ingest/scheduler.js`) now shares its helpers and skips a draft whose package is already pending (and schedules only one of two same-package drafts) — characterization updated deliberately (`PHASE 3:`).
- Runner: optional `readRecentPosts` dep; the route injects `recentPostsFromQueue(readSocialQueue)` so scheduled/queued/approved copies count toward today's quota (empty queue ⇒ unchanged). Review caught a day-window bug (post times not on the quota axis) — fixed + tested; `readRecentPosts` failure falls back to the old behaviour.
- Month-calendar WIP: **UI only** adopted (`MonthCalendarPanel`, `PostSheet`, `calendar-bits`, `month-calendar.js`, +7 tests, CSS block into the card). Server side re-implemented through the shared lifecycle: `approveAndSchedule` (edit → approveDraft → schedule; ANY failure restores the row exactly), `rejectDraft` (unscheduled draft/needs_review/approved only), route actions `approve-and-schedule`, `reject-draft` (social-posting) and `month-calendar` (quote-targets, read-only, plan-driven engine config). Calendar tab now mounts the month panel.
- Timely-window rule (`expiresAt` passed, or slot after the window) is v2-only at schedule time (legacy Schedule Posts/Copywriter unchanged); delivery re-check for v2 already parks to `needs_review`.
- Backlog: approved unscheduled rows stay in the week view's `unscheduled` list for every later week (tested); failed/expired never occupy a slot. Replies (`replyTo`) are excluded from both calendars by existing design.
- Review (fresh Sonnet): no blockers. Fixed: quota day-window axis, Reject on approved rows, approveAndSchedule rollback (wholesale restore), legacy window rule gated to v2, epoch `expiresAt`, readRecentPosts catch.
- Left (documented): `CalendarPanel.jsx` + `week-calendar` route action are now unmounted/unused — delete after the live walkthrough passes (not possible here, login wall); PostSheet has no focus trap/restore and has single-key `A` (approve+schedule) outside inputs — owner call; month proposals don't consider `expiresAt` (server refuses with a toast); `awaiting_approval` v2 rows aren't displayed on the calendar; Strategy Builder `push` still schedules directly (warning only via context caveat).
- Gate: full suite 4863, only the 2 known failures. Live check NOT VERIFIED.

## Phase 4 — one workspace, contextual chat
- Nav (labels/grouping only, tab ids unchanged so saved-tab storage stays valid): **Today** (Plan | Recommendations switch, now at every width) · **Library** · **Queue & Calendar** · **Strategy**; More = Buckets, Timeline, Clients, Results. Phone bottom nav: Today · Library · Queue · Strategy · More.
- Daily flow inside Today → Recommendations: inspect → edit → Save draft → (same post id) status line + "Publish at (your local time)" + **Approve & schedule** (explicit click; calls `approve-and-schedule`; disabled for replies/past times) → "Open in Queue & Calendar" for the status/calendar. Status comes from new read-only action `post-status` (client-scoped, ≤20 ids).
- Input status strip (`InputStatusStrip.jsx`, shown on Today/Queue): Brain approval, strategy plan, account data (corpora) age, scan freshness, each with source/as-of/caveats and a direct remedy; refresh worker row always says **status unknown** (no heartbeat exists) and that a stuck "queued" request means the worker isn't running. Data from new action `content-context` (the shared loader).
- Chat: new READ tools `get_queue`, `get_post`, `get_opportunities`, `get_results` (+ `get_context` from Phase 1); no tool takes a client id; propose-only surface unchanged (asserted: no schedule/publish/approve tool); `selected: {kind,id}` resolved server-side for the request's own client and labelled RECOMMENDATION / SAVED POST / APPROVED-SCHEDULED POST (other statuses neutral); selected text quoted as untrusted data; prompt: approve/schedule/publish are owner button clicks only.
- Route readers added to the existing quote-targets route: `readQueueSummary`, `readPost`, `readOpportunities`, `readResults` (null metrics stay null).
- Review (fresh Sonnet): no blockers. Fixed: rejected/failed/posted wrongly labelled approved/scheduled; datetime-local zone confusion (label + CT preview); selected-text injection framing; alias cleanup. Accepted limits: PostSheet no focus trap; reviewer note that `approve-and-schedule` skips spacing/cap (it does run clearance/reply/collision/window via `updateSocialPost`); spacing/cap are enforced only by automated schedulers + advisory flags.
- Verification: full suite 4870 (only the 2 known failures); SSR smoke render of MonthCalendarPanel + InputStatusStrip with fixtures OK; JSX compiles. **Live walkthrough at 1280/400px NOT VERIFIED** — needs the owner to sign in at http://localhost:3005 (login wall; agents may not enter credentials).

## Phase 5 — results + operational clarity
- New `features/x-content-inventory/results.js` `buildPostResults` (pure): Posted / Waiting / Needs attention (failed, expired, held `needs_review` with reason) separate from engagement; metrics `null` ⇒ "not measured yet", real 0 stays 0; provenance (plan version, run, package title); caveats (stored captures only, refresh does not backfill, likes-based, not causal, sample size). Route action `post-results` (client-scoped queue; package titles by the post's own `packageId`). `PerformancePanel` shows it under the engine table (`postResults` prop; hidden when absent). Review fixes: held rows sort first so the 50-row cap can't hide them; header counts match the lists ("showing X of Y"); "daily backfill" wording corrected (backfill is manual).
- Input status strip gained a collapsed Setup & help block (scan install, refresh worker, publishing).
- Runbook + owner table: `docs/source-of-truth/CONTENT-MANAGEMENT.md`; pointers added to `X-GROWTH-SYSTEM.md` and `X-STRATEGY-TAB.md`. Reviewer-corrected: Mac launchd publish sweep is retired, sweep secrets named, local-ingest env, `--install` dry-run note.
- "Video handoff" requirement: SKIPPED — no such file exists.

## Phase 6 — acceptance
- `features/content-context/__tests__/acceptance.test.js`: ACCEPT 0–8 over fixtures with the fake Firestore and the mock X client (the mock publisher is the only publisher reachable; ACCEPT 0 asserts tweets only grow via the test's own sweep). All 9 pass.
- Findings from writing them (not bugs): a *reply* suggestion can be saved but not scheduled (reply-threading-unsupported) — UI shows a message and disables the button; `saveSuggestionDraft` ignores new text once saved (later edits go through `updateSocialPost`); the suggestion carries brand fit as `why.brand` / `scores.brandFit` (nullable for slot suggestions).

## Totals
- Model spend: **0 calls / $0**. Firestore writes: **none** (no `[CM test]` rows were created; nothing for the owner to delete). X API / ScrapeCreators calls: none. No push, deploy, workflow/cron/launchd change, `client_configs` write or Brain approval.
