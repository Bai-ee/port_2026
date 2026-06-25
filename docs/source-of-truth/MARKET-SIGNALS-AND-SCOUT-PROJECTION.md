# Market Signals control panel + Scout brief projection

**Status:** active canonical. Read this before touching the Market Signals card, the scout-test sources, the daily-digest email, the executive brief renderer, or the scout search config.

This documents one connected system:
1. **One scout engine** produces market signals.
2. **One canonical projection** normalizes them for every consumer (email, executive brief).
3. The **Market Signals card** is an admin control panel to configure, run, and preview those signals per source.

---

## 1. The scout engine (one producer)

`runXScout` (`features/not-the-rug-brief/xscout.js`) is the only thing that fetches market signals. It runs a **search plan** (BRAND / CATEGORY / WATCHLIST / per-platform `site:x.com` rows, etc.) compiled by `features/not-the-rug-brief/config-loader.js` (`buildSearchPlan`, `buildKolSearches`, `buildPerPlatformSearchRows`, `PLATFORM_SITE_QUERIES`), then synthesizes results into `agentData` (`kolActivity`, `brandMentions`, `competitorIntel`, `categoryTrends`, `redditSignals`, `viralOpportunities`).

`runClientPipeline` (`features/not-the-rug-brief/runtime.js`) wraps it. The `scope` param controls how much runs:
- `null` / `'full'` → Scout → strategy → scribe (the full Executive Brief).
- `'marketing-director'` → **Scout only** (signals, no strategy/post/scribe). This is the cheap "just refresh signals" run.
- `'social-media-manager'` → strategy + scribe, reusing the stored scout brief.

Persisted to Firebase `dashboard_state/{clientId}.marketingBrief.scoutBrief` (full uncapped `agentData`). The local-FS `saveLatestBrief` in `store.cjs` is ephemeral on Vercel — **the durable copy is `dashboard_state`.**

### X / Twitter retrieval — two channels, no scraper
- **web_search row** (default): `site:x.com OR site:twitter.com <subject>` via Claude `web_search`. Index-dependent; **not** the X API; no read credentials. Works in production.
- **last30days** (local/dev only): shells out to the Python skill; reaches X via `xRelated` handles. See §6.
- The `twitter-api-v2` client (`features/social-posting/twitter-service.js`) is **write-only (posting)** — not used for retrieval.

Visual map of how cards shape the X search: [`../dashboard-ui/x-search-wiring.html`](../dashboard-ui/x-search-wiring.html).

---

## 1b. Pipeline order — when Scout · Scribe · Guard run (cost map)

Entry point: `runClientPipeline` (`features/not-the-rug-brief/runtime.js`), triggered by the worker or the dashboard "Run Briefs" cards. Three distinct modules, run in order:

```
runClientPipeline
 ├─ Scout    (runXScout)            ← ALWAYS on a fresh run. Search (Sonnet+web_search)
 │                                    → trim (Haiku) → synth (Sonnet). ~$0.10.
 │                                    Produces agentData → dashboard_state.scoutBrief.
 ├─ News     (news-monitor, GDELT)  ← free; augments brandMentions
 ├─ [scope='marketing-director']    → RETURNS HERE. Scribe + Guardian never run.
 ├─ Strategy roller                 ← full/exec scope only (LLM)
 ├─ Scribe   (runScribe)            ← full/exec scope only. Composes today's post + exec brief.
 └─ Guardian (inside runScribe)     ← full/exec scope only. QAs Scribe's composed output.
```

**Scope gating** (the `scope` param):

| scope | Scout | Strategy | Scribe | Guardian |
|---|---|---|---|---|
| `null` / `'full'` | ✅ | ✅ | ✅ | ✅ |
| `'marketing-director'` (signals refresh) | ✅ | — | — | — |
| `'social-media-manager'` | reuses stored `scoutBrief` (no Scout cost) | ✅ | ✅ | ✅ |

