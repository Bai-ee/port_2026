'use strict';

// scout-test.js — Isolated, single-source search tester. Runs ONE platform's
// live search on demand and returns sample results WITHOUT running the full
// Scout → Scribe brief. It drives off the SAME runtime config and search plan
// the real brief uses (buildRuntimeConfigFromFirestore), so a test reflects
// what the pipeline would actually search. Nothing is cached to Firestore.

const { callAnthropic, extractAnthropicCostUsd } = require('./_anthropic-client');
const { runRedditSerpSearch } = require('./external-scouts/reddit-serp-search');
const { buildRuntimeConfigFromFirestore } = require('../not-the-rug-brief/config-loader');
const { fetchLast30Days } = require('../not-the-rug-brief/services/last30days');
const { normalizeSignals } = require('../not-the-rug-brief/normalize-last30days');

const MODEL = 'claude-sonnet-4-5-20250929';
const MAX_TOKENS = 4000; // generous so the JSON array isn't truncated mid-item

// Per-platform site: queries the search plan emits. Used to route the web test
// to the general (non platform-site-restricted) rows only.
const PLATFORM_SITE_HOSTS = /site:(reddit\.com|news\.ycombinator\.com|youtube\.com|x\.com|twitter\.com|instagram\.com|tiktok\.com)/i;

function extractJsonArray(response) {
  if (!Array.isArray(response?.content)) return null;
  let text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  text = text.replace(/```json|```/gi, '');
  const start = text.indexOf('[');
  if (start === -1) return null;
  const slice = text.slice(start);
  const tryParse = (s) => { try { return JSON.parse(s); } catch { return null; } };

  // Direct parse (well-formed array).
  let arr = tryParse(slice);
  if (Array.isArray(arr)) return arr;

  // Salvage a truncated array (response cut off by max_tokens): keep through the
  // last complete object and close the bracket.
  const lastObj = slice.lastIndexOf('}');
  if (lastObj !== -1) {
    arr = tryParse(slice.slice(0, lastObj + 1) + ']');
    if (Array.isArray(arr)) return arr;
  }
  return null;
}

function buildPlanPrompt({ rows, scopeNote, extraClause }) {
  const lines = rows.map((r, i) => `${i + 1}. ${r.label ? `[${r.label}] ` : ''}${r.query}${r.goal ? ` — ${r.goal}` : ''}`).join('\n');
  return `Run these Scout searches using web_search${scopeNote ? ` (${scopeNote})` : ''}:
${lines}
${extraClause || ''}
Always run the searches with web_search before answering. If a query is unusable, skip it and run the others — never ask for clarification.

Return at most 8 results total, each with a concise one-line summary.
Return ONLY a JSON array, no markdown, no commentary:
[{ "title": "...", "url": "https://...", "summary": "one sentence" }]

Rules:
- Real URLs only — no fabricated links.
- Include the brand's own site/profiles and any directly related results. Only omit a result when it is clearly a different entity that happens to share the name.
- Prefer recent results, but include relevant older ones rather than returning nothing.
- Return an empty array only if every result is clearly unrelated.`;
}

