# X Strategy Tab — Master Plan (prototype)

Date: 2026-10-11 · Status: **IN BUILD — autonomous run authorized 2026-10-11 (no phase stops)**
Worktree/branch: `~/Documents/Repos/Bballi_Portfolio-daily-loop` · `feat/daily-content-loop`.
Runs **after** the daily-loop Phase S6 (corpus merge, quote-react floor, quote-commentary fill) and S5 (real run) close.

## 0. What we are building

A **Strategy** tab in the Content Engine card that makes the X strategy engine visible and steerable:

1. **Accounts.** Enter your handle and up to 5 benchmark handles (any X account). Refresh pulls their timelines.
2. **Evaluation.** Cadence, type mix, lift, top gaps, recommended tier. Every figure states its data window and caveats (row count, staleness, likes-only).
3. **Plan.** The settings every downstream planner uses: authored posts/day, tier, per-type floors/caps, engine targets. Editable by hand, versioned, with change history.
4. **Agent chat.** Talk to an agent about the data and the plan. It reads everything the engine reads. It **proposes** changes as cards: plan settings, Today-tab suggestion edits/dismissals, item stories, regenerate. You confirm or reject each card. Confirmed cards call the same write paths the UI uses, so chat replaces hand-editing without creating a second way to change things.

One question it answers: *"Given my account and the accounts I'm measured against, how much and what should I post, and is today's plan doing that?"*

## 1. Good-enough bar (prototype)

- Works end to end for @bai_ee vs @seb__design on localhost. Other handles work if `bird` can read them.
- Refresh runs **only where `bird` works** (the Mac running `next dev`). On Vercel the button queues a request, which a local worker drains. No paid X API, no ScrapeCreators timeline (it returns 0 posts for small accounts).
- The agent never writes without a confirmed card. No auto-apply, no scheduling, no posting.
- Chat is non-streaming, one request per turn. Polish (streaming, multi-thread UI, per-client corpora for every client) goes to §9.

## 2. Verified current state (read before building)

| Piece | Where | Note |
|---|---|---|
| Profile: ownHandle, benchmarkHandles (≤5), lanes, tierOverride, mode, timezone | `features/x-benchmark/profile.js` → `client_configs/{id}.marketingBriefConfig.xGrowth` | ⚠️ The save route normalizes an explicit field list; an un-normalized field is silently dropped. |
| Tiers | `profile.js TIERS` (1=4/day … 4=16/day), `resolveTier` | |
| Corpus stat blocks | `features/x-benchmark/store.js` → `x_corpora/{handle}` (`readCorpus`, `readCorpora`, `saveGapReport`) | Stats only. **Rows are not stored anywhere** except the two committed JSON files. |
| Rows the planner needs | `docs/audits/{bai-ee,seb-design}-x-corpus.json`, statically imported in `quote-targets/route.js:41-42` | Hard-wired to @bai_ee/@seb__design (comment at route `handleContentPlan`). |
| Ingest | `scripts/x-content/ingest-corpus.mjs` (bird, local cookies, `--out` rows, `--write` stats) | CLI only; logic lives in `main`. bird has **no views**. |
| Gap report | `features/x-benchmark/{summarize,compare}.js` | Likes-based lift; can't see quote-react reach. |
| Refresh analysis (15-day calendar) | route `handleRefreshAnalysis` → `saveGapReport` | A second path from stat blocks; the Plan tab uses rows instead. Two paths, to be unified (T5). |
| Day plan | `features/x-content-inventory/plan-day.js buildDayPlan({corpusRows, benchmarkRows, packages, date, posts, engineConfig})` | Plan tab passes `posts` from a 5/8 picker that isn't persisted; doesn't pass `engineConfig`. |
| Engine config | `engine-quota.js DEFAULT_ENGINE_CONFIG`, `mergeEngineConfig`, `bucketsToEngineConfig`; route reads `content_system_config/x` (global, not per client) | |
| Daily loop | `features/x-content-inventory/daily-loop/*` (slots, fillers, run store, review) | S6 adds a quote-react floor in `slots.js`; T5 generalizes it. |
| Existing chat UI pattern | `components/dashboard/BrandSystemChat.jsx` + `app/api/brand-system/chat` | Reuse the visual idiom (`.chat-confirm-btn`), not the code. |
| LLM cost logging | `api/_lib/usage-logger.cjs logAnthropicCall`, `RATES` | Every agent call must log. |
| Route | `app/api/dashboard/quote-targets/route.js` (admin-gated `requireAdminContext`) | **Vercel Hobby: no new route files.** All actions go here. |

## 3. Ground rules (every agent)

