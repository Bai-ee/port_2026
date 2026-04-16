# Codex Evaluation & Enhancement Brief — AI SEO Audit Tool

## Context

You are enhancing a Node.js module that performs **AI SEO / GEO (Generative Engine Optimization) audits** on any public website. Its PRIMARY purpose is to be the **AI/GEO layer of the scout-intake SEO pipeline** on the Bballi Portfolio dashboard — its output flows into the existing SEO + Performance card's analyzer pipeline, is aggregated with the LLM-based `seo-depth-audit` skill's findings, consumed by Scribe for card copy, rendered across the card's PROBLEMS / SOLUTIONS / DATA tabs, and surfaces as a live metric in the card's front-facing visual.

The standalone CLI and the Express API are **secondary surfaces** that reuse the same engine. They exist for the consulting product ("AI Visibility Audit" for SMB clients) but the pipeline integration is the mandatory deliverable.

The tool currently lives at `ai-seo-audit/` with the following structure:

```
ai-seo-audit/
  src/
    audit.js                  ← orchestrator / CLI entry, composite scoring, priority actions
    llmsTxtValidator.js       ← fetches /llms.txt + /llms-full.txt, validates spec, HEAD-checks links
    robotsAiParser.js         ← parses robots.txt, scores 22 known AI bots by access state
    schemaExtractor.js        ← extracts JSON-LD, scores by type, flags gaps
    contentExtractability.js  ← heading structure, answer-first heuristics, chunk quality, JS-dependency
  package.json                ← ESM, node-fetch + cheerio only
```

**Tech constraints:**
- Node.js 18+ ESM (`"type": "module"`)
- Zero paid APIs — only `node-fetch` and `cheerio` as dependencies
- Output must conform to the scout-intake skill-output contract (see Section 0 below)
- Standalone CLI/API surfaces must reuse the same engine — no duplicated analysis code

**Pipeline context to read before starting:**
- [`features/scout-intake/runner.js`](../features/scout-intake/runner.js) — pipeline orchestrator (see Stage 8 PSI for the pattern this tool will follow)
- [`features/scout-intake/skills/_output-contract.js`](../features/scout-intake/skills/_output-contract.js) — the shape every skill's output must validate against
- [`features/scout-intake/skills/_aggregator.js`](../features/scout-intake/skills/_aggregator.js) — merges multi-skill outputs per card
- [`features/scout-intake/solutions-catalog.mjs`](../features/scout-intake/solutions-catalog.mjs) — authored problem→solution catalog that drives the dashboard SOLUTIONS tab
- [`features/scout-intake/scribe.js`](../features/scout-intake/scribe.js) — consumes `analyzerOutputs[cardId].aggregate` and writes per-card copy
- [`DashboardPage.jsx`](../DashboardPage.jsx) — `renderSeoViz` renders the card-front visual; PROBLEMS/SOLUTIONS/DATA tabs inside the modal consume the aggregate

---

## Section 0 — Integration Contract (mandatory, non-negotiable)

This is the contract between the ai-seo-audit engine and the scout-intake pipeline. Every other task must honor it.

### 0.1 — Engine export signature

`src/audit.js` MUST export a pure async function:

```js
export async function runAiSeoAudit({ websiteUrl, signal, logger }) {
  // signal: optional AbortSignal (pipeline wraps every stage in a timeout)
  // logger: optional { info, warn } — defaults to console
  // returns the skill output shape defined in 0.2 below
}
```

No process arguments, no stdout side effects, no `process.exit`. The CLI entry and Express wrapper call this same function and format/send the result themselves.

### 0.2 — Skill output contract

The returned object MUST validate against [`features/scout-intake/skills/_output-contract.js`](../features/scout-intake/skills/_output-contract.js):

