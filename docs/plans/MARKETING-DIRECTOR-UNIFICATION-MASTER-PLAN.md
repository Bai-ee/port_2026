# Marketing Director Unification — master plan (2026-10-13)

> **Superseded 2026-10-14 (multi-client):** owner-only gates, the global content inventory, the single @bai_ee account and Seb/Hitloop defaults described below were replaced; as-built = docs/source-of-truth/CONTENT-PILOT-OPERATIONS.md §1b–1f and docs/plans/MULTI-CLIENT-FINAL-PASS.md.

Status: **APPROVED (Fable review 2026-10-13, owner scope: POC, admin account first, ASAP).** Stop for approval after every phase.
Base: production `main` `e4bce520`. Owner: bryanballi@gmail.com. Pilot client: `bryan-balli-WUoltG84`.

## 0. Fable review (2026-10-13)

**Verdict:** approve with POC trims. File/line claims in §3–§5 verified against `e4bce520`. Placement in §4 is sound.
The original 9-phase plan was sized for a hardened release; the owner wants a working POC for the admin account first,
so phases are collapsed to **5** (§7) and the exit gates are "existing `npm test` still green + manual walkthrough",
not new test suites.

**Findings (applied below):**
1. **Gate = `isAdmin` for the POC.** The server-derived `pilotAccess` bootstrap flag is deferred until the UX opens to
   pilot clients (Q4). `isAdmin` already reaches every card def; nothing new to plumb.
2. **Refresh group 1 = the dashboard's existing `generateReport` path** (`marketing-brief/run scope=marketing-director`
   + `watchlist-pull` + `recipe-run`), not `pre-digest-refresh?phase=signals`. Decided now instead of an equivalence
   test: it is what the owner sees today, already streams through the shared terminal, and `pre-digest-refresh` stays the
   cron's path. Groups 3 and 7 keep `pre-digest-refresh` phases.
3. **X Monitor group:** actions are `sync-all` / `sync-profile` / `sync-posts` / `sync-audience` (`XMonitorCard.jsx:361–376`),
   not one "POST sync". Group 6 calls `sync-all`; the card's own confirm row (which names the call count) is reused.
4. **Style extraction is a scope swap, not a design-system refactor.** P1 = replace the `#x-content-card` prefix with a
   `.xce-scope` class in the one CSS block + move the block, tokens and `ui/*` to `components/dashboard/content-ui/`. No
   pixel-diff gate, no token de-dup; an eyeball at 375/1280 is the gate.
5. **Social fold = mount, don't rewrite.** Schedule Posts' `SocialPostingPanel` and `XMonitorCard` mount as tabs inside
   Queue & Calendar / Results as-is (their own ids and styled-jsx stay). No new compose UI, no new queue writer.
6. **"Previous 30-day plan" disclosure + import action deferred.** `strategy30` data is untouched in Firestore and the
   Builder card's existing Push still reaches the queue; the import UI is post-POC.
7. **P5 Listening (X Accounts section) and P6 full restyle deferred** to post-POC. P6 shrinks to "wrap the new Strategy
   cards in `.xce-scope`" so the tab reads as one surface; the untouched growth cards keep their current look for now.
8. **Anchor swap must also update the growth sort order** (`DashboardPage.jsx:11224–11236`): the comment in
   `tier-access-config.js` says the anchor must be the first card of the strategy group in that order. Both change together.

**Open questions resolved (defaults taken):** Q1 two sections, one card (post-POC). Q2 Strategy tab › Publishing settings.
Q3 Email Digest unchanged. Q4 revisit after the owner has used the admin POC for ~2 weeks; that is when the `pilotAccess`
flag from finding 1 gets built.

## 1. Objective

Every piece of the content system lives in the one place it belongs, in a single visual language:

- **Knowledge Officer → Content Center** owns *content and its analysis* (library, buckets, sources, timeline,
  client capture). Nothing about strategy, posting or calendars.
- **Marketing Director** owns *market, listening, strategy and publishing*, split across its three existing tabs:
  `WHAT'S GOING ON IN THE MARKET` · `WHO ARE WE LISTENING TO` · `WHAT'S OUR STRATEGY`.
