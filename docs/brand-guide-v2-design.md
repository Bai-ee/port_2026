# Brand Guide v2 — Design Document

## Executive Summary

Expand the Brand System pipeline from a single-purpose image prompt generator into a **multi-mode Brand DNA engine** that produces the most accurate, complete brand guide possible — one that can drive brand identity posters, storyboards, cinematic direction, product shots, website mockups, character sheets, and social media assets from a single source of truth.

**Key changes from v1:**

- Schema v2: ~60 fields across 14 sections (up from ~20 fields across 8 sections)
- 6 prompt templates instead of 1 hardcoded master prompt
- 8+ asset upload types with dedicated vision analysis per type (up from logo-only)
- Homepage screenshot review + user feedback loop (new Phase 1)
- Runs AFTER mockup generation to use screenshots as input
- Photography direction, brand archetype, animation/motion, and layout grammar sections (all new)
- Expanded color system: 15+ swatches with foundation/emphasis/atmosphere roles, gradients, pairings
- Typography specimens with headline/subheadline/body examples rendered in the prompt

---

## Table of Contents

1. [Pipeline Phases](#1-pipeline-phases)
2. [Schema v2 — Brand DNA JSON](#2-schema-v2--brand-dna-json)
3. [Expanded Gap Definitions](#3-expanded-gap-definitions)
4. [Vision Analysis Modules](#4-vision-analysis-modules)
5. [Prompt Templates (Multi-Mode)](#5-prompt-templates-multi-mode)
6. [File Changes](#6-file-changes)
7. [Frontend Flow Changes](#7-frontend-flow-changes)
8. [API Route Changes](#8-api-route-changes)
9. [Migration Strategy](#9-migration-strategy)
10. [Implementation Order](#10-implementation-order)

---

## 1. Pipeline Phases

### v1 (current): 2 phases
```
SCAN → CHAT (5 questions) → Done
```

### v2 (proposed): 5 phases

```
Phase 0: Auto-fill from pipeline (unchanged — runs automatically)
    ↓
Phase 1: Site Review + Feedback (NEW)
    Show homepage mockup → user says what works / what doesn't
    Vision-analyze the screenshot for design signals
    Produce design_direction { keep[], change[], add[] }
    ↓
Phase 2: Asset Upload + Vision Analysis (EXPANDED)
    Logo → shape language, motifs, stroke logic, icon grammar
    Mood board (1-5 images) → style extraction, color themes, texture cues
    Brand photos → photography direction, art direction, subject treatment
    Competitor screenshots → differentiation signals, positioning gaps
    Product shots → packaging direction, render style, material treatment
    Color/font files → palette validation, typography specimen generation
    ↓
Phase 3: Brand DNA Questions (EXPANDED from 5 → 13 gaps)
    Soul descriptors · Visual world · Lighting · Material (existing)
    + Photography direction · Brand archetype · Composition style
    + Color mood · Animation/motion intent · Layout grammar
    + Target format · Brand applications · Headline specimen
    ↓
Phase 4: Assembly (EXPANDED)
    Merge all sources → Brand Guide JSON v2
    Track source attribution for every field
    ↓
Phase 5: Multi-mode Output (NEW)
    Select prompt template → generate mode-specific prompt
    Templates: poster, storyboard, product shot, web design,
               character sheet, social media
```

### Phase 1: Site Review + Feedback (new)

This phase uses the homepage mockup artifacts already in the pipeline (desktop screenshot, device mockup, full-page screenshot) and presents them to the user for guided review.

**Questions asked:**
1. "Here's your homepage as it looks today. What do you love about it visually?" → `design_direction.keep[]`
2. "What feels off or inconsistent?" → `design_direction.change[]`
3. "What visual elements or styles would you like to add that aren't there yet?" → `design_direction.add[]`
4. "On a scale of 1-5, how close is this to your ideal visual identity?" → `design_direction.confidence_score`

**Vision analysis runs in parallel:** While the user answers, Claude vision analyzes the homepage screenshot and extracts:
- `layout_patterns`: grid structure, whitespace rhythm, section density
- `photo_treatment`: current photography style (if any images present)
- `ui_components`: button styles, card patterns, navigation treatment
- `color_usage`: how the extracted palette is actually applied
- `typography_hierarchy`: visual weight distribution across headings/body
- `overall_impression`: professional/amateur, template/custom, cohesive/fragmented

This vision analysis is stored as `siteVisionAnalysis` and feeds into the Brand Guide assembly.

---

## 2. Schema v2 — Brand DNA JSON

```jsonc
{
  "schema_version": 2,
  "title": "Brand Guide — [brand_name]",
  
  // ── Section 1: Brand Header ──────────────────────────────────
  "brand_header": {
    "brand_name": "Not The Rug",
    "brand_statement": "Ten ideas. Zero fluff. All impact.",  // 6-8 words
    "soul_descriptors": ["happy", "helpful", "sunny"],        // exactly 3
    "brand_archetype": "creator",                              // NEW
    "tagline": "We bring joy to the process.",                 // NEW — short tagline
    "industry": "creative agency",
    "target_audience": "ambitious brands seeking clarity"      // NEW
  },

  // ── Section 2: Color System (EXPANDED) ───────────────────────
  "color_system": {
    "foundation": [
      { "hex": "#0F0F0F", "name": "Ink", "role": "foundation", "usage": "primary text, headers" },
      { "hex": "#F7F7F5", "name": "Paper", "role": "foundation", "usage": "backgrounds, cards" },
      { "hex": "#EAE2D6", "name": "Sand", "role": "foundation", "usage": "secondary backgrounds" },
      { "hex": "#C7C7C7", "name": "Concrete", "role": "foundation", "usage": "borders, dividers" }
    ],
    "emphasis": [
      { "hex": "#FFCS17", "name": "Sunshine", "role": "emphasis", "usage": "primary accent, CTAs" },
      { "hex": "#FF6A00", "name": "Energy", "role": "emphasis", "usage": "hover states, highlights" },
      { "hex": "#FF4DA6", "name": "Play", "role": "emphasis", "usage": "secondary accent" },
      { "hex": "#0066FF", "name": "Trust", "role": "emphasis", "usage": "links, interactive elements" }
    ],
    "atmosphere": [
      { "hex": "#00C894", "name": "Fresh", "role": "atmosphere", "usage": "success states" },
      { "hex": "#B3B8FF", "name": "Dream", "role": "atmosphere", "usage": "soft backgrounds" },
      { "hex": "#7AC7FF", "name": "Sky", "role": "atmosphere", "usage": "light accents" },
      { "hex": "#0A1E3F", "name": "Night", "role": "atmosphere", "usage": "dark mode base" }
    ],
    "gradients": [
      { "name": "Sunrise", "stops": ["#FFCS17", "#FF6A00"], "direction": "135deg" },
      { "name": "Sea Breeze", "stops": ["#7AC7FF", "#00C894"], "direction": "90deg" },
      { "name": "Dream Fog", "stops": ["#B3B8FF", "#FF4DA6"], "direction": "180deg" }
    ],
    "pairings": [
      { "name": "Sunshine + Ink", "foreground": "#FFCS17", "background": "#0F0F0F" },
      { "name": "Paper + Energy", "foreground": "#F7F7F5", "background": "#FF6A00" },
      { "name": "Trust + Paper", "foreground": "#0066FF", "background": "#F7F7F5" },
      { "name": "Mint + Ink", "foreground": "#00C894", "background": "#0F0F0F" }
    ],
    "color_mood": "optimistic"  // NEW — overall color temperature/mood
  },

  // ── Section 3: Typography System (EXPANDED) ──────────────────
  "typography_system": {
    "headline": {
      "font_family": "Recoleta Bold",
      "weight": "bold",
      "style": "serif",
      "case": "sentence",          // NEW — sentence | uppercase | lowercase | title
      "letter_spacing": "tight"    // NEW — tight | normal | wide | extra-wide
    },
    "subheadline": {
      "font_family": "Inter",
      "weight": "medium",
      "style": "sans-serif"
    },
    "body": {
      "font_family": "Inter Regular",
      "weight": "regular",
      "style": "sans-serif",
      "line_height": "relaxed"     // NEW — tight | normal | relaxed
    },
    "specimens": {                  // NEW — actual text examples
      "headline_example": "Big thinking.\nSmall words.\nReal results.",
      "subheadline_example": "We partner with bold teams to turn ideas into clarity—and clarity into momentum.",
      "body_example": "Nottherug-Ten is a creative studio and digital partner for ambitious brands. We help you cut through complexity, connect with your audience, and grow with intention. Ten ideas. Zero fluff. All impact."
    }
  },

  // ── Section 4: Visual Language ───────────────────────────────
  "visual_language": {
    "style": "editorial",           // editorial | cinematic | industrial | organic | futuristic
    "lighting": "overcast natural",
    "texture": "polished plastic",
    "industry": "creative agency",
    "mood_keywords": ["overcast natural light", "polished plastic surfaces", "optimistic colors", "editorial clarity"],
    "composition": {                // NEW
      "style": "layered-dense",     // layered-dense | minimal-breathing | grid-strict | asymmetric | organic-flow
      "density": "magazine-dense",
      "whitespace": "intentional-minimal"
    }
  },

  // ── Section 5: Photography Direction (NEW) ───────────────────
  "photography_direction": {
    "style": "editorial",           // editorial | documentary | studio | lifestyle | abstract
    "subject_treatment": "candid-natural",  // posed-formal | candid-natural | action-dynamic | still-life | environmental
    "lighting_setup": "overcast natural",
    "color_treatment": "warm-saturated",    // desaturated | natural | warm-saturated | cool-toned | high-contrast-bw
    "depth_of_field": "selective",          // deep | selective | shallow-bokeh
    "framing": "tight-crop",               // wide-environmental | medium | tight-crop | extreme-close-up
    "post_processing": "minimal-clean",    // raw-unedited | minimal-clean | editorial-graded | heavy-stylized
    "art_direction_notes": "Overcast natural light. Polished plastic surfaces. Optimistic colors. Editorial clarity.",
    "reference_mood": []                    // populated from mood board vision analysis
  },

  // ── Section 6: Iconography ──────────────────────────────────
  "iconography": {
    "style": "geometric solid",
    "stroke_rule": "solid fills with white negative space, no outlines, serif-inspired details",
    "shape_grammar": "circular",
    "stroke_logic": { "treatment": "solid-fill", "weight": "heavy" },
    "count": "6-10",
    "icon_names": ["community", "growth", "focus", "happiness", "forward", "care", "organize", "energy", "balance"],
    "containment": "circular"       // NEW — circular | square | rounded-square | none
  },

  // ── Section 7: Patterns & Motifs ────────────────────────────
  "patterns_and_motifs": {
    "sources": "Derived from logo geometry.",
    "seeds": ["stacked text blocks", "horizontal divider lines", "circular containment"],
    "application_rules": [          // NEW
      "Use as background textures at 5-10% opacity",
      "Use as section dividers between content blocks",
      "Use as decorative elements in brand applications"
    ]
  },

  // ── Section 8: Material & Depth ─────────────────────────────
  "material_and_depth": {
    "surface": "polished plastic",
    "shadow_style": "directional",  // directional | ambient | dramatic | flat-none
    "layer_depth": "pronounced",    // flat | subtle | pronounced | dramatic
    "reasoning": "The flat color treatment and serif typography suggest traditional print applications rather than digital surfaces."
  },

  // ── Section 9: Brand Applications ───────────────────────────
  "brand_applications": [
    { "type": "Product Packaging", "detail": "Dimensional, realistic render", "priority": 1 },
    { "type": "Website Hero", "detail": "Full desktop viewport with nav + CTA", "priority": 1 },
    { "type": "Mobile App Screen", "detail": "One key UI moment (home or onboarding)", "priority": 2 },
    { "type": "Social Media Posts", "detail": "3 formats — square (1:1), story (9:16), banner (16:9)", "priority": 1 },
    { "type": "Business Card", "detail": "Front and back with contact info specimen", "priority": 2 },
    { "type": "Out-of-Home Ad", "detail": "Billboard or transit panel", "priority": 3 }
  ],

  // ── Section 10: Brand Voice (NEW) ───────────────────────────
  "brand_voice": {
    "tone_pillars": [],             // pulled from brandTone pipeline data
    "writing_style": null,          // formal | conversational | playful | authoritative
    "vocabulary_level": null,       // simple | moderate | sophisticated | technical
    "sentence_style": null          // short-punchy | medium-flowing | long-complex | varied
  },

  // ── Section 11: Design Direction (NEW — from site review) ──
  "design_direction": {
    "keep": [],                     // what user loves about current site
    "change": [],                   // what feels off
    "add": [],                      // what they want to add
    "confidence_score": null,       // 1-5 how close current site is to ideal
    "site_vision_analysis": null    // Claude vision analysis of homepage
  },

  // ── Section 12: Motion & Animation (NEW) ────────────────────
  "motion": {
    "style": null,                  // none | subtle | expressive | cinematic
    "easing": null,                 // linear | ease-in-out | spring | bounce
    "speed": null,                  // instant | fast | moderate | slow-deliberate
    "transitions": null             // fade | slide | scale | morph
  },

  // ── Section 13: Layout Grammar (NEW) ────────────────────────
  "layout_grammar": {
    "grid_system": null,            // 12-col | 8-col | fluid | masonry | freeform
    "spacing_scale": null,          // 4px | 8px | custom
    "border_radius": null,          // sharp | subtle (4px) | rounded (8px) | pill | circle
    "card_style": null              // flat | elevated | bordered | glass
  },

  // ── Section 14: Quality Standard ────────────────────────────
  "quality_standard": {
    "benchmark": "Must look like it costs $15,000 to produce.",
    "total_elements": "30–50 distinct visual elements.",
    "failure_conditions": [
      "Looks templated",
      "Generic placeholders",
      "Disconnected elements",
      "Sparse sections"
    ]
  },

  // ── Metadata ────────────────────────────────────────────────
  "format": {
    "layout": "Multi-column grid",
    "aspect_ratio": "4:5",
    "orientation": "Vertical",
    "composition": "Layered, dense, intentional — zero wasted space"
  },
  "sources": {},                    // field → "pipeline" | "user" | "vision" | "inferred"
  "generated_at": null,
  "assets": {                       // NEW — references to uploaded/analyzed assets
    "logo": { "url": null, "vision_analysis": null },
    "mood_board": [],               // array of { url, vision_analysis }
    "brand_photos": [],
    "competitor_screenshots": [],
    "product_shots": [],
    "homepage_screenshot": { "url": null, "vision_analysis": null }
  }
}
```

### Key differences from v1:

| Dimension | v1 | v2 |
|-----------|----|----|
| Color swatches | 3-4 (primary/secondary/accent) | 12-16 with names, roles, usage |
| Gradients | none | 3+ gradient definitions |
| Color pairings | none | 4+ foreground/background combos |
| Typography | font family + weight only | + case, spacing, line-height, specimens |
| Photography | none | full direction (8 fields) |
| Brand voice | none | tone, style, vocabulary, sentence rhythm |
| Design direction | none | keep/change/add from user feedback |
| Motion/animation | none | style, easing, speed, transitions |
| Layout grammar | none | grid, spacing, radius, card style |
| Iconography | basic | + count, icon names, containment |
| Asset references | logo URL only | logo + mood board + photos + competitors + products |
| Source tracking | 9 fields | all fields tracked |

---

## 3. Expanded Gap Definitions

### Phase 1: Site Review (new gaps)

```javascript
// Phase 1 gaps — presented with homepage screenshot visible
{
  id: 'site-review-love',
  phase: 1,
  label: 'Looking at your homepage — what do you love about the visual direction?',
  type: 'text',
  required: false,          // skippable — user might not have a site yet
  showsScreenshot: true,    // tells UI to display homepage mockup alongside
},
{
  id: 'site-review-change',
  phase: 1,
  label: 'What feels off or inconsistent? What would you change visually?',
  type: 'text',
  required: false,
  showsScreenshot: true,
},
{
  id: 'site-review-add',
  phase: 1,
  label: 'What visual elements or styles would you like to add that aren\'t there yet?',
  type: 'text',
  required: false,
  showsScreenshot: true,
},
{
  id: 'site-review-confidence',
  phase: 1,
  label: 'On a scale of 1-5, how close is this to your ideal visual identity?',
  type: 'choice',
  choices: ['1 — Starting over', '2 — Major changes needed', '3 — Good bones, needs refinement', '4 — Almost there', '5 — Love it as-is'],
  required: false,
  showsScreenshot: true,
},
```

### Phase 2: Asset Uploads (new gaps)

```javascript
{
  id: 'logo',                // existing — unchanged
  phase: 2,
  label: 'Upload your logo. I\'ll analyze its shape language, color, and visual grammar.',
  type: 'image',
  acceptsImage: true,
  required: true,
  maxFiles: 1,
},
{
  id: 'mood-board',           // NEW
  phase: 2,
  label: 'Upload 1-5 mood board or reference images that capture the visual direction you want.',
  type: 'image-multi',       // new type — multi-file upload
  acceptsImage: true,
  required: false,
  maxFiles: 5,
  hint: 'These can be other brands you admire, design inspiration, photography styles, color palettes — anything that says "this is the vibe."',
},
{
  id: 'brand-photos',         // NEW
  phase: 2,
  label: 'Upload existing brand photography — headshots, product shots, lifestyle images.',
  type: 'image-multi',
  acceptsImage: true,
  required: false,
  maxFiles: 10,
  hint: 'I\'ll extract your photography direction: lighting, color treatment, framing, and subject style.',
},
{
  id: 'competitor-refs',      // NEW
  phase: 2,
  label: 'Upload screenshots of competitors or brands in your space you want to differentiate from.',
  type: 'image-multi',
  acceptsImage: true,
  required: false,
  maxFiles: 5,
  hint: 'I\'ll map what they do visually so your brand stands apart.',
},
{
  id: 'product-shots',        // NEW
  phase: 2,
  label: 'Upload existing product shots or packaging if you have them.',
  type: 'image-multi',
  acceptsImage: true,
  required: false,
  maxFiles: 5,
},
{
  id: 'color-palette',        // NEW
  phase: 2,
  label: 'Upload a color palette image or screenshot if you have specific colors in mind.',
  type: 'image',
  acceptsImage: true,
  required: false,
  maxFiles: 1,
  hint: 'A screenshot from Coolors, Adobe Color, or a palette image. I\'ll extract exact hex values.',
},
```

### Phase 3: Brand DNA Questions (expanded)

```javascript
// Existing gaps (unchanged)
{ id: 'soul-descriptors', ... },
{ id: 'visual-language', ... },
{ id: 'lighting', ... },
{ id: 'material', ... },

// NEW gaps
{
  id: 'photo-direction',
  phase: 3,
  label: 'How should brand photography feel?',
  type: 'choice',
  choices: ['editorial — magazine-quality, art-directed', 'documentary — real, unposed, authentic', 'studio — clean, controlled, product-focused', 'lifestyle — aspirational, environmental', 'abstract — textures, shapes, conceptual'],
  required: false,         // can be inferred from mood board
},
{
  id: 'brand-archetype',
  phase: 3,
  label: 'Which brand archetype fits best?',
  type: 'choice',
  choices: ['creator — innovative, imaginative', 'explorer — adventurous, independent', 'sage — knowledgeable, trusted', 'hero — bold, ambitious'],
  required: false,
},
{
  id: 'composition-style',
  phase: 3,
  label: 'How dense should the visual compositions be?',
  type: 'choice',
  choices: ['magazine-dense — every inch used', 'balanced — structured with breathing room', 'minimal — lots of whitespace', 'asymmetric — dynamic, unexpected layouts'],
  required: false,
},
{
  id: 'color-mood',
  phase: 3,
  label: 'What is the overall color mood?',
  type: 'choice',
  choices: ['optimistic — warm, bright, energetic', 'calm — cool, muted, serene', 'bold — high contrast, saturated', 'neutral — earthy, understated'],
  required: false,         // can be inferred from color system
},
{
  id: 'motion-intent',
  phase: 3,
  label: 'If this brand had motion/animation, how would it feel?',
  type: 'choice',
  choices: ['none — purely static', 'subtle — gentle fades, micro-interactions', 'expressive — playful, bouncy, attention-grabbing', 'cinematic — smooth, dramatic, film-quality'],
  required: false,
},
{
  id: 'layout-grid',
  phase: 3,
  label: 'What layout system fits this brand?',
  type: 'choice',
  choices: ['strict grid — clean columns, aligned edges', 'fluid — responsive, organic flow', 'masonry — Pinterest-style staggered', 'freeform — overlapping, editorial'],
  required: false,
},
{
  id: 'headline-specimen',
  phase: 3,
  label: 'Write a headline that captures your brand\'s voice (or I\'ll generate one from your data).',
  type: 'text',
  required: false,
  hint: 'This becomes the specimen text in your typography section. Example: "Big thinking. Small words. Real results."',
},
{
  id: 'target-output',
  phase: 3,
  label: 'What do you want to generate first from this Brand Guide?',
  type: 'choice',
  choices: ['brand identity poster', 'storyboard / cinematic direction', 'product shots / packaging', 'website hero / landing page', 'character sheet / turnarounds', 'social media assets'],
  required: false,
},
```

### Gap dependency and skip logic

Gaps should be **conditionally required** based on what was auto-filled or uploaded:

```javascript
// If mood board uploaded → photo-direction becomes optional (can infer)
// If no colors from pipeline → color-mood becomes required
// If site-review-confidence === 5 → skip design direction changes
// If no homepage screenshot → skip Phase 1 entirely
// If target-output === 'storyboard' → add cinematic-specific questions
```

---

## 4. Vision Analysis Modules

### 4.1 Logo Vision (existing — enhanced)

**File:** `brand-system-vision.js` / `brand-system-vision.md`

Current output is good. Add these fields to the vision prompt:

```jsonc
{
  // existing fields...
  "shape_language": { ... },
  "stroke_logic": { ... },
  "motif_seeds": [ ... ],
  "color_hints": [ ... ],
  "material_inference": { ... },
  "iconography_style": { ... },
  "personality_words": [ ... ],

  // NEW fields
  "logo_type": "wordmark",      // wordmark | lettermark | icon | combination | emblem | abstract
  "containment_shape": "none",  // circle | square | rounded-rect | shield | none | custom
  "suggested_icon_names": [],   // 6-10 icon concepts that match brand
  "gradient_present": false,
  "symmetry": "asymmetric",     // symmetric | asymmetric | radial
  "suggested_patterns": []      // 2-3 repeatable pattern ideas from logo geometry
}
```

### 4.2 Site Screenshot Vision (NEW)

**New file:** `brand-system-site-vision.js` + `brand-system-site-vision.md`

Analyzes the homepage screenshot to extract design signals the pipeline CSS extraction might miss.

```jsonc
{
  "layout_analysis": {
    "grid_type": "12-column",
    "section_count": 5,
    "hero_treatment": "full-bleed image with overlay text",
    "navigation_style": "fixed top bar with hamburger",
    "footer_style": "multi-column with dark background"
  },
  "color_usage": {
    "dominant_color": "#FFFFFF",
    "accent_application": "CTAs and hover states",
    "background_variety": 3,     // number of distinct background colors used
    "dark_mode_present": false
  },
  "typography_in_use": {
    "heading_treatment": "bold serif, left-aligned, large",
    "body_treatment": "regular sans-serif, comfortable line-height",
    "hierarchy_clarity": "strong" // strong | moderate | weak | absent
  },
  "photography_in_use": {
    "style": "editorial with natural lighting",
    "subjects": ["products", "people"],
    "color_treatment": "warm, slightly desaturated",
    "present": true
  },
  "ui_components": {
    "button_style": "rounded corners, solid fill, bold text",
    "card_style": "subtle shadow, white background",
    "border_radius": "8px",
    "icon_usage": "minimal line icons"
  },
  "overall_assessment": {
    "cohesion": "strong",        // strong | moderate | weak
    "professionalism": "high",   // high | medium | low
    "template_likelihood": 0.2,  // 0-1: how likely this is a template
    "design_maturity": "professional" // basic | developing | professional | premium
  }
}
```

### 4.3 Mood Board Vision (NEW)

**New file:** `brand-system-mood-vision.js` + `brand-system-mood-vision.md`

Analyzes each mood board image and synthesizes across all of them to find patterns.

Per-image analysis:
```jsonc
{
  "dominant_colors": [{ "hex": "#...", "weight": 0.3 }],
  "texture_keywords": ["rough", "organic", "natural"],
  "lighting_style": "soft diffused",
  "composition_style": "asymmetric",
  "mood_keywords": ["calm", "sophisticated", "earthy"],
  "design_era": "contemporary",     // retro | vintage | contemporary | futuristic
  "medium": "photography"           // photography | illustration | 3d-render | mixed-media
}
```

Cross-image synthesis (run after all mood board images analyzed):
```jsonc
{
  "consistent_themes": ["warm tones", "natural textures", "editorial composition"],
  "color_consensus": [{ "hex": "#...", "frequency": 4, "name": "warm beige" }],
  "style_direction": "editorial with warm, natural tones",
  "tension_notes": [],               // if images conflict, note the conflicts
  "recommended_visual_language": "organic",
  "recommended_lighting": "soft diffused",
  "recommended_material": "matte paper"
}
```

### 4.4 Brand Photography Vision (NEW)

**New file:** `brand-system-photo-vision.js` + `brand-system-photo-vision.md`

Analyzes existing brand photography to extract the photography direction.

```jsonc
{
  "subject_type": "people",          // people | products | environments | abstract
  "pose_style": "candid",           // posed | candid | action | environmental
  "lighting": {
    "type": "natural window light",
    "direction": "45-degree side",
    "quality": "soft",
    "color_temperature": "warm"
  },
  "color_grading": {
    "saturation": "moderate",
    "contrast": "medium",
    "tone": "warm",
    "style": "minimal clean editing"
  },
  "framing": {
    "typical_shot": "medium",
    "crop_style": "tight",
    "negative_space": "minimal"
  },
  "consistency_score": 0.8,          // 0-1: how consistent across photos
  "art_direction_summary": "Natural window light with warm tones, candid subject treatment, tight medium shots with minimal post-processing."
}
```

### 4.5 Competitor Vision (NEW)

**New file:** `brand-system-competitor-vision.js` + `brand-system-competitor-vision.md`

Analyzes competitor screenshots to build a differentiation map.

```jsonc
{
  "competitor_summary": {
    "dominant_style": "corporate minimal",
    "common_colors": ["#0066FF", "#FFFFFF", "#333333"],
    "common_typography": "sans-serif, clean",
    "common_photography": "stock photography, posed"
  },
  "differentiation_opportunities": [
    "Use serif typography where competitors use sans-serif",
    "Saturated warm palette vs. their cool blues",
    "Editorial photography vs. their stock imagery"
  ],
  "avoid": [
    "Blue + white color scheme (3/5 competitors use this)",
    "Generic stock photography with laptop/coffee setups"
  ]
}
```

### 4.6 Color Palette Vision (NEW)

Analyzes uploaded palette images to extract exact hex values.

```jsonc
{
  "extracted_colors": [
    { "hex": "#FF6A00", "name": "Vibrant Orange", "role": "primary" },
    { "hex": "#0F0F0F", "name": "Near Black", "role": "foundation" }
  ],
  "palette_type": "complementary",   // analogous | complementary | triadic | split-complementary | monochromatic
  "temperature": "warm",
  "contrast_ratio_notes": "Primary orange on near-black passes WCAG AAA."
}
```

---

## 5. Prompt Templates (Multi-Mode)

Instead of one hardcoded `buildMasterPrompt()`, the v2 system has **template functions** that each read from the same Brand Guide JSON but produce mode-specific prompts.

### Template architecture

```javascript
// prompt-templates/index.js
module.exports = {
  'brand-poster':     require('./brand-poster'),
  'storyboard':       require('./storyboard'),
  'product-shots':    require('./product-shots'),
  'web-design':       require('./web-design'),
  'character-sheet':  require('./character-sheet'),
  'social-media':     require('./social-media'),
};

// Each template exports: { buildPrompt(brandGuideJson) → string }
```

### 5.1 Brand Poster Template (existing — upgraded)

This is the v1 master prompt, enhanced with the new schema fields.

Key additions vs. v1:
- Full color system with all 12-16 swatches, gradients, and pairings
- Typography specimens with actual headline/body text examples
- Photography direction section
- Design direction (keep/change/add) influencing composition
- Brand voice integration (tone affects copy in mockups)

### 5.2 Storyboard Template (NEW)

```
Design a 16:9 cinematic storyboard for "[brand_name]" — 10 panels, film-quality.

BRAND DNA
[pulls from brand_header, color_system, visual_language]

CINEMATIC DIRECTION
Visual world: [visual_language.style]
Lighting: [photography_direction.lighting_setup]
Color grading: [photography_direction.color_treatment]
Framing: [photography_direction.framing]
Depth of field: [photography_direction.depth_of_field]

PANEL STRUCTURE
Each panel includes:
- Frame number and timestamp
- Shot type (extreme wide, medium, close-up, over-shoulder)
- Camera movement (handheld drift, push-in, pull-back, static)
- Dialogue/VO
- SFX and Audio/Music notes
- Transition type (hard cut, match cut, smash cut, dissolve)

MATERIAL & MOOD
Surface: [material_and_depth.surface]
Shadow: [material_and_depth.shadow_style]
Art direction: [photography_direction.art_direction_notes]
```

### 5.3 Product Shots Template (NEW)

```
Create product photography for "[brand_name]" — studio-quality renders.

BRAND DNA
[color_system, material_and_depth, visual_language]

PRODUCT DIRECTION
Surface: [material_and_depth.surface]
Lighting: [photography_direction.lighting_setup]
Background: [derived from color_system.foundation]
Props/styling: [derived from brand_header.industry]

RENDER STYLE
Shadow: [material_and_depth.shadow_style]
Depth: [material_and_depth.layer_depth]
Post-processing: [photography_direction.post_processing]

PACKAGING
Typography: [typography_system.headline] for product name
Color application: [color_system.emphasis[0]] as primary package color
Material: [material_and_depth.surface]
```

### 5.4 Web Design Template (NEW)

```
Design a website hero section for "[brand_name]" — full desktop viewport.

BRAND DNA
[brand_header, typography_system with specimens]

LAYOUT
Grid: [layout_grammar.grid_system]
Spacing: [layout_grammar.spacing_scale]
Border radius: [layout_grammar.border_radius]
Card style: [layout_grammar.card_style]

TYPOGRAPHY IN CONTEXT
Headline: "[typography_system.specimens.headline_example]"
  Font: [typography_system.headline.font_family]
  Size: display-large
Subheadline: "[typography_system.specimens.subheadline_example]"
Body: "[typography_system.specimens.body_example]"

COLOR APPLICATION
Background: [color_system.foundation[1].hex] ([name])
Text: [color_system.foundation[0].hex] ([name])
CTA: [color_system.emphasis[0].hex] ([name])
Accent: [color_system.emphasis[1].hex] ([name])

NAVIGATION
Style: [derived from site_vision_analysis if available]
Items: Work, Services, About, Ideas, Contact

DESIGN DIRECTION
Keep: [design_direction.keep]
Change: [design_direction.change]
Add: [design_direction.add]
```

### 5.5 Character Sheet Template (NEW)

```
Create a character reference sheet for "[brand_name]" brand mascot/representative.

BRAND DNA
[brand_header.soul_descriptors, visual_language]

STYLE
Art style: [visual_language.style]
Color palette: [color_system — primary + emphasis colors]
Line work: [iconography.stroke_rule]

SHEET LAYOUT
- Full body front view (hero pose)
- Side profile
- Back view
- 3/4 view
- Expression studies (3-4 emotions matching soul descriptors)
- Movement studies (4-6 action poses)
- Detail callouts (accessories, distinguishing features)
- Scale reference

MATERIAL & RENDERING
Surface: [material_and_depth.surface]
Shading: [material_and_depth.shadow_style]
```

### 5.6 Social Media Template (NEW)

```
Create a social media asset pack for "[brand_name]" — 3 formats.

BRAND DNA
[brand_header, color_system, typography_system]

FORMATS
1. Square post (1:1) — Instagram/LinkedIn
2. Story (9:16) — Instagram/TikTok
3. Banner (16:9) — Twitter/LinkedIn cover

TYPOGRAPHY
Headlines: [typography_system.headline]
Body: [typography_system.body]
Specimen text: [typography_system.specimens]

COLOR APPLICATION
Primary background: [color_system.emphasis[0].hex]
Text on primary: [choose contrasting from foundation]
Secondary: [color_system.emphasis[1].hex]

BRAND VOICE
Tone: [brand_voice.tone_pillars]
Style: [brand_voice.writing_style]
```

---

## 6. File Changes

### New files to create

```
features/scout-intake/modules/
  brand-system-v2.js              ← new mapper (replaces brand-system.js logic)
  brand-system-site-vision.js     ← site screenshot analysis
  brand-system-mood-vision.js     ← mood board analysis
  brand-system-photo-vision.js    ← brand photography analysis
  brand-system-competitor-vision.js  ← competitor analysis
  brand-system-palette-vision.js  ← color palette extraction

features/scout-intake/skills/
  brand-system-site-vision.md     ← site analysis prompt
  brand-system-mood-vision.md     ← mood board analysis prompt
  brand-system-photo-vision.md    ← photography direction prompt
  brand-system-competitor-vision.md  ← competitor analysis prompt
  brand-system-palette-vision.md  ← palette extraction prompt

features/scout-intake/prompt-templates/
  index.js                        ← template registry
  brand-poster.js                 ← upgraded v1 prompt
  storyboard.js                   ← cinematic direction
  product-shots.js                ← product photography
  web-design.js                   ← website hero/landing
  character-sheet.js              ← turnarounds + studies
  social-media.js                 ← multi-format social

app/api/brand-system/
  chat/route.js                   ← update for new gaps + multi-vision
  scan/route.js                   ← update for Phase 1 screenshot loading
```

### Files to modify

```
features/scout-intake/modules/brand-system.js
  → Bump SCHEMA_VERSION to 2
  → Expand GAP_DEFS with phase tagging
  → Expand mapPipelineToBrandSystem() for new schema fields
  → Replace buildBrandSystemJson() with v2 schema builder
  → Replace buildMasterPrompt() with template dispatcher

features/scout-intake/modules/brand-system-vision.js
  → Add new fields to logo analysis

features/scout-intake/skills/brand-system-vision.md
  → Add new extraction targets (logo_type, containment, etc.)

components/dashboard/BrandSystemTerminal.jsx
  → Add Phase 1 UI (screenshot display + feedback questions)
  → Add multi-file upload component for Phase 2
  → Add Phase 5 UI (template selection + preview)
  → Update phase counter from 3 → 5

app/api/brand-system/chat/route.js
  → Handle new gap IDs and phase routing
  → Wire up new vision modules
  → Support multi-image uploads
  → Store mood board / photo / competitor analysis results

app/api/brand-system/scan/route.js
  → Load homepage screenshot URL for Phase 1
  → Return screenshot artifact URLs in scan response
```

---

## 7. Frontend Flow Changes

### Terminal UI Updates

The terminal goes from 3 phases to 5:

```
Phase 1: Site Review (shows screenshot + text questions)
Phase 2: Asset Upload (multi-file upload UI per asset type)
Phase 3: Brand DNA (choice + text questions — mostly unchanged)
Phase 4: Assembly (auto — builds JSON, shows progress)
Phase 5: Output (template selection + prompt preview + copy)
```

### New UI Components needed

1. **Screenshot Viewer** — displays homepage mockup in the chat panel during Phase 1
2. **Multi-File Upload** — supports 1-10 image uploads per gap, with thumbnails and remove buttons
3. **Template Selector** — Phase 5 UI showing 6 template options as cards with preview descriptions
4. **Prompt Preview** — shows generated prompt with syntax highlighting and copy button
5. **Skip Button** — for optional Phase 1 and Phase 2 gaps

### Phase 1 Chat Panel Layout

```
┌─────────────────────────────────┐
│ PHASE 1 / 5 · SITE REVIEW      │
│                                 │
│ ┌─────────────────────────┐     │
│ │                         │     │
│ │   [Homepage Screenshot] │     │
│ │                         │     │
│ └─────────────────────────┘     │
│                                 │
│ What do you love about the      │
│ visual direction here?          │
│                                 │
│ ┌──────────────────────────┐    │
│ │ Type your answer…        │    │
│ └──────────────────────────┘    │
│ [Send]  [Skip this section →]   │
└─────────────────────────────────┘
```

### Phase 5 Output Panel Layout

```
┌─────────────────────────────────┐
│ PHASE 5 / 5 · GENERATE OUTPUT   │
│                                 │
│ Brand Guide assembled.          │
│ Choose your output format:      │
│                                 │
│ ┌──────┐ ┌──────┐ ┌──────┐     │
│ │Poster│ │Story-│ │Product│    │
│ │      │ │board │ │ Shots │    │
│ └──────┘ └──────┘ └──────┘     │
│ ┌──────┐ ┌──────┐ ┌──────┐     │
│ │ Web  │ │Char. │ │Social│     │
│ │Design│ │Sheet │ │Media │     │
│ └──────┘ └──────┘ └──────┘     │
│                                 │
│ [Generate All] [Open JSON ↗]    │
└─────────────────────────────────┘
```

---

## 8. API Route Changes

### POST /api/brand-system/chat — expanded

New body fields:
```jsonc
{
  "gapId": "mood-board",
  "value": "uploaded 3 images",
  "images": [                        // NEW — array for multi-image
    { "imageBase64": "...", "mediaType": "image/png" },
    { "imageBase64": "...", "mediaType": "image/jpeg" },
    { "imageBase64": "...", "mediaType": "image/jpeg" }
  ],
  "phase": 1,                        // NEW — helps server route to correct handler
  "templateId": "storyboard"         // NEW — Phase 5 template selection
}
```

New response for Phase 5:
```jsonc
{
  "done": true,
  "json": { /* Brand Guide v2 */ },
  "prompts": {
    "brand-poster": "Design a vertical 4:5...",
    "storyboard": "Design a 16:9 cinematic...",
    // ... one per template
  },
  "selectedPrompt": "Design a 16:9 cinematic...",
  "templateId": "storyboard",
  "sources": { /* per-field attribution */ },
  "generatedAt": "2025-..."
}
```

### New fieldForGap mappings

```javascript
function fieldForGap(gapId) {
  switch (gapId) {
    // Phase 1
    case 'site-review-love':       return 'designDirection.keep';
    case 'site-review-change':     return 'designDirection.change';
    case 'site-review-add':        return 'designDirection.add';
    case 'site-review-confidence': return 'designDirection.confidenceScore';
    // Phase 2
    case 'logo':                   return 'logoUrl';
    case 'mood-board':             return 'moodBoard';
    case 'brand-photos':           return 'brandPhotos';
    case 'competitor-refs':        return 'competitorRefs';
    case 'product-shots':          return 'productShots';
    case 'color-palette':          return 'colorPalette';
    // Phase 3
    case 'soul-descriptors':       return 'soulDescriptors';
    case 'visual-language':        return 'visualLanguage';
    case 'lighting':               return 'lighting';
    case 'material':               return 'material';
    case 'photo-direction':        return 'photoDirection';
    case 'brand-archetype':        return 'brandArchetype';
    case 'composition-style':      return 'compositionStyle';
    case 'color-mood':             return 'colorMood';
    case 'motion-intent':          return 'motionIntent';
    case 'layout-grid':            return 'layoutGrid';
    case 'headline-specimen':      return 'headlineSpecimen';
    case 'target-output':          return 'targetOutput';
    default:                       return null;
  }
}
```

---

## 9. Migration Strategy

### Backward compatibility

- `schema_version: 1` data continues to work — the mapper checks version and applies v1 logic
- v2 mapper can read v1 `userUploads.brandSystem` and upgrade in-place
- Old `masterPrompt` field preserved alongside new `prompts` object
- `buildMasterPrompt()` still works for v1 schema (delegates to brand-poster template)

### Data migration

No destructive migration needed. New fields are additive:
```javascript
// v1 shape preserved:
dashboardState.brandSystem.json         // v1 JSON
dashboardState.brandSystem.masterPrompt // v1 prompt

// v2 adds alongside:
dashboardState.brandSystem.jsonV2       // v2 JSON
dashboardState.brandSystem.prompts      // { templateId: promptString }
dashboardState.brandSystem.schemaVersion // bumped to 2
```

---

## 10. Implementation Order

### Sprint 1: Schema + Core Mapper (Week 1)

1. Define `brand-system-v2.js` with expanded `GAP_DEFS` and phase tagging
2. Build v2 schema builder (`buildBrandSystemJsonV2`)
3. Update `mapPipelineToBrandSystem()` to populate new fields from pipeline
4. Add `fieldForGap()` mappings for all new gap IDs
5. Write unit tests for mapper with v1 → v2 upgrade path

### Sprint 2: Vision Modules (Week 2)

1. Site screenshot vision (`brand-system-site-vision.js` + `.md`)
2. Mood board vision (`brand-system-mood-vision.js` + `.md`)
3. Enhanced logo vision (add new fields)
4. Brand photography vision (`brand-system-photo-vision.js` + `.md`)
5. Competitor vision (`brand-system-competitor-vision.js` + `.md`)
6. Color palette vision (`brand-system-palette-vision.js` + `.md`)

### Sprint 3: Prompt Templates (Week 3)

1. Brand poster template (upgrade from v1)
2. Storyboard template
3. Product shots template
4. Web design template
5. Character sheet template
6. Social media template
7. Template registry + dispatcher

### Sprint 4: API + Frontend (Week 4)

1. Update `POST /api/brand-system/chat` for new gaps + multi-image
2. Update `GET /api/brand-system/scan` for screenshot loading
3. Phase 1 UI: screenshot viewer + feedback questions
4. Phase 2 UI: multi-file upload component
5. Phase 5 UI: template selector + prompt preview
6. Update phase counter and flow logic

### Sprint 5: Polish + Testing (Week 5)

1. End-to-end testing with real brand data
2. Vision prompt tuning (iterate on extraction quality)
3. Template prompt tuning (iterate on generation quality)
4. Skip logic and conditional gaps
5. Source attribution accuracy
6. Performance optimization (parallel vision calls)

---

## Appendix: Reference Image Analysis

From the reference images provided:

### KFC Brand System (reference)
- 9 numbered sections with clear hierarchy
- 15+ color swatches across primary/secondary/accent palettes
- Full gradient definitions
- 3 typography specimens (Display Bold, Sans Bold, Sans Regular)
- Visual language section with mood tiles
- 6 brand applications (packaging, web, mobile, social, card, OOH)
- Design system (buttons, cards, inputs, nav)
- 10 icons with consistent style
- Pattern motifs derived from brand elements
- Material & depth section

### nottherug-ten Brand System (current output)
- Color system: 12 swatches with Foundation/Emphasis/Atmosphere
- Typography: 2 fonts with specimens
- Visual language: mood tiles
- Iconography: 10 icons with consistent style
- Patterns & motifs: 3 pattern types
- 6 brand applications
- Strong — but limited by what the pipeline could extract

### Storyboard Reference
- 10 panels with precise timestamps
- Shot type + camera movement per panel
- Dialogue/VO, SFX, Audio/Music columns
- Transition types between panels
- Consistent art style derived from brand DNA

### Character Sheet Reference (Sienna Rowe)
- Full body hero shot
- Turnaround views (front, side, back, 3/4)
- Movement studies
- Detail callouts (gear, equipment)
- Philosophy / personality text
- Stats and specifications
