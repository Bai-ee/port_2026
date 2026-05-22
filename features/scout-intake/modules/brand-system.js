'use strict';

// brand-system.js — Pipeline → Brand DNA mapper (v2).
//
// Reads a dashboardState snapshot and returns:
//   - filled       : partial Brand System JSON populated from pipeline data
//   - gaps         : ordered chat questions needed to finish the JSON
//   - completeness : 0..1 score (how much was auto-filled)
//
// The mapper is pure: same input → same output, no I/O.

const SCHEMA_VERSION = 2;

// ── Pipeline path readers ─────────────────────────────────────────────────────

function getBrandName(state) {
  return (
    state?.snapshot?.brandOverview?.name
    || state?.client?.name
    || state?.client?.normalizedHost
    || null
  );
}

function getBrandStatement(state) {
  return (
    state?.snapshot?.brandOverview?.tagline
    || state?.snapshot?.brandOverview?.headline
    || null
  );
}

function getTagline(state) {
  return state?.snapshot?.brandOverview?.tagline || null;
}

function getIndustry(state) {
  return state?.snapshot?.brandOverview?.industry || null;
}

function getTargetAudience(state) {
  return state?.snapshot?.brandOverview?.targetAudience || null;
}

function getSoulDescriptors(state) {
  const tone = state?.snapshot?.brandTone || {};
  const fromArray = Array.isArray(tone.descriptors) ? tone.descriptors : [];
  if (fromArray.length >= 3) return fromArray.slice(0, 3);
  const fromKeywords = Array.isArray(tone.keywords) ? tone.keywords : [];
  const merged = [...new Set([...fromArray, ...fromKeywords])].slice(0, 3);
  return merged.length >= 3 ? merged : null;
}

function getBrandVoice(state) {
  const tone = state?.snapshot?.brandTone || {};
  const pillars = [
    ...(Array.isArray(tone.descriptors) ? tone.descriptors : []),
    ...(Array.isArray(tone.keywords) ? tone.keywords : []),
  ].filter(Boolean).slice(0, 5);
  if (!pillars.length) return null;
  return {
    tone_pillars: pillars,
    writing_style: null,
    vocabulary_level: null,
    sentence_style: null,
  };
}

function getColors(state) {
  const sg = state?.snapshot?.visualIdentity?.styleGuide?.colors
    || state?.analyzerOutputs?.['style-guide']?.colors
    || null;
  if (!sg) return null;
  const toEntry = (c, role) => (c?.hex ? { hex: c.hex, role } : null);
  return {
    primary:   [toEntry(sg.primary,   'foundation')].filter(Boolean),
    secondary: [toEntry(sg.secondary, 'emphasis')].filter(Boolean),
    accent:    [toEntry(sg.tertiary,  'atmosphere'), toEntry(sg.neutral, 'atmosphere')].filter(Boolean),
  };
}

// Returns v2 color_system shape with foundation/emphasis/atmosphere arrays.
function getColorsV2(state) {
  const sg = state?.snapshot?.visualIdentity?.styleGuide?.colors
    || state?.analyzerOutputs?.['style-guide']?.colors
    || null;
  if (!sg) return null;

  const toSwatch = (c, role, name, usage) =>
    c?.hex ? { hex: c.hex, name: name || null, role, usage: usage || null } : null;

  const foundation = [
    toSwatch(sg.primary,   'foundation', null, 'primary text, headers'),
    toSwatch(sg.neutral,   'foundation', null, 'backgrounds, dividers'),
  ].filter(Boolean);

  const emphasis = [
    toSwatch(sg.secondary, 'emphasis', null, 'primary accent, CTAs'),
    toSwatch(sg.tertiary,  'emphasis', null, 'hover states, highlights'),
  ].filter(Boolean);

  if (!foundation.length && !emphasis.length) return null;
  return { foundation, emphasis, atmosphere: [], gradients: [], pairings: [], color_mood: null };
}

function getTypography(state) {
  const t = state?.snapshot?.visualIdentity?.styleGuide?.typography
    || state?.analyzerOutputs?.['style-guide']?.typography
    || null;
  if (!t) return null;
  const headline = t.headingSystem?.fontFamily || null;
  const body = t.bodySystem?.fontFamily || null;
  if (!headline && !body) return null;
  return {
    headline: headline ? { font_family: headline, weight: t.headingSystem?.fontWeight || 'bold' } : null,
    subheadline: headline ? { font_family: headline, weight: 'medium' } : null,
    body: body ? { font_family: body, weight: t.bodySystem?.fontWeight || 'regular' } : null,
    specimens: null,
  };
}

