# Handoff — Cost-Tracking Review + Daily Total (for Claude Fable 5)

**To:** Claude Fable 5 (reviewer). **From:** the implementation session that built the Operating Cost card + cost instrumentation + digest opt-in.
**Mode:** READ-ONLY audit. Do not edit code, do not push env, do not mutate Firestore. Produce findings + one number.

## Goal (state it up front, run at high effort)
1. **Confirm every paid API call in this repo is monitored/tracked** — or list exactly what isn't.
2. **Produce the total operating spend for TODAY** (a single USD figure) with a per-source breakdown and a reconciliation against provider ground-truth.

Give the full task the effort it needs; delegate the enumeration to sub-agents if useful; **ground every claim in a file:line or a query result** — do not assert "tracked" without pointing at the ledger write.

---

## Context you can trust (verify, don't re-derive)
- SSOT for this system: [`docs/source-of-truth/OPERATING-COST-CARD.md`](../source-of-truth/OPERATING-COST-CARD.md). Read it first.
- **Two ledgers are the ONLY things the cost card sees:**
  1. `brief_runs.providerUsage.stageCosts` — token-only pipeline stage costs (`computeStageCost` in `features/not-the-rug-brief/optimizer.js` / `xscout.js` / `scribe.js`).
  2. `usage_events` — per-call rows written by `logUsage()` / `logAnthropicCall()` in `api/_lib/usage-logger.cjs`.
  Anything that calls a paid API but writes to neither is **invisible** — that was the original ~$8.50/day gap.
- **`logAnthropicCall(...)`** logs token cost **+ the web_search surcharge** ($10/1k, exact from `response.usage.server_tool_use.web_search_requests`).
- **Feeder route:** `app/api/admin/cost-report/route.js` (`GET /api/admin/cost-report?days=1` = today). Reads the two ledgers + `browserless_requests` + the Anthropic org `cost_report` (needs `ANTHROPIC_ADMIN_KEY`, now set) + ScrapeCreators credits (needs `SCRAPECREATORS_API_KEY`, now set).
- **RATES** (rate table, `usage-logger.cjs`): Haiku 4.5 `$1/$5`, Sonnet 4.5/4.6 `$3/$15` per MTok; gpt-4o/mini; gpt-image-1 per-image; gemini/imagen; serpapi `$0.01`. Current Anthropic list pricing for cross-check: Haiku 4.5 $1/$5, Sonnet 4.5/4.6 $3/$15, Opus 4.8 $5/$25 (the app uses no Opus).

### Already instrumented (Phase 2 — verify each still writes a ledger row)
`logAnthropicCall` added to: `external-scouts/reddit-web-search.js`, `not-the-rug-brief/services/reviews.js`, `scout-intake/events-search.js`, `not-the-rug-brief/strategy-roller.js`, `strategy-builder/build-strategy.js` (×2), `scout-intake/brief-summarizer.js`. Recipes log via `logRecipeUsage` (`pre-digest-refresh`) + recipe-run route. Leadgen/brand-system/narrators log via `logUsage`.

### Known-remaining gaps at handoff (confirm still open, quantify if today's traffic hit them)
- Scout **stage-1** web_search **surcharge** (tokens are in stageCosts; the $0.01/search surcharge is NOT separately logged there).
- **KB chat** (`app/api/dashboard/knowledge-base/chat`), **market-category analyze** (`app/api/dashboard/market-category/analyze` — Sonnet **+ a `gpt-image-1`**), **Twitter copy** (`features/social-posting/twitter-service.js` `generatePromoCopy`/`enhancePost`), **client-brain refine** (`features/client-brain/store.cjs` `refineDraftWithModel`) — all call a paid API with no `logUsage`.
- Per-client attribution is `null` (→ "unknown" bucket) for events-search / build-strategy / brief-summarizer — module totals correct, per-client approximate.

---

## Part A — Coverage audit (deliverable: a table)
Enumerate **every** paid-API call site and classify it. Don't trust the lists above — regenerate and reconcile.

**Find the call sites** (repo root, exclude `node_modules`/`.next`):
- Anthropic: `messages.create`, `callAnthropic(`, `anthropic.messages`, `new Anthropic`, `createAnthropicClient(`, `api.anthropic.com`, `x-api-key`.
- OpenAI / images: `openai`, `images.generate`, `gpt-image-1`, `dall`, `chat.completions`.
- Google: `gemini`, `imagen`, `generativelanguage`.
- Search / scrape: `web_search_2025`, `serpapi`, `scrapecreators`, `lazyweb`, `last30days`, `browserless`.