- **One calendar, one queue.** What you see as "today's post" and "the 30-day calendar" is the real `social_posts`
  queue that `process-due` publishes — no more plan text that looks like a schedule but isn't.
- **One manual Refresh** for the whole system (a 7-group checklist, batch or individual, cost shown before spend).
  Crons are unchanged.
- **Content Center UI is the style guide**; existing Marketing cards are reformatted to it.

### Problem being fixed (verified on prod)
Day-of Post and 30-Day Strategy render `dashboard_state.strategyBuilder.lastPlan` / `strategy30` text; the Content
Center calendar renders `social_posts`. They only connect via the Strategy Builder **Push** button, so the two
calendars disagree and the owner cannot tell what will actually post. Refresh/regenerate buttons are scattered over
~25 controls in 10+ cards.

## 2. Owner decisions (locked 2026-10-13)

| # | Decision |
|---|---|
| D1 | **Replace** Day-of Post and 30-Day Strategy with the Content Center's Today and Queue & Calendar panels. `strategy30`/`lastPlan` **data stays** (15+ server consumers: briefs, digest, daily-loop inputs, Builder) — only their UI is replaced. |
| D2 | **Fold the Social posting cards in**: Schedule Posts + X Calendar → Queue & Calendar; X Monitor → Results; Copywriter moves to the Strategy tab as the quick-draft tool feeding the same queue. |
| D3 | **One Refresh button → 7-group checklist**, each group toggled on/off, batch or single, cost estimate shown, explicit confirm for anything paid. All other manual refresh buttons are removed. Crons untouched. |
| D4 | **Admin gated (POC).** Moved panels show only when `isAdmin`. Everyone else keeps today's cards unchanged. Pilot-client gate (server `pilotAccess` flag) comes with Q4, post-POC. |
| D5 | Content Center UI (`xce-` tokens/primitives) wins as the style guide. |

## 3. Current architecture (relevant facts)

- Marketing Director = category `growth`; tabs = `CAP_STEPS.growth` in `lib/dashboard/tier-access-config.js:114-121`,
  each tab starts at an anchor card (`signals`, `brand-keywords`, `priority-signal`); order = growth sort
  `DashboardPage.jsx:11224-11236`. Card defs in `intakeCapabilityCards` (`DashboardPage.jsx:7359`).
- Content Center = `x-content` card (`DashboardPage.jsx:9501`, `isAdmin` only, category `knowledge` +
  `extraCategories:['social']`) → `components/dashboard/XContentEngineCard.jsx` + `components/dashboard/x-content/*`.
  All panels call `POST /api/dashboard/quote-targets {action}`. Scoped CSS: one `<style jsx global>` block
  (Card:557–1477) prefixed `#x-content-card`, class prefix `xce-`, tokens `x-content/xce-tokens.js`, primitives
  `x-content/ui/*` (Card, Badge, SegmentedControl, Accordion, SectionLabel, IconButton, WarnRow, Stepper, BottomNav)
  + `Feedback.jsx`, `Popover.jsx`.
- Pilot gating is **server-only** today (`api/_lib/pilot-access.cjs`, `PILOT_OWNER_UIDS`/`PILOT_CLIENT_IDS`); the UI
  only knows `isAdmin`.
- Publisher: `/api/social-posting?action=process-due` (`*/15`, `CRON_SECRET`) is the only publisher. Unchanged.

## 4. Target placement (the core of the plan)

### Knowledge Officer → Content Center (keeps)
| Panel | Source |
|---|---|
| Library (packages) | `x-content/InventoryPanel.jsx` |
| Buckets + Source drawer (Rendered · NAS · NAS Copy/Move · Discogs) | `BucketsPanel`, `SourcePanel`, `NasPanel`, `NasCopyMovePanel`, `DiscogsPanel` |
| Timeline | `TimelinePanel.jsx` |
| Clients (story capture / package approve) | `ClientCapturePanel.jsx` |

Content Center drops `extraCategories:['social']` and its Today / Queue & Calendar / Strategy / Results / Telegram tabs
(for gated users). Its tab bar becomes Library · Buckets · Timeline · Clients.

