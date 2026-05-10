// Lead Gen — DESIGN.MD Generator
// Combines prospect metadata, onboard intelligence, and scraped content into
// a precise creative brief that Claude can use to one-shot a homepage.
// Returns a markdown string. No I/O — caller writes to clients/{slug}/DESIGN.MD.

// ─── VERTICAL DESIGN DEFAULTS ────────────────────────────────────────────────

const VERTICAL_DEFAULTS = {
  lawyer: {
    primary:       '#1a3c5e',
    secondary:     '#d4a853',
    accent:        '#c0392b',
    headingFont:   'Georgia, serif',
    bodyFont:      'system-ui, sans-serif',
    borderRadius:  '2px',
    personality:   'authoritative, trustworthy, professional, precise',
    mood:          'A seasoned firm that wins cases — serious, accessible, confident',
  },
  dental: {
    primary:       '#2980b9',
    secondary:     '#27ae60',
    accent:        '#f39c12',
    headingFont:   "'Nunito', sans-serif",
    bodyFont:      "'Open Sans', sans-serif",
    borderRadius:  '8px',
    personality:   'clean, bright, welcoming, professional',
    mood:          'A modern practice that puts patients at ease — bright, friendly, precise',
  },
  home_services: {
    primary:       '#e67e22',
    secondary:     '#2c3e50',
    accent:        '#27ae60',
    headingFont:   "'Roboto Condensed', sans-serif",
    bodyFont:      "'Roboto', sans-serif",
    borderRadius:  '4px',
    personality:   'reliable, honest, skilled, local',
    mood:          'A contractor you can trust — straightforward, dependable, gets the job done',
  },
  restaurant: {
    primary:       '#c0392b',
    secondary:     '#2c3e50',
    accent:        '#f39c12',
    headingFont:   "'Playfair Display', serif",
    bodyFont:      "'Lato', sans-serif",
    borderRadius:  '6px',
    personality:   'warm, inviting, distinctive, celebratory',
    mood:          'A dining experience worth returning to — warm, rich, memorable',
  },
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
  auto_repair: {
    primary:       '#1e3a5f',
    secondary:     '#dc2626',
    accent:        '#f59e0b',
    headingFont:   "'Oswald', sans-serif",
    bodyFont:      "'Source Sans 3', sans-serif",
    borderRadius:  '4px',
    personality:   'dependable, no-nonsense, skilled, honest',
    mood:          'A mechanic who tells it to you straight — trusted, capable, fair',
  },
  chiropractor: {
    primary:       '#0d9488',
    secondary:     '#1e40af',
    accent:        '#84cc16',
    headingFont:   "'Raleway', sans-serif",
    bodyFont:      "'Nunito Sans', sans-serif",
    borderRadius:  '8px',
    personality:   'holistic, caring, evidence-based, restorative',
    mood:          'Natural healing backed by science — warm, professional, aligned',
  },
  gym_fitness: {
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
  wedding_event: {
    primary:       '#be185d',
    secondary:     '#d4a853',
    accent:        '#7c3aed',
    headingFont:   "'Cormorant Garamond', serif",
    bodyFont:      "'Quicksand', sans-serif",
    borderRadius:  '16px',
    personality:   'romantic, elegant, joyful, detail-oriented',
    mood:          'Your perfect day, perfectly planned — dreamy, bespoke, memorable',
  },
  pet_services: {
    primary:       '#059669',
    secondary:     '#2563eb',
    accent:        '#f59e0b',
    headingFont:   "'Nunito', sans-serif",
    bodyFont:      "'Open Sans', sans-serif",
    borderRadius:  '12px',
    personality:   'compassionate, gentle, expert, reassuring',
    mood:          'Where your pet is family too — warm, professional, caring',
  },
  default: {
    primary:       '#2c3e50',
    secondary:     '#3498db',
    accent:        '#e74c3c',
    headingFont:   'system-ui, sans-serif',
    bodyFont:      'system-ui, sans-serif',
    borderRadius:  '4px',
    personality:   'professional, modern, trustworthy',
    mood:          'A credible local business with a polished online presence',
  },
};

function getDefaults(vertical) {
  return VERTICAL_DEFAULTS[vertical] || VERTICAL_DEFAULTS.default;
}

// ─── SECTION ANIMATION MAP ───────────────────────────────────────────────────

const SECTION_PRESETS = {
  hero:         'heroParallax + textReveal',
  services:     'staggerGrid',
  testimonials: 'slideCards',
  stats:        'counterUp',
  contact:      'fadeUp',
  about:        'fadeUp',
  team:         'staggerGrid',
  gallery:      'staggerGrid',
  faq:          'fadeUp',
};

function sectionPreset(sectionType) {
  return SECTION_PRESETS[sectionType] || SECTION_PRESETS.contact;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function safe(val, fallback = '—') {
  if (val === null || val === undefined || val === '') return fallback;
  return String(val);
}

function formatTable(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i] || '').length)));
  const sep    = widths.map(w => '-'.repeat(w)).join(' | ');
  const head   = headers.map((h, i) => h.padEnd(widths[i])).join(' | ');
  const body   = rows.map(r => r.map((c, i) => String(c || '').padEnd(widths[i])).join(' | ')).join('\n');
  return `| ${head} |\n| ${sep} |\n${body.split('\n').map(l => `| ${l} |`).join('\n')}`;
}

