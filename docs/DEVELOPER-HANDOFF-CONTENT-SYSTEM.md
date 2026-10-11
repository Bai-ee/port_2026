# Content System release — developer handoff

PR: `release/content-system` -> `main` (squash). Date: 2026-10-11. Release plan: [`docs/plans/CONTENT-SYSTEM-RELEASE-MASTER-PLAN.md`](plans/CONTENT-SYSTEM-RELEASE-MASTER-PLAN.md).

**TL;DR for the reviewer**
- One workspace, the **Content Engine** card (Social Media Manager bucket, admin), takes X content from find -> draft -> review -> approve -> schedule -> track.
- Almost everything is **additive**. Legacy `social_posts` rows, Copywriter, Schedule Posts, digest and quote drafts keep their old behavior. New strictness is opt-in per row (`lifecycleVersion: 2`) and per client (pilot allowlist).
- **Nothing posts to X on deploy.** Live posting batches are a separate owner action.
- The one risky production change: `process-due` cron goes from daily to `*/15` (needs Vercel Pro) and the stale window drops 26 h -> 2 h.
- SSOTs: [`source-of-truth/CONTENT-MANAGEMENT.md`](source-of-truth/CONTENT-MANAGEMENT.md), [`CONTENT-PILOT-OPERATIONS.md`](source-of-truth/CONTENT-PILOT-OPERATIONS.md), [`X-STRATEGY-TAB.md`](source-of-truth/X-STRATEGY-TAB.md), [`DAILY-CONTENT-LOOP.md`](source-of-truth/DAILY-CONTENT-LOOP.md).

---

## 1. What shipped

**Daily content loop.** A slot-based orchestrator (`features/x-content-inventory/daily-loop/*`) turns a fresh saved X scan + the cleared content library + the approved Client Brain into a small review list of suggestions (original / quote-react / reply), grounded in the owner's real material and checked by the content guard. Slots follow the saved strategy plan. Suggestions live in `x_content_daily_runs`, not in `social_posts`. Generate is manual and spends no model by default (a model drafter is opt-in). Saving a suggestion creates one idempotent draft; regenerating never touches a saved post.

**X Strategy tab.** First tab of the card. (a) **Evaluate handles**: own account vs benchmark accounts from stored corpora (`x_corpora`), with tier and caveats. (b) **Refresh queue**: UI writes `x_strategy_refresh_requests`; a local Mac worker (`bird`, browser cookies, free) drains it; nothing refreshes on Vercel. (c) **Plan**: a versioned, version-checked plan (`x_strategy_plans`: posts/day, type floors/caps, engine targets) that the runner, chat and calendar all read through one function (`resolvePlanInputs`). (d) **Agent chat**: Anthropic-backed, read tools only plus 8 *propose* tools; every write waits for an owner Confirm (`strategy-proposal-decide`). The chat cannot approve, schedule or publish.

**Content Engine UI restyle.** Presentation-only rework to the approved mocks: tokens (`xce-tokens.js`), shell with tab row, "More" menu, mobile bottom nav, Today segmented control, restyled Strategy/Today/Library/Calendar/Results/Clients. No new data model came from this.

**Social-archive Timeline.** FB / X / IG archive adapters, a matcher, a day-searchable timeline store, ingest CLI, a voice hook for the Brain, and a **Timeline** tab (More menu) with day view and search. Data is read-only in the UI.

**Content Management normalization.**
- *One plan*: `x_strategy_plans` owns cadence; Strategy Builder is constraints only (a contradiction shows a caveat, the plan wins).
- *Shared context loader*: `loadContentContext` feeds the runner, chat `get_context` and the input-status strip, with per-input `usable/asOf/caveats`.
- *One `social_posts` lifecycle*: pure `lifecycle.js` plus `ensureDraftPost` (idempotent), opt-in `lifecycleVersion: 2`, schedule-time guards for every row.
- *Workspace nav*: Today (Plan | Recommendations), Library, Queue & Calendar (month grid + agenda + post sheet), Strategy, More (Buckets, Timeline, Clients, Results).
- *Input-status strip*: Brain, plan, account data, scan, queue, refresh-worker heartbeat.
- *Post results*: all-time Posted / Waiting / Needs attention with provenance; unmeasured = "not measured yet", never 0.
- *Approve & schedule / Reject* as single atomic operator actions.