**Cost facts — read before any "make the card/brief cheaper" work:**
- The **marketing-signals content is Scout-only.** Scribe/Guardian are *never* applied to the signals on their own — Guardian QAs the *composed* executive brief, not the raw signals. A signals refresh = `scope='marketing-director'` = one Scout run (~$0.10).
- **`projectBrief` is pure JavaScript — zero LLM.** The Market Signals card, email digest, and executive brief all *render* the stored `scoutBrief` through `projectBrief`. Rendering never re-analyzes. "No additional analysis after Scout" is already true at render time.
- The expensive reasoning is the **Scout synthesis** (Stage 3 Sonnet) plus **Scribe + Guardian** in the full/exec scope. Avoid any design that runs these per-source — that multiplies the costly stages and loses cross-source synthesis.

---

## 2. The canonical projection — **DO NOT re-read `agentData` in a consumer**

`projectBrief(marketingBrief, state)` in **`features/intelligence/_brief-intel.js`** is the single normalized view of `scoutBrief`. It is a **superset** of every signal (no caps — admin surface). Every consumer reads it:
- **Email digest** (`app/api/admin/daily-digest/route.js`) via `getBriefIntelligence` (a thin Firebase-reading wrapper around `projectBrief`) + `briefIntelToText`.
- **Executive brief** (`renderMarketingBriefHtml` in `app/api/dashboard/brief-preview/route.js`) calls `projectBrief(marketingBrief)` for its signal arrays.

**Rule for agents:** when a new `agentData` field needs to surface anywhere, **extend `projectBrief`** — never re-read `agentData` directly in a consumer. The two surfaces previously hand-mirrored each other and drifted (different fields survived in each); the projection exists to prevent that. `renderMarketingBriefHtml` field refs accept the projection's normalized names with the raw names as fallback (e.g. `item.detail || item.content`).

---

## 3. The executive brief = a composition; "Market Brief" = its signals subset

Brief sections + compositions live in **`features/scout-intake/brief-sections.cjs`** (`BRIEF_SECTIONS`, `BRIEF_COMPOSITIONS`, `EXECUTIVE_SECTIONS`). `renderMarketingBriefHtml` renders any composition in the same editorial design; the active one is chosen by `briefType` (`BRIEF_TYPE_BY_CARD`, `resolveBriefType`).

- `executive-daily` = the full roll-up (includes the signal sections).
- `marketing-director` (label **"Market Brief"**) = **only** the scout-signal pages (`scout-found, market-signals, local-signals, viral-windows, watchlist, competitor-snapshot, local-weather`).

So the same signal pages render standalone (Market Brief) and embedded (Executive Brief). The **Run Briefs bucket** already has a `brief-marketing` card that runs `scope=marketing-director` and previews this composition.

---

## 4. The Market Signals card (admin control panel)

Card `id: 'signals'` in `DashboardPage.jsx` (category `growth`). Its modal (admin-only — the generic tile modal returns early for non-admins) is a **Brief Inputs control panel**, split into tabs:

- **SOURCES** (`renderSignalsControlPanel`) — the default tab:
  - Per-source live **Run** (web / x / reddit) + **Run all enabled**, reusing the scout-test engine (§5). Lightweight: does **not** refresh the stored brief.
  - **Inputs · customize** — granular per-item control via the shared **`renderTermControl`** helper for `kols` (Watchlist), `brandKeywords`, `categoryTerms`: lists each item with **ON/OFF** + **× remove** + **+ Add** (deep-links to the owning card via `openCapabilityCard`).
  - Value inputs get inline controls: **Research Focus** = freshness `−/+` stepper (1–30d); **Local Weather** = ZIP field + ON/OFF toggle.
- **IN BRIEF** (`renderSignalsBriefMock`) — renders the **last run's** scout-test results in the executive-brief editorial style (quote wall for X, Market Signals rows for web, Community block for Reddit). This is a **design preview** to iterate the look; the real brief is server-rendered by `renderMarketingBriefHtml` — port approved changes there.
- **REPORT / SOLUTIONS / PROBLEMS / DATA** — the shared analyzer tabs (untouched).

