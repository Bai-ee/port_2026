# SEO Card Skill Upgrade — Master Plan

Status: Source-of-truth · Planner-approved · Ready for implementation
Owner: Bryan Balli
Last updated: 2026-04-15
Parent workstream: [`SCOUT_ANALYZER_SKILLS_MASTERPLAN.md`](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/SCOUT_ANALYZER_SKILLS/SCOUT_ANALYZER_SKILLS_MASTERPLAN.md:1)

---

## 1. Objective

Make the **SEO + Performance** card on the free-tier dashboard produce real, diagnostic, prescriptive copy — grounded in live PageSpeed Insights data and an upgraded SEO audit prompt — while establishing a **per-card, multi-skill architecture** that future cards (Brand Identity, Style Guide, Competitors, etc.) will plug into without touching Scribe or the runner again.

Each card is a **module**: declares its own sources, its own skills (1 or more), and its own aggregation rules. Scribe sees one normalized blob per card. Skills are independent, pure prompts.

## 2. Current state (verified 2026-04-15)

### What exists

- Pipeline skill runner at [`features/scout-intake/skills/_runner.js`](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/skills/_runner.js:1) — loads `.md` skills, validates inputs, calls Anthropic with `tool_use`, validates output against `_output-contract.js`. Solid.
- Registry at [`features/scout-intake/skills/_registry.js`](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/skills/_registry.js:1).
- One skill wired: [`features/scout-intake/skills/seo-depth-audit.md`](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/skills/seo-depth-audit.md:1) — thin prompt.
- PSI source module at [`features/intelligence/pagespeed.js`](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/intelligence/pagespeed.js:1) — mature, returns SourceRecord with `facts.scores / coreWebVitals / opportunities / seoRedFlags / insights / diagnostics / thirdParties`. Env key: `PAGESPEED_API_KEY`.
- Card contract field: `card.analyzerSkill` (single skill id, nullable).
- Stage-8 fan-out at [`features/scout-intake/runner.js:474-513`](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/runner.js:474) — gated on `SCOUT_ANALYZER_SKILLS_ENABLED=1`.
- External SEO intelligence reference: [`.claude/skills/seo/`](/Users/bballi/Documents/Repos/Bballi_Portfolio/.claude/skills/seo/) (Claude Code plugin). Used as a **prompt-content source**, not a runtime dependency.

### Gaps this plan closes

| Gap | Fix |
|---|---|
| `runner.js:408` sets `pagespeed: null` — PSI never feeds the skill | Phase 1: call `pagespeed.fetch()` and thread the result into `sourcePayloads` |
| `seo-depth-audit.md` prompt is minimal | Phase 2: rewrite using rubrics from `.claude/skills/seo/skills/seo-{technical,content,geo,schema}/SKILL.md` |
| `card.analyzerSkill` is single-valued — can't attach multiple skills per card | Phase 3: add `analyzerSkills: string[]` + aggregator |
| Scribe never reads `analyzerOutputs` — skill output is dead weight today | Phase 4: Scribe consumes aggregated per-card blob; add `recommendation` field |
| No per-run proof the SEO card is using real data | Phase 5: E2E verification against a known site + Data Map check |

## 3. Architectural decisions

### D1 — Card module shape

Each card in `card-contract.js` may declare:

```js
{
  id: 'seo-performance',
  analyzerSkills: ['seo-depth-audit'],   // NEW — array, 1+ entries
  analyzerSkill: 'seo-depth-audit',       // LEGACY — kept for back-compat, auto-promoted to array
  // ...rest of contract unchanged
}
```

When both are present, `analyzerSkills` wins. When only the legacy field is present, the runner treats it as `[analyzerSkill]`. No card has to change to start — only cards we actively upgrade.

### D2 — Skill output persistence shape

`analyzerOutputs[cardId]` was `SkillOutput`. Becomes:

```js
analyzerOutputs[cardId] = {
  skills: {
    [skillId]: SkillOutput,   // per-skill, full contract
  },
  aggregate: {
    findings:   Finding[],    // merged across skills, deduped by id, capped at 8
    gaps:       Gap[],        // unioned across skills (same ruleId merged — triggered wins)
    readiness:  'healthy' | 'partial' | 'critical',  // worst across skills
    highlights: string[],     // concatenated, deduped, capped at 5
    recommendation: string | null,  // set by aggregator or a dedicated recommendation step in P4
  },
}
```

Back-compat: `buildDashboardProjection` and the Data Map admin UI must accept both old (flat `SkillOutput`) and new (nested) shapes during the rollout. After P5 lands, old callers should only see the new shape.

### D3 — Aggregator is a pure function

New file: `features/scout-intake/skills/_aggregator.js`. Signature:

```js
aggregateCardSkills(skillsById) → { findings, gaps, readiness, highlights, recommendation }
```

