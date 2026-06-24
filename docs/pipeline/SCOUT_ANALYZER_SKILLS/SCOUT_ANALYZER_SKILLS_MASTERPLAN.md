# Scout Analyzer Skills — Master Plan

Status: Source-of-truth · Phase 1 complete (manual acceptance pending) · P2 next
Owner: Bryan Balli
Last updated: 2026-04-15 (amended — see §13)

This is the canonical plan for introducing per-card analyzer skills between
the Scout data pipeline and the Scribe writer. It is the document every
implementer (human or Sonnet) reads before touching code on this workstream.

---

## 1. Objective

Insert a pluggable **analyzer skill step** between the Scout pipeline's raw
sources and the Scribe writer.

Current flow:

```
sources  →  Scribe  →  {short, expanded}
```

Target flow:

```
sources  →  [per-card analyzer skill (.md prompt)]  →  structured findings  →  Scribe  →  {short, expanded, recommendation}
```

Each card on the dashboard can optionally attach a specialized analyzer
skill (an `.md` prompt file) that reasons over the card's raw source data
and returns structured findings. Scribe then consumes those findings
instead of raw signals, producing copy that is diagnostic and
prescriptive — including concrete service offers when gap rules trigger.

Skill attachment is configurable per client from the admin Data Map UI so
skill choice is reviewable without code changes.

## 2. Current State (verified 2026-04-15)

### What exists today

- Card contract at [features/scout-intake/card-contract.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/card-contract.js:1)
  with 38 cards, each declaring `sources[]`, `missingStateRules[]`,
  `actionClass`, `copy.short`, `copy.expanded`, and `analyzer.impl`.
- Source inventory at [features/scout-intake/source-inventory.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/source-inventory.js:1)
  with 14 sources (site.html, site.meta, synth.intake, synth.styleGuide,
  intel.pagespeed, scout.reddit, scout.weather, scout.reviews, scoutConfig.*,
  userContext) — each declaring collection method, auth, cost, payload fields.
- Static dashboard copy at [features/scout-intake/card-static-copy.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/card-static-copy.js:1).
- Scribe at [features/scout-intake/scribe.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/scribe.js:1)
  — Haiku call, reads analyzer signals + userContext, emits
  `{ cards: { [cardId]: { short, expanded } }, brief: {...} }`.
- Existing analyzer implementations: `passthrough`, `pagespeed`,
  `design-system-extractor`, `runtime`. Live in
  [features/scout-intake/analyzers/](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/analyzers/).
- Admin Data Map at [app/preview/scout-config/page.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/preview/scout-config/page.jsx:1)
  renders every card with sources, rules, scribe copy, static copy, and
  per-row notes. Notes persist to [docs/scout-data-map.notes.json](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/scout-data-map.notes.json:1).
- External scouts (Reddit/weather/reviews) exist at
  [features/scout-intake/external-scouts.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/external-scouts.js:1)
  and are callable from [app/api/dashboard/scout-run/route.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/dashboard/scout-run/route.js:1)
  but not yet wired into runner.js (Phase E, out of scope for this plan).

### What does NOT exist (this plan delivers these)

- A way to author per-card analysis prompts as version-controlled `.md` files.
- A skill runner that loads a skill, validates inputs, calls Claude with
  tool_use, and returns a typed output.
- A per-client override store for skill attachments.
- A UI surface on the Data Map to attach/view/test-fire skills.
- A Scribe extension that consumes analyzer output as a richer evidence block.

## 3. Architectural Decisions

### D1 — Skills are .md files in the repo

Not Claude Code skills (those are CLI-scoped). These are
pipeline-runtime prompts loaded at call time.

Directory structure:

```
features/scout-intake/skills/
├── _runner.js              # shared loader + caller + validator
├── _output-contract.js     # standard output shape
├── _registry.js            # enumerates available skills
├── seo-depth-audit.md
├── brand-asset-gap.md
├── visual-consistency.md
├── conversion-audit.md
├── competitor-framing.md
├── content-opportunity-rank.md
└── priority-synthesis.md
```

