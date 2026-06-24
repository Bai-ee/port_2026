# Pipeline Content Inputs — Granular Reference

**Scope:** the free-tier intake pipeline (`features/scout-intake/`). Documents every field we extract, derive, inject, synthesize, or analyze, and where each field ends up on the dashboard.

**Entry point:** `features/scout-intake/runner.js::runIntakePipeline({ clientId, clientConfig })`

**Stages (in order):**

1. URL normalization
2. Homepage screenshot capture (parallel, non-blocking)
3. Site evidence fetch — HTML scraping + per-page extraction
4. Intelligence briefing read (opt-in)
5. LLM synthesis — Anthropic Sonnet via tool_use (**180s timeout + 20s heartbeat**)
6. Device mockup composition (if screenshot succeeded)
7. Scout config generation (cached per client)
8. **[PSI] PageSpeed Insights fetch** — gated on `PAGESPEED_API_KEY` set + `PAGESPEED_ENABLED != '0'`
9. **Analyzer skills** (gated on `SCOUT_ANALYZER_SKILLS_ENABLED=1`)
9. Scribe pass — per-card copy + brief doc (**180s timeout + heartbeat**)
10. Brief render + PDF artifact
11. Normalize → `IntakePipelineResult`

---

## Pipeline resilience — never-fail guarantee

**As of P1 resilience patch:** every stage is non-fatal. The pipeline ALWAYS returns `status: 'succeeded'` with whatever data it could capture plus a warnings list.

- **Fetch failure** → evidence becomes `{ pages: [], thin: true }` + warning `fetch_failed`. Pipeline continues with empty evidence.
- **Synth failure or timeout** → `synthesisResult.intake = null` + warning `synthesize_failed`. Downstream stages accept null gracefully.
- **Style-guide failure or timeout** → styleGuide = null + warning `style_guide_extraction_failed`.
- **Scout-config failure** → scoutConfig = null + warning `scout_config_failed`.
- **PSI failure or timeout** → `pagespeed` is now an error `SourceRecord` with `facts.diagnosticsContext` and a warning code prefixed `pagespeed_failed_*`. Skills receive `intel.pagespeed.auditStatus = 'error'` plus structured failure context.
- **PSI skipped (no key / flag off)** → warning code prefixed `pagespeed_skipped_*`.
- **Skill failure or timeout** → empty analyzerOutputs + warning `skill_failed` with the skill id.
- **Scribe failure or timeout** → scribeResult = null + warning `scribe_failed`. Cards fall back to static copy from `card-static-copy.js`.
- **Normalize failure** → builds a minimal succeeded result from whatever was captured + warning `normalize_failed`.

### Stage timeouts

Every Anthropic-dependent stage is wrapped with `withTimeout()`:
- **Timeout: 180s per stage** (generous — legitimate calls rarely exceed 60s)
- **Heartbeat: every 20s** — emits `Still working on {stage}… You can leave this window and come back at anytime.` to the terminal events subcollection so the UI stays alive.

Stages wrapped:
- `synthesizeSiteEvidence` → AI synthesis
- `extractDesignSystem` → Style guide extraction
- `runCardSkills` → Analyzer skills
- `runScribe` → Scribe

### Worker-level error capture

The worker (`app/api/worker/run-brief/route.js`) also catches any unhandled throw from `runIntakePipeline` and routes it through `failRun`. With resilience in place, this path is rarely hit — reserved for framework-level failures.

---

## Stage 1 — URL normalization

**Source:** `clientConfig.sourceInputs.websiteUrl` → fallback `clientConfig.websiteUrl`
**File:** `runner.js::normalizeWebsiteUrl`

- Trim whitespace
- Prepend `https://` if no protocol
- Parse with `new URL()` — invalid URL pushes warning, pipeline continues with null websiteUrl

**Output field:** `websiteUrl` (absolute URL string or null)

---

## Stage 2 — Homepage screenshot capture (parallel)

**File:** `api/_lib/browserless.cjs::persistWebsiteScreenshotArtifact`

Launched as `screenshotTask` at the start of Stage 3 and awaited later. Non-fatal — failures become warnings.

**Outputs (artifact refs):**

- `website_homepage_screenshot` — one or more variants (desktop/tablet/mobile) with storage path + metadata
- Warning artifacts for failures