**Owner-pilot hardening.** Allowlist gate (`PILOT_OWNER_UIDS`, `PILOT_CLIENT_IDS`; production and preview fail closed with 503). **Transactional reservations**: post + Chicago-day ledger + package reservation in one Firestore transaction. **Revisions**: edits/approvals carry the `revision` the operator saw; stale -> `revision-conflict`; approval is bound to the exact copy (`approvedHash`). **Reconcile**: ambiguous publish outcomes (timeout/5xx) park as `needs_review`, never auto-retried; operator resolves by platform post id. **15-minute `process-due` cron** with a 2 h staleness guard, heartbeat, and failed/held/expired alert email.

**Discogs panel + ACS fields.** A Discogs source panel (Plan + Add to collection + Undo, contract in [`plans/DISCOGS-PANEL-CONTRACT.md`](plans/DISCOGS-PANEL-CONTRACT.md)) mounted through `SourcePanel.jsx`. Paid/write actions go dashboard -> `archive_commands` -> Mac analyzer (no new worker routes). Held-record decisions in `discogs_decisions`. ACS additive fields + `packageId` join key + backfill scripts (`scripts/discogs/`).

---

## 2. Architecture map

Store -> service -> route action -> UI. All dashboard actions are `POST /api/dashboard/quote-targets {action}` (admin; no new route files); post actions are `/api/social-posting`.

| Store (Firestore) | Service module | Route action(s) | UI |
|---|---|---|---|
| `x_content_daily_runs` | `features/x-content-inventory/daily-loop/{run,run-store,slots,select,fill-*}.js`, `daily-run-store.js` | `daily-run-generate/-latest/-edit/-dismiss` (quote-targets) | `x-content/DailySuggestionsPanel.jsx` |
| `x_content_packages` (global) | `features/x-content-inventory/{store,item-actions,match,draft}.js` | `inventory-list/-save/-delete`, `set-rights`, `approve-package`, `create-draft-from-item` | `InventoryPanel.jsx`, `ItemDrawer.jsx` |
| `content_buckets/{client}/buckets` | `x-content-inventory/{bucket-store,buckets,folders}.js` | `list-buckets`, `upsert-bucket`, `delete-bucket`, `list-folders` | `BucketsPanel.jsx`, `BucketRail.jsx` |
| `x_strategy_plans/{client}` | `features/x-strategy/{plan-store,plan-state,plan-inputs,content-plan}.js` | `content-plan`, `strategy-plan-apply/-revert` (via `route-handlers.js`) | `StrategyPanel.jsx`, `PlanPanel.jsx` |
| `x_corpora/{handle}/rows` | `x-strategy/{corpus-store,corpus-rows,ingest,evaluate}.js` | `strategy-get` | `StrategyPanel.jsx` |
| `x_strategy_refresh_requests`, `x_strategy_workers` | `x-strategy/refresh.js`, `scripts/x-content/strategy-refresh-worker.mjs` | `strategy-refresh`, `strategy-refresh-status` | `StrategyPanel.jsx`, `InputStatusStrip.jsx` |
| `x_strategy_chats/{client}/threads` | `x-strategy/agent/{loop,chat-store,proposals}.js` | `strategy-chat-send`, `strategy-proposal-decide` | `StrategyChat.jsx` |
| (computed, no store) | `features/content-context/load-content-context.js` | `content-context` | `InputStatusStrip.jsx` |
| `social_posts` | `features/social-posting/{twitter-service,lifecycle}.js` | `/api/social-posting`: `update`, `approve-draft`, `approve-and-schedule`, `reject-draft`, `schedule`, `post-now`, `reconcile-post`, `process-due`, `approve-post`, `reject-post` | `PostSheet.jsx`, `MonthCalendarPanel.jsx`, Copywriter, Schedule Posts |
| `x_schedule_ledger`, `x_package_reservations` | `features/social-posting/reservations.js`, `x-content-inventory/allocate-slot.js` | (called by the schedule actions above) | `MonthCalendarPanel.jsx` |
| `social_posts.performance` joined to run/package/plan | `x-content-inventory/{results,performance}.js` | `post-results`, `engine-performance`, `month-calendar` | `PerformancePanel.jsx`, `ResultsPostList.jsx` |
| `dashboard_state.marketingBrief.quoteTargets` (read-only) | `features/x-quote-targets/*` | `post-status`, `draft-quote` | Today / Calendar |
| `timeline_entries`, `timeline_days`, `social_archives` | `features/social-archive/{timeline-store,actions,ingest,match,voice}.js` | `timeline-day/-days/-search/-archives` | `TimelinePanel.jsx` |
| `discogs_decisions`, `archive_commands` | `features/discogs-ingest/{actions,service,scheduler,draft-builder}.js` | `discogs-status/-plan/-jobs/-cancel/-records/-decide/-apply/-undo` | `DiscogsPanel.jsx` (via `SourcePanel.jsx`) |
| access gate (env) | `api/_lib/pilot-access.cjs` | applied at both route boundaries | n/a |