### D2 — Skill file format

YAML front matter + prompt body.

```markdown
---
id: seo-depth-audit
name: SEO Depth Audit
version: 1
model: claude-haiku-4-5-20251001
maxTokens: 2048
inputs:
  - intel.pagespeed
  - site.meta
  - site.html
output:
  tool: write_seo_depth_audit
  schemaRef: seo-depth-audit-v1
costEstimate: "$0.003–$0.008"
groundingRules:
  - "Cite the source field that triggered every finding."
  - "Do not infer scores; copy verbatim from intel.pagespeed.scores."
  - "Max 5 critical findings."
---

You are an SEO auditor. You receive three source payloads and produce a
structured audit to be consumed by the downstream Scribe writer.

## Source data
{{inputs}}

## Card guidance
Card: SEO + Performance
Action class: diagnose
Missing-state rules:
{{missingStateRules}}

## Task
Return a tool_use call to `write_seo_depth_audit` with the standard output
shape. Do not produce prose outside the tool call.
```

Variable substitution is deterministic: `{{inputs}}` resolves to the card's
`sources[]` payloads; `{{missingStateRules}}` resolves to the card's
declarative rules. No hidden magic.

### D3 — Standard output contract

Every skill returns the same shape so Scribe consumption is uniform:

```ts
{
  skillId: string,
  skillVersion: number,
  runAt: ISO string,
  findings: [
    {
      id: string,               // stable per-finding id
      severity: 'critical' | 'warning' | 'info',
      label: string,            // 1-line headline
      detail: string,           // 1–2 sentences of evidence
      citation: string,         // source field that triggered it, e.g. "intel.pagespeed.scores.performance = 42"
    }
  ],
  gaps: [
    {
      ruleId: string,           // matches card.missingStateRules[].id
      triggered: boolean,
      evidence: string,
    }
  ],
  readiness: 'healthy' | 'partial' | 'critical',
  highlights: string[],         // 1-3 short phrases Scribe can reuse verbatim
  metadata: {
    model: string,
    inputTokens: number,
    outputTokens: number,
    estimatedCostUsd: number,
  }
}
```

The runner validates this shape before returning. Invalid output is treated
as skill failure and the card falls back to existing analyzer signals.

### D4 — Per-card skill attachment: two layers

**Layer 1 — contract default** (version-controlled):

```js
// card-contract.js
{
  id: 'seo-performance',
  analyzer: { impl: 'pagespeed', required: false },
  analyzerSkill: 'seo-depth-audit',   // ← new field
  ...
}
```

**Layer 2 — per-client override** (Firestore, editable from Data Map UI):

```
clients/{clientId}/scoutSkills/{cardId} = {
  skillId: string | null,
  enabled: boolean,
  overrideReason: string | null,
  updatedAt: timestamp,
  updatedBy: email,
}
```

Precedence at runtime: per-client override → contract default → no skill
(skip analyzer step, fall through to existing behavior).

### D5 — Execution order per card during pipeline run

1. `analyzer.impl` runs (existing: passthrough / pagespeed /
   design-system-extractor).
2. Resolve skill for this card: check per-client override, fall back to
   contract default. If none, skip steps 3–4.
3. Skill runs via `_runner.js` with inputs = resolved source payloads.
   Skill output is validated against the standard contract.
4. Skill output is stored at `dashboard_state.analyzerOutputs[cardId]`.
5. Scribe reads analyzer output when present, else falls back to
   analyzer-impl output.

Analyzer failures are non-fatal: warn, don't block the pipeline. Card falls
back to analyzer.impl signals.

### D6 — Scribe consumption changes

Scribe prompt extension (phase P5):

- When `analyzerOutput` exists for a card, it becomes the primary evidence
  block instead of raw analyzer signals.
