'use strict';

// brand-system-vision.js — Anthropic Claude vision over an uploaded logo.
//
// Split out from brand-system.js because Turbopack's dev-mode require cache
// doesn't pick up new exports added to a previously-loaded CJS module — fresh
// file path → fresh module entry, no cache-staleness.

const fs = require('fs');
const path = require('path');
const { callAnthropic } = require('../_anthropic-client.js');

const VISION_MODEL = 'claude-sonnet-4-6';
const VISION_MAX_TOKENS = 1500;

function loadVisionSystemPrompt() {
  const skillPath = path.join(__dirname, '..', 'skills', 'brand-system-vision.md');
  return fs.readFileSync(skillPath, 'utf8');
}

/**
 * Run Anthropic vision over a logo image.
 *
 * Returns the full v2 logo analysis schema including:
 * shape_language, stroke_logic, motif_seeds, color_hints, material_inference,
 * iconography_style, personality_words, logo_type, containment_shape,
 * suggested_icon_names, gradient_present, symmetry, suggested_patterns.
 *
 * @param {object} opts
 * @param {string} [opts.imageUrl]    — public URL the model can fetch
 * @param {string} [opts.imageBase64] — base64 string (no data: prefix)
 * @param {string} [opts.mediaType]   — required when passing imageBase64 (e.g. 'image/png')
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

module.exports = {
  analyzeLogo,
  VISION_MODEL,
};
