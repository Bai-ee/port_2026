# DESIGN.MD REWIRE — Master Implementation Prompt

> Feed this entire file to Claude Code CLI.
> Reference doc: `docs/DESIGNMD_MODULE_DATA_SHAPES.md` (read that too)

---

## OBJECTIVE

Rewire `features/leadgen/design-md-generator.js` so that every analysis module's structured output flows into the correct DESIGN.MD section through a clear priority chain. Right now only the content scraper and hardcoded vertical defaults feed the brief. Five modules produce rich data that gets thrown away. Fix that.

**The rule:** Every field in DESIGN.MD should use the most accurate source available, falling back through a priority chain. No hardcoded values when real data exists.

---

## FILES TO MODIFY

### Primary (the main work)
- `features/leadgen/design-md-generator.js` — Rewrite color/font/motion/layout resolution, add new DESIGN.MD sections, expand existing ones

### Secondary (pass new data through)
- `app/api/leadgen/prepare-brief/route.js` — Already passes `onboard` to `generateDesignMd()`. Verify the Brand System data is accessible. If `prospect.userUploads?.brandSystem` or `prospect.brandGuide` exists, pass it as a new `brandSystem` param.

### Tertiary (also uses vertical style hints)
- `app/api/leadgen/generate-mockup/route.js` — Add missing VERTICAL_STYLE entries for all 12 verticals + use DESIGN.MD data when available instead of re-resolving from contentJson

---

## DATA SOURCES & FIRESTORE PATHS

All module results live on the prospect Firestore document. When `generateDesignMd()` is called, it receives `{ prospect, onboard, content, assetManifest }` where `onboard = prospect.onboard || {}`.

### Source: Content Scraper (already wired)
- **Object:** `content` (passed directly from `scrapeClientContent()`)
- **Fields:** `content.copy.*`, `content.colors.*`, `content.structure.*`, `content.assets.*`, `content.meta.*`

### Source: Design Evaluation
- **Path:** `onboard.designEvaluation`
- **Key fields:**
  - `onboard.designEvaluation.styleGuide.colors` → `{ primary: {hex}, secondary: {hex}, tertiary: {hex}, neutral: {hex} }`
  - `onboard.designEvaluation.styleGuide.typography` → `{ fontFamilies: [{family, role, source}], headingSystem: {fontFamily, fontWeight}, bodySystem: {fontFamily, fontWeight} }`
  - `onboard.designEvaluation.styleGuide.layout` → `{ framing, gridSystem }`
  - `onboard.designEvaluation.styleGuide.motion` → `{ level }` (none/subtle/moderate/bold)
  - `onboard.designEvaluation.styleGuide.confidence` → "high" | "medium" | "low"
  - `onboard.designEvaluation.styleGuide.summary` → string (design quality assessment)
  - `onboard.designEvaluation.styleGuide.visualPalette.swatches` → `[{hex, frequency}]`

### Source: Social Preview
- **Path:** `onboard.socialPreview`
- **Key fields:**
  - `onboard.socialPreview.siteMeta.title` → SEO page title
  - `onboard.socialPreview.siteMeta.description` → meta description
  - `onboard.socialPreview.siteMeta.ogImage` → Open Graph image URL
  - `onboard.socialPreview.siteMeta.favicon` → favicon URL

### Source: AI / Agent Readiness (partially wired)
- **Path:** `onboard.agentReadiness`
- **Key fields already used:** `score`, `verdict`, `findings`
- **Key fields NOT used:**
  - `onboard.agentReadiness.dimensions` → `{ structuredData: {score, verdict}, schemaMarkup: {score, verdict}, crawlability: {score, verdict}, htmlSemantics: {score, verdict}, accessibilityData: {score, verdict} }`
  - `onboard.agentReadiness.checks[]` → `[{id, name, status, verdict, fixId, recommendation}]`
  - `onboard.agentReadiness.highlights[]` → strengths to preserve
  - `onboard.agentReadiness.customFixes` → `{[fixId]: {prompt, reasoning}}`

