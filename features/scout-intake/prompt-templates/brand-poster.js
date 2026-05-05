'use strict';

const { colorSwatches, gradients, pairings, typeSpec, souls, list, section } = require('./_format.js');

/**
 * Brand Poster template — upgraded from v1 buildMasterPrompt.
 * Uses the full v2 schema to produce a richer, more directed prompt.
 *
 * @param {object} j — Brand Guide v2 JSON
 * @returns {string}
 */
function buildPrompt(j) {
  if (!j) return '';

  const h = j.brand_header || {};
  const cs = j.color_system || {};
  const ts = j.typography_system || {};
  const vl = j.visual_language || {};
  const ic = j.iconography || {};
  const pm = j.patterns_and_motifs || {};
  const md = j.material_and_depth || {};
  const pd = j.photography_direction || {};
  const dd = j.design_direction || {};
  const bv = j.brand_voice || {};
  const ba = j.brand_applications || [];
  const qs = j.quality_standard || {};

  const colorBlock = [
    colorSwatches(cs.foundation, 'Foundation'),
    colorSwatches(cs.emphasis,   'Emphasis'),
    colorSwatches(cs.atmosphere, 'Atmosphere'),
    cs.gradients?.length ? `Gradients: ${gradients(cs.gradients)}` : null,
    cs.pairings?.length  ? `Pairings: ${pairings(cs.pairings)}` : null,
    cs.color_mood ? `Mood: ${cs.color_mood}` : null,
  ].filter(Boolean).join('\n') || '[colors not extracted]';

  const typoBlock = [
    typeSpec(ts.headline,    'Headline'),
    typeSpec(ts.subheadline, 'Subheadline'),
    typeSpec(ts.body,        'Body'),
  ].filter(Boolean).join('\n') || '[typography not extracted]';

  const specBlock = ts.specimens ? [
    ts.specimens.headline_example    ? `Headline specimen: "${ts.specimens.headline_example}"` : null,
    ts.specimens.subheadline_example ? `Subheadline specimen: "${ts.specimens.subheadline_example}"` : null,
    ts.specimens.body_example        ? `Body specimen: "${ts.specimens.body_example}"` : null,
  ].filter(Boolean).join('\n') : null;

  const icBlock = [
    ic.style ? `Style: ${ic.style}` : null,
    ic.stroke_rule ? `Stroke rule: ${ic.stroke_rule}` : null,
    ic.shape_grammar ? `Shape grammar: ${ic.shape_grammar}` : null,
    ic.containment ? `Containment: ${ic.containment}` : null,
    ic.count ? `Count: ${ic.count}` : null,
    ic.icon_names?.length ? `Icon concepts: ${ic.icon_names.join(', ')}` : null,
  ].filter(Boolean).join(' · ') || '[iconography not set]';

  const motifBlock = [
    pm.seeds?.length ? `Seeds: ${pm.seeds.join(' · ')}` : null,
    pm.application_rules?.length ? list(pm.application_rules) : null,
  ].filter(Boolean).join('\n') || 'Derive 3 motifs from the logo geometry only.';

  const photoBlock = [
    pd.style ? `Style: ${pd.style}` : null,
    pd.lighting_setup ? `Lighting: ${pd.lighting_setup}` : null,
    pd.color_treatment ? `Color treatment: ${pd.color_treatment}` : null,
    pd.framing ? `Framing: ${pd.framing}` : null,
    pd.depth_of_field ? `Depth of field: ${pd.depth_of_field}` : null,
    pd.art_direction_notes ? `Direction: ${pd.art_direction_notes}` : null,
  ].filter(Boolean).join('\n');

  const ddBlock = (dd.keep?.length || dd.change?.length || dd.add?.length) ? [
    dd.keep?.length  ? `Keep: ${dd.keep.join(', ')}` : null,
    dd.change?.length ? `Evolve: ${dd.change.join(', ')}` : null,
    dd.add?.length   ? `Add: ${dd.add.join(', ')}` : null,
  ].filter(Boolean).join('\n') : null;

  const voiceBlock = (bv.tone_pillars?.length || bv.writing_style) ? [
    bv.tone_pillars?.length ? `Tone: ${bv.tone_pillars.join(', ')}` : null,
    bv.writing_style ? `Writing style: ${bv.writing_style}` : null,
  ].filter(Boolean).join(' · ') : null;

  const appLines = ba
    .sort((a, b) => (a.priority || 3) - (b.priority || 3))
    .map((a) => `• ${a.type} — ${a.detail}`);

  const qualityLine = [
    qs.benchmark,
    qs.total_elements,
    ...(qs.failure_conditions || []).map((fc) => `Avoid: ${fc}.`),
  ].filter(Boolean).join(' ');

  const lines = [
    `Design a vertical 4:5 brand identity system poster for "${h.brand_name || '[brand]'}" — agency-grade, magazine-dense, zero wasted space.`,
    h.brand_archetype ? `Brand archetype: ${h.brand_archetype}` : null,
    '',
    section('BRAND HEADER', [
      `Name: ${h.brand_name || '[brand]'}`,
      h.tagline ? `Tagline: ${h.tagline}` : null,
      `Statement: ${h.brand_statement || '[6-8 word statement]'}`,
      `Soul: ${souls(h.soul_descriptors)}`,
      h.industry ? `Industry: ${h.industry}` : null,
      h.target_audience ? `Audience: ${h.target_audience}` : null,
    ]),
    '',
    section('COLOR SYSTEM', [
      colorBlock,
      'Show wide swatches with HEX codes and role labels (foundation / emphasis / atmosphere). Include gradient blends and color-on-color pairings.',
    ]),
    '',
    section('TYPOGRAPHY', [
      typoBlock,
      specBlock,
      'Render a real headline + subheadline + body paragraph specimen. Hierarchy must be undeniable at a glance.',
    ]),
    '',
    section('VISUAL LANGUAGE', [
      `Style: ${vl.style || '[style]'} · Lighting: ${vl.lighting || '[lighting]'} · Surface: ${vl.texture || '[material]'}`,
      vl.composition ? `Composition: ${vl.composition.style} — ${vl.composition.density}` : null,
      vl.mood_keywords?.length ? `Mood: ${vl.mood_keywords.join(', ')}` : null,
      'Add 3–5 art-directed mood tiles that read like stills from a real shoot brief.',
    ]),
    photoBlock ? section('PHOTOGRAPHY DIRECTION', [photoBlock]) : null,
    '',
    section(`ICONOGRAPHY (${ic.count || '6–10'} icons)`, [
      icBlock,
      'Uniform stroke or fill logic across the entire set.',
    ]),
    '',
    section('PATTERNS & MOTIFS', [motifBlock]),
    '',
    section('BRAND APPLICATIONS — render every mockup as if shot for the same brand world', appLines),
    '',
    section('MATERIAL & DEPTH', [
      `Surface: ${md.surface || '[surface]'}.`,
      md.shadow_style ? `Shadows: ${md.shadow_style}.` : 'Shadows with directional logic.',
      md.layer_depth ? `Layer depth: ${md.layer_depth}.` : 'Layer depth that makes elements feel physically present.',
      md.reasoning || null,
    ]),
    voiceBlock ? section('BRAND VOICE', [voiceBlock]) : null,
    ddBlock ? section('DESIGN DIRECTION (from site review)', [ddBlock]) : null,
    '',
    section('QUALITY BAR', [qualityLine]),
  ];

  return lines.filter((l) => l !== null).join('\n');
}

module.exports = { buildPrompt };
