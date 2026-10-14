# Marketing Director unification — as built (POC)

Status: **POC, admin only (`isAdmin` is the sole gate), built 2026-10-13 on branch `feat/marketing-director-poc`, uncommitted until the owner commits.** Non-admin card lists and behavior are unchanged. Plan (approved, 5 phases): [`docs/plans/MARKETING-DIRECTOR-UNIFICATION-MASTER-PLAN.md`](../plans/MARKETING-DIRECTOR-UNIFICATION-MASTER-PLAN.md). Phases P1-P4 are code-complete; P5 is this doc. No deploy, no cron change, no server/api/features/scripts file changed.

Verification so far: `npm test` 5453/5455 (the 2 failures are the known `vendor/api-lib/firebase-admin.cjs` byte-identity checks, pre-existing on clean `main`); `next build --webpack` passes (Turbopack panics only because this worktree's `node_modules` is a symlink); P2 cards, Content Center and the PostSheet portal were smoke-tested read-only in a browser; the P4 confirm row was reached and cancelled behind a page-level fetch guard (0 paid calls); an independent review found no paid path that bypasses the confirm row.

## 1. Placement (what moved where, admin)

- **Content Center** (`x-content`, Knowledge Officer) is now content only: tabs **Library · Buckets · Timeline · Clients**. `extraCategories:['social']` removed. `XContentEngineCard.jsx` lost its Today/Calendar/Strategy/Results/Telegram tab code (557 to 241 lines); `load()` only calls `inventory-list` now.
- **Marketing Director › WHAT'S OUR STRATEGY** (category `growth`) admin order: `strategy-today`, `strategy-queue-calendar`, `strategy-document`, `brief`, `strategy-builder`, `copywriter`, `strategy-results`, `strategy-publishing-settings`, `newsletter`.
- Five new cards, components in `components/dashboard/marketing/`:

| Card id | Title | Built from |
|---|---|---|
| `strategy-today` | Today | PlanPanel + DailySuggestionsPanel + InputStatusStrip |
| `strategy-queue-calendar` | Queue & Calendar | MonthCalendarPanel + PostSheet; sub-tabs **Calendar · Compose** (SocialPostingPanel as-is, same `social_posts` writer) **· Quote targets** (XCalendarCard as-is) |
| `strategy-document` | Strategy | StrategyPanel (content tracks, insights, history, review) |
| `strategy-results` | Results | PerformancePanel + ResultsPostList; sub-tabs **Results · X Monitor** (XMonitorCard as-is, `#x-monitor-card`) |
| `strategy-publishing-settings` | Publishing settings | TelegramPanel (own `/api/dashboard/telegram`) |

- `copywriter` category is `isAdmin ? 'growth' : 'social'` (sits after Custom Post Strategy).
- Hidden for admins in every bucket (defs and modal mounts kept; only a programmatic path remains): `priority-signal` in the growth bucket (still cross-listed in the admin Knowledge bucket, owner decision), `strategy-30`, `x-calendar`, `x-monitor`, `social-media-posting`.
- Tab anchor: `CAP_STEPS_ADMIN` in `lib/dashboard/tier-access-config.js` (`strategy-today` replaces `priority-signal`; admin social steps drop `SCHEDULE YOUR POSTS`); `DashboardPage.jsx` uses it when `isAdmin`.
- `strategy30` / `strategyBuilder.lastPlan` data is untouched in Firestore (15+ server consumers). Only the Day-of Post / 30-Day UI is replaced.
- Navigation between cards: `makeNavigate` in `marketing/useMarketingContentCall.js` (queue/calendar to `strategy-queue-calendar`; strategy to `strategy-document`; today/plan to `strategy-today`; results/performance to `strategy-results`; inventory/content/library to `x-content`; telegram/publishing to `strategy-publishing-settings`) via `openCapabilityCardById` in `DashboardPage.jsx` (Strategy Builder uses it too; its "open Social Posting" opens Queue & Calendar › Compose via `strategyQueueInitialView` / `initialView`).

### Style scope (P1)
Content Center CSS, tokens and ui primitives moved to `components/dashboard/content-ui/` (`ContentUiStyles.jsx` renders the single `<style jsx global>`; selector prefix `#x-content-card` became `.xce-scope`; the root keeps id `x-content-card` and gains class `xce-scope`). Panels mount standalone on `{clientId, call, onNavigate}` using fallback hooks in `components/dashboard/x-content/standalone.js` (standalone social calls use the `auth.currentUser` token). `PostSheet` needs a `post` object from its host.

## 2. Refresh (unified, P4)

Button `#marketing-refresh-button`, panel `#marketing-refresh-panel`, confirm row `#marketing-refresh-confirm-row` (`MarketingRefreshControl.jsx`), in `#marketing-director-refresh-shell` in the Marketing Director header (growth bucket, admin only). Orchestrator `runMarketingRefresh` in `DashboardPage.jsx`: ONE terminal titled `MARKETING REFRESH`, groups run sequentially in canonical order, one terminal section each, a failed group is non-fatal, summary line at the end. Group defs: `marketing/refresh-groups.js`; runners: `marketing/refresh-runners.js`.

| # | Group | Calls | Cost class |
|---|---|---|---|
| 1 | Market signals | existing `generateReport` path via `{embedded:true}`: `marketing-brief/run` scope `marketing-director` + `watchlist-pull` + `recipe-run` (no X) | PAID: Scout about $0.10 + ScrapeCreators + model |
| 2 | X search | `opportunity-signals/refresh`; plus `pre-digest-refresh?phase=signals&allowX=1` only when digest `include.xMarketTalk` is on (that part also runs Scout/ScrapeCreators) | PAID X API: about 1 call per enabled query row; no exact count returned |
| 3 | Analysis | `pre-digest-refresh?phase=analysis` (analyzers, strategy, reply targets, brief summaries, hosted brief) | PAID model |
| 4 | Strategy accounts | `quote-targets` `strategy-refresh` (Mac worker via `bird`) | FREE |
| 5 | Today & queue | `daily-run-generate` (model OFF; `draftWithModel` only with the "with model copy" checkbox) + `month-calendar` + `post-results` | FREE (paid only with model copy) |
| 6 | X Monitor | `x-monitor {action:'sync-all'}` | PAID X API: about 2 calls plus 1 per 1,000 followers |
| 7 | Renders | `pre-digest-refresh?phase=modules` | PAID render cost |

Rules (the confirm rule):
- Paid groups default OFF every session. Only free selections are remembered (localStorage `marketing-refresh-selection-v1`; last-refreshed times in `marketing-refresh-last-v1`; all access in try/catch).
- Any run containing a paid group, including "Run only this" and group 5 with model copy, must pass the confirm row, which names each paid group and its cost (`paidGroupsFor`). Nothing runs on mount.
- Group 6 runs after this unified confirm row; the X Monitor card's own sync buttons and confirm rows are hidden for admins (owner approved this reading of the X SSOT spend gate). Read [`X-API-AND-PROFILE-OPERATIONS.md`](X-API-AND-PROFILE-OPERATIONS.md) before changing groups 2 or 6.
- Crons are untouched: `pre-digest-refresh` remains the cron path. Email Digest Generate & Send stays outside unified Refresh (Q3).
- `hideRefresh` prop hides the per-panel manual refreshes: StrategyPanel / ContentTracks refresh, DailySuggestions Generate/Refresh/Regenerate, Plan / Month / Performance / InputStatusStrip reload controls, X Monitor Sync now / Counters / Posts / Audience, X Calendar Recompute. Market Signals (admin): Generate Report, Update report only, per-source Run, Pull timelines and Refresh Now are hidden; their copy points to the header Refresh. RUN BRIEF footer buttons were not removed. Read-only "Reload / Try again" buttons are intentionally left.

## 3. Admin gate
`isAdmin` only, everywhere (card defs, `CAP_STEPS_ADMIN`, category switch for Copywriter, Refresh control, `hideRefresh`). Non-admins see the previous card set. No server-side `pilotAccess` flag yet (post-POC). The `pre-digest-refresh` groups (2 second part, 3, 7) are admin-only routes.

## 4. Files
- New: `components/dashboard/content-ui/{ContentUiStyles.jsx,Feedback.jsx,Popover.jsx,xce-tokens.js,ui/*}`; `components/dashboard/marketing/{MarketingRefreshControl.jsx,refresh-groups.js,refresh-runners.js,useMarketingContentCall.js,StrategyTodayCard.jsx,StrategyQueueCalendarCard.jsx,StrategyDocumentCard.jsx,StrategyResultsCard.jsx,StrategyPublishingSettingsCard.jsx}`; `components/dashboard/x-content/standalone.js`.
- Edited: `DashboardPage.jsx` (card defs, modal mounts, `runMarketingRefresh`, `openCapabilityCardById`, header shell), `lib/dashboard/tier-access-config.js` (`CAP_STEPS_ADMIN`), `lib/dashboard/tile-config.js`, `XContentEngineCard.jsx`, `XMonitorCard.jsx`, `XCalendarCard.jsx`, the `x-content/*` panels (`hideRefresh`, imports from `content-ui`).
- Removed (moved): `x-content/{Feedback,Popover,xce-tokens}` and `x-content/ui/*` now live in `content-ui/`.

## 5. Reachability map (old to new, admin)

| Old | New |
|---|---|
| Schedule Posts compose / schedule / post-now | Queue & Calendar › Compose |
| X Calendar quote targets | Queue & Calendar › Quote targets (Recompute removed; still the local scan) |
| X Monitor | Results › X Monitor (sync via Refresh group 6) |
| Copywriter (Social bucket) | Marketing Director › Strategy, after Custom Post Strategy |
| Day-of Post / 30-Day Strategy | Today / Queue & Calendar (data untouched) |
| Content Center Today / Calendar / Strategy / Results / Telegram tabs | the five Strategy cards |
| All manual refresh buttons | Refresh panel (header) |

## 6. Known gaps
- Standalone panels were never run beyond the smoke test; P3 sub-tab mounts (Compose, Quote targets, X Monitor inside `.xce-scope`) not checked for style clashes.
- StrategyPanel / TelegramPanel `onNavigate` is inert; Today's `onNavigate` links depend on `onOpenCard`.
- Group 2 cannot state an exact X call count; group 6 cost is approximate; the Market Talk part of group 2 runs without `force`, so Scout may skip as fresh.
- `pre-digest-refresh` groups fail non-fatally if a non-admin ever sees them.
- Runner request shapes are unverified against live routes until the owner's first live batch.
- Market Signals modal may show empty-looking sections or dead copy where buttons were removed.
- Refresh panel mobile layout unchecked. Group 5 month param uses the UTC month while the panels use Central.
- The hidden `social-media-posting` modal has no remaining programmatic entry since the Strategy Builder redirect; verify.

## 7. Post-POC (deferred)
Server `pilotAccess` flag and pilot-client gate (Q4, revisit after about 2 weeks of admin use); Listening "X Accounts" section in Watchlist; "Previous 30-day plan" disclosure and import-to-queue; token de-dup and restyle of untouched Marketing cards; characterization tests; Email Digest Generate & Send stays out of unified Refresh.

## CLAUDE.md map entry (paste)
No `CLAUDE.md` exists in this worktree (it is local/untracked in the main checkout), so the entry was not inserted. Paste this into the main checkout's `CLAUDE.md` next to the other release entries:

> **Marketing Director unification — POC on branch `feat/marketing-director-poc` (admin only, uncommitted until the owner commits):** Content Center is now content-only (Library · Buckets · Timeline · Clients); Today, Queue & Calendar (Calendar · Compose · Quote targets), Strategy, Results (Results · X Monitor) and Publishing settings are five admin cards in Marketing Director › WHAT'S OUR STRATEGY (Copywriter moved there too); one header Refresh (7 groups, paid groups default OFF and gated by a confirm row) replaces the scattered manual refresh buttons. Crons and non-admin cards unchanged. SSOT: [`docs/source-of-truth/MARKETING-DIRECTOR.md`](docs/source-of-truth/MARKETING-DIRECTOR.md); plan: [`docs/plans/MARKETING-DIRECTOR-UNIFICATION-MASTER-PLAN.md`](docs/plans/MARKETING-DIRECTOR-UNIFICATION-MASTER-PLAN.md). Pull/merge before assuming any of this is on `main`.

## Client Brain as source of truth (2026-10-13)

The strategy cards (Strategy doc, tracks, Today, Results) follow the approved Client Brain; see the SSOT below. New in the agent: `propose_post_approve`, `propose_post_schedule`, `propose_post_unschedule` (each a card the owner confirms; the agent never publishes). Today suggestions carry an act-now trigger (`suggestionTrigger`: opportunity-signal, archive-throwback, hot-narrative, benchmark-gap) with the matched inventory item and Save draft / Schedule. Results and `get_evaluation` show per-track benchmark profile vs Brain target vs actual. SSOT: [`CLIENT-BRAIN-SOURCE-OF-TRUTH.md`](CLIENT-BRAIN-SOURCE-OF-TRUTH.md)
