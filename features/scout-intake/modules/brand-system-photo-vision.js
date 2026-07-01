'use strict';

// brand-system-photo-vision.js — Analyzes brand photography to extract
// photography direction for the brand guide.
//
// Accepts a single image or multiple images. For multiple images,
// all are sent in one call so the model can assess consistency across the set.

const fs = require('fs');
const path = require('path');
const { callAnthropic } = require('../_anthropic-client.js');

const VISION_MODEL = 'claude-sonnet-4-6';
const VISION_MAX_TOKENS = 1500;

function loadPrompt() {
  return fs.readFileSync(
    path.join(__dirname, '..', 'skills', 'brand-system-photo-vision.md'),
    'utf8'
  );
}

function buildImageBlock(img) {
  if (img.imageUrl) {
    return { type: 'image', source: { type: 'url', url: img.imageUrl } };
  }
  return {
    type: 'image',
    source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.imageBase64 },
  };
}

/**
 * Analyze one or more brand photos to extract photography direction.
 *
 * @param {object|object[]} images — single { imageUrl } or { imageBase64, mediaType }, or array of same
 * @returns {Promise<{ ok: true, vision: object, usage: object } | { ok: false, error: string }>}
 */
async function analyzeBrandPhotos(images) {
  const imageList = Array.isArray(images) ? images : [images];
  if (!imageList.length) return { ok: false, error: 'No images provided.' };

  const imageBlocks = imageList.map(buildImageBlock);
  const countNote = imageList.length > 1
    ? `You are looking at ${imageList.length} brand photos. Analyze the dominant/most consistent style across all of them.`
    : 'Analyze this brand photograph.';

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

module.exports = { analyzeBrandPhotos, VISION_MODEL };