### Source: SEO Performance (partially wired)
- **Path:** `onboard.seoPerformance`
- **Key fields already used:** `pagespeed.performance`, `pagespeed.accessibility`, `pagespeed.seo`, `pagespeed.bestPractices`
- **Key fields NOT used:**
  - `onboard.seoPerformance.pagespeed.scores.largest_contentful_paint` → LCP in ms
  - `onboard.seoPerformance.pagespeed.scores.first_input_delay` → FID in ms
  - `onboard.seoPerformance.pagespeed.scores.cumulative_layout_shift` → CLS
  - `onboard.seoPerformance.pagespeed.opportunities[]` → `[{id, title, description, savings}]`
  - `onboard.seoPerformance.skillOutput.findings[]` → `[{category, severity, issue, fix}]`

### Source: Brand System (COMPLETELY DISCONNECTED — wire from scratch)
- **Path:** `prospect.userUploads?.brandSystem` (the raw gap-fill answers) OR a built Brand Guide JSON
- **The Brand System produces a `filled` object via `mapPipelineToBrandSystem(state)` and a full JSON via `buildBrandSystemJsonV2()`. This data may be stored at `prospect.brandGuide` or `prospect.userUploads.brandSystem.brandGuideV2`. Check which path exists at runtime.**
- **Key fields:**
  - `brandSystem.color_system.foundation[]` → `[{hex, name, role, usage}]`
  - `brandSystem.color_system.emphasis[]` → `[{hex, name, role, usage}]`
  - `brandSystem.color_system.atmosphere[]` → `[{hex, name, role, usage}]`
  - `brandSystem.color_system.color_mood` → string description
  - `brandSystem.typography_system.headline` → `{font_family, weight}`
  - `brandSystem.typography_system.subheadline` → `{font_family, weight}`
  - `brandSystem.typography_system.body` → `{font_family, weight}`
  - `brandSystem.visual_language.mood_keywords[]` → personality adjectives
  - `brandSystem.visual_language.style` → visual style description
  - `brandSystem.visual_language.lighting` → lighting description
  - `brandSystem.visual_language.composition` → `{style, density, whitespace}`
  - `brandSystem.photography_direction` → `{style, subject_treatment, lighting_setup, color_treatment, depth_of_field, framing}`
  - `brandSystem.iconography` → `{style, stroke_rule, shape_grammar, icon_names[], containment}`
  - `brandSystem.patterns_and_motifs` → `{sources, seeds[], application_rules[]}`
  - `brandSystem.material_and_depth` → `{surface, shadow_style, layer_depth, reasoning}`
  - `brandSystem.motion` → `{style, easing, speed, transitions}` (style: "none"|"subtle"|"expressive"|"cinematic")
  - `brandSystem.layout_grammar` → `{grid_system, border_radius, card_style}`
  - `brandSystem.brand_voice` → `{tone_pillars[], writing_style, vocabulary_level, sentence_style}`
  - `brandSystem.design_direction` → `{keep[], change[], add[], confidence_score}`
  - `brandSystem.brand_header` → `{brand_name, brand_statement, soul_descriptors[], brand_archetype, tagline, industry, target_audience}`
  - `brandSystem.brand_applications[]` → `[{type, detail, priority}]`

---

## PRIORITY CHAINS

For every resolved field, use the first non-null value in this order:

### Colors
```
1. Brand System  →  brandSystem.color_system.foundation[0].hex  (highest — human-curated)
2. Design Eval   →  onboard.designEvaluation.styleGuide.colors.primary.hex  (Claude vision — high accuracy)
3. Scraper       →  content.colors.primary  (CSS hex-frequency — noisy, low accuracy)
4. Vertical Default → VERTICAL_DEFAULTS[vertical].primary  (generic fallback)
```

For secondary: Brand System emphasis[0] → Design Eval secondary → scraper secondary → vertical default
For accent: Brand System emphasis[1] or atmosphere[0] → Design Eval tertiary → scraper accent → vertical default

**Add a "Source" column to the color table showing which level resolved (brand-system / design-eval / css-extraction / vertical-default).**

### Typography
```
1. Brand System  →  brandSystem.typography_system.headline.font_family
2. Design Eval   →  onboard.designEvaluation.styleGuide.typography.headingSystem.fontFamily
3. Vertical Default → VERTICAL_DEFAULTS[vertical].headingFont
```

Same chain for body fonts.

### Personality / Mood
```
1. Brand System  →  brandSystem.visual_language.mood_keywords.join(', ')
2. Brand System  →  brandSystem.brand_header.soul_descriptors.join(', ')
3. Vertical Default → VERTICAL_DEFAULTS[vertical].personality
```