- Scribe output per card changes from `{ short, expanded }` to
  `{ short, expanded, recommendation }`.
- `actionClass` governs framing of `recommendation`:
  - `describe` → skip recommendation (empty string)
  - `diagnose` → triage language citing findings
  - `recommend` → concrete next step
  - `service-offer` → prescriptive service scope

Backwards compatibility: cards without a skill attached receive
`recommendation: ''` and render identically to today.

## 4. File Inventory

New files created by this plan:

| File | Purpose | Introduced in phase |
|---|---|---|
| `features/scout-intake/skills/_runner.js` | Load skill, substitute inputs, call Claude, validate output | P1 |
| `features/scout-intake/skills/_output-contract.js` | Standard output shape + validator | P1 |
| `features/scout-intake/skills/_registry.js` | Enumerate available skills | P1 |
| `features/scout-intake/skills/seo-depth-audit.md` | First reference skill | P1 |
| `features/scout-intake/skills/__tests__/` | Runner + validator unit tests | P1 |
| `features/scout-intake/scout-skills-store.js` | Per-client override CRUD | P2 |
| `app/api/admin/scout-skill-attach/route.js` | Admin GET/POST/DELETE for overrides | P2 |
| `app/api/admin/scout-skill-run/route.js` | Admin test-fire endpoint | P4 |
| `app/api/admin/scout-skill-prompt/route.js` | Admin endpoint returning a skill's rendered prompt | P3 |
| `features/scout-intake/skills/intake-inventory.md` | Data-inventory + upgrade-pitch skill for `intake-terminal` (see §13 A1) | P6 (priority 1) |
| `features/scout-intake/skills/brand-asset-gap.md` | Second skill | P6 |
| `features/scout-intake/skills/visual-consistency.md` | Third skill | P6 |
| `features/scout-intake/skills/conversion-audit.md` | Fourth skill | P6 |
| `features/scout-intake/skills/competitor-framing.md` | Fifth skill | P6 |
| `features/scout-intake/skills/content-opportunity-rank.md` | Sixth skill | P6 |
| `features/scout-intake/skills/priority-synthesis.md` | Seventh skill | P6 |
| `features/scout-intake/brief-aggregator.js` | Post-Scribe brand-quality synthesis for `brief.homeSummary` (see §13 A2) | P7 |

Existing files edited:

| File | Change | Phase |
|---|---|---|
| `features/scout-intake/card-contract.js` | Add `analyzerSkill: string \| null` field per card | P1 (schema only), P6 (wire to remaining cards) |
| `features/scout-intake/runner.js` | Insert skill run step after analyzer.impl, persist output | P1 |
| `features/scout-intake/scribe.js` | Consume `analyzerOutput`, add `recommendation` field | P5 |
| `features/scout-intake/normalize.js` | Thread `analyzerOutputs` through to dashboard_state | P1 |
| `app/preview/scout-config/page.jsx` | Analyzer block per card row: skill picker, .md viewer, findings display | P3 |
| `app/api/admin/scout-card-copy/route.js` | Include `analyzerOutput` per card in response | P3 |

## 5. Phases

Each phase is a stop-for-approval checkpoint. Nothing in phase N+1 starts
until phase N is merged and acceptance-tested.

### P1 — Skill infrastructure + first skill wired

**Deliverables**
- `_runner.js`, `_output-contract.js`, `_registry.js` functional.
- `seo-depth-audit.md` authored and passes contract validation.
- `card-contract.js` adds optional `analyzerSkill` field; `seo-performance` set to `seo-depth-audit`.
- `runner.js` inserts skill step behind env flag `SCOUT_ANALYZER_SKILLS_ENABLED=1`.
  Skill failure is non-fatal; warnings only.
- `normalize.js` threads `analyzerOutputs` through; stored at
  `dashboard_state.analyzerOutputs[cardId]`.
