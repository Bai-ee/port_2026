# Card Analyzer Port Guide

How to upgrade a dashboard card from passthrough display to the **skilled-card pattern** — tabs (SOLUTIONS / PROBLEMS / DATA), catalog-driven solutions, Scribe-authored copy, and stable DOM structure.

**This doc is the consolidated recipe, distilled from the six cards already on this pattern:**

| Card | Skill(s) | actionClass |
|---|---|---|
| [SEO + Performance](../features/scout-intake/skills/seo-depth-audit.md) | `seo-depth-audit` + `ai-seo-audit` (multi-skill) | diagnose |
| [Brand Tone / Site Meta](../features/scout-intake/skills/site-meta-audit.md) | `site-meta-audit` | diagnose |
| [Style Guide](../features/scout-intake/skills/style-guide-audit.md) | `style-guide-audit` | diagnose |
| [Intake Terminal](../features/scout-intake/skills/run-health-audit.md) | `run-health-audit` | diagnose |
| [Website & Landing Page](../features/scout-intake/skills/conversion-audit.md) | `conversion-audit` | service-offer |
| [Brand Identity & Design](../features/scout-intake/skills/brand-asset-gap.md) | `brand-asset-gap` | service-offer |

Read any two of these skill files alongside this guide before porting a new card — the pattern is clearer from examples than from abstraction.

---

## What a "skilled card" is

A card that:

1. **Has an analyzer skill** (`.md` file) that reads source payloads and emits structured findings + gaps
2. **Produces a contract-valid output** (`findings[] / gaps[] / readiness / highlights[]`) that flows through the pipeline into Firestore
3. **Has catalog entries** in [`solutions-catalog.mjs`](../features/scout-intake/solutions-catalog.mjs) mapping each finding id to an authored problem + DIY + expert offer
4. **Renders tabs** automatically on the dashboard modal (SOLUTIONS default, then PROBLEMS, then DATA) because the existing UI gates on `analyzerOutputs[cardId].aggregate`
5. **Gets Scribe-authored copy** tuned by its `actionClass` — diagnose cards lead with the top problem, service-offer cards frame gaps as opportunities

Critically: after the port, **the card needs no per-card UI code**. All rendering is already generic. The port is entirely in the pipeline layer.

---

## Prerequisites before porting

Confirm all of these exist:

- [ ] `SCOUT_ANALYZER_SKILLS_ENABLED=1` in the target environment
- [ ] The card has an entry in [`card-contract.js`](../features/scout-intake/card-contract.js) with `copy: { short, expanded }` budgets (not `null`)
- [ ] The card's declared `sources[]` are all in [`source-inventory.js`](../features/scout-intake/source-inventory.js) — if the skill needs data from a source not yet declared, add the source first (see [runtime.health addition](../features/scout-intake/source-inventory.js) for a reference example)
- [ ] The source's data actually reaches `buildSourcePayloads` in [`_runner.js`](../features/scout-intake/skills/_runner.js) — if it's a new source type, thread it through from [`runner.js`](../features/scout-intake/runner.js)

If any of these are false, port the prerequisites first as a separate commit.

---

## Triage — is this card a good fit?

**Strong fit (port it):**
- Card presents **site-level data** that can be audited against actionable criteria (SEO, site meta, style guide, conversion, brand coherence)
- Card has **existing `missingStateRules`** — those are your seed findings
- Card's `actionClass` is already `diagnose` or `service-offer`, or can sensibly be upgraded to one

**Weak fit (skip):**
- Card presents **synthesis-output** (generated brief, classifications like Industry / Business Model, generated posts, generated content angles) — there's nothing to "audit" because the content IS the analysis
- Card is **blocked on external data** (Phase E scouts, competitor-info, signals) — wait for the data source to wire first
- Card is purely **informational / descriptive** with no "problems to solve"