### Motion
```
1. Brand System  →  brandSystem.motion.style  (none/subtle/expressive/cinematic)
2. Design Eval   →  onboard.designEvaluation.styleGuide.motion.level
3. Default       →  'subtle'
```

### Border Radius
```
1. Brand System  →  brandSystem.layout_grammar.border_radius
2. Vertical Default → VERTICAL_DEFAULTS[vertical].borderRadius
```

### Layout
```
1. Brand System  →  brandSystem.layout_grammar.grid_system
2. Design Eval   →  onboard.designEvaluation.styleGuide.layout.gridSystem
3. Default       →  (omit — let Claude decide)
```

---

## SECTION-BY-SECTION CHANGES

### §1 CLIENT IDENTITY — Add fields

After the existing Place ID line, add:
```markdown
- **Tagline:** "${brandSystem.brand_header?.tagline || social.description || '—'}"
- **Target Audience:** ${brandSystem.brand_header?.target_audience || '—'}
- **Brand Archetype:** ${brandSystem.brand_header?.brand_archetype || '—'}
- **Meta Description:** ${social.description || '—'}
```

### §2 VISUAL SYSTEM — Major rewrite

Replace the entire color resolution block at the top of `generateDesignMd()`. Use the priority chains defined above.

The Color table should show:
```
| Role       | Hex     | Source          | Confidence |
|------------|---------|-----------------|------------|
| Primary    | #1a3c5e | design-eval     | high       |
| Secondary  | #d4a853 | brand-system    | curated    |
| ...        |         |                 |            |
```

If Brand System has `color_system.color_mood`, add it:
```markdown
- **Color Mood:** ${brandSystem.color_system.color_mood}
```

Typography table should show the resolved font + its source:
```
| Role     | Font                  | Weight | Source       |
|----------|-----------------------|--------|--------------|
| Heading  | Playfair Display      | 700    | brand-system |
| Body     | Open Sans             | 400    | design-eval  |
```

Add a **Visual Language** subsection if Brand System data exists:
```markdown
### Visual Language
- **Style:** ${brandSystem.visual_language.style}
- **Lighting:** ${brandSystem.visual_language.lighting}
- **Composition:** ${brandSystem.visual_language.composition.style} · density: ${brandSystem.visual_language.composition.density} · whitespace: ${brandSystem.visual_language.composition.whitespace}
```

Add a **Photography Direction** subsection if Brand System data exists:
```markdown
### Photography Direction
- **Style:** ${brandSystem.photography_direction.style}
- **Lighting:** ${brandSystem.photography_direction.lighting_setup}
- **Color Treatment:** ${brandSystem.photography_direction.color_treatment}
- **Framing:** ${brandSystem.photography_direction.framing}
```

### §3 CONTENT INVENTORY — Add voice guidance

After Navigation Labels, add if Brand System voice data exists:
```markdown
### Brand Voice (apply to all generated copy)
- **Tone:** ${brandSystem.brand_voice.tone_pillars.join(', ')}
- **Writing Style:** ${brandSystem.brand_voice.writing_style}
- **Vocabulary Level:** ${brandSystem.brand_voice.vocabulary_level}
```

Also add headline fallback from Social Preview:
- For heroHeadline: `copy.heroHeadline || social.title || prospect.name`
- For heroSubheadline: `copy.heroSubheadline || copy.tagline || social.description || 'Professional service in...'`

### §4 ASSETS MANIFEST — Add logo analysis

If Brand System has logo vision analysis, add after the logo status line:
```markdown
- **Logo Analysis:** ${brandSystem.visual_language.logo_vision.iconography_style.style} · ${brandSystem.visual_language.logo_vision.shape_language.primary} shapes · ${brandSystem.visual_language.logo_vision.containment_shape}
```

### §5 PAGE STRUCTURE — Add layout intelligence

After Detected Flags, add if Design Eval or Brand System layout data exists:
```markdown
### Layout Intelligence
- **Framing:** ${designEval.styleGuide.layout.framing || '—'}
- **Grid System:** ${brandSystem.layout_grammar.grid_system || designEval.styleGuide.layout.gridSystem || '—'}
- **Card Style:** ${brandSystem.layout_grammar.card_style || '—'}
- **Composition Density:** ${brandSystem.visual_language.composition.density || '—'}
- **Whitespace:** ${brandSystem.visual_language.composition.whitespace || '—'}
```