Shell: `components/dashboard/XContentEngineCard.jsx`. Tab ids: `plan`(Today), `inventory`, `calendar`, `strategy`, More: `buckets`, `timeline`, `clients`, `performance`. DOM ids follow `x-content-tab-<id>`. Publisher: `process-due` in `twitter-service.js`. Alert: `features/social-posting/publish-alert.js`.

---

## 3. Run and test

```bash
npm run dev                      # next dev --webpack on :3000
npm test                         # node --test over features/ api/ lib/ app/ ...
```
- **Baseline**: ~5000 tests; exactly **2 known failures** in `vendor-api-lib`. Two **load-sensitive flakes** (`art-render` / `ffprobe validation`, `proof-render-worker`) can fail in the full run and pass alone: re-run in isolation before blaming a change.
- Do **not** run `npm run build` in a checkout with a dev server (it clobbers `.next`). The local build check was never completed (Google Fonts fetch / disk); the Vercel preview build is the real check.
- Never `curl /api/worker/*` locally: `CRON_SECRET` is unset in dev and the job actually runs.

Targeted globs:
```bash
node --test 'features/social-posting/__tests__/*.test.js'        # lifecycle, pilot-concurrency, pilot-lifecycle
node --test 'features/content-context/__tests__/*.test.js'
node --test 'features/x-strategy/__tests__/**/*.test.js'
node --test 'features/x-content-inventory/__tests__/**/*.test.js'
node --test 'features/social-archive/__tests__/*.test.js' 'features/discogs-ingest/__tests__/*.test.js'
node --test 'app/api/social-posting/__tests__/*.test.js' 'app/api/dashboard/quote-targets/__tests__/*.test.js'
```
Scripts:
- `scripts/pilot/dry-run-post.mjs` — 16-step mock-publisher dry run, local fixtures, no network.
- `scripts/pilot/legacy-report.mjs` — read-only report of legacy scheduled rows that the new rules would park.
- `scripts/x-content/` — `strategy-refresh-worker.mjs --once`, `daily-run.mjs`, `scan-quote-targets.mjs`, `backfill-performance.mjs`, `session-brief.mjs` (free, `bird`), `install-scan-schedule.sh`.
- `scripts/social-archive/ingest.mjs`; `scripts/discogs/backfill-*.mjs`.
- Local worker env: `X_STRATEGY_BIRD_COOKIE_SOURCE=chrome node scripts/x-content/strategy-refresh-worker.mjs --once`.

---

## 4. Production config

**Env var names only (set in Vercel Production; Preview shares prod Firebase/X/Anthropic keys, so remove `TWITTER_*` from Preview):**
- Pilot gate (required, fail closed): `PILOT_OWNER_UIDS`, `PILOT_CLIENT_IDS`
- Cron + tokens: `CRON_SECRET` (must be named exactly this; missing -> every `process-due` call 401s), `SOCIAL_APPROVAL_SECRET` (approval-email HMAC tokens)
- Model: `ANTHROPIC_API_KEY` (strategy chat, Enhance, opt-in drafter)
- Firebase admin: `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY`, `FIREBASE_ADMIN_STORAGE_BUCKET`
- X publishing: `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET`
- Media/archive (only for `ev:` media + Discogs/NAS): `EDITVIDEOS_FIREBASE_SERVICE_ACCOUNT_KEY`, `EDITVIDEOS_FIREBASE_BUCKET`, `HITLOOP_ARCHIVE_WORKER_TOKEN`
- Optional: `PILOT_ALERT_EMAIL`, `PILOT_ALERT_FROM`, `RESEND_API_KEY` (all three or alerts stay off), `X_STRATEGY_DAILY_TURN_CAP` (default 60), `X_STRATEGY_WORKER_ID`

**Crons (`vercel.json`):** `pre-digest-video` 06:00, `pre-digest-refresh` 12:35, `daily-digest` 13:00, `render-studio` 13:15, `media-reconcile` 13:30 (all daily, unchanged) and **`/api/social-posting?action=process-due` `*/15 * * * *`** (changed from daily; needs **Vercel Pro**, which a Hobby deploy rejects).