**Consumer:** Stage 6 composes these into a multi-device mockup.

---

## Stage 3 — Site evidence fetch

**File:** `features/scout-intake/site-fetcher.js::fetchSiteEvidence`

### 3.1 Page discovery

Homepage is fetched first. Then up to **3 additional pages** matching URL patterns (first match per type wins, same-origin only):

| Pattern (case-insensitive) | Type |
|---|---|
| `/about`, `/about-us`, `/our-story`, `/who-we-are` | `about` |
| `/pricing`, `/plans`, `/packages`, `/rates` | `pricing` |
| `/services`, `/what-we-do`, `/solutions`, `/offerings`, `/work` | `services` |
| `/contact`, `/contact-us`, `/get-in-touch`, `/reach-us` | `contact` |

Fetch timeout: **8000ms per page**. User-Agent: `Mozilla/5.0 (compatible; BrandintelBot/1.0)`.

### 3.2 Per-page extraction (every page — regex only, no parser)

Each page (`PageEvidence`) carries:

| Field | Source | Caps |
|---|---|---|
| `url` | resolved URL | — |
| `type` | page class (`homepage`/`about`/`pricing`/`services`/`contact`) | — |
| `title` | `<title>` | 200 chars |
| `metaDescription` | `meta[name=description]` (both attribute orderings) | 600 chars |
| `h1` | `<h1>` inner text | each 150 chars, unbounded count |
| `h2` | `<h2>` inner text | each 150 chars, 10 max |
| `navLabels` | `<nav>` → fallback to `.nav`/`.menu`/`.header-nav`/`.main-nav` containers, extract `<a>` text | each 2–50 chars, 14 unique max |
| `ctaTexts` | `<button>` or `<a>` text matching CTA intent regex | each 2–80 chars, 6 unique max |
| `bodyParagraphs` | `<p>` inner text | each 40–600 chars, sliced to 300, 8 max |
| `socialLinks` | `href` matching twitter/x/instagram/facebook/linkedin/tiktok/youtube/pinterest | 8 unique max |
| `contactClues` | email + US/CA phone regex | 4 unique max |
| `_rawHtml` | full HTML source | **ephemeral** — stripped by `normalize.js` before Firestore write, AND stripped by runner.js before being passed to analyzer skills (to avoid 200K token overflow) |

All strings pass through `decodeEntities()` and `stripTags()`.

### 3.3 Homepage-only — `siteMeta` extraction

Attached only to the homepage PageEvidence as `page.siteMeta`. Fields: `title`, `description`, `siteName`, `ogImage`, `ogImageAlt`, `favicon`, `appleTouchIcon`, `themeColor`, `canonical`, `locale`, `type`.

### 3.4 Thin-content detection

`SiteEvidence.thin = true` when total body text across all pages < 200 chars. Threaded to synth as a hint.

### 3.5 Failure mode (resilience)

If `fetchSiteEvidence` throws (site unreachable, all pages timeout):
- `evidence = { pages: [], thin: true, warnings: [...] }`
- Warning `fetch_failed` pushed
- Terminal emits `[FETCH] Fetch failed — continuing with limited data`
- Pipeline continues — no early return

---

## Stage 4 — Intelligence briefing (opt-in)

**Store:** `features/intelligence/_store.js::getMaster(clientId)`

Only runs when `master.meta.pipelineInjection === true`. Non-fatal — any read failure just skips injection.

**Input:** `master.digest.briefingBullets: string[]`
**Output:** briefing string injected into synth prompt.

---

## Stage 5 — LLM synthesis

**File:** `features/scout-intake/intake-synthesizer.js::synthesizeSiteEvidence`
**Model:** `claude-sonnet-4-5-20250929`
**Max tokens:** 4096
**Tool:** `write_brand_intake` (forced via `tool_choice: { type: 'any' }`)
**Timeout:** 180s (wrapped by `withTimeout` in runner)

### 5.1 Evidence formatting

`formatEvidenceForPrompt(evidence)` builds a compact text block per page. Typical input: 600–1500 tokens.

### 5.2 `write_brand_intake` output schema

