# X Growth — productization plan

> **Status:** Phases 0–5 are BUILT (2026-09-12). Phase 6 remains blocked, for the reasons below.
> As-built reference now lives in
> [`docs/source-of-truth/X-GROWTH-SYSTEM.md`](../source-of-truth/X-GROWTH-SYSTEM.md) §8b — this doc
> keeps the phase-by-phase rationale and the decisions, not the current contract.
>
> **Original status:** PLAN. Nothing in Phases 1–6 was built. The as-built single-account system is documented in
> [`docs/source-of-truth/X-GROWTH-SYSTEM.md`](../source-of-truth/X-GROWTH-SYSTEM.md) — that doc wins on
> anything describing current behavior. This doc only describes the path from "works for `@bai_ee`" to
> "every signed-up client runs it on their own data."
>
> **Scope right now:** `@bai_ee` stays the only live account. Every phase below is built so the
> single-account case keeps working unchanged while the client-scoped seams get added underneath it.

---

## Objective

Turn the `@bai_ee` X strategy loop into a per-client product:

1. A client's X account is **measured against benchmark accounts** that already win in their lane (the
   `@seb__design` → `@bai_ee` comparison, generalized into a function).
2. The measured gap **produces the calendar** — cadence tier, slot count, post-type mix, hour shape —
   instead of a hand-written 15-day JSON.
3. A **daily scan** finds live posts worth attaching to, fills the dynamic slots, and drafts copy in the
   client's own voice, scored against the X algorithm profile and filtered by the content guard.
4. The client sees and approves it from a dashboard card, off their own brief data.

---

## Current architecture

All of it is **untracked in git** as of 2026-09-12 (Phase 0 exists to fix that).

| Layer | Where | Client-scoped? |
|---|---|---|
| Benchmark + own corpus | `docs/audits/{seb-design,bai-ee}-x-corpus.json`, `-x-stats.json` | ❌ handles hardcoded in `scripts/x-content/research/analyze-corpus.mjs` |
| A/B comparison | `docs/audits/x-dashboard.{html,template.html}` + `x-dashboard-data.json` | ❌ `HANDLES = { seb, baiee }` in `build-dashboard-data.mjs`; findings are prose, not a function |
| Content guard | `features/x-content-guard/` | ❌ lane vocabulary is Bryan's lanes |
| Quote-target watchlist | `features/x-quote-targets/watchlist.js` | ❌ 39 handles pasted by hand |
| Ranking | `features/x-quote-targets/rank.js` | ✅ pure, no account assumptions |
| Day plan | `features/x-quote-targets/day-plan.js` | ✅ pure — takes a calendar object as input |
| Calendar | `docs/audits/x-calendar-15day.json` | ❌ hand-written, static-imported by the route |
| Scanner | `scripts/x-content/scan-quote-targets.mjs` | ✅ `--client` aware, writes per client |
| Card + route | `components/dashboard/XCalendarCard.jsx`, `app/api/dashboard/quote-targets/route.js` | ✅ reads/writes `dashboard_state/{clientId}` |
| Draft seeder | `scripts/x-content/seed-calendar-drafts.mjs` | ✅ `--client` aware |
| Account metrics | `features/x-monitor/` (`x_monitor/{accountId}`) | ⚠️ keyed by **X account**, not client |

**The split is clean:** everything that *executes* is already client-scoped; everything that *decides* is
hardcoded to one account pair. Productizing means moving the decisions into per-client data, not
rewriting the runtime.

---

## The productized model

Three layers per client, each a distinct data contract.

### Layer 1 — Profile (who this client is on X)

Sourced from data the client already has in the system, not a new questionnaire:

| Field | Source today |
|---|---|
| `ownHandle` | `social_accounts/{clientId}.platforms.x` (connected identity) |
| `benchmarkHandles[]` | seeded from the brief's category/competitors, then owner-confirmed |
| `lanes[]` | Client Brain positioning + the brief's category |
| `voice` | `loadClientBrainContext(clientId, { useFor: 'socialPosts' })` — approved-only |
| `tier` | **computed** by Layer 2, not entered |