### §6 ANIMATION DIRECTIVES — Replace hardcoded values

Replace the hardcoded Global Motion block. Use resolved motion data:

```javascript
const motionStyle = brandSystem?.motion?.style
  || designEval?.styleGuide?.motion?.level
  || 'subtle';

const motionEasing = brandSystem?.motion?.easing || 'power2.out';
const motionSpeed  = brandSystem?.motion?.speed  || 'medium';

// Map motion style to duration range
const MOTION_DURATIONS = {
  none: '0s (no animation)',
  subtle: '0.4s–0.8s',
  expressive: '0.6s–1.2s',
  cinematic: '0.8s–1.6s',
  moderate: '0.6s–1.0s',
  bold: '0.8s–1.4s',
};
```

Output:
```markdown
### Global Motion
- **Library:** GSAP 3 + ScrollTrigger (CDN)
- **Kit:** gsap-kit.js (shared presets — do NOT write custom GSAP)
- **Motion Style:** ${motionStyle}
- **Default easing:** ${motionEasing}
- **Speed:** ${motionSpeed}
- **Duration range:** ${MOTION_DURATIONS[motionStyle] || '0.6s–1.2s'}
- **Scroll trigger offset:** top 85%
```

If Brand System has transitions info, add:
```markdown
- **Transition Style:** ${brandSystem.motion.transitions}
```

### §7 TECHNICAL REQUIREMENTS — Add specific issues

After the Performance Targets subsection, add Core Web Vitals if available:
```markdown
### Core Web Vitals (current)
- LCP: ${psi.scores?.largest_contentful_paint || '?'}ms (target: < 2500ms)
- FID: ${psi.scores?.first_input_delay || '?'}ms (target: < 100ms)
- CLS: ${psi.scores?.cumulative_layout_shift || '?'} (target: < 0.1)
```

After Accessibility, add specific SEO findings if available:
```markdown
### SEO Issues to Fix (from audit)
${seoFindings.slice(0, 6).map(f => `- [${f.severity}] ${f.issue} → ${f.fix}`).join('\n') || '_No specific issues found._'}

### AI Readiness Checks
${aiChecks.slice(0, 8).map(c => `- [${c.status}] ${c.name}: ${c.verdict}`).join('\n') || '_Run onboard to populate._'}
```

### §8 BEFORE / AFTER CONTEXT — Expand

Add dimension breakdown from Agent Readiness:
```markdown
### Readiness Dimensions
${formatTable(['Dimension', 'Score', 'Verdict'], Object.entries(ai.dimensions || {}).map(([k, v]) => [k, v.score, v.verdict]))}
```

Add strengths to preserve:
```markdown
### Strengths to Preserve
${(ai.highlights || []).map(h => `- ${h}`).join('\n') || '_None detected._'}
```

Add Design Eval summary:
```markdown
### Current Design Assessment
${designEval?.styleGuide?.summary || '_Not evaluated._'}
- **Confidence:** ${designEval?.styleGuide?.confidence || '—'}
```

### §9 OPERATOR NOTES — Auto-populate from Brand System

**This is the highest-impact change.** Replace the static placeholder with auto-generated creative direction from Brand System:

