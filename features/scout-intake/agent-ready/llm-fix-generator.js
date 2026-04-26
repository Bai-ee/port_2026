'use strict';

// llm-fix-generator.js — Generates site-specific fix prompts for failed
// agent-readiness checks via Anthropic.
//
// Phase 8 of the agent-readiness plan. v1 used static fix-library only;
// this replaces static snippets with Claude-generated prompts that are
// aware of the site's actual tech stack, headers, and robots.txt content.
//
// Returns: { [fixId]: { prompt: string, snippet: string } }
// Gracefully returns {} on any failure (static fallback always available).

const { callAnthropic } = require('../_anthropic-client');
const { FIX_LIBRARY: FIX_LIBRARY_CJS } = require('./fix-library');

const MODEL = 'claude-haiku-4-5-20251001'; // fast + cheap; fix prompts don't need opus
const MAX_TOKENS = 1200;
const INPUT_RATE  = 0.80  / 1_000_000;
const OUTPUT_RATE = 4.00  / 1_000_000;

/**
 * Build a compact tech-context string from site-fetch evidence.
 */
function buildTechContext(websiteUrl, evidence) {
  const lines = [`URL: ${websiteUrl}`];
  const headers = evidence?.pages?.[0]?._responseHeaders || evidence?.headers || {};
  const server  = headers['server'] || headers['Server'];
  const powered  = headers['x-powered-by'] || headers['X-Powered-By'];
  const cfRay    = headers['cf-ray'] || headers['CF-Ray'];

  if (server)  lines.push(`Server: ${server}`);
  if (powered) lines.push(`X-Powered-By: ${powered}`);
  if (cfRay)   lines.push('CDN: Cloudflare');

  // Grab first 400 chars of robots.txt if captured
  const robotsBody = evidence?.robotsTxt?.body;
  if (robotsBody) {
    lines.push(`robots.txt excerpt:\n${String(robotsBody).slice(0, 400)}`);
  }

  return lines.join('\n');
}

/**
 * Generate site-specific fix prompts for a batch of failed checks.
 *
 * @param {{
 *   websiteUrl: string,
 *   failedChecks: object[],
 *   evidence: object|null
 * }} opts
 * @returns {Promise<Record<string, { prompt: string, snippet: string }>>}
 */
async function generateCustomFixes({ websiteUrl, failedChecks, evidence = null }) {
  if (!failedChecks || failedChecks.length === 0) return {};

  // Only generate for checks that have a fixId in the static library
  const fixable = failedChecks.filter((c) => c.fixId && FIX_LIBRARY_CJS[c.fixId]);
  if (fixable.length === 0) return {};

  const techContext = buildTechContext(websiteUrl, evidence);

  const checkList = fixable.map((c) => {
    const lib = FIX_LIBRARY_CJS[c.fixId];
    return `- fixId: ${c.fixId}\n  check: ${c.id}\n  issue: ${lib.title}\n  why: ${lib.why}`;
  }).join('\n\n');

  const systemPrompt = `You are an AI agent readiness consultant. Given a site's tech context and a list of failed agent-readiness checks, output JSON with a customized fix prompt and a drop-in code snippet for each check.

Rules:
- Tailor prompts to the detected tech stack (Next.js, Express, Cloudflare Workers, etc.)
- Snippets should be copy-paste ready, production-quality
- Keep prompts concise: max 3 sentences
- If you cannot detect the stack, default to Next.js
- Output ONLY valid JSON — no markdown, no explanation`;

  const userPrompt = `Site context:
${techContext}

Failed checks that need fixes:
${checkList}

Output JSON in this exact shape:
{
  "[fixId]": {
    "prompt": "Step-by-step fix instruction tailored to this site's stack",
    "snippet": "The actual code or config to drop in"
  }
}`;

  try {
    const response = await callAnthropic({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = response?.content?.[0]?.text || '';
    // Strip any accidental markdown fences
    const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/```$/m, '').trim();
    const parsed = JSON.parse(cleaned);

    // Validate shape — only return entries that have prompt + snippet strings
    const result = {};
    for (const [fixId, val] of Object.entries(parsed)) {
      if (typeof val?.prompt === 'string' && typeof val?.snippet === 'string') {
        result[fixId] = { prompt: val.prompt, snippet: val.snippet };
      }
    }
    return result;
  } catch {
    // Silent fallback — static fix-library is always the safety net
    return {};
  }
}

module.exports = { generateCustomFixes };
