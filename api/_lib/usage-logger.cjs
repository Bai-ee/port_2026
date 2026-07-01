'use strict';

// Central usage / cost logger.
//
// Writes one row per paid API call to the `usage_events` Firestore collection.
// The OpsOverview dashboard aggregates from this collection (see Phase 4).
//
// Best-effort: a write failure here must NEVER break the calling pipeline.
// All errors are caught and logged as warnings.

const fb = require('./firebase-admin.cjs');

// ─── RATE TABLE ──────────────────────────────────────────────────────────────
//
// USD rates. Edit this block when provider pricing changes.
// Token rates are USD per single token (= published per-MTok price ÷ 1_000_000).
// Image rates are USD per generated image, optionally keyed by `${size}-${quality}`.
// Flat rates are USD per call (e.g. SerpAPI per-query).

const RATES = {
  // Anthropic — token-priced
  'claude-haiku-4-5':           { inputPerToken: 1.00 / 1_000_000, outputPerToken: 5.00  / 1_000_000 },
  // Date-stamped Haiku 4.5 (Oct 2025 release) — same family rate. Used by the
  // intelligence PSI narrator.
  'claude-haiku-4-5-20251001':  { inputPerToken: 1.00 / 1_000_000, outputPerToken: 5.00  / 1_000_000 },
  'claude-sonnet-4-6':      { inputPerToken: 3.00 / 1_000_000, outputPerToken: 15.00 / 1_000_000 },
  // Sonnet 4.5 (Sep 2025) — same family rate. Used by the external-scout
  // web_search paths (reddit / reviews).
  'claude-sonnet-4-5-20250929': { inputPerToken: 3.00 / 1_000_000, outputPerToken: 15.00 / 1_000_000 },
  // Older Sonnet 4 (May 2024 release) — same family rate. Used by brand-system vision
  // modules and the intelligence PSI narrator.
  'claude-sonnet-4-20250514': { inputPerToken: 3.00 / 1_000_000, outputPerToken: 15.00 / 1_000_000 },

  // OpenAI text — token-priced (kept here so future text calls can plug in)
  'gpt-4o':                 { inputPerToken: 2.50 / 1_000_000, outputPerToken: 10.00 / 1_000_000 },
  'gpt-4o-mini':            { inputPerToken: 0.15 / 1_000_000, outputPerToken: 0.60  / 1_000_000 },

  // Image gen — flat per-image
  'gpt-image-1':            { perImage: {
      '1024x1024-high':   0.167,
      '1024x1536-high':   0.25,
      '1536x1024-high':   0.25,
      '1024x1024-medium': 0.042,
      '1024x1536-medium': 0.063,
      '1536x1024-medium': 0.063,
      '1024x1024-low':    0.011,
      '1024x1536-low':    0.016,
      '1536x1024-low':    0.016,
      default:            0.042,
    } },
  'gemini-2.5-flash-image': { perImage: { default: 0.039 } },
  'imagen-4':               { perImage: { default: 0.04 } },

  // SerpAPI — flat per-query (Production tier: $50 / 5000 queries = $0.01)
  'serpapi-google-maps':    { perCall: 0.01 },
};

function rateFor(model) {
  return RATES[model] || null;
}

// ─── COST HELPERS ────────────────────────────────────────────────────────────

function computeAnthropicCost({ model, inputTokens = 0, outputTokens = 0 } = {}) {
  const r = rateFor(model);
  if (!r) return 0;
  return ((Number(inputTokens)  || 0) * (r.inputPerToken  || 0))
       + ((Number(outputTokens) || 0) * (r.outputPerToken || 0));
}

function computeOpenAiTextCost(args) {
  return computeAnthropicCost(args);
}

function computeImageCost({ model, size = null, quality = null, count = 1 } = {}) {
  const r = rateFor(model);
  if (!r?.perImage) return 0;
  const key = size && quality ? `${size}-${quality}` : 'default';
  const unit = (r.perImage[key] != null) ? r.perImage[key] : (r.perImage.default || 0);
  return unit * (Number(count) || 0);
}

function computeFlatCost({ model, calls = 1 } = {}) {
  const r = rateFor(model);
  if (!r?.perCall) return 0;
  return r.perCall * (Number(calls) || 0);
}