// ─── OPERATOR NOTES BUILDER ──────────────────────────────────────────────────

function buildOperatorNotes(bs, designReferences = null) {
  if (!bs && !designReferences) return '_No brand intelligence available. Add creative direction manually._';
  if (!bs) {
    const refNote = designReferences?.briefNote;
    return refNote || '_No brand intelligence available. Add creative direction manually._';
  }

  const lines = [];
  const dd = bs.design_direction;
  if (dd) {
    if (dd.keep?.length)   lines.push(`**KEEP from current site:**\n${dd.keep.map(k => `- ${k}`).join('\n')}`);
    if (dd.change?.length) lines.push(`**CHANGE:**\n${dd.change.map(c => `- ${c}`).join('\n')}`);
    if (dd.add?.length)    lines.push(`**ADD:**\n${dd.add.map(a => `- ${a}`).join('\n')}`);
    if (dd.confidence_score != null) lines.push(`_Design direction confidence: ${dd.confidence_score}/100_`);
  }

  const icon = bs.iconography;
  if (icon?.style) {
    lines.push(`**Iconography:**\n- Style: ${icon.style}\n- Stroke: ${icon.stroke_rule || '—'}\n- Shape grammar: ${icon.shape_grammar || '—'}\n- Containment: ${icon.containment || '—'}`);
    if (icon.icon_names?.length) lines.push(`- Suggested icons: ${icon.icon_names.join(', ')}`);
  }

  const pat = bs.patterns_and_motifs;
  if (pat?.seeds?.length) {
    lines.push(`**Patterns & Motifs:**\n- Seeds: ${pat.seeds.join(', ')}`);
    if (pat.application_rules?.length) lines.push(`- Rules: ${pat.application_rules.join('; ')}`);
  }

  const mat = bs.material_and_depth;
  if (mat?.surface) {
    lines.push(`**Material & Depth:**\n- Surface: ${mat.surface}\n- Shadow: ${mat.shadow_style || '—'}\n- Depth: ${mat.layer_depth || '—'}`);
  }

  if (bs.brand_applications?.length) {
    lines.push(`**Brand Application Priorities:**\n${bs.brand_applications.map(a => `- [${a.priority}] ${a.type}: ${a.detail}`).join('\n')}`);
  }

  const refNote = designReferences?.briefNote;
  if (refNote) lines.push(`\n${refNote}`);

  return lines.join('\n\n') || '_Brand system started but no creative direction captured yet._';
}

// ─── DESIGN.MD BUILDER ───────────────────────────────────────────────────────

