'use strict';

// _dq-narrator.js — AI description generator for the Data Stream (audit-summary) card.
//
// Called after any module run completes. Reads module statuses from
// dashboard_state, computes bucket coverage, and generates a 1-sentence
// description that reflects the actual captured data.
//
// Model: claude-haiku-4-5-20251001 (matches narrator cost profile)
// Output: 1 sentence, plain English, analyst tone, under 35 words.
// Failure mode: returns null — caller writes nothing, static fallback stays.

const NARRATOR_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 80;

const { logUsage, computeAnthropicCost } = require('../../api/_lib/usage-logger.cjs');

// ── Bucket mapping — mirrors renderAuditViz in DashboardPage.jsx ──────────────

const CARD_BUCKET = {
  'marketing-brief':  'Brief',
  'strategy-builder': 'Market',
  'newsletter':       'Market',
  'knowledge-base':   'Brain',
  'industry':         'Brain',
  'brand-voice':      'Brand',
  'brand-system':     'Brand',
  'seo-performance':  'Web',
  'style-guide':      'Web',
  'social-preview':   'Web',
  'multi-device-view':'Web',
  'agent-readiness':  'Web',
};

// ── Anthropic client ──────────────────────────────────────────────────────────

function getApiKey() {
  const key =
    process.env.ANTHROPIC_API_KEY ||
    (() => {
      try { require('dotenv/config'); } catch { /* ignore */ }
      return process.env.ANTHROPIC_API_KEY;
    })();
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set.');
  return key;
}

async function callAnthropic(params) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': getApiKey(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

// ── Context builder ───────────────────────────────────────────────────────────

/**
 * Compute bucket coverage from dashboard_state.modules and build prompt context.
 *
 * @param {object} modules  — dashboard_state.modules map
 * @returns {{ context: string, capturedCount: number, totalCount: number }}
 */
function buildDqContext(modules) {
  const buckets = {};

  for (const [cardId, bucketLabel] of Object.entries(CARD_BUCKET)) {
    if (!buckets[bucketLabel]) buckets[bucketLabel] = { captured: 0, total: 0 };
    const mod = modules?.[cardId];
    if (!mod || mod.enabled === false) continue;
    buckets[bucketLabel].total++;
    if (mod.status === 'succeeded') buckets[bucketLabel].captured++;
  }

  let capturedCount = 0;
  let totalCount = 0;
  const bucketEntries = [];

  for (const [label, { captured, total }] of Object.entries(buckets)) {
    if (total === 0) continue;
    capturedCount += captured;
    totalCount += total;
    bucketEntries.push({ label, captured, total, pct: Math.round((captured / total) * 100) });
  }

  // Find weakest non-complete bucket explicitly so the model doesn't have to infer it.
  const incomplete = bucketEntries.filter((b) => b.pct < 100).sort((a, b) => a.pct - b.pct);
  const weakest = incomplete[0] || null;

  const overallPct = totalCount > 0 ? Math.round((capturedCount / totalCount) * 100) : 0;
  const bucketLines = bucketEntries.map(
    ({ label, captured, total, pct }) => `  ${label}: ${captured}/${total} (${pct}%)`
  );

  const context = [
    `OVERALL: ${capturedCount}/${totalCount} data points captured (${overallPct}%)`,
    `WEAKEST SECTION: ${weakest ? `${weakest.label} at ${weakest.captured}/${weakest.total} (${weakest.pct}%)` : 'none — all sections complete'}`,
    'SECTION BREAKDOWN:',
    ...bucketLines,
  ].join('\n');

  return { context, capturedCount, totalCount };
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `\
You write one-sentence descriptions for a data completeness card on a marketing dashboard.

Rules:
- One sentence only. Plain English. Present tense.
- You MUST use the exact OVERALL numbers (e.g. "7 of 12 data points captured").
- If WEAKEST SECTION is not "none", you MUST name it and state what is missing.
- Do not say a section is complete unless its section breakdown shows 100%.
- Do not invent, round, or paraphrase the numbers — use them exactly.
- Analyst tone. No hype. No filler phrases.
- Under 40 words.
- No markdown, no bullet points.

Example output (given 7/12 overall, weakest = Web at 2/5):
"7 of 12 data points captured — Web is the thinnest section at 2 of 5, with Brief, Market, and Brain fully filled in."`;

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generate an AI description for the Data Stream card.
 *
 * @param {object} modules   — dashboard_state.modules map
 * @param {object} options
 * @param {string} [options.clientId]
 * @returns {Promise<string|null>}
 */
async function narrateDqCard(modules, { clientId = null } = {}) {
  let apiKey;
  try { apiKey = getApiKey(); } catch {
    console.warn('[dq-narrator] ANTHROPIC_API_KEY not set — skipping');
    return null;
  }
  void apiKey;

  const { context, capturedCount, totalCount } = buildDqContext(modules);

  if (totalCount === 0) return null;

  let response;
  try {
    response = await callAnthropic({
      model:      NARRATOR_MODEL,
      max_tokens: MAX_TOKENS,
      system:     SYSTEM_PROMPT,
      messages: [{ role: 'user', content: context }],
    });
  } catch (err) {
    console.warn(`[dq-narrator] Anthropic call failed — ${err.message}`);
    return null;
  }

  const description = response?.content?.[0]?.text?.trim() || null;
  const inputTokens  = response?.usage?.input_tokens  ?? null;
  const outputTokens = response?.usage?.output_tokens ?? null;

  await logUsage({
    module:       'intelligence',
    action:       'narrate-dq',
    provider:     'anthropic',
    model:        NARRATOR_MODEL,
    inputTokens:  inputTokens  || 0,
    outputTokens: outputTokens || 0,
    costUsd:      computeAnthropicCost({
      model:        NARRATOR_MODEL,
      inputTokens:  inputTokens  || 0,
      outputTokens: outputTokens || 0,
    }),
    clientId,
    metadata: { capturedCount, totalCount },
  }).catch(() => {});

  return description;
}

module.exports = { narrateDqCard, buildDqContext };
