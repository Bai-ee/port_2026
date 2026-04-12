// optimizer.js — Token cost optimizer for Scout pipeline
//
// THE PROBLEM (diagnosed from CSV):
//   Scout was costing ~$0.43/run because raw web search results
//   (HTML, boilerplate, full articles) were being dumped into a 115K-token
//   Sonnet context. At 4 runs/day that's ~$51/month.
//
// THE FIX — two-stage pipeline:
//   Stage 1: Haiku reads raw search dumps, extracts only signal (~$0.001)
//   Stage 2: Sonnet writes the brief from clean 3K-token context (~$0.05)
//   Result: ~75% cost reduction → ~$13/month

require('./load-env');
const { getProvider } = require('./providers');

function getAnthropicClient() {
  return getProvider();
}

// Model routing — use the cheapest model that can do the job
const MODELS = {
  searchTrim:   'claude-haiku-4-5-20251001', // cheap, fast — just extracting signal
  briefWrite:   'claude-sonnet-4-6',          // quality matters for final output
  guardianCheck: 'claude-haiku-4-5-20251001', // just fact-checking vs verified claims
};

// Hard token budget per search result after trimming
// 5 searches × 800 tokens = 4,000 tokens into Sonnet vs current ~100K+
const MAX_TOKENS_PER_SEARCH = 800;

/**
 * Stage 1: Use Haiku to extract signal from raw search results.
 * 
 * Instead of dumping full search HTML into Sonnet's context,
 * we ask Haiku to pull out only what's relevant. Haiku is 6x cheaper
 * than Sonnet for input and handles extraction tasks just fine.
 * 
 * @param {string} searchQuery - The original search query
 * @param {string} rawResults  - Raw text from web_search tool result
 * @param {string} clientName  - For context (e.g. "Critters Quest")
 * @returns {string} Clean, trimmed signal summary
 */
async function trimSearchResults(searchQuery, rawResults, clientName) {
  // If results are already short, skip the Haiku call entirely
  const estimatedTokens = rawResults.length / 4;
  if (estimatedTokens < MAX_TOKENS_PER_SEARCH) {
    return { trimmedText: rawResults, usage: { input_tokens: 0, output_tokens: 0 } };
  }

  const response = await getAnthropicClient().messages.create({
    model: MODELS.searchTrim,
    max_tokens: MAX_TOKENS_PER_SEARCH,
    messages: [{
      role: 'user',
      content: `You are extracting marketing intelligence from search results.

Search query: "${searchQuery}"
Client: ${clientName}

From these search results, extract ONLY:
- Direct quotes from tweets/posts (with author and URL if present)
- Key facts about launches, partnerships, or sentiment shifts
- Engagement metrics if visible (likes, RTs, follower counts)
- Post dates (prioritize last 24 hours)

Discard: ads, navigation, HTML, boilerplate, unrelated content.
Be ruthless. Max ${MAX_TOKENS_PER_SEARCH} tokens output.
Output plain text only — no JSON, no headers.

SEARCH RESULTS:
${rawResults.slice(0, 20000)}`  // hard cap raw input to Haiku too
    }]
  });

  return {
    trimmedText: response.content[0]?.text || rawResults.slice(0, 2000),
    usage: response.usage || { input_tokens: 0, output_tokens: 0 },
  };
}

/**
 * Process all search results from a Scout run through Haiku trimmer.
 * Called AFTER web_search tool calls complete, BEFORE Sonnet writes the brief.
 * 
 * @param {Array} searchResults - Array of {query, rawText} objects
 * @param {string} clientName
 * @returns {Array} Array of {query, trimmedText} objects
 */
async function trimAllSearchResults(searchResults, clientName) {
  console.log(`[OPTIMIZER] Trimming ${searchResults.length} search results with Haiku...`);

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const trimmed = await Promise.all(
    searchResults.map(async ({ query, rawText }) => {
      const { trimmedText, usage } = await trimSearchResults(query, rawText, clientName);
      totalInputTokens  += usage.input_tokens  || 0;
      totalOutputTokens += usage.output_tokens || 0;
      const originalTokens = Math.round(rawText.length / 4);
      const trimmedTokens  = Math.round(trimmedText.length / 4);
      console.log(`[OPTIMIZER] "${query.slice(0, 40)}..." ${originalTokens} → ${trimmedTokens} tokens`);
      return { query, trimmedText };
    })
  );

  return { trimmed, trimUsage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens } };
}

/**
 * Build a compact context string from trimmed search results.
 * This replaces the massive raw dump that was going into Sonnet's prompt.
 */
function buildCompactContext(trimmedResults) {
  return trimmedResults
    .map(({ query, trimmedText }) => `--- ${query} ---\n${trimmedText}`)
    .join('\n\n');
}

/**
 * Estimate token count from string length (rough: 1 token ≈ 4 chars)
 */
function estimateTokens(text) {
  return Math.round((text || '').length / 4);
}

/**
 * Log cost estimate for a completed run.
 * Helps track actual spend vs projected during optimization.
 */
function logCostEstimate(label, inputTokens, outputTokens, model) {
  const pricing = {
    'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
    'claude-sonnet-4-6':         { input: 3.00, output: 15.00 },
    'claude-sonnet-4-20250514':  { input: 3.00, output: 15.00 },
  };
  const p = pricing[model] || pricing['claude-sonnet-4-6'];
  const cost = (inputTokens * p.input / 1_000_000) + (outputTokens * p.output / 1_000_000);
  console.log(`[OPTIMIZER] ${label}: ${inputTokens.toLocaleString()} in + ${outputTokens.toLocaleString()} out = $${cost.toFixed(4)} (${model})`);
  return cost;
}

/**
 * Build a structured cost record for a single pipeline stage.
 * Use this instead of logCostEstimate when you need to persist cost data.
 */
function computeStageCost(stage, inputTokens, outputTokens, model) {
  const pricing = {
    'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
    'claude-sonnet-4-6':         { input: 3.00, output: 15.00 },
    'claude-sonnet-4-20250514':  { input: 3.00, output: 15.00 },
  };
  const p = pricing[model] || pricing['claude-sonnet-4-6'];
  const estimatedUsd = (inputTokens * p.input / 1_000_000) + (outputTokens * p.output / 1_000_000);
  return { stage, model, inputTokens, outputTokens, estimatedUsd };
}

module.exports = {
  MODELS,
  trimSearchResults,
  trimAllSearchResults,
  buildCompactContext,
  estimateTokens,
  logCostEstimate,
  computeStageCost,
};