export function generateDesignMd({ prospect, onboard = {}, content = {}, assetManifest = null, brandSystem = null, designReferences = null }) {
  const def    = getDefaults(prospect.vertical);
  const copy   = content.copy    || {};
  const colors = content.colors  || {};
  const struct = content.structure || {};
  const assets = assetManifest || content.assets || {};

  // ── Source: Agent Readiness ───────────────────────────────────────────────
  const ai  = onboard.agentReadiness || {};
  const aiChecks = ai.checks || [];

  // ── Source: SEO / PageSpeed ───────────────────────────────────────────────
  const psi = onboard.seoPerformance?.pagespeed || {};
  // Handle both flat (psi.performance) and nested (psi.scores.performance) shapes.
  const perfScore = safe(psi.scores?.performance ?? psi.performance, '?');
  const a11yScore = safe(psi.scores?.accessibility ?? psi.accessibility, '?');
  const seoScore  = safe(psi.scores?.seo ?? psi.seo, '?');
  const bpScore   = safe(psi.scores?.bestPractices ?? psi.bestPractices, '?');
  const lcpMs     = psi.scores?.largest_contentful_paint ?? psi.largest_contentful_paint;
  const fidMs     = psi.scores?.first_input_delay ?? psi.first_input_delay;
  const cls       = psi.scores?.cumulative_layout_shift ?? psi.cumulative_layout_shift;
  const seoFindings = onboard.seoPerformance?.skillOutput?.findings || [];

  // ── Source: Social Preview ────────────────────────────────────────────────
  const social = onboard.socialPreview?.siteMeta || {};

  // ── Source: Design Evaluation ─────────────────────────────────────────────
  const de       = onboard.designEvaluation?.styleGuide || {};
  const deColors = de.colors || {};
  const deTypo   = de.typography || {};

  // ── Source: Brand System ──────────────────────────────────────────────────
  const bs         = brandSystem || {};
  const bsColors   = bs.color_system    || {};
  const bsTypo     = bs.typography_system || {};
  const bsVisual   = bs.visual_language  || {};
  const bsMotion   = bs.motion           || {};
  const bsLayout   = bs.layout_grammar   || {};
  const bsVoice    = bs.brand_voice      || {};
  const bsPhoto    = bs.photography_direction || {};
  const bsIcon     = bs.iconography      || {};
  const bsPatterns = bs.patterns_and_motifs || {};
  const bsMaterial = bs.material_and_depth  || {};
  const bsHeader   = bs.brand_header    || {};

  // ── Color resolution: Brand System > Design Eval > Scraper > Vertical Default ──
  const primaryHex    = bsColors.foundation?.[0]?.hex || deColors.primary?.hex || colors.primary || def.primary;
  const primarySrc    = bsColors.foundation?.[0]?.hex ? 'brand-system' : deColors.primary?.hex ? 'design-eval' : colors.primary ? 'css-extraction' : 'vertical-default';
  const primaryConf   = bsColors.foundation?.[0]?.hex ? 'curated' : deColors.primary?.hex ? (de.confidence || 'medium') : colors.primary ? 'low' : 'default';

  const secondaryHex  = bsColors.emphasis?.[0]?.hex || deColors.secondary?.hex || colors.secondary || def.secondary;
  const secondarySrc  = bsColors.emphasis?.[0]?.hex ? 'brand-system' : deColors.secondary?.hex ? 'design-eval' : colors.secondary ? 'css-extraction' : 'vertical-default';
  const secondaryConf = bsColors.emphasis?.[0]?.hex ? 'curated' : deColors.secondary?.hex ? (de.confidence || 'medium') : colors.secondary ? 'low' : 'default';

  const accentHex     = bsColors.emphasis?.[1]?.hex || bsColors.atmosphere?.[0]?.hex || deColors.tertiary?.hex || colors.accent || def.accent;
  const accentSrc     = (bsColors.emphasis?.[1]?.hex || bsColors.atmosphere?.[0]?.hex) ? 'brand-system' : deColors.tertiary?.hex ? 'design-eval' : colors.accent ? 'css-extraction' : 'vertical-default';
  const accentConf    = (bsColors.emphasis?.[1]?.hex || bsColors.atmosphere?.[0]?.hex) ? 'curated' : deColors.tertiary?.hex ? (de.confidence || 'medium') : colors.accent ? 'low' : 'default';

  // ── Mode detection: dark if primary is very dark ──────────────────────────
  const isDark = (() => {
    const hex = primaryHex.replace('#', '');
    if (hex.length < 6) return false;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return (r * 0.299 + g * 0.587 + b * 0.114) < 60;
  })();
  const bgColor    = isDark ? '#0a0a0a' : '#ffffff';
  const textColor  = isDark ? '#f5f5f5' : '#1a1a1a';
  const mutedColor = isDark ? '#a0a0a0' : '#6b7280';

  // ── Typography resolution: Brand System > Design Eval > Vertical Default ──
  const headingFont   = bsTypo.headline?.font_family || deTypo.headingSystem?.fontFamily || def.headingFont;
  const headingWeight = bsTypo.headline?.weight      || deTypo.headingSystem?.fontWeight || '700';
  const headingSrc    = bsTypo.headline?.font_family ? 'brand-system' : deTypo.headingSystem?.fontFamily ? 'design-eval' : 'vertical-default';

  const bodyFont      = bsTypo.body?.font_family || deTypo.bodySystem?.fontFamily || def.bodyFont;
  const bodyWeight    = bsTypo.body?.weight      || deTypo.bodySystem?.fontWeight || '400';
  const bodySrc       = bsTypo.body?.font_family ? 'brand-system' : deTypo.bodySystem?.fontFamily ? 'design-eval' : 'vertical-default';

  // ── Personality / mood resolution ────────────────────────────────────────
  const personality = (bsVisual.mood_keywords?.length ? bsVisual.mood_keywords.join(', ') : null)
    || (bsHeader.soul_descriptors?.length ? bsHeader.soul_descriptors.join(', ') : null)
    || def.personality;
  const mood = bsHeader.brand_statement || def.mood;

  // ── Motion resolution: Brand System > Design Eval > default ──────────────
  const motionStyle  = bsMotion.style || de.motion?.level || 'subtle';
  const motionEasing = bsMotion.easing || 'power2.out';
  const motionSpeed  = bsMotion.speed  || 'medium';
  const MOTION_DURATIONS = {
    none:       '0s (no animation)',
    subtle:     '0.4s–0.8s',
    expressive: '0.6s–1.2s',
    cinematic:  '0.8s–1.6s',
    moderate:   '0.6s–1.0s',
    bold:       '0.8s–1.4s',
  };
  const motionDuration = MOTION_DURATIONS[motionStyle] || '0.6s–1.2s';

  // ── Layout resolution ─────────────────────────────────────────────────────
  const borderRadius = bsLayout.border_radius || def.borderRadius;
  const gridSystem   = bsLayout.grid_system   || de.layout?.gridSystem || null;

  // ── Asset manifest lines ──────────────────────────────────────────────────
  const logoFile  = assets.logo?.localPath || assets.logo?.filename || assets.logo?.url || null;
  const heroFile  = (assets.heroImages || [])[0]?.localPath || (assets.heroImages || [])[0]?.filename || (assets.heroImages || [])[0]?.url || null;
  const ogImageUrl = social.ogImage || null;

  const allSectionImages = [
    ...(assets.sectionImages || []),
    ...(assets.teamPhotos    || []),
    ...(assets.galleryImages || []),
  ].filter(i => i.localPath);

  // ── Sections to include ───────────────────────────────────────────────────
  const requiredSections = ['hero', 'services', 'social-proof', 'contact'];
  const optionalSections = [];
  if (copy.aboutText)        optionalSections.push('about');
  if (struct.hasTeamSection) optionalSections.push('team');
  if (struct.hasGallery)     optionalSections.push('gallery');
  if (struct.hasPricing)     optionalSections.push('pricing');
  if (copy.missionStatement) optionalSections.push('mission');
  const sections = [...requiredSections, ...optionalSections];

  // ── Services table ────────────────────────────────────────────────────────
  const serviceRows = (copy.serviceDescriptions || []).slice(0, 8).map(s => [s.name, s.description || '']);
  const servicesTable = serviceRows.length > 0
    ? formatTable(['Service', 'Description'], serviceRows)
    : '_No services scraped — operator should fill in._';

  // ── Testimonials table ────────────────────────────────────────────────────
  const testRows = (copy.testimonials || []).slice(0, 4).map(t => [
    `"${t.quote.slice(0, 120)}"`,
    t.author || '—',
    t.role   || '—',
  ]);
  const testimonialsTable = testRows.length > 0
    ? formatTable(['Quote', 'Author', 'Role'], testRows)
    : '_No testimonials scraped — use Google review excerpts or placeholders._';

  // ── Missing assets list ───────────────────────────────────────────────────
  const missingAssets = [];
  if (!logoFile)  missingAssets.push('- [ ] Logo — not detected or failed to download');
  if (!heroFile)  missingAssets.push('- [ ] Hero image — not detected or failed to download');
  if (allSectionImages.length < 2) missingAssets.push('- [ ] Additional section images (recommend 2–4)');

  // ── Readiness dimensions table ────────────────────────────────────────────
  const dimensionRows = Object.entries(ai.dimensions || {}).map(([k, v]) => [k, v?.score ?? '—', v?.verdict || '—']);

  // ─────────────────────────────────────────────────────────────────────────
  // DESIGN.MD
  // ─────────────────────────────────────────────────────────────────────────

  return `# DESIGN.MD — ${safe(prospect.name)}

> Auto-generated creative brief for site generation.
> Last updated: ${new Date().toISOString()}
> Status: DRAFT

---

## 1. CLIENT IDENTITY

- **Business:** ${safe(prospect.name)}
- **Vertical:** ${safe(prospect.vertical)}${prospect.subVertical ? ' / ' + prospect.subVertical : ''}
- **Location:** ${safe(prospect.address)}
- **Rating:** ${safe(prospect.rating)}★ (${safe(prospect.reviewCount)} reviews)
- **Website (current):** ${safe(prospect.website)}
- **Place ID:** ${safe(prospect.placeId)}
- **Tagline:** "${safe(bsHeader.tagline || social.description, '—')}"
- **Target Audience:** ${safe(bsHeader.target_audience, '—')}
- **Brand Archetype:** ${safe(bsHeader.brand_archetype, '—')}
- **Meta Description:** ${safe(social.description, '—')}

---

## 2. VISUAL SYSTEM

### Colors
${formatTable(
  ['Role', 'Hex', 'Source', 'Confidence'],
  [
    ['Primary',    primaryHex,   primarySrc,   primaryConf],
    ['Secondary',  secondaryHex, secondarySrc, secondaryConf],
    ['Accent',     accentHex,    accentSrc,    accentConf],
    ['Background', bgColor,      'mode-detection', '—'],
    ['Text',       textColor,    'mode-detection', '—'],
    ['Muted',      mutedColor,   'derived',    '—'],
  ],
)}
${bsColors.color_mood ? `\n- **Color Mood:** ${bsColors.color_mood}` : ''}

### Typography
${formatTable(
  ['Role', 'Font', 'Weight', 'Source'],
  [
    ['Heading', headingFont, headingWeight, headingSrc],
    ['Body',    bodyFont,    bodyWeight,    bodySrc],
  ],
)}

### Mode & Radius
- **Light/Dark:** ${isDark ? 'dark' : 'light'}
- **Border Radius:** ${borderRadius}
- **Spacing Scale:** balanced
${gridSystem ? `- **Grid System:** ${gridSystem}` : ''}

### Visual Personality
- **Adjectives:** ${personality}
- **Reference mood:** ${mood}
${bsVisual.style ? `\n### Visual Language\n- **Style:** ${bsVisual.style}${bsVisual.lighting ? `\n- **Lighting:** ${bsVisual.lighting}` : ''}${bsVisual.composition?.style ? `\n- **Composition:** ${bsVisual.composition.style} · density: ${bsVisual.composition.density || '—'} · whitespace: ${bsVisual.composition.whitespace || '—'}` : ''}` : ''}
${bsPhoto.style ? `\n### Photography Direction\n- **Style:** ${bsPhoto.style}${bsPhoto.lighting_setup ? `\n- **Lighting:** ${bsPhoto.lighting_setup}` : ''}${bsPhoto.color_treatment ? `\n- **Color Treatment:** ${bsPhoto.color_treatment}` : ''}${bsPhoto.framing ? `\n- **Framing:** ${bsPhoto.framing}` : ''}` : ''}

---

## 3. CONTENT INVENTORY

### Hero Section
- **Headline:** "${safe(copy.heroHeadline || social.title || prospect.name)}"
- **Subheadline:** "${safe(copy.heroSubheadline || copy.tagline || social.description, 'Professional service in ' + (prospect.address?.split(',')[1]?.trim() || 'your area'))}"
- **CTA Text:** "${safe((copy.ctaTexts || [])[0], 'Contact Us')}" → links to: #contact
- **CTA Secondary:** "${safe((copy.ctaTexts || [])[1], 'Our Services')}" → links to: #services

### About / Value Proposition
${copy.aboutText || '_No about text scraped — operator should fill in a 2–3 sentence value prop._'}

${copy.missionStatement ? `### Mission\n${copy.missionStatement}` : ''}

### Services
${servicesTable}

### Social Proof
${testimonialsTable}

### Contact Information
- **Phone:** ${safe(copy.contactInfo?.phone)}
- **Email:** ${safe(copy.contactInfo?.email)}
- **Address:** ${safe(copy.contactInfo?.address || prospect.address)}
- **Hours:** ${safe(copy.contactInfo?.hours)}

### Navigation Labels
${safe((struct.navItems || []).join(', '), 'Home, Services, About, Contact')}
${(bsVoice.tone_pillars?.length || bsVoice.writing_style) ? `
### Brand Voice (apply to all generated copy)
- **Tone:** ${(bsVoice.tone_pillars || []).join(', ') || '—'}
${bsVoice.writing_style ? `- **Writing Style:** ${bsVoice.writing_style}` : ''}
${bsVoice.vocabulary_level ? `- **Vocabulary Level:** ${bsVoice.vocabulary_level}` : ''}` : ''}

---

## 4. ASSETS MANIFEST

### Logo
- **File:** ${logoFile || '_missing — needs upload_'}
- **Status:** ${logoFile ? 'downloaded' : 'missing'}
${bsVisual.logo_vision?.iconography_style?.style ? `- **Logo Analysis:** ${bsVisual.logo_vision.iconography_style.style} · ${bsVisual.logo_vision.shape_language?.primary || '—'} shapes · ${bsVisual.logo_vision.containment_shape || '—'}` : ''}

### Hero Image(s)
${heroFile ? `| File | Description |\n|------|-------------|\n| ${heroFile} | Primary hero image |` : '_No hero image downloaded — use GBP photo or operator upload._'}

### Section Images
${allSectionImages.length > 0
  ? formatTable(['File', 'Section', 'Alt'], allSectionImages.map(i => [i.localPath, i.section || 'general', i.alt || '']))
  : '_No section images downloaded._'}

### Missing Assets (operator action needed)
${missingAssets.length > 0 ? missingAssets.join('\n') : '- [x] All critical assets present'}

---

## 5. PAGE STRUCTURE

### Required Sections (always present)
1. **Hero** — Full-viewport hero with headline, subheadline, CTA. \`data-gsap="${sectionPreset('hero')}"\`
2. **Services** — Grid of core service cards. \`data-gsap="${sectionPreset('services')}"\`
3. **Social Proof** — Testimonials or review highlights. \`data-gsap="${sectionPreset('testimonials')}"\`
4. **Contact/CTA** — Phone, address, directions link. \`data-gsap="${sectionPreset('contact')}"\`

### Optional Sections (include if content available)
${optionalSections.map(s => `- **${s.charAt(0).toUpperCase() + s.slice(1)}** — \`data-gsap="${sectionPreset(s)}"\``).join('\n') || '_None detected from existing site._'}

