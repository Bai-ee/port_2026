'use strict';

const { colorSwatches, gradients, typeSpec, souls, section } = require('./_format.js');

/**
 * Social media template — 3-format asset pack.
 * Produces square post (1:1), story (9:16), and banner (16:9).
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
  const pd = j.photography_direction || {};
  const ic = j.iconography || {};
  const mo = j.motion || {};
  const bv = j.brand_voice || {};

  const bgHex  = cs.emphasis?.[0]?.hex  || cs.foundation?.[1]?.hex || '#FFFFFF';
  const bgName = cs.emphasis?.[0]?.name || cs.foundation?.[1]?.name || 'background';
  const accentHex  = cs.emphasis?.[1]?.hex || cs.foundation?.[0]?.hex || '#000000';
  const accentName = cs.emphasis?.[1]?.name || cs.foundation?.[0]?.name || 'accent';

  const lines = [
    `Create a social media brand asset pack for "${h.brand_name || '[brand]'}" — 3 formats, production-ready.`,
    '',
    section('BRAND DNA', [
      `Name: ${h.brand_name || '[brand]'}`,
      h.tagline ? `Tagline: "${h.tagline}"` : null,
      `Soul: ${souls(h.soul_descriptors)}`,
      h.brand_archetype ? `Archetype: ${h.brand_archetype}` : null,
    ]),
    '',
    section('FORMATS — render all three', [
      `1. Square post (1:1) — Instagram feed / LinkedIn post`,
      `2. Story (9:16) — Instagram Story / TikTok / Reels cover`,
      `3. Banner (16:9) — Twitter/X header / LinkedIn cover / YouTube thumbnail`,
      '',
      'Each format must feel like it belongs to the same campaign and brand world.',
    ]),
    '',
    section('TYPOGRAPHY', [
      typeSpec(ts.headline,    'Headlines'),
      typeSpec(ts.body,        'Body / captions'),
      ts.specimens?.headline_example    ? `Headline specimen: "${ts.specimens.headline_example}"` : null,
      ts.specimens?.subheadline_example ? `Subheadline specimen: "${ts.specimens.subheadline_example}"` : null,
      'Use actual specimen text — not lorem ipsum.',
    ]),
    '',
    section('COLOR APPLICATION', [
      `Primary background: ${bgHex} (${bgName})`,
      `Text / contrast: ${accentHex} (${accentName})`,
      colorSwatches(cs.foundation, 'Foundation palette'),
      colorSwatches(cs.emphasis,   'Emphasis palette'),
      cs.gradients?.length ? `Available gradients: ${gradients(cs.gradients)}` : null,
      cs.color_mood ? `Color mood: ${cs.color_mood}` : null,
    ]),
    '',
    section('PHOTOGRAPHY / VISUAL TREATMENT', [
      pd.style ? `Photo style: ${pd.style}` : null,
      pd.lighting_setup ? `Lighting: ${pd.lighting_setup}` : null,
      pd.color_treatment ? `Color treatment: ${pd.color_treatment}` : null,
      vl.style ? `Visual world: ${vl.style}` : null,
      vl.mood_keywords?.length ? `Mood: ${vl.mood_keywords.join(', ')}` : null,
    ]),
    '',
    section('ICONOGRAPHY', [
      ic.style ? `Icon style: ${ic.style}` : null,
      ic.stroke_rule ? `Stroke rule: ${ic.stroke_rule}` : null,
      ic.icon_names?.length ? `Concepts: ${ic.icon_names.slice(0, 5).join(', ')}` : null,
    ]),
    mo.style && mo.style !== 'none' ? section('MOTION NOTES (for animated versions)', [
      `Animation style: ${mo.style}`,
      mo.easing ? `Easing: ${mo.easing}` : null,
      mo.speed ? `Speed: ${mo.speed}` : null,
      mo.transitions ? `Transitions: ${mo.transitions}` : null,
    ]) : null,
    '',
    section('BRAND VOICE (for copy lines)', [
      bv.tone_pillars?.length ? `Tone: ${bv.tone_pillars.join(', ')}` : null,
      bv.writing_style ? `Writing style: ${bv.writing_style}` : null,
      bv.sentence_style ? `Sentence rhythm: ${bv.sentence_style}` : null,
    ]),
    '',
    'QUALITY BAR',
    `Each format must look like it was designed by a $5,000/day creative director. Stop-thumb quality. The brand must be immediately recognizable across all 3 formats at a glance. No generic layouts, no stock feeling.`,
  ];

  return lines.filter((l) => l !== null).join('\n');
}

module.exports = { buildPrompt };
