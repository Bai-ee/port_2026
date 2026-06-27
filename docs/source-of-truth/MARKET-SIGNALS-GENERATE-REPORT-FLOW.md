# Market Signals — Generate Report flow (as-built)

**Status:** active canonical. Read this before touching the Market Signals card's run buttons, the unified terminal, the Client Brain → search bridge, the REPORT tab render, or the watchlist mentions path.

**Companion docs:** [`MARKET-SIGNALS-AND-SCOUT-PROJECTION.md`](./MARKET-SIGNALS-AND-SCOUT-PROJECTION.md) (the scout engine + projection + card control surface) · [`../company-brain/IMPLEMENTATION_PLAN.md`](../company-brain/IMPLEMENTATION_PLAN.md) (Client Brain) · [`../plans/MARKET-SIGNALS-CONFIG-BOOTSTRAP-PLAN.md`](../plans/MARKET-SIGNALS-CONFIG-BOOTSTRAP-PLAN.md) (the bigger, still-unbuilt discover/validate bootstrap).

---

## 0. TL;DR — what this flow does

One button — **Generate Report** (Market Signals card → SOURCES tab) — runs the whole pipeline in **one streamed terminal** and reveals an updated REPORT:

```
merge Client Brain terms → save config → fresh Scout search → watchlist pull (posts+mentions)
  → analysis skills → REPORT tab (auto-revealed when the terminal closes)
```

A secondary **Update report only (no new search)** button does the same minus the fresh search — it re-runs the skills over the already-stored signals (~50s) and is the fast/recovery path.

Both share one terminal controller and stream **per-item** detail (each found signal / handle / skill result) as each phase settles ✓.

---

## 1. The two entry points (DashboardPage.jsx)

| Fn | Trigger | Does |
|---|---|---|
| `generateReport` | `#signals-generate-report-btn` ("Generate Report") | merge brain terms → save → **fresh Scout** (`scope=marketing-director`) → watchlist pull → skills → REPORT |
| `updateReportFromSignals` | `#signals-update-report-btn` ("Update report only") | **no new search** — read stored signals → watchlist pull (if a watchlist skill is on) → skills → REPORT |

Both:
- Set `setIntakeModalDismissed(true)` so the **adhoc terminal owns the screen** (the separate intake modal is suppressed for this flow — see §4).
- Drive the **single terminal** via the shared `term*` helpers (§3).
- End by `setModalTab('report')` **before** the terminal finishes, so the 4s auto-close reveals the updated REPORT underneath.
- Are gated on `marketingBriefRunning` / `recipeRun.loading`.

`generateReport` auto-merges the approved Client Brain's extracted terms into the four search fields (union, never clobbers manual terms) right before saving — so the brain steers the search with no separate "Apply" step. The merge fields: `brandKeywords`, `categoryTerms`, `kols`, `competitors`.

---

## 2. End-to-end data path (verified)

```
generateReport
  └─ saveMarketingBriefConfig({override: mergedConfig})         → client_configs/{id}.marketingBriefConfig
  └─ POST /api/dashboard/marketing-brief/run {scope:'marketing-director'}
        └─ runClientPipeline (runtime.js) → runXScout (FRESH search; only
           social-media-manager scope reuses the stored brief)
        └─ await completeRun(...)                                → dashboard_state/{id}.marketingBrief.scoutBrief.agentData
        (route is INLINE: it awaits the pipeline and only responds when done — a ~3 min request)
  └─ fetchDashboardBootstrap(user, impersonateId)               → reads fresh agentData for the terminal's per-item lines
  └─ POST /api/dashboard/watchlist-pull {detail}                → dashboard_state/{id}.marketingBrief.watchlistTimelines (posts + mentions)
  └─ POST /api/dashboard/recipe-run {recipeIds}                 → runs skills over stored agentData; returns results (writes nothing)
        └─ setRecipeRun({results})                              → REPORT tab renders these
```

