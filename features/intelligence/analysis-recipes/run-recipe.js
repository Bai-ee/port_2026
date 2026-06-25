'use strict';

// run-recipe.js — Execute an analysis recipe over supplied content.
//
// This is the analyzer-side equivalent of scout-test: scout-test confirms what a
// SOURCE returns; this confirms what an ANALYZER (recipe) produces over content we
// already have. It is intentionally NOT wired into the live brief pipeline or the
// dashboard UI yet — that is the next, approval-gated phase. For now it proves a
// recipe runs over real Marketing Insights data.
//
// Prove on real data:
//   1. Dump a client's stored signals to a file, e.g. the
//      dashboard_state/{clientId}.marketingBrief.scoutBrief.agentData object.
//   2. node features/intelligence/analysis-recipes/run-recipe.js \
//        --recipe customer-research --content ./scoutBrief.json
//
// See SSOT §8.

const fs = require('fs');
const { callAnthropic, extractAnthropicCostUsd } = require('../../scout-intake/_anthropic-client');
const { getRecipe, loadRecipePrompt, DEFAULT_MODEL, DEFAULT_MAX_TOKENS } = require('./recipes');

// Sonnet rates — same as the scout-test path.
const INPUT_RATE = 0.000003;
const OUTPUT_RATE = 0.000015;

function serializeContent(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

/**
 * Run a single analysis recipe over supplied content.
 *
 * @param {object}  input
 * @param {string}  input.recipeId   registered recipe id (e.g. 'customer-research')
 * @param {string|object} input.content   the material to analyze (string or JSON-able)
 * @param {string} [input.context]   optional positioning/brand context block
 * @param {string} [input.model]     model override
 * @param {number} [input.maxTokens] token cap override
 * @returns {Promise<{ ok, recipeId, analysis, costUsd, ms, error }>}
 */
async function runAnalysisRecipe({ recipeId, content, context = '', model, maxTokens }) {
  const t0 = Date.now();
  const recipe = getRecipe(recipeId);
  if (!recipe) {
    return { ok: false, recipeId, analysis: null, costUsd: 0, ms: Date.now() - t0, error: `Unknown recipe "${recipeId}".` };
  }

  const recipePrompt = loadRecipePrompt(recipeId);
  const contentBlock = serializeContent(content);
  if (!contentBlock.trim()) {
    return { ok: false, recipeId, analysis: null, costUsd: 0, ms: Date.now() - t0, error: 'No content supplied to analyze.' };
  }

  const userPrompt = [
    context ? `POSITIONING / BRAND CONTEXT:\n${context}\n` : '',
    `CONTENT TO ANALYZE:\n${contentBlock}`,
  ].filter(Boolean).join('\n');

  let response;
  try {
    response = await callAnthropic({
      model: model || recipe.model || DEFAULT_MODEL,
      max_tokens: maxTokens || recipe.maxTokens || DEFAULT_MAX_TOKENS,
      system: recipePrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
  } catch (err) {
    return { ok: false, recipeId, analysis: null, costUsd: 0, ms: Date.now() - t0, error: err.message };
  }

  const text = (response.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  const costUsd = Math.round(extractAnthropicCostUsd(response, { inputRate: INPUT_RATE, outputRate: OUTPUT_RATE }) * 10000) / 10000;

  return {
    ok: Boolean(text),
    recipeId,
    analysis: text || null,
    costUsd,
    ms: Date.now() - t0,
    error: text ? null : 'Recipe returned no text.',
  };
}

module.exports = { runAnalysisRecipe };

// ─── CLI harness ──────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const recipeId = get('--recipe') || 'customer-research';
  const contentPath = get('--content');
  const contextPath = get('--context');

  if (!contentPath) {
    console.error('Usage: node run-recipe.js --recipe <id> --content <file.json|file.txt> [--context <file>]');
    process.exit(1);
  }

  const readMaybeJson = (p) => {
    const raw = fs.readFileSync(p, 'utf8');
    try { return JSON.parse(raw); } catch { return raw; }
  };

  const content = readMaybeJson(contentPath);
  const context = contextPath ? fs.readFileSync(contextPath, 'utf8') : '';

  runAnalysisRecipe({ recipeId, content, context })
    .then((res) => {
      console.log(`\n--- recipe=${res.recipeId} ok=${res.ok} cost=$${res.costUsd} ${res.ms}ms ---\n`);
      if (res.error) console.error('ERROR:', res.error);
      if (res.analysis) console.log(res.analysis);
    })
    .catch((err) => { console.error('Fatal:', err); process.exit(1); });
}
