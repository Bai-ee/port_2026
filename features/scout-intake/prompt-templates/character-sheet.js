'use strict';

const { colorSwatches, souls, section } = require('./_format.js');

/**
 * Character sheet template — brand mascot or representative reference sheet.
 * Produces multi-view turnarounds, expression studies, and action poses.
 *
 * @param {object} j — Brand Guide v2 JSON
 * @returns {string}
 */
function buildPrompt(j) {
  if (!j) return '';

  const h  = j.brand_header || {};
  const cs = j.color_system || {};
  const vl = j.visual_language || {};
  const ic = j.iconography || {};
  const md = j.material_and_depth || {};
  const pd = j.photography_direction || {};

  const paletteBlock = [
    colorSwatches(cs.foundation?.slice(0, 2), 'Foundation'),
    colorSwatches(cs.emphasis?.slice(0, 3),   'Accent'),
  ].filter(Boolean).join('\n') || '[brand palette not set]';

  const archetype = h.brand_archetype || null;
  const archetypeGuide = {
    creator:   'imaginative, expressive, holding a tool or creating something',
    explorer:  'curious, dynamic, mid-motion or looking toward the horizon',
    sage:      'calm, knowing, thoughtful pose — perhaps with a book or open hand gesture',
    hero:      'bold, powerful stance — confident, action-ready',
    outlaw:    'rebellious, unconventional — unexpected angles and attitude',
    magician:  'mysterious, transformative — hands active, an air of possibility',
    everyman:  'approachable, warm, casual — relatable and unpretentious',
    lover:     'warm, connected, expressive emotion — inviting gesture',
    jester:    'playful, light, mid-laugh or mid-trick',
    caregiver: 'nurturing, open arms or gesture of giving',
    ruler:     'authoritative, upright, commanding presence',
    innocent:  'pure, optimistic, open and bright',
  };
  const archetypeNote = archetype ? archetypeGuide[archetype] || null : null;

  const lines = [
    `Create a professional character reference sheet for "${h.brand_name || '[brand]'}" brand mascot/representative.`,
    '',
    section('BRAND DNA', [
      `Brand: ${h.brand_name || '[brand]'}`,
      `Soul: ${souls(h.soul_descriptors)}`,
      archetype ? `Archetype: ${archetype}` : null,
      archetypeNote ? `Archetype expression: ${archetypeNote}` : null,
      h.target_audience ? `Represents: ${h.target_audience}` : null,
    ]),
    '',
    section('ART STYLE', [
      `Visual style: ${vl.style || 'editorial'}`,
      `Line work: ${ic.stroke_rule || '[stroke rule from iconography]'}`,
      ic.shape_grammar ? `Shape grammar: ${ic.shape_grammar}` : null,
      `Surface rendering: ${md.surface || '[surface material]'}`,
      `Shadow treatment: ${md.shadow_style || 'directional'}`,
      pd.style ? `Photography reference style: ${pd.style}` : null,
    ]),
    '',
    section('COLOR PALETTE', [
      paletteBlock,
      cs.color_mood ? `Palette mood: ${cs.color_mood}` : null,
    ]),
    '',
    section('SHEET LAYOUT', [
      '• Full body front view — hero pose, grounded, expressive',
      '• Side profile (right) — shows silhouette and depth',
      '• Back view — shows key design details from behind',
      '• 3/4 view (front-right) — most dimensional, best for marketing use',
      '• Expression studies: 4 emotions matching the brand soul descriptors',
      '• Movement studies: 4-6 action poses showing personality in motion',
      '• Detail callouts: accessories, distinguishing features, key design elements',
      '• Scale reference: character shown alongside a common object (door, desk, etc.)',
    ]),
    '',
    section('MATERIAL & RENDERING', [
      `Surface: ${md.surface || '[surface]'}`,
      `Shading: ${md.shadow_style || 'directional'}`,
      `Depth: ${md.layer_depth || 'pronounced'}`,
      'Every view must use consistent shading, scale, and proportions — this is a production-ready reference.',
    ]),
    '',
    'QUALITY BAR',
    'This sheet must be production-ready — a character animator or illustrator should be able to redraw this character from any angle using only this sheet as reference. Proportions must be consistent across all views. Colors must match the brand palette exactly.',
  ];

  return lines.filter((l) => l !== null).join('\n');
}

module.exports = { buildPrompt };
