'use strict';

const fs = require('fs');
const path = require('path');
const { callAnthropic } = require('../_anthropic-client.js');

const VISION_MODEL = 'claude-sonnet-4-20250514';
const VISION_MAX_TOKENS = 1500;

function loadPrompt() {
  return fs.readFileSync(
    path.join(__dirname, '..', 'skills', 'brand-system-site-vision.md'),
    'utf8'
  );
}

/**
 * Analyze a homepage screenshot to extract design signals.
 *
 * @param {object} opts
 * @param {string} [opts.imageUrl]    — public URL
 * @param {string} [opts.imageBase64] — base64 string (no data: prefix)
 * @param {string} [opts.mediaType]   — required with imageBase64 (e.g. 'image/png')
 * @returns {Promise<{ ok: true, vision: object, usage: object } | { ok: false, error: string }>}
 */
async function analyzeSiteScreenshot({ imageUrl, imageBase64, mediaType } = {}) {
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
      system: loadPrompt(),
      messages: [
        {
          role: 'user',
          content: [
            imageBlock,
            { type: 'text', text: 'Analyze this homepage screenshot. Return JSON only, matching the schema in the system prompt.' },
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

module.exports = { analyzeSiteScreenshot, VISION_MODEL };
