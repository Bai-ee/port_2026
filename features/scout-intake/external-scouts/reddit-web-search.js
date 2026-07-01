'use strict';

const { callAnthropic, extractAnthropicCostUsd } = require('../_anthropic-client');
const { logAnthropicCall } = require('../../../api/_lib/usage-logger.cjs');

// reddit-web-search.js — Credential-free Reddit scout.
//
// Uses Claude's built-in web_search tool with site:reddit.com scoping so we
// can surface Reddit signals without a Reddit OAuth setup. Returns a report
// shaped to match the existing reddit fetcher from the reference scout
// library (mentions + participationOpportunities + counts) so downstream
// code can consume either source interchangeably.
//
// Cost: one Sonnet call, ~$0.02/run. Quality is lower than the OAuth-native
// path but sufficient as a default for clients who don't have Reddit API
// credentials set up yet.

const MODEL = 'claude-sonnet-4-5-20250929';
const MAX_TOKENS = 2000;

function buildPrompt({ redditConfig }) {
  const subs = (redditConfig.subreddits || []).join(', r/');
  const mentionList = (redditConfig.mentionQueries || []).length
    ? redditConfig.mentionQueries
    : (redditConfig.brandTerms || []); // fall back to brand terms when no explicit mention queries
  const mentionQ = mentionList.join(' | ');
  const oppQ = (redditConfig.opportunityQueries || []).join(' | ');
  return `Use web_search with site:reddit.com to find posts and threads relevant to this client.

SUBREDDITS TO COVER: r/${subs || '(any)'}

BRAND MENTION QUERIES (surface posts that reference the brand directly):
${mentionQ || '(none)'}

OPPORTUNITY QUERIES (non-branded buyer-language searches where the brand could credibly participate):
${oppQ || '(none)'}

Return a JSON object with this exact shape. Do not wrap in markdown. Do not add commentary outside the JSON.

{
  "mentions": [
    { "title": "...", "subreddit": "r/...", "summary": "...", "insight": "...", "url": "https://reddit.com/..." }
  ],
  "participationOpportunities": [
    { "title": "...", "subreddit": "r/...", "summary": "...", "opportunityType": "recommendation_thread|pain_point|participation_opportunity", "whyRelevant": "...", "url": "https://reddit.com/..." }
  ]
}

Rules:
- Each entry needs a real reddit.com URL — no fabricated links.
- Up to 5 mentions and 8 opportunities total.
- Skip items more than 90 days old when a date is visible.
- If no meaningful results found in a category, return an empty array for it.`;
}

function extractJson(response) {
  if (!Array.isArray(response.content)) return null;
  const textBlocks = response.content.filter((b) => b.type === 'text');
  const fullText = textBlocks.map((b) => b.text).join('\n');
  const match = fullText.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function extractCost(response) {
  // Sonnet 4.5 pricing
  return extractAnthropicCostUsd(response, {
    inputRate: 0.000003,
    outputRate: 0.000015,
  });
}

/**
 * Run a Reddit scout using web_search. Returns a report matching the shape
 * of the OAuth-native `fetchRedditSignals`.
 */
async function runRedditWebSearch({ clientId, redditConfig }) {
  // Reddit search runs via site:reddit.com web_search, so it works with queries
  // alone — subreddits are optional scoping, not a hard requirement.
  const subs    = Array.isArray(redditConfig?.subreddits)         ? redditConfig.subreddits.filter(Boolean)         : [];
  const mention = Array.isArray(redditConfig?.mentionQueries)     ? redditConfig.mentionQueries.filter(Boolean)     : [];
  const opp     = Array.isArray(redditConfig?.opportunityQueries) ? redditConfig.opportunityQueries.filter(Boolean) : [];
  const brand   = Array.isArray(redditConfig?.brandTerms)         ? redditConfig.brandTerms.filter(Boolean)         : [];
  if (!redditConfig || (subs.length === 0 && mention.length === 0 && opp.length === 0 && brand.length === 0)) {
    return { ok: false, report: null, cost: 0, error: 'no reddit queries or subreddits configured' };
  }

  let response;
  try {
    response = await callAnthropic({
      model:       MODEL,
      max_tokens:  MAX_TOKENS,
      messages:    [{ role: 'user', content: buildPrompt({ redditConfig }) }],
      tools:       [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    });
  } catch (err) {
    return { ok: false, report: null, cost: 0, error: err.message };
  }

  // TEMP DEBUG — remove after diagnosing empty reddit results.
  try {
    const blockTypes = (response.content || []).map((b) => b.type);
    const textJoined = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    console.log('[reddit-web-search] blocks:', JSON.stringify(blockTypes));
    console.log('[reddit-web-search] text:', textJoined.slice(0, 1500));
  } catch { /* ignore */ }

  // Instrument this Sonnet + web_search call (token cost + web_search surcharge)
  // so it shows on the Operating Cost card — its cost was previously dropped.
  try { await logAnthropicCall({ module: 'scout-intake', action: 'reddit-web-search', model: MODEL, response, clientId }); } catch { /* best-effort */ }

  const parsed = extractJson(response);
  const cost = extractCost(response);
  if (!parsed) {
    return { ok: false, report: null, cost, error: 'No JSON block found in web_search response.' };
  }

  const mentions = Array.isArray(parsed.mentions) ? parsed.mentions.slice(0, 5) : [];
  const participationOpportunities = Array.isArray(parsed.participationOpportunities)
    ? parsed.participationOpportunities.slice(0, 8)
    : [];

  const report = {
    clientId,
    provider:                        'web-search',
    status:                          'connected',
    fetchedAt:                       new Date().toISOString(),
    mentionCount:                    mentions.length,
    newMentionCount:                 mentions.length, // no prior-run comparison for this fetcher
    participationOpportunityCount:   participationOpportunities.length,
    newParticipationOpportunityCount: participationOpportunities.length,
    mentions,
    participationOpportunities,
    subreddits: redditConfig.subreddits || [],
  };

  return { ok: true, report, cost: Math.round(cost * 10000) / 10000 };
}

module.exports = { runRedditWebSearch };
