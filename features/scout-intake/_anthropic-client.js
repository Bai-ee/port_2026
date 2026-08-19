'use strict';

let dotenvLoaded = false;

function maybeLoadDotenv() {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  try {
    require('dotenv/config');
  } catch {
    // Ignore missing dotenv in deployed environments.
  }
}

function getAnthropicApiKey({ required = true } = {}) {
  let key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    maybeLoadDotenv();
    key = process.env.ANTHROPIC_API_KEY;
  }
  if (!key && required) {
    throw new Error('ANTHROPIC_API_KEY is not set.');
  }
  return key || null;
}

// Hard ceiling on any single Anthropic call. This is a raw fetch() — there is
// no SDK timeout/retry underneath — and an unbounded hang here has ridden a
// Vercel function to its maxDuration kill mid-run (2026-08-18 email diagnosis).
// Default stays high enough for the long Scout/Scribe calls; latency-sensitive
// callers (e.g. the digest summary) pass a tighter per-call `timeoutMs`.
const DEFAULT_ANTHROPIC_TIMEOUT_MS = Number(process.env.ANTHROPIC_TIMEOUT_MS) || 240_000;

async function callAnthropic(params, { apiKey, timeoutMs } = {}) {
  const resolvedApiKey = apiKey || getAnthropicApiKey();
  const boundedMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Number(timeoutMs)
    : DEFAULT_ANTHROPIC_TIMEOUT_MS;
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': resolvedApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(boundedMs),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Anthropic API ${response.status}: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text);
}

function extractAnthropicCostUsd(response, { inputRate = 0, outputRate = 0 } = {}) {
  const usage = response?.usage || {};
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  return (inputTokens * inputRate) + (outputTokens * outputRate);
}

function extractAnthropicUsage(response, { model = '', inputRate = 0, outputRate = 0 } = {}) {
  const usage = response?.usage || {};
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  const estimatedCostUsd = extractAnthropicCostUsd(response, { inputRate, outputRate });
  return {
    model,
    inputTokens,
    outputTokens,
    estimatedCostUsd: Math.round(estimatedCostUsd * 10000) / 10000,
  };
}

module.exports = {
  callAnthropic,
  extractAnthropicCostUsd,
  extractAnthropicUsage,
  getAnthropicApiKey,
};