Returns the `intake` object with:
- `snapshot.brandOverview` (headline, summary, industry, businessModel, targetAudience, positioning)
- `snapshot.brandTone` (primary, secondary, tags[], writingStyle)
- `snapshot.visualIdentity` (summary, colorPalette, styleNotes)
- `signals.core[]` (2–5 items: label, summary, source, relevance)
- `strategy.postStrategy`, `strategy.contentAngles[]`, `strategy.opportunityMap[]`
- `outputsPreview.samplePost`, `outputsPreview.sampleCaption`
- `systemPreview.modulesUnlocked[]`, `systemPreview.nextStep`

### 5.3 Failure mode

- **Throws** (network, invalid response, timeout) → `synthesisResult = { ok: false, intake: null, error }` + warning `synthesize_failed`.
- **Returns `!ok`** → warning `synthesize_empty` pushed.

Pipeline continues. Downstream consumers handle `synthesisResult.intake === null`.

### 5.4 Cost metadata

`runCostData` attached — cost typically $0.004–$0.012. Pricing constants in `extractUsage` still use Haiku rates; model is Sonnet — cost numbers are indicative, not invoice-accurate.

---

## Stage 6 — Device mockup composition

**File:** `api/_lib/device-mockup.cjs::generateWebsiteMockupArtifact`

Runs only if Stage 2 produced at least one `website_homepage_screenshot`. Non-fatal.

---

## Stage 7 — Scout config generation

**File:** `features/scout-intake/scout-config-generator.js`
**Persisted:** `client_configs/{clientId}.scoutConfig`

Generated once per client from intake + evidence. On subsequent runs, loaded from cache unless stale (URL mismatch).

**Output fields:** `brandKeywords`, `competitors`, `categoryTerms`, `kols`, `reddit` (subreddits, mentionQueries, opportunityQueries), `weather` (neighborhoods), `reviews` (sources), `instagram`, `scout.searchPlan` (5 queries), `_meta.capabilitiesActive[]`, `_meta.capabilitiesInactive[]`.

Non-fatal — failure pushes warning `scout_config_failed` and pipeline continues.

---

## Stage 8 — Analyzer skills (P1)

**File:** `features/scout-intake/runner.js` invocation of `runCardSkills`
**Gate:** `process.env.SCOUT_ANALYZER_SKILLS_ENABLED === '1'`
**Timeout:** 180s (wrapped)

### 8.1 Skill execution

For each card in `card-contract.js` that declares `analyzerSkill: '<skill-id>'`, the runner:

1. Loads the `.md` skill file from `features/scout-intake/skills/` via `_registry.js`.
2. Parses YAML front matter (`_runner.js::parseFrontMatter`).
3. Resolves declared `inputs: [source-ids]` against `buildSourcePayloads({ intake, styleGuide, siteMeta, evidence, pagespeed, scoutConfig, userContext })`. **`_rawHtml` is stripped from `evidence.pages` before this step** to avoid 200K-token overflow on sites with large HTML.
4. Substitutes `{{inputs}}` and `{{missingStateRules}}` into the prompt body.
5. Calls Anthropic with `tool_use` forced on the skill's declared output tool.
6. Validates output against the standard contract (`_output-contract.js`).
7. Returns structured findings.

### 8.2 Standard skill output contract

Every skill output validated against this shape:

```
{
  skillId: string,
  skillVersion: number,
  runAt: ISO string,
  findings: [{ id, severity: 'critical'|'warning'|'info', label, detail, citation }],
  gaps: [{ ruleId, triggered, evidence }],
  readiness: 'healthy'|'partial'|'critical',
  highlights: string[],
  metadata: { model, inputTokens, outputTokens, estimatedCostUsd }
}
```

Invalid outputs → warning + card falls back to analyzer-impl signals.

### 8.3 Current skill library

| Skill | Card | Status |
|---|---|---|
| `seo-depth-audit` | `seo-performance` | ✅ P1 wired |
| `intake-inventory` | `intake-terminal` | 📋 Planned (P6 priority 1 — see [SCOUT_ANALYZER_SKILLS/SCOUT_ANALYZER_SKILLS_MASTERPLAN.md §13 A1](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/SCOUT_ANALYZER_SKILLS/SCOUT_ANALYZER_SKILLS_MASTERPLAN.md:1)) |
| `brand-asset-gap` | `brand-identity-design` | 📋 Planned (P6) |
| `visual-consistency` | `style-guide` | 📋 Planned (P6) |
| `conversion-audit` | `website-landing` | 📋 Planned (P6) |
| `competitor-framing` | `competitor-info` | 📋 Planned (P6) |
| `content-opportunity-rank` | `content-opportunities` | 📋 Planned (P6) |
| `priority-synthesis` | `priority-signal` | 📋 Planned (P6) |