Tabs are declared in the shared tab array in `renderMarketingBriefHtml`'s consumer block in `DashboardPage.jsx` (`{ key: 'sources' }`, `{ key: 'inbrief' }` are added only for `cardId === 'signals'`). Default tab on open is set in the modal-open switch (`if (id === 'signals') setModalTab('sources')`).

### Key patterns to follow
- **Granular on/off without a pipeline change — the "park field" pattern.** Toggling an item OFF moves it from its active list (`kols`) to a parked list (`kolsOff` / `brandKeywordsOff` / `categoryTermsOff`). **The scout pipeline only ever reads the active field**, so parked items are excluded from the run but not deleted. Park fields are persisted in the save normalizer (`saveMarketingBriefConfig` in `DashboardPage.jsx`, alongside `kols`/`brandKeywords`). To add granular control to a new list field, reuse `renderTermControl({ field, offField, title, addCard })` and add `<field>Off` to the save normalizer.
- **Config strings, not arrays.** `kols`, `brandKeywords`, `categoryTerms` are stored as newline/comma **strings**. Always count/parse with `splitMarketingBriefTerms(value)` and join with `joinConfigList(value)` — never `.length` on the raw value (that returns the character count).
- **Last-run retention.** Scout-test results (`scoutTestState`) are persisted to `localStorage` keyed `scoutTest:lastRun:<clientId>` (hydrate + persist effects near the `scoutTestState` declaration) so the IN BRIEF preview survives modal-close / reload. Client-side only.
- **Persistence timing caveat.** Toggles/edits in the panel update React state immediately but persist on the next config save / brief run (`runMarketingBrief` saves first). Per-source **Run** (scout-test) reads the **server-saved** config — unsaved toggles don't affect a test until saved.

---

## 5. Per-source live test (scout-test)

`POST /api/dashboard/scout-test` `{ platform: 'web'|'x'|'reddit' }` → `{ items:[{title,url,summary,tag}], count, costUsd, ms, meta }`. Implementation: `features/scout-intake/scout-test.js` (`runScoutTest`). This returns **raw per-source results**, distinct from the synthesized `agentData`. The dashboard calls it via `runScoutTestForPlatform` and renders rows with `renderSourcePlatformRow`. Reuse this engine for any "confirm what a source returns" UI.

**⚠️ Known divergence — scout-test ≠ brief ingest, per source:**
- `reddit` → `runRedditSerpSearch` — **matches** the brief (`fetchRedditForBrief` uses the same fetcher).
- `web` → Claude `web_search` over the **non-`site:` plan rows only** (it filters out the per-platform `site:` rows). The brief's Stage-1 runs *all* rows together, so the web test is a partial slice.
- `x` → **last30days subprocess only** (dev/local). The brief's primary production X channel is the `site:x.com OR site:twitter.com` web_search row (§1) *plus* last30days. So **the "Run X" test fails in production** (no Python on Vercel) even though the brief's X retrieval works there.
- `instagram`/`youtube`/`tiktok`/`hackernews` → **no test button**, though the brief runs their `site:` rows in Stage 1.

This is the gap the §7 proposal addresses. Until then, treat scout-test as a *raw probe*, not a faithful preview of what the brief ingests/synthesizes per source.

---

## 6. last30days (X / dev only) — env

`features/not-the-rug-brief/services/last30days.js` shells out to the Python skill. It is **local/dev only** (no Python on Vercel). Path resolution:
- `LAST30DAYS_SKILL_ROOT` → skill install root (default `~/.claude/skills/last30days-skill-main`).
- `LAST30DAYS_HOME` → overrides the subprocess `HOME` so `~/.config/last30days/.env` (API keys) resolves even when the dev server runs under a sandbox `HOME`.

Set both in `.env.local` when the dev server runs under a non-user `HOME` (symptom: "last30days script not found at /home/sbx_user…/…"). Credentials live at `~/.config/last30days/.env` (chmod 600).

---

## 7. Two-tier analysis model — **NOT yet built** (decided direction)

> Status: agreed design, not implemented. Do **not** treat as shipped. Build behind the phased plan below.

**Goal:** select "analysis cards" sort their own content **once** (card tier), and the executive brief **composes across** those finished sections **without re-analyzing raw data** (exec tier). Pay the expensive raw→signal distillation once per card; pay only a cheap compose at the exec level.

