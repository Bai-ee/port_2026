# Module Data Shapes — Reference for DESIGN.MD Rewire

> This file documents the exact output shape of every analysis module.
> Read alongside `docs/DESIGNMD_REWIRE_PROMPT.md`.

---

## 1. Content Scraper

**File:** `features/leadgen/content-scraper.js`
**Function:** `scrapeClientContent(websiteUrl, { businessName })`
**Status:** ✅ Fully wired into DESIGN.MD today

```jsonc
{
  "copy": {
    "heroHeadline": "string | null",
    "heroSubheadline": "string | null",
    "aboutText": "string | null",
    "missionStatement": "string | null",
    "serviceNames": ["string"],
    "serviceDescriptions": [{"name": "string", "description": "string"}],
    "testimonials": [{"quote": "string", "author": "string", "role": "string"}],
    "ctaTexts": ["string"],
    "contactInfo": {
      "phone": "string | null",
      "email": "string | null",
      "address": "string | null",
      "hours": "string | null"
    },
    "footerText": "string | null",
    "legalText": "string | null",
    "tagline": "string | null"
  },
  "assets": {
    "logo": {"url": "string", "alt": "string", "detectedBy": "string"},
    "heroImages": [{"url": "string", "alt": "string"}],
    "sectionImages": [{"url": "string", "alt": "string", "section": "string"}],
    "teamPhotos": [{"url": "string", "alt": "string"}],
    "galleryImages": [{"url": "string", "alt": "string"}],
    "favicon": "string | null",
    "ogImage": "string | null"
  },
  "structure": {
    "navItems": ["string"],
    "sectionOrder": ["string"],
    "hasContactForm": "boolean",
    "hasBlog": "boolean",
    "hasTestimonials": "boolean",
    "hasTeamSection": "boolean",
    "hasGallery": "boolean",
    "hasPricing": "boolean",
    "footerColumns": "number"
  },
  "colors": {
    "primary": "string | null",    // hex, from CSS frequency counting (NOISY)
    "secondary": "string | null",
    "accent": "string | null",
    "candidates": ["string"]       // all hex candidates found
  },
  "meta": {
    "title": "string",
    "description": "string",
    "scrapedAt": "ISO timestamp",
    "pagesScraped": "number",
    "warnings": ["string"],
    "usedBrowserless": "boolean"
  }
}
```

---

## 2. Design Evaluation (Style Guide)

**File:** `features/scout-intake/modules/design-evaluation.js`
**Function:** `runDesignEvaluationModule({ clientId, websiteUrl, onProgress })`
**Firestore path:** `onboard.designEvaluation`
**Status:** ⚠️ NOT wired — has high-accuracy Claude vision data

```jsonc
{
  "styleGuide": {
    "summary": "string",              // e.g. "Modern professional site with clean layout"
    "confidence": "high | medium | low",
    "typography": {
      "fontFamilies": [
        {"family": "string", "role": "heading | body | accent", "source": "string"}
      ],
      "headingSystem": {"fontFamily": "string", "fontWeight": "string"},
      "bodySystem": {"fontFamily": "string", "fontWeight": "string"}
    },
    "colors": {
      "primary": {"hex": "string"},     // NOTE: nested .hex — not bare string
      "secondary": {"hex": "string"},
      "tertiary": {"hex": "string"},
      "neutral": {"hex": "string"}
    },
    "layout": {
      "framing": "string",             // e.g. "contained", "full-bleed"
      "gridSystem": "string"           // e.g. "12-column", "flexbox"
    },
    "motion": {
      "level": "string"                // e.g. "none", "subtle", "moderate", "bold"
    },
    "visualPalette": {                  // optional
      "swatches": [{"hex": "string", "frequency": "number"}]
    }
  }
}
```

**Access pattern in generator:**
```javascript
const de = onboard.designEvaluation?.styleGuide || {};
const deColors = de.colors || {};
const dePrimary = deColors.primary?.hex;           // NOTE: .hex required
const deHeadingFont = de.typography?.headingSystem?.fontFamily;
const deBodyFont = de.typography?.bodySystem?.fontFamily;
const deMotion = de.motion?.level;
const deFraming = de.layout?.framing;
const deGrid = de.layout?.gridSystem;
const deConfidence = de.confidence;
const deSummary = de.summary;
```

---

## 3. Social Preview

**File:** `features/scout-intake/modules/social-preview.js`
**Function:** `runSocialPreview({ websiteUrl, onProgress })`
**Firestore path:** `onboard.socialPreview`
**Status:** ⚠️ Partially wired — only ogImage read (and unused)

```jsonc
{
  "siteMeta": {
    "title": "string",
    "description": "string",
    "ogImage": "string",
    "ogUrl": "string",
    "ogType": "string",
    "twitterCard": "string",
    "favicon": "string",
    "canonical": "string"
  }
}
```

**Access pattern:**
```javascript
const social = onboard.socialPreview?.siteMeta || {};
// Already destructured at line 108 — just use social.title, social.description
```

---