### 8.4 Failure mode

- Skill throws / times out / returns invalid → warning `skill_failed` with skill id, card id, and error.
- Empty output → card falls back to passthrough analyzer-impl signals.
- Flag unset → entire step skipped; pipeline byte-for-byte identical to pre-P1.

### 8.5 Persistence

Output at `dashboard_state.analyzerOutputs[cardId]`. Threaded through `normalize.js` and `buildDashboardProjection` in `run-lifecycle.cjs`.

---

## Stage 9 — Scribe pass

**File:** `features/scout-intake/scribe.js`
**Model:** `claude-haiku-4-5-20251001`
**Timeout:** 180s + heartbeat
**Cost:** ~$0.005–$0.015

Consumes `analyzerResults` + `userContext` + (when P5 lands) `analyzerOutputs` to produce:
- `cards: { [cardId]: { short, expanded } }`
- `brief: { headline, summary, prioritySignals[], topOpportunities[], visualIdentityHighlight, recommendedNextStep }`

Non-fatal. Cards fall back to `card-static-copy.js` descriptions on failure.

---

## Stage 10 — Brief render + PDF

**File:** `features/scout-intake/brief-renderer.js`

Renders HTML brief doc, posts to browserless `/pdf`. Only runs when scribe produced output. Non-fatal.

---

## Stage 11 — Normalize

**File:** `features/scout-intake/normalize.js::normalizeIntakeResult`

**Resilient against null intake** — if synth produced no intake, `normalize` defaults to `{}` and uses safe accessors (`str()`, `arr()`) to build a minimal valid result.

Maps the raw LLM `intake` (or empty shell) into the canonical `IntakePipelineResult`:

```
{
  status: 'succeeded',           // ← always 'succeeded' with resilience in place
  pipelineType: 'free-tier-intake',
  pipelineRunId,

  snapshot:            { brandOverview, brandTone, visualIdentity } | null,
  signals:             { core } | null,
  strategy:            { postStrategy, contentAngles, opportunityMap } | null,
  outputsPreview:      { samplePost, sampleCaption } | null,
  systemPreview:       { modulesUnlocked, nextStep } | null,
  siteMeta:            { ...10 OG/meta fields } | null,

  scoutPriorityAction: string | null,
  content:             { x_post, content_angle, caption? } | null,
  contentOpportunities: [ { topic, whyNow, priority, format } ],
  guardianFlags:       null,

  scribe:              { cards: { ... }, brief: { ... } } | null,
  briefHtml:           string | null,
  scoutConfig:         ScoutConfig | null,
  analyzerOutputs:     { [cardId]: SkillOutput } | null,   // ← P1 addition

  providerName: 'anthropic',
  runCostData,
  artifactRefs,                  // screenshot + mockup + brief-pdf refs
  warnings,                      // merge of all stage warnings

  tier: 'free' | 'paid',
}
```

If normalize itself throws, runner.js builds an equivalent minimal result so the pipeline still returns `succeeded`.

---

## Real-time terminal events

**Store:** `clients/{clientId}/brief_runs/{runId}/events/{eventId}`
**Shape:** `{ stage, label, extra, createdAt }`

Every `emitProgress()` call in the pipeline writes an event doc via `api/_lib/run-lifecycle.cjs::appendRunEvent`. The dashboard terminal subscribes via `onSnapshot` and renders events in real time.

### Event stages (mapped to terminal prefixes)

| Stage | Prefix | CSS class |
|---|---|---|
| `capture` | `[SCREEN]` | `term-screen` |
| `fetch` | `[FETCH]` | `term-fetch` |
| `analyze` | `[ANALYZE]` | `term-ok` |
| `styleguide` | `[STYLE]` | `term-ai` |
| `synthesize` | `[AI]` | `term-ai` |
| `compose` | `[MOCK]` | `term-mock` |
| `scout-config` | `[SCOUT]` | `term-ai` |
| `skills` | `[SKILL]` | `term-ai` |
| `scribe` | `[SCRIBE]` | `term-ai` |
| `brief` | `[BRIEF]` | `term-ai` |
| `normalize` | `[BUILD]` | `term-build` |
| `progress` | `✓` | `term-ok` |
| `error` | `✗` | `term-error` |