### Marketing Director → WHAT'S GOING ON IN THE MARKET (unchanged content, restyled)
`signals` (Market Signals), `competitor-info`, `local-signals`. Market Signals loses its own Generate Report / Update
report only / Pull timelines / per-source Run / Refresh Now buttons (→ unified Refresh, §5). Report-reading,
toggles, Build Proof stay.

### Marketing Director → WHO ARE WE LISTENING TO
| Card | Change |
|---|---|
| `brand-keywords`, `scout-focus`, `platform-search`, `social-signals`, `local-weather`, `conversation-intake` | restyle only |
| `watchlist` (Watchlist & Competitors) | **POST-POC:** restyle; gains an **X Accounts** section: own handle + benchmark accounts (from Strategy › Details › Accounts, `strategy-profile-save`) and the quote-target watchlist (from `x-calendar`). Q1 default: two sections, one card. |

### Marketing Director → WHAT'S OUR STRATEGY (new order)
| # | Card (new id) | Built from | Replaces |
|---|---|---|---|
| 1 | **Today** (`strategy-today`) | `PlanPanel` + `DailySuggestionsPanel` + `InputStatusStrip` | `priority-signal` (Day-of Post) |
| 2 | **Queue & Calendar** (`strategy-queue-calendar`) | `MonthCalendarPanel` + `PostSheet`; Schedule Posts (`SocialPostingPanel`) and X Calendar (`XCalendarCard` body) mount **as-is** as sub-tabs (Calendar · Compose · Quote targets) | `strategy-30`, `social-media-posting`, `x-calendar` |
| 3 | **Strategy** (`strategy-document`) | `StrategyPanel` (Chat · Document · Plan/cadence · Content tracks · Insights · History · Review) | — (was inside Content Center) |
| 4 | **Custom Post Strategy** (`strategy-builder`) | existing `StrategyBuilderCard`, restyled; Push lands in card 2 and the card links there | — |
| 5 | **Copywriter** (`copywriter`) | existing `CopywriterCard`, moved from Social, restyled | — |
| 6 | **Results** (`strategy-results`) | `PerformancePanel` + `ResultsPostList`; `XMonitorCard` mounts **as-is** as a sub-tab (keeps `#x-monitor-card` + its confirm rows) | `x-monitor` |
| 7 | **Publishing settings** (`strategy-publishing-settings`) | `TelegramPanel` + link to Social Accounts | — (Q2) |
| 8 | `newsletter` | unchanged (locked) | — |

Social Media Manager bucket keeps: `x-profile` (Social Accounts — connection lives with the account), `archive-inbox`.

**POST-POC:** the old `strategy30` content gets a read-only **"Previous 30-day plan"** disclosure inside Queue & Calendar
with an "Import to queue as drafts" action (reuses `strategy-builder/push` semantics + guard). For the POC the data simply
stays in Firestore and the Builder card's Push remains the import path.

**Tab anchor:** `CAP_STEPS.growth` strategy anchor moves from `priority-signal` to `strategy-today` for admins, **and** the
growth sort order (`DashboardPage.jsx:11224–11236`) puts `strategy-today` first in the strategy group — both edits together
or the column split breaks.

## 5. Unified Refresh

One **Refresh** control in the Marketing Director header (id `marketing-refresh-button`) opens a panel
(`marketing-refresh-panel`) with 7 toggle rows. Each row: label, what it updates, last-refreshed time, cost estimate,
on/off. Footer: total estimate, **Run selected**. Rows can also be run singly. Runs stream through the existing shared
terminal (`runWithTerminal`) and minimize to the existing `#run-active-indicator-chip`.