### Detected Section Order
${(struct.sectionOrder || []).slice(0, 8).map((s, i) => `${i + 1}. ${s}`).join('\n') || '_Could not detect section order — use standard: Hero → Services → About → Testimonials → Contact_'}

### Detected Flags
- Contact form: ${struct.hasContactForm ? 'yes' : 'no'}
- Blog/news: ${struct.hasBlog ? 'yes' : 'no'}
- Testimonials section: ${struct.hasTestimonials ? 'yes' : 'no'}
- Team section: ${struct.hasTeamSection ? 'yes' : 'no'}
- Gallery: ${struct.hasGallery ? 'yes' : 'no'}
- Pricing section: ${struct.hasPricing ? 'yes' : 'no'}
${(de.layout?.framing || bsLayout.grid_system || bsVisual.composition?.density) ? `
### Layout Intelligence
- **Framing:** ${safe(de.layout?.framing, '—')}
- **Grid System:** ${safe(bsLayout.grid_system || de.layout?.gridSystem, '—')}
- **Card Style:** ${safe(bsLayout.card_style, '—')}
- **Composition Density:** ${safe(bsVisual.composition?.density, '—')}
- **Whitespace:** ${safe(bsVisual.composition?.whitespace, '—')}` : ''}

---

## 6. ANIMATION DIRECTIVES