**The REPORT tab is recipe-driven.** `renderSignalsBriefMock` renders `recipeRun.results` (+ `watchlistPull` + the Coverage strip). A fresh search alone does **not** update the REPORT — the analysis skills must run and land in `recipeRun.results`. `recipeRun.results` also hydrates from `localStorage` (`recipeReport:lastRun:{clientId}`) on load, so a stale report persists until a new recipe run completes.

---

## 3. The single terminal (shared helpers)

The whole UX uses the **adhoc terminal** (`adhocTerminal` state, the same overlay Video Remix / Mockup Studio use), driven by shared helpers so both flows behave identically.

- **Module-level formatters** (near `splitMarketingBriefTerms`, ~`DashboardPage.jsx:462`): `termArrCount(a)`, `termItemText(it)`, `termItemLines(arr, pfx, max)` — turn signal/result objects into short terminal detail lines.
- **Component-level controller** (just after `settleActiveLine`, ~`:3037`):
  - `termStart(title, host, firstPfx, firstText)` — open the terminal with the first active line.
  - `termPhaseOpen(pfx, text)` — append a new active line (cursor).
  - `termPhaseClose(detail[])` — settle the active line ✓ and append that phase's per-item detail lines.
  - `termFinish(text, ok=true)` — settle + push final line + set `status:'done'|'error'`.
- **Auto-close:** a `useEffect` closes the adhoc terminal 4s after `status === 'done'` (search for `adhocTerminal?.status !== 'done'`). That reveal is why we switch to the REPORT tab before finishing.

Phase prefixes used: `[SAVE]` · `[SEARCH]` · `[SIGNALS]` (update-only) · `[X]` · `[ANALYZE]`, with `· web` / `· comp` / `· rdt` / `· x` / `· ✓` detail lines.

**Granularity note:** the Scout (`runXScout`) emits **no per-item progress** mid-search — it only emits one coarse stage label. So the per-item lines are appended **after each phase completes** (read from the fresh `agentData` / pull response / recipe results), not streamed live during the search. Live per-search-item streaming would require adding `emitProgress` calls inside `runXScout` (not done).

---

## 4. Terminal z-index gotcha (was the "terminal not displaying" bug)