### Run-level events

- `failRun` appends `stage: 'error'` with the failure message.
- `completeRun` appends `stage: 'progress'` with `"Pipeline succeeded — dashboard data ready."`.
- Long stages emit heartbeats every 20s: `"Still working on {label}… You can leave this window and come back at anytime."`

### Firestore rules

Client-side reads of the events subcollection are authorized to the signed-in owner of that client:

```
match /clients/{clientId}/brief_runs/{runId}/events/{eventId} {
  allow read:  if request.auth != null && callerClientId() == clientId;
  allow write: if false;  // server-only writes via admin SDK
}
```

The parent `brief_runs/{runId}` doc stays server-only.

---

## Card contract, source inventory, static copy

Three declarative source-of-truth files under `features/scout-intake/`:

### `card-contract.js`

38 cards (16 free-tier, 22 paid). Each entry declares:

| Field | Purpose |
|---|---|
| `id` | Stable card id |
| `navLabel`, `navTitle` | Dashboard UI labels (exact match) |
| `category` | `design` \| `seo` \| `content` \| `systems` \| `runtime` \| `upgrade` |
| `role` | Semantic role for Scribe prompt |
| `sourceField`, `fallbackField` | Dotted pointer into the intake result |
| `analyzer.impl` | `passthrough` \| `pagespeed` \| `design-system-extractor` \| `runtime` |
| `analyzerSkill` | Skill id from `skills/` (null = skip skill step) |
| `copy.short`, `copy.expanded` | Char-count budgets for Scribe |
| `qualityScaling` | Scribe scales copy length by confidence |
| `tier` | `all` (free+paid) \| `paid` (locked on free) |
| `actionClass` | `runtime` \| `describe` \| `diagnose` \| `recommend` \| `service-offer` |
| `sources[]` | Source IDs that feed this card (for Data Map UI) |
| `missingStateRules[]` | `{ id, when, reason, offer }` declarative gap rules |

Helpers exported: `getCard`, `cardsForTier`, `cardsByAnalyzer`, `cardsByCategory`, `cardsByActionClass`, `cardsBySource`.

### `source-inventory.js`

14 sources. Each entry:

```
{
  id, label, category,                      // e.g. 'site.meta', 'Site Meta (OG + favicon)', 'site'
  collection: { method, detail, auth, costPerRun, file },
  payloadFields: string[],
  freshness: string,
}
```

Categories: `site`, `llm`, `intelligence`, `external-scout`, `scout-config`, `user`.

### `card-static-copy.js`

Maps every card id to its dashboard baseline description (verbatim from `DashboardPage.jsx`). Used by the Data Map admin UI to show what the dashboard renders when Scribe has no output for a card. Also supports `alternateDescription` (dual-mode cards like `brand-tone`) and `dynamicOverride` notes.

---

## Admin surfaces — Data Map & Notes

Lives at `/preview/scout-config` with four tabs:

### Config tab

Shows the persisted `scoutConfig` for the signed-in user's client plus buttons to regenerate the config or run external scouts manually.

### Data Map tab

Reads `/api/admin/scout-data-map` and `/api/admin/scout-card-copy`. Shows:

- **P1 status banner** — FLAG ON/OFF + output count + skill warnings inline (from latest `brief_run`).
- **All-cards chip row** — 38 jump links to each card.
- **Source Inventory** — every source with method, auth, cost, payload fields, freshness.
- **Every card** (both tiers) rendered fully with:
  - Nav title + id + tier + action-class chips
  - Sources chip row
  - **Data received** — resolved payload fields per source
  - Missing-state rules
  - Scribe budgets + intake field pointer
  - **Static description baseline** (from `card-static-copy.js`)
  - **Live scribe copy** (short + expanded from the last run)
  - **Analyzer skill panel** (when attached) — findings with severity chips, readiness, cost, model, tokens
  - 📝 note buttons on every row