```js
{
  skillId:      'ai-seo-audit',
  skillVersion: 1,
  runAt:        '2026-04-16T...Z',   // ISO
  findings: [
    {
      id:         string,            // stable kebab-case, used for solutions-catalog lookup
      severity:   'critical' | 'warning' | 'info',
      label:      string,            // human-readable short line (<80 chars)
      detail:     string,            // 1-2 sentences of evidence
      citation:   string,            // what in the audit payload triggered this
      impact:     string,            // optional — 1 sentence on why it matters
      remediation:string,            // optional — 1 sentence on how to fix it
    }
  ],
  gaps: [
    { ruleId: string, triggered: boolean, evidence: string }
  ],
  readiness:  'healthy' | 'partial' | 'critical',
  highlights: string[],              // 1-3 short phrases Scribe can reuse verbatim
  metadata: {
    model:            'native',      // no LLM used
    inputTokens:      0,
    outputTokens:     0,
    estimatedCostUsd: 0,
  },
  // Additive extras (preserved through the aggregator for CLI/API consumers, not used by contract validator):
  aiVisibility: { score, letterGrade, sections: {...} },   // see 0.4
  rawSignals:   { llmsTxt, robotsAi, schema, content, entity, technical },   // per-module raw output
  priorityActions: [ ... ],          // CLI/consulting surface
}
```

### 0.3 — Stable finding ids (for solutions-catalog lookup)

Use these ids when the corresponding condition fires. Any new finding id introduced must also get a catalog entry in Task 11.

| Finding id                         | Severity  | Fires when |
|-------------------------------------|-----------|-----------|
| `missing-llms-txt`                   | warning   | /llms.txt not found or invalid |
| `llms-txt-broken-links`              | info      | llms.txt links fail HEAD check |
| `ai-bots-blocked-gptbot`             | critical  | GPTBot disallowed |
| `ai-bots-blocked-claudebot`          | critical  | ClaudeBot disallowed |
| `ai-bots-blocked-perplexitybot`      | warning   | PerplexityBot disallowed |
| `ai-bots-blocked-generic`            | warning   | Any 2+ AI bots disallowed without specific rules above |
| `no-faqpage-schema`                  | warning   | No FAQPage schema detected |
| `no-article-schema`                  | info      | No Article/BlogPosting schema on content pages |
| `no-organization-schema`             | warning   | No Organization schema |
| `no-wikidata-entity`                 | info      | No Wikidata QID found |
| `nap-inconsistency`                  | warning   | NAP mismatch between schema and visible body text |
| `heavy-js-dependency`                | warning   | JS-off content < 200 words OR dual-fetch diff > 500 words |
| `poor-answer-first-structure`        | warning   | <50% of sections have answer-first openers |
| `deep-heading-nesting`               | info      | H4+ present without clear H2/H3 hierarchy |

### 0.4 — Additive visual payload for the card shell

Add an `aiVisibility` block to the engine output that the dashboard consumes for the front-facing card visual:

```js
aiVisibility: {
  score: 72,                  // composite 0-100
  letterGrade: 'C',           // A/B/C/D/F
  sections: {
    llmsTxt:   { score: 0,   status: 'fail',    weight: 0.15 },
    robotsAi:  { score: 81,  status: 'pass',    weight: 0.25 },
    schema:    { score: 62,  status: 'warn',    weight: 0.25 },
    content:   { score: 74,  status: 'pass',    weight: 0.15 },
    entity:    { score: 40,  status: 'warn',    weight: 0.10 },
    technical: { score: 100, status: 'pass',    weight: 0.10 },
  },
}
```

### 0.5 — Solutions catalog entries

Every stable finding id in 0.3 MUST have a matching entry in [`features/scout-intake/solutions-catalog.mjs`](../features/scout-intake/solutions-catalog.mjs), added in Task 11. Unmatched findings fall through to the generic "book a diagnostic call" card, which is a downgraded UX — aim for 100% coverage.

### 0.6 — Pipeline integration point

In [`features/scout-intake/runner.js`](../features/scout-intake/runner.js), after the PSI stage and before `runCardSkills`, add a new stage wrapped with `withTimeout()` that calls `runAiSeoAudit({ websiteUrl })` and stores the result in `analyzerOutputs['seo-performance'].skills['ai-seo-audit']`. The existing aggregator merges it with the `seo-depth-audit` output automatically.

- Feature flag: `AI_SEO_AUDIT_ENABLED` (default: on when the `ai-seo-audit` module is installed). Respects the same non-fatal pattern used by every other stage — any failure pushes a warning code `ai_seo_audit_failed` and the pipeline continues with thin data.
- Timeout: 30 seconds (no LLM, no browser — should finish in <5s most of the time).