```javascript
function buildOperatorNotes(brandSystem) {
  if (!brandSystem) return '_No brand intelligence available. Add creative direction manually._';

  const lines = [];
  const dd = brandSystem.design_direction;
  if (dd) {
    if (dd.keep?.length)   lines.push(`**KEEP from current site:**\n${dd.keep.map(k => `- ${k}`).join('\n')}`);
    if (dd.change?.length) lines.push(`**CHANGE:**\n${dd.change.map(c => `- ${c}`).join('\n')}`);
    if (dd.add?.length)    lines.push(`**ADD:**\n${dd.add.map(a => `- ${a}`).join('\n')}`);
    if (dd.confidence_score != null) lines.push(`_Design direction confidence: ${dd.confidence_score}/100_`);
  }

  const icon = brandSystem.iconography;
  if (icon?.style) {
    lines.push(`\n**Iconography:**\n- Style: ${icon.style}\n- Stroke: ${icon.stroke_rule || '—'}\n- Shape grammar: ${icon.shape_grammar || '—'}\n- Containment: ${icon.containment || '—'}`);
    if (icon.icon_names?.length) lines.push(`- Suggested icons: ${icon.icon_names.join(', ')}`);
  }

  const pat = brandSystem.patterns_and_motifs;
  if (pat?.seeds?.length) {
    lines.push(`\n**Patterns & Motifs:**\n- Seeds: ${pat.seeds.join(', ')}`);
    if (pat.application_rules?.length) lines.push(`- Rules: ${pat.application_rules.join('; ')}`);
  }

  const mat = brandSystem.material_and_depth;
  if (mat?.surface) {
    lines.push(`\n**Material & Depth:**\n- Surface: ${mat.surface}\n- Shadow: ${mat.shadow_style || '—'}\n- Depth: ${mat.layer_depth || '—'}`);
  }

  if (brandSystem.brand_applications?.length) {
    lines.push(`\n**Brand Application Priorities:**\n${brandSystem.brand_applications.map(a => `- [${a.priority}] ${a.type}: ${a.detail}`).join('\n')}`);
  }

  return lines.join('\n\n') || '_Brand system started but no creative direction captured yet._';
}
```

### §10 GENERATION STATUS — No changes needed

---

## VERTICAL_DEFAULTS EXPANSION

The current `VERTICAL_DEFAULTS` object only has 5 entries (lawyer, dental, home_services, restaurant, default). Add entries for the 7 missing verticals from `vertical-map.js`:

```javascript
med_spa: {
  primary:       '#7c3aed',
  secondary:     '#ec4899',
  accent:        '#14b8a6',
  headingFont:   "'Cormorant Garamond', serif",
  bodyFont:      "'Inter', sans-serif",
  borderRadius:  '12px',
  personality:   'luxurious, calming, clinical-chic, rejuvenating',
  mood:          'A premium wellness destination — serene, confident, transformative',
},
auto_shop: {
  primary:       '#1e3a5f',
  secondary:     '#dc2626',
  accent:        '#f59e0b',
  headingFont:   "'Oswald', sans-serif",
  bodyFont:      "'Source Sans 3', sans-serif",
  borderRadius:  '4px',
  personality:   'dependable, no-nonsense, skilled, honest',
  mood:          'A mechanic who tells it to you straight — trusted, capable, fair',
},
chiro: {
  primary:       '#0d9488',
  secondary:     '#1e40af',
  accent:        '#84cc16',
  headingFont:   "'Raleway', sans-serif",
  bodyFont:      "'Nunito Sans', sans-serif",
  borderRadius:  '8px',
  personality:   'holistic, caring, evidence-based, restorative',
  mood:          'Natural healing backed by science — warm, professional, aligned',
},
fitness: {
  primary:       '#111827',
  secondary:     '#ef4444',
  accent:        '#22c55e',
  headingFont:   "'Montserrat', sans-serif",
  bodyFont:      "'Inter', sans-serif",
  borderRadius:  '6px',
  personality:   'energetic, motivating, bold, community-driven',
  mood:          'Push your limits — intense, supportive, results-focused',
},
real_estate: {
  primary:       '#1e3a5f',
  secondary:     '#b8860b',
  accent:        '#059669',
  headingFont:   "'Libre Baskerville', serif",
  bodyFont:      "'Lato', sans-serif",
  borderRadius:  '4px',
  personality:   'aspirational, trustworthy, polished, market-savvy',
  mood:          'Your home search starts here — sophisticated, knowledgeable, personal',
},
wedding: {
  primary:       '#be185d',
  secondary:     '#d4a853',
  accent:        '#7c3aed',
  headingFont:   "'Cormorant Garamond', serif",
  bodyFont:      "'Quicksand', sans-serif",
  borderRadius:  '16px',
  personality:   'romantic, elegant, joyful, detail-oriented',
  mood:          'Your perfect day, perfectly planned — dreamy, bespoke, memorable',
},
veterinary: {
  primary:       '#059669',
  secondary:     '#2563eb',
  accent:        '#f59e0b',
  headingFont:   "'Nunito', sans-serif",
  bodyFont:      "'Open Sans', sans-serif",
  borderRadius:  '12px',
  personality:   'compassionate, gentle, expert, reassuring',
  mood:          'Where your pet is family too — warm, professional, caring',
},
```

---

