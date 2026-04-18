# Onboarding Dynamic Card Description System — Implementation Plan

Status: Proposed  
Owner: Bryan Balli  
Last updated: 2026-04-17  
Scope: Onboarding cards only, designed as the template for all later card groups

---

## 1. Objective

Implement a scalable system for **tile-face onboarding card descriptions** that:

- reflects real run data
- stays consistent across cards
- picks one dominant signal instead of summarizing everything
- avoids unnecessary LLM usage
- preserves the existing Scribe system for expanded/modal copy where synthesis is still useful

This work is explicitly about the **card face / short description layer** first. It is not a rewrite of the analyzer contract, the skill contract, or the Scribe brief system.

---

## 2. Recommendation

Use a **deterministic description builder** for onboarding tile descriptions.

Do **not** make Scribe the primary generator for all onboarding card descriptions.

Keep Scribe for:

- modal / expanded descriptions
- recommendations
- brief-level synthesis
- cards whose insight is genuinely ambiguous or multi-signal

This gives the best balance of:

- **cost**: no extra per-card model call
- **accuracy**: one dominant signal is selected by code, not improvised by prompt behavior
- **consistency**: shared templates keep the voice uniform
- **efficiency**: no second interpretation layer for simple cards
- **management**: priority rules live in code/config and are inspectable

---

## 3. Current Code Reality

### 3.1 What exists now

The current onboarding cards are assembled inside:

- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:2169)

Today, each onboarding card has:

- a mostly static `description`
- optional `scribeShort` override for tile face
- optional `scribe.expanded` for modal/body
- readiness injected from analyzer output or a derived fallback

Key current behavior:

- tile face uses `card.scribeShort || card.description`
  - [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:3124)
- modal/body description uses `scribe.expanded || static description` and appends readiness context
  - [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:2821)

### 3.2 What data layer exists now

The existing skill contract is:

- `findings[]`
- `gaps[]`
- `readiness`
- `highlights[]`
- `metadata`

Defined in:

- [features/scout-intake/skills/_output-contract.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/skills/_output-contract.js:8)

Analyzer skill fanout returns:

```js
analyzerOutputs[cardId] = {
  skills: { [skillId]: SkillOutput },
  aggregate: { findings, gaps, readiness, highlights, recommendation }
}
```

Built in:

- [features/scout-intake/skills/_runner.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/skills/_runner.js:351)

Scribe already reads these aggregates and turns them into copy:

- [features/scout-intake/scribe.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/scribe.js:72)

### 3.3 Important mismatch in the current dashboard

The onboarding display cards are **not** in 1:1 alignment with analyzer output ids today.

The dashboard currently performs ad hoc analyzer aliasing:

- `social-preview -> brand-tone`
- `multi-device-view -> intake-terminal`
- `site-performance -> seo-performance`

See:

- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:2786)

This is the first thing to clean up before scaling a deterministic description system.

---

## 4. Core Architecture

### 4.1 Do not replace the analyzer contract

Do **not** change the skill output contract from:

- `findings / gaps / readiness / highlights`

to:

- `issues / strengths / status / metrics`

at the storage or contract layer.

Instead, add a **projection layer** that derives the normalized description inputs from the current contract.

That keeps the system compatible with:

- existing skills
- existing admin tooling
- existing Scribe flow

### 4.2 Add a deterministic description builder

Create a centralized module, expected path:

- `features/scout-intake/card-description-builder.js`

Inputs:

- `cardId`
- `analyzer` aggregate or derived readiness object
- raw card-specific data
- optional user context

Output:

```js
{
  status,           // critical | partial | healthy
  dominantSignal,   // normalized chosen signal
  finding,          // sentence fragment
  impact,           // sentence fragment
  action,           // sentence fragment
  description,      // 1-3 sentence tile description
  debug             // optional trace object for admin/dev visibility
}
```

### 4.3 Normalize current data into a local description model

The description builder should derive:

- `status`
- `issues[]`
- `strengths[]`
- `metrics`

from the current aggregate shape.

Recommended mapping:

- `status` ← `aggregate.readiness`
- `issues[]` ← critical/warning `findings` + triggered non-audit `gaps`
- `strengths[]` ← `highlights` + informational findings
- `metrics` ← card-specific raw values, not generic contract changes

Examples:

- SEO card metrics: performance score, SEO score, LCP
- Social preview metrics: `ogImage` present, canonical present, favicon present
- Visibility card metrics: score, grade, section scores

### 4.4 One dominant signal only

Tile descriptions must pick exactly one dominant signal.

Selection rules:

1. `critical` → highest-priority severe issue
2. `partial` → most actionable improvement
3. `healthy` → strongest positive proof point

Everything else is ignored for tile-face description generation.

### 4.5 Tile vs modal split

Tile:

- deterministic description builder
- one dominant signal
- 1–3 short sentences

Modal:

- keep Scribe `expanded`
- keep recommendation handling
- may still show broader analyzer context

---

## 5. Target Output Rules

The builder should produce:

**[What we saw]. [Why it matters]. [What to do next].**

Rules:

- 1–3 sentences
- no bullets
- no filler
- no jargon unless needed
- readable in under 5 seconds
- direct, specific, outcome-focused

The tile description should not repeat:

- severity counts
- raw score lists
- obvious UI labels already shown elsewhere on the card

The readiness badge already carries global state:

- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:3125)

So the description should focus on the **dominant signal**, not re-explain the status label.

---

## 6. Implementation Approach