### Runs tab

Reads `/api/admin/scout-recent-runs`. Shows the last 10 brief_runs with:
- Status chip, trigger, attempts badge (if retried), warning count
- `runId`, `sourceUrl`, all timestamps
- Error block (if failed)
- **Warnings grouped by stage** — skill / scout / styleguide / etc.

### Notes tab

Reads/writes `/api/admin/scout-map-notes`. Persists annotations to `docs/scout-data-map.notes.json` (git-tracked). Filter by `open | addressed | dismissed`. Anchor-based addressing so notes attach to specific cards, rules, sources, or skills.

### Admin endpoints

| Route | Purpose |
|---|---|
| `/api/admin/scout-data-map` | Returns `{ sources, cards }` |
| `/api/admin/scout-card-copy` | Live scribe + static copy + analyzerOutput per card, plus flag status and warnings |
| `/api/admin/scout-recent-runs` | Last N brief_runs trimmed for triage |
| `/api/admin/scout-map-notes` | GET/POST/PATCH/DELETE annotations |
| `/api/admin/whoami` | Diagnostic — decoded token email + admin doc existence |

All endpoints require admin (`admins/{email}` doc exists). Writes are dev-only (`NODE_ENV !== 'production'`).

---

## Dashboard field mapping

Each intake field maps to a dashboard card. Active intake-fed cards (rendered by `intakeCapabilityCards.map`):

| Card | Source |
|---|---|
| Brief | `snapshot.brandOverview` + dynamic headline override |
| Intake Terminal | live progress events (real-time stream, no storage) |
| Brand Tone → swaps to **Site Meta** when present | `siteMeta.*` + `snapshot.brandTone.*` fallback |
| Style Guide | `snapshot.visualIdentity.styleGuide` (feeder is `design-system-extractor.js`) |
| SEO + Performance | PageSpeed Insights intelligence (`features/intelligence/pagespeed.js`) + `analyzerOutputs['seo-performance']` when skills enabled |
| Industry | `snapshot.brandOverview.industry` |
| Business Model | `snapshot.brandOverview.businessModel` |
| Priority Signal | top-relevance item from `signals.core[]` |
| Draft Post | `outputsPreview.samplePost` |
| Content Angle | `strategy.contentAngles[0]` |
| Content Opportunities | `strategy.opportunityMap[]` |
| Competitor Info | `scoutConfig.competitors` (once wired) |
| Signals | `externalSignals.*` (once Phase E wired) |
| Marketing | `strategy.postStrategy` + external signals |
| Website & Landing Page | `evidence.pages` + `siteMeta` + `intelligence.pagespeed` — service-offer card |
| Brand Identity & Design | `siteMeta` + `synth.styleGuide` — service-offer card |

Paid/upgrade tiles (22) render with blocked-overlay + `Upgrade Tier` CTA. Source of truth: `UPGRADE_TILE_TITLES` / `UPGRADE_TILE_DESCRIPTIONS` in `DashboardPage.jsx`, mirrored in `card-static-copy.js`.

---

## Terminal UI behavior

### Always visible
- Survey column never unmounts. `OnboardingChatModal` renders unconditionally (gated only on run activity via parent), even after skip or completion.
- Marquee text static — "BUILDING YOUR DASHBOARD · PROCESSING WEBSITE" at all times. No conditional swap, no layout shift.
- Subtitle static — "Creating Your Dashboard" at all times.

### Retry prompt
When `latestRunStatus === 'failed'` (should be rare with resilience), a retry chat turn appears inside the `OnboardingChatModal` thread — NOT as a separate UI element. Styled as a bot message + URL input + red Retry button. Auto-scrolls into view.

### Post-run
When `status: 'succeeded'`:
- Survey resolved → countdown "launching dashboard in 3…" in terminal. One-shot (guarded by `postSurveyRevealFiredRef`).
- Survey unresolved → "complete the survey above to reveal your dashboard →" with blinking caret.

### Skip All mid-survey
Footer link "Skip remaining questions" visible whenever `!introMode`. Calls same `handleSkipAll` handler as intro-screen skip buttons.

### Error banner
**Removed.** Dashboard never shows a top-level error banner. Errors surface in the terminal event stream and (as last resort) in the chat retry prompt.