### 0.7 — Dashboard visual integration

Add `aiVisibility` data to the `seoAudit` payload consumed by [`DashboardPage.jsx::renderSeoViz`](../DashboardPage.jsx), then render a new "AI Visibility" ring alongside the existing Performance / SEO / Accessibility / Best Practices rings. The ring uses the composite `aiVisibility.score` with the same color thresholds (≥90 success, ≥50 warning, else danger). Covered in Task 12.

### 0.8 — Tab coverage

Because the engine emits standard `findings` + `gaps`, the existing dashboard tabs automatically display AI SEO signals:

- **PROBLEMS tab** — every finding appears with the catalog-matched plain-language headline + whyItMatters. Triggered gaps show with the pink "gap" chip.
- **SOLUTIONS tab** — every finding/gap maps to its catalog entry (per 0.3 + 0.5), rendering the Have-Me-Do-It pitch + collapsible DIY. Unmatched items fall through to the generic diagnostic-call card.
- **DATA tab** — the engine's raw score breakdown (per-section scores from `aiVisibility.sections`) is rendered as stat rows alongside Lighthouse scores. Codex must also surface these as data rows — see Task 12 for the exact threading.

No UI code changes are required in the tabs themselves — the P3–P7 plumbing already consumes the aggregate. Codex's responsibility is to produce contract-conformant data that flows through cleanly.

### 0.9 — Scribe coverage

Scribe automatically consumes `analyzerOutputs['seo-performance'].aggregate` via [`features/scout-intake/scribe.js::buildCardDigest`](../features/scout-intake/scribe.js). When AI SEO findings are present, they show up in the card's `short` / `expanded` / `recommendation` copy alongside Lighthouse findings. The `readiness` verdict of the card-level aggregate is the worst-of across all skills — so a site with perfect Lighthouse but zero AI visibility will correctly surface as `'critical'` when AI findings are critical.

No Scribe code changes needed. Just emit correct severity + readiness per 0.2.

---

## Your Tasks

Work through each section below in order. For each task, read the relevant source file(s) first, then make targeted changes. Commit after each section with message `ai-seo-audit/task-N: <verb> <deliverable>`.

Phases (stop-for-approval at phase boundaries):
- **Phase 1 — Engine quality:** Tasks 1, 3, 4, then 2
- **Phase 2 — Integration (mandatory):** Tasks 10, 11, 12
- **Phase 3 — Surfaces:** Tasks 5, 6, 8
- **Phase 4 — API + tests:** Tasks 7, 9

---

### 1. Evaluate and identify gaps

Read all four source modules and `audit.js`. Also read the pipeline integration files listed in the Context section. Then write a `GAPS.md` file that documents:

- Any signal that the spec describes as important but is currently missing or underdeveloped
- Any scoring logic that is naive, inconsistent, or gameable
- Any edge cases that would cause a crash or incorrect result (e.g. malformed HTML, 301 redirect chains, non-UTF-8 encoding, sites behind Cloudflare)
- Any module that is doing too much (separation of concerns violations)
- Missing test coverage surface area
- **Integration gaps**: what parts of the current output do NOT conform to the Section 0 contract (skill output shape, stable finding ids, aiVisibility block, metadata fields). List each deviation specifically so later tasks can address them.

Be specific — cite line numbers and function names.

---

### 2. Add entity authority signals

`schemaExtractor.js` checks for `Organization.sameAs` but does not actually query external authority sources. Add a new module `src/entityAuthority.js` that:

**Wikidata lookup:**
- Takes the `sameAs` URLs from any `Organization` or `Person` schema found on the page
- Queries `https://www.wikidata.org/w/api.php` (free, no key) to confirm if the brand has a Wikidata QID
- If no `sameAs` links are present, tries a title search using the `Organization.name` value via `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=<name>&language=en&format=json`
- Returns `{ wikidataFound: bool, qid: string|null, wikidataUrl: string|null, wikipediaUrl: string|null }`

**NAP consistency check (Name / Address / Phone):**
- Extract the `name`, `address`, and `telephone` values from any `LocalBusiness` or `Organization` schema
- Compare against visible text on the page (use cheerio to search body text for the phone number and address string)
- Flag inconsistencies as `severity: 'warning'`