- Unit tests: runner validates output contract, rejects malformed skill files.

**Acceptance**
- Pipeline run with flag ON against the Critters client produces a valid
  `analyzerOutputs['seo-performance']` record in Firestore.
- Pipeline run with flag OFF behaves identically to pre-P1 baseline.
- Failure of the skill (simulated) does not fail the pipeline run; warning recorded.

**Out of scope**
- Scribe does NOT yet read `analyzerOutput`. The new data sits unused until P5.
- No UI changes.

### P2 — Per-client override store

**Deliverables**
- `scout-skills-store.js` with `getSkillOverrides(clientId)`,
  `setSkillOverride(clientId, cardId, payload)`, `clearSkillOverride(clientId, cardId)`.
- `app/api/admin/scout-skill-attach/route.js` admin-gated GET/POST/DELETE.
- Runner consults overrides; precedence: override → contract → none.

**Acceptance**
- Setting an override via API changes the skill used on the next pipeline run.
- Clearing an override restores contract default behavior.

### P3 — Data Map UI: Analyzer block per card

**Deliverables**
- New "Analyzer" block inside each card row in Data Map tab.
- Skill picker dropdown populated from `_registry.js`.
- `[View prompt]` button opens modal with the skill's front matter + rendered prompt.
- `[Change skill ▼]` writes through to `scout-skill-attach`.
- Display of last `analyzerOutput.findings[]` with severity chips.
- 📝 note buttons on: analyzer block, each finding, skill choice.
- `scout-card-copy` endpoint extended to return `analyzerOutput` per card.

**Acceptance**
- Admin can change a card's skill from the UI and see the change reflected
  after the next pipeline run.
- Skill prompt is readable inline without opening the repo.
- Findings appear with severity coloring.

### P4 — Test-fire from UI

**Deliverables**
- `app/api/admin/scout-skill-run/route.js` endpoint: runs a single skill
  against the client's current live data, writes to
  `analyzerOutputs[cardId]`, does not run the full pipeline.
- "Run analyzer now" button per card.

**Acceptance**
- Admin can iterate on a skill `.md` file, test-fire it on a real client's
  data, and read the fresh findings in the UI without a pipeline rerun.
- Cost per test fire is capped by the skill's `costEstimate` upper bound.

### P5 — Scribe consumption

**Deliverables**
- Scribe prompt and tool schema extended to accept `analyzerOutput` as
  primary evidence.
- Output per card becomes `{ short, expanded, recommendation }`.
- `actionClass` governs `recommendation` framing.
- Dashboard render updated to show `recommendation` (modal or secondary block).

**Acceptance**
- Cards with a skill attached produce recommendation text grounded in
  findings (no hallucinated offers).
- Cards without a skill produce identical output to pre-P5 behavior
  (empty `recommendation`).

### P6 — Skill library expansion

**Deliverables (author in this order — intake-inventory is now priority 1 per §13 A1)**
1. `intake-inventory.md` → `intake-terminal` (reclassifies card — see §13 A1)
2. `brand-asset-gap.md` → `brand-identity-design`
3. `visual-consistency.md` → `style-guide`
4. `conversion-audit.md` → `website-landing`
5. `competitor-framing.md` → `competitor-info`
6. `content-opportunity-rank.md` → `content-opportunities`
7. `priority-synthesis.md` → `priority-signal`

Each skill = one `.md` file + one `analyzerSkill` line in `card-contract.js`.
The `intake-inventory` step additionally reshapes the `intake-terminal`
card contract — see §13 A1 for the full schema change.

**Acceptance**
- Each new skill passes the contract validator.
- Each new skill runs successfully against at least one real client.
- Cost per full pipeline run remains under the agreed cap (see §7).

### P7 — Brief Aggregator (post-Scribe synthesis)

Added per §13 A2. `brief` is explicitly NOT an analyzer-skill card — its
role is to aggregate other cards' already-generated Scribe copy +
analyzer findings into a single home-page summary paragraph.

