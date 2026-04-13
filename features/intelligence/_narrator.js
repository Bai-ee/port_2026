'use strict';

// _narrator.js — AI narrative generation for intelligence source records
//
// Generates a short human-readable paragraph from normalized PSI facts.
// Called by intelligence-runner.cjs after a successful source fetch.
//
// Model: claude-haiku-4-5-20251001 (matches Scout cost profile)
// Expected output: 2–4 sentences, neutral analyst tone.
// Failure mode: returns null — caller must fall back to templated summary.

const NARRATOR_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 256;

// ── Anthropic client (matches intake-synthesizer.js pattern) ──────────────────

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
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

// ── Input trimmer — PSI facts → compact prompt context ───────────────────────

/**
 * Build a compact text block from PSI facts for the narrator prompt.
 * Keeps token count low (~200–400 tokens of context).
 *
 * @param {object} facts  — the facts object from a pagespeed-insights SourceRecord
 * @returns {string}
 */
function buildPsiContext(facts) {
  const lines = [];

  if (facts.websiteUrl) lines.push(`URL: ${facts.websiteUrl}`);

  const s = facts.scores;
  if (s) {
    const parts = [];
    if (s.performance  != null) parts.push(`performance ${s.performance}/100`);
    if (s.seo          != null) parts.push(`SEO ${s.seo}/100`);
    if (s.accessibility != null) parts.push(`accessibility ${s.accessibility}/100`);
    if (s.bestPractices != null) parts.push(`best-practices ${s.bestPractices}/100`);
    if (parts.length) lines.push(`Lighthouse scores (mobile): ${parts.join(', ')}`);
  }

  // Prefer field CWV, fall back to lab
  const cwv  = facts.coreWebVitals;
  const lab  = facts.labCoreWebVitals;
  const lcp  = cwv?.lcp?.p75  != null ? cwv.lcp  : lab?.lcp;
  const inp  = cwv?.inp?.p75  != null ? cwv.inp  : null;
  const cls  = cwv?.cls?.p75  != null ? cwv.cls  : lab?.cls;

  if (lcp?.p75 != null) {
    lines.push(`LCP: ${(lcp.p75 / 1000).toFixed(2)}s (${lcp.category || 'unrated'})`);
  }
  if (inp?.p75 != null) {
    lines.push(`INP: ${inp.p75}ms (${inp.category || 'unrated'})`);
  }
  if (cls?.p75 != null) {
    lines.push(`CLS: ${Number(cls.p75).toFixed(3)} (${cls.category || 'unrated'})`);
  }

  const opps = (facts.opportunities || []).slice(0, 5);
  if (opps.length) {
    lines.push('Top opportunities:');
    opps.forEach((o) => lines.push(`  - ${o.title}: saves ${o.savingsMs}ms`));
  }

  const flags = facts.seoRedFlags || [];
  if (flags.length) {
    lines.push(`SEO red flags (${flags.length}): ${flags.slice(0, 3).map((f) => f.id || f).join(', ')}`);
  } else {
    lines.push('SEO red flags: none');
  }

  if (facts.runtimeError) {
    lines.push(`Partial audit — runtimeError: ${facts.runtimeError.code} (${facts.runtimeError.message || 'page could not be fully rendered'})`);
  }

  return lines.join('\n');
}

// ── System prompt ──────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `\
You are a neutral technical analyst summarizing PageSpeed Insights data for a client dashboard.

Write 2–4 sentences in plain English, present tense, analyst tone (not brand voice).
Mention the most important scores and Core Web Vitals first.
If there are SEO red flags, note them briefly.
If this is a partial audit (runtimeError), clearly state the page could not be fully audited and that scores may be incomplete.
Do not invent facts not present in the data.
Do not use markdown, bullet points, or headings — plain prose only.
Keep the response under 80 words.`;

// ── Main narrator function ────────────────────────────────────────────────────

/**
 * Generate an AI narrative for a PSI SourceRecord.
 *
 * Short-circuits to null if the facts indicate a runtimeError (partial audit)
 * OR if ANTHROPIC_API_KEY is not set — caller falls back to templated summary.
 *
 * @param {object} sourceRecord  — validated PSI SourceRecord
 * @returns {Promise<{ narrative: string|null, model: string|null, inputTokens: number|null, outputTokens: number|null }>}
 */
async function narratePsiRecord(sourceRecord) {
  // Only handle PSI records
  if (sourceRecord.id !== 'pagespeed-insights') {
    return { narrative: null, model: null, inputTokens: null, outputTokens: null };
  }

  const facts = sourceRecord.facts || {};

  // Don't waste tokens on error-state records
  if (sourceRecord.status === 'error') {
    return { narrative: null, model: null, inputTokens: null, outputTokens: null };
  }

  let apiKey;
  try { apiKey = getApiKey(); } catch {
    console.warn('[narrator] ANTHROPIC_API_KEY not set — skipping narrative generation');
    return { narrative: null, model: null, inputTokens: null, outputTokens: null };
  }
  void apiKey; // already validated by getApiKey()

  const context = buildPsiContext(facts);

  let response;
  try {
    response = await callAnthropic({
      model:      NARRATOR_MODEL,
      max_tokens: MAX_TOKENS,
      system:     SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: context },
      ],
    });
  } catch (err) {
    console.warn(`[narrator] Anthropic call failed — ${err.message}`);
    return { narrative: null, model: NARRATOR_MODEL, inputTokens: null, outputTokens: null };
  }

  const narrative = response?.content?.[0]?.text?.trim() || null;
  const inputTokens  = response?.usage?.input_tokens  ?? null;
  const outputTokens = response?.usage?.output_tokens ?? null;

  return { narrative, model: NARRATOR_MODEL, inputTokens, outputTokens };
}

module.exports = { narratePsiRecord, buildPsiContext };
