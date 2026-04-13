# Pipeline Content Inputs — Granular Reference

**Scope:** the free-tier intake pipeline (`features/scout-intake/`). Documents every field we extract, derive, inject, or synthesize, and where each field ends up on the dashboard.

**Entry point:** `features/scout-intake/runner.js::runIntakePipeline({ clientId, clientConfig })`

**Stages (in order):**

1. URL normalization
2. Homepage screenshot capture (parallel, non-blocking)
3. Site evidence fetch — HTML scraping + per-page extraction
4. Intelligence briefing read (opt-in)
5. LLM synthesis — Anthropic Sonnet via tool_use
6. Device mockup composition (if screenshot succeeded)
7. Normalize → `IntakePipelineResult`

---

## Stage 1 — URL normalization

**Source:** `clientConfig.sourceInputs.websiteUrl` → fallback `clientConfig.websiteUrl`
**File:** `runner.js::normalizeWebsiteUrl`

- Trim whitespace
- Prepend `https://` if no protocol
- Parse with `new URL()` — invalid URL fails the run with `failedStage: 'fetch'`

**Output field:** `websiteUrl` (absolute URL string)

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
| `ctaTexts` | `<button>` or `<a>` text matching `/get|start|try|sign up|join|book|schedule|learn more|contact|free|demo|buy|shop|order|request|apply|register|subscribe|download|explore|see how/i` | each 2–80 chars, 6 unique max |
| `bodyParagraphs` | `<p>` inner text | each 40–600 chars, sliced to 300, 8 max |
| `socialLinks` | `href` matching twitter/x/instagram/facebook/linkedin/tiktok/youtube/pinterest (skipping bare domain roots) | 8 unique max |
| `contactClues` | email regex (skipping `example.|yourdomain|placeholder|test@`) + US/CA phone regex | 4 unique max, prefixed `email:`/`phone:` |
| `_rawHtml` | full HTML source | ephemeral — stripped by `normalize.js` before Firestore write |

All strings pass through `decodeEntities()` (handles `&amp;`, `&lt;`, `&#39;`, `&#NNN;`, etc.) and `stripTags()`.

### 3.3 Homepage-only — `siteMeta` extraction

**Function:** `site-fetcher.js::extractSiteMeta(html, baseUrl)`

Attached only to the homepage PageEvidence as `page.siteMeta`. All URLs resolved against `baseUrl` via `new URL()`.

| Field | Priority order |
|---|---|
| `title` | `og:title` → `twitter:title` → `<title>` |
| `description` | `og:description` → `twitter:description` → `meta[name=description]` |
| `siteName` | `og:site_name` → URL hostname fallback |
| `ogImage` | `og:image` → `og:image:secure_url` → `twitter:image` (resolved absolute) |
| `ogImageAlt` | `og:image:alt` → `twitter:image:alt` |
| `favicon` | `link[rel=icon]` → `link[rel=shortcut icon]` (resolved absolute) |
| `appleTouchIcon` | `link[rel=apple-touch-icon]` (resolved absolute) |
| `themeColor` | `meta[name=theme-color]` |
| `canonical` | `link[rel=canonical]` (resolved absolute) |
| `locale` | `og:locale` → `html[lang]` |
| `type` | `og:type` |

### 3.4 Thin-content detection

`SiteEvidence.thin = true` when the concatenation of all h1 + h2 + bodyParagraphs across every fetched page is under **200 chars**. Added as a warning and passed to the synth prompt so the model knows to reason from URL/domain.

### 3.5 SiteEvidence object (final Stage-3 output)

```
{
  url: string,              // normalized websiteUrl
  fetchedAt: ISO string,
  pages: PageEvidence[],    // homepage + 0–3 additional
  warnings: string[],       // fetch failures, thin content note
  thin: boolean,
}
```

Plus `pages[0].siteMeta` (homepage only) and `pages[n]._rawHtml` (ephemeral).

---

## Stage 4 — Intelligence briefing (opt-in)

**File:** `runner.js::buildIntelligenceBriefing`
**Store:** `features/intelligence/_store.js::getMaster(clientId)`

Only runs when `master.meta.pipelineInjection === true`. Non-fatal — any read failure just skips injection.

**Input:** `master.digest.briefingBullets: string[]`

**Output** (injected into synth prompt as a dedicated section):

```
=== SITE INTELLIGENCE BRIEFING ===
- bullet 1
- bullet 2
...
```

---

## Stage 5 — LLM synthesis