**Redundant fit (decide before porting):**
- Card overlaps 100% with an existing skill's scope — either skip, retire the card, or redefine its scope to be uniquely different (see `brand-identity-design` → `brand-asset-gap` for a redefinition example)

Honest triage beats forced ports. Seven of sixteen free-tier cards were deliberately skipped during the first six ports because forcing the pattern would have produced noise, not value.

---

## The 5-step recipe

### Step 1 — Write the skill `.md` file

Create `features/scout-intake/skills/<skill-id>.md`.

**Front matter (required):**
```yaml
---
id: <skill-id>
name: <Human Readable Name>
version: 1
model: claude-haiku-4-5-20251001
maxTokens: 2048
inputs:
  - <source-id-from-source-inventory>
  - <another-source-id>
output:
  tool: write_<skill_id>
  schemaRef: <skill-id>-v1
costEstimate: "$0.003–$0.008"
groundingRules:
  - "Cite the exact source field that triggered every finding."
  - "<scope discipline — what you audit, what you don't>"
  - "Emit every real finding. Hard total cap: 8."
---
```

**Critical**: the file must START with `---` on line 1. No HTML comments, no leading blank lines. The parser regex `^---\r?\n` is strict. (Learned the hard way on the site-meta port.)

**Prompt body structure** — follow the pattern from any existing skill. Every skill MUST have:

1. **Scope discipline block** — explicit "out of scope — do NOT emit findings about" list naming every neighboring skill's territory. This enforces the "cards unique, no carry-over" rule.
2. **STEP 1 — Data availability** — handle null / partial source data. Emit a `-unavailable` gap and set readiness to `'partial'` minimum. **NEVER emit a finding for audit-tool failures.** The gap IS the canonical disclosure. (See [STEP 1 in seo-depth-audit.md](../features/scout-intake/skills/seo-depth-audit.md).)
3. **STEPS 2..N — Finding evaluation** — each step evaluates one dimension, emits findings with severity-mapped ids matching catalog entries (see [Naming conventions](#naming-conventions)).
4. **Final STEP — Compose output** — caps, dedup rule, gaps evaluation, readiness rule (first-match-wins, critical > partial > healthy), highlights guidance.

### Step 2 — Update the card contract

Edit [`card-contract.js`](../features/scout-intake/card-contract.js). For the target card:

```js
analyzerSkill: '<skill-id>',              // legacy single-skill field
analyzerSkills: ['<skill-id>'],           // P3+ multi-skill array — preferred
```

Both fields. The array is preferred; the legacy single-value field stays for back-compat.

**Update `sources[]`** if the skill needs a source the card doesn't already declare:
```js
sources: ['site.html', 'site.meta', 'synth.intake'],
```

**Consider changing `actionClass`** — see [actionClass guide](#actionclass--voice-selection).

**Update `copy: {...}` budgets** if the card had `copy: null` (like the intake-terminal port did).

Add a comment block above the card explaining the upgrade:
```js
// actionClass upgraded from 'describe' to 'diagnose' — the <skill-id> skill
// produces actionable findings about X, Y, Z. Scribe leads with the top
// problem and points to the Solutions tab via diagnose-role voice rules.
```

### Step 3 — Add catalog entries

Edit [`solutions-catalog.mjs`](../features/scout-intake/solutions-catalog.mjs). For **every finding id** the skill emits, add an authored entry at the end of the array:

```js
{
  id: '<finding-id-matching-the-skill-emission>',
  category: '<skill-scope-tag>',        // e.g., 'seo', 'conversion', 'brand-identity'
  severity: 'critical' | 'warning' | 'info',
  triggers: {
    ids: ['<finding-id>', '<alias-if-any>'],
    citationIncludes: ['<substring1>', '<substring2>'],
    labelIncludes: ['<substring1>', '<substring2>'],
  },
  problem: '<one-sentence plain-language problem statement>',
  whyItMatters: '<2-4 sentences naming business consequences — rankings, CTR, trust, conversion, revenue>',
  diy: {
    summary: '<one-sentence DIY summary>',
    steps: ['<step 1>', '<step 2>', ...],   // 5-6 concrete numbered steps with specific tools, file paths, or HTML snippets
    estimatedTime: '<X-Y hours>',
    skillLevel: 'beginner' | 'intermediate' | 'advanced',
    helpfulLinks: [{ label, url }, ...],    // real tools/docs only, skip if you can't cite a real resource
  },
  expertOffer: {
    title: "<I'll / Let me + specific promise>",
    summary: '<the service offer in 1-2 sentences>',
    turnaround: '<duration>',
    deliverable: '<what they get>',
    cta: { label: '<specific CTA verb>', href: calendlyUrl('<finding-id>') },
  },
},
```

**Tone bar**: match [`missing-meta-description`](../features/scout-intake/solutions-catalog.mjs) and [`lcp-critical`](../features/scout-intake/solutions-catalog.mjs). Specific, direct, no hedging, real tool references, concrete numbered steps — no "consult a professional" filler.

### Step 4 — Verify wiring

No code change — just confirm:

- Server restart picks up the new `.md` file ([`_registry.js`](../features/scout-intake/skills/_registry.js) auto-discovers at module load, but only at restart)
- Trigger a fresh pipeline run (existing Firestore state doesn't have the new skill's output)
- Open `/preview/scout-config` → Data Map → find the target card → confirm the Analyzer panel shows the new skill with findings
- Open `/dashboard` → click the card tile → confirm tabs render with SOLUTIONS default, catalog cards populate, PROBLEMS tab shows findings with plain-language headlines

### Step 5 — Manual eyeball

Read three things live:

1. **Scribe's expanded copy** on the card's ABOUT section — should read in the correct voice (diagnose = lead with problem, service-offer = frame gap as opportunity)
2. **SOLUTIONS tab cards** — every one should have real DIY steps and a specific expert offer CTA (no generic "book a diagnostic call" fallbacks for known finding ids)
3. **PROBLEMS tab** — every finding's catalog-headline should be the plain-language `problem` string from the catalog, NOT the raw Haiku-written label

If any of these read off, the fix is usually in one place:
- Scribe tone off → check `actionClass` is right for the card
- Generic fallback on SOLUTIONS → the finding id from the skill didn't match any catalog entry's `triggers.ids` — either add the id to the catalog's triggers or rename the finding to match
- PROBLEMS showing raw Haiku label → the finding id doesn't resolve via `resolveSolution` — same fix as above

---

## Naming conventions

### Finding ids

- **Format**: `kebab-case-describing-the-issue`
- **Pattern**: `<noun-or-verb>-<modifier>` — naming what's wrong, not prescribing the fix
- **Good**: `no-primary-cta`, `body-text-too-small`, `missing-og-image`, `thin-brand-positioning`
- **Bad**: `fix-this`, `issue-1`, `cta` (too generic), `you-need-pricing` (prescriptive, not descriptive)

Finding ids MUST match catalog entry ids or be listed in a catalog entry's `triggers.ids[]`. Mismatches fall through to the generic fallback card on SOLUTIONS.

### Audit-failure gap ids

- **Must include** `-unavailable`, `-failed`, `_failed`, or start with `audit-`
- **Pattern recognition** in [`scribe.js::isAuditFailureGap`](../features/scout-intake/scribe.js) routes these to the AUDIT STATE block instead of the site-problems block
- **Examples**: `psi-data-unavailable`, `fetch-failed`, `synthesize-failed`, `ai-seo-audit-failed`, `site-meta-unavailable`, `style-guide-unavailable`, `brand-audit-no-evidence`

### Source ids

- Format: `<category>.<subtype>` — `site.html`, `site.meta`, `synth.intake`, `intel.pagespeed`, `runtime.health`
- MUST be declared in [`source-inventory.js`](../features/scout-intake/source-inventory.js) before use

### Skill file names

- Match the skill id exactly: `<skill-id>.md`
- All lowercase kebab-case
- Infrastructure files prefixed with `_` (e.g., `_runner.js`, `_registry.js`) — skills never start with underscore

---

## actionClass / voice selection

The card's `actionClass` drives Scribe's tone via [`card-voice.js`](../features/scout-intake/card-voice.js). Five values:

| actionClass | When to use | Scribe tone |
|---|---|---|
| `diagnose` | Site-data cards where findings are actionable problems to fix | Leads with top problem, cites specifics, points to Solutions tab |
| `service-offer` | Cards where gaps are sold as services Bryan provides | Frames gaps as opportunities, subtle close, "I can rebuild this" |
| `describe` | Purely informational cards (Industry, Brief, Business Model) | States what IS, no urgency, no Solutions pointer |
| `recommend` | Cards naming a single next action (Content Angle, Priority Signal) | Names the top action, no hedging |
| `runtime` | Chrome-only cards (obsolete for skilled cards — upgrade to `diagnose`) | Minimal, typically no copy |

**Default for a port**: `diagnose`. Every skilled card on the current dashboard uses either `diagnose` or `service-offer`.

**Upgrade triggers**: if you're porting a card whose current `actionClass` is `describe`, `recommend`, or `runtime`, the port likely changes it to `diagnose`. This is a deliberate voice shift — document the reason in the card-contract comment.

---

## Common pitfalls (real bugs from the first six ports)

### 1. Audit failures rendered as site problems

**Symptom**: Scribe writes "Site has 3 critical issues — PageSpeed Insights returned an error..." when PSI failed due to rate limiting.

**Fix**: Skill prompt must explicitly forbid emitting findings for audit-tool failures. Gap-only disclosure. See [seo-depth-audit.md STEP 1](../features/scout-intake/skills/seo-depth-audit.md) and [scribe.js AUDIT STATE block](../features/scout-intake/scribe.js).

### 2. "Why it matters" duplicated on PROBLEMS tab

**Symptom**: Two paragraphs rendered with the same "why this matters" content.

**Fix**: When `catalogEntry.whyItMatters` is present, suppress the LLM-generated `f.impact` field. Handled at [DashboardPage.jsx PROBLEMS loop](../DashboardPage.jsx) — verify your port doesn't reintroduce the dup.

### 3. Mismatch between PROBLEMS count and SOLUTIONS count

**Symptom**: PROBLEMS tab shows 5 findings, SOLUTIONS tab shows 4 cards. User sees asymmetry.

**Cause**: `buildSolutionsList` in [`solutions-catalog.mjs`](../features/scout-intake/solutions-catalog.mjs) no longer dedups across source boundaries. Each finding and gap produces its own card. If you see divergence, it's usually a new dedup introduced accidentally — remove it.

### 4. Severity chip mismatch between tabs

**Symptom**: PROBLEMS shows severity "info" chip, SOLUTIONS shows same item as "warning" chip.

**Fix**: SOLUTIONS tab tuple severity should come from the finding's own severity (`f.severity`), NOT the catalog entry's `solution.severity`. The catalog's severity is advisory; the source data wins.

### 5. Gap chip color wrong on SOLUTIONS tab

**Symptom**: Gap item shows orange "warning" chip on SOLUTIONS but pink "gap" chip on PROBLEMS.

**Fix**: Render the gap chip via `.tile-analyzer-gap-chip` class (pink) for gap-sourced SOLUTIONS cards, not the severity chip. See [DashboardPage.jsx gap rendering](../DashboardPage.jsx).

### 6. Front-matter parse error on new skill file

**Symptom**: `Skill file missing YAML front matter (--- delimiters not found)` warning in pipeline logs.

**Fix**: The file MUST start with `---` on line 1. No HTML comments, no leading blank lines, no BOM. The parser at [`_runner.js::parseFrontMatter`](../features/scout-intake/skills/_runner.js) uses `^---\r?\n` — strict.

### 7. Voice rules not firing on a ported card

**Symptom**: Scribe copy doesn't reflect the `actionClass` you set.

**Cause 1**: `card.actionClass` not in `VOICE_BY_ACTION_CLASS` map. Check [`card-voice.js`](../features/scout-intake/card-voice.js).

**Cause 2**: Keying on `role` instead of `actionClass` somewhere. The generic 5-value enum is `actionClass`; `role` holds card-specific labels like `'brand-voice'`, `'technical-health'`.

### 8. Server started before skill file existed

**Symptom**: New skill doesn't load; registry returns null for `getSkillPath(<new-skill-id>)`.

**Fix**: [`_registry.js`](../features/scout-intake/skills/_registry.js) reads the skills/ directory at require-time. Restart the Node process after adding a new `.md` file.

---

## Testing checklist

After each port, verify:

- [ ] `/preview/scout-config` → Data Map → target card shows Analyzer panel with new skill id
- [ ] Analyzer panel shows findings with correct severities and readiness
- [ ] No `skill_failed: <skill-id>` warning in the P1 status banner
- [ ] No `psi-data-unavailable` or equivalent audit-failure gap triggered if real data should be present
- [ ] `/dashboard` → target card tile → modal opens with SOLUTIONS tab default
- [ ] SOLUTIONS tab: every finding has a matching catalog card (no generic fallbacks for named finding ids)
- [ ] PROBLEMS tab: every finding's headline is the plain-language catalog `problem`, NOT the raw Haiku label
- [ ] PROBLEMS tab: triggered gaps render with pink "gap" chip
- [ ] PROBLEMS + SOLUTIONS tab card counts match (1:1 parity)
- [ ] Scribe's ABOUT description opens in the correct voice (diagnose or service-offer)
- [ ] Non-ported cards render unchanged (no regression)

---

## Catalog organization (when to split)

Current single-file structure works up to ~2000 lines / 35-40 entries. Beyond that, split by card category:

```
features/scout-intake/catalogs/
  seo.mjs         — SEO + Performance findings
  site-meta.mjs   — Site meta findings
  style-guide.mjs — Design findings
  conversion.mjs  — Conversion findings
  brand.mjs       — Brand identity findings
  run-health.mjs  — Runtime health findings
  index.mjs       — aggregates and re-exports everything
```

Keep the public API of [`solutions-catalog.mjs`](../features/scout-intake/solutions-catalog.mjs) stable so consumers (DashboardPage, API routes) don't need to change.

Not urgent. Flag when the monolithic file crosses 2500 lines.

---

## Upgrade path: per-card `.md` voice files

Current voice rules key on `actionClass` in [`card-voice.js`](../features/scout-intake/card-voice.js). If a specific card needs voice tuning that can't be captured at the role level, upgrade that card to a dedicated `.md` file:

```
features/scout-intake/card-voice-md/
  seo-performance.md
  brand-tone.md
  ...
```

Format would mirror skill `.md` files — YAML front matter + prompt body. [`scribe.js::buildCardDigest`](../features/scout-intake/scribe.js) would load the per-card file when present, fall back to `VOICE_BY_ACTION_CLASS` when not.

**Only worth it when:**
- A specific card consistently gets wrong voice from role-level rules
- A non-dev (copywriter, designer) needs to own the copy tuning independently
- You want to A/B test voice variants per card

Current six cards don't need this. Doors left open.

---

## Current state of the pipeline (as of 2026-04-16)

- **6 cards** on the skilled pattern, each with unique non-overlapping scope
- **~35 catalog entries** with authored DIY + expert offers
- **7 skill files** (including ai-seo-audit engine and its integration)
- **2 actionClasses** in active use: `diagnose` and `service-offer`
- **Generic 5-tab card**: SOLUTIONS / PROBLEMS / DATA — always the same UI, varying data

Next ports would target external-data cards (competitor-info, signals) once their data sources wire, OR new cards added to the contract (paid-tier upgrades, etc.).