No LLM call in the aggregator (Phase 3). Phase 4 may optionally add a tiny Haiku call to synthesize `recommendation` from aggregated findings + `userContext` — decide during P4, not now.

### D4 — PSI feed shape into skills

The skill's front matter declares `inputs: [intel.pagespeed, site.meta, site.html]`. The skill prompt cites `intel.pagespeed.scores.performance = 42`. So the runner must feed the **flat `seoAudit` shape** (not the SourceRecord wrapper) under `intel.pagespeed`.

Runner-side transform: `sourcePayloads['intel.pagespeed'] = pagespeedSourceRecord.facts`. Keep the full SourceRecord on `runtimeMeta.pagespeed` so the Data Map can still show provider/duration/error/etc.

### D5 — Feature flag stays

`SCOUT_ANALYZER_SKILLS_ENABLED=1` continues to gate all skill fan-out. When unset: legacy path byte-for-byte.

Add a second flag for PSI: `PAGESPEED_ENABLED=1` (default: **on** when `PAGESPEED_API_KEY` is present, **off** otherwise). Lets us disable PSI without touching code if quotas blow up.

## 4. Phases

Phase boundaries are hard stops. Implementer reports and waits for approval between phases.

### Phase 1 — Wire PSI into the pipeline

**Why first:** the existing SEO skill declares `intel.pagespeed` as an input but currently receives `null`. Every downstream improvement is gated on real PSI data arriving.

**Changes:**

1. `features/scout-intake/runner.js`
   - Add a new stage after style guide resolves, before analyzers run:
     - Emit progress: `[PSI] Running PageSpeed audit…`
     - Call `pagespeed.fetch({ websiteUrl })` wrapped in `withTimeout(..., 'PageSpeed audit', 90_000)`.
     - Non-fatal: on error/timeout, persist an error `pagespeed` source with structured diagnostics and push warning code `pagespeed_failed_*`.
     - Guard on `PAGESPEED_ENABLED` + `PAGESPEED_API_KEY` — warn and skip if either missing.
   - Replace `pagespeed: null` at [`runner.js:408`](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/runner.js:408) with the live SourceRecord.
2. `features/scout-intake/skills/_runner.js::buildSourcePayloads`
   - When `pagespeed` is a full SourceRecord, unwrap `pagespeed.facts` into `sourcePayloads['intel.pagespeed']` so the skill prompt's citations remain stable.
   - Tolerate both shapes (flat seoAudit OR full SourceRecord) to keep the unit tests simple.
3. Progress event taxonomy: add `pagespeed` stage to the terminal event list in [`docs/PIPELINE_CONTENT_INPUTS.md`](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/PIPELINE_CONTENT_INPUTS.md:1) (prefix `[PSI]`, class `term-ai`).

**Acceptance:**
- With `PAGESPEED_API_KEY` set, a real pipeline run produces `sharedResults.pagespeed` with live scores and `intel.pagespeed.scores` visible in the skill prompt logs.
- With the key unset, the pipeline logs a warning, pushes `pagespeed_skipped_*`, and still completes.
- Byte-for-byte identical behavior when `PAGESPEED_ENABLED=0`.

### Phase 2 — Upgrade the SEO skill prompt

**Why:** thin prompt → thin findings. The `.claude/skills/seo/skills/` folder is a well-curated SEO knowledge base. Port its reasoning into our inline skill without pulling in any of its Python/CLI machinery.

**Changes:**

1. Rewrite [`features/scout-intake/skills/seo-depth-audit.md`](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/skills/seo-depth-audit.md:1):
   - Keep front matter (inputs/output contract/model/maxTokens) unchanged.
   - Replace the prompt body with a structured audit that covers:
     - **Technical SEO** — robots/sitemap hints from `site.html` + crawlability audits from `intel.pagespeed.seoRedFlags`.
     - **Core Web Vitals** — LCP <2.5s, INP <200ms, CLS <0.1 thresholds. Cite `intel.pagespeed.coreWebVitals` field or lab fallback.
     - **On-page signals** — `site.meta.title`, `site.meta.description`, OG tags, canonical, favicon.
     - **Content depth** — `site.html.pages[].bodyParagraphs` thinness, heading hierarchy from `h1`/`h2`.
     - **E-E-A-T gaps** — missing contact/about, no author, no trust signals (from `site.html.pages[].contactClues`).
     - **GEO / AI search readiness** — schema presence inferred from `site.html` regex, structured data gaps.
     - **Opportunity prioritization** — rank by `intel.pagespeed.opportunities[].savingsMs`.
   - Keep `max 5 critical findings` cap. Tighten grounding rules.
   - Bump `maxTokens` to 3072 if needed (model stays Haiku 4.5).