**Deliverables**
- `features/scout-intake/brief-aggregator.js` — pure function that reads
  all `scribeCards[]`, `analyzerOutputs[]`, and `missingStateRules`
  results, and emits a compact brand-quality summary.
- One Haiku call (budget ~$0.002) to write the single-paragraph
  synthesis. The call receives a structured digest of per-card findings —
  it does NOT re-read raw sources.
- Output slot: `dashboard_state.brief.homeSummary` (new field).
- Runner integration: runs AFTER Scribe, BEFORE `brief` card is
  persisted. `brief` card's `short` + `expanded` fields continue to come
  from Scribe; `homeSummary` is the aggregator's exclusive output.

**Acceptance**
- Running the pipeline produces a `homeSummary` that cites which cards
  contributed findings (e.g. "Brand has healthy brand tone signals,
  partial SEO depth, and missing social preview assets…").
- The aggregator never calls any analyzer skill. It never re-reads
  `site.html`, `intel.pagespeed`, or other source payloads directly —
  only Scribe outputs + findings.
- `brief` card's `analyzerSkill` remains `null` (enforced by contract
  test).

**Out of scope**
- Changing `brief` card's render (`short`/`expanded`) behavior. Scribe
  continues to write those.
- Aggregating into anything other than `homeSummary`.

## 6. Keep vs Change

**Keep**:
- All existing card ids, analyzer impls, source inventory, Scribe core loop.
- The existing runner stages up to analyzer fan-out.
- The admin Data Map tab, notes system, and live-copy block.

**Additive**:
- `analyzerSkill` field on contract.
- New `skills/` directory.
- New override store + endpoints.
- New UI block.

**Changed later (P5 only)**:
- Scribe output shape — adds `recommendation`. Gated behind presence of
  `analyzerOutput` so cards without a skill are unaffected.

## 7. Risk Register

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R1 | Cost drift as skills are added to every card | High | Per-skill `costEstimate` in front matter; hard per-run cap in runner (fail-fast if sum exceeds budget); default to Haiku; opt-in per card via contract |
| R2 | Skill prompts drift from source-inventory shape | Medium | Runner validates `inputs: [source-ids]` in front matter against `source-inventory.js` at load time; missing source id is a fast failure |
| R3 | Scribe coupling breaks on output contract change | Medium | Standard output shape enforced by `_output-contract.js` validator; Scribe reads via typed accessor only |
| R4 | Per-client overrides create invisible behavior divergence | Medium | Data Map UI surfaces override state prominently with `(override)` badge; audit log field on override doc |
| R5 | Skill failure cascades into pipeline failure | High | Skill calls wrapped in `Promise.allSettled`-style non-fatal; warnings recorded; card falls back to analyzer-impl signals |
| R6 | Admin UI becomes overcrowded with per-card controls | Low | Analyzer block is collapsed by default; expand on demand |
| R7 | Regeneration infinite loop if skill consumes its own output | Low | Runner does not feed `analyzerOutput` back into skill inputs; sources resolve only from source-inventory |

## 8. Operational Boundaries

Use an analyzer skill when the card needs specialized reasoning beyond
descriptive summarization. Good candidates:

- SEO audit (score interpretation, critical issue triage)
- Visual consistency (brand cohesion across live styles)
- Conversion audit (CTA hierarchy, landing page heuristics)
- Competitor framing (positioning gap analysis)

Do NOT add an analyzer skill when:

- The card only needs to echo data verbatim (use `passthrough`).
- The data already arrives structured and actionable (e.g. pagespeed
  scores can be read directly).
- The task is pure copy generation with no reasoning (that's Scribe's job).

## 9. Feature Flag