function getLogoUrl(state) {
  return (
    state?.userUploads?.brandSystem?.logoUrl
    || state?.siteMeta?.favicon
    || state?.siteMeta?.ogImage
    || null
  );
}

function getHomepageScreenshotUrl(state) {
  return (
    state?.artifacts?.homepageScreenshots?.desktop
    || state?.artifacts?.fullPageScreenshots?.desktop
    || state?.artifacts?.homepageDeviceMockup
    || null
  );
}

// ── Gap definitions ──────────────────────────────────────────────────────────
//
// Each gap declares: id, phase, label, type, required, isMissing.
// Phase 1 = site review, Phase 2 = asset uploads, Phase 3 = brand DNA questions.
// Order matters — chat presents them top-to-bottom within each phase.

const GAP_DEFS = [
  // ── Phase 1: Site Review ─────────────────────────────────────────────────
  {
    id: 'site-review-love',
    phase: 1,
    label: 'Looking at your homepage — what do you love about the visual direction?',
    type: 'text',
    acceptsImage: false,
    required: false,
    showsScreenshot: true,
    isMissing: (state) => {
      if (!getHomepageScreenshotUrl(state)) return false;
      return !state?.userUploads?.brandSystem?.designDirection?.keep?.length;
    },
  },
  {
    id: 'site-review-change',
    phase: 1,
    label: 'What feels off or inconsistent? What would you change visually?',
    type: 'text',
    acceptsImage: false,
    required: false,
    showsScreenshot: true,
    isMissing: (state) => {
      if (!getHomepageScreenshotUrl(state)) return false;
      return !state?.userUploads?.brandSystem?.designDirection?.change?.length;
    },
  },
  {
    id: 'site-review-add',
    phase: 1,
    label: "What visual elements or styles would you like to add that aren't there yet?",
    type: 'text',
    acceptsImage: false,
    required: false,
    showsScreenshot: true,
    isMissing: (state) => {
      if (!getHomepageScreenshotUrl(state)) return false;
      return !state?.userUploads?.brandSystem?.designDirection?.add?.length;
    },
  },
  {
    id: 'site-review-confidence',
    phase: 1,
    label: 'On a scale of 1-5, how close is this to your ideal visual identity?',
    type: 'choice',
    choices: ['1 — Starting over', '2 — Major changes needed', '3 — Good bones, needs refinement', '4 — Almost there', '5 — Love it as-is'],
    acceptsImage: false,
    required: false,
    showsScreenshot: true,
    isMissing: (state) => {
      if (!getHomepageScreenshotUrl(state)) return false;
      return state?.userUploads?.brandSystem?.designDirection?.confidenceScore == null;
    },
  },

  // ── Phase 2: Asset Uploads ───────────────────────────────────────────────
  {
    id: 'logo',
    phase: 2,
    label: "Upload your logo. I'll analyze its shape language, color, and visual grammar to populate the iconography, motifs, and material sections.",
    type: 'image',
    acceptsImage: true,
    required: true,
    maxFiles: 1,
    isMissing: (state, vision) => !vision?.logo && !state?.userUploads?.brandSystem?.logoVisionAnalysis,
  },
  {
    id: 'mood-board',
    phase: 2,
    label: 'Upload 1-5 mood board or reference images that capture the visual direction you want.',
    type: 'image-multi',
    acceptsImage: true,
    required: false,
    maxFiles: 5,
    hint: 'Other brands you admire, design inspiration, photography styles, color palettes — anything that says "this is the vibe."',
    isMissing: (state) => {
      const existing = state?.userUploads?.brandSystem?.moodBoard;
      return !Array.isArray(existing) || existing.length === 0;
    },
  },
  {
    id: 'brand-photos',
    phase: 2,
    label: 'Upload existing brand photography — headshots, product shots, lifestyle images.',
    type: 'image-multi',
    acceptsImage: true,
    required: false,
    maxFiles: 10,
    hint: "I'll extract your photography direction: lighting, color treatment, framing, and subject style.",
    isMissing: (state) => {
      const existing = state?.userUploads?.brandSystem?.brandPhotos;
      return !Array.isArray(existing) || existing.length === 0;
    },
  },
  {
    id: 'competitor-refs',
    phase: 2,
    label: 'Upload screenshots of competitors or brands in your space you want to differentiate from.',
    type: 'image-multi',
    acceptsImage: true,
    required: false,
    maxFiles: 5,
    hint: "I'll map what they do visually so your brand stands apart.",
    isMissing: (state) => {
      const existing = state?.userUploads?.brandSystem?.competitorRefs;
      return !Array.isArray(existing) || existing.length === 0;
    },
  },
  {
    id: 'color-palette',
    phase: 2,
    label: 'Upload a color palette image or screenshot if you have specific colors in mind.',
    type: 'image',
    acceptsImage: true,
    required: false,
    maxFiles: 1,
    hint: "A screenshot from Coolors, Adobe Color, or a palette image. I'll extract exact hex values.",
    isMissing: (state) => !state?.userUploads?.brandSystem?.colorPalette,
  },

  // ── Phase 3: Brand DNA Questions ─────────────────────────────────────────
  {
    id: 'soul-descriptors',
    phase: 3,
    label: 'In three words, what is the soul of this brand? (e.g. "Raw / Futuristic / Grounded")',
    type: 'short-text-list',
    acceptsImage: false,
    required: true,
    isMissing: (state) => {
      const userVal = state?.userUploads?.brandSystem?.soulDescriptors;
      if (Array.isArray(userVal) && userVal.length >= 3) return false;
      return !getSoulDescriptors(state);
    },
  },
  {
    id: 'visual-language',
    phase: 3,
    label: 'Pick the visual world: editorial, cinematic, industrial, organic, or futuristic?',
    type: 'choice',
    choices: ['editorial', 'cinematic', 'industrial', 'organic', 'futuristic'],
    acceptsImage: false,
    required: true,
    isMissing: (state) => !state?.userUploads?.brandSystem?.visualLanguage,
  },
  {
    id: 'lighting',
    phase: 3,
    label: 'Lighting mood: hard directional, soft diffused, neon-saturated, or overcast natural?',
    type: 'choice',
    choices: ['hard directional', 'soft diffused', 'neon-saturated', 'overcast natural'],
    acceptsImage: false,
    required: true,
    isMissing: (state) => !state?.userUploads?.brandSystem?.lighting,
  },
  {
    id: 'material',
    phase: 3,
    label: 'Surface mood: matte paper, glass, brushed metal, soft fabric, or polished plastic?',
    type: 'choice',
    choices: ['matte paper', 'glass', 'brushed metal', 'soft fabric', 'polished plastic'],
    acceptsImage: false,
    required: true,
    isMissing: (state) => !state?.userUploads?.brandSystem?.material,
  },
  {
    id: 'photo-direction',
    phase: 3,
    label: 'How should brand photography feel?',
    type: 'choice',
    choices: [
      'editorial — magazine-quality, art-directed',
      'documentary — real, unposed, authentic',
      'studio — clean, controlled, product-focused',
      'lifestyle — aspirational, environmental',
      'abstract — textures, shapes, conceptual',
    ],
    acceptsImage: false,
    required: false,
    isMissing: (state) => {
      // Can be inferred from mood board vision analysis
      if (state?.userUploads?.brandSystem?.moodBoard?.length > 0) return false;
      return !state?.userUploads?.brandSystem?.photoDirection;
    },
  },
  {
    id: 'brand-archetype',
    phase: 3,
    label: 'Which brand archetype fits best?',
    type: 'choice',
    choices: [
      'creator — innovative, imaginative',
      'explorer — adventurous, independent',
      'sage — knowledgeable, trusted',
      'hero — bold, ambitious',
    ],
    acceptsImage: false,
    required: false,
    isMissing: (state) => !state?.userUploads?.brandSystem?.brandArchetype,
  },
  {
    id: 'composition-style',
    phase: 3,
    label: 'How dense should the visual compositions be?',
    type: 'choice',
    choices: [
      'magazine-dense — every inch used',
      'balanced — structured with breathing room',
      'minimal — lots of whitespace',
      'asymmetric — dynamic, unexpected layouts',
    ],
    acceptsImage: false,
    required: false,
    isMissing: (state) => !state?.userUploads?.brandSystem?.compositionStyle,
  },
  {
    id: 'color-mood',
    phase: 3,
    label: 'What is the overall color mood?',
    type: 'choice',
    choices: [
      'optimistic — warm, bright, energetic',
      'calm — cool, muted, serene',
      'bold — high contrast, saturated',
      'neutral — earthy, understated',
    ],
    acceptsImage: false,
    required: false,
    isMissing: (state) => {
      // Can be inferred from color system if colors are rich
      if (getColorsV2(state)?.foundation?.length > 1) return false;
      return !state?.userUploads?.brandSystem?.colorMood;
    },
  },
  {
    id: 'motion-intent',
    phase: 3,
    label: 'If this brand had motion/animation, how would it feel?',
    type: 'choice',
    choices: [
      'none — purely static',
      'subtle — gentle fades, micro-interactions',
      'expressive — playful, bouncy, attention-grabbing',
      'cinematic — smooth, dramatic, film-quality',
    ],
    acceptsImage: false,
    required: false,
    isMissing: (state) => !state?.userUploads?.brandSystem?.motionIntent,
  },
  {
    id: 'layout-grid',
    phase: 3,
    label: 'What layout system fits this brand?',
    type: 'choice',
    choices: [
      'strict grid — clean columns, aligned edges',
      'fluid — responsive, organic flow',
      'masonry — Pinterest-style staggered',
      'freeform — overlapping, editorial',
    ],
    acceptsImage: false,
    required: false,
    isMissing: (state) => !state?.userUploads?.brandSystem?.layoutGrid,
  },
  {
    id: 'headline-specimen',
    phase: 3,
    label: "Write a headline that captures your brand's voice (or I'll generate one from your data).",
    type: 'text',
    acceptsImage: false,
    required: false,
    hint: 'This becomes the specimen text in your typography section. Example: "Big thinking. Small words. Real results."',
    isMissing: (state) => !state?.userUploads?.brandSystem?.headlineSpecimen,
  },
  {
    id: 'target-output',
    phase: 3,
    label: 'What do you want to generate first from this Brand Guide?',
    type: 'choice',
    choices: [
      'brand identity poster',
      'storyboard / cinematic direction',
      'product shots / packaging',
      'website hero / landing page',
      'character sheet / turnarounds',
      'social media assets',
    ],
    acceptsImage: false,
    required: false,
    isMissing: (state) => !state?.userUploads?.brandSystem?.targetOutput,
  },
];