**Exactly one publisher:** the Vercel `process-due` cron. `.github/workflows/social-publish-sweep.yml` (`*/30`, also schedules Discogs records) is **inert** (`if: vars.SOCIAL_PUBLISH_ENABLED == 'true'`); leave the variable unset. The Mac launchd publish sweep (`scripts/social/`) is retired.

**Local-only `bird` worker: not installed.** Quote scan (`install-scan-schedule.sh install <client>`), strategy refresh and daily-loop schedule are Mac jobs needing browser cookies. Until installed, the refresh worker line reads "never reported" and refresh requests stay queued; the app works on stored data.

**Other:** timezone is America/Chicago for the owner (other clients unsupported). No new composite indexes. `docs/audits` is not in `.vercelignore` (strategy corpora fall back to static imports).

---

## 5. Safety model

- **X spend gate** (repo `CLAUDE.md` + `X-API-AND-PROFILE-OPERATIONS.md`): no agent runs an X write without a dry run and the owner's explicit per-batch confirmation. Reads use ScrapeCreators or the free `bird` path. X search (Opportunity Signals) only runs from a dashboard button. X API spend is invisible on the Operating Cost card.
- **No auto-posting without approval + schedule.** Save draft != approve != schedule. Seeded/run drafts are `status:'draft'`, `scheduledAt:null`, which the sweep ignores. Chat has no approve/schedule/publish tool. Reply posts cannot be scheduled.
- **`lifecycleVersion: 2` is opt-in** (set by shared producers and every pilot-client new post). v2: a material edit voids approval and schedule; scheduling needs prior approval; delivery re-checks clearance, reply guard, expiry and `approvedHash`, then parks `needs_review` *without calling X*.
- **Legacy compatibility**: rows without `lifecycleVersion` publish exactly as before (pinned by characterization tests). Schedule-time guards (reply, revoked clearance, package already pending) only refuse a *new* scheduling action. Data additions are additive; old code ignores them.
- **Fail closed**: pilot env unset -> 503 in production and preview; `CRON_SECRET` unset -> `process-due` 401; Brain load error -> caveat, not silent empty; unknown metrics -> `null`, not 0; truncated data never fabricates results.
- **Exactly-once delivery to X cannot be guaranteed after a timeout** (X has no idempotency key). Ambiguous outcomes park and are reconciled by platform id; reconcile never sends to X.

---

## 6. Known limits / not in this release

Limits (from build logs):
- Weekly engine caps and engine share are not enforced; `post-now` is not plan-checked; replies stay manual.
- Transaction retry/contention was tested only against a serializing fake Firestore. A real-contention script is part of this release prep (`scripts/pilot/contention-test.mjs`); verify on staging.
- `x-oauth` body `clientId` and worker routes' env-client remain ungated (documented in the customer-access checklist).
- `x_content_packages` is global, not client-scoped (flagged `scope:'global'`).
- Instagram publishing is a stub behind `live:false`; do not describe it as working.
- Browser walkthrough did **not** cover: post sheet and Recommendations at phone width, Reconcile controls, plan-override UI, Strategy/Library tabs, chat.
- A long `bird` scrape (>15 min) can read as "worker not seen". Alert email: a total cron outage produces no alert; watch the cron log (200 every 15 min).
- Production build check was not completed locally (see section 3).

**NOT in this release:** live X posting batches; enabling the GitHub sweep; installing the local scan/refresh worker; customer access (enrollment stays off; checklist in `plans/content-pilot-customer-access-checklist.md`).

---

## 7. Branch history

Release branch `release/content-system` = `feat/content-pilot` @ 264cd139 (merged, in order: daily loop -> X Strategy -> Content Engine UI -> social-archive timeline -> content-management normalization -> owner pilot) + merge of `feat/records-acs-hooks` @ 9163bac6 (clean) + merge of `fix/nas-job-status-labels` @ 38f38a38 (Discogs panel; conflict in `quote-targets/route.js`, kept both action sets). Build-log screenshots dropped.
- **`80e4c201` (`feat/content-calendar-month`) is superseded**: its UI was adopted in the normalization month calendar; its server logic was re-implemented as `approveAndSchedule`. Not merged.
- `feat/daily-content-loop`, `feat/content-engine-ui`, `feat/content-management` are contained; archive after deploy.
- Not part of this: main-checkout uncommitted media edits (`editvideos-bridge.cjs`, `media/route.js`, `pre-digest-video/route.js`).
- Build logs: `plans/content-management-build-log.md`, `plans/content-pilot-build-log.md`; audit: `plans/content-management-audit.md`.