## Phase 1 — Introduce the deterministic builder without changing visual behavior

### Goal

Create the infrastructure for deterministic tile descriptions and move display-card alias logic out of `DashboardPage.jsx`.

### Changes

1. Add:
   - `features/scout-intake/card-description-builder.js`

2. Add a centralized onboarding display-card source map, either:
   - inside the new builder module, or
   - in a small companion module such as `features/scout-intake/card-display-map.js`

3. Move current aliasing logic out of:
   - [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:2786)

4. The builder should support both:
   - real analyzer aggregates
   - derived readiness-only fallbacks

### Acceptance

- Dashboard no longer hardcodes per-card analyzer alias routing inline.
- A single helper resolves analyzer source and description source for onboarding cards.
- No visible UI change yet unless explicitly enabled.

---

## Phase 2 — Add deterministic onboarding tile descriptions

### Goal

Replace onboarding tile-face `scribeShort || static description` with:

- deterministic builder output first
- then fallback to `scribeShort`
- then fallback to static description

Recommended precedence:

1. `card.dynamicShortDescription`
2. `scribeShort`
3. `static description`

### Changes

1. Update onboarding card assembly in:
   - [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:2169)

2. Generate deterministic tile descriptions for these onboarding cards first:
   - `brief`
   - `multi-device-view`
   - `social-preview`
   - `business-model`
   - `seo-performance`
   - `industry`
   - `visibility-snapshot`

3. Preserve modal behavior:
   - `scribe.expanded` remains the primary modal/body override

### Acceptance

- Onboarding tile descriptions vary based on data.
- Only one dominant signal is expressed per tile.
- Modal copy still uses existing Scribe behavior.
- No new LLM call is introduced.

---

## Phase 3 — Add card-specific dominant-signal rules

### Goal

Make the onboarding cards readable, intentional, and not generic.

### Required rules

#### `seo-performance`

Priority order:

1. critical finding
2. triggered SEO/performance gap
3. strongest healthy highlight

Examples:

- slow load / LCP issue
- missing meta / crawlability issue
- healthy baseline signal when no issue exists

#### `social-preview`

Priority order:

1. missing OG image
2. missing title / description
3. missing canonical / icon surface
4. complete preview strength

#### `multi-device-view`

Priority order:

1. screenshot/mockup capture failed
2. device artifacts missing
3. healthy multi-device capture success

Note:
- there is not yet a true layout analyzer for this card, so this card should describe audit-state / artifact-state honestly

#### `brief`

Priority order:

1. no reliable brief / intake too thin
2. strongest strategic framing signal from brief content

#### `business-model`

Priority order:

1. no clear model detected
2. strongest identified model / offer structure

#### `industry`

Priority order:

1. no category detected
2. strongest resolved market category

#### `visibility-snapshot`

Priority order:

1. low score / weak grade
2. partial coverage
3. strongest visibility proof point

### Acceptance

- Each onboarding card has an explicit priority order in code.
- Dominant signal choice is explainable from code without looking at prompt output.

---

## Phase 4 — Add debug visibility for management and QA

### Goal

Make the deterministic layer inspectable so it can be trusted and maintained.

### Changes

1. Expose the selected dominant signal and generated deterministic description in admin/debug surfaces.

Candidate locations:

- [app/api/admin/scout-card-copy/route.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/admin/scout-card-copy/route.js:1)
- [app/preview/scout-config/page.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/preview/scout-config/page.jsx:1)

2. Include:

- dominant signal id / type
- derived status
- selected finding / impact / action
- final tile description

### Acceptance

- Admin can see why a tile description was chosen.
- The system is debuggable without inspecting browser state manually.

---

## 7. Files Likely Touched

Core:

- `features/scout-intake/card-description-builder.js` (new)
- `features/scout-intake/card-display-map.js` (optional new)
- `DashboardPage.jsx`

Potential debug/admin integration:

- `app/api/admin/scout-card-copy/route.js`
- `app/preview/scout-config/page.jsx`

Reference-only, should remain stable unless absolutely necessary:

- `features/scout-intake/skills/_output-contract.js`
- `features/scout-intake/skills/_runner.js`
- `features/scout-intake/scribe.js`

---

## 8. Design Rules

### Do

- reuse existing analyzer outputs
- keep Scribe for expanded/modal text
- keep current skill contract intact
- keep rollout limited to onboarding cards first
- make dominant-signal logic explicit and inspectable

### Do not

- replace skill output contract with a new root shape
- add new LLM calls for tile descriptions
- leave alias logic buried in `DashboardPage.jsx`
- try to summarize every signal on the tile face
- let Scribe remain the only source of truth for short onboarding card descriptions

---

## 9. Success Criteria

The system is successful if:

- onboarding tiles read as clear diagnoses
- users can understand the issue or strength instantly
- only one dominant signal appears per tile
- descriptions vary meaningfully by site/run
- copy feels consistent across cards
- modal detail remains richer than tile copy
- cost does not increase
- admin/debug views can explain why a description was selected

---

## 10. Suggested Order of Execution

Implement in this order:

1. builder + card source mapping
2. onboarding tile integration
3. per-card dominant-signal rules
4. admin/debug trace exposure

Stop after each phase and verify before moving on.

---

## 11. Final Recommendation

The right architecture is:

- **deterministic builder for tile descriptions**
- **Scribe for expanded/modal synthesis**
- **existing analyzer outputs as source of truth**
- **projection layer instead of contract replacement**

This is the cleanest path for cost, consistency, and long-term card management.
