# Onboarding Dynamic Card Description System — Master Prompt (Sonnet Handoff)

Paste this into a fresh Claude Sonnet session as the first message. Do not remove sections.

---

## Role

You are implementing the **Onboarding Dynamic Card Description System** inside the Bballi Portfolio codebase.

Your job is to replace onboarding tile-face descriptions with a **deterministic dominant-signal system**, while preserving the existing Scribe system for expanded/modal synthesis.

This is an implementation task, not a brainstorming session.

---

## Source of truth

Read this first and treat it as canonical:

- [docs/CARD_DESCRIPTION_SYSTEM/ONBOARDING_DYNAMIC_DESCRIPTION_SYSTEM_PLAN.md](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/CARD_DESCRIPTION_SYSTEM/ONBOARDING_DYNAMIC_DESCRIPTION_SYSTEM_PLAN.md:1)

If the plan and the code disagree, surface the mismatch explicitly before editing.

---

## Hard architectural decision

Implement **deterministic tile descriptions**.

Do **not** make Scribe the primary engine for onboarding tile descriptions.

Keep Scribe for:

- expanded/modal copy
- recommendations
- brief-level synthesis

Do **not** change the analyzer skill contract from:

- `findings`
- `gaps`
- `readiness`
- `highlights`

Instead, add a projection layer on top of the current contract.

---

## Core implementation target

Build a centralized description builder, expected path:

- `features/scout-intake/card-description-builder.js`

The builder should:

1. normalize current analyzer outputs into a local description model
2. select one dominant signal per onboarding card
3. produce a 1–3 sentence tile description:

```text
[What we saw]. [Why it matters]. [What to do next].
```

No new LLM call is allowed for tile descriptions.

---

## Existing code you must respect

### Tile rendering path

Onboarding cards are built in:

- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:2169)

Tile face currently renders:

- `card.scribeShort || card.description`

See:

- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:3124)

Modal/body currently prefers:

- `scribe.expanded || card.description`

See:

- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:2821)

### Existing analyzer alias problem

There is inline alias routing in the dashboard today:

- `social-preview -> brand-tone`
- `multi-device-view -> intake-terminal`
- `site-performance -> seo-performance`

See:

- [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:2786)

Move this logic out of the dashboard and centralize it.

### Existing analyzer contract

The current skill output contract is:

- `findings[]`
- `gaps[]`
- `readiness`
- `highlights[]`
- `metadata`

Defined in:

- [features/scout-intake/skills/_output-contract.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/skills/_output-contract.js:8)

Produced in:

- [features/scout-intake/skills/_runner.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/skills/_runner.js:325)

### Existing Scribe behavior

Scribe already consumes analyzer outputs and writes short/expanded/recommendation copy:

- [features/scout-intake/scribe.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/scribe.js:72)

Do not break this system.

---

## Scope

Implement onboarding cards only:

- `brief`
- `multi-device-view`
- `social-preview`
- `business-model`
- `seo-performance`
- `industry`
- `visibility-snapshot`

Do not generalize to all card groups in the first pass unless the work is purely infrastructural and safe.

---

## Output rules

The deterministic tile description must:

- be 1–3 sentences
- select only one dominant signal
- avoid summarizing all signals
- be direct, specific, and outcome-focused
- avoid filler and generic marketing language
- stay readable in under 5 seconds

The readiness badge already carries global state, so the description should focus on the dominant signal rather than re-explaining status.

---

## Recommended implementation order

### Phase 1

Create the builder and centralized onboarding card source mapping.

Deliverables:

- new builder module
- alias/source mapping removed from inline dashboard logic
- no required visible UI change yet

### Phase 2

Use the deterministic builder for onboarding tile-face descriptions.

Recommended precedence:

1. deterministic tile description
2. `scribeShort`
3. static `description`

Keep modal/body behavior unchanged for now.

### Phase 3

Implement explicit dominant-signal priority rules per onboarding card.

### Phase 4

Expose debug visibility in admin/dev tooling so the selected dominant signal and final deterministic description can be inspected.

---

## Dominant-signal rules to implement

### `seo-performance`

Priority:

1. critical finding
2. triggered SEO/performance gap
3. strongest healthy highlight

### `social-preview`

Priority:

1. missing OG image
2. missing title or description
3. missing canonical or icon surface
4. complete social preview strength

### `multi-device-view`

Priority:

1. screenshot/mockup capture failure
2. device artifact missing / partial
3. successful capture strength

This card should describe audit/artifact state honestly. Do not invent layout diagnoses the analyzer does not currently produce.

### `brief`

Priority:

1. intake too thin / no reliable brief
2. strongest strategic framing signal

### `business-model`

Priority:

1. no clear model
2. strongest resolved structure or offer type

### `industry`

Priority:

1. unknown category
2. strongest resolved category signal

### `visibility-snapshot`

Priority:

1. low visibility score / weak grade
2. partial visibility
3. strongest positive visibility signal

---

## Do not do these things

- Do not replace the skill contract with `issues/strengths/status/metrics` at the persistence layer.
- Do not add per-card Sonnet or Haiku prompts for tile descriptions.
- Do not leave analyzer alias logic inline in `DashboardPage.jsx`.
- Do not rewrite Scribe unless necessary for compatibility.
- Do not widen the scope to all cards before onboarding is working.

---

## Suggested technical shape

The builder may produce an internal object like:

```js
{
  status: 'critical' | 'partial' | 'healthy',
  issues: [],
  strengths: [],
  metrics: {},
  dominantSignal: {
    id,
    type,
    finding,
    impact,
    action,
  },
  description: '...'
}
```

This is an internal projection shape only. It is not a replacement for the stored analyzer contract.

---

## Verification requirements

Before finishing, verify these cases:

1. Critical SEO issue
   - tile describes the single top issue
2. Partial social preview
   - tile names the missing preview surface
3. Healthy signal
   - tile uses a real strength, not vague praise
4. Mixed signals
   - tile still picks only one dominant signal

Also verify:

- modal descriptions still use existing Scribe behavior
- readiness badge still renders
- no extra LLM call was added
- fallback behavior remains safe when analyzer output is missing

---

## Files you should read before editing

Read these first:

1. [docs/CARD_DESCRIPTION_SYSTEM/ONBOARDING_DYNAMIC_DESCRIPTION_SYSTEM_PLAN.md](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/CARD_DESCRIPTION_SYSTEM/ONBOARDING_DYNAMIC_DESCRIPTION_SYSTEM_PLAN.md:1)
2. [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:2169)
3. [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:2786)
4. [DashboardPage.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:3124)
5. [features/scout-intake/scribe.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/scribe.js:72)
6. [features/scout-intake/card-voice.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/card-voice.js:24)
7. [features/scout-intake/skills/_output-contract.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/skills/_output-contract.js:8)
8. [features/scout-intake/skills/_runner.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/skills/_runner.js:351)
9. [app/api/admin/scout-card-copy/route.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/admin/scout-card-copy/route.js:1)

---

## Reporting format

Before editing, respond with:

```text
## Scope
<what phase you are implementing>

## Files likely affected
- ...

## Risks
<what could break>

## First step
<what you will do first>

Proceeding.
```

After editing, respond with:

```text
## Files changed
<list>

## Exact behavior changed
<short factual summary>

## Verification run
<what you tested>

## Risks / not verified
<honest list>

Waiting for approval to continue.
```

---

## Final instruction

Implement the deterministic onboarding tile description system in phases, starting with the centralized builder and source mapping cleanup.

Do not drift into architecture changes outside this plan.
