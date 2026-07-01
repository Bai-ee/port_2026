/**
 * Strategy builder engine — calls Claude and validates the PostPlan response.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { createAnthropicClient } = require('../not-the-rug-brief/anthropic-client.js');
const { logAnthropicCall } = require('../../api/_lib/usage-logger.cjs');

import { buildPrompt, buildTodayPrompt } from './prompt.js';
import { isValidPostType, isValidTargetAction } from '../x-growth/post-types.js';

const MODEL = 'claude-sonnet-4-6';
// A 30-day plan is ~30+ items each with content + rationale; 4096 truncated
// the JSON mid-string and every retry hit the same cap. Size for the window.
const MAX_TOKENS = 16384;
const MAX_RETRIES = 2;

/**
 * Validate a PostPlan against business rules.
 * Returns null if valid, or an error string describing the first violation.
 * @param {Object} plan
 * @param {import('./schemas.js').StrategyContext} ctx
 * @returns {string|null}
 */
function validatePlan(plan, ctx) {
  if (!plan || typeof plan !== 'object') return 'Response is not a JSON object.';
  if (!Array.isArray(plan.items) || plan.items.length === 0) return 'plan.items is missing or empty.';
  if (!Array.isArray(plan.anchors)) return 'plan.anchors is missing.';
  if (!plan.campaignId) return 'plan.campaignId is missing.';
  if (!plan.generatedAt) return 'plan.generatedAt is missing.';

  const now = new Date(ctx.now || new Date().toISOString()).getTime();
  const startDate = ctx.config?.startDate
    ? new Date(ctx.config.startDate + 'T00:00:00Z').getTime()
    : now;
  const windowEnd = startDate + (ctx.config?.days || 30) * 24 * 60 * 60 * 1000;
  const anchorIds = new Set((plan.anchors || []).map((a) => a.id));

  for (const item of plan.items) {
    if (!item.id) return 'An item is missing .id.';
    if (!item.scheduledAt) return `Item ${item.id} missing scheduledAt.`;

    const ts = new Date(item.scheduledAt).getTime();
    if (Number.isNaN(ts)) return `Item ${item.id} has invalid scheduledAt.`;
    if (ts < now - 60000) return `Item ${item.id} scheduledAt is in the past.`;
    if (ts > windowEnd + 86400000) return `Item ${item.id} scheduledAt is beyond campaign window.`;

    if (!item.content) return `Item ${item.id} has no content.`;
    if (item.content.length > 280) return `Item ${item.id} content exceeds 280 chars (${item.content.length}).`;

    const validKinds = ['baseline', 'ramp', 'event', 'closure', 'special'];
    if (!validKinds.includes(item.kind)) return `Item ${item.id} has unknown kind '${item.kind}'.`;

    if (['ramp', 'event'].includes(item.kind) && item.anchorId && !anchorIds.has(item.anchorId)) {
      return `Item ${item.id} references unknown anchorId '${item.anchorId}'.`;
    }

    // Soft-validate xStrategy if present — don't fail generation; server scoring will fill gaps.
    if (item.xStrategy) {
      const xs = item.xStrategy;
      if (xs.postType && !isValidPostType(xs.postType)) {
        console.warn(`[build-strategy] Item ${item.id} xStrategy.postType '${xs.postType}' is not a known type — server scoring will override.`);
      }
      if (xs.targetAction && !isValidTargetAction(xs.targetAction)) {
        console.warn(`[build-strategy] Item ${item.id} xStrategy.targetAction '${xs.targetAction}' is not a known action — server scoring will override.`);
      }
      const scoresOk = !xs.scores || Object.values(xs.scores).every((v) => typeof v !== 'number' || (v >= 0 && v <= 1));
      if (!scoresOk) {
        console.warn(`[build-strategy] Item ${item.id} xStrategy.scores contain out-of-range values — server scoring will override.`);
      }
    }
  }

  // Baseline mix check
  const baselineMixPct = ctx.config?.baselineMixPct ?? 40;
  const baselineCount = plan.items.filter((i) => i.kind === 'baseline').length;
  const actualPct = (baselineCount / plan.items.length) * 100;
  if (actualPct < baselineMixPct * 0.6) {
    return `Baseline mix too low: ${actualPct.toFixed(0)}% vs target ${baselineMixPct}%.`;
  }

  return null;
}

/**
 * Build today's strategy from Marketing Brief signals.
 * Returns a TodayStrategy object or throws on failure.
 * @param {import('./schemas.js').StrategyContext} ctx
 * @returns {Promise<Object>}
 */
export async function buildTodayStrategy(ctx) {
  const anthropic = createAnthropicClient();
  const messages = buildTodayPrompt(ctx);

  let responseText = '';
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: 'You are a senior social strategist. Return only valid JSON. No markdown.',
      messages,
    });
    // Instrument — Strategy Builder was fully untracked (cron, every client).
    try { await logAnthropicCall({ module: 'strategy-builder', action: 'build-today', model: MODEL, response, clientId: ctx?.clientId || null }); } catch { /* best-effort */ }
    responseText = response?.content?.[0]?.text || '';
    const cleaned = responseText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    const today = JSON.parse(cleaned);
    if (!today.date || !Array.isArray(today.posts)) {
      throw new Error('Today strategy missing required fields (date, posts).');
    }
    return today;
  } catch (err) {
    throw new Error(`Today strategy failed: ${err.message}`);
  }
}

/**
 * Build a strategy plan using Claude.
 * @param {import('./schemas.js').StrategyContext} ctx
 * @param {Object|null} todayStrategy — output of buildTodayStrategy, injected as context
 * @returns {Promise<import('./schemas.js').PostPlan>}
 */
export async function buildStrategy(ctx, todayStrategy = null) {
  const anthropic = createAnthropicClient();
  const messages = buildPrompt(ctx, todayStrategy);

  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let responseText = '';
    try {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: 'You are a senior social strategist. Return only valid JSON matching the PostPlan schema. No markdown, no explanation.',
        messages,
      });

      // Instrument — the 30-day plan (max_tokens up to MAX_TOKENS) was untracked.
      try { await logAnthropicCall({ module: 'strategy-builder', action: 'build-30day', model: MODEL, response, clientId: ctx?.clientId || null }); } catch { /* best-effort */ }

      responseText = response?.content?.[0]?.text || '';

      // Strip markdown code fences if model wraps output
      const cleaned = responseText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();

      const plan = JSON.parse(cleaned);
      const validationError = validatePlan(plan, ctx);

      if (validationError) {
        lastError = new Error(`Validation failed (attempt ${attempt + 1}): ${validationError}`);
        // Add the violation to the retry message
        messages.push(
          { role: 'assistant', content: responseText },
          { role: 'user', content: `The plan is invalid: ${validationError}. Fix it and return the corrected JSON only.` }
        );
        continue;
      }

      return plan;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        messages.push(
          { role: 'assistant', content: responseText || 'ERROR' },
          { role: 'user', content: `There was an error: ${err.message}. Please return a valid PostPlan JSON object.` }
        );
      }
    }
  }

  throw lastError || new Error('Strategy generation failed after retries.');
}