2. Source rubrics (do not copy verbatim — use as prompt-writing reference):
   - [`.claude/skills/seo/skills/seo-technical/SKILL.md`](/Users/bballi/Documents/Repos/Bballi_Portfolio/.claude/skills/seo/skills/seo-technical/SKILL.md:1)
   - [`.claude/skills/seo/skills/seo-content/SKILL.md`](/Users/bballi/Documents/Repos/Bballi_Portfolio/.claude/skills/seo/skills/seo-content/SKILL.md:1)
   - [`.claude/skills/seo/skills/seo-geo/SKILL.md`](/Users/bballi/Documents/Repos/Bballi_Portfolio/.claude/skills/seo/skills/seo-geo/SKILL.md:1)
   - [`.claude/skills/seo/skills/seo-schema/SKILL.md`](/Users/bballi/Documents/Repos/Bballi_Portfolio/.claude/skills/seo/skills/seo-schema/SKILL.md:1)

**Acceptance:**
- A run against a site with a known SEO issue (e.g. missing meta description, failing LCP) surfaces that issue as a `critical` finding with a correct citation (`citation: "intel.pagespeed.seoRedFlags[0].id = 'meta-description'"`).
- Output still validates against [`_output-contract.js`](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/skills/_output-contract.js:1).
- Cost per run stays under $0.015.

### Phase 3 — Multi-skill card architecture + aggregator

**Why:** user's stated goal — each card is a pluggable module that can take 1+ skills without touching Scribe.

**Changes:**

1. `features/scout-intake/card-contract.js`
   - Add `analyzerSkills: string[]` alongside existing `analyzerSkill: string | null`.
   - Add helper: `getSkillIdsForCard(card) → string[]` — promotes the legacy field into an array.
2. `features/scout-intake/skills/_runner.js::runCardSkills`
   - For each card, collect all skill ids via the helper.
   - Run all skills for that card in parallel via `Promise.allSettled`.
   - Populate the new shape: `analyzerOutputs[cardId] = { skills: {...}, aggregate: {...} }`.
3. New file: `features/scout-intake/skills/_aggregator.js`
   - Pure function `aggregateCardSkills(skillsById) → aggregate`.
   - Rules:
     - Findings: merge all, dedupe by `id`, sort by severity (critical → warning → info), cap at 8.
     - Gaps: union by `ruleId`, `triggered: true` wins.
     - Readiness: worst-of (critical > partial > healthy).
     - Highlights: concat, dedupe (case-insensitive), cap at 5.
     - Recommendation: leave `null` in P3 (P4 will fill it).
4. `features/scout-intake/normalize.js`
   - Accept the new `analyzerOutputs` shape. Keep reading the legacy shape as a fallback (one-release transition).
5. Downstream readers that touch `analyzerOutputs` (check Data Map API at `app/api/admin/scout-card-copy/route.js` + `app/preview/scout-config/page.jsx`): prefer `outputs[cardId].aggregate` when present; fall back to the old flat shape.

**Acceptance:**
- A card declaring a single skill produces identical aggregated findings/gaps/readiness/highlights as before (no behavior change on single-skill cards).
- A card declaring two skills (use a throwaway test skill for proof) produces a correctly merged aggregate.
- Data Map admin UI renders correctly for both single-skill and multi-skill cards.

### Phase 4 — Scribe consumes `analyzerOutputs`

**Why:** this is P5 in the parent masterplan — the last mile. Without it, every upstream improvement is invisible to the user.

**Changes:**

1. `features/scout-intake/scribe.js`
   - `buildCardDigest`: for each card, when `analyzerOutputs[cardId].aggregate` exists, use it as the signal source and mark `confidence` based on `readiness` (`healthy → high`, `partial → medium`, `critical → high` because we have findings). When not present, fall back to `analyzerResults.byCard[cardId]` (legacy).
   - Pass `highlights`, top 3 `findings`, and `gaps` (triggered only) into the per-card signal block.
   - Add a new tool output field per card: `recommendation: string` (one sentence, actionable, tuned to `userContext.priority` + `outputExpectation`).
   - Prompt additions: short block explaining when to write a `recommendation` vs leave it empty; explicit rule that recommendations must cite a finding or gap.
2. `features/scout-intake/normalize.js`
   - Thread `scribe.cards[cardId].recommendation` into the normalized result under `scribe.cards`.
3. `DashboardPage.jsx` SEO + Performance card
   - Render `recommendation` as a footnote or CTA line on the expanded view. Give the container a stable id: `id="seo-performance-recommendation"`.
4. Static copy fallback at [`card-static-copy.js`](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/card-static-copy.js:1): no change required (recommendation is additive).

**Acceptance:**
- Dashboard SEO card, on a real run, shows:
  - `short`: 1-sentence diagnosis mentioning a specific score or red flag.
  - `expanded`: 2-4 sentences synthesizing findings.
  - `recommendation`: 1 actionable sentence citing a finding.