## 4. AI / Agent Readiness

**File:** `features/scout-intake/modules/agent-readiness.js`
**Function:** `runAgentReadinessModule({ websiteUrl, onProgress })`
**Firestore path:** `onboard.agentReadiness`
**Status:** ⚠️ Partially wired — only score/verdict/findings used

```jsonc
{
  "agentReadiness": {
    "score": "number",                  // 0-100
    "verdict": "string",               // e.g. "EXCELLENT", "POOR"
    "readiness": "ready | partial | not-ready",
    "dimensions": {
      "structuredData": {"score": "number", "verdict": "string"},
      "schemaMarkup": {"score": "number", "verdict": "string"},
      "crawlability": {"score": "number", "verdict": "string"},
      "htmlSemantics": {"score": "number", "verdict": "string"},
      "accessibilityData": {"score": "number", "verdict": "string"}
    },
    "checks": [
      {
        "id": "string",
        "name": "string",
        "status": "pass | fail | warn",
        "verdict": "string",
        "fixId": "string",
        "recommendation": "string"
      }
    ],
    "findings": ["string"],             // ← currently used (up to 8)
    "highlights": ["string"],           // ← NOT used — strengths to preserve
    "customFixes": {
      "[fixId]": {"prompt": "string", "reasoning": "string"}
    }
  }
}
```

**Access pattern:**
```javascript
const ai = onboard.agentReadiness || {};
// Already destructured at line 106
// New fields: ai.dimensions, ai.checks, ai.highlights, ai.customFixes
```

**NOTE:** The onboard stores `agentReadiness` directly (not nested under `.agentReadiness`). So `onboard.agentReadiness.score` is the score, `onboard.agentReadiness.dimensions` is the dimensions object. Verify this — the module returns `{ agentReadiness: {...} }` but the API may flatten it when storing.

---

## 5. SEO Performance

**File:** `features/scout-intake/modules/seo-performance.js`
**Function:** `runSeoPerformance({ clientId, websiteUrl, onProgress })`
**Firestore path:** `onboard.seoPerformance`
**Status:** ⚠️ Partially wired — only top-level pagespeed scores used

```jsonc
{
  "pagespeed": {
    "status": "ok | error",
    "scores": {
      "performance": "number",          // 0-100 ← currently used
      "accessibility": "number",        // ← currently used
      "bestPractices": "number",        // ← currently used
      "seo": "number",                  // ← currently used
      "largest_contentful_paint": "number",  // ms ← NOT used
      "first_input_delay": "number",         // ms ← NOT used
      "cumulative_layout_shift": "number"    // ← NOT used
    },
    "opportunities": [
      {"id": "string", "title": "string", "description": "string", "savings": "string"}
    ],
    "diagnostics": [
      {"id": "string", "title": "string", "description": "string"}
    ]
  },
  "skillOutput": {
    "findings": [
      {"category": "string", "severity": "string", "issue": "string", "fix": "string"}
    ],
    "recommendations": ["string"]
  }
}
```

**Access pattern:**
```javascript
const psi = onboard.seoPerformance?.pagespeed || {};
// Already destructured at line 107
// For scores: psi.scores?.largest_contentful_paint (note: might be psi.performance directly or psi.scores.performance — verify)
const seoFindings = onboard.seoPerformance?.skillOutput?.findings || [];
```

**IMPORTANT NOTE on pagespeed shape:** The current code reads `psi.performance` directly (line 339), suggesting the scores might be stored flat on pagespeed (not nested under `.scores`). Verify by checking if `pagespeed.performance` or `pagespeed.scores.performance` is correct. Both patterns should be handled:
```javascript
const perfScore = psi.scores?.performance ?? psi.performance;
```

---

## 6. Brand System

**File:** `features/scout-intake/modules/brand-system.js`
**Functions:** `mapPipelineToBrandSystem(state)`, `buildBrandSystemJsonV2({filled, ...})`, `buildIfComplete(state)`
**Firestore path:** `prospect.userUploads?.brandSystem` (raw answers) or `prospect.brandGuide` (built guide)
**Status:** ❌ COMPLETELY DISCONNECTED

The Brand System produces the richest data of any module. Full shape:

```jsonc
{
  "brand_header": {
    "brand_name": "string",
    "brand_statement": "string",
    "soul_descriptors": ["string"],    // e.g. ["bold", "warm", "precise"]
    "brand_archetype": "string",       // e.g. "The Caregiver"
    "tagline": "string",
    "industry": "string",
    "target_audience": "string"
  },
  "color_system": {
    "foundation": [{"hex": "string", "name": "string", "role": "string", "usage": "string"}],
    "emphasis": [{"hex": "string", "name": "string", "role": "string", "usage": "string"}],
    "atmosphere": [{"hex": "string", "name": "string", "role": "string", "usage": "string"}],
    "gradients": [],
    "pairings": [],
    "color_mood": "string"             // e.g. "calm and authoritative with warm accents"
  },
  "typography_system": {
    "headline": {"font_family": "string", "weight": "string"},
    "subheadline": {"font_family": "string", "weight": "string"},
    "body": {"font_family": "string", "weight": "string"},
    "specimens": {
      "headline_example": "string",
      "subheadline_example": "string",
      "body_example": "string"
    }
  },
  "visual_language": {
    "industry": "string",
    "style": "string",
    "lighting": "string",
    "texture": "string",
    "mood_keywords": ["string"],
    "composition": {
      "style": "string",
      "density": "string",
      "whitespace": "string"
    },
    "logo_url": "string",
    "logo_vision": {
      "iconography_style": {"style": "string", "rule": "string"},
      "shape_language": {"primary": "string"},
      "stroke_logic": "string",
      "suggested_icon_names": ["string"],
      "containment_shape": "string",
      "material_inference": {"reasoning": "string"}
    }
  },
  "photography_direction": {
    "style": "string",
    "subject_treatment": "string | null",
    "lighting_setup": "string",
    "color_treatment": "string | null",
    "depth_of_field": "string | null",
    "framing": "string | null"
  },
  "iconography": {
    "style": "string",
    "stroke_rule": "string",
    "shape_grammar": "string",
    "stroke_logic": "string",
    "count": "string",
    "icon_names": ["string"],
    "containment": "string"
  },
  "patterns_and_motifs": {
    "sources": "string",
    "seeds": ["string"],
    "application_rules": ["string"]
  },
  "material_and_depth": {
    "surface": "string",
    "shadow_style": "string | null",
    "layer_depth": "string | null",
    "reasoning": "string | null"
  },
  "brand_voice": {
    "tone_pillars": ["string"],
    "writing_style": "string | null",
    "vocabulary_level": "string | null",
    "sentence_style": "string | null"
  },
  "design_direction": {
    "keep": ["string"],                // from Phase 1 site review
    "change": ["string"],
    "add": ["string"],
    "confidence_score": "number | null",
    "site_vision_analysis": "object | null"
  },
  "motion": {
    "style": "none | subtle | expressive | cinematic",
    "easing": "string",
    "speed": "string",
    "transitions": "string"
  },
  "layout_grammar": {
    "grid_system": "string",
    "border_radius": "string",
    "card_style": "string"
  },
  "brand_applications": [
    {"type": "string", "detail": "string", "priority": "string"}
  ],
  "assets": {
    "logo": {"url": "string", "vision_analysis": "object"},
    "mood_board": ["string"],
    "brand_photos": ["string"],
    "competitor_screenshots": ["string"],
    "product_shots": ["string"],
    "homepage_screenshot": {"url": "string", "vision_analysis": "object"}
  }
}
```

**Access pattern for generator:**
```javascript
// Add to function signature:
export function generateDesignMd({ prospect, onboard = {}, content = {}, assetManifest = null, brandSystem = null }) {

// Brand System resolution
const bs = brandSystem || {};
const bsColors = bs.color_system || {};
const bsTypo = bs.typography_system || {};
const bsVisual = bs.visual_language || {};
const bsMotion = bs.motion || {};
const bsLayout = bs.layout_grammar || {};
const bsVoice = bs.brand_voice || {};
const bsDirection = bs.design_direction || {};
const bsPhoto = bs.photography_direction || {};
const bsIcon = bs.iconography || {};
const bsPatterns = bs.patterns_and_motifs || {};
const bsMaterial = bs.material_and_depth || {};
const bsHeader = bs.brand_header || {};

// Color priority: Brand System > Design Eval > Scraper > Vertical Default
const primaryColor = bsColors.foundation?.[0]?.hex
  || deColors.primary?.hex
  || colors.primary
  || def.primary;
```

---

## 7. Asset Manager

**File:** `features/leadgen/asset-manager.js`
**Function:** `buildAssetManifest(assets)`
**Status:** ✅ Fully wired

```jsonc
{
  "logo": {"url": "string", "alt": "string", "targetFile": "string", "localPath": "string"},
  "heroImages": [{"url": "string", "alt": "string", "targetFile": "string", "localPath": "string"}],
  "sectionImages": [{"url": "string", "alt": "string", "targetFile": "string", "localPath": "string"}],
  "teamPhotos": [{"url": "string", "alt": "string", "targetFile": "string", "localPath": "string"}],
  "ogImage": {"url": "string", "targetFile": "string", "localPath": "string"}
}
```

---

## Quick Reference: Priority Chain Summary

```
COLORS:     Brand System → Design Eval → Scraper → Vertical Default
FONTS:      Brand System → Design Eval → Vertical Default
PERSONALITY: Brand System mood_keywords → Brand System soul_descriptors → Vertical Default
MOTION:     Brand System motion → Design Eval motion.level → 'subtle'
LAYOUT:     Brand System layout_grammar → Design Eval layout → (omit)
RADIUS:     Brand System border_radius → Vertical Default
HEADLINE:   Scraper → Social Preview title → prospect.name
SUBHEADLINE: Scraper → Scraper tagline → Social Preview description → generic
```
