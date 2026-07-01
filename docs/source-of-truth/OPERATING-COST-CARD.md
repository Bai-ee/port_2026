# Operating Cost card — cost visibility + instrumentation (SSOT)

Admin-only dashboard card that shows **live operating spend** — per-run, per-client, per-provider — plus provider ground-truth blocks (Anthropic org cost, ScrapeCreators credits) and an honest **Cost-sources coverage** table. Read this before touching cost tracking, `logUsage`/`logAnthropicCall`, or the account blocks.

> Sister doc: the daily-cron opt-in model that fixed the original cost leak lives in [`EMAIL-DIGEST-CARD.md`](EMAIL-DIGEST-CARD.md) § Daily opt-in. The two were built together (investigating a ~$10/day bill).

## Surface
- Card id **`operating-cost`**, `category: 'admin'` — defined in `DashboardPage.jsx` (admin-gated), registered in `CUSTOM_DETAIL_CARD_IDS`.
- Modal body: **`components/AdminCostView.jsx`** (`AdminOperatingCostView`). Renders in the `.vrk-scope` warm-paper modal. Windows: DAILY / 7D / 30D / 90D. Sections: metric grid → provider chips → **Anthropic account** → **ScrapeCreators account** → by-client→run→stage tables → **Cost sources** coverage → Fixed/subscription → Accounts & limits links.
- Feeder route (sole): **`app/api/admin/cost-report/route.js`** (`GET`/`POST`, admin-gated, read-only, `no-store`).

## Where the numbers come from
The card is honest about coverage. Every stream is labeled `tracked` (exact $) / `estimate` / `not-instrumented` in the route's `sources[]`.

| Stream | Source | Status |
|---|---|---|
| Pipeline stage costs (Scout/Scribe/Guardian/modules) | `brief_runs.providerUsage.stageCosts` (token-only) | tracked |
| Per-call ledger (leadgen, brand-system, narrators, **strategy, summaries, external-scout**) | `usage_events` (`estimatedCostUsd`) | tracked |
| Browserless screenshot/PDF | `browserless_requests` × flat `BROWSERLESS_PER_REQUEST_USD` | estimate |
| **Anthropic web_search surcharge** | now logged per-call ($10/1k, exact from `usage.server_tool_use`) for external-scout paths → folded into `usage_events` | tracked* |
| **last30days / ScrapeCreators** | ScrapeCreators account block (credits × `SCRAPECREATORS_USD_PER_CREDIT`) | estimate |
| Analysis recipes | `usage_events` (recipe-run + pre-digest) | tracked |
| KB chat | not yet routed through `usage_events` | not-instrumented |

\* Scout **stage-1** web_search surcharge is still only in stage-cost *tokens* (the surcharge itself isn't separately logged there yet).

⚠️ **The card only sees what reaches those two ledgers.** Any Anthropic call that neither writes a `stageCosts` entry nor calls `logUsage` is invisible — that was the entire ~$8.50/day gap. Instrument new call sites (below).

## The cost ledgers
- **Rate table + writer:** `api/_lib/usage-logger.cjs` — `RATES` (Haiku 4.5 $1/$5, Sonnet 4.5/4.6 $3/$15, gpt-4o/mini, gpt-image-1, gemini/imagen, serpapi). `logUsage()` writes one row per paid call to `usage_events`.
- **`logAnthropicCall({ module, action, model, response, clientId, runId })`** — the convenience wrapper. Reads `response.usage` and logs **token cost + web_search surcharge** (exact count from `usage.server_tool_use.web_search_requests` × `WEB_SEARCH_USD_PER_REQUEST` = $10/1k). Use this to instrument any Anthropic call not already in `stageCosts`.
- **Stage costs:** `computeStageCost()` in `features/not-the-rug-brief/optimizer.js` / `xscout.js` / `scribe.js` → assembled into `runCostData.stageCosts` → persisted to `brief_runs.providerUsage` at `api/_lib/run-lifecycle.cjs`.

### Instrumented call sites (Phase 2)
`logAnthropicCall` added to: `external-scouts/reddit-web-search.js`, `not-the-rug-brief/services/reviews.js`, `scout-intake/events-search.js`, `not-the-rug-brief/strategy-roller.js`, `strategy-builder/build-strategy.js` (×2: build-today + 30-day), `scout-intake/brief-summarizer.js` (exec/creative summaries). All best-effort (`try/catch`, never blocks the pipeline).

⚠️ `events-search` / `build-strategy` / `brief-summarizer` log with **`clientId: null`** (not in scope) → they land in the **"unknown" client bucket** but are correct in the module + provider totals. Threading `clientId` there is a pending refinement.

### To instrument a new Anthropic call
1. `const { logAnthropicCall } = require('<rel>/api/_lib/usage-logger.cjs');`
2. After the call: `try { await logAnthropicCall({ module: '<name>', action: '<sub>', model, response, clientId }); } catch {}`
3. If the model isn't in `RATES`, add it (token cost is $0 otherwise — the surcharge still logs).

## Provider account blocks (ground truth)
Both are **dormant until their key is in the SERVER env** (not just the subprocess config) and never throw — they render a "set key" hint otherwise.

- **Anthropic account** — `fetchAnthropicCost(windowDays)` calls `/v1/organizations/cost_report`. Requires **`ANTHROPIC_ADMIN_KEY`** (`sk-ant-admin…`) — **team-org only**; an Individual org cannot issue one, and a regular `sk-ant-api…` key is rejected by this endpoint. Includes the web_search surcharge the local ledgers can't fully see. ⚠️ The cost API **buckets by UTC day** and requires `ending_at` strictly after `starting_at` — dates are floored to UTC midnight (`endingAt` = start of tomorrow) or it 400s ("ending date must be after starting date"). DAILY = today's UTC spend.
- **ScrapeCreators account** — `fetchScrapeCreatorsUsage()` calls `/v1/account/credit-balance` + `/v1/account/get-daily-usage-count`. Requires **`SCRAPECREATORS_API_KEY`** (already in `~/.config/last30days/.env` for the subprocess — must also be in the server env). ⚠️ Each usage call **costs 1 credit** → cached in Firestore `scrapecreators_usage/latest`, 1h TTL; the section's **↻ live** button (`?refresh=1`) force-busts the cache. USD = credits × `SCRAPECREATORS_USD_PER_CREDIT` (editable constant, default `0.0012`; scraper credits only — last30days LLM planning not included).

## Env keys
`ANTHROPIC_ADMIN_KEY` (optional, team-org), `SCRAPECREATORS_API_KEY` — both in `.env.local` (git-ignored) **and** Vercel Production (add to `preview` too if used). Restart `next dev` / redeploy to load. Editable rate constants live at the top of `cost-report/route.js`: `FIXED_COSTS`, `BROWSERLESS_PER_REQUEST_USD`, `SCRAPECREATORS_USD_PER_CREDIT`.

## Files — quick map
- Card + modal: `DashboardPage.jsx` (`operating-cost`), `components/AdminCostView.jsx`.
- Route: `app/api/admin/cost-report/route.js`.
- Ledgers: `api/_lib/usage-logger.cjs` (`logUsage`, `logAnthropicCall`, `RATES`), `features/not-the-rug-brief/optimizer.js` (`computeStageCost`), `api/_lib/run-lifecycle.cjs` (persist).
- Parallel aggregator (OpsOverview mirror): `api/_lib/ops-overview.cjs`.
