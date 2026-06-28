# Market Signals control panel + Scout brief projection

**Status:** active canonical. Read this before touching the Market Signals card, the scout-test sources, the daily-digest email, the executive brief renderer, or the scout search config.

> **The one-button run UX** (Generate Report / Update report only, the single streamed terminal, the Client Brain → search bridge, the REPORT Coverage strip, watchlist mentions routing, skill cap) is documented as-built in [`MARKET-SIGNALS-GENERATE-REPORT-FLOW.md`](./MARKET-SIGNALS-GENERATE-REPORT-FLOW.md). Read it before touching the card's run buttons or the REPORT render.

> **The Run Briefs / Executive Brief card wiring** (Daily Stand Up renamed to Executive Brief, named brief preview cards, card footer run actions, removed duplicate Creative card) is documented in [`EXECUTIVE-BRIEFS-RUN-BRIEFS-WIRING.md`](./EXECUTIVE-BRIEFS-RUN-BRIEFS-WIRING.md). Read it before touching the Run Briefs bucket or `BRIEF_TYPE_BY_CARD`.

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

The current card-level wiring is captured in [`EXECUTIVE-BRIEFS-RUN-BRIEFS-WIRING.md`](./EXECUTIVE-BRIEFS-RUN-BRIEFS-WIRING.md): `marketing-brief` is the Executive Brief card, `brief-marketing` is the standalone Market Brief, `brief-strategy` is the Strategy Brief, `onboarding-brief` is the Creative Brief, and `brief-performance` is the Website Developer Brief.

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
- **Styling lives in a JS template literal, NOT a `.css` file.** Dashboard CSS renders from the `dashboardCss` const in `DashboardPage.jsx` (injected via `<style>{dashboardCss}</style>`); the `dashboard.css` file is an **unimported mirror**. The Market Signals panels use a scoped `.signals-sg` block (ported from `public/docs/dashboard-modal-component-style-guide.html`) — to restyle, edit the block **inside the `dashboardCss` const** (and keep `dashboard.css` in sync as the readable mirror). Editing the file alone does nothing at runtime.

---

## 5. Per-source live test (scout-test)

`POST /api/dashboard/scout-test` `{ platform: 'web'|'x'|'reddit' }` → `{ items:[{title,url,summary,tag}], count, costUsd, ms, meta }`. Implementation: `features/scout-intake/scout-test.js` (`runScoutTest`). This returns **raw per-source results**, distinct from the synthesized `agentData`. The dashboard calls it via `runScoutTestForPlatform` and renders rows with `renderSourcePlatformRow`. Reuse this engine for any "confirm what a source returns" UI.

**⚠️ Known divergence — scout-test ≠ brief ingest, per source:**
- `reddit` → `runRedditSerpSearch` — **matches** the brief (`fetchRedditForBrief` uses the same fetcher).
- `web` → Claude `web_search` over the **non-`site:` plan rows only** (it filters out the per-platform `site:` rows). The brief's Stage-1 runs *all* rows together, so the web test is a partial slice.
- `x` → **last30days subprocess only** (dev/local). The brief's primary production X channel is the `site:x.com OR site:twitter.com` web_search row (§1) *plus* last30days. So **the "Run X" test fails in production** (no Python on Vercel) even though the brief's X retrieval works there.
- `instagram`/`youtube`/`tiktok`/`hackernews` → **no test button**, though the brief runs their `site:` rows in Stage 1.

This is the gap the §7 proposal addresses. Until then, treat scout-test as a *raw probe*, not a faithful preview of what the brief ingests/synthesizes per source.

**Watchlist mentions (separate from scout-test):** the watchlist pull (`features/scout-intake/watchlist-pull.js`) fetches per-handle **own posts + mentions**. The production X timeline reader can't fetch mentions — only **last30days** can — so `runWatchlistPull` routes to last30days whenever `detail.mentions` is on and `localLast30DaysAllowed()` (dev). **Mentions therefore populate only in dev/local.** See [`MARKET-SIGNALS-GENERATE-REPORT-FLOW.md`](./MARKET-SIGNALS-GENERATE-REPORT-FLOW.md) §6.