**Review focus (highest risk first):**
1. `features/social-posting/twitter-service.js` — publish/claim/schedule/reconcile paths shared with legacy flows.
2. `features/social-posting/reservations.js` — transaction body, ±neighbour-day spacing, no-composite-index reads.
3. `features/social-posting/lifecycle.js` — v2 gating; confirm legacy rows are untouched.
4. `app/api/social-posting/route.js` — new actions, `process-due` auth, pilot gate (non-owner clients must be unaffected).
5. `app/api/dashboard/quote-targets/route.js` — large action fan-out, merge-conflict file, gate placement. Also `api/_lib/pilot-access.cjs`.

---

## 8. Owner on-device review checklist

**Rules:** every test draft starts with `[CM test]` and is scheduled **>= 30 days out**. Nothing here may post to X. **Reject every test draft afterwards** (Queue & Calendar -> open post -> Reject/Unschedule). Do not click anything that says Post now. Spending: do not use chat/Enhance unless you accept a few cents.

Do each on **phone (<=480px)** and **desktop**. Path: Dashboard -> Social Media Manager -> Content Engine.

| # | Do | Pass looks like |
|---|---|---|
| 1 | Open the card; look at the input-status strip | Strip shows Brain, plan, account, scan, queue. Open on Today, collapsed on Queue. Worker line says "never reported" or "last seen N min ago" (not online/offline). |
| 2 | **Today -> Recommendations**; tap a suggestion; edit text to `[CM test] ...` | Checks run; **Save draft** gives "Saved draft - not approved". |
| 3 | Set publish time >= 30 days out; tap **Approve & schedule** | "Scheduled - <date> CT" toast; **Open in Queue & Calendar** link appears. |
| 4 | **Queue & Calendar**: go to that month; tap the day chip | Chip on the right day; post sheet shows state, CT time, id, Unschedule/Reject. Escape (desktop) closes only the sheet, not the whole card. Phone: grid has no horizontal scroll. |
| 5 | Reject the test post | Disappears from scheduled; slot freed. |
| 6 | **Results** (More on phone) | Posted / Waiting / Needs attention lists; unmeasured shows "not measured yet", not 0; rejected/drafts absent. |
| 7 | **Strategy**: evaluate (own vs benchmark), tap **Refresh** | Evaluation renders with caveats; refresh shows "queued" until a worker runs (expected, none installed). |
| 8 | Strategy plan: change posts/day, **Save**, then revert | Version bumps (vN -> vN+1); revert restores; Today header shows "N posts from plan vN". |
| 9 | Strategy chat (optional, spends): "what is today's plan?" then ask it to change something | Answers from data; a change appears as a **proposal card** and nothing changes until you tap Confirm; it refuses to schedule/publish. |
| 10 | **Library**: open an item, check the drawer; Create draft | One draft (retapping does not create a second); rights controls work. |
| 11 | **More -> Buckets** | Bucket rail and items load; no console errors. |
| 12 | **More -> Timeline** | Day view loads; search returns entries; no edit controls. |
| 13 | **Discogs** (Library/source panel, admin) | Panel loads; without the Mac analyzer it says unavailable/not connected rather than erroring. Do **not** press Apply. |
| 14 | **Copywriter** and **Schedule Posts** cards (separate cards) | Still open; Copywriter scores live; a `[CM test]` draft saves and appears in Queue & Calendar; reject it. |
| 15 | Phone only: bottom nav (Today, Library, Queue, Strategy, More) | All five reach their tabs; More lists Buckets, Timeline, Clients, Results. |

**Fail = stop and report:** any real X post, a draft that schedules without your tap, a second duplicate draft, a card that cannot be closed, or Content Management reachable from a non-owner account (should 503/redirect).

Cleanup afterwards: confirm all `[CM test]` rows are `rejected`; leftover empty `x_schedule_ledger` docs are harmless.

## Telegram command center (2026-10-11, branch feat/telegram-command-center)
Telegram is a second interface to the same posts: briefing, calendar, timed handoff cards, manual delivery and uploads. It adds the shared `manual` post status ("Posting manually"; the sweeper never claims it) plus `recordManualPosted` (self-reported, `deliveryVerified:false`, no `twitterId`), `releaseManualClaim` and `approveAndPostNow` in `twitter-service.js`. As-built, security model, activation steps: [`docs/source-of-truth/TELEGRAM-COMMAND-CENTER.md`](source-of-truth/TELEGRAM-COMMAND-CENTER.md).