- Phase discipline: build only the approved phase; stop for approval after each.
- No commits without owner approval; no push; no deploy.
- **No X API calls, no paid calls** except agent-chat model calls the owner triggers in the UI (and, during build, at most 5 test turns per phase with approval). bird reads are free and allowed.
- No Firestore writes from agents during build except through tests' memory stores, or a run the owner approves.
- File ownership per track (§6). Touching another track's file means stop and report.
- New UI elements get stable kebab-case ids (`x-strategy-*`). Mobile ≤480px uses the standard containers (`docs/dashboard-ui/MOBILE-WIDTH-STANDARD.md`).
- Pure logic in `features/x-strategy/*` (ESM, I/O injected). Tests per track in `features/x-strategy/__tests__/`.
- Never invent numbers. Every evaluation figure and agent claim traces to a corpus row set with a stated window.

## 4. Module layout

```text
features/x-strategy/
  corpus-rows.js      merge-by-id (keep views), chunking, freshness   (pure)
  corpus-store.js     x_corpora/{handle}/rows/{n} + meta; seed from committed JSON  (I/O)
  ingest.js           ingestHandle({handle,tz,days,runBird}) — extracted from the CLI
  refresh.js          refresh decision: inline (bird available) | queued; queue store
  plan-state.js       plan shape, defaults, validate, applyChange, diff, history  (pure)
  plan-store.js       x_strategy_plans/{clientId} read/write with version check  (I/O)
  evaluate.js         rows → evaluation view model + caveats + baseline plan  (pure)
  agent/
    prompt.js         system prompt from Seb model §5–7 + evaluation + plan + caveats
    tools.js          tool schemas + handlers (read tools, propose tools)
    loop.js           Anthropic tool-use loop, round cap, cost logging  (I/O injected)
    proposals.js      proposal shape, validate, execute-on-confirm via injected actions
    chat-store.js     x_strategy_chats/{clientId}/threads/{threadId} (bounded)
  index.js            barrel
scripts/x-content/strategy-refresh-worker.mjs   drains queued refreshes on the Mac
components/dashboard/x-content/StrategyPanel.jsx      tab body
components/dashboard/x-content/StrategyChat.jsx       chat column + proposal cards
```

## 5. Contracts (lock in T0)

**Rows store** — `x_corpora/{handle}/rows/{0..n}`, each `{rows: Row[≤250]}`. Meta on `x_corpora/{handle}.rowsMeta = {rowCount, range:{from,to}, pulledAt, viewsCoverage, chunks, source:'bird'|'committed-json'}`. Row = the `normalizeTimeline` shape already in the committed JSON. Merge by `id`: newer metrics win, existing `views` is kept when the incoming row has none.

**Plan** — `x_strategy_plans/{clientId}`:
```js
{ version: 7, updatedAt, updatedBy,
  plan: {
    authoredPerDay: 4,            // drives buildDayPlan `posts` and the tier
    tier: 1,                      // derived from authoredPerDay unless pinned
    typeFloors: { 'quote-react': 1 },   // generalizes the S6 floor
    typeCaps: {},                 // e.g. { 'quote-commentary': 1 }
    engineTargets: {},            // mergeEngineConfig overrides (per client)
    benchmarkPrimary: 'seb__design',
    notes: ''                     // human/agent rationale, shown on the Plan card
  },
  history: [ { version, at, by, source:'manual'|'chat', proposalId?, diff, reason } ]  // last 30
}
```
Handles stay in the existing `xGrowth` profile (one source); the plan doc never duplicates them.

**Evaluation view model** — `{own:{handle,rows,range,stale,viewsCoverage,cadence,byType}, benchmarks:[…], gaps:[…top 8], recommendedTier, caveats:[string], baselinePlan}`. Caveats always include "likes-only lift" when views coverage <50%, row counts <60, and data older than 7 days.

**Proposal** — `{id, threadId, kind, payload, summary, rationale, evidence:[{source, figure}], status:'pending'|'confirmed'|'rejected'|'failed', result?}`. Kinds and the action each runs on confirm:

| kind | executes | notes |
|---|---|---|
| `plan-change` | `strategy-plan-apply` | diff of plan fields; version-checked |
| `benchmarks-change` | existing xGrowth save path (normalized) | ≤5 handles |
| `suggestion-edit` | `daily-run-edit` | text only |
| `suggestion-dismiss` | `daily-run-dismiss` | |
| `suggestion-save-draft` | `daily-run-save-draft` | still unscheduled, create-once |
| `item-story` | `update-item-facets` (story) | fixes empty text/showcase slots; agent writes only from facts the owner gave in chat |
| `regenerate-today` | `daily-run-generate` (model off unless owner ticks) | |
| `refresh-handles` | `strategy-refresh` | |

