# Searchable Platforms (Market Signals) — Reddit reference + "add a platform" recipe

**Status:** canonical. Reddit is the reference implementation of a *searchable platform* in
Market Signals; **Instagram is the fully-worked second example** (rows 1–14 below — grep
`instagram` to see every edit). X and Web predate this pattern. Next candidates: `youtube`,
`tiktok`, `hackernews` (already valid last30days sources). Read before touching any
per-platform source test, analysis, or the digest's per-platform "Happening on …" sections.

Related: [`MARKET-SIGNALS-AND-SCOUT-PROJECTION.md`](./MARKET-SIGNALS-AND-SCOUT-PROJECTION.md),
[`EMAIL-DIGEST-CARD.md`](./EMAIL-DIGEST-CARD.md).

---

## What a "searchable platform" is

A platform the operator can (a) **Test** live from the Market Signals card (per-source RUN
button), and (b) get a **fresh "Happening on <platform>" analysis section** in the daily
email on every Generate & Send / cron.

**Engine (Reddit + Instagram) = the direct Node ScrapeCreators client**
`features/scout-intake/external-scouts/scrapecreators-client.js` (`searchReddit` /
`searchInstagram`) — plain HTTPS to `api.scrapecreators.com`, so it **runs natively on
Vercel** (dev == prod). Auth = `SCRAPECREATORS_API_KEY` (Vercel env; dev falls back to the
last30days skill's `~/.config/last30days/.env`). Both the source **Test** (`scout-test.js`)
and the **cron/Generate & Send** (`pre-digest-refresh` → `refreshPlatformSignals` →
`platformTests`) use this client, so test == real run == prod.

⚠️ **`last30days` (Python subprocess) is the LEGACY path — local-only, do not add new platforms to it.** It still backs the full Executive-Brief scout aggregation (X-via-Bird, YouTube, TikTok, HN) and X uses the X API directly; but Reddit/Instagram no longer depend on it. When adding a platform ScrapeCreators supports, extend `scrapecreators-client.js`, not `last30days.js`.

## End-to-end data flow (Reddit)

```
Market Signals card                      Daily email / brief
   │  RUN (reddit)                          ▲  "Happening on Reddit" section
   ▼                                        │
POST /api/dashboard/scout-test {reddit}     │  buildRedditBriefSection(intel.redditAnalysis)
   └─ runScoutTest(platform:'reddit')       │        ▲
        └─ fetchLast30Days({sources:'reddit'})       │  projectBrief → intel.redditAnalysis
             └─ normalizeSignals(...).filter(reddit) │        ▲
   └─ persist → reportSnapshot.platformTests.reddit.items   reportSnapshot.redditAnalysis.text
                              │                              ▲
                              ▼                              │
              collectRedditSignals(marketingBrief) ──► refreshRedditAnalysis (pre-digest)
              (platformTests.reddit.items + agentData.redditSignals + reddit brandMentions)
                              │
                              └──► also feeds the reply-targets pool (Suggested Replies)
```

## The touchpoints (copy these for a new platform)

| # | File | Reddit wiring |
|---|------|---------------|
| **0** | `features/scout-intake/external-scouts/scrapecreators-client.js` | **the prod-safe data source.** `searchReddit({queries})` / `searchInstagram({queries,creators})` → HTTPS to `api.scrapecreators.com` → normalized `{title,url,summary,tag,subreddit,author,engagement,publishedAt}` items. Add a `search<P>()` here for a new ScrapeCreators platform. |
| 1 | `app/api/dashboard/scout-test/route.js` | `ALLOWED_PLATFORMS` includes `'reddit'`; persists `reportSnapshot.platformTests.reddit` (⚠️ sanitize undefined — Firestore `.set()` throws sync; see Gotchas) |
| 2 | `features/scout-intake/scout-test.js` | `platform === 'reddit'` branch → `searchReddit({ queries: [brand, …categoryTerms] })` (the Node client, row 0) → items straight through. (Instagram passes `creators` from `cfg.instagramHandles` too.) |
| 3 | `features/intelligence/_platform-signals.js` | `collectRedditSignals(marketingBrief)` — merges `agentData.redditSignals` + `platformTests.reddit.items` + reddit `brandMentions` fallback; dedupes |
| 4 | `app/api/worker/pre-digest-refresh/route.js` | **7 edits:** (a) import `collect<P>Signals`; (b) `build<P>AnalysisContent()`; (c) `refresh<P>Analysis()` (gated on `platformAvailability.<p>`) → writes `reportSnapshot.<p>Analysis.text`; (d) add `<p>Signals` to the `refreshReplyTargets` pool; (e) add `refresh<P>Analysis` to the analysis `Promise.all`; (f) add to `digestFreshness`; **(g) `refreshPlatformSignals()` pulls `<p>` via the row-0 client → `platformTests.<p>` in the FIRST `Promise.all` — this is what populates `<p>` in PRODUCTION (runs before the analysis step reads `collect<P>Signals`).** |
| 5 | `app/api/dashboard/recipe-run/route.js` | interactive path persists `reportSnapshot.redditAnalysis` when the `reddit-analysis` recipe runs from the card |
| 6 | `features/intelligence/_brief-intel.js` | `projectBrief` exposes `intel.redditAnalysis` (= `reportSnapshot.redditAnalysis.text`) and `intel.redditSignals` |
| 7 | `app/api/admin/daily-digest/route.js` | **8 edits:** (a) `build<P>BriefSection()`; (b) `<p>AnalysisSections` var (gated on `include.<p>Analysis`); (c) the `<p>Analysis:` entry in the section map (title `'Happening on <P>'` + empty-state); (d) add `<p>Analysis` to the `marketSignalsSection` `renderGroup([...])`; (e) add to the section **order** array; (f) add to `COMPAT_INCLUDE_KEYS`; (g) `available.<p>` gate in the include-override block; (h) send-time verify log — ⚠️ its `html.includes('Happening on <P>')` string **must exactly match** the section title |
| 8 | `features/intelligence/_digest-config.js` | `redditAnalysis` include key (default **OFF**), legacy-expansion + order lists |
| 9 | `features/intelligence/analysis-recipes/recipes.js` | add `EMBEDDED_PROMPTS['<p>-analysis']` **+** the `RECIPES['<p>-analysis']` entry (`prompt: EMBEDDED_PROMPTS['<p>-analysis']`, `contentKind:'<p>-signals'`). ⚠️ **The EMBEDDED string is the runtime prompt** — `loadRecipePrompt` prefers `recipe.prompt` over the file, so **editing the `.md` alone is a no-op.** |
| 10 | `features/intelligence/analysis-recipes/<p>-analysis.md` | readable **mirror** of the embedded prompt (NOT loaded at runtime while `recipe.prompt` is set — keep in sync anyway) |
| 11 | `features/intelligence/_market-insight-platform-state.js` | `platformAvailability.reddit` from `sourcePlatforms` |
| 12 | `features/not-the-rug-brief/config-loader.js` | `ALLOWED_SOURCE_PLATFORMS` / `DEFAULT_SOURCE_PLATFORMS` include the platform + host map (**already lists `instagram`, `youtube`, `tiktok`, `hackernews`**) |
| 13 | `DashboardPage.jsx` | ⚠️ **SIX separate spots — three are HARDCODED source rows, not arrays. Grep `renderSgSourceRow`, `SOCIAL_SIGNAL_SOURCES`, and `scout-test-meta` — editing one half-wires it (IG was missed TWICE here):** |
| **13a** | ↳ **`renderSgSourceRow(...)` trio** in the `#signals-search-sources-section` "01 · Search Sources" block (~L6277) | **THE primary Market Insights source list — HARDCODED, not an array.** Add `{renderSgSourceRow('<p>', '<Label>', '<desc>')}`. This is the ON/OFF + **RUN** card the operator uses; its toggle writes `sourcePlatforms`, which drives `platformAvailability.<p>` → which un-disables the Email Digest section. **Miss it → the source is invisible + the digest toggle stays greyed "Enable in Market Insights".** |
| 13b | ↳ `SOCIAL_SIGNAL_SOURCES` / `WEB_SEARCH_SOURCES` (~L405/433, rendered via `renderSourcePlatformRow` ~L17189/17207) | a **secondary** card render (the "Social Media Signals (Media)" modal). Set `locked:false`. Not the one in the main screenshot, but keep in parity. |
| 13c | ↳ `UNLOCKED_SOURCE_PLATFORMS` + `DEFAULT_MARKETING_BRIEF_SOURCE_PLATFORMS` + `MARKETING_BRIEF_SOURCE_PLATFORMS` (~L385) | add `<p>`. `toggleMarketingBriefSourcePlatform` **early-returns unless the key is in `UNLOCKED_SOURCE_PLATFORMS`** — so without this the RUN row renders but the ON toggle silently does nothing. |
| 13d | ↳ `renderInstagramAnalysisBlock` + dispatch (~L6706 / `res.recipeId === '<p>-analysis'`) | copy `renderRedditAnalysisBlock`; add the dispatch line. REPORT-tab render. |
| 13e | ↳ `renderSignalsBriefMock` results-total (~L7006) | `const <p> = scoutTestState?.<p>?.items \|\| []` + add `+ <p>.length` to `total`. |
| 13f | ↳ debug meta band `[['x',…],['reddit',…]]` (~L20171) + `social-signals` health check (~L12120) | both hardcode `x`/`reddit` — add `<p>` so the meta band shows it and the card doesn't read "critical" when only IG is on. |
| 14 | `components/AdminEmailModals.jsx` | ⚠️ **the digest include toggles are HARDCODED here, NOT generated from `INCLUDE_KEYS`:** add the `['<p>Analysis','Happening on <P>','… analysis','signals','<p>']` tuple in `SECTION_GROUPS`, add `<p>` to `PLATFORM_SECTION_LABELS`, and add the `availability.<p>` line in `guardIncludeForAvailability`. Miss it → the brief toggle never appears in the Email Digest card. |

## Config / toggle surface

- **Source on/off + availability:** `client_configs/{id}.marketingBriefConfig.sourcePlatforms`
  → `_market-insight-platform-state.js` → `platformAvailability.<p>`. The digest gates the
  section on `available.<p>` too, so a disabled source can't render.
- **Email section on/off:** `digest_config/{id}.include.<p>Analysis` (default **OFF** — opt-in,
  like reddit). The section is gated **only** by its toggle + availability, with an explicit
  empty-state — never by data presence.
- **Analyzer:** `<p>-analysis.md` recipe registered in `recipes.js`; run by
  `refresh<P>Analysis` (cron/Generate & Send) and `recipe-run` (interactive).

## Gotchas (learned the hard way)

- **Firestore rejects `undefined` and `.set()` validates *synchronously*** — a trailing
  `.catch()` will NOT catch it; the throw 500s the whole test. The scout-test route now
  strips undefined via a JSON round-trip + a real try/catch. Never emit `note: undefined`
  from a `runScoutTest` branch; use `null`.
- **`test == real run`** only holds because both call `fetchLast30Days` with the same
  normalizer. Do not reintroduce a divergent per-source scraper (the old DuckDuckGo reddit
  path was removed for this reason — DDG rate-limits/202s).
- **Analyzer output format:** the email parser (`parseRecipeAnalysis`) expects the recipe to
  emit a JSON object first (it tolerates ``` fences). Recipes that drift to prose render via
  the section's prose fallback, but structured output is preferred — keep the "JSON FIRST,
  MANDATORY" instruction in the `.md`.
- **Include defaults OFF:** new platform sections must be toggled on in the Email Digest
  card to appear.
- **⚠️ The Market Insights source list is a HARDCODED trio, not an array.** The section the
  operator actually uses ("01 · Search Sources", `#signals-search-sources-section`, ~L6277)
  is three literal `renderSgSourceRow('web'…)` / `'x'` / `'reddit'` calls — you must add a
  fourth line. It is NOT `SOCIAL_SIGNAL_SOURCES` (that's a *different, secondary* card). **The
  availability chain the digest depends on:** `renderSgSourceRow` ON-toggle → writes
  `marketingBriefConfig.sourcePlatforms` → `platformAvailability.<p>` → un-disables the Email
  Digest "Happening on <P>" toggle. Miss the row and the digest toggle is greyed forever with
  "Enable in Market Insights" — which the operator can't do. There are **≥3 hardcoded
  source-render spots** in `DashboardPage.jsx` (rows 13a/13b/13f) — grep `renderSgSourceRow`,
  `SOCIAL_SIGNAL_SOURCES`, `scout-test-meta`, and any `'x'.*'reddit'` literal.
- **⚠️ Digest toggles are hardcoded**, not generated: the include checkboxes live in
  `AdminEmailModals.jsx` `SECTION_GROUPS` as literal tuples. Adding a key to
  `_digest-config.js INCLUDE_KEYS` does NOT surface a checkbox — you must add the tuple.
- **⚠️ The recipe `.md` is a decoy** when `recipe.prompt` (embedded) is set: `loadRecipePrompt`
  returns the embedded string first. Edit `EMBEDDED_PROMPTS[...]` in `recipes.js`, not the file.
- **⚠️ Quote-heavy content breaks the JSON render.** Analyzer recipes emit a JSON object the
  email/dashboard parse with `parseRecipeAnalysis`. If a source title/caption contains a raw
  `"` (common on Instagram: `Comment "Tools"…`), the model copies it unescaped → `JSON.parse`
  throws → the section silently falls back to **prose only** (no overview/cards). The shared
  `## Output — JSON FIRST` block now bans raw inner double-quotes (use single quotes). If it
  recurs, add a repair pass to `parseRecipeAnalysis` (guard it behind the strict-parse failure
  so it can't affect currently-valid output). Keep the JSON-first instruction **schema-agnostic**
  — it's shared across watchlist(`handles`)/reddit+instagram(`threads`); don't name one schema's key.

## Per-platform "watch these accounts" inputs (optional, like the X Watchlist / IG Accounts)

last30days can target specific accounts per platform: `--x-related` (X), `--ig-creators` (IG),
`--tiktok-creators`, `--subreddits`. To expose one (Instagram is the worked example):

| # | File | Wiring |
|---|------|--------|
| P1 | `app/api/dashboard/marketing-brief/config/route.js` | ⚠️ add `<field>` to the save normalization (split newline/comma → array, `.slice(0,20)`). **Miss it → the input never persists.** |
| P2 | `features/not-the-rug-brief/config-loader.js` | `configured<X> = marketingBriefConfig.<field>`; a `clean<X>` list (strip `@`, len≥2, slice 6); expose it on the runtime `cfg` (so scout-test reads it); set the last30days flag (e.g. `igCreators: cleanIg.join(',')`). |
| P3 | `features/not-the-rug-brief/services/last30days.js` | `if (l30.<flag>) args.push('--<cli-flag>', l30.<flag>)`. |
| P4 | `features/scout-intake/scout-test.js` | the platform branch passes the same flag from `cfg.<field>` so Test == brief. |
| P5 | `DashboardPage.jsx` "02 · Inputs · Customize" | a bound `.sg-input` (value = array join / string; onChange writes the raw string; save route normalizes). |

Unit-check the flow with `buildRuntimeConfigFromFirestore(id, { marketingBriefConfig:{ <field>:[…], sourcePlatforms:['<p>'] } })` → assert `cfg.<field>` and `cfg.last30days.<flag>` — no network needed.

## Adding a platform = repeat rows 1–14 with `<p>` (engine already supports it)

`youtube`, `tiktok`, `hackernews` are already valid last30days sources (row 12), so no new
fetch infra is needed — only the analysis + email + UI + toggle wiring above. **Instagram
(rows 1–14) is the worked reference** — copy every `instagram`/`reddit` edit for the new key.

### Verify checklist (before saying "done")
1. `grep -rn '<newplatform>' <each file in rows 1–14>` — every list/gate/dispatch present?
2. Source **Test**: `runScoutTest({platform:'<p>'})` returns items (local harness) **and** the
   **RUN card shows in Market Insights** (row 13a — the one that got missed).
3. Analyzer: `refresh<P>Analysis` writes `reportSnapshot.<p>Analysis.text`; the email/report
   section renders (parse with the real `parseRecipeAnalysis`).
4. Digest toggle: the `Happening on <P>` checkbox appears in the Email Digest card (row 14).
