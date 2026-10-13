# Marketing Director Unification — orchestrator prompt (Sonnet, multi-agent, POC)

You are the orchestrator for a **proof-of-concept** build. Read the approved plan first and treat it as the only source of truth:

`docs/plans/MARKETING-DIRECTOR-UNIFICATION-MASTER-PLAN.md` (§0 Fable review, §4 placement, §5 refresh, §6 style POC bullet, §7 phases, §8 guardrails).

Worktree: `Bballi_Portfolio-content-center`, branch off `main` `e4bce520`. Owner: admin account only.

## Mindset

- This is a POC. It must **work for the admin account**, nothing more. Good enough beats polished.
- **Do not over-test.** No new test suites, no snapshot/pixel diffs, no characterization tests. Gate per phase = existing `npm test` green, `npm run build` green, admin walkthrough on localhost. One cheap registry test is allowed only if it takes minutes.
- **Mount, don't rewrite.** Reuse existing panels/cards as-is wherever the plan says so. Never build a new compose UI, queue writer, or refresh path.
- **Additive gating only.** Every change for admins is an `isAdmin ? new : old` branch. Non-admin card list and behavior must not change.
- Minimal diffs in `DashboardPage.jsx` (card defs/categories/order, anchor, hidden ids, mounts). New UI goes in `components/dashboard/marketing/*`. Never edit `DashboardPage.jsx` while a local run is streaming.
- No new libraries. No copy changes beyond labels naming moved things. No deploy, env, cron, publisher, reservation, guard or X-write-path changes.
- Paid calls: never run one in development. The unified Refresh must default paid groups OFF and require an explicit confirm row naming them.

## Phase order (stop for owner approval after each)

Run phases **sequentially**; parallelize **inside** a phase with the splits below. Each agent gets: the plan path, its phase, its file list, and the rule "touch only your files; report the diff summary back."

**P1 — Style scope + standalone panels** (2 agents in parallel)
- Agent A: move `components/dashboard/x-content/{xce-tokens.js,ui/*,Feedback.jsx,Popover.jsx}` and the CSS block (`XContentEngineCard.jsx:557–1474`) to `components/dashboard/content-ui/`; mechanical replace `#x-content-card` → `.xce-scope`; Content Center root gets `className="xce-scope"` and keeps its id; fix imports.
- Agent B: make `PlanPanel, DailySuggestionsPanel, InputStatusStrip, MonthCalendarPanel, PostSheet, StrategyPanel, PerformancePanel, ResultsPostList, TelegramPanel` mount standalone on `{clientId, call, onNavigate}` with no dependence on Content Center tab state. Content Center still renders them.
- Orchestrator: merge, build, test, eyeball Content Center at 375/1280.

**P2 — Strategy tab** (2 agents)
- Agent A: new admin-only cards in `components/dashboard/marketing/*`: Today (`strategy-today`), Queue & Calendar (`strategy-queue-calendar`, Calendar sub-tab only), Strategy (`strategy-document`), Results (`strategy-results`, Content Center results only), Publishing settings (`strategy-publishing-settings`). Wrap in `.xce-scope`.
- Agent B: `DashboardPage.jsx` + `lib/dashboard/tier-access-config.js`: register the cards (admin only), hide `priority-signal` + `strategy-30` for admins, swap `CAP_STEPS.growth` strategy anchor to `strategy-today` **and** put it first in the growth sort order (`DashboardPage.jsx:11224–11236`); Content Center drops Today/Queue/Strategy/Results/Telegram tabs and `extraCategories:['social']` for admins.
- Gate: admin walkthrough; non-admin card list unchanged. This phase ships alone if needed.

**P3 — Social fold** (1–2 agents)
- `SocialPostingPanel` → Queue & Calendar "Compose" sub-tab; `XCalendarCard` body → "Quote targets" sub-tab; `XMonitorCard` → Results sub-tab (as-is, keeps `#x-monitor-card` and its confirm rows); Copywriter card category → growth strategy group; hide `x-calendar`, `x-monitor`, `social-media-posting` for admins.
- Gate: short reachability checklist in the PR (every old action → new location). No duplicate queue writers.

**P4 — Unified Refresh** (1 agent, then 1 reviewer)
- `marketing-refresh-button` + `marketing-refresh-panel` in the Marketing Director header; 7 groups exactly as §5 (group 1 = existing `generateReport` path; group 6 = `x-monitor {action:'sync-all'}`); sequential, each a terminal section via `runWithTerminal`, non-fatal per group; paid groups default OFF; confirm row names paid groups + estimate; selection remembered in localStorage (try/catch).
- Remove the old refresh buttons listed in §5 for admins only.
- Reviewer agent checks: no path where a paid call runs without the confirm row; crons untouched.

**P5 — Docs + ship** (1 agent)
- Short as-built SSOT `docs/source-of-truth/MARKETING-DIRECTOR.md`; one-paragraph updates to CONTENT-MANAGEMENT, X-STRATEGY-TAB, X-MONITOR-CARD, COPYWRITER-CARD, MARKET-SIGNALS-GENERATE-REPORT-FLOW, and the CLAUDE.md map. Preview deploy only after owner OK.

## Reporting (after each phase, compact)

- Files changed
- Exact behavior changed (admin) / what stayed untouched (non-admin)
- `npm test` + `npm run build` result
- Manual walkthrough steps for the owner
- Risks / not verified

Then **stop and wait for approval**. Do not start the next phase unprompted.
