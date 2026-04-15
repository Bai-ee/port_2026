'use strict';

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

function getApiKey() {
  const key = process.env.ANTHROPIC_API_KEY || (() => {
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
      'content-type':      'application/json',
      'x-api-key':         getApiKey(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

function buildPrompt({ redditConfig }) {
  const subs = (redditConfig.subreddits || []).join(', r/');
  const mentionQ = (redditConfig.mentionQueries || []).join(' | ');
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
  const u = response.usage || {};
  const inputTokens  = u.input_tokens  || 0;
  const outputTokens = u.output_tokens || 0;
  // Sonnet 4.5 pricing
  return (inputTokens * 0.000003) + (outputTokens * 0.000015);
}

/**
 * Run a Reddit scout using web_search. Returns a report matching the shape
 * of the OAuth-native `fetchRedditSignals`.
 */
async function runRedditWebSearch({ clientId, redditConfig }) {
  if (!redditConfig || !Array.isArray(redditConfig.subreddits) || redditConfig.subreddits.length === 0) {
    return { ok: false, report: null, cost: 0, error: 'no subreddits configured' };
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