The point of "works off the briefs": a client who has completed onboarding already has a category,
competitors, brand terms, and an approved Client Brain. Benchmark discovery and lane assignment should
start from those, so the client's first X plan exists before they configure anything.

### Layer 2 — Benchmark A/B (what the gap actually is)

A pure function over two corpus stat blocks → a ranked gap report:

- post-type mix and per-type engagement rate (`original-showcase` vs `quote-react` vs `self-quote` …)
- posts/day, occupied hours/day, posts per occupied hour
- caption length bands per type (the 21–66ch quote-react finding, generalized)
- media mix (video vs image vs text) and its measured multiplier
- vein/lane performance
- reply rate and stranger-eligibility mix

Each gap carries a projected upside so the calendar can be generated from the top few instead of all of
them. This is the layer that today exists only as prose inside `x-dashboard.html`.

### Layer 3 — Daily loop (what to post today)

Unchanged in shape from as-built, but fed by Layers 1–2:

```
derived watchlist  →  scan (local, bird)  →  rank  →  day-plan  →  compose (voice + guard + score)
                                                                      →  social_posts draft
                                                                      →  card / approval
```

---

## Storage contract

Additive — no existing field changes meaning. **As built**, with the two places the build departed from
this proposal marked.

| Data | Location | Notes |
|---|---|---|
| X growth profile | `client_configs/{clientId}.`**`marketingBriefConfig.xGrowth`** | ⬅ **changed:** nested under `marketingBriefConfig` rather than a top-level key, so it rides the one save route that already normalizes and stale-form-guards client config. ⚠️ that route normalizes an **explicit field list** — a block it does not name is dropped on every save, the trap `brandXHandle` already hit. |
| Corpus stat block + watchlist seed | **`x_corpora/{handle}`** | ⬅ **changed:** its own collection, not `x_monitor`. That one is keyed by immutable X user id; a corpus arrives keyed by handle, and mixing key types in one collection fails silently months later. Shared across clients — one benchmark ingested once. |
| Raw corpus rows | *not stored* | ~650KB per account and nothing downstream reads them. The one artifact that needs them (the watchlist) is derived at ingest. |
| Gap report | `dashboard_state/{clientId}.marketingBrief.xGrowth.gapReport` | Recomputed on ingest, not on read. |
| Generated calendar | `dashboard_state/{clientId}.marketingBrief.xGrowth.calendar` | Replaces the static `x-calendar-15day.json` import. |
| Scan output | `dashboard_state/{clientId}.marketingBrief.quoteTargets` | **As-built, unchanged.** |
| Drafts | `social_posts` (`source:'x-calendar'`) | **As-built, unchanged.** |

---

## Keep vs change

**Keep as-is:** `rank.js`, `day-plan.js`, the scanner's client flag and rate-limit handling, the
`quote-targets` route contract, `social_posts` as the draft store, the 36h quote window, the guard's
narrow hard-block policy and its replay harness.

**Change:** `watchlist.js` becomes a derived artifact (`deriveWatchlist(benchmarkCorpus)`) with the
current 39 handles kept as `@bai_ee`'s seed; the static calendar JSON becomes generated; the research
scripts collapse into one parameterized ingest; the dashboard HTML becomes a render of the compare
engine's output rather than the place the analysis lives.

**Do not touch:** `scoreXPost` and `features/x-growth/` scoring internals; `marketingBriefConfig.kols`
(shared Market Signals surface); the X API spend-gate protocol.

---

## Constraints that shape the design

All verified in the 2026-09-10/11 build session.

1. **`bird` needs browser cookies ⇒ ingest and scan run on a Mac, never on Vercel.** This is the single
   biggest productization blocker: a self-serve client cannot trigger their own corpus pull today.
2. **Rate limits:** a 39-account sweep returned 429 on 32. Per-client sweeps multiply this. Multi-client
   needs one shared account budget with rotation, not N independent scans.
