# Content Management (X) — as built

> **Marketing Director unification (2026-10-13, POC, admin only, uncommitted on `feat/marketing-director-poc`):** For admins the Content Center (`x-content`) is now content only: tabs are **Library · Buckets · Timeline · Clients**, `extraCategories:['social']` is gone, and the Today / Calendar / Strategy / Results / Telegram panels this doc describes as Content Center tabs now mount as the Marketing Director cards Today, Queue & Calendar, Strategy, Results and Publishing settings (same panels, same `quote-targets`/`social_posts` backends, `.xce-scope` style scope). Stale for admins: any reference to the tab names above inside the Content Center, and to manual Generate/Refresh/reload buttons on those panels (hidden; use the Marketing Director header Refresh, group 5). Non-admin behavior is unchanged. See [`MARKETING-DIRECTOR.md`](MARKETING-DIRECTOR.md).

Status: shipped to `main` in the content-system release (2026-10-11) with the owner-pilot hardening ([`CONTENT-PILOT-OPERATIONS.md`](CONTENT-PILOT-OPERATIONS.md)). Live posting batches, the GitHub sweep and the local worker remain owner actions. Plan: [`docs/plans/CONTENT-MANAGEMENT-NORMALIZATION-MASTER-PLAN.md`](../plans/CONTENT-MANAGEMENT-NORMALIZATION-MASTER-PLAN.md). Audit: [`content-management-audit.md`](../plans/content-management-audit.md). Build log: [`content-management-build-log.md`](../plans/content-management-build-log.md).

Developer handoff for the release PR: [`docs/DEVELOPER-HANDOFF-CONTENT-SYSTEM.md`](../DEVELOPER-HANDOFF-CONTENT-SYSTEM.md).

One workspace (the **Content Engine** card) takes content from find → select → draft → review → approve → schedule → track. Scanners, NAS/archive, Brain, Strategy Builder and the publisher stay as services behind it.

## 1. Who owns what

| Concern | Owner (after) | Others |
|---|---|---|
| Voice, identity, claims | Approved Client Brain | read via `loadClientBrainContext`; unapproved ⇒ not used, labelled |
| Campaign intent | Strategy Builder (`dashboard_state.strategyBuilder.lastPlan`) | constraints only; contradicting the saved plan ⇒ visible caveat, plan wins |
| Executable X plan (cadence, floors, caps, engine targets) | `x_strategy_plans` via `resolvePlanInputs` | runner, chat, calendar read it; no plan ⇒ legacy defaults |
| Content assets | `x_content_packages` (+ buckets) | **global, not client-scoped** (flagged `scope:'global'`) |
| Raw scan signals | `dashboard_state.marketingBrief.quoteTargets` | read-only here |
| Recommendation (not a post) | `x_content_daily_runs` | regeneration never touches a saved post |
| Saved post / edits / approval / schedule | `social_posts` via `twitter-service.js` | every producer goes through it |
| Delivery | existing publisher (`claimDuePost`, `process-due`) | unchanged for legacy rows |
| Results | stored `social_posts.performance` joined to package/run/plan | |

## 2. Shared input context
`features/content-context/load-content-context.js` — `loadContentContext(deps, {clientId, now})` wraps the runner's `loadDailyLoopInputs` (shape unchanged as `.raw`), reads the plan doc once, and returns `inputs[]` (`{id, source, asOf, usable, caveats, version, scope}`) plus `versions.hash`. Used by the daily runner, chat tool `get_context`, and the dashboard status strip (`content-context` action). Thresholds: scan stale > 48 h, corpus stale > 7 d. A Brain load that throws is a caveat (`usable:false`), never a silent empty string.

