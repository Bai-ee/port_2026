'use strict';

const { callAnthropic } = require('../_anthropic-client.js');

const VISION_MODEL = 'claude-sonnet-4-6';
const VISION_MAX_TOKENS = 2200;

function buildImageBlock(img) {
  if (img.imageUrl) {
    return { type: 'image', source: { type: 'url', url: img.imageUrl } };
  }
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: img.mediaType || 'image/jpeg',
      data: img.imageBase64,
    },
  };
}

function systemPrompt() {
  return `You are a senior creative director building client-specific Visual DNA for AI image generation.

Analyze the provided reference images for one domain subject. The output will be injected into future image prompts, so it must be specific, concrete, and faithful to the uploaded references.

Return ONLY valid JSON matching this schema:
{
  "subjectLabel": "string",
  "domain": "food|product|location|lifestyle|people|environment",
  "summary": "2-3 sentence description of the visual subject",
  "mustInclude": ["specific visual cues"],
  "avoid": ["visual mistakes or generic drift to avoid"],
  "colorCues": ["specific colors/material colors"],
  "textureCues": ["specific textures"],
  "lighting": {
    "type": "string",
    "quality": "soft|hard|mixed|dramatic",
    "temperature": "warm|neutral|cool|mixed"
  },
  "composition": {
    "bestAngles": ["overhead", "45-degree close-up"],
    "framing": "string",
    "context": "string"
  },
  "aliases": ["words that should trigger this subject"],
  "promptBlock": "A concise reusable prompt block. Write it in imperative style: When generating [subject], show..."
}

Domain-specific guidance:
- food: identify dish type, plating, ingredients, portion style, garnish, sauces, tableware, camera angle, and what would make it feel like the client rather than generic stock food.
- product: identify shape, packaging, material, labels, scale, props, and use context.
- location/environment: identify architectural cues, signage, surfaces, lighting, layout, and atmosphere.
- lifestyle/people: identify wardrobe, poses, expressions, context, demographic cues only when visible, and authenticity rules.

Rules:
- Describe what is visible; do not invent unseen facts.
- If user notes conflict with the image, reflect the notes as operator intent but keep image-derived cues.
- Keep arrays short and usable: 4-8 items.
- The promptBlock must be directly reusable in image prompts.`;
}

async function analyzeVisualDnaSubject({ domain, subjectLabel, notes = '', images = [] }) {
  if (!domain) return { ok: false, error: 'domain required' };
  if (!subjectLabel) return { ok: false, error: 'subjectLabel required' };
  if (!Array.isArray(images) || !images.length) return { ok: false, error: 'images required' };

  let response;
  try {
    response = await callAnthropic({
      model: VISION_MODEL,
      max_tokens: VISION_MAX_TOKENS,
      system: systemPrompt(),
      messages: [
        {
          role: 'user',
          content: [
            ...images.map(buildImageBlock),
            {
              type: 'text',
              text: `Domain: ${domain}
Subject: ${subjectLabel}
Operator notes: ${notes || '(none)'}

Analyze these references as one subject profile. Return JSON only.`,
            },
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

  let analysis;
  try {
    analysis = JSON.parse(raw);
  } catch {
    return { ok: false, error: `vision_parse_failed: ${raw.slice(0, 300)}` };
  }

  return {
    ok: true,
    analysis,
    usage: {
      inputTokens: response?.usage?.input_tokens || 0,
      outputTokens: response?.usage?.output_tokens || 0,
    },
  };
}

module.exports = { analyzeVisualDnaSubject, VISION_MODEL };