**For each call site record:** `file:line` · provider · model · does it write `stageCosts`? · does it call `logUsage`/`logAnthropicCall`? · **verdict** (tracked / partial / untracked) · est. per-call cost driver (tokens vs surcharge vs flat) · trigger (user click / cron / worker).

**Cross-checks:**
- Every model string passed to `logAnthropicCall`/`computeAnthropicCost` exists in `RATES` (else token cost logs as $0 — grep model ids vs the RATES keys).
- The 6 instrumented sites actually reach `logUsage` (trace the call, confirm no early-return before it).
- Confirm the gap list above is complete — flag any NEW untracked call site.

**Output:** a ranked coverage table (untracked first) + a one-line coverage verdict ("N of M paid call sites tracked; untracked = …").

---

## Part B — Ledger + card correctness (deliverable: pass/fail notes)
- `RATES` matches current provider pricing (flag drift). web_search surcharge = `$10/1000` and reads `usage.server_tool_use.web_search_requests`.
- `cost_report` date handling is UTC-day-aligned (regression check: `fetchAnthropicCost` floors to UTC midnight, `ending_at` = start of tomorrow — else it 400s "ending date must be after starting date").
- ScrapeCreators: `SCRAPECREATORS_USD_PER_CREDIT` (0.0012 default) is sane vs the plan; usage calls are cached 1h (`scrapecreators_usage/latest`) so the card doesn't burn credits.
- No double-counting: web_search/recipes rows in the card's `sources[]` are marked folded-into-Per-call (usd 0), not summed twice.

---

## Part C — Today's total (deliverable: ONE number + breakdown + reconciliation)
Two independent computations, then reconcile:

**C1 — Local tracked total (from our ledgers, today only, UTC or the card's window):**
- Sum `brief_runs.providerUsage.stageCosts.estimatedUsd` for runs with `createdAt` today.
- Sum `usage_events.estimatedCostUsd` for events today.
- Browserless: today's completed `browserless_requests` × `BROWSERLESS_PER_REQUEST_USD`.
- ScrapeCreators: today's credits from `/v1/account/get-daily-usage-count` × `SCRAPECREATORS_USD_PER_CREDIT`.
- Non-instrumented (from Part A): estimate or mark `$?` — do not silently zero.

**C2 — Provider ground truth:**
- **Anthropic org `cost_report` for today (DAILY)** — includes the web_search surcharge our token ledger can't fully see. This is the authoritative Anthropic number.
- ScrapeCreators daily credits (same call as C1).

**Reconcile:** `C1(anthropic portion)` vs `C2(anthropic)`. Explain the delta (expected: C2 ≥ C1 by the un-logged scout stage-1 surcharge + any untracked call sites from Part A). If the delta is large, that IS the finding — name which untracked source accounts for it.

**Report the day's total** = C2(anthropic) + ScrapeCreators + browserless + any non-anthropic `usage_events` (OpenAI/image/serpapi) today + (optionally) fixed/subscription daily proration (`FIXED_COSTS` in the route ÷ 30). Show the breakdown as a table; state the single USD figure plainly.

### How to run C (pick one)
- **Easiest:** call the card's route with admin auth: `GET /api/admin/cost-report?days=1` (returns `totals`, `byProvider`, `clients`, `anthropic` account block, `scrapeCreators`). Add `&refresh=1` to force-fresh the ScrapeCreators block. Requires an admin bearer token (Firebase ID token of an admin user) — or run against local dev where the two keys are in `.env.local`.
- **Direct:** query Firestore (`brief_runs`, `usage_events`, `browserless_requests`, `scrapecreators_usage`) via the admin SDK (`api/_lib/firebase-admin.cjs`) with a `createdAt >= startOfTodayUTC` filter; hit `https://api.anthropic.com/v1/organizations/cost_report` with `ANTHROPIC_ADMIN_KEY` (day-aligned `starting_at`/`ending_at`) for C2.

---

## Deliverables (what to hand back)
1. **Coverage table** (Part A) + coverage verdict.
2. **Correctness notes** (Part B) — pass/fail per item, with file:line.
3. **Today's total** (Part C): the single USD figure + breakdown table + the C1↔C2 reconciliation + which untracked source (if any) explains the gap.
4. **Prioritized remediation list** — the untracked call sites, each with the one-line fix (`logAnthropicCall`/`logUsage` at file:line, add model to `RATES` if needed). Do NOT apply; just list.

## Guardrails
- Read-only. No code edits, no env changes, no Firestore writes, no deploys.
- Ground every "tracked/untracked" claim in a file:line or a query result — no assertions from memory.
- If a number can't be obtained (missing auth, key, or data), say so explicitly and mark it `$?` rather than guessing.