### Global Motion
- **Library:** GSAP 3 + ScrollTrigger (CDN)
- **Kit:** gsap-kit.js (shared presets — do NOT write custom GSAP)
- **Motion Style:** ${motionStyle}
- **Default easing:** ${motionEasing}
- **Speed:** ${motionSpeed}
- **Duration range:** ${motionDuration}
- **Scroll trigger offset:** top 85%
${bsMotion.transitions ? `- **Transition Style:** ${bsMotion.transitions}` : ''}

### Per-Section Presets
${formatTable(
  ['Section', 'Preset', 'Notes'],
  sections.map(s => [s, sectionPreset(s.replace('social-proof', 'testimonials')), '']),
)}

### Hero Animation
- Type: parallax
- Intensity: medium
- Notes: Background image parallax + text reveal stagger on headline and subheadline

---

## 7. TECHNICAL REQUIREMENTS

### SEO & AI Readiness (built into every generated site)
- JSON-LD: LocalBusiness schema with name, address, phone, geo, url
- Open Graph: og:title, og:description, og:image, og:type=website
- Twitter Card: summary_large_image
- Meta: viewport, description, charset, canonical
- robots.txt / meta robots: Allow all crawlers including AI bots (Googlebot, GPTBot, ClaudeBot)
- /llms.txt: Inline script creates summary for LLM discoverability
- Semantic HTML: header, nav, main, section, footer with correct heading hierarchy
- Alt text: all images
- Sitemap: note in footer (add in production)