---

## What is NOT yet wired

- **External scouts in main runner** (Reddit / weather / reviews) — exist at `features/scout-intake/external-scouts.js` and callable via `/api/dashboard/scout-run`, but not invoked from `runner.js`. Phase E — separate workstream.
- **P2 per-client skill overrides** — planned at `clients/{clientId}/scoutSkills/{cardId}`. Not implemented.
- **P3 skill picker UI** — Data Map Analyzer block with skill dropdown + .md viewer. Not implemented.
- **P4 test-fire skill endpoint** — run one skill against live data without full pipeline rerun. Not implemented.
- **P5 Scribe consumption of `analyzerOutputs`** — Scribe still reads legacy analyzerResults. P5 adds recommendation field to card output.
- **P7 brief aggregator** — post-Scribe synthesis into `brief.homeSummary`. Not implemented.

---

## Token-budget reference

| Source | Typical input | Notes |
|---|---|---|
| `formatEvidenceForPrompt()` | 600–1500 tokens | Main synth evidence |
| Intelligence briefing | up to a few hundred tokens | Opt-in, per-client |
| Skill inputs block (after `_rawHtml` strip) | 10–30K tokens | `_rawHtml` on evidence.pages[] stripped before skill invocation to avoid 200K overflow |
| `buildCssText()` (design-system-extractor) | up to ~60KB of CSS → hard-capped | Independent LLM call |
| Scribe prompt | ~500–1200 tokens | Compact analyzer signals only |

---

## File locations

| Concern | File |
|---|---|
| Pipeline orchestration | `features/scout-intake/runner.js` |
| HTML fetch + extraction | `features/scout-intake/site-fetcher.js` |
| LLM synthesis | `features/scout-intake/intake-synthesizer.js` |
| Result shaping | `features/scout-intake/normalize.js` |
| CSS → design tokens | `features/scout-intake/design-system-extractor.js` |
| Scribe (per-card copy) | `features/scout-intake/scribe.js` |
| Brief HTML render | `features/scout-intake/brief-renderer.js` |
| Card contract | `features/scout-intake/card-contract.js` |
| Source inventory | `features/scout-intake/source-inventory.js` |
| Static dashboard copy | `features/scout-intake/card-static-copy.js` |
| Skill runner | `features/scout-intake/skills/_runner.js` |
| Skill output contract | `features/scout-intake/skills/_output-contract.js` |
| Skill registry | `features/scout-intake/skills/_registry.js` |
| First skill (SEO) | `features/scout-intake/skills/seo-depth-audit.md` |
| Scout config gen | `features/scout-intake/scout-config-generator.js` |
| External scouts bridge | `features/scout-intake/external-scouts.js` |
| Reddit scout | `features/scout-intake/external-scouts/reddit-web-search.js` |
| Homepage screenshot | `api/_lib/browserless.cjs` |
| Multi-device mockup | `api/_lib/device-mockup.cjs` |
| PageSpeed source | `features/intelligence/pagespeed.js` |
| Intelligence master store | `features/intelligence/_store.js` |
| Run lifecycle + events | `api/_lib/run-lifecycle.cjs` |
| Dashboard render | `DashboardPage.jsx` |
| Admin Data Map UI | `app/preview/scout-config/page.jsx` |

---

## Related docs

- **Scout Analyzer Skills master plan** — [`docs/SCOUT_ANALYZER_SKILLS/SCOUT_ANALYZER_SKILLS_MASTERPLAN.md`](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/SCOUT_ANALYZER_SKILLS/SCOUT_ANALYZER_SKILLS_MASTERPLAN.md:1) — full phase plan P1–P7 + amendments A1/A2.
- **Scout Analyzer Skills master prompt** — `docs/SCOUT_ANALYZER_SKILLS/SCOUT_ANALYZER_SKILLS_MASTERPROMPT.md` — drop-in prompt for fresh Sonnet sessions executing the plan.
- **Data Map annotations** — `docs/scout-data-map.notes.json` — git-tracked review notes, readable by the assistant in one file read.
- **Client Intelligence Layer V2** — `docs/CLIENT_INTELLIGENCE_LAYER_V2_POST_MIGRATION.md` — canonical paths for the intelligence layer (PSI + adjacent sources).