// ── Gap → field name mapping ──────────────────────────────────────────────────

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

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Map a dashboardState snapshot to the partial Brand System JSON + gap list.
 *
 * @param {object} state — dashboardState shape
 * @returns {{ filled: object, gaps: Array, completeness: number, schemaVersion: number }}
 */
function mapPipelineToBrandSystem(state) {
  const safe = state || {};
  const uo = safe?.userUploads?.brandSystem || {};
  const kb = safe?.knowledgeBaseContext || safe?.knowledgeBase || null;
  const kbBlock = typeof kb?.block === 'string'
    ? kb.block
    : Array.isArray(kb?.chunks)
      ? kb.chunks.map((chunk) => chunk?.excerpt || chunk?.text || '').filter(Boolean).join('\n')
      : '';
  const kbSources = Array.isArray(kb?.sources) ? kb.sources : [];

  // ── Core fields ────────────────────────────────────────────────────────────
  const brandName       = uo.brandName       || getBrandName(safe);
  const brandStatement  = uo.brandStatement  || getBrandStatement(safe);
  const industry        = uo.industry        || getIndustry(safe);
  const tagline         = uo.tagline         || getTagline(safe);
  const targetAudience  = uo.targetAudience  || getTargetAudience(safe);
  const soulDescriptors = uo.soulDescriptors || getSoulDescriptors(safe);
  const colors          = uo.colors          || getColors(safe);
  const colorsV2        = uo.colorsV2        || getColorsV2(safe);
  const typography      = uo.typography      || getTypography(safe);
  const logoUrl         = getLogoUrl(safe);
  const logoVision      = uo.logoVisionAnalysis || null;
  const visualLanguage  = uo.visualLanguage  || null;
  const lighting        = uo.lighting        || null;
  const material        = uo.material        || null;

  // ── v2 fields ──────────────────────────────────────────────────────────────
  const brandArchetype   = uo.brandArchetype   || null;
  const compositionStyle = uo.compositionStyle || null;
  const colorMood        = uo.colorMood        || null;
  const motionIntent     = uo.motionIntent     || null;
  const layoutGrid       = uo.layoutGrid       || null;
  const headlineSpecimen = uo.headlineSpecimen || null;
  const photoDirection   = uo.photoDirection   || null;
  const targetOutput     = uo.targetOutput     || null;
  const brandVoice       = getBrandVoice(safe);
  const homepageUrl      = getHomepageScreenshotUrl(safe);

  const designDirection  = uo.designDirection  || null;
  const moodBoard        = uo.moodBoard        || [];
  const brandPhotos      = uo.brandPhotos      || [];
  const competitorRefs   = uo.competitorRefs   || [];
  const productShots     = uo.productShots     || [];
  const colorPalette     = uo.colorPalette     || null;

  // Build composition object from compositionStyle choice
  const compositionMap = {
    'magazine-dense — every inch used':         { style: 'layered-dense',       density: 'magazine-dense',  whitespace: 'intentional-minimal' },
    'balanced — structured with breathing room':{ style: 'grid-strict',         density: 'balanced',        whitespace: 'structured' },
    'minimal — lots of whitespace':             { style: 'minimal-breathing',   density: 'minimal',         whitespace: 'generous' },
    'asymmetric — dynamic, unexpected layouts': { style: 'asymmetric',          density: 'dynamic',         whitespace: 'variable' },
  };
  const composition = compositionStyle ? (compositionMap[compositionStyle] || null) : null;

  // Parse motion-intent choice into motion object
  const motionMap = {
    'none — purely static':                           { style: 'none',       easing: null, speed: null, transitions: null },
    'subtle — gentle fades, micro-interactions':      { style: 'subtle',     easing: 'ease-in-out', speed: 'moderate', transitions: 'fade' },
    'expressive — playful, bouncy, attention-grabbing':{ style: 'expressive', easing: 'spring', speed: 'fast', transitions: 'scale' },
    'cinematic — smooth, dramatic, film-quality':     { style: 'cinematic',  easing: 'ease-in-out', speed: 'slow-deliberate', transitions: 'fade' },
  };
  const motion = motionIntent ? (motionMap[motionIntent] || null) : null;

  // Parse layout-grid choice into layout_grammar object
  const layoutMap = {
    'strict grid — clean columns, aligned edges': { grid_system: '12-col',  border_radius: 'subtle',   card_style: 'flat' },
    'fluid — responsive, organic flow':           { grid_system: 'fluid',   border_radius: 'rounded',  card_style: 'elevated' },
    'masonry — Pinterest-style staggered':        { grid_system: 'masonry', border_radius: 'rounded',  card_style: 'elevated' },
    'freeform — overlapping, editorial':          { grid_system: 'freeform',border_radius: 'sharp',    card_style: 'flat' },
  };
  const layoutGrammar = layoutGrid ? (layoutMap[layoutGrid] || null) : null;

  // Build photography_direction from photo-direction choice + logo vision
  const photoStyleMap = {
    'editorial — magazine-quality, art-directed':    'editorial',
    'documentary — real, unposed, authentic':         'documentary',
    'studio — clean, controlled, product-focused':   'studio',
    'lifestyle — aspirational, environmental':        'lifestyle',
    'abstract — textures, shapes, conceptual':       'abstract',
  };
  const photoStyle = photoDirection ? (photoStyleMap[photoDirection] || null) : null;

  const filled = {
    brand_header: {
      brand_name:      brandName,
      brand_statement: brandStatement,
      soul_descriptors: soulDescriptors,
      brand_archetype: brandArchetype,
      tagline:         tagline,
      industry:        industry,
      target_audience: targetAudience,
    },
    color_system: colorsV2
      ? { ...colorsV2, color_mood: colorMood || colorsV2.color_mood }
      : null,
    // v1-compat shape still present for legacy consumers
    color_system_v1: colors,
    typography_system: typography
      ? {
          ...typography,
          specimens: headlineSpecimen
            ? { headline_example: headlineSpecimen, subheadline_example: null, body_example: null }
            : null,
        }
      : null,
    visual_language: {
      industry,
      style: visualLanguage,
      lighting,
      texture: material,
      mood_keywords: [],
      composition,
      logo_url: logoUrl,
      logo_vision: logoVision,
    },
    photography_direction: (photoStyle || lighting) ? {
      style: photoStyle,
      subject_treatment: null,
      lighting_setup: lighting,
      color_treatment: null,
      depth_of_field: null,
      framing: null,
      post_processing: null,
      art_direction_notes: null,
      reference_mood: [],
    } : null,
    iconography: logoVision ? {
      style: logoVision.iconography_style?.style || null,
      stroke_rule: logoVision.iconography_style?.rule || null,
      shape_grammar: logoVision.shape_language?.primary || null,
      stroke_logic: logoVision.stroke_logic || null,
      count: '6-10',
      icon_names: logoVision.suggested_icon_names || [],
      containment: logoVision.containment_shape || null,
    } : null,
    patterns_and_motifs: {
      sources: 'Derived from logo geometry.',
      seeds: Array.isArray(logoVision?.motif_seeds) ? logoVision.motif_seeds : [],
      application_rules: logoVision?.suggested_patterns || [],
    },
    material_and_depth: {
      surface: material,
      shadow_style: null,
      layer_depth: null,
      reasoning: logoVision?.material_inference?.reasoning || null,
    },
    brand_applications: [
      { type: 'Product Packaging',  detail: 'Dimensional, realistic render',        priority: 1 },
      { type: 'Website Hero',       detail: 'Full desktop viewport with nav + CTA', priority: 1 },
      { type: 'Mobile App Screen',  detail: 'One key UI moment (home or onboarding)',priority: 2 },
      { type: 'Social Media Posts', detail: '3 formats — square (1:1), story (9:16), banner (16:9)', priority: 1 },
      { type: 'Business Card',      detail: 'Front and back with contact info specimen', priority: 2 },
      { type: 'Out-of-Home Ad',     detail: 'Billboard or transit panel',           priority: 3 },
    ],
    brand_voice: brandVoice,
    design_direction: designDirection
      ? {
          keep: designDirection.keep || [],
          change: designDirection.change || [],
          add: designDirection.add || [],
          confidence_score: designDirection.confidenceScore || null,
          site_vision_analysis: uo.siteVisionAnalysis || null,
        }
      : null,
    motion,
    layout_grammar: layoutGrammar,
    assets: {
      logo:                  { url: logoUrl, vision_analysis: logoVision },
      mood_board:            moodBoard,
      brand_photos:          brandPhotos,
      competitor_screenshots: competitorRefs,
      product_shots:         productShots,
      homepage_screenshot:   { url: homepageUrl, vision_analysis: uo.siteVisionAnalysis || null },
    },
    knowledge_base_context: kbBlock
      ? {
          role: 'client-owned source of truth for brand facts, positioning, audience, category, and product claims',
          excerpt: kbBlock.slice(0, 2600),
          sources: kbSources.slice(0, 5),
        }
      : null,
  };

  // Compute remaining gaps in declaration order.
  const gaps = GAP_DEFS
    .filter((g) => g.isMissing(safe, { logo: logoVision }))
    .map((g) => ({
      id: g.id,
      phase: g.phase,
      question: g.label,
      type: g.type,
      acceptsImage: g.acceptsImage,
      choices: g.choices || null,
      required: g.required,
      maxFiles: g.maxFiles || null,
      hint: g.hint || null,
      showsScreenshot: g.showsScreenshot || false,
    }));

  // Completeness: ratio of non-null leaf fields in the canonical set.
  const canonicalFields = [
    brandName, brandStatement, industry, soulDescriptors,
    colorsV2?.foundation?.length ? colorsV2 : null,
    typography?.headline ? typography : null,
    logoUrl || logoVision,
    visualLanguage, lighting, material,
    brandArchetype, compositionStyle, colorMood,
  ];
  const filledCount = canonicalFields.filter(Boolean).length;
  const completeness = filledCount / canonicalFields.length;

  return {
    filled,
    gaps,
    completeness: Math.round(completeness * 100) / 100,
    schemaVersion: SCHEMA_VERSION,
  };
}