---

## 6. last30days (X / dev only) — env

`features/not-the-rug-brief/services/last30days.js` shells out to the Python skill. It is **local/dev only** (no Python on Vercel). Path resolution:
- `LAST30DAYS_SKILL_ROOT` → skill install root (default `~/.claude/skills/last30days-skill-main`).
- `LAST30DAYS_HOME` → overrides the subprocess `HOME` so `~/.config/last30days/.env` (API keys) resolves even when the dev server runs under a sandbox `HOME`.

Set both in `.env.local` when the dev server runs under a non-user `HOME` (symptom: "last30days script not found at /home/sbx_user…/…"). Credentials live at `~/.config/last30days/.env` (chmod 600).

---

## 6b. Control surface — what's a knob vs buried (Scout · Scribe · Guardian)

**Plain-language visual:** [`../dashboard-ui/scout-scribe-guardian-control-surface.html`](../dashboard-ui/scout-scribe-guardian-control-surface.html). This is the steering map for the §7 Tier-1 work — the controls below *are* the dial layer.

Three layers drive behavior, at very different ease-of-edit:
1. **Card config** — Firestore `client_configs` → `marketingBriefConfig` + `scoutConfig`, read by `config-loader.js`. ✅ UI-editable.
2. **Knowledge files** — `features/not-the-rug-brief/knowledge/{clientId}/*.json` (`brand-voice.json`, `brief-context.json`, `glossary.json`, `game-knowledge-supplement.json`). ⚠️ hand-edit JSON on disk.
3. **Hardcoded** — prompt skeletons + constants in `xscout.js`, `scribe.js`, `guardian.js`, `config-loader.js`, `optimizer.js`. ❌ code change.

### SCOUT — mostly exposed already
- ✅ **Card config:** `searches[]`, `kols`/`kolSearchMode`, `brandKeywords`, `categoryTerms`, `competitors`, `sourcePlatforms`, `sourceFocus`, `scoutInstructions`, `freshnessDays`, `agentDataTemplate`, reddit queries, `last30days.*`.
- ❌ **Hardcoded:** `PLATFORM_SITE_QUERIES` host map (`config-loader.js:134-146`), default plan shape (`buildSearchPlan` defaultPlan `:273-291` + `xscout.js` `buildFallbackSearchPlan:389-417`), Stage-1 search prompt (`xscout.js buildSearchPrompt:468-513`), models (`optimizer.js MODELS`), `max_uses` + token caps (`xscout.js:913`, Stage-1 4000 / Stage-3 8000).

### SCRIBE — partly exposed, the rich part is file-based
- ✅ **Card config:** `scribeTone`, `scribeHardConstraints`, intelligence labels.
- ⚠️ **File:** `brand-voice.json` (`daily_brief_voice.role`, `sections_tone`, `voice_pillars`, `avoid`) + `brief-context.json` — the real voice + how data is framed lives here, not card-editable.
- ❌ **Hardcoded:** `buildScribePrompt` structure (`scribe.js:155`) = section order, output format, REASONING/RULES — i.e. "how it processes/presents."

### GUARDIAN — config + file knobs exist; the verdict is produced but not surfaced
- ✅ **Card config:** `guardian.restrictedPatterns`, `competitorNames`, `reviewerContext`.
- ⚠️ **File:** `glossary.json` (`restricted_terms`, per-term `guardian_note`), `brand-voice.json` (`voice_pillars`/`avoid`), `game-knowledge-supplement.json` (`guardian_rules`).
- ❌ **Hardcoded:** scoring weights (0.5/0.5), thresholds (≥70 publish, <70 review), severity logic, the Haiku QA prompt, models (`guardian.js:340-343`, `:198-244`).
- 📤 **The verdict already exists** — `{ readyToPublish, overallScore, factualScore, voiceScore, hardBlock, concerns[], flags[], reviewRequired }` (`guardian.js:351-366`) — it just isn't shown in the Market Signals UI. "Confirm what's getting through" = **surface this, no new logic**.

