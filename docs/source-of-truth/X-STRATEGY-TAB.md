# X Strategy tab — SSOT (as built)

> **Marketing Director unification (2026-10-13, POC, admin only, uncommitted on `feat/marketing-director-poc`):** For admins the Strategy panel (chat, document, plan/cadence, content tracks, insights, history, review) is no longer a Content Center tab; it mounts as the **Strategy** card (`strategy-document`) in Marketing Director › WHAT'S OUR STRATEGY, and the Strategy-account refresh and ContentTracks refresh buttons are hidden for admins in favor of the header Refresh (group 4 Strategy accounts, free, Mac worker). Stale for admins: the "Strategy tab inside Content Center" location and any instruction to click a Refresh button in the panel; `StrategyPanel`'s `onNavigate` is inert in the standalone mount. Plan and backend semantics are unchanged. See [`MARKETING-DIRECTOR.md`](MARKETING-DIRECTOR.md).

> **Content Management (2026-10-11):** plan ownership, the shared input context, the single post lifecycle, scheduling and results now follow [`CONTENT-MANAGEMENT.md`](CONTENT-MANAGEMENT.md). Where this doc disagrees about who decides cadence, who creates/approves/schedules a post, or what chat may do, that doc wins.


Built 2026-10-11 on `feat/daily-content-loop` (uncommitted at time of writing). Build record: [`docs/plans/x-strategy-build-log.md`](../plans/x-strategy-build-log.md). Original plan (historical): [`docs/plans/X-STRATEGY-TAB-MASTER-PLAN.md`](../plans/X-STRATEGY-TAB-MASTER-PLAN.md). T0 spikes: [`docs/plans/x-strategy-t0-spikes.md`](../plans/x-strategy-t0-spikes.md). Parent system: [`X-GROWTH-SYSTEM.md`](X-GROWTH-SYSTEM.md).

## 1. What it is

The **Strategy** tab (first tab, `x-content-tab-strategy`) of the Content Engine card. It makes the X strategy engine visible and steerable: accounts + refresh, evaluation (own vs benchmarks), a versioned plan, and an agent chat that only **proposes** changes.

One question it answers: *"Given my account and the accounts I'm measured against, how much and what should I post, and is today's plan doing that?"*

Code: `features/x-strategy/**` (logic), `components/dashboard/x-content/{StrategyPanel,StrategyChat}.jsx` (UI), `app/api/dashboard/quote-targets/route.js` (the 10 strategy actions, delegated to `features/x-strategy/route-handlers.js`), `scripts/x-content/strategy-refresh-worker.mjs` (queue drain).

## 2. Data flow

```text
 bird CLI (browser cookies, free, LOCAL ONLY)
      |
      v                                     UI "Refresh" -> strategy-refresh
 ingest.js ingestHandle  <---- refresh.js requestRefresh -- writes x_strategy_refresh_requests/{id} (queued)
      ^                          |  X_STRATEGY_LOCAL_INGEST=1 AND `bird --version` ok -> drains in-process (not awaited)
      |                          '- otherwise: Mac worker  strategy-refresh-worker.mjs --once  -> drainQueue()
      |
      v  mergeRowsById (keeps views; newer metrics win)
 corpus-store  x_corpora/{handle}/rows/{0..n} + x_corpora/{handle}.rowsMeta
      |   (fallback: committed docs/audits/*-x-corpus.json for bai_ee / seb__design)
      v
 evaluate.js (summarizeCorpus / compareToBenchmark / resolveTier + caveats)
      |
      +--> strategy-get -> Strategy tab (accounts, evaluation, plan, "Today: N posts from plan vN")
      |
 x_strategy_plans/{clientId}  <-- strategy-plan-apply / -revert (manual) | confirmed plan-change proposal (chat)
      |
      v  plan-inputs.js resolvePlanInputs  (the ONE plan -> planner-inputs function)
 content-plan + refresh-analysis (content-plan.js) --> Plan tab read-out ("4/day from Strategy plan vN")
 daily loop planSlots (posts, engineConfig, typeFloors, typeCaps; run doc strategySource.planSource/planVersion)

 chat:  Strategy tab -> strategy-chat-send -> agent/loop.js (Anthropic, read tools) -> proposals (pending, stored in thread)
        -> owner clicks Confirm/Reject -> strategy-proposal-decide -> agent/proposals.js executor (existing write path)
           plan-change -> planStore.apply | benchmarks-change -> xGrowth saver | suggestion-* / regenerate-today -> daily-run actions
           item-story -> update-item-facets (story only) | refresh-handles -> strategy-refresh
```