async function runWebSearchTest({ prompt }) {
  let response;
  try {
    response = await callAnthropic({
      model:      MODEL,
      max_tokens: MAX_TOKENS,
      messages:   [{ role: 'user', content: prompt }],
      tools:      [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    });
  } catch (err) {
    return { ok: false, items: [], cost: 0, error: err.message };
  }

  // TEMP DEBUG — remove after diagnosing empty results.
  try {
    const blockTypes = (response.content || []).map((b) => b.type);
    const textJoined = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    console.log('[scout-test] web_search blocks:', JSON.stringify(blockTypes));
    console.log('[scout-test] web_search text:', textJoined.slice(0, 1200));
  } catch { /* ignore */ }

  const arr = extractJsonArray(response);
  const cost = extractAnthropicCostUsd(response, { inputRate: 0.000003, outputRate: 0.000015 });
  if (!arr) return { ok: false, items: [], cost, error: 'No JSON array found in web_search response.' };

  const items = arr.slice(0, 10)
    .map((it) => ({ title: String(it.title || ''), url: String(it.url || ''), summary: String(it.summary || '') }))
    .filter((it) => it.title && it.url);

  console.log('[scout-test] parsed array len:', arr.length, 'kept items:', items.length); // TEMP DEBUG
  return { ok: true, items, cost: Math.round(cost * 10000) / 10000 };
}

/**
 * Run a single-source test search using the client's established search plan.
 *
 * @param {object} input
 * @param {string} input.clientId
 * @param {'web'|'x'|'reddit'} input.platform
 * @param {object} input.clientConfig  full client_configs doc (marketingBriefConfig + scoutConfig)
 * @returns {Promise<{ ok, platform, items, count, costUsd, ms, error }>}
 */
async function runScoutTest({ clientId, platform, clientConfig = {} }) {
  const t0 = Date.now();

  // Build the same runtime config the brief uses — gives us scout.searchPlan,
  // brandKeywords, kols, and the reddit block, all from the strategy cards.
  let cfg;
  try {
    cfg = buildRuntimeConfigFromFirestore(clientId, clientConfig || {});
  } catch (err) {
    return { ok: false, platform, items: [], count: 0, costUsd: 0, ms: Date.now() - t0, error: `config build failed: ${err.message}` };
  }

  const companyName = cfg.clientName || clientId;
  // A query is usable if it has at least 2 alphanumeric chars (drops junk rows
  // like a bare "@" from an empty watchlist handle, which derails the search).
  const isUsableQuery = (q) => String(q || '').replace(/[^a-z0-9]/gi, '').length >= 2;
  const plan = Array.isArray(cfg.scout?.searchPlan)
    ? cfg.scout.searchPlan.filter((r) => r && isUsableQuery(r.query))
    : [];

  // TEMP DEBUG — remove after diagnosing empty results.
  console.log(`[scout-test] platform=${platform} client=${clientId} company="${companyName}" planRows=${plan.length}`);
  console.log('[scout-test] plan:', JSON.stringify(plan.map((r) => ({ label: r.label, query: r.query }))));

  let result;
  if (platform === 'reddit') {
    // Established reddit path: site:reddit.com via the config-loader reddit block
    // (subreddits + mention/opportunity queries). Fall back to the company name
    // so a sparse config still searches.
    const baseReddit = cfg.reddit || clientConfig?.scoutConfig?.reddit || {};
    const fallbackMentions = [companyName, ...(cfg.brandKeywords || [])].filter(Boolean).slice(0, 5);
    // When there are no direct brand mentions on Reddit (common for newer/niche
    // brands), category + competitor terms surface relevant community threads
    // and buyer language the brand could participate in.
    const fallbackOpps = [...(cfg.categoryTerms || []), ...(cfg.competitors || [])].filter(Boolean).slice(0, 4);
    const redditConfig = {
      ...baseReddit,
      subreddits:         Array.isArray(baseReddit.subreddits) ? baseReddit.subreddits : [],
      mentionQueries:     (Array.isArray(baseReddit.mentionQueries) && baseReddit.mentionQueries.length) ? baseReddit.mentionQueries : fallbackMentions,
      opportunityQueries: (Array.isArray(baseReddit.opportunityQueries) && baseReddit.opportunityQueries.length) ? baseReddit.opportunityQueries : fallbackOpps,
    };
    console.log('[scout-test] reddit cfg:', JSON.stringify({ subreddits: redditConfig.subreddits, mentionQueries: redditConfig.mentionQueries, opportunityQueries: redditConfig.opportunityQueries })); // TEMP DEBUG
    const r = await runRedditSerpSearch({ clientId, redditConfig });
    console.log('[scout-test] reddit result:', JSON.stringify({ ok: r.ok, error: r.error, mentions: r.report?.mentionCount, opps: r.report?.participationOpportunityCount })); // TEMP DEBUG
    const items = (r.ok && r.report) ? [
      ...(r.report.mentions || []).map((m) => ({ title: m.title, url: m.url || m.permalink || '', summary: m.summary || m.insight || '', tag: m.subreddit || 'mention' })),
      ...(r.report.participationOpportunities || []).map((o) => ({ title: o.title, url: o.url || o.permalink || '', summary: o.summary || o.whyRelevant || '', tag: o.subreddit || 'opportunity' })),
    ].filter((it) => it.title) : [];
    result = { ok: r.ok, items, cost: r.cost || 0, error: r.error, meta: { ...(r.meta || {}), queriesTried: redditConfig.mentionQueries.concat(redditConfig.opportunityQueries) } };
  } else if (platform === 'x') {
    // Established X access = the last30days pipeline (real API/cookies) — the
    // SAME path the brief uses (e.g. Fast Poker), not web_search. Run it scoped
    // to X only and surface the normalized X signals.
    const l30 = (cfg.last30days && cfg.last30days.enabled) ? cfg.last30days : {};
    const x30Config = {
      clientId,
      clientName: companyName,
      last30days: {
        ...l30,
        enabled:         true,
        sources:         'x',
        primaryTopic:    l30.primaryTopic || [companyName, ...(cfg.competitors || [])].filter(Boolean).join(' '),
        lookbackDays:    l30.lookbackDays || cfg.scout?.freshnessDays || 7,
        brandTerms:      l30.brandTerms || (cfg.brandKeywords || []),
        competitorNames: l30.competitorNames || (cfg.competitors || []),
      },
    };
    const service = await fetchLast30Days(x30Config);
    const xMeta = { source: 'last30days (X)', status: service?.status || null, lookbackDays: x30Config.last30days.lookbackDays, topic: x30Config.last30days.primaryTopic };
    if (!service || service.status === 'error' || service.status === 'empty') {
      result = { ok: false, items: [], cost: 0, error: service?.error || 'last30days returned no X data.', meta: xMeta };
    } else {
      const items = normalizeSignals(service, x30Config)
        .filter((s) => /^(x|twitter)$/i.test(s.platform))
        .slice(0, 10)
        .map((s) => ({ title: s.title, url: s.url, summary: s.body || '', tag: s.author || s.container || 'x' }))
        .filter((it) => it.title);
      result = { ok: true, items, cost: 0, meta: { ...xMeta, note: items.length === 0 ? 'last30days ran but returned no X items for this topic/window.' : undefined } };
    }
  } else {
    // web (default): the general (non platform-site-restricted) plan rows —
    // brand, category, custom searches, and named watchlist accounts.
    let rows = plan.filter((r) => !PLATFORM_SITE_HOSTS.test(r.query));
    if (!rows.length) rows = [{ label: 'BRAND', query: [`"${companyName}"`, cfg.websiteUrl ? `site:${cfg.websiteUrl}` : null].filter(Boolean).join(' OR '), goal: 'Find recent web coverage of the brand.' }];
    result = await runWebSearchTest({ prompt: buildPlanPrompt({ rows: rows.slice(0, 6), scopeNote: 'general web — news, blogs, launches, indexed coverage' }) });
    result.meta = { source: 'Claude web_search (general web)', terms: rows.slice(0, 6).map((r) => r.query) };
  }

  return {
    ok:       Boolean(result.ok),
    platform,
    items:    result.items || [],
    count:    (result.items || []).length,
    costUsd:  result.cost || 0,
    ms:       Date.now() - t0,
    error:    result.error || null,
    meta:     result.meta || null,
  };
}

module.exports = { runScoutTest };
