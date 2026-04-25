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

async function callAnthropic(params, { apiKey } = {}) {
  const resolvedApiKey = apiKey || getAnthropicApiKey();
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': resolvedApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(params),
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