**Two facts:** `brand-voice.json` dials **both** Scribe and Guardian (one file, two stages). And ⚠️ **`runGuardian` reads `requireClientConfig` (static registry) + local knowledge files — NOT the Firestore runtime config** (`guardian.js:300, 49-56`), so a Firestore-provisioned client's Guardian card knobs may not flow. Fix before "dial per client" works.

**Worth promoting to a config block** (cost/quality dials you'll turn without a deploy): **models** and **`max_uses`/token caps**. Leave the host map + plan skeleton structural; steer the Stage-1 prompt via the existing `sourceFocus`/`scoutInstructions` slots rather than exposing the whole template.

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

## 8. Analysis recipes (marketing-skills) + source backlog — partial build

External marketing-skills libraries (e.g. `coreyhaines31/marketingskills`, MIT) are **playbook/analyzer skills** — `SKILL.md` (instructions) + `references/` (knowledge) + `evals/` (QA rubric). They are **analyzers, not data fetchers**: they reason over content WE supply. They sit at the **Scribe/analyzer altitude** and do **not** replace Scout. Their `product-marketing.md` context ≈ our `scoutConfig.positioningContext`; their `evals.json` ≈ Guardian criteria.

### Recipe registry (the integration model)
Our pipeline calls Anthropic directly — it does not "run" a Claude Code skill. So a skill is **imported as a swappable prompt recipe**:

```
Analysis Recipe = { id, prompt (adapted SKILL.md), references (knowledge), eval (→ Guardian) }
```

A recipe is a swappable analyzer behind the Scribe slot — the same swap-slot is the **A/B mechanism** (point a card's Tier-1 analyzer at a different `recipeId` to compare in production, the way `config.reddit.provider` swaps source fetchers). Drops onto §7: a card's Tier-1 Scribe can *be* a chosen recipe; the exec Tier-2 composer can be another.

**Built:**
| File | Role |
|---|---|
| `features/intelligence/analysis-recipes/recipes.js` | registry (`RECIPES`, `listRecipes`, `getRecipe`, `loadRecipePrompt`). `DEFAULT_MODEL` = Sonnet, `DEFAULT_MAX_TOKENS` = 4000 |
| `features/intelligence/analysis-recipes/run-recipe.js` | `runAnalysisRecipe({recipeId, content, context})` (one Anthropic call per recipe) + CLI harness |
| `features/intelligence/analysis-recipes/customer-research.md` | recipe — headless adaptation of the `customer-research` skill (synthesis-report shape: themes/JTBD/vocab/alternatives/contradictions/dataQuality) |
| `features/intelligence/analysis-recipes/watchlist-analysis.md` | recipe — internal handle-first X analysis (overview/per-handle/spotlight/priorityAction shape; powers the **Happening on X** block) |
| `features/intelligence/analysis-recipes/reply-targets.md` | recipe — engagement triage (adapted from `coreyhaines31/marketingskills` social/listening). **REPLY side** of post strategy: ranks posts worth replying to (`replyTargets[]` shape: author/source/score/tier/why/suggestedReply) with a drafted reply each. `contentKind: 'reply-pool'` — reads an assembled pool (watchlist mentions + brandMentions + redditSignals + kolActivity), NOT raw agentData. Renders via **`renderReplyTargetsBlock`** with a **Send to Post Me** button → `POST /api/social-posting {action:'create-reply-drafts'}` creates `status:'draft'` posts carrying `replyTo` context. ⚠️ Needs the Watchlist pulled with **Mentions** on — those raw timelines are now persisted to `marketingBrief.watchlistTimelines` by `watchlist-pull/route.js` (previously only the summary was saved). Threaded posting via X API = later infra; v1 = review-and-post drafts. |
| `app/api/dashboard/recipe-run/route.js` | `GET` = recipe catalog (`listRecipes`) · `POST {recipeIds}` = run enabled recipes over the stored `scoutBrief.agentData` (no pipeline run, writes nothing; **`MAX_RECIPES_PER_RUN` = 3** — the default trio runs in one pass) |
| `DashboardPage.jsx` | Market Signals SOURCES tab → **"04 · Analysis Skills"** section: per-skill ON/OFF toggle (auto-saves to `marketingBriefConfig.analysisRecipes`). The skills now run as the final phase of **Generate Report** / **Update report only** via the unified single terminal (`term*` helpers — see [`MARKET-SIGNALS-GENERATE-REPORT-FLOW.md`](./MARKET-SIGNALS-GENERATE-REPORT-FLOW.md)), not a standalone "Run enabled" button. On success auto-switches to the **REPORT** tab. Render is the `.brief-kit` editorial scope (ported from `public/docs/dashboard-modal-component-style-guide.html`, compacted for the modal): `renderSignalsBriefMock` orchestrates → live source signals ("Additional Signals") + per-recipe blocks. Synthesis-shaped recipes render via **`renderRecipeBriefBlock`** (Summary → Themes → JTBD → Vocabulary → Alternatives → Contradictions → What we still don't know); the watchlist recipe renders via **`renderWatchlistAnalysisBlock`** ("Happening on X": Overview → Suggested action → Per handle grid → Spotlight). Both parse `{json}+prose` via `parseRecipeAnalysis`. DOM: `#signals-analysis-skills-section`, `#recipe-toggle-<id>`, `#recipe-run-output`, `#recipe-brief-<id>`, `#signals-report-paper`, `#watchlist-analysis-block` |

`analysisRecipes` (array of enabled recipe ids) persists via the config route whitelist (`app/api/dashboard/marketing-brief/config/route.js`) + `hydrateMarketingBriefConfig` + `buildDefaultMarketingBriefConfig` (default `[]`).

**Prove on real data via CLI** (analyzer-side equivalent of scout-test): dump a client's `dashboard_state/{clientId}.marketingBrief.scoutBrief.agentData` to a file, then:
```
node features/intelligence/analysis-recipes/run-recipe.js --recipe customer-research --content ./scoutBrief.json
```
Returns a grounded, confidence-scored synthesis (themes + money quotes + JTBD + vocabulary). Validated run: ~$0.019, ~23s, quotes traced to supplied URLs (grounding held).

**Done:** card-level toggle + on-demand Run (admin steers which skills apply, sees output). **Still pending (separate, gated):** auto-running the enabled recipes inside the brief pipeline as §7 Tier-1 section briefs — that's the change that touches `runXScout`/`runScribe`, intentionally not done here.

**Related plan (config bootstrap):** auto-researching the *input* config (category · brand · competitors · 2 watchlist handles) from the crawl + a discovery fetch, so the first Scout run lands high-confidence signals — [`../plans/MARKET-SIGNALS-CONFIG-BOOTSTRAP-PLAN.md`](../plans/MARKET-SIGNALS-CONFIG-BOOTSTRAP-PLAN.md). Leverages the existing `ensureScoutConfig` (`features/scout-intake/scout-config-generator.js`) + a proposed `config-recommender` recipe.

### How to add a skill (recipe) into the flow
The card never hardcodes a skill list — the catalog is the registry, so adding a skill is a registry + (sometimes) a render change, nothing in the card's toggle UI.

1. **Drop the prompt asset.** Add `<id>.md` in `features/intelligence/analysis-recipes/` — YAML frontmatter (`id`, `label`, `source`, `mode: analyzer`, `inputs`, `output`) then the prompt body. The body must define a **strict output contract**: the raw JSON object first (no code fence), one blank line, then <200-word prose. Grounding rule is mandatory — every claim traces to a supplied item or is omitted.
2. **Register it.** Add an entry to `RECIPES` in `recipes.js` (`id`, `label`, `description`, `file`, `source`, `model`, `maxTokens`). It now auto-appears in the SOURCES "04 · Analysis Skills" toggle list (served by `GET /api/dashboard/recipe-run`).
3. **Decide the render.** If the recipe returns the **synthesis shape** (themes/JTBD/vocabulary/alternatives/contradictions/dataQuality), `renderRecipeBriefBlock` renders it automatically — no UI change. If it returns a **custom shape** (like `watchlist-analysis`'s handles/spotlight), add a dedicated render fn (pattern: `renderWatchlistAnalysisBlock`) and branch to it in `renderSignalsBriefMock`.
4. **Prove it on real data** with the CLI before wiring (see below). Then toggle ON in the card and **Run enabled**.

The swap-slot doubles as the **A/B mechanism**: two recipes can target the same content and be compared in the REPORT tab side by side.

**Better input → better synthesis** (what raises a recipe's confidence): recipes only analyze what Scout supplied, and confidence is `frequency × independent sources`, unprompted voice only. So the SOURCES knobs that improve output are `categoryTerms` (drives PAIN POINTS + vocabulary), `competitors` (fills Alternatives + Contradictions), `brandKeywords` (money quotes), watchlist handles (KOL voice), and custom `searches` (add unprompted-voice patterns: `"wish there was"`, `"switched from"`, `"anyone recommend"`). More **source diversity** (X + Reddit + reviews) promotes Low themes to High more than more queries on one platform. Read the recipe's **"What we still don't know"** (gaps) → each gap is the next search to add.

**Visual explainer:** [`docs/dashboard-ui/analysis-recipes-flow.html`](../dashboard-ui/analysis-recipes-flow.html) — the data pipeline (Scout agentData → recipe-run → REPORT render), how a skill is added, the output schema, and the reading/leverage guide.

### Default web-search source backlog (mined from the skills — candidates, NOT committed)
Each adds cost on every run, so promote deliberately. Maps to existing `agentData` fields:

| Source | Query pattern | Feeds |
|---|---|---|
| Review mining | `site:g2.com "<brand>"`, Capterra/Trustpilot (3★-first) | `reviewInsights`, `brandMentions`, `competitorIntel` |
| Competitor site monitoring | `site:<competitor> /pricing /changelog /customers` | `competitorIntel` |
| Switching-intent | `"<category>" "vs" OR "alternative" OR "switched"` | `viralOpportunities`, `categoryTrends` |
| Funding / press | `"<competitor>" funding OR raised OR acquires` | `competitorIntel`, `brandMentions` |
| ICP subreddit discovery | find subs by *problem*, then mine | reddit targeting |

**Tool-backed (separate from web_search — needs MCP):** competitor-profiling depends on **Firecrawl** (site scrape) + **DataForSEO** (backlinks/keywords/traffic). A DataForSEO skill + `claude-seo` agents already exist in the environment; wiring them is a distinct integration, not a `site:` row.

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
| Visual · X search wiring | `docs/dashboard-ui/x-search-wiring.html` |
| Visual · control surface (knob vs buried) | `docs/dashboard-ui/scout-scribe-guardian-control-surface.html` (§6b) |
| Knowledge files (voice/glossary) | `features/not-the-rug-brief/knowledge/{clientId}/*.json` |
| Analysis recipes (§8) | `features/intelligence/analysis-recipes/` (`recipes.js`, `run-recipe.js`, `customer-research.md`, `watchlist-analysis.md`) |
| Recipe run endpoint | `app/api/dashboard/recipe-run/route.js` (`GET` catalog · `POST` run over stored `scoutBrief.agentData`) |
| REPORT tab render | `DashboardPage.jsx` `renderSignalsBriefMock` → `renderRecipeBriefBlock` (synthesis) + `renderWatchlistAnalysisBlock` (Happening on X); `.brief-kit` scope at end of `dashboardCss` |
| Visual · analysis recipes flow | `docs/dashboard-ui/analysis-recipes-flow.html` (§8) |