**Already-existing skeleton:** `runtime.js` §1c folds per-module mini-briefs (`moduleBriefs` → `buildWebsiteAuditPromptBlock` → exec Scribe). The two-tier pattern exists for website-audit modules — this generalizes it to analysis cards.

**Tier 1 — card level (analysis cards only).** Each writes a standardized **section brief** (headline · grounded findings · priority · source URLs):
- Scout = gather raw/external data (Marketing Insights already has this = `runXScout`).
- Scribe = write *that card's* section, tight + grounded.
- Guardian = QA *that section* (grounding, URL validity).
- Stored. This is the "sorted once" point.

**Tier 2 — executive brief level (compose, do NOT re-deep-analyze).** A separate Scribe/Guardian pass over the **array of finished section briefs**:
- Scribe = editor-in-chief: weave the cross-card narrative, resolve priority.
- Guardian = cross-section consistency/claim QA — **never** re-grounds each card's raw sources (the card already Guarded that).

**The rule that prevents double-cost:** the exec pass trusts card-level Guards and operates on pre-distilled text only. Its input is N short sections, not N raw datasets → cheap. Never re-open raw search results at the exec level.

```
Card tier (per analysis card):  raw → Scout → Scribe → Guardian → stored section brief
        ↓ (array of finished section briefs)
Exec tier (once):               sections → Scribe (compose) → Guardian (cross-check) → exec brief
        ↓
Render = projectBrief (free, no LLM)
```

**Why it isn't double the cost:** the card tier pays raw→signal once (Insights ≈ today's ~$0.10 Scout + a small section Scribe/Guard). The exec tier composes a handful of distilled sections — short prompt, cheaper per token than today's exec Scribe wading through raw-ish Scout output.

**Rollout decision (agreed): Marketing Insights first.** Only the `signals` card gets card-level Scribe/Guardian initially (today it is Scout-only — see §1b). All other cards stay as plain contributors. Validate the pattern, then extend card-by-card (candidates: Competitor, Reviews).

**Triggers:**
- Card Scout·Scribe·Guardian → when that card is run/refreshed (manual Run or scheduled). Produces + stores its section brief.
- Exec Scribe·Guardian → when the Executive Brief is generated. Reads stored section briefs (no re-fetch); refresh a single stale card first if needed, then compose.

**Open question to resolve before Tier 2 build:** the exact section-brief contract (field shape) so any analysis card and the exec composer share one schema — generalize `moduleBriefs` rather than fork it.

**Scout-only cost levers (independent, still valid):** skip supplemental fetches (weather/reviews/IG) in a signals-only scope; cap search rows/`max_uses` to enabled platforms; drop/shrink the Stage-3 retry; cheaper synthesis model when scope = signals-only.

---

## Quick map (files)

| Concern | File / symbol |
|---|---|
| Scout engine | `features/not-the-rug-brief/xscout.js` `runXScout` (search→trim→synth) |
| Scribe + Guardian | `features/not-the-rug-brief/scribe.js` `runScribe` (Guardian QA runs inside it) |
| Search plan from cards | `features/not-the-rug-brief/config-loader.js` |
| Pipeline + scopes (when Scout/Scribe/Guard run) | `features/not-the-rug-brief/runtime.js` `runClientPipeline` |
| **Canonical projection** | `features/intelligence/_brief-intel.js` `projectBrief` |
| Brief sections/compositions | `features/scout-intake/brief-sections.cjs` |
| Real brief renderer | `app/api/dashboard/brief-preview/route.js` `renderMarketingBriefHtml` |
| Market Signals panel + tabs | `DashboardPage.jsx` `renderSignalsControlPanel`, `renderTermControl`, `renderSignalsBriefMock` |
| Per-source test | `app/api/dashboard/scout-test/route.js` · `features/scout-intake/scout-test.js` |
| last30days (X, dev) | `features/not-the-rug-brief/services/last30days.js` |
| Visual explainer | `docs/dashboard-ui/x-search-wiring.html` |