### Performance Targets
- PageSpeed Performance: ≥ 90 (current: ${perfScore})
- First Contentful Paint: < 1.5s
- Largest Contentful Paint: < 2.5s
- Total page weight: < 2MB
- All scripts: async/defer, no render-blocking resources

### Core Web Vitals (current)
- LCP: ${lcpMs != null ? `${lcpMs}ms` : '?'} (target: < 2500ms)
- FID: ${fidMs != null ? `${fidMs}ms` : '?'} (target: < 100ms)
- CLS: ${cls != null ? cls : '?'} (target: < 0.1)

### Accessibility
- WCAG 2.1 AA minimum
- Proper color contrast ratios
- Keyboard navigation + focus indicators
- Skip-to-content link

### SEO Issues to Fix (from audit)
${seoFindings.slice(0, 6).map(f => `- [${f.severity || 'info'}] ${f.issue} → ${f.fix}`).join('\n') || '_No specific issues found._'}

### AI Readiness Checks
${aiChecks.slice(0, 8).map(c => `- [${c.status}] ${c.name}: ${c.verdict}`).join('\n') || '_Run onboard to populate._'}

---

## 8. BEFORE / AFTER CONTEXT

### Current Site Issues (from ONBOARD)
${(ai.findings || []).slice(0, 8).map(f => `- ${typeof f === 'string' ? f : (f.message || f.id)}`).join('\n') || '_Run ONBOARD to populate findings._'}

### AI Agent Readiness
- **Before:** ${safe(ai.score, '?')}/100 — ${safe(ai.verdict, 'pending onboard')}
- **After (target):** 91/100 — EXCELLENT

### PageSpeed Scores (current)
- Performance: ${perfScore}
- Accessibility: ${a11yScore}
- SEO: ${seoScore}
- Best Practices: ${bpScore}
${dimensionRows.length ? `
### Readiness Dimensions
${formatTable(['Dimension', 'Score', 'Verdict'], dimensionRows)}` : ''}
${(ai.highlights || []).length ? `
### Strengths to Preserve
${ai.highlights.map(h => `- ${h}`).join('\n')}` : ''}

### Current Design Assessment
${de.summary || '_Not evaluated._'}
${de.confidence ? `- **Confidence:** ${de.confidence}` : ''}

---

## 9. OPERATOR NOTES

${buildOperatorNotes(brandSystem, designReferences)}

---

## 10. GENERATION STATUS

- **Brief generated:** ${new Date().toISOString()}
- **Brief approved:** pending
- **Site generated:** pending
- **Preview URL:** pending
- **AI Readiness (before):** ${safe(ai.score, '?')}/100
- **AI Readiness (after):** pending
`;
}
