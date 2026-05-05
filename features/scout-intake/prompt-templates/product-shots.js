'use strict';

const { colorSwatches, gradients, typeSpec, souls, section } = require('./_format.js');

/**
 * Product shots / packaging template.
 * Produces studio-quality product photography and packaging render prompts.
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
  const md = j.material_and_depth || {};
  const ic = j.iconography || {};

  const foundationColors = colorSwatches(cs.foundation, 'Foundation');
  const emphasisColors   = colorSwatches(cs.emphasis,   'Primary accent');
  const bgColor = cs.foundation?.[1]?.hex || cs.foundation?.[0]?.hex || '#FFFFFF';
  const accentColor = cs.emphasis?.[0]?.hex || '#000000';

  const lines = [
    `Create product photography and packaging renders for "${h.brand_name || '[brand]'}" — studio-quality, brand-consistent.`,
    '',
    section('BRAND DNA', [
      `Name: ${h.brand_name || '[brand]'}`,
      `Soul: ${souls(h.soul_descriptors)}`,
      h.industry ? `Industry: ${h.industry}` : null,
      h.brand_archetype ? `Archetype: ${h.brand_archetype}` : null,
    ]),
    '',
    section('PRODUCT DIRECTION', [
      `Surface material: ${md.surface || '[surface]'}`,
      `Lighting setup: ${pd.lighting_setup || vl.lighting || '[lighting]'}`,
      `Background color: ${bgColor} (from brand foundation palette)`,
      h.industry ? `Props/styling: suited to ${h.industry} context` : null,
      pd.subject_treatment ? `Subject treatment: ${pd.subject_treatment}` : null,
    ]),
    '',
    section('RENDER STYLE', [
      `Shadow style: ${md.shadow_style || 'directional with soft falloff'}`,
      `Layer depth: ${md.layer_depth || 'pronounced'}`,
      `Post-processing: ${pd.post_processing || 'minimal-clean'}`,
      vl.style ? `Visual world: ${vl.style}` : null,
    ]),
    '',
    section('COLOR APPLICATION', [
      foundationColors,
      emphasisColors,
      cs.gradients?.length ? `Gradients available: ${gradients(cs.gradients)}` : null,
      `Primary package color: ${accentColor}`,
      cs.color_mood ? `Color mood: ${cs.color_mood}` : null,
    ]),
    '',
    section('PACKAGING TYPOGRAPHY', [
      typeSpec(ts.headline,    'Product name font'),
      typeSpec(ts.subheadline, 'Descriptor font'),
      typeSpec(ts.body,        'Info/ingredients font'),
      ts.specimens?.headline_example ? `Product name specimen: "${ts.specimens.headline_example}"` : null,
    ]),
    '',
    section('ICONOGRAPHY ON PACK', [
      ic.style ? `Icon style: ${ic.style}` : null,
      ic.stroke_rule ? `Stroke rule: ${ic.stroke_rule}` : null,
      ic.icon_names?.length ? `Icon concepts: ${ic.icon_names.slice(0, 5).join(', ')}` : null,
    ]),
    '',
    section('DELIVERABLES', [
      '• Hero product shot — front face, centered, clean background',
      '• 3/4 angle render — shows depth and packaging wrap',
      '• Flat lay — product with 3-5 brand-matched props on surface',
      '• Detail close-up — texture, typography, or key design element',
      '• Lifestyle context shot — product in its natural use environment',
    ]),
    '',
    'QUALITY BAR',
    'Every render must look like it was shot in a $50,000 product studio. Shadows must have directional logic. Material must feel physically real — not CG-flat. Typography on pack must be legible at thumbnail size.',
  ];

  return lines.filter((l) => l !== null).join('\n');
}

module.exports = { buildPrompt };