Runtime flag: `SCOUT_ANALYZER_SKILLS_ENABLED` (env var, defaulting to
unset = off). Read in `runner.js`. When unset, skills are skipped entirely
and the pipeline runs the pre-P1 path. This guards P1–P4 from affecting
production runs until the team is ready.

After P5 ships and at least three skills are in production, the flag can be
removed and skill execution becomes default-on gated by per-card
`analyzerSkill !== null`.

## 10. Acceptance Tests (per phase)

Each phase closes only when the acceptance tests pass on a real client
(recommended: Critters / clairecalls.com — small site, exercises most
source types).

Tests live at `features/scout-intake/__tests__/skills/`:

- `runner.test.js` — validates skill loading, input substitution, output
  validation, failure fallback.
- `contract.test.js` — validates output-contract shape enforcement.
- `integration.test.js` — end-to-end skill execution against a recorded
  fixture.

## 11. Glossary

- **Skill** — a `.md` prompt file with front matter, authored in
  `features/scout-intake/skills/`, run by the skill runner against a
  card's resolved source data.
- **Analyzer skill** — a skill used for the per-card pre-Scribe analysis
  step (as opposed to hypothetical future use cases).
- **Finding** — one element of a skill's output, with severity + citation.
- **Gap** — a triggered missing-state rule with evidence.
- **Readiness** — a skill's top-level verdict for the card (healthy /
  partial / critical).
- **Override** — per-client Firestore doc that changes which skill (or
  none) runs for a given card on that client.

## 12. Non-goals

Explicitly NOT in scope for this plan:

- Wiring external scouts (Reddit / weather / reviews) into the main
  runner (Phase E — separate workstream).
- Replacing Scribe with a different writer.
- Adding new dashboard cards beyond those already in the contract.
- Changing the Firestore schema outside the `scoutSkills` subcollection
  and `dashboard_state.analyzerOutputs` + `dashboard_state.brief.homeSummary`.
- Exposing skill editing (the `.md` content) to non-admin users.
- Skill chaining (multiple skills per card) — defer until one card actually needs it.
- Attaching an analyzer skill to the `brief` card. Brief is a post-Scribe
  aggregator by design (see §13 A2). Any future proposal to analyze raw
  sources for brief must update this plan before coding.

## 13. Plan Amendments

Amendments are tracked here when a review note or implementation finding
changes the plan in a material way. Each amendment has an ID, source,
and explicit contract changes. When you apply an amendment, mark the
originating note as `addressed` in `docs/scout-data-map.notes.json`.

### A1 — Intake Terminal reclassified as data-inventory + upgrade-pitch card

**Source**: notes `note-mo0jrvm5-uad8s0` and `note-mo0jug9i-b3ktka` on
anchor `card:intake-terminal` (2026-04-15).

**Decision**: `intake-terminal` is no longer runtime chrome. It becomes
the canonical surface that enumerates every data source the pipeline
attempted to pull from, with per-source success/failure status AND an
explicit upgrade-tier pitch for sources that are gated.

**Contract changes (apply during P6 priority-1 skill authoring)**:

```js
// card-contract.js — intake-terminal entry
{
  id: 'intake-terminal',
  navLabel: 'INTAKE TERMINAL',
  navTitle: 'Intake Terminal',
  category: 'systems',              // was 'runtime'
  role: 'intake-inventory',         // was 'runtime'
  analyzer: { impl: 'passthrough', required: false },
  analyzerSkill: 'intake-inventory',
  sourceField: 'intake.inventory',  // new synthetic pointer, written by the skill
  copy: {
    short:    { min: 120, max: 240 },
    expanded: { min: 400, max: 900 },
  },
  qualityScaling: true,
  tier: 'all',
  actionClass: 'diagnose',          // was 'runtime'
  sources: [
    'site.html', 'site.meta',
    'synth.intake', 'synth.styleGuide',
    'intel.pagespeed',
    'scout.reddit', 'scout.weather', 'scout.reviews',
    'scoutConfig.capabilitiesActive',
    'userContext',
  ],
  missingStateRules: [
    // Per-source "missing on this tier" rules. Each source that was gated
    // by tier or failed to return data produces a gap entry.
    {
      id: 'tier-gated-sources',
      when: 'clientConfig.tier === "free" AND any paid-only source unattempted',
      reason: 'Paid-tier data sources not attempted on free plan.',
      offer: 'Upgrade to Growth or Operator tier to unlock Instagram, deeper Reddit, review-sentiment scouting.',
    },
    {
      id: 'scout-failures',
      when: 'any scout.* source returned error or empty',
      reason: 'Live scout attempted but returned no data.',
      offer: 'Investigate scout credential / rate-limit / source-availability issue.',
    },
  ],
}
```

