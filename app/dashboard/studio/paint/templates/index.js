// Paint Studio template registry — the constrained catalogue of first-party
// procedural templates. Nothing outside this list is executable as a
// template; there is no arbitrary/user-supplied code path.

import watercolourBloom from './watercolour-bloom.js';
import botanicalWeave from './botanical-weave.js';
import pigmentBurst from './pigment-burst.js';
import novelArt from './novel-art.js';
import editorialFields from './editorial-fields.js';
import graphicPatterns from './graphic-patterns.js';
import gradientAtmospheres from './gradient-atmospheres.js';
import cloudWater from './cloud-water.js';
import printPlates from './print-plates.js';

export const TEMPLATES = [watercolourBloom, botanicalWeave, pigmentBurst, novelArt, editorialFields, graphicPatterns, gradientAtmospheres, cloudWater, printPlates];

export function getTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) || null;
}

export function listTemplates() {
  return TEMPLATES.map(({ id, version, label }) => ({ id, version, label }));
}

export const DEFAULT_TEMPLATE_ID = TEMPLATES[0].id;