## 3. Post lifecycle (`social_posts`)
`draft → approved → scheduled/queued → posting → posted`; also `awaiting_approval`, `failed`, `needs_review`, `expired`, `rejected`. Save Draft ≠ approval ≠ scheduling.
- **Producers**: `ensureDraftPost(clientId, {idempotencyKey,…})` is the shared entry (key → one post id; a terminal row rolls the key to the next generation). Wired: daily-loop save (`createDraftPostOnce`, v2), `createDraftFromItem` (key `item:<pkg>`, reuses any open row, client-scoped), Discogs ingest lookup (client-scoped). Copywriter, Schedule Posts, digest, quote drafts, bookmarks still use `createSocialPost` (legacy rows).
- **`lifecycleVersion: 2`** (opt-in, set by the shared producers): any material edit (text/self-reply/media/reply target) of approved/scheduled/queued voids approval and the schedule; scheduling requires prior approval; delivery rechecks clearance, reply guard and expiry and **parks the row as `needs_review` without calling X**. Legacy rows publish exactly as before.
- **Schedule-time guards (all rows)**: reply rows cannot be scheduled (threading unsupported); package clearance revoked (`rights:never-public` or `approval.state:rejected`); the same package can't be scheduled twice per client (`package-already-pending`); v2 only: timely `expiresAt` window.
- **Failure**: `postNow`/`publishApprovedPost` failures are stored `retryable:false` + `errorClass`; nothing re-sends them.
- **Calendar actions**: `approve-and-schedule` (edit → approveDraft → schedule; any failure restores the row exactly) and `reject-draft` on `/api/social-posting`; explicit operator clicks only.
- **Clearance vs approval**: package clearance = "may this material be used" (package store); post approval = "may this exact copy go out" (`reviewedAt`/status). Both are checked.

## 4. Scheduling
`features/x-content-inventory/allocate-slot.js` (pure): occupied slots, spacing, per-day/engine caps, package collision, expiry; shared helpers used by the records scheduler (`discogs-ingest/scheduler.js`, which now skips a package already pending). `recentPostsFromQueue` puts scheduled/queued/approved/posted rows on engine-quota's axis (CT wall clock as UTC epoch) so today's plan counts them. Calendar engine config = saved plan's `engineTargets` when a plan doc exists, else legacy `content_system_config/x`.
**Pilot update (see [`CONTENT-PILOT-OPERATIONS.md`](CONTENT-PILOT-OPERATIONS.md)):** scheduling is now transactional (`features/social-posting/reservations.js`: post + CT-day ledger + package reservation in one transaction), plan spacing/per-day/engine-daily caps are enforced for pilot clients on every schedule path (web, approve-and-schedule, records scheduler, Strategy Builder push, digest), and edits/approvals are revision-checked. Weekly engine caps/share are not enforced; `post-now` is not plan-checked.

## 5. Workspace
Tabs: **Today** (Plan | Recommendations) · **Library** · **Queue & Calendar** (month grid + agenda, post sheet) · **Strategy** (+ chat) · More: Buckets, Timeline, Clients, Results. Input status strip on Today/Queue: Brain, plan, account data, scan; refresh worker line shows "last seen N min ago" from the worker heartbeat (or "never reported"; never online/offline). Daily flow in Recommendations: inspect → edit → Save draft → status + time picker → **Approve & schedule** → Open in Queue & Calendar. `CalendarPanel.jsx` and the `week-calendar` route action were removed after the live walkthrough (the week grid helper `week-calendar.js` stays: the month calendar imports it).

## 6. Chat
Read tools: `get_evaluation, get_plan, get_context, get_today_run, search_inventory, top_posts, get_queue, get_post, get_opportunities, get_results`. Propose tools unchanged (8; confirm-before-write via `strategy-proposal-decide`). No tool schedules, approves or publishes; the prompt says so. `selected:{kind,id}` is resolved server-side for the request's own client and labelled RECOMMENDATION / SAVED POST / APPROVED-SCHEDULED POST; quoted item text is marked as data. Model `claude-sonnet-4-6`, `logAnthropicCall` (`x-strategy-chat`), daily turn cap `X_STRATEGY_DAILY_TURN_CAP` (60).