3. **ScrapeCreators returned 0 posts <24h for a small account** — that is why the *scan* is local. It is
   **unverified** whether it can serve a *historical* corpus for a *large* benchmark account, which is a
   different request. If it can, benchmark ingest becomes hostable and only own-account ingest stays
   local. Cheap to test; do it before designing around the limitation.
4. **Vercel Hobby cron is once daily** (`process-due`, `40 13 * * *`) ⇒ multi-post-per-day still cannot
   auto-post. Approval-mode drafting is the honest product until Pro or an external trigger.
5. **`scoreXPost` has no borrowed-reach model** — valid on originals, wrong on quote-reacts. The compare
   engine must supply quote-react guidance from the corpus, not the scorer.
5b. **Engagement rate is the wrong headline metric here, and one earlier claim used it.** The "3.36%
   engagement rate" cited for `@bai_ee`'s `original-showcase` is `avgER` — the mean of per-post ratios,
   which a few low-view posts inflate badly. Pooled ER for the same set is **1.68%**, *below* that
   account's 1.84% average. The conclusion survives on a sounder statistic (showcase is its best type at
   **1.61× its own average likes**), but any consumer rendering per-type ER should use pooled, and view
   coverage must be shown next to it — the benchmark's views are a 25% top-liked sample.
6. **`docs/audits/` is not deployed** — the route static-imports the calendar JSON so Next bundles it.
   Generated calendars must come from Firestore, which removes that workaround rather than extending it.
7. **Vercel Hobby 12-function packaging cap** — prefer new actions on the existing `quote-targets` route
   over new route files. See [`VERCEL-HOBBY-DEPLOYMENT.md`](../source-of-truth/VERCEL-HOBBY-DEPLOYMENT.md).

---

## Phase order

Each phase stops for approval. Phases 1–4 are pure/offline and cost nothing to run.

**Phase 0 — Commit what exists.** The entire X system is untracked. No new work until it is in git.

**Phase 1 — Compare engine. ✅ BUILT** (`features/x-benchmark/`: `summarize.js`, `compare.js`, 31 tests).
Pure, no network, no cost. The real corpora are the regression fixtures, so the measured findings
(11.85 posts/day, 1.96 vs 1.31 per occupied hour, 73% multi-hour share, 60.8 self-quote avg likes, the
3.4× video-over-image lift inside one type) now fail a test if a refactor moves them. Three things the
build settled, which the rest of the phases inherit:

- **Lift, not likes.** Every comparison unit is a post class's performance relative to the *same*
  account's average, so a 66-median-view account and a 2,205-median-view account are comparable.
- **A share delta is not a recommendation.** Blind mix-matching scored 0.84× on the real pair — copying
  the benchmark's shape would have made the account *worse*, because it would have cut the account's
  best type (`original-showcase`, 1.61× own average, which the benchmark posts less of) and added a type
  the account executes badly (`original-text`, 0.16×). Gaps now carry a direction —
  increase / decrease / **hold** / **investigate** — and only the actionable two carry impact.
- **Two units, never mixed.** `perDay` (how much you publish) and `perPost` (what a post earns) are
  ranked separately; `shape` findings carry no modelled impact at all.

**Phase 2 — Client X profile. ✅ BUILT** (`profile.js`, normalized in the config save route).
Stored at `client_configs/{clientId}.marketingBriefConfig.xGrowth` rather than as a top-level key —
same contract, but under the one route that already normalizes, stale-form-guards and persists client
config. `mode` defaults to `approval`, never `auto`; an omitted field preserves what is stored; the
recommended tier is the next step above current output, not the benchmark's rate in one jump.

**Phase 3 — Parameterized ingest. ✅ BUILT** (`taxonomy.js`, `normalize-corpus.js`, `store.js`,
`scripts/x-content/ingest-corpus.mjs`). Corpora are stored in their own `x_corpora/{handle}` collection,
NOT in `x_monitor` as this plan first proposed — that one is keyed by immutable X user id and a corpus
arrives keyed by handle; mixing key types in one collection fails silently later. Stat blocks and the
derived watchlist are stored; raw rows are not.