// Anthropic web_search tool surcharge — billed on TOP of tokens, $10 / 1k
// searches. The exact count comes from response.usage.server_tool_use.
const WEB_SEARCH_USD_PER_REQUEST = 10 / 1000;

function webSearchRequests(response) {
  return Number(response?.usage?.server_tool_use?.web_search_requests) || 0;
}

// ─── WRITER ──────────────────────────────────────────────────────────────────

const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

/**
 * Write a usage event to Firestore. Returns the new doc id, or null on failure.
 *
 * @param {object} args
 * @param {string} args.module     'leadgen' | 'brand-system' | 'scout-intake' | …
 * @param {string} [args.action]   sub-action, e.g. 'generate-site', 'package.compose-note'
 * @param {string} args.provider   'anthropic' | 'openai' | 'gemini' | 'serpapi' | …
 * @param {string} args.model      provider-specific model id (matches RATES key when possible)
 * @param {number} [args.inputTokens]
 * @param {number} [args.outputTokens]
 * @param {number} [args.calls]    flat-rate call count (e.g. SerpAPI queries)
 * @param {number} [args.imageCount]
 * @param {number} [args.costUsd]  precomputed cost; required (compute via helpers above)
 * @param {string} [args.runId]
 * @param {string} [args.clientId]
 * @param {string} [args.placeId]  leadgen prospect placeId
 * @param {object} [args.metadata] free-form extra context (size, quality, fallbackChain, etc.)
 */
async function logUsage(args = {}) {
  const {
    module: moduleName,
    action = null,
    provider,
    model,
    inputTokens = 0,
    outputTokens = 0,
    calls = 0,
    imageCount = 0,
    costUsd = 0,
    runId = null,
    clientId = null,
    placeId = null,
    metadata = {},
  } = args;

  if (!moduleName || !provider || !model) {
    console.warn('[usage-logger] missing required field', { moduleName, provider, model });
    return null;
  }

  const doc = {
    module:           String(moduleName),
    action:           action ? String(action) : null,
    provider:         String(provider),
    model:            String(model),
    inputTokens:      Number(inputTokens)  || 0,
    outputTokens:     Number(outputTokens) || 0,
    calls:            Number(calls)        || 0,
    imageCount:       Number(imageCount)   || 0,
    estimatedCostUsd: round4(costUsd),
    runId,
    clientId,
    placeId,
    metadata:         metadata && typeof metadata === 'object' ? metadata : {},
    timestamp:        new Date().toISOString(),
    createdAt:        fb.FieldValue.serverTimestamp(),
  };

  try {
    const ref = await fb.adminDb.collection('usage_events').add(doc);
    return ref.id;
  } catch (err) {
    console.warn('[usage-logger] write failed:', err?.message || err);
    return null;
  }
}

/**
 * Convenience: log one Anthropic Messages call from its raw response. Captures
 * token cost (via RATES) AND the web_search tool surcharge (from
 * response.usage.server_tool_use) — the exact numbers, not an estimate — so a
 * single line item reflects the true cost of a call that used web_search. Use
 * this to instrument any Anthropic call that isn't already in stageCosts.
 */
async function logAnthropicCall({ module: moduleName, action = null, model, response, clientId = null, runId = null, metadata = {} } = {}) {
  const usage = response?.usage || {};
  const inputTokens = Number(usage.input_tokens) || 0;
  const outputTokens = Number(usage.output_tokens) || 0;
  const searches = webSearchRequests(response);
  const searchCost = searches * WEB_SEARCH_USD_PER_REQUEST;
  const costUsd = computeAnthropicCost({ model, inputTokens, outputTokens }) + searchCost;
  return logUsage({
    module: moduleName,
    action,
    provider: 'anthropic',
    model,
    inputTokens,
    outputTokens,
    costUsd,
    clientId,
    runId,
    metadata: searches
      ? { ...metadata, webSearchRequests: searches, webSearchSurchargeUsd: round4(searchCost) }
      : metadata,
  });
}

module.exports = {
  RATES,
  rateFor,
  computeAnthropicCost,
  computeOpenAiTextCost,
  computeImageCost,
  computeFlatCost,
  WEB_SEARCH_USD_PER_REQUEST,
  webSearchRequests,
  logUsage,
  logAnthropicCall,
};