**File:** `features/scout-intake/intake-synthesizer.js::synthesizeSiteEvidence`
**Model:** `claude-sonnet-4-5-20250929` (see `SYNTHESIS_MODEL`)
**Max tokens:** 4096
**Tool:** `write_brand_intake` (forced via `tool_choice: { type: 'any' }`)

### 5.1 Evidence formatting

`formatEvidenceForPrompt(evidence)` builds a compact text block per page:

- `WEBSITE: {url}`
- For each page: section header `--- {TYPE} PAGE ---`, then lines for Title, Meta, H1 (first 2), H2 (first 6), Nav (first 8), CTAs, Body (first 5 paragraphs, 200-char slices), Social, Contact
- If `evidence.thin`: appends `NOTE: This site has very thin static content. Infer from available signals and URL.`
- If warnings present: appends `Fetch notes: ...`

Typical token cost of evidence block: **600–1500 input tokens**.

### 5.2 Prompt additions

- Role framing + 5 synthesis rules (specificity, inference, brand voice, signal realness)
- Optional intelligence briefing from Stage 4, injected above the evidence block
- Raw evidence text

### 5.3 `write_brand_intake` output schema

Returned verbatim as `synthesisResult.intake`. Required top-level keys: `snapshot`, `signals`, `strategy`, `outputsPreview`, `systemPreview`.

```
snapshot: {
  brandOverview: {
    headline        string,  // one-sentence what-and-for-whom
    summary         string,  // 2–3 sentences
    industry        string,  // specific, e.g. "B2B SaaS – HR Tech"
    businessModel   string,  // e.g. "subscription SaaS"
    targetAudience  string,
    positioning     string,  // 1–2 sentences vs alternatives
  },
  brandTone: {
    primary         string,
    secondary       string,
    tags            string[],     // 3–5 descriptor tags
    writingStyle    string,
  },
  visualIdentity: {
    summary         string,
    colorPalette    string,       // inferred direction; may be blank
    styleNotes      string,
  },
},
signals: {
  core: [ {                       // 2–5 items
    label       string,
    summary     string,           // 1–2 sentences
    source      string,           // e.g. "homepage", "pricing page", "CTAs"
    relevance   'high' | 'medium' | 'low',
  } ]
},
strategy: {
  postStrategy: {
    approach    string,
    frequency   string,
    formats     string[],         // 2–4
  },
  contentAngles: [ {              // 3–5 items
    angle       string,
    rationale   string,
    format      string,
  } ],
  opportunityMap: [ {             // 2–4 items
    opportunity string,
    why         string,
    priority    'high' | 'medium' | 'low',
  } ],
},
outputsPreview: {
  samplePost      string,         // 140–280 chars, brand voice
  sampleCaption   string,         // 40–100 chars
},
systemPreview: {
  modulesUnlocked string[],       // always includes the 5 free-tier modules
  nextStep        string,
}
```

### 5.4 Cost metadata

`runCostData` attached to the result:

```
{
  model: string,
  inputTokens: number,
  outputTokens: number,
  estimatedCostUsd: number,   // Haiku pricing table: $0.80 / $4.00 per MTok
}
```

**Note:** the pricing constants in `extractUsage` use Haiku rates; the model is Sonnet. Cost numbers are therefore indicative, not invoice-accurate.

---

## Stage 6 — Device mockup composition

**File:** `api/_lib/device-mockup.cjs::generateWebsiteMockupArtifact`

Runs only if Stage 2 produced at least one `website_homepage_screenshot`. Inputs the screenshot artifact refs; outputs a single composite artifact added to `artifactRefs`. Failures become warnings.

---

## Stage 7 — Normalize → `IntakePipelineResult`

**File:** `features/scout-intake/normalize.js::normalizeIntakeResult`

Maps the raw LLM `intake` into the canonical `IntakePipelineResult` shape Firestore and `run-lifecycle.cjs` expect. Also:

- Strips `_rawHtml` from every page before Firestore write
- Threads through `siteMeta` (extracted in Stage 3) as a top-level field
- Derives `scoutPriorityAction`, `content`, `contentOpportunities` compat shims for older dashboard projection code
- Wraps in:

```
{
  status: 'succeeded' | 'failed',
  pipelineType: 'free-tier-intake',
  pipelineRunId: uuid,

  snapshot:            { brandOverview, brandTone, visualIdentity },
  signals:             { core },
  strategy:            { postStrategy, contentAngles, opportunityMap },
  outputsPreview:      { samplePost, sampleCaption },
  systemPreview:       { modulesUnlocked, nextStep },
  siteMeta:            { ...10 OG/meta fields } | null,

  scoutPriorityAction: string | null,   // compat shim
  content:             { x_post, content_angle, caption? } | null,
  contentOpportunities: [ { topic, whyNow, priority, format } ],
  guardianFlags:       null,

  providerName: 'anthropic',
  runCostData,
  artifactRefs,                         // screenshot + mockup refs
  warnings,                             // merge of fetch + stage warnings

  // failure-only: error, failedStage
}
```

---

## Dashboard field mapping

Each intake field maps to a dashboard card in `DashboardPage.jsx`. The following are the active intake-fed cards (rendered by `intakeCapabilityCards.map`):

| Card | Source |
|---|---|
| Intake Terminal | live progress events during the run (not stored) |
| Brand Tone → swap to **Site Meta** when present | `siteMeta.*` + `snapshot.brandTone.*` fallback |
| Style Guide | `snapshot.visualIdentity.styleGuide` (currently mocked; feeder is `design-system-extractor.js` — **not yet wired into runner.js**) |
| SEO + Performance | PageSpeed Insights intelligence source (`features/intelligence/pagespeed.js`) — separate pipeline, merged at dashboard level |
| Industry | `snapshot.brandOverview.industry` |
| Business Model | `snapshot.brandOverview.businessModel` |
| Priority Signal | top-relevance item from `signals.core[]` |
| Draft Post | `outputsPreview.samplePost` |
| Content Angle | `strategy.contentAngles[0]` |
| Content Opportunities | `strategy.opportunityMap[]` |

All cards rendered after Content Opportunities (the `tiles.map` block) are static upgrade-tier previews — they do **not** consume pipeline data today. See `UPGRADE_TILE_TITLES` / `UPGRADE_TILE_DESCRIPTIONS` in `DashboardPage.jsx`.

---

## Upgrade-tier cards (blocked / preview)

Every tile rendered after `Content Opportunities` uses the blocked-overlay variant with a `Upgrade Tier` CTA. Titles and descriptions are mirrored verbatim from `AUTOMATION_CAPABILITIES` in `StackedSlidesSection.jsx` (both active and reserved/commented entries) so dashboard and homepage stay aligned.

**Source of truth:** `UPGRADE_TILE_TITLES` + `UPGRADE_TILE_DESCRIPTIONS` in `DashboardPage.jsx`.

### Active (currently shown on homepage)

| Tile ID | Title | Description |
|---|---|---|
| `creative-pipelines` | Creative Pipelines | Automates content creation in real time, aligning every post with your brand's voice while driving consistent engagement. |
| `company-brain` | Company Brain | Centralizes your entire operating stack into a structured, searchable system that powers faster decisions and smarter execution. |
| `knowledge-assistant` | Internal Knowledge Assistant | Instantly answers team questions by pulling from your documents, conversations, and data—eliminating bottlenecks and repetitive work. |
| `executive-support` | Executive Support Automation | Prepares meetings, surfaces insights, and drafts communications so you walk into every decision fully informed. |
| `daily-operations` | Daily Operations Engine | Runs core business tasks automatically—email triage, task tracking, reporting, and team updates—without manual oversight. |
| `email-marketing` | Email Marketing Automation | Builds, schedules, and optimizes campaigns across regions while learning and improving from feedback over time. |
| `ai-research` | AI-Powered Research | Generates deep consumer insights, competitive analysis, and market validation in hours instead of weeks. |
| `financial-tax` | Financial & Tax Processing | Organizes transactions, corrects discrepancies, and produces reporting-ready outputs aligned with accounting workflows. |
| `compliance` | Compliance Monitoring | Continuously checks deadlines, filings, and regulatory requirements to ensure nothing critical is missed. |
| `distribution-insight` | Distribution & Insight Automation | Unifies social publishing, SEO fixes, search visibility, and performance reporting into one continuous system that surfaces what to ship, where to publish, and what to improve next. |
| `rapid-product` | Rapid Product Development | Builds and deploys functional tools, integrations, and experiences from concept to launch in a fraction of the time. |
| `self-improving` | Self-Improving Systems | Continuously refines workflows, tools, and outputs based on feedback, increasing performance over time. |
| `reddit-community` | Reddit & Community | Finds relevant threads and drafts reply ideas and post concepts for review before publishing. |
| `seo-content` | SEO Content | Surfaces keyword opportunities and drafts landing pages, blog outlines, and content directions for approval. |

### Reserved (commented out on homepage — dashboard-only preview)