The run terminal overlay `#intake-modal-overlay` defaults to **z-index 200**; the tile/card detail modal (Market Signals card) is **z-index 900**. A run launched from inside the card modal therefore rendered its terminal **behind** the card. Fix (in the overlay's inline style):

```jsx
style={(adhocTerminal?.open || activeTileModal) ? { zIndex: 1000 } : undefined}
```

i.e. lift the overlay above the card modal whenever a card modal is open (or an adhoc terminal is up). Keep this if you touch the overlay.

---

## 5. Client Brain → search-config bridge

The approved Client Brain extracts `brandKeywords / categoryTerms / kols / competitors`. Path:
- `features/client-brain/store.cjs` → `buildMarketingBriefDecisionPatch` writes these into the brain doc's `cardDefaults.fields`; `loadClientBrainCardDefaults(clientId, {cardId:'marketing-brief'})` exposes them — **approved-gated** (`requireApproved` default true).
- `app/api/dashboard/marketing-brief/config/route.js` **GET** folds them into the returned config (`mergeClientBrainDefaults`, fill-empty only, tagged `clientBrainDefaults.status:'suggested'`) and returns `{ clientBrainDefaults: { fields, appliedFields } }`.
- `DashboardPage.jsx` captures `clientBrainDefaults` state (in the config-load effect) and renders the read-only **`#signals-client-brain-suggested-section`** ("From your Client Brain") in SOURCES — the terms that `generateReport` auto-merges.

⚠️ The brain save (`store.cjs`) does **not** write `marketingBriefConfig` directly — terms reach the persisted config only when a config save runs (which `generateReport` does via the merged override). The fuller auto-research bootstrap (discover/validate handles + competitors) is still **unbuilt** — see the bootstrap plan.

---

## 6. Watchlist mentions (dev-only) — the fix

`features/scout-intake/watchlist-pull.js`:
- `fetchTimelinesViaXApi` (production X timeline reader) **cannot fetch mentions** — only own posts.
- `fetchHandleTimeline` (local **last30days** subprocess) fetches **both** own posts (`from:<handle>`) and mentions (plain `<handle>` search).
- **Routing (as-built):** when `detail.mentions` is requested **and** `localLast30DaysAllowed()` (dev / `ALLOW_LOCAL_LAST30DAYS`), `runWatchlistPull` uses last30days directly; otherwise it uses the X API and only falls back to last30days if the API returns zero posts. So **mentions only populate in dev/local.** In production they're absent (with a note) until X search access is wired.

Persisted to `dashboard_state/{id}.marketingBrief.watchlistTimelines.handles[]` (`ownPosts`, `mentions`). The watchlist/reply skills read this; the reports' "Happening on X" + "Talked about" come from it. Re-pulled on each Generate/Update run when a watchlist skill is enabled, so handles stay in sync with the configured `kols` (fixes stale-handle reports).

---

## 7. Analysis skills (recipes)

- Cap: `MAX_RECIPES_PER_RUN = 3` in `app/api/dashboard/recipe-run/route.js` (normalized from the earlier 4/run planning note so the default trio `customer-research` + `watchlist-analysis` + `reply-targets` run in one pass without opening the run wider than needed). Each recipe ≈ one Sonnet call (~$0.05, ~50s) — a 3-skill pass ≈ $0.15 / ~2 min.
- `WATCHLIST_RECIPE_IDS = ['watchlist-analysis','reply-targets']` (`DashboardPage.jsx` module const) — when one is enabled, the flows re-pull the watchlist first.
- Recipe prompts are embedded in `features/intelligence/analysis-recipes/recipes.js` for Vercel runtime safety. The `.md` files remain editable source, but production execution must not depend on reading those files from the serverless filesystem.
- See `MARKET-SIGNALS-AND-SCOUT-PROJECTION.md` §8 for the recipe registry and how to add a skill.

---

## 8. Coverage strip (REPORT transparency)

`renderSignalsBriefMock` renders **`#signals-coverage-strip`** at the top of the REPORT — counts of what each parameter returned this run (Web trends · Content ops · Competitors · Brand mentions · Reddit · KOL posts · Watchlist posts · Mentions · Skills run), read from `bootstrap.dashboardState.marketingBrief.scoutBrief.agentData` + `watchlistPull`. A **0 = source ran but found nothing** (e.g. no public brand mentions, Reddit query needs tuning), not skipped.

---

## 9. Client Brain card UI fixes (separate, same session)

The Client Brain card was simplified from five legacy tabs into four working tabs:
- `BRAIN SOURCE` — runtime upload/paste editor for `CLIENT_BRAIN.md`.
- `APPROVED BRAIN` — compiled decisions and the transitional voice editor.
- `SOURCES & GAPS` — source refs, generation/discovery state, completion, missing decisions, and acquisition metadata.
- `CONSUMERS` — context-pack preview/export and downstream consumer status.

Tone belongs in `CLIENT_BRAIN.md` under `Content Intelligence` -> `Voice`. Supporting examples belong in `CONTENT_LIBRARY.md` or `CONVERSATION_INTELLIGENCE.md`; the dashboard voice editor is transitional until edits compile back through Markdown.

The Client Brain card modal also had content-collision + a hidden-content bug:
- **Collision:** `.client-brain-card` was `display:flex; height:100%` in the scroll panel — flex children shrank below content height and `overflow:visible` spilled them onto the next section. Fixed in the `dashboardCss` template literal: `min-height:100%` (not `height`) + `.client-brain-card > * { flex: 0 0 auto }`. (Card CSS lives ONLY in the `dashboardCss` const in `DashboardPage.jsx`, not the unimported `dashboard.css` mirror.)

---

## 10. ⚠️ Gotchas for the next agent

- **NEVER edit `DashboardPage.jsx` while a run is in flight.** Saving triggers Next Fast Refresh, which resets component state (`recipeRun`, `adhocTerminal`) mid-run — the run completes server-side but the REPORT never renders client-side. Wait for the run to finish, then edit.
- **REPORT staleness ≠ broken search.** If the report didn't update, first check whether the skills (recipe-run) completed — the search persisting fresh `scoutBrief` is necessary but not sufficient. Use the read-only Firestore diagnostic pattern below.
- **`scope=marketing-director` = fresh Scout** (only `social-media-manager` reuses the stored brief). The run route is **inline** (~3 min); the report-render is decoupled so it runs over the persisted `agentData` regardless of the long request's client-side fate.
- **Mentions are dev-only** (last30days). Don't expect them in production.
- **Coverage 0** is informational, not an error.

### Read-only Firestore diagnostic (no cost, no writes)
To confirm what actually landed for a client, read `dashboard_state/{clientId}`:
- `marketingBrief.scoutBrief.timestamp` + `agentData` field counts → did a fresh search persist?
- `clients/{clientId}/brief_runs` (ordered by createdAt) → latest run status/scope/completedAt.
- `client_configs/{clientId}.marketingBriefConfig.analysisRecipes` → are skills enabled?

Bootstrap env via `require('features/not-the-rug-brief/load-env')` then `require('api/_lib/firebase-admin.cjs').adminDb`. (Example client used in dev: `bryan-balli-WUoltG84`.)

---

## 11. Files touched (quick map)

| Concern | File / symbol |
|---|---|
| One-button flow + single terminal | `DashboardPage.jsx` `generateReport`, `updateReportFromSignals`, `termStart/termPhaseOpen/termPhaseClose/termFinish`, `termItemLines` |
| Brain terms in SOURCES | `DashboardPage.jsx` `clientBrainDefaults` state, `#signals-client-brain-suggested-section` |
| Coverage strip | `DashboardPage.jsx` `renderSignalsBriefMock` → `#signals-coverage-strip` |
| Terminal z-index | `DashboardPage.jsx` `#intake-modal-overlay` inline style |
| Client Brain card tabs | `components/dashboard/ClientBrainCard.jsx` tab bar: `BRAIN SOURCE`, `APPROVED BRAIN`, `SOURCES & GAPS`, `CONSUMERS` |
| Card UI collision | `DashboardPage.jsx` `dashboardCss` `.client-brain-card` rules |
| Config save w/ override | `DashboardPage.jsx` `runMarketingBrief(scope, {configOverride})`, `saveMarketingBriefConfig({override})` |
| Vercel scratch data dir | `features/not-the-rug-brief/store.cjs` uses `/tmp/not-the-rug-brief` when `process.env.VERCEL` is set because the deployed filesystem is read-only |
| Skill cap | `app/api/dashboard/recipe-run/route.js` `MAX_RECIPES_PER_RUN = 3` |
| Mentions routing | `features/scout-intake/watchlist-pull.js` `runWatchlistPull` |
| Brain → config defaults | `app/api/dashboard/marketing-brief/config/route.js` GET `mergeClientBrainDefaults`; `features/client-brain/store.cjs` `buildMarketingBriefDecisionPatch` / `loadClientBrainCardDefaults` |

---

## 12. Known-open / next candidates (not built)

- **Live per-item search streaming** — add `emitProgress` inside `runXScout` so the `[SEARCH]` phase streams each search row/result instead of one active line (§3).
- **Production mentions** — wire X search access so mentions work outside dev (§6).
- **Config bootstrap** — the discover/validate/recommender flow that auto-fills category/competitors/handles (see the bootstrap plan); the current bridge only surfaces what the brain already extracted.
- **Async run option** — the run route is inline (~3 min). A dispatch+poll variant would free the request, but the current decoupling already keeps the report from being stranded.
