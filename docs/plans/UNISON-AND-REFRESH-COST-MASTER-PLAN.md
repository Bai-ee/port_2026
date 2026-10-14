# Unison + Refresh cost control — master plan and orchestrator prompt (autonomous, start to production)

Status: approved by owner 2026-10-13, execute start to finish, ship to production. Owner tests in production.
Base: `main` at `b44a6710` (Client Brain source of truth, PR #5). Worktree: `/Users/bballi/Documents/Repos/Bballi_Portfolio-content-center`.
Prior SSOTs to read first: `docs/source-of-truth/MARKETING-DIRECTOR.md`, `CLIENT-BRAIN-SOURCE-OF-TRUTH.md`, `MARKET-SIGNALS-GENERATE-REPORT-FLOW.md`, `EMAIL-DIGEST-CARD.md`, `X-STRATEGY-TAB.md`.

## Why

Two gaps after the last two releases:
1. **Unison.** The Market Signals report (`projectBrief`) feeds the REPORT tab, the Executive Brief page, the daily email and the agents, but Today's slot drafts never see it, and the daily email never carries the X plan / Today queue. The owner wants one pipeline where the brief informs what gets posted and the email shows what the system is about to do.
2. **Cost control vs streamlining.** Decision: **keep every "what to search" toggle where it is** (Market Signals per-source / per-item parks, analysis skills, digest include toggles, X Monitor confirm rows). They are the cost controls. **Run surfaces = the Marketing Director Refresh only** (7 groups, paid default OFF, confirm row). Make the toggles visibly pay off inside Refresh and make config one click from the run surface. Do not rebuild either.

## Owner decisions (final, never re-ask)

- Admin only (`isAdmin` branches). Non-admin cards, crons, publisher, reservation ledger, X writes untouched.
- No new run buttons anywhere. Email Digest "Generate & Send" stays (it is a send). Market Signals per-source "Run" spot-check stays (diagnostic). Everything else that runs a paid call for admins must be the Refresh.
- Digest refresh/send is NOT a Refresh group (would reintroduce a spend path from the dashboard header).
- Today's drafts get the brief as context, never as auto-posted content. The draft rule stays: template or model only when `draftWithModel:true`.
- Ship when done: commit, PR to `main`, squash, confirm Vercel production Ready, report deploy id + rollback id.

## Scope

### Part 1 — Unison

**1a. Brief → Today drafts.** `readContentContext` in `app/api/dashboard/quote-targets/route.js` adds a compact `marketSignals` block from `projectBrief(state.marketingBrief, state)`: headline, up to 6 topics, up to 5 opportunities (topic + angle), up to 5 brand mentions, report `generatedAt`. Cap the block at ~1,500 chars. `daily-run-generate` passes it to both the template drafter and `createModelDrafter` (as a "What the market is talking about today" section in the prompt; the model may reference a topic only when the slot's engine/track fits it). Template drafter: when a slot has no inventory match and a topic matches the slot's track topics, the fallback draft names the topic as the hook. Suggestion trigger `hot narrative` must now be set from this block (it was labelled in the panel last release; verify the producer sets `trigger.kind='market'` with the topic as reason). Memoize `projectBrief` per request so the Today card's two parallel context loads don't double the cost; while there, memoize `loadLoopCorpora` per client for 60s (the known Today slowness).

**1b. Today's plan + queue → daily email.** New digest section `todayPlan` (`features/intelligence/_digest-config.js` SECTIONS, default **ON** for the home/admin client only, OFF otherwise; legacy configs auto-expand). Renders in `buildEmailHtml` as "Today's plan": per track posts/day target vs scheduled today, the next 5 queued posts (time, type, first 120 chars, status), pending proposal cards count, and a "Open Marketing Director" link. Data = existing readers (`x_strategy_plans`, `social_posts` due today, pending proposals in the strategy chat store). Read-only, LLM-free, gated only by its toggle with an explicit empty state (SSOT §9 rule). Add the toggle to the hardcoded list in `components/AdminEmailModals.jsx`. Preview must match the sent email.

**1c. MCP daily brief** (`features/mcp/tools/playbook.js` `get_daily_brief`) includes the same "Today's plan" block so ChatGPT and the email say the same thing.

### Part 2 — Refresh cost control

**2a. Live cost estimate per group from config.** `components/dashboard/marketing/refresh-groups.js` gets `estimateFor(groupId, ctx)` where `ctx` = `{ marketingBriefConfig, analysisRecipes, xMonitorState, todayWithModel }` (passed from DashboardPage, already loaded there). Group 1: sources on × handles × skills on → "4 sources · 8 handles · 2 skills · ~$0.40"; group 6: calls = sync-all call count → "3 metered X calls"; Today with model: "1 Claude call per slot · N slots". Free groups say "free". Numbers use the per-unit costs already documented in `MARKET-SIGNALS-AND-SCOUT-PROJECTION.md` §1b and `X-MONITOR-CARD.md`; when a unit cost is unknown, show the count and no dollar figure, never a guess. The confirm row sums the estimates.

**2b. "What runs →" link per paid row** (id `marketing-refresh-config-link-<group>`): group 1 → opens Market Signals (`openCapabilityCardById('signals')`, Market tab), group 6 → Results › X Monitor, Today → Publishing settings. Uses the existing `openCapabilityCardById` helper; no new navigation code.

**2c. Straggler audit.** Grep every admin-visible button that triggers a paid call (`generateReport`, `updateReportFromSignals`, `watchlist-pull`, `opportunity-signals/refresh`, `x-monitor` POST, `recipe-run`, `scout-test`, `refresh-handles`, strategy review). For each: either it is the Refresh, the Email Digest send, the Market Signals per-source spot-check, an agent proposal card, or it gets hidden for admins with `isAdmin ? null : <old>`. Produce the table in the SSOT. Non-admin paths unchanged.

**2d. Refresh panel copy.** Row meta becomes `<last refreshed> · <estimate>`; a one-line footer: "Toggles in each card decide what a group searches. Refresh only runs it."

### Part 3 — Docs + ship

- `docs/source-of-truth/MARKETING-DIRECTOR.md`: new §"Cost model: config vs run" (the two axes, the straggler table, estimate formula). One paragraph each in `EMAIL-DIGEST-CARD.md` (`todayPlan`), `MARKET-SIGNALS-GENERATE-REPORT-FLOW.md` (brief → Today context), `HITLOOP-MCP-SERVER.md` (daily brief block), `X-STRATEGY-TAB.md` (market context in drafts). Local `CLAUDE.md` map entry.
- Ship: commit, PR, squash merge, Vercel prod Ready, `hitloop.agency/login` 200.

## Guardrails

- No paid call runs without the Refresh confirm row, the digest send, or the spot-check button. Estimates are display only.
- No cron changes. No publisher/reservation/X-write changes. No new libraries. No new test suites; existing `npm test` green (2 pre-existing `studio-render` vendor-sync failures allowed; the IBL pacing test is flaky and passes alone), `next build --webpack` green.
- Never edit `DashboardPage.jsx` while a local run is streaming. Build only in the worktree. Keep `CLAUDE.md`, `.claude/`, `.mcp.json`, `docs/company-brain/clients/*/live-export-*` untracked.
- Localhost smoke is view-only (local points at the prod database): no Refresh runs, no sends, no approves.

---

# Orchestrator prompt (Opus) — dispatch Sonnet agents in waves, do not stop for approval

You are the orchestrator. Read this file top to bottom, then the SSOTs listed at the top. Execute all three parts and ship to production in this run. Dispatch Sonnet agents with disjoint file lists; each gets this file path, its item, its files, and "touch only your files; return a diff summary + anything you could not do". Merge, test, build between waves. If `npm test` or the build fails on something you cannot fix in 30 minutes, stop and report instead of shipping.

**Wave 0 — you (10 min):** `cd` to the worktree, `git fetch origin && git checkout -b feat/unison-refresh-cost origin/main`. Confirm `git log -1` = `b44a6710`. Read `refresh-groups.js`, `MarketingRefreshControl.jsx`, `runMarketingRefresh` in `DashboardPage.jsx`, `readContentContext` + `daily-run-generate`, `_digest-config.js` SECTIONS, `buildEmailHtml`'s section list, `get_daily_brief`. Write the exact file list per agent below into your dispatch messages.

**Wave 1 — 4 Sonnet agents in parallel**
- **A1 (1a)** `app/api/dashboard/quote-targets/route.js`, `features/x-content/standalone.js` (fallback draft hook), the model drafter module (`createModelDrafter` and its prompt), the Today suggestion producer (set `trigger.kind='market'`). Memoize `projectBrief` per request and `loadLoopCorpora` per client (60s).
- **A2 (1b)** `features/intelligence/_digest-config.js`, `app/api/admin/daily-digest/route.js` (section render + data read), `components/AdminEmailModals.jsx` (toggle). Reuse existing readers; no LLM.
- **A3 (2a + 2d)** `components/dashboard/marketing/refresh-groups.js`, `components/dashboard/marketing/MarketingRefreshControl.jsx`. `estimateFor` is pure; export it; one tiny unit test allowed.
- **A4 (2c audit, read-only report)** grep + table of every admin paid-call button and its fate; no edits. Returns the table to you.

Merge, `npm test`, build.

**Wave 2 — 3 Sonnet agents in parallel**
- **B1 (2b + 2c edits)** `DashboardPage.jsx` only: pass the estimate `ctx` into `MarketingRefreshControl`, wire the "What runs →" links through `openCapabilityCardById`, hide the stragglers from A4's table for admins. Minimal diffs, stable ids.
- **B2 (1c)** `features/mcp/tools/playbook.js` + `features/mcp/__tests__` (registry count unchanged, brief shape test if cheap) + `features/mcp/readers.js` if a reader is missing.
- **B3 (Part 3 docs)** the five SSOT updates + the local `CLAUDE.md` entry (do not commit CLAUDE.md).

Merge, `npm test`, build.

**Wave 3 — you:** smoke on `npx next dev --webpack -p 3100`, admin, view-only, 10 minutes: dashboard loads with no console errors; Refresh panel shows estimates + "What runs →" links and the links open the right card; Email Digest SETTINGS shows the Today's plan toggle and EMAIL PREVIEW renders the section (preview is free); Today opens (note load time before/after the memo). Stop the dev server. Then commit, push, `gh pr create` to `main`, `gh pr merge --squash`, verify Vercel production Ready from `/Users/bballi/Documents/Repos/Bballi_Portfolio` with `vercel ls --yes`, and `https://hitloop.agency/login` → 200. Update the local `CLAUDE.md` map entry to SHIPPED with deploy id + rollback id (the previous production deploy).

## Final report (one message, compact)
- Commit, PR, merge sha, production deploy id, rollback deploy id
- Files changed (by wave)
- Behavior changed (admin) / untouched (non-admin, crons, publisher)
- The straggler table (button → fate)
- Estimate formula per group and which units have no dollar figure
- `npm test` + build (name the pre-existing failures)
- Live-data writes: must read "none"
- Owner prod steps: toggle Today's plan in Email Digest if wanted → open Refresh and read the estimates → run group 1 → open Today and look for `market` triggers
- Risks / not verified
