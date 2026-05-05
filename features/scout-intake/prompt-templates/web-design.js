'use strict';

const { colorSwatches, typeSpec, souls, section } = require('./_format.js');

/**
 * Web design template — website hero / landing page.
 * Uses v2 layout_grammar, typography specimens, color system, and design direction.
 *
 * @param {object} j — Brand Guide v2 JSON
 * @returns {string}
 */
function buildPrompt(j) {
  if (!j) return '';

  const h  = j.brand_header || {};
  const cs = j.color_system || {};
  const ts = j.typography_system || {};
  const vl = j.visual_language || {};
  const lg = j.layout_grammar || {};
  const dd = j.design_direction || {};
  const md = j.material_and_depth || {};
  const mo = j.motion || {};
  const bv = j.brand_voice || {};
  const pd = j.photography_direction || {};
  const ic = j.iconography || {};

  const bgHex   = cs.foundation?.[1]?.hex || cs.foundation?.[0]?.hex || '#FFFFFF';
  const bgName  = cs.foundation?.[1]?.name || cs.foundation?.[0]?.name || 'background';
  const textHex = cs.foundation?.[0]?.hex || '#000000';
  const textName= cs.foundation?.[0]?.name || 'text';
  const ctaHex  = cs.emphasis?.[0]?.hex || '#000000';
  const ctaName = cs.emphasis?.[0]?.name || 'CTA';
  const accentHex  = cs.emphasis?.[1]?.hex || null;
  const accentName = cs.emphasis?.[1]?.name || null;

  const specBlock = ts.specimens ? [
    ts.specimens.headline_example    ? `Headline: "${ts.specimens.headline_example}"` : null,
    ts.specimens.subheadline_example ? `Subheadline: "${ts.specimens.subheadline_example}"` : null,
    ts.specimens.body_example        ? `Body: "${ts.specimens.body_example}"` : null,
  ].filter(Boolean).join('\n') : null;

  const ddBlock = (dd.keep?.length || dd.change?.length || dd.add?.length) ? [
    dd.keep?.length   ? `Keep from current site: ${dd.keep.join(', ')}` : null,
    dd.change?.length ? `Evolve: ${dd.change.join(', ')}` : null,
    dd.add?.length    ? `Add: ${dd.add.join(', ')}` : null,
  ].filter(Boolean).join('\n') : null;

  const lines = [
    `Design a full-desktop-viewport website hero section for "${h.brand_name || '[brand]'}" — high-fidelity, ready for development handoff.`,
    '',
    section('BRAND DNA', [
      `Name: ${h.brand_name || '[brand]'}`,
      h.tagline ? `Tagline: "${h.tagline}"` : null,
      `Statement: ${h.brand_statement || '[brand statement]'}`,
      `Soul: ${souls(h.soul_descriptors)}`,
      h.brand_archetype ? `Archetype: ${h.brand_archetype}` : null,
      h.target_audience ? `Audience: ${h.target_audience}` : null,
    ]),
    '',
    section('LAYOUT', [
      lg.grid_system    ? `Grid: ${lg.grid_system}` : 'Grid: 12-column',
      lg.spacing_scale  ? `Spacing scale: ${lg.spacing_scale}` : null,
      lg.border_radius  ? `Border radius: ${lg.border_radius}` : null,
      lg.card_style     ? `Card style: ${lg.card_style}` : null,
      vl.composition?.style ? `Composition: ${vl.composition.style}` : null,
    ]),
    '',
    section('TYPOGRAPHY IN CONTEXT', [
      typeSpec(ts.headline,    'Headline font'),
      typeSpec(ts.subheadline, 'Subheadline font'),
      typeSpec(ts.body,        'Body font'),
      specBlock,
      'Render the actual specimen text above — not placeholder lorem ipsum.',
    ]),
    '',
    section('COLOR APPLICATION', [
      `Background: ${bgHex} (${bgName})`,
      `Text: ${textHex} (${textName})`,
      `CTA button: ${ctaHex} (${ctaName})`,
      accentHex ? `Accent: ${accentHex} (${accentName})` : null,
      colorSwatches(cs.foundation, 'Full foundation palette'),
      colorSwatches(cs.emphasis,   'Full emphasis palette'),
      cs.color_mood ? `Color mood: ${cs.color_mood}` : null,
    ]),
    '',
    section('NAVIGATION', [
      `Style: fixed top bar, transparent on scroll`,
      `Logo: left-aligned`,
      `Nav items: Work, Services, About, Ideas, Contact`,
      `CTA button: top right, ${ctaHex} fill`,
      md.border_radius ? `Button radius: ${md.border_radius}` : null,
    ]),
    '',
    section('HERO SECTION', [
      `Headline: use the specimen text above`,
      pd.style ? `Hero image/visual: ${pd.style} photography style` : null,
      pd.lighting_setup ? `Lighting: ${pd.lighting_setup}` : null,
      vl.style ? `Visual world: ${vl.style}` : null,
      ic.icon_names?.length ? `Brand icons visible: ${ic.icon_names.slice(0, 3).join(', ')}` : null,
    ]),
    mo.style && mo.style !== 'none' ? section('MOTION', [
      `Animation style: ${mo.style}`,
      mo.easing ? `Easing: ${mo.easing}` : null,
      mo.speed ? `Speed: ${mo.speed}` : null,
      mo.transitions ? `Transitions: ${mo.transitions}` : null,
      'Note micro-interactions on CTAs, hover states, and scroll-triggered reveals.',
    ]) : null,
    bv.tone_pillars?.length ? section('BRAND VOICE (for copy)', [
      `Tone: ${bv.tone_pillars.join(', ')}`,
      bv.writing_style ? `Style: ${bv.writing_style}` : null,
    ]) : null,
    ddBlock ? section('DESIGN DIRECTION (informed by site review)', [ddBlock]) : null,
    '',
    'QUALITY BAR',
    'Must look like a $50,000 custom agency build — not a template. Typography hierarchy must be undeniable. CTA must be the obvious next action. Every spacing decision must feel intentional.',
  ];

  return lines.filter((l) => l !== null).join('\n');
}

module.exports = { buildPrompt };