## 7. Results
`features/x-content-inventory/results.js` `buildPostResults` (all-time, unlike the 30-day engine table; drafts and rejected posts are not listed; held `needs_review` rows sort first so the 50-row cap never hides them; `{posted, pending, failed, counts, caveats, lastCapturedAt}`; rows carry provenance and `metrics: null | {...}`; route action `post-results`; shown in the Results tab under the engine table): Posted / Waiting / Needs attention separate from engagement; metrics `null` ⇒ "not measured yet" (never 0); provenance (plan version, run, package) shown; caveats: stored captures only, a refresh does not backfill views, lift is likes-based and not causal. Views backfill is manual: `scripts/x-content/backfill-performance.mjs`.

## 8. Runbook (what must exist for this to work end to end)
- **Env (server/Vercel) — see CONTENT-PILOT-OPERATIONS.md for the authoritative list; the pilot added `PILOT_OWNER_UIDS` and `PILOT_CLIENT_IDS` (fail closed in production/preview):** Firebase admin, `ANTHROPIC_API_KEY` (chat enhance/draft only), `CRON_SECRET` for `/api/worker/*` (never curl worker routes locally: CRON_SECRET is unset in dev and they actually run), X app credentials for publishing. The owner pilot added `PILOT_OWNER_UIDS`, `PILOT_CLIENT_IDS` (required, fail closed) and optional `PILOT_ALERT_*`.
- **Authenticated routes:** `/api/dashboard/quote-targets` (admin) and `/api/social-posting` (session). New actions only; no new route files, the only `vercel.json` change is the `process-due` cadence (`*/15`, see CONTENT-PILOT-OPERATIONS.md).
- **Local worker (Mac, needs `bird` + browser cookies):** quote scan `scripts/x-content/install-scan-schedule.sh install <clientId>` (launchd 06:30; not installed by this work); strategy refresh `X_STRATEGY_BIRD_COOKIE_SOURCE=chrome node scripts/x-content/strategy-refresh-worker.mjs --once`. The refresh worker writes a heartbeat (`x_strategy_workers`) on every poll once it runs the pilot version; a refresh request stays "queued" until a worker drains it (or the server drains it in-process when `X_STRATEGY_LOCAL_INGEST=1` and `bird` is present). `install-daily-loop` is a dry run unless `--install` is passed.
- **Publishing:** scheduled posts publish via `process-due` — Vercel cron `*/15 * * * *` (Vercel Pro; 2 h staleness guard) and, only if the owner sets repo variable `SOCIAL_PUBLISH_ENABLED=true`, `.github/workflows/social-publish-sweep.yml` (`*/30`). The sweep also schedules story-ready Discogs records first, needs the GitHub secrets `HITLOOP_CRON_SECRET` and `HITLOOP_ARCHIVE_WORKER_TOKEN`, and calls `https://hitloop.agency`. The Mac launchd publish sweep (`scripts/social/`) is retired: do not install it (`scripts/social/README.md` still shows stale secret/scheduler wording). Publishing takes an atomic claim, so overlap is safe but wasteful. Nothing was enabled or disabled here.
- **Assets:** NAS/EditVideos media must be reachable for posts with media; not exercised.
- **Model usage:** only chat turns and optional `--draft-with-model`/Enhance spend; daily-loop Generate defaults to no model. Generate in the UI is manual; the scheduled daily path is the launchd `install-daily-loop` job (not installed here).
- **Manual vs scheduled:** Generate/Regenerate = manual and spends nothing without the model box ticked; scheduled posting = the sweeps above.

## Content tracks + promotion loop (2026-10-11)
UE-hosted mixes are `cleared` by owner policy (D1); suggestions carry track/promotion/media; NAS items need explicit staging. See [`CONTENT-TRACKS.md`](CONTENT-TRACKS.md).
