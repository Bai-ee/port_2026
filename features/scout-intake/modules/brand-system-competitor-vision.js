'use strict';

// brand-system-competitor-vision.js — Analyzes competitor screenshots to
// build a differentiation map for the brand guide.
//
// Multiple screenshots are sent in one call. The model maps the competitive
// visual landscape and identifies differentiation opportunities.

const fs = require('fs');
const path = require('path');
const { callAnthropic } = require('../_anthropic-client.js');

const VISION_MODEL = 'claude-sonnet-4-6';
const VISION_MAX_TOKENS = 1500;

function loadPrompt() {
  return fs.readFileSync(
    path.join(__dirname, '..', 'skills', 'brand-system-competitor-vision.md'),
    'utf8'
  );
}

function buildImageBlock(img) {
  if (img.imageUrl) {
    return { type: 'image', source: { type: 'url', url: img.imageUrl } };
  }
  return {
    type: 'image',
    source: { type: 'base64', media_type: img.mediaType || 'image/png', data: img.imageBase64 },
  };
}

/**
 * Analyze competitor screenshots and return a differentiation map.
 *
 * @param {object|object[]} images — single or array of { imageUrl } or { imageBase64, mediaType }
 * @returns {Promise<{ ok: true, vision: object, usage: object } | { ok: false, error: string }>}
 */
async function analyzeCompetitors(images) {
  const imageList = Array.isArray(images) ? images : [images];
  if (!imageList.length) return { ok: false, error: 'No images provided.' };

  const imageBlocks = imageList.map(buildImageBlock);
  const countNote = imageList.length > 1
    ? `You are looking at ${imageList.length} competitor screenshots. Analyze them collectively as a competitive set and identify patterns across all of them.`
    : 'You are looking at 1 competitor screenshot.';

  let response;
  try {
    response = await callAnthropic({
      model: VISION_MODEL,
      max_tokens: VISION_MAX_TOKENS,
      system: loadPrompt(),
      messages: [
        {
          role: 'user',
          content: [
            ...imageBlocks,
            { type: 'text', text: `${countNote} Return JSON only, matching the schema in the system prompt.` },
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

module.exports = { analyzeCompetitors, VISION_MODEL };