**Score:** 0–100, weighted: Wikidata presence (50pts), Wikipedia presence (20pts), NAP consistency (30pts)

Wire this into `audit.js` with weight `0.10`, reducing the `content` weight from `0.25` to `0.15` to keep total weights at `1.0`.

---

### 3. Strengthen the robots.txt parser

The current `robotsAiParser.js` parser in `resolveAccess()` has a simplified path-matching approach that only checks for `Disallow: /`. Real robots.txt files use path prefixes, wildcards (`*`), and `$` end anchors.

Replace `resolveAccess()` with a proper implementation that:

- Respects path-prefix matching (e.g. `Disallow: /private/` blocks `/private/page` but not `/public/`)
- Handles `*` wildcards in paths (e.g. `Disallow: /api/*`)
- Handles `$` end anchors (e.g. `Disallow: /*.pdf$`)
- Correctly implements the **longest-match-wins** precedence rule when both Allow and Disallow rules match
- Tests the root path `/` and the most common content paths (`/blog/`, `/articles/`, `/products/`)
- Returns `{ access: 'blocked'|'allowed'|'partial'|'unspecified', matchedRule: string|null, testedPaths: object }`

Add unit tests in `src/__tests__/robotsAiParser.test.js` using Node's built-in `node:test` runner (no Jest). Cover: wildcard blocking, path-prefix partial blocks, explicit Allow overriding Disallow, and unspecified agents.

---

### 4. JS-dependency detection via dual-fetch

`contentExtractability.js` currently estimates JS-dependency from the raw HTML text-to-HTML ratio. This is unreliable. Replace it with a proper dual-fetch approach:

- Use `playwright` (add as a dev/optional dependency) if available; otherwise fall back to the ratio heuristic
- If playwright is available: fetch the URL twice — once with JS disabled (`page.setJavaScriptEnabled(false)`) and once with JS enabled
- Diff the visible text: `jsDependentWordCount = jsOnWordCount - jsOffWordCount`
- Score:
  - `jsDependentWordCount < 50` → score 100 (mostly SSR)
  - `jsDependentWordCount 50–200` → score 70 (hybrid)
  - `jsDependentWordCount 200–500` → score 40 (heavy hydration)
  - `jsDependentWordCount > 500` → score 10 (SPA, near-zero crawlability without JS)
- If playwright is not installed, log a warning to `stderr` and fall back to the ratio method with a `fallback: true` flag in the result

The dual-fetch function should live in a new `src/utils/playwrightFetch.js` utility and be callable independently so the main Lighthouse layer can reuse it.

---

### 5. Structured report output formats

Right now `audit.js` outputs raw JSON. Add two additional output formats selectable via CLI flag:

**`--format=summary`** — a compact human-readable terminal report using ANSI colors (no external lib — use raw escape codes). Should show:
```
╔══════════════════════════════════════╗
║  AI Visibility Score: 72/100  [C]   ║
╚══════════════════════════════════════╝

  llms.txt          ░░░░░░░░░░  0    ✗ Not found
  Robots AI         ████████░░  81   ✓ 
  Structured Data   ██████░░░░  62   ⚠ Missing FAQPage
  Content           ███████░░░  74   ✓
  Technical         ██████████  100  ✓

  TOP 3 ACTIONS:
  1. [HIGH] Create /llms.txt — makes site discoverable by LLMs
  2. [HIGH] Add FAQPage schema — directly extractable for Q&A
  3. [MED]  Add answer-first openers to 4 sections
```

**`--format=json-min`** — minified JSON (current default becomes `--format=json`)

Move the format logic into `src/formatters/` with one file per format: `terminal.js`, `json.js`, `jsonMin.js`.

---

### 6. Add a `--compare` mode

Allow users to run the audit against two URLs and output a side-by-side diff:

```bash
node src/audit.js https://site-a.com --compare https://site-b.com --format=summary
```

This is the key feature for the consulting use case: "here's your score vs. your top competitor."

The comparison output should show:
- Both scores side by side in the terminal format
- A per-signal delta (e.g. `Schema: 45 → 80 (+35)`)
- A "competitive gap" priority actions list that only shows signals where site-b outperforms site-a

---

### 7. Express API wrapper