- Copy is reproducibly different between a "healthy" site and a "critical" site.
- Scribe cost stays under $0.02 per run.

### Phase 5 — End-to-end verification + docs

**Changes:**

1. Run the full pipeline against:
   - A healthy site (e.g. `https://anthropic.com`)
   - A site with known SEO issues (pick a small-business local site from fixtures, or spin up a local test page with missing meta/alt/canonical).
2. Verify:
   - PSI SourceRecord persisted correctly.
   - `analyzerOutputs['seo-performance'].skills['seo-depth-audit']` present with structured findings.
   - `analyzerOutputs['seo-performance'].aggregate` correctly merged.
   - `scribe.cards['seo-performance'].{short, expanded, recommendation}` reads as expected on the admin Data Map.
   - Terminal events stream shows `[PSI]` and `[SKILL]` progress.
3. Update [`docs/PIPELINE_CONTENT_INPUTS.md`](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/PIPELINE_CONTENT_INPUTS.md:1):
   - Add PSI stage between style guide and analyzers.
   - Update the skill library table to show per-card multi-skill support.
   - Document the new `analyzerOutputs` nested shape.

**Acceptance:**
- Admin Data Map (/preview/scout-config) shows live scribe copy for SEO card grounded in real PSI findings — reviewed manually by Bryan.
- No regressions on the other 37 cards (spot-check: Brief, Intake Terminal, Brand Tone, Draft Post).
- `PIPELINE_CONTENT_INPUTS.md` reflects the shipped state.

## 5. Files touched (summary)

| Phase | File | Verb |
|---|---|---|
| 1 | `features/scout-intake/runner.js` | edit |
| 1 | `features/scout-intake/skills/_runner.js` | edit |
| 1 | `docs/PIPELINE_CONTENT_INPUTS.md` | edit (P5 finalizes) |
| 2 | `features/scout-intake/skills/seo-depth-audit.md` | rewrite prompt body |
| 3 | `features/scout-intake/card-contract.js` | edit (additive field + helper) |
| 3 | `features/scout-intake/skills/_runner.js` | edit |
| 3 | `features/scout-intake/skills/_aggregator.js` | create |
| 3 | `features/scout-intake/normalize.js` | edit |
| 3 | `app/api/admin/scout-card-copy/route.js` | edit (shape tolerance) |
| 3 | `app/preview/scout-config/page.jsx` | edit (shape tolerance) |
| 4 | `features/scout-intake/scribe.js` | edit |
| 4 | `features/scout-intake/normalize.js` | edit |
| 4 | `DashboardPage.jsx` | edit (SEO card only) |
| 5 | `docs/PIPELINE_CONTENT_INPUTS.md` | finalize |

## 6. Non-goals

- **Not** adding GEO / schema / backlinks as additional skills now. The architecture supports it (Phase 3 deliverable) but only `seo-depth-audit` ships in this workstream. Follow-up tickets.
- **Not** porting the Python-backed `.claude/skills/seo` scripts into the pipeline. Those require a Claude Code interactive session.
- **Not** touching paid-tier cards. Free tier only.
- **Not** refactoring the legacy `analyzers.js`. It stays as fallback. Retiring it is a separate decision.
- **Not** changing the Scribe model from Haiku 4.5.

## 7. Risks

| Risk | Mitigation |
|---|---|
| PSI quota exhausted | `PAGESPEED_ENABLED=0` kill switch; non-fatal failure path |
| Skill prompt regression drops quality | Keep legacy prompt as a comment block in the `.md` for one release; A/B against fixtures before flip |
| Scribe tool schema change breaks callers | Additive only — `recommendation` is a new optional field |
| Multi-skill aggregator produces contradictory findings | Aggregator rules are deterministic; dedupe by `id`; P3 acceptance test covers two-skill case |
| `analyzerOutputs` shape change breaks Data Map | P3 changes are back-compat readers; old runs render correctly |

## 8. Rollout

- **Dev:** implement against local `.env.local` with `PAGESPEED_API_KEY` set, `SCOUT_ANALYZER_SKILLS_ENABLED=1`.
- **Staging / prod:** ship each phase behind the existing flag. Manual verification on one real client after each phase before the next one starts.
- **No DB migrations** — `analyzerOutputs` is already a free-form object in Firestore.

## 9. Approval checkpoints

Implementer must pause after each phase:

- After P1 → Bryan verifies real PSI scores land in a run.
- After P2 → Bryan reviews a sample skill output on a known site.
- After P3 → Bryan confirms Data Map admin UI still renders correctly.
- After P4 → Bryan reviews live Scribe copy on the SEO card.
- After P5 → Workstream closed.
