'use strict';

// Template registry — maps templateId → { buildPrompt(brandGuideJson) → string }

const TEMPLATES = {
  'brand-poster':    require('./brand-poster.js'),
  'storyboard':      require('./storyboard.js'),
  'product-shots':   require('./product-shots.js'),
  'web-design':      require('./web-design.js'),
  'character-sheet': require('./character-sheet.js'),
  'social-media':    require('./social-media.js'),
};

const TEMPLATE_META = {
  'brand-poster':    { label: 'Brand Identity Poster',         description: 'Vertical 4:5 full brand system poster — colors, type, icons, patterns, applications.' },
  'storyboard':      { label: 'Storyboard / Cinematic',        description: '16:9 film-quality storyboard — 10 panels, camera direction, VO, SFX.' },
  'product-shots':   { label: 'Product Shots / Packaging',     description: 'Studio-quality product photography and packaging renders.' },
  'web-design':      { label: 'Website Hero / Landing Page',   description: 'Full desktop viewport — nav, hero, CTA, type hierarchy, grid.' },
  'character-sheet': { label: 'Character Sheet / Turnarounds', description: 'Brand mascot reference sheet — multi-view, expressions, action poses.' },
  'social-media':    { label: 'Social Media Asset Pack',       description: '3 formats: square post (1:1), story (9:16), banner (16:9).' },
};

/**
 * Build a prompt string for the given template.
 *
 * @param {string} templateId — one of the TEMPLATES keys
 * @param {object} brandGuideJson — Brand Guide v2 JSON
 * @returns {string} the generated prompt
 */
function buildPrompt(templateId, brandGuideJson) {
  const template = TEMPLATES[templateId];
  if (!template) throw new Error(`Unknown template: "${templateId}". Available: ${Object.keys(TEMPLATES).join(', ')}`);
  return template.buildPrompt(brandGuideJson);
}

/**
 * Build prompts for all templates at once.
 *
 * @param {object} brandGuideJson — Brand Guide v2 JSON
 * @returns {{ [templateId]: string }}
 */
function buildAllPrompts(brandGuideJson) {
  return Object.fromEntries(
    Object.keys(TEMPLATES).map((id) => [id, TEMPLATES[id].buildPrompt(brandGuideJson)])
  );
}

/**
 * List all available templates with labels and descriptions.
 *
 * @returns {{ id: string, label: string, description: string }[]}
 */
function listTemplates() {
  return Object.entries(TEMPLATE_META).map(([id, meta]) => ({ id, ...meta }));
}

module.exports = { buildPrompt, buildAllPrompts, listTemplates, TEMPLATES };