Add `src/server.js` — a lightweight Express server that wraps the audit as an HTTP API so the React/Vite frontend can call it directly without spawning child processes:

```
GET /audit?url=https://example.com&format=json
GET /audit?url=https://site-a.com&compare=https://site-b.com
```

- Use `express` (add to dependencies)
- Add a simple in-memory cache with a 15-minute TTL keyed on URL — audits are slow (2–5s) and clients shouldn't re-fetch on every render
- Add `GET /health` endpoint returning `{ status: 'ok', version: '1.0.0' }`
- Stream progress events via `GET /audit/stream?url=...` using Server-Sent Events (SSE) — emit one event per module as it completes so the UI can show a live progress bar
- Add `npm run serve` to `package.json`

---

### 8. llms.txt generator

If a site has no `llms.txt`, we should be able to generate a valid starter file for them. Add `src/generateLlmsTxt.js`:

- Takes the audit result JSON as input (specifically: `schema`, `content.headings`, `technical.canonical`, `technical.metaDescription`)
- Generates a valid `llms.txt` in spec format:
  - H1 from the page's H1 or `og:title`
  - Blockquote summary from `metaDescription` or first body paragraph
  - `## Docs` section linking to any sitemap URLs found
  - `## API` section (placeholder if no API schema detected)
  - `## Optional` section with any `sameAs` links from Organization schema
- Returns the file as a string
- Expose via CLI: `node src/audit.js https://example.com --generate-llms-txt > llms.txt`
- Expose via API: `GET /generate/llms-txt?url=https://example.com`

---

### 9. Test the full pipeline end-to-end

Write an integration test in `src/__tests__/audit.integration.test.js` using `node:test` that:

- Runs the full audit against `https://example.com` (a stable, simple site)
- Asserts the output JSON matches the expected shape (use `assert.deepEqual` on key paths)
- Asserts `aiVisibility.score` is a number between 0 and 100
- Asserts `priorityActions` is an array
- Asserts all five `sections` keys are present
- Mocks the network calls using a simple local HTTP server (`node:http`) that serves fixture files from `src/__tests__/fixtures/` — do not make real network calls in tests

Fixture files needed:
- `fixtures/robots.txt` — a realistic robots.txt blocking GPTBot and ClaudeBot
- `fixtures/llms.txt` — a valid llms.txt per spec
- `fixtures/index.html` — a realistic HTML page with FAQPage and Organization schema

---

---

### 10. Wire the engine into the scout-intake pipeline

This is the primary integration task. Refactor `src/audit.js` so that the core analysis is a pure exported function:

- Export `runAiSeoAudit({ websiteUrl, signal, logger })` per Section 0.1
- Output shape strictly per Section 0.2 — validate it with a small local assertion helper that mirrors the checks in [`features/scout-intake/skills/_output-contract.js`](../features/scout-intake/skills/_output-contract.js)
- The existing CLI entry (`audit.js` run as a script) must now be a thin wrapper that calls `runAiSeoAudit`, formats the result via the format flag, and prints it
- Map every internal scoring signal to a stable finding id per Section 0.3
- Emit a `gaps[]` entry for any missing-state rule the `seo-performance` card declares (see [`features/scout-intake/card-contract.js`](../features/scout-intake/card-contract.js) — the card has `pagespeed-performance-critical` and `pagespeed-seo-low`; when this engine has data relevant to them, emit `triggered: false` with evidence explaining why; otherwise skip)
- Compute `readiness` per the first-match-wins rule in Section 0.2: ANY critical finding OR any triggered gap → `'critical'`; otherwise `'partial'` if warnings/info; otherwise `'healthy'`
- Set `metadata` to `{ model: 'native', inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 }`

Then, in the parent repo (`Bballi_Portfolio`), edit [`features/scout-intake/runner.js`](../features/scout-intake/runner.js):