**New skill**: `features/scout-intake/skills/intake-inventory.md`

Skill responsibilities:
1. Enumerate every source in the card's `sources[]` and determine its
   status: `delivered` / `empty` / `error` / `tier-gated` / `unwired`.
2. For `tier-gated` sources, include a concrete upgrade pitch citing
   what the source unlocks (e.g. Instagram handle monitoring, review
   sentiment deltas, deeper subreddit crawls).
3. Compute a pipeline-level readiness from source coverage: `healthy` if
   ≥80% of free-tier sources delivered, `partial` if 50–79%, `critical`
   if <50%.
4. Findings list becomes the per-source status rows; Scribe uses them
   to write `short` (1-line status summary) and `expanded` (per-source
   breakdown + upgrade CTA for gated sources).

Output contract conforms to standard shape (§3 D3). Each finding's
`citation` field names the source id; each gap in `gaps[]` matches one
of the two `missingStateRules` above.

**Acceptance (added to P6 priority 1)**
- Running the pipeline against a free-tier client produces
  `analyzerOutputs['intake-terminal']` with a finding per declared source.
- Paid-only sources that were NOT attempted are marked
  `severity: 'info'` and their detail mentions the tier gate.
- Re-running after tier upgrade shows previously-gated sources now
  `delivered` (or `error`) instead of `info/tier-gated`.

**File inventory updates**
- New file: `features/scout-intake/skills/intake-inventory.md`
- Edited file: `features/scout-intake/card-contract.js` (intake-terminal entry)
- Edited file: `features/scout-intake/normalize.js` (thread a synthetic
  `intake.inventory` pointer when the skill runs — sourceField resolves
  from `analyzerOutputs['intake-terminal']`)

### A2 — Brief is an aggregator, not an analyzer target

**Source**: note `note-mo0jy8pw-hokggd` on anchor `card:brief`
(2026-04-15).

**Decision**: `brief` card remains `analyzerSkill: null` permanently.
Its role in the pipeline is POST-Scribe aggregation: it reads the
finished Scribe copy and analyzer findings from other cards and
synthesizes a single paragraph evaluating overall brand quality based on
what data was available.

**Consequences**:
- `brief` never re-reads `site.html`, `intel.pagespeed`, or raw source
  payloads. It consumes only Scribe outputs + analyzer findings.
- A new pipeline stage (P7) runs after Scribe to produce
  `dashboard_state.brief.homeSummary`.
- `brief` card's `short` + `expanded` continue to come from Scribe as
  today — unchanged.

**Contract changes**: none to the `brief` card entry. The existing
`analyzerSkill: null` is now a load-bearing architectural decision, not
a placeholder. A contract test should assert it never flips to
non-null.

**File inventory updates** (apply during P7):
- New file: `features/scout-intake/brief-aggregator.js`
- Edited file: `features/scout-intake/runner.js` (insert aggregator call
  after Scribe)
- Edited file: `features/scout-intake/normalize.js` (thread
  `brief.homeSummary` to dashboard_state)
- Edited file: `features/scout-intake/__tests__/contract.test.js` (new
  assertion: `getCard('brief').analyzerSkill === null`)