| Tile ID | Title | Description |
|---|---|---|
| `multi-agent-pipeline` | Multi-Agent Intelligence Pipeline | A four-stage agent architecture — Scout, Scribe, Guardian, Reporter — runs automatically each day, taking raw market data from five sources and producing a founder-ready content brief with zero manual input. |
| `hyperlocal-signals` | Hyperlocal Signal Aggregation | Scout pulls live data from X/Twitter, Instagram, Reddit, customer reviews, and weather APIs, normalizes them into a unified intelligence format, and trims context to ~5K tokens before synthesis — optimized to under $0.10 per full run. |
| `platform-content-gen` | Platform-Specific Content Generation | Scribe reads the day's brief and produces ready-to-publish drafts for Instagram, X/Twitter, Facebook, and Discord — each formatted to platform conventions and constrained by brand voice rules defined in client knowledge files. |
| `brand-safety-gate` | Brand Safety & Quality Gate | Guardian runs four sequential validation checks on every piece of generated content: restricted term scanning, competitor mention detection, factual accuracy, and brand voice scoring — outputting a readiness verdict and 0–100 quality score before anything moves forward. |
| `founder-daily-brief` | Founder-Facing Daily Brief | Reporter transforms the day's intelligence, content drafts, and QA results into a formatted HTML briefing — with operational context, review insights, Reddit signals, competitor activity, and content opportunities — delivered to the admin dashboard on schedule. |
| `admin-dashboard-history` | Admin Dashboard & Brief History | A real-time web dashboard surfaces the latest pipeline run: priority action, weather impact, content angle, Guardian verdict, and cost per run. A full archive of past runs lets the team compare briefs, track signal trends, and trigger fresh runs on demand. |
| `image-generation` | Image Generation & Asset Management | A canvas-based generator handles post image production — with configurable presets, logo placement controls, and live preview. Completed renders upload to Firebase Storage and attach automatically to the current brief run. |
| `knowledge-file-config` | Knowledge-File Client Configuration | The entire system adapts to a new client by swapping four JSON files: brand voice rules, intelligence config, business facts, and a restricted-terms glossary. No code changes required to onboard a new brand or vertical. |

### Overlay behavior

- Overlay CSS + handler in `DashboardPage.jsx` (`.tile-blocked-overlay`, `.tile-blocked-inner`, `.tile-blocked-upgrade-btn`).
- `Upgrade Tier` button calls `setShowTierModal(true)` — same modal as the `ONBOARDED` hero tier trigger.
- Button uses the shared `.cta-pill-btn` animated comet-border from `colors.css`.
- Every blocked tile also renders a local rows table (`Tier / Status / Metric / Module / Summary`) beneath the overlay — the `Summary` row uses the same `UPGRADE_TILE_DESCRIPTIONS` value.

---

## What is NOT yet wired

- **`design-system-extractor.js`** exists with a full Sonnet-backed extraction schema (typography / colors / layout / motion), but is currently **not** called from `runner.js`. The Style Guide card reads from `STYLE_GUIDE_MOCK` in `normalize.js` until the extractor is plugged in.
- **`synthesizeStyleGuide`** (Haiku summary wrapper in `normalize.js`) is exported but unused for the same reason.
- **`favicon` / `appleTouchIcon` / `og:image`** are extracted and passed through to the dashboard, but no thumbnail proxy/cache layer exists — we store URLs only.

---

## Token-budget reference

| Source | Typical input | Notes |
|---|---|---|
| `formatEvidenceForPrompt()` | 600–1500 tokens | The main synth evidence |
| Intelligence briefing | up to a few hundred tokens | Opt-in, per-client |
| `buildCssText()` (design-system-extractor) | up to ~60KB of CSS → hard-capped | Second independent LLM call — not yet wired |

---

## File locations

| Concern | File |
|---|---|
| Orchestration | `features/scout-intake/runner.js` |
| HTML fetch + extraction | `features/scout-intake/site-fetcher.js` |
| LLM synthesis | `features/scout-intake/intake-synthesizer.js` |
| Result shaping | `features/scout-intake/normalize.js` |
| CSS → design tokens | `features/scout-intake/design-system-extractor.js` (unwired) |
| Homepage screenshot | `api/_lib/browserless.cjs` |
| Multi-device mockup | `api/_lib/device-mockup.cjs` |
| PageSpeed source | `features/intelligence/pagespeed.js` |
| Intelligence master store | `features/intelligence/_store.js` |
| Dashboard render | `DashboardPage.jsx` |