- Add a new stage after PSI resolves and before `runCardSkills`:
  ```js
  // ── [AI-SEO] AI/GEO visibility audit ────────────────────────────────
  let aiSeoAuditResult = null;
  if (process.env.AI_SEO_AUDIT_ENABLED !== '0') {
    try {
      await emitProgress('ai-seo', '[AI-SEO] Running AI visibility audit…');
      const mod = await import('../../ai-seo-audit/src/audit.js').catch(() => null);
      if (mod?.runAiSeoAudit) {
        aiSeoAuditResult = await withTimeout(
          mod.runAiSeoAudit({ websiteUrl }),
          'AI SEO audit',
          30_000,
        );
      }
    } catch (err) {
      warnings.push({ type: 'warning', code: 'ai_seo_audit_failed', message: `AI SEO audit failed: ${err.message}`, stage: 'ai-seo' });
    }
  }
  ```
- After `runCardSkills` produces `analyzerOutputs`, inject the AI audit result:
  ```js
  if (aiSeoAuditResult) {
    const card = analyzerOutputs['seo-performance'] ||= { skills: {}, aggregate: null };
    card.skills['ai-seo-audit'] = aiSeoAuditResult;
    card.aggregate = aggregateCardSkills(card.skills);   // re-aggregate including the new skill
  }
  ```
- Add `'ai-seo'` to the progress event taxonomy in [`docs/PIPELINE_CONTENT_INPUTS.md`](./PIPELINE_CONTENT_INPUTS.md) with prefix `[AI-SEO]`

**Acceptance:**
- On a real pipeline run with `AI_SEO_AUDIT_ENABLED=1`, `dashboard_state.analyzerOutputs['seo-performance'].skills['ai-seo-audit']` is populated with contract-valid output
- `dashboard_state.analyzerOutputs['seo-performance'].aggregate.findings` contains BOTH Lighthouse findings (from `seo-depth-audit`) AND AI visibility findings (from `ai-seo-audit`)
- With `AI_SEO_AUDIT_ENABLED=0` the pipeline behaves byte-for-byte identically to pre-integration
- A failure or timeout in the engine pushes a warning and the pipeline completes successfully

---

### 11. Solutions catalog entries for every AI finding

Append catalog entries to [`features/scout-intake/solutions-catalog.mjs`](../features/scout-intake/solutions-catalog.mjs) — one entry per stable finding id in Section 0.3. Each entry must carry the full catalog shape (see the existing entries like `missing-meta-description` for reference):