| # | Group | Calls (existing paths only) | Cost class |
|---|---|---|---|
| 1 | Market signals | the existing dashboard `generateReport` path: `marketing-brief/run {scope:'marketing-director'}` + `watchlist-pull` + `recipe-run` for toggled skills (**no X**) | Scout ≈$0.10 + ScrapeCreators credits + model calls |
| 2 | X search | `opportunity-signals/refresh` (allowX) + `pre-digest-refresh?phase=signals&allowX=1` only if Market Talk on X is toggled in the digest | **Paid X API** — call count named before confirm (X SSOT §0) |
| 3 | Analysis | `pre-digest-refresh?phase=analysis` (platform analyzers + brief summaries) | model calls |
| 4 | Strategy accounts | `strategy-refresh` enqueue (Mac worker, `bird`) | free |
| 5 | Today & queue | `daily-run-generate` (model copy off by default) + `month-calendar` + `post-results` reload | free (paid if "with model") |
| 6 | X Monitor | `x-monitor {action:'sync-all'}` (reuses the card's own confirm row) | **Paid X API** (≈3 metered calls) |
| 7 | Renders | `pre-digest-refresh?phase=modules` | render cost (studio/video) |

Rules:
- Paid groups (1,2,3,6,7, and 5-with-model) default **OFF** each session; selection is remembered per viewer (localStorage,
  try/catch). Run requires a confirm row naming the paid groups and estimate. No auto-run, ever.
- Group 1 is **decided** as the dashboard path (Fable finding 2); `pre-digest-refresh?phase=signals` stays cron-only.
  Group 1 and group 3 overlap on `recipe-run`-style analysis; that is acceptable for the POC — group 3 exists for the
  Reddit/IG/opportunity analyzer fields the email reads.
- Groups run **sequentially** in the order listed, each as its own terminal section; a failed group logs and the batch
  continues (same non-fatal pattern as `runAndSend`).
- **Removed** (gated users): Market Signals Generate Report / Update report only / Pull timelines / per-source Run /
  Refresh Now; Strategy "Refresh data" + per-benchmark refresh; DailySuggestions Generate/Refresh/Regenerate; Plan /
  Month / Results / Insights reload pills; X Monitor Sync now / Counters only / Posts only; X Calendar Recompute;
  Marketing-Director / Social brief RUN BRIEF buttons in growth.
- **Kept** (not refreshes — per-item actions): Builder Generate Strategy + per-item regen, Build Proof, Strategy chat /
  Review, Copywriter Enhance, NAS Start, Discogs plan/apply, Sync now (rendered videos, Content Center), Client Brain.
- **Out of scope**: Email Digest Generate & Send (admin bucket; it is a send that refreshes). See Q3.

## 6. Style unification

- **POC:** move `xce-tokens.js`, `x-content/ui/*`, `Feedback.jsx`, `Popover.jsx` and the CSS block (`XContentEngineCard.jsx:557–1474`)
  to `components/dashboard/content-ui/`; the CSS block's selector prefix becomes `.xce-scope` (mechanical replace of
  `#x-content-card`). Content Center's root gets `className="xce-scope"` + keeps its id. Gate: eyeball at 375 / 1280.
- **POST-POC:** token de-dup (JS + CSS literals → custom properties on `.xce-scope`); reformat of the untouched
  Marketing cards (`.mu-*`, `.signals-sg`/`.sg-*`, `03-strategy-builder.css`, Copywriter, REPORT/DATA chrome).
  Presentation-only when it happens.
- Respect the Mobile Width Standard (≤480px single `--mobile-gutter`), the Content Center BottomNav pattern where a card
  has >4 tabs, 16px inputs, reduced-motion, stable kebab-case ids on every edited container.

## 7. Phases — POC (one branch; stop for approval after each)

Exit gate for every phase: existing `npm test` suite still green (no new suites required), `npm run build` passes,
and an owner walkthrough on localhost as admin. One small registry test is allowed in P1 if it is cheap.

