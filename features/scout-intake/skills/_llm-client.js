'use strict';

// _llm-client.js — Anthropic-first LLM client with KIMI fallback
//
// Tries Anthropic. If the call fails with a credit/billing error (HTTP 400
// with "credit balance" in the body), automatically retries with the KIMI API
// (Moonshot AI, OpenAI-compatible). All other errors propagate as-is.
//
// Returns a response in Anthropic-compatible shape so callers need zero changes
// beyond swapping callAnthropic() for callLLM().
//
// Provider priority:
//   1. Anthropic (claude-haiku / claude-sonnet)
//   2. KIMI (moonshot-v1-8k / moonshot-v1-32k) — on credit errors only
//
// Required env vars:
//   ANTHROPIC_API_KEY  — always required
//   KIMI_API_KEY       — required for fallback

const KIMI_BASE_URL = 'https://api.moonshot.cn/v1';

// Anthropic model → KIMI model
const KIMI_MODEL_MAP = [
  { match: 'haiku',  kimi: 'moonshot-v1-8k'   },
  { match: 'sonnet', kimi: 'moonshot-v1-32k'  },
  { match: 'opus',   kimi: 'moonshot-v1-128k' },
];

function getKimiModel(anthropicModel) {
  for (const { match, kimi } of KIMI_MODEL_MAP) {
    if (anthropicModel.includes(match)) return kimi;
  }
  return 'moonshot-v1-8k';
}

// ── Key resolvers ─────────────────────────────────────────────────────────────

function getAnthropicKey() {
  const key = process.env.ANTHROPIC_API_KEY ||
    (() => { try { require('dotenv/config'); } catch { /* ignore */ } return process.env.ANTHROPIC_API_KEY; })();
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set.');
  return key;
}

function getKimiKey() {
  const key = process.env.KIMI_API_KEY ||
    (() => { try { require('dotenv/config'); } catch { /* ignore */ } return process.env.KIMI_API_KEY; })();
  if (!key) throw new Error('KIMI_API_KEY is not set — cannot fall back to KIMI.');
  return key;
}

// ── Credit error detection ────────────────────────────────────────────────────

function isCreditError(status, body) {
  return status === 400 && (
    body.includes('credit balance') ||
    body.includes('insufficient_quota') ||
    body.includes('billing')
  );
}

// ── Anthropic call ────────────────────────────────────────────────────────────

async function callAnthropic(params) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': getAnthropicKey(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(params),
  });

  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Anthropic API ${res.status}: ${text.slice(0, 400)}`);
    err.status = res.status;
    err.body = text;
    err.isCredit = isCreditError(res.status, text);
    throw err;
  }
  return JSON.parse(text);
}

// ── KIMI call (OpenAI-compatible) ─────────────────────────────────────────────

/**
 * Translate Anthropic tool schema → OpenAI function format.
 * input_schema → parameters (same JSON Schema, different key).
 */
function translateTools(anthropicTools) {
  return (anthropicTools || []).map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description || '',
      parameters: t.input_schema || { type: 'object', properties: {} },
    },
  }));
}

/**
 * Translate Anthropic tool_choice → OpenAI tool_choice.
 * { type: 'tool', name: 'X' } → { type: 'function', function: { name: 'X' } }
 * { type: 'any' }             → 'required'
 */
function translateToolChoice(anthropicChoice) {
  if (!anthropicChoice) return undefined;
  if (anthropicChoice.type === 'tool' && anthropicChoice.name) {
    return { type: 'function', function: { name: anthropicChoice.name } };
  }
  if (anthropicChoice.type === 'any') return 'required';
  return undefined;
}

/**
 * Normalize KIMI/OpenAI response → Anthropic-compatible shape.
 * Callers use extractToolInput() which reads content[].type === 'tool_use'.
 */
function normalizeKimiResponse(openAiResponse, originalModel) {
  const choice = openAiResponse.choices?.[0];
  const toolCalls = choice?.message?.tool_calls || [];
  const usage = openAiResponse.usage || {};

  const content = toolCalls.map((tc) => {
    let input = {};
    try { input = JSON.parse(tc.function?.arguments || '{}'); } catch { /* keep empty */ }
    return {
      type: 'tool_use',
      id:   tc.id || 'kimi-tool-0',
      name: tc.function?.name || '',
      input,
    };
  });

  // If no tool calls but there's text, wrap it as a text block
  if (!content.length && choice?.message?.content) {
    content.push({ type: 'text', text: choice.message.content });
  }

  return {
    content,
    usage: {
      input_tokens:  usage.prompt_tokens     || 0,
      output_tokens: usage.completion_tokens || 0,
    },
    model:     openAiResponse.model || getKimiModel(originalModel),
    _provider: 'kimi',
  };
}

async function callKimi(params) {
  const kimiModel = getKimiModel(params.model || '');
  const body = {
    model:      kimiModel,
    max_tokens: params.max_tokens,
    messages:   params.messages,
    tools:      translateTools(params.tools),
    tool_choice: translateToolChoice(params.tool_choice),
  };

  const res = await fetch(`${KIMI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Authorization': `Bearer ${getKimiKey()}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`KIMI API ${res.status}: ${text.slice(0, 400)}`);

  const openAiResponse = JSON.parse(text);
  return normalizeKimiResponse(openAiResponse, params.model);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Call the LLM with Anthropic-first, KIMI fallback on credit errors.
 *
 * Drop-in replacement for callAnthropic(). Returns Anthropic-shaped response.
 *
 * @param {object} params - Anthropic messages API params
 * @returns {Promise<object>} Anthropic-compatible response
 */
async function callLLM(params) {
  try {
    const result = await callAnthropic(params);
    return result;
  } catch (err) {
    if (err.isCredit) {
      console.warn(`[llm-client] Anthropic credit error — falling back to KIMI for model ${params.model}`);
      return callKimi(params);
    }
    throw err;
  }
}

/**
 * Extract usage + estimate cost from a response (handles both providers).
 * Anthropic and KIMI both return usage.input_tokens / output_tokens after normalization.
 */
function extractUsage(response, model = '') {
  const usage = response.usage || {};
  const inputTokens  = usage.input_tokens  || 0;
  const outputTokens = usage.output_tokens || 0;
  const provider = response._provider || 'anthropic';

  let estimatedCostUsd;
  if (provider === 'kimi') {
    // KIMI moonshot pricing: ~$0.012/MTok input, $0.012/MTok output (approximate)
    estimatedCostUsd = (inputTokens * 0.000012) + (outputTokens * 0.000012);
  } else if (model.includes('haiku')) {
    estimatedCostUsd = (inputTokens * 0.0000008) + (outputTokens * 0.000004);
  } else if (model.includes('sonnet')) {
    estimatedCostUsd = (inputTokens * 0.000003) + (outputTokens * 0.000015);
  } else {
    estimatedCostUsd = (inputTokens * 0.000003) + (outputTokens * 0.000015);
  }

  return {
    model: response.model || model,
    provider,
    inputTokens,
    outputTokens,
    estimatedCostUsd: Math.round(estimatedCostUsd * 10000) / 10000,
  };
}

module.exports = { callLLM, extractUsage };