- `id` (matches the finding id from Section 0.3)
- `category: 'seo'` or `'ai-visibility'`
- `severity` (matches the finding's severity)
- `triggers: { ids: [...], citationIncludes: [...], labelIncludes: [...] }` with realistic substring hits
- `problem` — plain-language restatement of the problem (1 sentence, no jargon)
- `whyItMatters` — 2–4 sentences on consequence (specific, not generic)
- `diy.summary`, `diy.steps` (5–6 numbered steps), `diy.estimatedTime`, `diy.skillLevel`, `diy.helpfulLinks`
- `expertOffer.title`, `expertOffer.summary`, `expertOffer.turnaround`, `expertOffer.deliverable`, `expertOffer.cta` with `calendlyUrl('<finding-id>')`

Authored content, not LLM-boilerplate. Reuse the tone and structure of existing catalog entries — they're the template.

Must write entries for every id in Section 0.3, including the AI-bot-blocked variants (treat the three specific ones as distinct entries so each gets a tailored DIY). The `ai-bots-blocked-generic` entry can be a shorter "review your robots.txt" offer.

**Acceptance:**
- Open any SEO card modal where at least one AI finding fires. Every finding/gap in the PROBLEMS tab has a matching SOLUTIONS card (no generic fallbacks for known AI findings).
- Each DIY section has real, concrete, numbered steps — not "consult a professional."

---

### 12. Dashboard card visual augmentation

Augment the SEO card's front-facing visual to surface AI visibility at a glance.

**Data threading:**

- The pipeline's `aiSeoAuditResult.aiVisibility` block (per Section 0.4) needs to reach the dashboard as `seoAudit.aiVisibility`. Thread it through:
  - [`features/scout-intake/normalize.js`](../features/scout-intake/normalize.js) — merge `aiSeoAuditResult.aiVisibility` into the `seoAudit` object that gets written to Firestore under `dashboard_state.seoAudit`
  - [`api/_lib/run-lifecycle.cjs::buildDashboardProjection`](../api/_lib/run-lifecycle.cjs) — ensure the projection preserves `seoAudit.aiVisibility`

**Ring render:**

- Edit [`DashboardPage.jsx::renderSeoViz`](../DashboardPage.jsx) (currently defined at module scope, takes `seoAudit` as parameter). Add a 5th ring for "AI Visibility":
  ```jsx
  const aiViz = seoAudit?.aiVisibility;
  const scoreRings = [
    ['Performance',    sc.performance],
    ['SEO',            sc.seo],
    ['Accessibility',  sc.accessibility],
    ['Best Practices', sc.bestPractices],
    ...(aiViz?.score != null ? [['AI Visibility', aiViz.score]] : []),
  ].filter(([, v]) => v != null);
  ```
- The ring uses the same color thresholds as existing rings (≥90 success, ≥50 warning, else danger)

**DATA tab rows:**

- Find where the SEO card's DATA tab rows are built (check the card definition in the card map around line 2320–2380 of `DashboardPage.jsx`, and the row builders nearby)
- Append rows from `seoAudit.aiVisibility.sections` under a new section header "AI VISIBILITY":
  ```js
  { key: 'ai-sec', isHeader: true, label: 'AI VISIBILITY' },
  { key: 'ai-score', label: 'AI visibility score', value: `${aiViz.score}/100` },
  { key: 'ai-llms', label: 'llms.txt', value: `${aiViz.sections.llmsTxt.score}/100`, isFailing: aiViz.sections.llmsTxt.status === 'fail' },
  { key: 'ai-robots', label: 'AI bot access', value: `${aiViz.sections.robotsAi.score}/100`, isFailing: aiViz.sections.robotsAi.status === 'fail' },
  { key: 'ai-schema', label: 'Schema for AI', value: `${aiViz.sections.schema.score}/100`, isFailing: aiViz.sections.schema.status === 'fail' },
  { key: 'ai-content', label: 'AI extractability', value: `${aiViz.sections.content.score}/100`, isFailing: aiViz.sections.content.status === 'fail' },
  { key: 'ai-entity', label: 'Entity authority', value: `${aiViz.sections.entity.score}/100`, isFailing: aiViz.sections.entity.status === 'fail' },
  ```
- Add these only when `seoAudit?.aiVisibility` is present — don't render an empty section on thin data

**DOM ids:** every new row container gets a stable id following the existing pattern (e.g., `seo-performance-ai-visibility-section`, `seo-performance-ai-llms-row`).

**Acceptance:**
- Live pipeline run against a site lights up a fifth ring in the SEO card front showing the AI visibility score
- Clicking into the modal → DATA tab shows a new "AI VISIBILITY" section with per-metric rows
- PROBLEMS tab and SOLUTIONS tab already show AI findings/gaps automatically (via Task 10's aggregate wiring) — verify the copy reads grounded, not generic
- Non-SEO cards render unchanged

---

## Output expectations

After completing all tasks:

**Engine and pipeline integration:**

- `export { runAiSeoAudit }` from `ai-seo-audit/src/audit.js`
- Output validates against the scout-intake skill output contract
- With `AI_SEO_AUDIT_ENABLED=1` on a real pipeline run, `dashboard_state.analyzerOutputs['seo-performance'].skills['ai-seo-audit']` is populated and its findings appear in `aggregate.findings`
- With `AI_SEO_AUDIT_ENABLED=0`, pipeline behavior is byte-for-byte identical to before
- Every finding id from Section 0.3 has a full catalog entry in `features/scout-intake/solutions-catalog.mjs`
- Dashboard SEO card shows a 5th "AI Visibility" ring and a new "AI VISIBILITY" DATA-tab section
- PROBLEMS / SOLUTIONS tabs render AI findings and gaps with catalog-driven copy

**Standalone surfaces:**

- `npm test` must pass all unit and integration tests
- `node src/audit.js https://example.com --pretty` must output valid JSON
- `node src/audit.js https://example.com --format=summary` must output the terminal report
- `npm run serve` must start the Express server on port 3001 (with SSRF guard + rate limiting per task 7 caveat)
- `GAPS.md` must exist at the root of the ai-seo-audit project

Do not add any paid API dependencies. Keep the package footprint minimal — only add a dependency if it is clearly necessary and there is no reasonable stdlib alternative. When Playwright is optional, use `optionalDependencies` in package.json and guard the import with a runtime try/catch.