## 3. Collections, shapes, writers

| Collection | Shape | Written by (only) |
|---|---|---|
| `x_corpora/{handle}/rows/{0..n}` | `{rows: Row[<=250]}` | `corpus-store.js` (`writeMergedRows`, committed-JSON seed) |
| `x_corpora/{handle}.rowsMeta` | `{rowCount, range:{from,to}, pulledAt\|null, viewsCoverage 0..1, chunks, source:'bird'\|'committed-json'}`; merged onto the doc, other fields (stat blocks) untouched | `corpus-store.js` |
| `x_strategy_plans/{clientId}` | `{version, updatedAt, updatedBy, plan:{authoredPerDay, tier(derived), typeFloors, typeCaps, engineTargets, benchmarkPrimary, notes}, history[<=30]}`; history oldest-first, each entry `{version, at, by, source:'manual'\|'chat', proposalId?, diff, reason, before, after}` | `plan-store.js` (Firestore transaction) |
| `x_strategy_chats/{clientId}` | `{turns:{'YYYY-MM-DD': n}, updatedAt}` daily counter | `agent/chat-store.js` |
| `x_strategy_chats/{clientId}/threads/{id}` | `{messages[<=60], summaryNote?, proposals{id->proposal}, createdAt, updatedAt}` | `agent/chat-store.js` |
| `x_strategy_refresh_requests/{id}` | `{id, handles[], status, requestedBy, createdAt, results{handle->{status,added,updated,rowCount,viewsBefore,viewsAfter,error?,errorKind?}}, leaseId?, leaseAt?, startedAt?, finishedAt?, error?}`; statuses `queued, running, done, partial, failed, rate-limited, bird-unavailable` | `refresh.js` (lease-fenced) |

Rules (all enforced in code, tested):
- All writes go through the stores above. An absent plan doc is never auto-created; the first write is `apply` with `expectedVersion: 0` -> v1.
- Plan changes are version-checked (mismatch -> 409 `currentVersion`). A revert writes a NEW version restoring that version's `after`; history is never rewound.
- The agent never writes `social_posts`, `x_content_packages` or `client_configs`. Its tools are read tools + propose tools; propose tools validate and return a proposal, nothing else.
- The only `client_configs` write in the feature is `marketingBriefConfig.xGrowth` via `createXGrowthProfileSaver` (normalized with `normalizeXGrowthProfile`, merge write). It runs on two **owner-initiated** paths: the owner-clicked `strategy-profile-save`, and an owner-**confirmed** `benchmarks-change` proposal (same saver). Nothing else touches `client_configs`.
- Daily-run / inventory writes happen only through the existing route actions (`daily-run-*`, `update-item-facets`), invoked by an owner-confirmed proposal executor.
- Refresh (queue, ingest, corpus merge) never calls the X API, ScrapeCreators, or a model.

## 4. Route actions

All on `POST /api/dashboard/quote-targets` (folded onto the existing route; written under Vercel Hobby, still the convention on Pro). Auth: `requireAdminContext` at the top of `POST` (admin only; non-admin never reaches the handlers). Every action except `strategy-refresh-status` also requires `body.clientId` equal to the admin-selected client (`context.clientId`): missing or contains `/` -> 400, mismatch -> 403. Failures are `{ok:false, status, error, ...}`; the route returns that HTTP status. Unexpected throws (5xx) propagate.