## generate-mockup/route.js — VERTICAL_STYLE EXPANSION

Add matching entries to the `VERTICAL_STYLE` object in `app/api/leadgen/generate-mockup/route.js`:

```javascript
const VERTICAL_STYLE = {
  lawyer:        'authoritative navy + gold palette, serif headings, formal and trustworthy',
  dental:        'bright blues and whites, rounded corners, clean clinical feel, friendly',
  home_services: 'bold orange accents, strong sans-serif type, blue/dark backgrounds, reliable',
  restaurant:    'warm rich tones, elegant typography, large food photography, inviting',
  med_spa:       'soft purples and teals, elegant serif headings, luxury spa aesthetic, calming',
  auto_shop:     'dark navy with red accents, bold condensed sans-serif, automotive imagery, tough and trustworthy',
  chiro:         'teal and green palette, clean rounded elements, wellness imagery, holistic and professional',
  fitness:       'dark backgrounds with red accents, bold sans-serif, high-energy athletic photography, intense',
  real_estate:   'navy and gold palette, serif headings, aspirational property photography, sophisticated',
  wedding:       'soft pinks and golds, elegant serif typography, romantic photography, dreamy and detailed',
  veterinary:    'greens and blues, friendly rounded type, pet photography, warm and compassionate',
  default:       'modern professional, clean white backgrounds, strong typography, trustworthy',
};
```

Additionally, modify `buildMockupPrompt()` to check for DESIGN.MD visual data first:

```javascript
function buildMockupPrompt(prospect, content) {
  // If DESIGN.MD has been generated with enriched visual data, use it
  const designMd = prospect.generation?.designMd;
  // ... existing code, but override style/colors from designMd when available
}
```

---

## prepare-brief/route.js — PASS BRAND SYSTEM DATA

In `app/api/leadgen/prepare-brief/route.js`, update the `generateDesignMd()` call to include Brand System data:

```javascript
// After: const prospect = snap.data();
// Add Brand System resolution
const brandGuide = prospect.brandGuide
  || prospect.userUploads?.brandSystem?.brandGuideV2
  || null;

// Update the generateDesignMd call
const designMd = generateDesignMd({
  prospect,
  onboard: prospect.onboard || {},
  content,
  assetManifest,
  brandSystem: brandGuide,  // NEW PARAM
});
```

Update the function signature in `design-md-generator.js`:
```javascript
export function generateDesignMd({ prospect, onboard = {}, content = {}, assetManifest = null, brandSystem = null }) {
```

---

## IMPLEMENTATION RULES

1. **Do NOT remove any existing data wires.** Only add new ones. Existing scraper data must continue to work as fallbacks.

2. **Every resolution must be null-safe.** Use optional chaining (`?.`) and the existing `safe()` helper. If Brand System wasn't run, everything should fall back gracefully.

3. **Keep the `formatTable()` helper.** Use it for all new tables. Don't introduce new formatting patterns.

4. **Source attribution matters.** Every resolved value in §2 should show its source (brand-system / design-eval / css-extraction / vertical-default). This helps debug which module influenced the output.

5. **The template literal output must remain a single returned string.** Don't refactor into multiple files or a template engine. The function returns one markdown string.

6. **Test with no onboard data.** When `onboard = {}` and `brandSystem = null`, the output should look identical to today's output. This is a non-breaking change.

7. **Preserve the existing comment style.** Use `// ── Comment ──` with box-drawing characters for section headers.

---

## VERIFICATION CHECKLIST

After implementation, verify:

- [ ] `generateDesignMd({ prospect, onboard: {}, content: {}, assetManifest: null })` produces output identical to current (backward compatible)
- [ ] When `onboard.designEvaluation.styleGuide` exists, its colors and fonts override scraper values
- [ ] When `brandSystem` exists, its values override both Design Eval and scraper
- [ ] §9 Operator Notes is auto-populated when Brand System `design_direction` exists
- [ ] §6 Animation uses Brand System `motion` values when available
- [ ] All 12 verticals have entries in `VERTICAL_DEFAULTS`
- [ ] All 12 verticals have entries in `VERTICAL_STYLE` (generate-mockup)
- [ ] `prepare-brief/route.js` passes `brandSystem` param through
- [ ] No new imports are needed (all data comes through function params)
- [ ] No breaking changes to the function signature (brandSystem defaults to null)
