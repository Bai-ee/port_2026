'use strict';

// brand-system-mood-vision.js — Analyzes mood board / reference images.
//
// Handles multiple images: each is analyzed individually in a single call,
// then a synthesis pass combines all per-image results into a unified
// cross-image direction summary.

const fs = require('fs');
const path = require('path');
const { callAnthropic } = require('../_anthropic-client.js');

const VISION_MODEL = 'claude-sonnet-4-20250514';
const VISION_MAX_TOKENS = 1500;
const SYNTHESIS_MAX_TOKENS = 1000;

function loadPrompt() {
  return fs.readFileSync(
    path.join(__dirname, '..', 'skills', 'brand-system-mood-vision.md'),
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
 * Analyze a single mood board image.
 *
 * @param {object} img — { imageUrl } or { imageBase64, mediaType }
 * @returns {Promise<{ ok: true, vision: object, usage: object } | { ok: false, error: string }>}
 */
async function analyzeMoodImage(img) {
  if (!img?.imageUrl && !img?.imageBase64) {
    return { ok: false, error: 'No image source provided.' };
  }

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
            buildImageBlock(img),
            { type: 'text', text: 'Analyze this mood board reference image. Return JSON only, matching the schema in the system prompt.' },
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

/**
 * Synthesize multiple per-image analyses into a unified brand direction.
 *
 * @param {object[]} perImageResults — array of vision objects from analyzeMoodImage
 * @returns {Promise<{ ok: true, synthesis: object, usage: object } | { ok: false, error: string }>}
 */
async function synthesizeMoodBoard(perImageResults) {
  if (!perImageResults?.length) {
    return { ok: false, error: 'No per-image results to synthesize.' };
  }

  const summaryText = perImageResults
    .map((r, i) => `Image ${i + 1}:\n${JSON.stringify(r, null, 2)}`)
    .join('\n\n---\n\n');

  const synthesisPrompt = `You are a senior art director. The following are per-image analyses of mood board reference images for a brand identity project. Synthesize them into a unified cross-image direction.

Return ONLY valid JSON matching this exact shape:
{
  "consistent_themes": ["theme 1", "theme 2"],
  "color_consensus": [{ "hex": "#...", "frequency": 3, "name": "descriptive name" }],
  "style_direction": "one sentence describing the unified visual style",
  "tension_notes": ["note any conflicting signals across images"],
  "recommended_visual_language": "editorial | cinematic | industrial | organic | futuristic",
  "recommended_lighting": "one of the lighting options",
  "recommended_material": "one of the material options",
  "recommended_photography_style": "editorial | documentary | studio | lifestyle | abstract",
  "overall_summary": "2-3 sentences briefing the brand team on what these references collectively say"
}

Per-image analyses:

${summaryText}`;

  let response;
  try {
    response = await callAnthropic({
      model: VISION_MODEL,
      max_tokens: SYNTHESIS_MAX_TOKENS,
      messages: [
        { role: 'user', content: synthesisPrompt },
      ],
    });
  } catch (err) {
    return { ok: false, error: `synthesis_call_failed: ${err.message}` };
  }

  const raw = (response?.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '');

  let synthesis;
  try {
    synthesis = JSON.parse(raw);
  } catch {
    return { ok: false, error: `synthesis_parse_failed: ${raw.slice(0, 300)}` };
  }

  return {
    ok: true,
    synthesis,
    usage: {
      inputTokens: response?.usage?.input_tokens || 0,
      outputTokens: response?.usage?.output_tokens || 0,
    },
  };
}

/**
 * Full mood board pipeline: analyze all images then synthesize.
 *
 * @param {object[]} images — array of { imageUrl } or { imageBase64, mediaType }
 * @returns {Promise<{ ok: true, perImage: object[], synthesis: object, totalUsage: object } | { ok: false, error: string }>}
 */
async function analyzeMoodBoard(images) {
  if (!Array.isArray(images) || images.length === 0) {
    return { ok: false, error: 'No images provided.' };
  }

  const results = await Promise.all(images.map(analyzeMoodImage));
  const failed = results.find((r) => !r.ok);
  if (failed) return failed;

  const perImage = results.map((r) => r.vision);
  const totalUsage = results.reduce(
    (acc, r) => ({
      inputTokens: acc.inputTokens + (r.usage?.inputTokens || 0),
      outputTokens: acc.outputTokens + (r.usage?.outputTokens || 0),
    }),
    { inputTokens: 0, outputTokens: 0 }
  );

  if (perImage.length === 1) {
    return { ok: true, perImage, synthesis: null, totalUsage };
  }

  const synth = await synthesizeMoodBoard(perImage);
  if (!synth.ok) return synth;

  return {
    ok: true,
    perImage,
    synthesis: synth.synthesis,
    totalUsage: {
      inputTokens: totalUsage.inputTokens + (synth.usage?.inputTokens || 0),
      outputTokens: totalUsage.outputTokens + (synth.usage?.outputTokens || 0),
    },
  };
}

module.exports = { analyzeMoodBoard, analyzeMoodImage, synthesizeMoodBoard, VISION_MODEL };