| Action | Request | Success response | Errors |
|---|---|---|---|
| `strategy-get` | `{clientId}` | `{ok, clientId, profile (withDefaultPair; `defaulted[]`), rowsMeta[] (per handle: source, rows, freshness), evaluation, evaluationError?, plan (doc or null), todayPlanPreview {available, date, posts, usedPlan, plan, summary} \| {available:false, reason}}` | 400/403 client |
| `strategy-refresh` | `{clientId, handles?}` (default = profile own + benchmarks) | `{ok, requestId, status:'queued'}` (drain, if any, not awaited) | 400 no handles / bad handle / >6 handles; 400/403 client |
| `strategy-refresh-status` | `{requestId}` | `{ok, request}` | 400 bad id, 404 not found (not client-scoped; admin-only) |
| `strategy-evaluate-handle` | `{clientId, handle}` | `{ok, handle, needsRefresh, rowsMeta, evaluation?, missingOwn?, ownHandle?}`; no rows -> `needsRefresh:true` | 400 invalid handle |
| `strategy-plan-apply` | `{clientId, changes, expectedVersion, reason?}` | `{ok, plan (doc), changed}` (no-op -> `changed:false`) | 400 invalid (`errors[]`), 409 `version-conflict` (`currentVersion`) |
| `strategy-plan-revert` | `{clientId, version}` | `{ok, plan, changed}` | 400 invalid version, 404 no plan, 400 `version-unavailable` (aged out of history) |
| `strategy-chat-send` | `{clientId, text (<=2000), threadId?}` | `{ok, threadId, text, proposals[], droppedProposals?, usage, rounds, stopped, turnsUsedToday, cap}` | 400 text/threadId; 404 thread; 429 `chat-cap` (`used`,`cap`); 502 agent failure (turn still counted); 503 chat/model not configured (turn NOT consumed) |
| `strategy-chat-history` | `{clientId, threadId?}` | `{ok, turnsUsedToday, cap, thread, threads?}` (no id = latest of up to 20) | 404 thread; 503 |
| `strategy-proposal-decide` | `{clientId, threadId, proposalId, decision:'confirm'\|'reject', options?:{useModel}}` | `{ok, proposal, planDoc? (plan-change only)}` | 400 params; 404 thread/proposal; 409 already decided or `deciding`; 500 record failure; 503 |
| `strategy-profile-save` | `{clientId, ownHandle, benchmarkHandles[<=5]}` | `{ok, profile}` | 400 (`errors[]`), 501 no saver |

## 5. Proposal kinds

Status flow: `pending -> deciding -> confirmed | failed`, or `pending -> rejected`. Executors run only on **Confirm** by the owner; Reject runs nothing; nothing is ever auto-confirmed. A stored proposal's `payload` is normalized to the fields its kind may carry. Confirm re-validates at execute time.