// ── Vision helper — Anthropic Claude analyzes uploaded logo ──────────────────

const fs = require('fs');
const path = require('path');
const { callAnthropic } = require('../_anthropic-client.js');

const VISION_MODEL = 'claude-sonnet-4-20250514';
const VISION_MAX_TOKENS = 1500;

function loadVisionSystemPrompt() {
  const skillPath = path.join(__dirname, '..', 'skills', 'brand-system-vision.md');
  return fs.readFileSync(skillPath, 'utf8');
}

/**
 * Run Anthropic vision over a logo image.
 *
 * @param {object} opts
 * @param {string} [opts.imageUrl]    — public URL the model can fetch
 * @param {string} [opts.imageBase64] — base64 string (no data: prefix)
 * @param {string} [opts.mediaType]   — required when passing imageBase64
 * @returns {Promise<{ ok: true, vision: object, usage: object } | { ok: false, error: string }>}
 */
async function analyzeLogo({ imageUrl, imageBase64, mediaType } = {}) {
  if (!imageUrl && !imageBase64) {
    return { ok: false, error: 'No image source provided.' };
  }

  const imageBlock = imageUrl
    ? { type: 'image', source: { type: 'url', url: imageUrl } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/png', data: imageBase64 } };

  let response;
  try {
    response = await callAnthropic({
      model: VISION_MODEL,
      max_tokens: VISION_MAX_TOKENS,
      system: loadVisionSystemPrompt(),
      messages: [
        {
          role: 'user',
          content: [
            imageBlock,
            { type: 'text', text: 'Analyze this logo. Return JSON only, matching the schema in the system prompt.' },
          ],
        },
      ],
    });
  } catch (err) {
    return { ok: false, error: `vision_call_failed: ${err.message}` };
  }

  const raw = (response?.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '');

  let vision;
  try {
    vision = JSON.parse(raw);
  } catch {
    return { ok: false, error: `vision_parse_failed: ${raw.slice(0, 300)}` };
  }

  return {
    ok: true,
    vision,
    usage: {
      inputTokens: response?.usage?.input_tokens || 0,
      outputTokens: response?.usage?.output_tokens || 0,
    },
  };
}

// ── v2 JSON assembler ─────────────────────────────────────────────────────────

/**
 * Assemble the final Brand Guide JSON v2 from a completed filled snapshot.
 * Matches the SCHEMA.json shape exactly.
 */
function buildBrandSystemJsonV2({ filled, sources, generatedAt } = {}) {
  const f = filled || {};

  return {
    schema_version: 2,
    title: `Brand Guide — ${f.brand_header?.brand_name || '[brand]'}`,
    brand_header:        f.brand_header        || null,
    color_system:        f.color_system        || null,
    typography_system:   f.typography_system   || null,
    visual_language:     f.visual_language
      ? {
          style:          f.visual_language.style,
          lighting:       f.visual_language.lighting,
          texture:        f.visual_language.texture,
          industry:       f.visual_language.industry,
          mood_keywords:  f.visual_language.mood_keywords || [],
          composition:    f.visual_language.composition || null,
        }
      : null,
    photography_direction: f.photography_direction || null,
    iconography:         f.iconography         || null,
    patterns_and_motifs: f.patterns_and_motifs  || null,
    material_and_depth:  f.material_and_depth   || null,
    brand_applications:  f.brand_applications   || [],
    brand_voice:         f.brand_voice          || null,
    design_direction:    f.design_direction     || null,
    motion:              f.motion               || null,
    layout_grammar:      f.layout_grammar       || null,
    quality_standard: {
      benchmark: 'Must look like it costs $15,000 to produce.',
      total_elements: '30–50 distinct visual elements.',
      failure_conditions: ['Looks templated', 'Generic placeholders', 'Disconnected elements', 'Sparse sections'],
    },
    format: {
      layout: 'Multi-column grid',
      aspect_ratio: '4:5',
      orientation: 'Vertical',
      composition: 'Layered, dense, intentional — zero wasted space',
    },
    sources: sources || {},
    knowledge_base_context: f.knowledge_base_context || null,
    generated_at: generatedAt || new Date().toISOString(),
    assets: f.assets || null,
  };
}

// ── v1 JSON assembler (backward compat) ───────────────────────────────────────

function buildBrandSystemJson({ filled }) {
  const f = filled || {};
  const visualLang = f.visual_language || {};
  const logoVision = visualLang.logo_vision || {};
  const motifSeeds = Array.isArray(logoVision.motif_seeds) ? logoVision.motif_seeds : [];

  return {
    schema_version: 1,
    title: 'Agency-Grade Brand Identity System Poster',
    format: {
      orientation: 'Vertical',
      aspect_ratio: '4:5',
      layout: 'Multi-column grid',
      composition: 'Layered, dense, intentional — zero wasted space',
    },
    brand_header: {
      brand_name:       f.brand_header?.brand_name       || null,
      brand_statement:  f.brand_header?.brand_statement  || null,
      soul_descriptors: f.brand_header?.soul_descriptors || logoVision.personality_words || null,
    },
    color_system:    f.color_system_v1 || null,
    typography_system: f.typography_system || null,
    visual_language: {
      industry: visualLang.industry || null,
      style:    visualLang.style    || null,
      lighting: visualLang.lighting || null,
      texture:  f.material_and_depth?.surface || null,
    },
    iconography: {
      style:        logoVision.iconography_style?.style || null,
      stroke_rule:  logoVision.iconography_style?.rule  || null,
      shape_grammar: logoVision.shape_language?.primary || null,
      stroke_logic: logoVision.stroke_logic || null,
    },
    patterns_and_motifs: {
      sources: 'Derived from logo geometry only.',
      seeds: motifSeeds,
    },
    material_and_depth: {
      surface:   f.material_and_depth?.surface   || null,
      reasoning: f.material_and_depth?.reasoning || null,
    },
    knowledge_base_context: f.knowledge_base_context || null,
    brand_applications: f.brand_applications || [],
    quality_standard: {
      benchmark: 'Must look like it costs $15,000 to produce.',
      total_elements: '30–50 distinct visual elements.',
      failure_conditions: ['Looks templated', 'Generic placeholders', 'Disconnected elements', 'Sparse sections'],
    },
  };
}

// ── Master Prompt (v1 — unchanged) ────────────────────────────────────────────

function buildMasterPrompt(json) {
  const j = json || {};
  const colors = j.color_system || {};
  const colorLine = (arr, label) => {
    if (!Array.isArray(arr) || !arr.length) return null;
    return `${label}: ${arr.map((c) => c.hex).join(', ')}`;
  };
  const colorLines = [
    colorLine(colors.primary,   'Primary'),
    colorLine(colors.secondary, 'Secondary'),
    colorLine(colors.accent,    'Accent'),
  ].filter(Boolean).join(' · ');

  const motifs = (j.patterns_and_motifs?.seeds || []).join(' · ');

  return [
    `Design a vertical 4:5 brand identity system poster for "${j.brand_header?.brand_name || '[brand]'}" — agency-grade, magazine-dense, zero wasted space.`,
    ``,
    `BRAND HEADER`,
    `Name: ${j.brand_header?.brand_name || '[brand]'}`,
    `Statement: ${j.brand_header?.brand_statement || '[6-word statement]'}`,
    `Soul: ${(j.brand_header?.soul_descriptors || []).join(' / ') || '[3 descriptors]'}`,
    ``,
    `COLOR SYSTEM`,
    colorLines || '[colors not extracted — request palette from user]',
    `Show wide swatches with HEX codes and role labels (foundation / emphasis / atmosphere). Include gradient blends and color-on-color pairings.`,
    ``,
    `TYPOGRAPHY`,
    `Headline: ${j.typography_system?.headline?.font_family || j.typography_system?.headline?.fontFamily || '[headline font]'}`,
    `Body: ${j.typography_system?.body?.font_family || j.typography_system?.body?.fontFamily || '[body font]'}`,
    `Render a real headline + subheadline + body paragraph specimen. Hierarchy must be undeniable at a glance.`,
    ``,
    `VISUAL LANGUAGE`,
    `Industry: ${j.visual_language?.industry || '[industry]'}`,
    `Style: ${j.visual_language?.style || '[style]'} · Lighting: ${j.visual_language?.lighting || '[lighting]'} · Surface: ${j.visual_language?.texture || '[material]'}`,
    `Add 3–5 art-directed mood tiles that read like stills from a real shoot brief.`,
    j.knowledge_base_context?.excerpt ? `` : null,
    j.knowledge_base_context?.excerpt ? `CLIENT KNOWLEDGE BASE — use this as source-of-truth context for business facts, positioning, audience, offer language, and product claims:` : null,
    j.knowledge_base_context?.excerpt ? j.knowledge_base_context.excerpt : null,
    ``,
    `ICONOGRAPHY (6–10 icons)`,
    `Style: ${j.iconography?.style || '[icon style]'} · Stroke rule: ${j.iconography?.stroke_rule || '[stroke rule]'} · Shape grammar: ${j.iconography?.shape_grammar || '[grammar]'}`,
    `Uniform stroke or fill logic across the entire set.`,
    ``,
    `PATTERNS & MOTIFS`,
    motifs ? `Derived from logo geometry: ${motifs}` : `Derive 3 motifs from the logo's geometry only.`,
    `Use as background patterns, decorative shapes, structural dividers.`,
    ``,
    `BRAND APPLICATIONS — render every mockup as if shot for the same brand world`,
    ...(j.brand_applications || []).map((a) => `• ${a.type} — ${a.detail}`),
    ``,
    `MATERIAL & DEPTH`,
    `Surface: ${j.material_and_depth?.surface || '[surface]'}. Shadows with directional logic. Layer depth that makes elements feel physically present.`,
    ``,
    `QUALITY BAR`,
    `${j.quality_standard?.benchmark} ${j.quality_standard?.total_elements} ${(j.quality_standard?.failure_conditions || []).map((fc) => `Avoid: ${fc}.`).join(' ')}`,
  ].filter((line) => line !== null).join('\n');
}

/**
 * Convenience: run the mapper and assemble final JSON + Master Prompt
 * when there are no remaining required gaps.
 */
function buildIfComplete(state) {
  const result = mapPipelineToBrandSystem(state);
  const requiredGaps = result.gaps.filter((g) => g.required);
  if (requiredGaps.length > 0) {
    return { done: false, ...result };
  }
  const jsonV2 = buildBrandSystemJsonV2({ filled: result.filled });
  const jsonV1 = buildBrandSystemJson({ filled: result.filled });
  const masterPrompt = buildMasterPrompt(jsonV1);
  return { done: true, ...result, json: jsonV1, jsonV2, masterPrompt };
}

module.exports = {
  SCHEMA_VERSION,
  GAP_DEFS,
  fieldForGap,
  mapPipelineToBrandSystem,
  analyzeLogo,
  buildBrandSystemJson,
  buildBrandSystemJsonV2,
  buildMasterPrompt,
  buildIfComplete,
};