**Constraint 3 is settled, negatively.** ScrapeCreators' `/v1/twitter/user-tweets` returns
`{success:true, tweets:[]}` for `@seb__design` — 1,549 followers, 782 posts in the window (probed
2026-09-12, 1 credit). It cannot serve timelines for accounts this size at all, historical or fresh.
Hosted ingest is not available at any price short of the spend-gated X API.

⚠️ **Must ship a shared topic taxonomy.** The two existing corpora were tagged by two *different*
hand-written taggers and share **1 topic label out of 28**, which made every benchmark topic read as
"0% of your output" — a property of the tagger, not a finding. Phase 1 suppresses topic gaps below 30%
vocabulary overlap and warns; that is a guard, not a fix. Per-client ingest must tag both the client's
corpus and its benchmarks' from one vocabulary, or topic comparison stays permanently disabled and the
strongest signal in the benchmark data (its top veins) never reaches the client.

**Phase 4 — Derived watchlist + generated calendar. ✅ BUILT** (`derive-watchlist.js`,
`build-calendar.js`, `refresh-analysis` action). Run against the corpus the original list was read off
by hand, `deriveWatchlist` returns **31 accounts covering 80.08%**, 30 of them on the hand-written list —
evidence the cut was a rule, not taste. The static JSON import is **kept as a fallback** rather than
deleted: `@bai_ee` keeps working unchanged, and a client with no ingested corpus sees a plan instead of
an empty card. `calendarSource` in the GET says which one is in play.

**Phase 5 — Multi-client daily loop + UI. ✅ BUILT** (`features/x-quote-targets/scan-plan.js`,
`scripts/x-content/scan-all-clients.mjs`, `XCalendarCard` gap panel + day-plan slot view).
The sweep budget is **shared across clients**, not per client: rate limit is the scarce resource (a
39-account sweep returned 429 on 32), so each unique account is fetched once, ranked by value summed
across every client that wants it, and the pool is split back out afterwards. A client starved by the
cap is named rather than silently handed an empty scan. Enrollment is `xGrowth.enabled`; mode mirrors
Social Auto-Publish.

**Still open in Phase 5:** the compose path does not yet pull Client Brain voice into generated slot
copy — the guard and the scorer run on drafts, the voice string does not. `resolveXGrowthProfile`
accepts the Brain's lanes already, so this is a wiring step, not a design question.

**Phase 6 — Not now, and two of the three are hard-blocked.** Auto-posting cadence is blocked on the
Hobby once-daily cron. Hosted ingest is blocked outright: `bird` needs browser cookies and
ScrapeCreators returns nothing for accounts this size, so per-client corpus ingest is an operator-run
local step until someone pays for the X API. Self-serve benchmark discovery remains a design question,
not a blocked one.

---

## Risks

- **Benchmark quality is the whole product.** A badly chosen benchmark account produces a confidently
  wrong calendar. Owner confirmation of `benchmarkHandles` should stay mandatory in v1.
- **Lane vocabulary is per-client.** The guard's `LANE_SIGNALS` is Bryan's vocabulary; a second client
  needs their own, or the guard silently classifies everything `unknown`.
- **Corpus staleness.** A gap report computed once and never refreshed will drift; ingest cadence needs
  to be explicit, and the report should carry its own `computedAt`.
- **Spend.** Nothing above needs the paid X API. Any phase that reaches for it is a scope change and
  goes through the [X API spend gate](../source-of-truth/X-API-AND-PROFILE-OPERATIONS.md) first.

---

## Recommended next step

Phase 0, then Phase 1. Phase 1 is pure, free to run, testable against data already on disk, and is
itself the "A/B against successful accounts" capability — it does not depend on any of the
client-scoping work landing first.