| Phase | Scope | Exit gate |
|---|---|---|
| **P1 Style scope + standalone panels** | Move `content-ui/` + `.xce-scope` (§6 POC bullet). Make the panels that P2 reuses (`PlanPanel`, `DailySuggestionsPanel`, `InputStatusStrip`, `MonthCalendarPanel`, `PostSheet`, `StrategyPanel`, `PerformancePanel`, `ResultsPostList`, `TelegramPanel`) mount standalone on `{clientId, call, onNavigate}` with no reliance on Content Center tab state. Content Center still renders them. | Content Center looks and behaves the same; build + tests green |
| **P2 Strategy tab** | New admin-only cards Today, Queue & Calendar (Calendar sub-tab only), Strategy, Results (Content Center results only), Publishing settings; anchor + sort swap; `priority-signal` + `strategy-30` hidden for admins; Content Center drops Today/Queue/Strategy/Results/Telegram tabs + `extraCategories:['social']` for admins. New UI in `components/dashboard/marketing/*`. | admin walkthrough; non-admin card list unchanged |
| **P3 Social fold** | `SocialPostingPanel` → Queue & Calendar "Compose" sub-tab; `XCalendarCard` body → "Quote targets" sub-tab; `XMonitorCard` → Results sub-tab; Copywriter card `category` → growth (strategy group); `x-calendar`/`x-monitor`/`social-media-posting` hidden for admins. | every former action reachable (short checklist in the PR); no duplicate queue writers |
| **P4 Unified Refresh** | `marketing-refresh-button` + `marketing-refresh-panel` with the 7 groups (§5); remove the old refresh buttons listed in §5 for admins. | each group runs once on localhost with cost shown; paid groups only on explicit confirm; owner runs one live batch |
| **P5 Docs + ship** | New SSOT `docs/source-of-truth/MARKETING-DIRECTOR.md` (short, as-built); one-paragraph updates to CONTENT-MANAGEMENT, X-STRATEGY-TAB, X-MONITOR-CARD, COPYWRITER-CARD, MARKET-SIGNALS-GENERATE-REPORT-FLOW, CLAUDE.md map; preview deploy → owner OK → main. | owner approval |

P2 is the highest-value phase and can ship alone (fixes the "two calendars" confusion).

**Deferred to post-POC (not in this plan's phases):** server `pilotAccess` flag + pilot-client gate (Q4); Listening
X Accounts section (§4); "Previous 30-day plan" disclosure + import; token de-dup + restyle of untouched growth cards
(§6); characterization test suites.

## 8. Guardrails

- No changes to publisher, scheduling transaction (`reservations.js`), guard, pilot server checks, crons, or X write paths.
- No X API / paid calls in tests; prod Firestore untouched in development (memory fakes).
- `DashboardPage.jsx` edits limited to: card defs/categories/order, anchor, gate flag, removed buttons, mounting new
  components. New UI lives in `components/dashboard/marketing/*`. Never edit it during a running local run (Fast Refresh).
- No new libraries. No copy changes beyond renamed labels. Desktop behavior of non-gated users unchanged.
- No deploy, env, or cron change without owner approval.

## 9. Risks

| Risk | Mitigation |
|---|---|
| `DashboardPage.jsx` (~17k lines) merge conflicts with parallel work | small, mechanical diffs; one phase at a time; rebase on main before each |
| Dual UI during gated rollout (two code paths) | gate is the single `isAdmin` boolean; Q4 decides when to open to all |
| `x-content` styled-jsx scoping breaks when panels mount outside `#x-content-card` | P1 replaces id-prefix with `.xce-scope` before any move |
| Refresh group 1 diverging from Generate Report semantics | resolved: group 1 **is** the `generateReport` path |
| Hidden consumers of removed buttons (e.g. MCP sync tools, Telegram) | they call routes, not buttons; routes are untouched |
| Users lose a familiar control | P3 reachability checklist (every old action → new location) |
| POC trims (no char tests, no pixel diff) let a regression slip into non-admin views | every phase's gate includes "non-admin card list unchanged"; gated code paths are additive `isAdmin ? … : …` branches only |

## 10. Open questions — resolved (defaults taken 2026-10-13, see §0)

- **Q1** Two sections, one card (post-POC).
- **Q2** Strategy tab "Publishing settings".
- **Q3** Email Digest unchanged.
- **Q4** Revisit after ~2 weeks of admin use; building the server `pilotAccess` flag is the first step of that work.

## 11. Implementer prompt (P1)

> Implement **P1 only** of `docs/plans/MARKETING-DIRECTOR-UNIFICATION-MASTER-PLAN.md` on a branch off `main` `e4bce520`.
> Read §0, §6 (POC bullet) and §7 first. Move the Content Center CSS block, tokens and `ui/*` to
> `components/dashboard/content-ui/`, swap the `#x-content-card` prefix for `.xce-scope`, and make the listed panels mount
> standalone on `{clientId, call, onNavigate}`. Content Center must look and behave the same. No new tests required;
> `npm test` and `npm run build` must stay green. Stop for approval after P1.