| Kind | Executor (on confirm) | Guards |
|---|---|---|
| `plan-change` | `planStore.apply` (`source:'chat'`, `proposalId`) | payload `{changes, expectedVersion}`; merged plan must pass `validatePlan`; `tier` not settable; **stale check**: current version != `expectedVersion` -> status `failed`, `result.error:'stale'` + `currentVersion` (re-propose) |
| `benchmarks-change` | xGrowth saver (`marketing-brief-config` path) | handles re-validated (valid handle, <=5, deduped, own not also a benchmark); may change own, benchmarks, or both |
| `suggestion-edit` | `daily-run-edit` `{suggestionId,text}` | text <=1000; `suggestionId` must exist (checked at propose time against today's run) |
| `suggestion-dismiss` | `daily-run-dismiss` | same id check |
| `suggestion-save-draft` | `daily-run-save-draft` | same id check; still unscheduled, create-once |
| `item-story` | `update-item-facets` with **story only** (never `humanEdits`/facets) | `sourceQuote` **>=20 chars**, must appear verbatim (normalized) in the **owner's** messages in this conversation; story <=1000; quote shown on the card |
| `regenerate-today` | `daily-run-generate` | model drafting OFF; `draftWithModel` true **only** if the owner ticks "use the model" on the card at confirm time (`options.useModel`, honored only for this kind); a model-authored `useModel` flag is ignored |
| `refresh-handles` | `strategy-refresh` | 1-6 valid handles; each must be in the profile (own + benchmarks) or named by the owner in the conversation |

`deciding` semantics: confirm atomically claims the proposal (`pending -> deciding`, persisted). It is **never auto-reclaimed** (no TTL; an executor may run for minutes and re-running is worse than a stuck card). It is released back to `pending` only if the executor provably did not run (decide returned not-ok / threw before executing). If the executor ran but the result could not be saved after 3 attempts, it stays `deciding` and the route returns 500 "do not retry; check Today/Plan". A second confirm on `deciding` -> 409.

## 6. Caps, limits, env

| Limit | Value | Where |
|---|---|---|
| Messages per thread | 60 (older folded into `summaryNote`, <=600 chars, deterministic, no model) | `chat-store.js` |
| History sent to the model | last 60 messages + summary note | `route-handlers.js` |
| Chat turns per client per UTC day | 60 default; env `X_STRATEGY_DAILY_TURN_CAP` (positive int) | `chat-store.js` (reserved atomically before any model work; a failed model turn still counts) |
| Chat message length | 2000 chars | route-handlers |
| Tool rounds per turn | 4 (then a "no more tools" note forces a text answer) | `agent/loop.js` |
| Proposals per turn | 2 | loop + route |
| Handles per refresh request | 6 | `PLAN_LIMITS.maxHandlesPerRefreshRequest` |
| Benchmark handles | 5 | `PLAN_LIMITS.maxBenchmarkHandles` |
| Plan history | 30 | `PLAN_LIMITS.historyCap` |
| authoredPerDay | integer 1-16 | `PLAN_LIMITS` |
| Rows per chunk doc | 250 | `corpus-rows.js CHUNK_SIZE` |
| Stale data | >7 days | `STALE_AFTER_DAYS` |
| bird call timeout | 90 s; env `X_STRATEGY_BIRD_TIMEOUT_MS` | `ingest.js` |
| Stale `running` refresh lease | 30 min (reclaimable; done handles not re-pulled) | `refresh.js` |
| Model | `claude-sonnet-4-6` (`STRATEGY_AGENT_MODEL`), max_tokens 1500 | `agent/prompt.js`, `loop.js` |

Env vars: `X_STRATEGY_LOCAL_INGEST=1` (allow in-process drain when bird is detected), `X_STRATEGY_BIRD_COOKIE_SOURCE` (default `chrome`; passed as `--cookie-source`), `X_STRATEGY_BIRD_TIMEOUT_MS`, `X_STRATEGY_DAILY_TURN_CAP`, `ANTHROPIC_API_KEY` (chat only; absent -> 503, no turn consumed), optional `BIRD` (binary path override).

## 7. Absent plan doc = legacy behaviour

If `x_strategy_plans/{clientId}` does not exist, every consumer behaves exactly as before the feature (`resolvePlanInputs(null)` -> posts undefined, no engine overrides, default quote-react floor, no caps). `content-plan` / `refresh-analysis` run an explicit **legacy branch** (static committed corpora, no profile-derived handles, stat-block refresh-analysis, no 409). Daily-loop run fingerprints include the plan version only when a plan exists, so old run docs are not invalidated; suggestion ids are unchanged so edits survive.

Guarded by golden fixtures in `features/x-strategy/__tests__/fixtures/t5-golden/` (day-view default/4/8 with a frozen clock; content-plan 5/8/3 posts; planSlots undefined/3/5/6/8; daily-run replay; `legacy-golden.json` = the pre-T5 route handlers sliced verbatim from git `5cfce1e9`) and `__tests__/t5-golden.test.js`. Also `fixtures/golden/` (A-F) pins the ingest CLI output.

Default-profile fallback: if the client's `xGrowth` profile is empty, `withDefaultPair` fills **per field** `ownHandle: bai_ee`, `benchmarkHandles: [seb__design]`, `timezone: America/Chicago`, and lists the filled fields in `profile.defaulted` (the UI shows a notice). Reason: the client's profile was empty and writing it was not authorized during the build.

With a plan: `authoredPerDay` -> `posts`; non-empty `engineTargets` -> `mergeEngineConfig`; `typeFloors/typeCaps` -> slots; `benchmarkPrimary` picks the benchmark. `refresh-analysis` uses cadence + primary benchmark only (calendar ignores floors/caps).

## 8. Runbook

**Refresh.** UI: Strategy tab -> Refresh. It writes a request and returns `queued`; it drains in-process only when `X_STRATEGY_LOCAL_INGEST=1` and `bird --version` succeeds on the server. Otherwise run on the Mac:

```bash
X_STRATEGY_BIRD_COOKIE_SOURCE=chrome node scripts/x-content/strategy-refresh-worker.mjs --once
# or: --loop <seconds>
```

The UI polls `strategy-refresh-status`. Measured 2026-10-11: bai_ee 1 round + seb__design 4 rounds = 93 s total (so refresh is always async). Sequential per handle. **429**: the request ends `rate-limited`, remaining handles `skipped`, no retry in that run (verified live; wait for it to clear). **Cookie access (Safari `EPERM`)**: request ends `bird-unavailable`; use the Chrome cookie source. Rows pulled before a mid-pull error are kept (`partial`). Re-running is idempotent (0 added/0 updated). CLI equivalents: `scripts/x-content/ingest-corpus.mjs` (dry run / `--out` / `--write` stat block) and `scripts/x-content/merge-corpus.mjs --handle <h> --tz <n> --days 65 [--dry-run]` (updates the committed JSON by metrics-only merge).

**Revert a plan.** Strategy tab -> plan history -> Restore on a version (`strategy-plan-revert`); it creates a new version equal to that version's `after`. Only the last 30 versions are restorable. No plan at all = legacy behaviour; to go back to it the `x_strategy_plans/{clientId}` doc must be deleted by hand (no UI action does this).

**Test the agent without spend.** Inject a fake `callModel` into `createAgentLoop` / `createStrategyHandlers` (see `__tests__/agent-loop.test.js`, `agent-integration.test.js`, `agent-transport.test.js` for the fake transport). A bare `createStrategyHandlers` has `env = {}` so it can never reach a real model.

**Cost.** Observed per chat turn $0.018-0.070 (about $0.025 average over the 11 build-time calls, $0.2459 total). Each call is logged via `logAnthropicCall` to `usage_events` with `purpose`/`action` `x-strategy-chat`, `module: 'x-strategy'`, `clientId`, `estimatedCostUsd`; it therefore shows in the Operating Cost card. The turn response carries `usage`.

**Mobile.** Panel adds no horizontal padding of its own (the 22px comes from `.tile-detail-tab-content`). Layout stacks at narrow widths, chat last; no document horizontal overflow at 400px (verified in a 400px same-origin iframe). The evaluation table scrolls inside its own container (MIX column is cramped; known). All interactive elements carry `x-strategy-*` ids.

## 9. Traps

- **bird is local-only** (browser cookies). On Vercel the button only queues; if the worker is not run, data goes stale. The UI shows data age.
- **Likes-only lift** undervalues quote-reacts (they borrow reach; bird has no views). Evaluation always carries `likes-only` (views coverage <50%), `few-rows` (<60), `stale` (>7d), and `quote-react-undervalued` caveats; the agent prompt requires stating it.
- **Chrome windows cannot go below ~500px**: to test the 400px layout use a same-origin iframe of the real dashboard.
- **Dev server first load is slow** (first compile of the dashboard + route); do not read it as a hang.
- **Vercel static-import loader for committed corpora — do not remove.** `quote-targets/route.js` builds `loadCommitted` from static imports of `docs/audits/*-x-corpus.json` and passes it to the stores; a runtime `fs` read would not be traced into the function bundle.
- **`features/x-strategy/index.js` must stay pure/client-safe** (contracts, corpus-rows, plan-state, evaluate, ui-model, plan-inputs). All I/O lives behind `server.js` (corpus-store, plan-store, ingest, refresh, route-handlers, agent/*, chat-store). The client imports `index.js` only.
- **Chat answers must be plain text** (the chat renders raw text; the prompt bans markdown tables/bold). The prompt fix was added after a live turn rendered raw markdown and was not re-verified with a live call.
- **Editing today's run needs a daily-run doc.** `suggestion-*` proposals and the agent's `get_today_run` need a run doc for today's local date (created by `daily-run-generate`); without one the agent answers "no data". The confirm path is covered by tests, not by a live run.
- **`planSlots` clamps to 7/day** (`TIER_1_MAX_POSTS`). Plans of 8-16 still validate and show 7 in the daily loop (recorded as `postsRequested`).
- `plan.tier` is derived (`tierForAuthoredPerDay`, the tier the cadence sits in; 4/day = tier 1), not `resolveTier` (the next step up). Floors/caps keys must be real calendar slot types; `reply` and `retweet` are rejected.
- The merge keeps existing `views` and non-metric fields (metrics-only merge); never replace rows wholesale.
- Prefer the existing route over new route files for this feature; the project is now on Vercel Pro (see `VERCEL-HOBBY-DEPLOYMENT.md` banner).
- A confirmed `benchmarks-change` writes `client_configs`; `normalizeXGrowthProfile` drops fields it does not know, so any new profile field must be added there first.

## 10. Known limitations (master plan section 9 items)

| Item | State |
|---|---|
| 1. Streaming chat; multiple named threads | Not built. One non-streaming request per turn; the UI shows the latest thread plus New thread. |
| 2. Per-client handles/corpora for every client | Not built. Per-client plan and chat docs exist; corpora are per handle and the profile falls back to the bai_ee/seb__design pair. |
| 3. Views backfill / views-based lift | Not built. Lift is likes-based. |
| 4. launchd for the refresh worker | Not built. Run the worker manually. |
| 5. Agent memory across threads | Not built. |
| 6. Weekly strategy review | Not built. |
| 7. Agent-drafted copy for slots | Not built (copy stays in the daily loop's drafter). |

Other known gaps (from the build log): the evaluation table is cramped at 400px; `refresh-status` is not client-scoped; the floor-conversion path still sets `engine:null`; `writeChunks` is not atomic across a crash (single writer assumed); `assertTurnAvailable` is unused outside the store; up to 5 model calls can occur on a round-capped turn; `plan.notes` goes into the system prompt (owner-confirmed text); the daily loop with a plan and the `regenerate`/`suggestion-*` confirm paths were verified by tests only (no run doc for today existed); a partial-profile default is disclosed via `profile.defaulted`.

## 11. Tests

Run: `node --test features/x-strategy/__tests__/*.test.js` (targeted) and `npm test` (full suite). Counts from the build log: x-strategy alone 245 at T4; full suite 4511 tests, 4509 pass, 2 known failures (`vendor-api-lib`, pre-existing) after T5 (baseline 4208).

| File (`features/x-strategy/__tests__/`) | Guards |
|---|---|
| `contracts.test.js` | constants, derived defaults, tier derivation (4/day -> tier 1), proposal kind -> action map |
| `corpus-rows.test.js` | chunking, merge-by-id keeping views / metrics-only merge, freshness, rowsMeta |
| `corpus-store.test.js` | chunked rows store, meta merge without clobbering, committed-JSON seed/fallback |
| `ingest.test.js` (+ `fixtures/golden`, `fake-bird.mjs`) | `ingestHandle` characterization, CLI byte-identity, failure classification, timeout |
| `refresh.test.js` | queue lifecycle, lease fencing/heartbeat/reclaim, stop-on-429, EPERM, handle limits |
| `plan-state.test.js` / `plan-store.test.js` | validation, applyChange, diff, history cap, revert, version conflict, transaction contention |
| `evaluate.test.js` | view model, caveats, gaps vs primary benchmark, tiers |
| `plan-inputs.test.js` | plan doc -> planner inputs; `null` = legacy defaults |
| `content-plan.test.js` / `t5-golden.test.js` | legacy branch byte-equivalence, plan-driven behaviour, goldens |
| `route-handlers.test.js` | all 10 actions, client check, error codes, caps |
| `agent-tools.test.js` / `agent-loop.test.js` / `agent-transport.test.js` | tool schemas and guards (sourceQuote, handle rules), round/proposal caps, cost logging, transport errors |
| `proposals.test.js` / `chat-store.test.js` | validation, executors, claim/deciding/release, stale, thread bounds, daily cap |
| `agent-integration.test.js` | the halves wired together (7 interface mismatches were found here) |
| `ui-model.test.js` | UI view-model helpers (refresh status, history rows, labels) |

## Content tracks (2026-10-11)
`plan.contentTracks`, per-track benchmarks/profiles and the "Content tracks" panel: see [`CONTENT-TRACKS.md`](CONTENT-TRACKS.md).

## Strategy document (2026-10-12)

The owner's strategy in words, above the plan knobs: doc (why/what) → plan (how much) → daily loop. Plan of record:
[`docs/plans/X-STRATEGY-DOCUMENT-MASTER-PLAN.md`](../plans/X-STRATEGY-DOCUMENT-MASTER-PLAN.md).

- **Store:** `x_strategy_docs/{clientId}` `{version, updatedAt, updatedBy, confirmed, sections{thesis, audience, tracks,
  formats, rules, algorithm, decisions, open}, lastReview, history[≤25]}`. Pure logic `features/x-strategy/strategy-doc.js`,
  store `strategy-doc-store.js` (version-checked transactions), seed draft `strategy-doc-seed.js`. Section cap 2,000 chars.
  History keeps only changed sections' before/after; restore writes a NEW version.
- **Draft vs confirmed:** no doc ⇒ the seed draft (version 0, never persisted by a read). The owner's first manual save
  confirms it. A chat edit never confirms. Only a confirmed doc reaches drafting.
- **Actions:** `strategy-doc-get` / `strategy-doc-save` (sections + expectedVersion) / `strategy-doc-revert` /
  `strategy-review` (one agent turn with a fixed brief, 6 rounds / 2,500 tokens, stamps `lastReview` with doc + plan
  version and the newest corpus `pulledAt`). Same daily turn cap as chat.
- **Agent:** the doc (+ last 5 changes) is in the system prompt (capped 7k chars). New proposal kind `strategy-doc-edit`
  `{section, text, expectedVersion}` → executor writes source `chat` (stale ⇒ `failed/stale`). New read tools:
  `get_strategy_doc`, `get_algorithm` (active ranking profile), `score_posts` (scoreXPost, originals only),
  `get_rule_check` (guardXPost over own last N days), `get_audience` (stored X Monitor data, never syncs).
  Pure shapers in `features/x-strategy/insights.js`; scorer/guard/profile injected by `route-handlers.js`.
- **Daily loop:** `loadContentContext` reads the doc when `readStrategyDoc` is wired (dashboard route + worker cron) and
  lists it as input `strategy-doc`. A CONFIRMED doc's Rules + Formats (`strategyGuidance`, ≤1,800 chars) join the
  drafting voice; its version joins the run fingerprint and the run doc (`strategyDocVersion`). Draft/absent ⇒ no change
  (t5 golden stays byte-identical).
- **UI:** Details sub-tab **Strategy** (`StrategyDocPanel.jsx`, `#strategy-doc-panel`, `#strategy-doc-section-<key>`);
  header row `#x-strategy-actions-row` (Refresh data = `strategy-refresh` for own + benchmarks; Review strategy);
  `#x-strategy-review-due-banner` when corpora are newer than `lastReview.dataAsOf`; chat shows manual doc edits as
  `doc-history` rows and doc-edit cards with the current section text; empty chat offers "Start strategy session".
- **Cost:** prompt caching on tools + system + newest message (`withPromptCache` in `agent/loop.js`); cache-aware cost
  in `usage-logger.cjs` (write 1.25×, read 0.1×). Measured review: ~$0.40 before caching, ~$0.17 after (5 calls).
- **Not yet:** Strategy Builder does not read the doc; chat cannot edit queued/scheduled posts (planned follow-up).

## Queue edits + Market Signals (2026-10-12)

- **`get_market_signals`** (read tool): latest Market Signals report for the client, read from `dashboard_state/{clientId}.marketingBrief` through the canonical `projectBrief` (`features/intelligence/_brief-intel.js`). Shaped by `shapeMarketSignals` (tools.js): headline, summary, topics, opportunities, competitors, creators, brand mentions, Reddit/Instagram highlights; under 6k chars; `generatedAt` and `stale` (older than 72h); a `notice` marks the text as third-party quoted data. Absent report or reader => `{available:false, reason}`. Reader is the route dep `readMarketSignals(clientId)`. Never refreshes, never spends.
- **`get_queue`** now returns up to 200 newest posts from the route (every source: strategy-builder, copywriter, daily-run, content engine), shows each row's `source`, and takes optional `status` and `source` (prefix match) filters; the model still sees at most 20 rows.
- **`post-edit` proposal** (`propose_post_edit`, payload `{postId, text?, scheduledAt?, expectedUpdatedAt}` plus display-only `currentText/currentStatus/currentScheduledAt`): only posts in `draft | approved | scheduled`. `scheduledAt` is allowed only for an already-scheduled post and must be in the future (chat never schedules from nothing). Text max 280. At confirm the executor re-reads the post (this client only), re-checks status and `updatedAt` (changed => `{error:'stale'}`; also `not-editable`, `not-found`, `not-scheduled`, `past-time`), then writes through the existing update path (`updateSocialPost`, same as the Queue tab `update` action, with `expectedRevision` so a concurrent edit also reads as stale). `updateSocialPost` owns the status effect: on lifecycle-v2 rows a text edit voids approval and the schedule (post returns to draft), and the result line reports the post's resulting status. The card shows current vs new text. Chat still never approves, schedules or publishes.
- **For other server modules (MCP)**: `createStrategyHandlers(...)` also returns `toolDepsFor(clientId, context?)` (fresh read-tool deps bound to one client; use with `runReadTool` / `prepareProposal`) and `createProposalInThread({clientId, threadId?, proposals})` (validates, assigns and persists proposals into a chat thread, default `t_mcp_<yyyymmdd>`, so they appear as pending cards; executes nothing; max 5 per call). Wired deps in `app/api/dashboard/quote-targets/route.js`: `readMarketSignals`, `editPost` (`editQueuedPost`).
- Tests: `features/x-strategy/__tests__/chat-queue.test.js`.

## Client Brain as source of truth (2026-10-13)

The Strategy Document sections, content tracks (label, share, topics, benchmarks) and per-track postsPerDay (Track Targets) are owned by the approved Client Brain, which overwrites even a confirmed doc on approve, inject or Re-sync. Doc and plan saves write back through the injectable `onBrainOwnedSaved` hook in `route-handlers.js` (loop-guarded by source `client-brain`). New proposal kinds `post-approve`, `post-schedule`, `post-unschedule` execute on owner confirm through the existing social-posting update/schedule path. `evaluate.js` adds `byTrack` (benchmark profile vs Brain target vs actual). SSOT: [`CLIENT-BRAIN-SOURCE-OF-TRUTH.md`](CLIENT-BRAIN-SOURCE-OF-TRUTH.md)

## Market context in Today (2026-10-13)

`raw.marketSignals` (from the saved brief, see MARKET-SIGNALS-GENERATE-REPORT-FLOW.md section 13) now steers Today. The model drafter (`daily-loop/drafter.js`) gets a "What the market is talking about today" prompt section, fenced as quoted data, non-quote slots only; a topic is used only when it fits the slot. Template fallback (`daily-loop/copy.js` `marketHookTopic`/`marketHookLine`): a package-less original slot with no inventory match names a market topic as the hook only when it overlaps the track's `topics` (empty by default, so no hook). `run.js` sets `trigger = {kind:'market', reason: topic}`; `present.js` labels it "Hot narrative". The draft rule is unchanged (model only with `draftWithModel:true`); the cron daily-loop route has no market block. In `app/api/dashboard/quote-targets/route.js`, `memoByClient` promise caches: `readMarketSignals` 12s per client (dedupes the Today card's two parallel loads), `loadLoopCorpora` 60s per client; evicted on rejection.
