'use strict';

const { colorSwatches, souls, section } = require('./_format.js');

/**
 * Storyboard / cinematic direction template.
 * Produces a 16:9, 10-panel film-quality storyboard brief.
 *
 * @param {object} j — Brand Guide v2 JSON
 * @returns {string}
 */
function buildPrompt(j) {
  if (!j) return '';

  const h  = j.brand_header || {};
  const cs = j.color_system || {};
  const vl = j.visual_language || {};
  const pd = j.photography_direction || {};
  const md = j.material_and_depth || {};
  const bv = j.brand_voice || {};

  const colorLine = [
    colorSwatches(cs.foundation?.slice(0, 2), null),
    colorSwatches(cs.emphasis?.slice(0, 2), null),
  ].filter(Boolean).join(' · ') || '[brand palette not set]';

  const lines = [
    `Design a 16:9 cinematic storyboard for "${h.brand_name || '[brand]'}" — 10 panels, film-quality.`,
    '',
    section('BRAND DNA', [
      `Name: ${h.brand_name || '[brand]'}`,
      `Soul: ${souls(h.soul_descriptors)}`,
      h.brand_archetype ? `Archetype: ${h.brand_archetype}` : null,
      `Color palette: ${colorLine}`,
    ]),
    '',
    section('CINEMATIC DIRECTION', [
      `Visual world: ${vl.style || '[visual style]'}`,
      `Lighting: ${pd.lighting_setup || vl.lighting || '[lighting]'}`,
      `Color grading: ${pd.color_treatment || '[color treatment]'}`,
      `Framing: ${pd.framing || '[framing]'}`,
      `Depth of field: ${pd.depth_of_field || '[depth of field]'}`,
      `Photography style: ${pd.style || '[photography style]'}`,
      pd.art_direction_notes ? `Art direction: ${pd.art_direction_notes}` : null,
    ]),
    '',
    section('PANEL STRUCTURE', [
      'Design exactly 10 storyboard panels arranged in a 5×2 grid on the 16:9 canvas.',
      'Each panel must include:',
      '  • Frame number and timestamp (e.g. "03 / 0:12")',
      '  • Shot type: extreme wide, wide, medium, close-up, extreme close-up, or over-shoulder',
      '  • Camera movement note: handheld drift, push-in, pull-back, static, or crane',
      '  • Dialogue / VO line (1 sentence, brand voice)',
      '  • SFX / Audio note (music mood, ambient sound, or silence)',
      '  • Transition type: hard cut, match cut, smash cut, dissolve, or wipe',
    ]),
    '',
    section('NARRATIVE ARC', [
      'Panels 1–2: Establish the world — environment, scale, brand atmosphere.',
      'Panels 3–5: Introduce tension or problem — what the brand solves.',
      'Panels 6–8: Brand presence — product/service in its ideal context.',
      'Panels 9–10: Resolution and brand statement — end on the soul.',
    ]),
    '',
    section('MATERIAL & MOOD', [
      `Surface: ${md.surface || '[surface]'}`,
      `Shadow style: ${md.shadow_style || 'directional'}`,
      vl.mood_keywords?.length ? `Mood: ${vl.mood_keywords.join(', ')}` : null,
    ]),
    bv.tone_pillars?.length ? section('BRAND VOICE (for VO lines)', [
      `Tone: ${bv.tone_pillars.join(', ')}`,
      bv.writing_style ? `Style: ${bv.writing_style}` : null,
      bv.sentence_style ? `Rhythm: ${bv.sentence_style}` : null,
    ]) : null,
    '',
    'QUALITY BAR',
    'Each panel must look like a frame from a $2M commercial — not a sketch or wireframe. Lighting, composition, and color grading must be consistent across all 10 panels as if shot in the same session.',
  ];

  return lines.filter((l) => l !== null).join('\n');
}

module.exports = { buildPrompt };