**Route actions** (all on `quote-targets/route.js`, admin-gated): `strategy-get`, `strategy-refresh`, `strategy-refresh-status`, `strategy-evaluate-handle`, `strategy-plan-apply`, `strategy-plan-revert`, `strategy-chat-send`, `strategy-chat-history`, `strategy-proposal-decide`.

## 6. Phases and tracks

### T0 — Contracts + spikes (one agent, sequential)
- Write `features/x-strategy/index.js` stubs and typedefs for §5; pin the plan defaults from `DEFAULT_ENGINE_CONFIG` + `TIERS`.
- Spike 1: can `ingest-corpus.mjs main` be split into `ingestHandle` with no behaviour change? Report the diff size.
- Spike 2: time a full seb__design pull (4 bird rounds). If >120s, refresh is always async (queued, polled), even on localhost.
- Spike 3: confirm `bird` can be detected from the Next server process on localhost (path list in `ingest-corpus.mjs:66-67`).
- Deliverable: contracts committed as docs + stubs, spike numbers. Stop.

### T1 — Data foundation (parallel, after T0)
| Track | Owns | Task |
|---|---|---|
| T1a rows | `corpus-rows.js`, `corpus-store.js`, tests | Chunked rows store, merge-keep-views (reuse S6's merge fn), seed from the two committed JSONs, `readRows(handle)` with fallback to committed JSON. |
| T1b refresh | `ingest.js`, `refresh.js`, `scripts/x-content/ingest-corpus.mjs` (refactor to call `ingest.js`), `strategy-refresh-worker.mjs`, tests | `ingestHandle` extracted; CLI output byte-identical. Refresh = inline when bird is detected and `X_STRATEGY_LOCAL_INGEST=1`, else write `x_strategy_refresh_requests/{id}` and return `queued`. Worker drains the queue (manual run; launchd later). Max 6 handles/request, sequential, stop on 429 with a clear status. |
| T1c plan | `plan-state.js`, `plan-store.js`, tests | Validate (authoredPerDay 1–16, floors ≤ authoredPerDay, known types only), applyChange → new version + history entry, diff, revert. Version mismatch → 409. |

### T2 — Evaluation + route (two agents)
| Track | Owns | Task |
|---|---|---|
| T2a evaluate | `evaluate.js`, tests | Rows → view model using `summarize`/`compare`/`resolveTier`; caveats; baseline plan (recommended tier, floors from the plan doc). Test: likes-only caveat present when views missing; fresh vs committed data both evaluate. |
| T2b route | `quote-targets/route.js` (strategy actions only), tests | `strategy-get` (profile + rowsMeta + evaluation + plan + today's plan preview), `strategy-refresh(-status)`, `strategy-evaluate-handle` (ad hoc; no rows → "needs refresh"), `strategy-plan-apply/revert`. No other route edits. |

### T3 — Strategy tab UI (one agent, after T2)
- `StrategyPanel.jsx` + a `strategy` tab button in `XContentEngineCard.jsx` (id `x-content-tab-strategy`, placed first; remembered-tab logic unchanged).
- Sections (ids): `x-strategy-accounts-panel` (handle inputs, per-handle freshness, Refresh button + status), `x-strategy-evaluation-panel` (own vs benchmark mix table, cadence, top gaps, caveats), `x-strategy-plan-panel` (posts/day, tier, floors/caps, Save → apply, history list with Revert), `x-strategy-chat-panel` (placeholder until T4).
- Desktop: evaluation + plan left, chat right. ≤480px: stacked, chat last.

### T4 — Agent (two agents in parallel, then integration)
| Track | Owns | Task |
|---|---|---|
| T4a core | `agent/prompt.js`, `agent/tools.js`, `agent/loop.js`, tests with a fake model | Read tools: `get_evaluation`, `get_plan`, `get_today_run`, `search_inventory` (summary rows, max 20), `top_posts` (own or benchmark, by type/topic, max 10). Propose tools: one per proposal kind. Loop: ≤4 tool rounds/turn, ≤2 proposals/turn, `logAnthropicCall` each call, model constant `STRATEGY_AGENT_MODEL` (default `claude-sonnet-4-6`, already in `RATES`). Prompt rules: cite figures with source, say "no data" rather than guess, state the likes-only caveat when discussing quote-reacts, never claim experiences/facts the owner hasn't given. |
| T4b proposals + chat store | `agent/proposals.js`, `agent/chat-store.js`, route actions `strategy-chat-send/history`, `strategy-proposal-decide`, tests | Thread capped at 60 messages (older summarized to a short note). Confirm runs the mapped action with the owner's auth context; result stored on the proposal; a stale proposal (plan version moved) → `failed: stale`, re-propose. Daily turn cap (default 60/day/client) with a visible count. |
| T4c chat UI | `StrategyChat.jsx`, tests if any | Message list, input, proposal cards with Confirm/Reject (ids `x-strategy-proposal-<id>`), cost/turn footer, "refreshes the Plan/Today views on confirm". |

### T5 — One plan everywhere (one agent)
- `content-plan`, `refresh-analysis`, and the daily loop's `planSlots` read `x_strategy_plans/{clientId}` (authoredPerDay → `posts`, `engineTargets` → `mergeEngineConfig`, `typeFloors/typeCaps` → `slots.js`, replacing S6's hard-coded floor) and read rows via `readRows` instead of the static JSON imports.
- Plan tab: the 5/8 picker becomes a read-out ("4/day from Strategy — change it there").
- Absent plan doc → today's behaviour exactly (tests prove it).

### T6 — Acceptance run + docs
- Owner-run on localhost: refresh both handles, evaluate, change posts/day in chat ("make it 3/day and keep one quote-react"), confirm, see Plan + Today update.
- SSOT `docs/source-of-truth/X-STRATEGY-TAB.md`; update `X-GROWTH-SYSTEM.md` §1 and the repo map line.

## 7. Acceptance

**Tier 1 — mechanics**
- Refresh @bai_ee + @seb__design on localhost; rows stored, views from the old rows preserved, freshness shown.
- Evaluation renders with caveats; numbers match `ingest-corpus.mjs` dry-run output for the same rows.
- Hand edit of posts/day → new plan version → Plan tab and the daily loop use it; Revert restores it.
- Chat: a question about the data gets an answer citing figures; a change request yields a proposal card; Confirm applies it once; Reject changes nothing.
- No X API calls; every model call logged with `estimatedCostUsd`.

**Tier 2 — usefulness (owner judges)**
- The agent's explanation of the gap report is correct and flags the likes-only bias unprompted on quote-reacts.
- At least one Today-tab suggestion improved through chat instead of the editor.
- At least one item story written via chat (from facts the owner typed) fills a text/showcase slot on Regenerate.

**Tier 3 — later** (see §9).

## 8. Risks

- **bird is local-only.** Prod refresh is a queue; if the worker isn't run, data goes stale. The UI must show age loudly.
- **429s** on bird for many handles. Sequential, max 6, stop-and-report.
- **Likes-only lift** misleads on quote-reacts. Caveat in evaluation + agent prompt; views backfill is metered and out of scope.
- **Agent writes.** Mitigated by proposal-only tools, version checks, and executing through existing actions (no new write paths).
- **Chat cost.** Each turn ≈ $0.01–0.05 (prompt carries evaluation + plan). Daily cap + visible spend.
- **Two analysis paths** (`refresh-analysis` stat blocks vs rows). T5 unifies on rows; until then the Strategy tab says which it shows.
- **Shared `plan-day.js` consumers** (`day-view.mjs`, Plan tab): T5 changes inputs only; snapshot before/after.
- **Firestore doc size**: rows chunked ≤250/doc; chat capped.
- **Arbitrary handles**: evaluating someone else's account is read-only public data; no storage of anything beyond their public posts' normalized rows.

## 9. Elevation backlog (after the prototype works)

1. Streaming chat; multiple named threads.
2. Per-client handles/corpora for every client (today: admin + @bai_ee first).
3. Views backfill for own posts from X Monitor (fix its 0-impressions/staleness first), then views-based lift.
4. launchd for the refresh worker, piggybacking the 06:45 scan job.
5. Agent memory of owner preferences across threads (e.g. "never suggest crypto price posts").
6. Weekly strategy review: auto-evaluate Sundays, agent writes a summary for the owner to read.
7. Agent-drafted copy for slots (today: copy stays in the daily loop's drafter).

## 10. Agent brief template (orchestrator → track agent)

```text
You are building track <ID> of docs/plans/X-STRATEGY-TAB-MASTER-PLAN.md. Read §2, §3, §5 and your track row first.
Own ONLY these files: <list>. If you need anything else, stop and report.
Contracts in §5 are fixed; if one is wrong, report it, don't change it.
Tests: features/x-strategy/__tests__/<track>.test.js; run them plus the x-content-inventory, x-benchmark and x-quote-targets suites.
No commits, no X/paid calls, no Firestore writes. Report: files changed, behaviour, tests (counts), what's unverified.
```
