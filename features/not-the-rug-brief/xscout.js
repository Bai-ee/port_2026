// xscout.js — X/Twitter intelligence module (OPTIMIZED)
//
// COST OPTIMIZATION (Mar 2026):
//   Before: ~$0.43/run — raw search results dumped into 115K Sonnet context
//   After:  ~$0.10/run — Haiku trims search results first, Sonnet sees ~8K tokens
//   Method: two-stage pipeline via optimizer.js
//
// PIPELINE:
//   Stage 1 (Sonnet + web_search): Execute 5 searches, collect raw results
//   Stage 2 (Haiku): Trim each result to signal only (~800 tokens each)
//   Stage 3 (Sonnet): Write brief from compact ~5K context

require('./load-env');
const { getProvider } = require('./providers');
const { randomUUID } = require('crypto');
const { saveLatestBrief, saveLatestWeather, saveLatestReviews, saveLatestInstagram, saveLatestReddit, getLatestBrief, getLatestWeather, getLatestReviews, getLatestInstagram, getLatestReddit, saveLatestLast30Days, getLatestLast30Days, logError } = require('./store');
const { MODELS, trimAllSearchResults, buildCompactContext, logCostEstimate, computeStageCost } = require('./optimizer');
const { getDefaultClientConfig, requireClientConfig } = require('./clients');
const { loadBrandVoice, loadBriefContext } = require('./knowledge');
const { fetchOperationalWeather, buildWeatherContextBlock } = require('./services/weather');
const { fetchReviewStatusViaWebSearch, buildReviewContextBlock } = require('./services/reviews');
const { fetchInstagramInsights, buildInstagramContextBlock } = require('./services/instagram');
const { fetchRedditSignals, buildRedditContextBlock } = require('./services/reddit');
const { fetchLast30Days } = require('./services/last30days');
const { normalizeSignals, mapToScoutFields, buildLast30DaysContextBlock, summarizeLast30DaysResult } = require('./normalize-last30days');

function getAnthropicClient() {
  return getProvider();
}

const DEFAULT_CONFIG = getDefaultClientConfig();

function getWeatherSourceUrl(weatherReport = null) {
  const firstNeighborhood = weatherReport?.neighborhoods?.[0];
  return firstNeighborhood?.sourceUrls?.forecastHourly
    || firstNeighborhood?.sourceUrls?.points
    || '';
}

function formatHourLabel(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  const normalized = ((value % 24) + 24) % 24;
  const suffix = normalized >= 12 ? 'PM' : 'AM';
  const hour12 = normalized % 12 || 12;
  return `${hour12}:00 ${suffix}`;
}

function buildWeatherAgentData(weatherReport = null) {
  if (!weatherReport?.overall) return null;
  const primaryNeighborhood = Array.isArray(weatherReport?.neighborhoods) ? weatherReport.neighborhoods[0] : null;
  const primaryPeriods = Array.isArray(primaryNeighborhood?.periods) ? primaryNeighborhood.periods : [];
  const conditionLabels = [...new Set(
    primaryPeriods
      .map((period) => period?.shortForecast)
      .filter(Boolean)
  )].slice(0, 2);
  const location = primaryNeighborhood?.name || '';
  const window = weatherReport?.operationalWindow || null;
  const timeSpan = window
    ? [formatHourLabel(window.startHour), formatHourLabel(window.endHour)].filter(Boolean).join('–')
    : '';
  const prefixParts = [location, timeSpan, conditionLabels.join(', ')].filter(Boolean);
  return {
    summary: `${prefixParts.join(' · ')}${prefixParts.length ? ' · ' : ''}${weatherReport.overall.summary || ''}`.trim(),
    operationalTakeaway: weatherReport.overall.operationalTakeaway || '',
    source: weatherReport.provider || 'nws',
    url: getWeatherSourceUrl(weatherReport),
  };
}

function buildRedditSignalFromMention(item = {}) {
  return {
    title: item.title || item.author || 'Reddit mention',
    subreddit: item.subreddit || '',
    signalType: 'brand_mention',
    summary: item.insight || item.excerpt || item.body || '',
    actionableTakeaway: item.whyRelevant || 'Recent Reddit mention relevant to neighborhood dog-owner trust or demand language.',
    url: item.permalink || item.url || '',
  };
}

function buildRedditSignalFromOpportunity(item = {}) {
  return {
    title: item.title || 'Recommendation thread',
    subreddit: item.subreddit || '',
    signalType: item.opportunityType || 'participation_opportunity',
    summary: item.excerpt || item.body || '',
    actionableTakeaway: item.whyRelevant || 'Relevant neighborhood thread that may surface buyer language or participation opportunities.',
    url: item.permalink || item.url || '',
  };
}

function extractRedditSignalsFromSearchText(searchText = '') {
  if (!searchText || typeof searchText !== 'string') return [];

  const lines = searchText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const signals = [];
  const seenUrls = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/reddit\.com\/r\//i.test(line)) continue;

    const urlMatch = line.match(/https?:\/\/(?:www\.)?reddit\.com\/r\/[^\s)]+/i);
    if (!urlMatch) continue;

    const url = urlMatch[0];
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);

    const subredditMatch = url.match(/reddit\.com\/r\/([^/]+)/i);
    const subreddit = subredditMatch ? `r/${subredditMatch[1]}` : '';

    const titleLine = line.replace(url, '').replace(/\s+/g, ' ').trim();
    const previousLine = index > 0 ? lines[index - 1] : '';
    const nextLine = index + 1 < lines.length ? lines[index + 1] : '';
    const title = titleLine || previousLine || nextLine || 'Reddit signal';
    const summary = [titleLine, nextLine]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    const haystack = `${title} ${summary}`.toLowerCase();
    let signalType = 'participation_opportunity';
    if (/\bnot the rug\b|\bnottherug\b/.test(haystack)) {
      signalType = 'brand_mention';
    } else if (/\brecommend|recs|looking for|anyone know|need a\b/.test(haystack)) {
      signalType = 'recommendation_thread';
    } else if (/\brover\b|\bwag\b|\btrust\b|\breliable\b|\bprice\b|\bcost\b|\bexpensive\b/.test(haystack)) {
      signalType = 'pain_point';
    }

    signals.push({
      title,
      subreddit,
      signalType,
      summary: summary || title,
      actionableTakeaway: 'Scout web search surfaced a Reddit thread with buyer language or neighborhood demand worth carrying into the brief.',
      url,
    });
  }

  return signals.slice(0, 5);
}

function collectRedditSignalsFromSearchResults(searchResults = [], compactContext = '') {
  const rawSignals = Array.isArray(searchResults)
    ? searchResults.flatMap((result) => extractRedditSignalsFromSearchText(result?.rawText || ''))
    : [];

  const fallbackSignals = rawSignals.length > 0
    ? rawSignals
    : extractRedditSignalsFromSearchText(compactContext);

  const uniqueSignals = [];
  const seenUrls = new Set();

  for (const item of fallbackSignals) {
    if (!item?.url || seenUrls.has(item.url)) continue;
    seenUrls.add(item.url);
    uniqueSignals.push(item);
    if (uniqueSignals.length >= 5) break;
  }

  return uniqueSignals;
}

function hydrateAgentData(agentData = {}, weatherReport = null, redditReport = null, searchResults = [], compactContext = '', last30daysMapped = null) {
  const next = agentData && typeof agentData === 'object' ? { ...agentData } : {};

  if (weatherReport?.overall) {
    const canonicalWeather = buildWeatherAgentData(weatherReport);
    const existingWeather = next.weatherImpact && typeof next.weatherImpact === 'object' && !Array.isArray(next.weatherImpact)
      ? next.weatherImpact
      : null;

    next.weatherImpact = {
      ...(existingWeather || {}),
      ...canonicalWeather,
      operationalTakeaway: existingWeather?.operationalTakeaway || canonicalWeather.operationalTakeaway,
    };
  }

  const explicitRedditSignals = Array.isArray(next.redditSignals) ? next.redditSignals : [];
  if (explicitRedditSignals.length === 0) {
    const reportSignals = [
      ...((redditReport?.mentions || []).slice(0, 3).map(buildRedditSignalFromMention)),
      ...((redditReport?.participationOpportunities || []).slice(0, 3).map(buildRedditSignalFromOpportunity)),
    ];

    if (reportSignals.length > 0) {
      next.redditSignals = reportSignals.slice(0, 5);
    } else {
      const brandMentionFallback = Array.isArray(next.brandMentions)
        ? next.brandMentions
            .filter((item) => /reddit/i.test(`${item?.source || ''} ${item?.url || ''}`))
            .slice(0, 5)
            .map((item) => ({
              title: item.author || item.source || 'Reddit mention',
              subreddit: item.source || 'Reddit',
              signalType: 'brand_mention',
              summary: item.content || item.finding || '',
              actionableTakeaway: 'Search surfaced a Reddit mention worth tracking in the brief.',
              url: item.url || '',
            }))
        : [];

      const searchFallback = collectRedditSignalsFromSearchResults(searchResults, compactContext);
      next.redditSignals = searchFallback.length > 0 ? searchFallback : brandMentionFallback;
    }
  }

  if (last30daysMapped) {
    // Merge last30days signals into agentData non-destructively.
    // Items are deduplicated by URL so Scout's own synthesis is never displaced.
    // Novel items (not already present by URL) are appended up to per-field caps.

    if (Array.isArray(last30daysMapped.redditSignals) && last30daysMapped.redditSignals.length > 0) {
      const existing = Array.isArray(next.redditSignals) ? next.redditSignals : [];
      const existingUrls = new Set(existing.map((s) => s.url).filter(Boolean));
      const novel = last30daysMapped.redditSignals.filter((s) => !existingUrls.has(s.url));
      if (existing.length === 0) next.redditSignals = novel.slice(0, 5);
      else next.redditSignals = [...existing, ...novel].slice(0, 8);
    }

    if (Array.isArray(last30daysMapped.brandMentions) && last30daysMapped.brandMentions.length > 0) {
      const existing = Array.isArray(next.brandMentions) ? next.brandMentions : [];
      const existingUrls = new Set(existing.map((s) => s.url).filter(Boolean));
      const novel = last30daysMapped.brandMentions.filter((s) => !existingUrls.has(s.url));
      if (novel.length > 0) next.brandMentions = [...existing, ...novel].slice(0, 10);
    }

    if (Array.isArray(last30daysMapped.competitorIntel) && last30daysMapped.competitorIntel.length > 0) {
      const existing = Array.isArray(next.competitorIntel) ? next.competitorIntel : [];
      const existingUrls = new Set(existing.map((s) => s.url).filter(Boolean));
      const novel = last30daysMapped.competitorIntel.filter((s) => !existingUrls.has(s.url));
      if (novel.length > 0) next.competitorIntel = [...existing, ...novel].slice(0, 8);
    }

    if (Array.isArray(last30daysMapped.contentOpportunities) && last30daysMapped.contentOpportunities.length > 0) {
      const existing = Array.isArray(next.contentOpportunities) ? next.contentOpportunities : [];
      const existingUrls = new Set(existing.map((s) => s.url).filter(Boolean));
      const novel = last30daysMapped.contentOpportunities.filter((s) => !existingUrls.has(s.url));
      if (novel.length > 0) next.contentOpportunities = [...existing, ...novel].slice(0, 6);
    }

    if (Array.isArray(last30daysMapped.localDemandSignals) && last30daysMapped.localDemandSignals.length > 0) {
      const existing = Array.isArray(next.localDemandSignals) ? next.localDemandSignals : [];
      const existingUrls = new Set(existing.map((s) => s.url).filter(Boolean));
      const novel = last30daysMapped.localDemandSignals.filter((s) => !existingUrls.has(s.url));
      if (novel.length > 0) next.localDemandSignals = [...existing, ...novel].slice(0, 6);
    }
  }

  return next;
}

function buildFallbackSearchPlan(config) {
  return [
    {
      label: 'BRAND',
      query: config.brandKeywords.join(' OR '),
      goal: 'Find direct brand mentions and official updates.',
    },
    {
      label: 'COMPETITORS',
      query: config.competitors.join(' OR '),
      goal: 'Find competitive moves and sentiment shifts.',
    },
    {
      label: 'CATEGORY',
      query: config.categoryTerms.slice(0, 4).join(' OR '),
      goal: 'Capture broader category movement.',
    },
    {
      label: 'KOLS',
      query: [config.kols.join(' OR '), config.scout?.kolSearchSuffix || ''].filter(Boolean).join(' '),
      goal: 'Find creator or influencer activity relevant to the brand.',
    },
    {
      label: 'VIRAL WINDOWS',
      query: (config.viralTargets?.viralTriggers || []).slice(0, 4).join(' OR '),
      goal: 'Find live conversations the brand can enter credibly.',
    },
  ];
}

function getResolvedSearchPlan(config) {
  return (config.scout?.searchPlan || []).length > 0
    ? config.scout.searchPlan
    : buildFallbackSearchPlan(config);
}

function buildStructuredContextBlock(config) {
  const briefContext = loadBriefContext(config.clientId);
  if (!briefContext) return '';

  const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');
  const monthThemes = briefContext.seasonal_content_calendar?.[currentMonth] || [];
  const platformChecks = briefContext.competitor_monitoring?.platform_competitors?.check_daily || [];
  const regionalChecks = briefContext.competitor_monitoring?.regional_competitors?.check_daily || [];
  const signalsThatMatter = briefContext.competitor_monitoring?.signals_that_matter || [];
  const localContext = briefContext.local_context || {};
  const benchmarks = briefContext.social_proof_benchmarks?.not_the_rug || {};

  return `STRUCTURED CONTEXT:
Current-month themes:
${monthThemes.map((item) => `- ${item}`).join('\n') || '- none'}

Competitor monitoring checklist:
- Platform competitors: ${(briefContext.competitor_monitoring?.platform_competitors?.names || []).join(', ') || 'none listed'}
${platformChecks.map((item) => `  - ${item}`).join('\n') || '  - none'}
- Regional competitors: ${(briefContext.competitor_monitoring?.regional_competitors?.names || []).join(', ') || 'none listed'}
${regionalChecks.map((item) => `  - ${item}`).join('\n') || '  - none'}
- Signals that matter:
${signalsThatMatter.map((item) => `  - ${item}`).join('\n') || '  - none'}

Local context:
- Dog parks and routes: ${(localContext.dog_parks_and_routes || []).join(', ') || 'none listed'}
- Route disruptors: ${(localContext.route_disruptors || []).join(', ') || 'none listed'}
- Weather patterns: ${(localContext.weather_patterns || []).join(', ') || 'none listed'}
- Referral ecosystem: ${(localContext.referral_ecosystem || []).join(', ') || 'none listed'}

Benchmarks (reference only, not current unless re-sourced):
- Instagram followers: ${benchmarks.instagram_followers ?? 'unknown'}
- Instagram posts: ${benchmarks.instagram_posts ?? 'unknown'}
- Yelp reviews: ${benchmarks.yelp_reviews ?? 'unknown'}
- Google rating: ${benchmarks.google_rating ?? 'unknown'}`;
}

// ─── STAGE 1: Search execution ──────────────────────────────────────────────
//
// We use a MINIMAL prompt here — just enough for Claude to run the 5 searches
// and return structured raw results. No analysis, no brief writing.
// This keeps Stage 1 output tokens low.

function buildSearchPrompt(config, weatherReport = null, reviewReport = null, instagramReport = null, redditReport = null, last30daysContextBlock = '') {
  const freshnessDays = config.scout?.freshnessDays || 1;
  const searchPlan = getResolvedSearchPlan(config);
  const eventsContext = (config.upcomingEvents || [])
    .map((e) => `- ${e.event} on ${e.date} (${e.daysOut} days away)`)
    .join('\n');
  const sourceFocus = config.scout?.sourceFocus || 'Focus on recent web and social content relevant to the client.';
  const analysisInstructions = config.scout?.analysisInstructions || 'Prioritize live signal and clear actionability.';
  const preferredSources = (config.scout?.preferredSources || []).join(', ') || 'current web and social sources';
  const deprioritizedSources = (config.scout?.deprioritizedSources || []).join(', ');
  const structuredContextBlock = buildStructuredContextBlock(config);
  const weatherContextBlock = buildWeatherContextBlock(weatherReport);
  const reviewContextBlock = buildReviewContextBlock(reviewReport);
  const instagramContextBlock = buildInstagramContextBlock(instagramReport);
  const redditContextBlock = buildRedditContextBlock(redditReport);

  const searchLines = searchPlan.map((item, index) => `SEARCH ${index + 1} — ${item.label}: ${item.query}`).join('\n');
  const goalLines = searchPlan.map((item, index) => `${index + 1}. ${item.label} — ${item.goal}`).join('\n');

  return `You are a search agent gathering marketing intelligence for ${config.clientName}. Execute exactly ${searchPlan.length} web searches in sequence and return the raw results.
Do NOT analyze, summarize, or write a brief. Just run the searches and output results.

${searchLines}

For each search, output:
=== SEARCH [N]: [label] ===
[raw results here]

${sourceFocus}
${analysisInstructions}
Preferred sources: ${preferredSources}
${deprioritizedSources ? `Deprioritize or ignore these unless there is no better source: ${deprioritizedSources}` : ''}
${weatherContextBlock ? `${weatherContextBlock}\nUse this live NWS data as the canonical weather source for the day. Do not spend search effort rediscovering basic forecast conditions.\n` : ''}
${reviewContextBlock ? `${reviewContextBlock}\nUse this as the canonical source for Not The Rug's Google Business Profile review changes. Do not spend search effort rediscovering owned Google reviews.\n` : ''}
${instagramContextBlock ? `${instagramContextBlock}\nUse this as the canonical source for current Instagram follower and engagement changes. Do not spend search effort rediscovering owned Instagram metrics.\n` : ''}
${redditContextBlock ? `${redditContextBlock}\nUse this as the canonical Reddit source for brand mentions and participation opportunities. Do not spend search effort rediscovering the same Reddit threads unless you need corroboration.\n` : ''}
${last30daysContextBlock ? `${last30daysContextBlock}\nUse this as a supplemental social intelligence source. Let it inform search priorities and surface gaps the standard searches might miss.\n` : ''}
If Reddit is one of the preferred sources, prioritize recent subreddit recommendation threads, complaint threads, and direct brand mentions that reveal actual buyer language or participation windows. Ignore stale or low-signal Reddit threads.
Search goals:
${goalLines}
${structuredContextBlock ? `\n${structuredContextBlock}` : ''}
Prioritize content from the last ${freshnessDays} day(s). Today: ${new Date().toISOString().split('T')[0]}
Upcoming events for context: ${eventsContext || 'none'}`;
}

// ─── STAGE 3: Brief synthesis ────────────────────────────────────────────────
//
// Sonnet sees ONLY the trimmed context (~5K tokens) + previous brief summary.
// This is where all the quality reasoning happens.

function buildBriefPrompt(config, compactContext, previousBrief, weatherReport = null, reviewReport = null, instagramReport = null, redditReport = null, last30daysContextBlock = '') {
  const brandVoice = loadBrandVoice(config.clientId);
  const dailyBriefVoice = brandVoice?.daily_brief_voice || null;
  const structuredContextBlock = buildStructuredContextBlock(config);
  const weatherContextBlock = buildWeatherContextBlock(weatherReport);
  const reviewContextBlock = buildReviewContextBlock(reviewReport);
  const instagramContextBlock = buildInstagramContextBlock(instagramReport);
  const redditContextBlock = buildRedditContextBlock(redditReport);
  const prevSummary = previousBrief
    ? `PREVIOUS BRIEF (${previousBrief.timestamp}):\n${previousBrief.humanBrief || 'None'}`
    : 'No previous brief — this is the first run. Treat everything as NEW.';
  const preferredSources = (config.scout?.preferredSources || []).join(', ');
  const deprioritizedSources = (config.scout?.deprioritizedSources || []).join(', ');
  const agentDataTemplate = config.scout?.agentDataTemplate || `{
  "brandMentions": [{"source":"...","author":"...","content":"...","sentiment":"positive|neutral|negative","reach":"high|medium|low","url":"..."}],
  "competitorIntel": [{"competitor":"...","finding":"...","impact":"high|medium|low","url":"..."}],
  "categoryTrends": [{"trend":"...","relevance":"high|medium|low","detail":"..."}],
  "kolActivity": [{"name":"...","platform":"x","content":"...","followers":"...","sentiment":"...","url":"..."}],
  "escalations": [{"level":"CRITICAL|IMPORTANT|QUIET","status":"NEW|CHANGED|ESCALATED|RESOLVED","summary":"..."}],
  "viralOpportunities": {
    "found": true,
    "opportunities": [{"conversation":"...","url":"...","injectionAngle":"...","authenticity":"high|medium|low","windowHours":0,"suggestedReply":"..."}],
    "searchedFor": ["trigger 1","trigger 2"]
  }
}`;

  const eventsContext = (config.upcomingEvents || [])
    .map((e) => `- ${e.event} on ${e.date} (${e.daysOut} days away)`)
    .join('\n');
  const briefVoiceBlock = dailyBriefVoice
    ? `DAILY BRIEF VOICE:
${dailyBriefVoice.role}

SECTION TONE GUIDANCE:
- Weather / operational impact: ${dailyBriefVoice.sections_tone?.weather_impact || 'Lead with the operational takeaway.'}
- Competitor watch: ${dailyBriefVoice.sections_tone?.competitor_watch || 'Neutral observation first, implication second.'}
- Holidays and events: ${dailyBriefVoice.sections_tone?.holidays_and_events || 'Flag the opportunity clearly and make it actionable.'}
- Influencer or trend watch: ${dailyBriefVoice.sections_tone?.influencer_trends || 'Only surface trends that matter to the brand.'}
- Suggested posts / opportunities: ${dailyBriefVoice.sections_tone?.suggested_posts || 'Keep recommendations concrete and strategically useful.'}`
    : '';

  return `IDENTITY:
You are Scout, AI intelligence agent for ${config.clientName}${config.clientDescriptor ? `, ${config.clientDescriptor}` : ''}. You analyze pre-processed
search intelligence and write actionable marketing briefs. Be concise. Prioritize signal.
${briefVoiceBlock ? `\n\n${briefVoiceBlock}` : ''}

${prevSummary}

UPCOMING EVENTS:
${eventsContext || 'None within 30 days'}

SEARCH INTELLIGENCE (pre-processed):
${compactContext}
${weatherContextBlock ? `\n${weatherContextBlock}` : ''}
${reviewContextBlock ? `\n${reviewContextBlock}` : ''}
${instagramContextBlock ? `\n${instagramContextBlock}` : ''}
${redditContextBlock ? `\n${redditContextBlock}` : ''}
${last30daysContextBlock ? `\n${last30daysContextBlock}` : ''}
${structuredContextBlock ? `\n${structuredContextBlock}` : ''}

EXCLUSIONS — never surface content about: ${(config.viralTargets?.exclusions || []).join(', ')}
${preferredSources ? `PREFERRED SOURCE WEIGHTING: prioritize signal from ${preferredSources}.` : ''}
${deprioritizedSources ? `DEPRIORITIZE: ${deprioritizedSources} unless corroborated or uniquely important.` : ''}

REASONING (required):
Before writing output, think through:
- What is NEW vs already in the previous brief?
- What requires immediate action vs routine monitoring?
- Are there patterns across multiple search domains?
- Label each finding [LIVE] (posted <48hrs, actively moving) or [BACKGROUND] (reports/articles)
- Which findings actually affect buyer trust, demand, or content opportunities?
- If LIVE NWS WEATHER is provided, ALWAYS populate weatherImpact from it. Summarize the operating window clearly even if the takeaway is "manageable" rather than dramatic. Do not leave weatherImpact null when live NWS data exists.
- If LIVE GOOGLE BUSINESS PROFILE REVIEWS is provided, use it as the primary source for new or updated Not The Rug Google reviews and translate notable review changes into reviewInsights when relevant.
- If LIVE INSTAGRAM INSIGHTS is provided, use it as the primary source for follower-count changes and recent like/comment activity. If there is nothing notable, do not force an Instagram note.
- If LIVE REDDIT SIGNALS is provided, use it as the primary source for Reddit brand mentions, recommendation threads, and participation opportunities, and populate redditSignals from it when any such signal exists.
- If Reddit only appears through web search, still treat recent Reddit recommendation threads and brand mentions as valid signal. Populate redditSignals with up to 3 concrete Reddit items when search results clearly surface them.
- If LAST 30 DAYS SOCIAL INTELLIGENCE is provided, treat it as a verified supplemental source. Use signals from it to enrich contentOpportunities, localDemandSignals, competitorIntel, or redditSignals when the agentData fields would otherwise be thin.

VISIBILITY GAP RULE:
If brandMentions is empty AND upcoming event within 30 days → escalate to IMPORTANT.
PRIORITY ACTION must be a specific content recommendation, not "monitor" or "investigate".

OUTPUT — three sections, in order:

=== DELTA ===
What changed since last brief. Format: [CRITICAL|IMPORTANT|QUIET] [NEW|CHANGED|ESCALATED|RESOLVED] — description

=== HUMAN BRIEF ===
HARD LIMIT: 150 words max. Plain language. Last line MUST be:
PRIORITY ACTION: <single sentence starting with action verb>

=== AGENT DATA ===
Valid JSON only (no markdown fences):
${agentDataTemplate}`;
}

// ─── Search result extraction ─────────────────────────────────────────────────

/**
 * Pull raw search results from Stage 1's response.
 * Looks for === SEARCH N: label === markers in the text output.
 */
function extractSearchResults(responseContent) {
  const results = [];

  // Collect all text blocks from the response
  const allText = responseContent
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  // Also extract tool results from web_search calls
  const toolResults = responseContent.filter((b) => b.type === 'tool_result');

  if (toolResults.length > 0) {
    // Claude returned structured tool results — extract from those
    // Tool use blocks come in pairs: tool_use (query) + tool_result (response)
    const toolUseBlocks = responseContent.filter((b) => b.type === 'tool_use');

    toolUseBlocks.forEach((toolUse, i) => {
      const query = toolUse.input?.query || `search_${i + 1}`;
      const resultBlock = toolResults[i];
      const rawText = Array.isArray(resultBlock?.content)
        ? resultBlock.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
        : String(resultBlock?.content || '');

      if (rawText) {
        results.push({ query, rawText });
      }
    });
  }

  // Fallback: parse from text output if no tool_result blocks
  if (results.length === 0 && allText) {
    const sections = allText.split(/===\s*SEARCH\s*\d+[:\s]/i).filter(Boolean);
    sections.forEach((section, i) => {
      const labelMatch = section.match(/^([^\n]+)\n/);
      const query = labelMatch ? labelMatch[1].trim() : `search_${i + 1}`;
      const rawText = section.replace(/^[^\n]+\n/, '').trim();
      if (rawText) results.push({ query, rawText });
    });
  }

  return results;
}

// ─── Core execution ──────────────────────────────────────────────────────────

async function runXScout(config = DEFAULT_CONFIG) {
  const runId = randomUUID();
  const startTime = new Date();
  console.log(`[${startTime.toISOString()}] XSCOUT: starting run ${runId} for ${config.clientId}`);

  try {
    const previousBrief = await getLatestBrief(config.clientId);
    if (previousBrief) {
      console.log(`[${startTime.toISOString()}] XSCOUT: loaded previous brief from ${previousBrief.timestamp}`);
    } else {
      console.log(`[${startTime.toISOString()}] XSCOUT: no previous brief — first run`);
    }

    // ── STAGE 0: Supplemental fetches (parallel) ──────────────────────────────
    // Load all cached artifacts first (cheap local reads), then fire all live
    // fetches simultaneously. Each source has its own fallback: live failure →
    // cached artifact → skip gracefully. No source failure can block Stage 1.

    const [
      previousWeatherReport,
      previousReviewReport,
      previousInstagramReport,
      previousRedditReport,
      previousLast30Days,
    ] = await Promise.all([
      config.weather?.provider   ? getLatestWeather(config.clientId)    : Promise.resolve(null),
      config.reviews?.provider   ? getLatestReviews(config.clientId)    : Promise.resolve(null),
      config.instagram?.provider ? getLatestInstagram(config.clientId)  : Promise.resolve(null),
      config.reddit?.provider    ? getLatestReddit(config.clientId)     : Promise.resolve(null),
      config.last30days?.enabled ? getLatestLast30Days(config.clientId) : Promise.resolve(null),
    ]);

    console.log(`[${new Date().toISOString()}] XSCOUT: stage 0 — fetching supplemental data in parallel...`);

    const [weatherOutcome, reviewOutcome, instagramOutcome, redditOutcome, last30Outcome] = await Promise.allSettled([
      config.weather?.provider   ? fetchOperationalWeather(config)                              : Promise.resolve(null),
      config.reviews?.provider   ? fetchReviewStatusViaWebSearch(config, previousReviewReport)  : Promise.resolve(null),
      config.instagram?.provider ? fetchInstagramInsights(config, previousInstagramReport)      : Promise.resolve(null),
      config.reddit?.provider    ? fetchRedditSignals(config, previousRedditReport)             : Promise.resolve(null),
      config.last30days?.enabled ? fetchLast30Days(config)                                      : Promise.resolve(null),
    ]);

    // ── stage 0a: weather ─────────────────────────────────────────────────────
    let weatherReport = null;
    if (config.weather?.provider) {
      if (weatherOutcome.status === 'fulfilled') {
        weatherReport = weatherOutcome.value;
        if (weatherReport) {
          await saveLatestWeather(config.clientId, weatherReport);
          console.log(`[${new Date().toISOString()}] XSCOUT: stage 0a complete — ${weatherReport.neighborhoods.length} neighborhood forecast(s) captured`);
        } else if (previousWeatherReport) {
          weatherReport = previousWeatherReport;
          console.warn(`[${new Date().toISOString()}] XSCOUT: weather fetch returned nothing — using cached from ${previousWeatherReport.fetchedAt || 'unknown time'}`);
        }
      } else {
        console.warn(`[${new Date().toISOString()}] XSCOUT: weather fetch failed — ${weatherOutcome.reason?.message}`);
        if (previousWeatherReport) {
          weatherReport = previousWeatherReport;
          console.warn(`[${new Date().toISOString()}] XSCOUT: using cached weather from ${previousWeatherReport.fetchedAt || 'unknown time'}`);
        }
      }
    }

    // ── stage 0b: reviews ─────────────────────────────────────────────────────
    let reviewReport = null;
    if (config.reviews?.provider) {
      if (reviewOutcome.status === 'fulfilled') {
        reviewReport = reviewOutcome.value;
        if (reviewReport) {
          await saveLatestReviews(config.clientId, reviewReport);
          console.log(`[${new Date().toISOString()}] XSCOUT: stage 0b complete — review status ${reviewReport.overallStatus}`);
        }
      } else {
        console.warn(`[${new Date().toISOString()}] XSCOUT: review fetch failed — ${reviewOutcome.reason?.message}`);
      }
    }

    // ── stage 0c: instagram ───────────────────────────────────────────────────
    let instagramReport = null;
    if (config.instagram?.provider) {
      if (instagramOutcome.status === 'fulfilled') {
        instagramReport = instagramOutcome.value;
        if (instagramReport) {
          await saveLatestInstagram(config.clientId, instagramReport);
          console.log(`[${new Date().toISOString()}] XSCOUT: stage 0c complete — instagram insights captured`);
        }
      } else {
        console.warn(`[${new Date().toISOString()}] XSCOUT: instagram fetch failed — ${instagramOutcome.reason?.message}`);
      }
    }

    // ── stage 0d: reddit ──────────────────────────────────────────────────────
    let redditReport = null;
    if (config.reddit?.provider) {
      if (redditOutcome.status === 'fulfilled') {
        redditReport = redditOutcome.value;
        if (redditReport) {
          await saveLatestReddit(config.clientId, redditReport);
          console.log(`[${new Date().toISOString()}] XSCOUT: stage 0d complete — reddit mentions=${redditReport.mentionCount}, opportunities=${redditReport.participationOpportunityCount}`);
        } else if (previousRedditReport) {
          redditReport = previousRedditReport;
          console.warn(`[${new Date().toISOString()}] XSCOUT: reddit fetch returned nothing — using cached from ${previousRedditReport.fetchedAt || 'unknown time'}`);
        } else {
          console.warn(`[${new Date().toISOString()}] XSCOUT: reddit fetch returned nothing and no cached data available`);
        }
      } else {
        console.warn(`[${new Date().toISOString()}] XSCOUT: reddit fetch failed — ${redditOutcome.reason?.message}`);
        if (previousRedditReport) {
          redditReport = previousRedditReport;
          console.warn(`[${new Date().toISOString()}] XSCOUT: using cached reddit data from ${previousRedditReport.fetchedAt || 'unknown time'}`);
        }
      }
    }

    // ── stage 0e: last30days ──────────────────────────────────────────────────
    // Applies the same fallback pattern for both returned errors and thrown errors:
    // if a valid cached artifact exists, use its mapped signals rather than
    // dropping the layer entirely.
    let last30daysMapped = null;
    let last30daysContextBlock = '';
    if (config.last30days?.enabled) {
      const applyLast30DaysCache = () => {
        if (previousLast30Days?.status === 'success' && previousLast30Days.mapped) {
          last30daysMapped = previousLast30Days.mapped;
          last30daysContextBlock = buildLast30DaysContextBlock(previousLast30Days, previousLast30Days.mapped);
          console.warn(`[${new Date().toISOString()}] XSCOUT: using cached last30days data from ${previousLast30Days.fetchedAt || 'unknown time'}`);
        } else {
          console.warn(`[${new Date().toISOString()}] XSCOUT: no cached last30days data available — continuing without`);
        }
      };

      if (last30Outcome.status === 'fulfilled') {
        const serviceResult = last30Outcome.value;
        if (serviceResult?.status === 'success') {
          const normalizedSignals = normalizeSignals(serviceResult, config);
          last30daysMapped = mapToScoutFields(normalizedSignals, config);
          last30daysContextBlock = buildLast30DaysContextBlock(serviceResult, last30daysMapped);
          const artifact = { ...serviceResult, normalized: normalizedSignals, mapped: last30daysMapped };
          await saveLatestLast30Days(config.clientId, artifact);
          console.log(`[${new Date().toISOString()}] XSCOUT: stage 0e complete — ${normalizedSignals.length} signals. ${summarizeLast30DaysResult(serviceResult, normalizedSignals)}`);
        } else if (serviceResult === null) {
          // fetchLast30Days returns null when config.last30days.enabled is false — no-op
        } else {
          console.warn(`[${new Date().toISOString()}] XSCOUT: last30days returned status=${serviceResult?.status} — ${serviceResult?.error || 'no data'}`);
          applyLast30DaysCache();
        }
      } else {
        console.warn(`[${new Date().toISOString()}] XSCOUT: last30days fetch threw — ${last30Outcome.reason?.message}`);
        applyLast30DaysCache();
      }
    }

    // ── STAGE 1: Run 5 searches (Sonnet + web_search) ──────────────────────
    console.log(`[${new Date().toISOString()}] XSCOUT: stage 1 — executing searches...`);

    const stage1Response = await getAnthropicClient().messages.create({
      model: MODELS.briefWrite, // Sonnet needed for web_search tool access
      max_tokens: 4000,          // Low cap — we only need raw results, not analysis
      messages: [{
        role: 'user',
        content: buildSearchPrompt(config, weatherReport, reviewReport, instagramReport, redditReport, last30daysContextBlock),
      }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: getResolvedSearchPlan(config).length }],
    });

    const stage1InputTokens  = stage1Response.usage?.input_tokens  || 0;
    const stage1OutputTokens = stage1Response.usage?.output_tokens || 0;
    logCostEstimate('Stage 1 (searches)', stage1InputTokens, stage1OutputTokens, MODELS.briefWrite);
    const stage1Cost = computeStageCost('scout-search', stage1InputTokens, stage1OutputTokens, MODELS.briefWrite);

    // Extract raw search results from Stage 1
    const searchResults = extractSearchResults(stage1Response.content);
    console.log(`[${new Date().toISOString()}] XSCOUT: stage 1 complete — ${searchResults.length} search results extracted`);

    // ── STAGE 2: Trim results with Haiku ───────────────────────────────────
    console.log(`[${new Date().toISOString()}] XSCOUT: stage 2 — trimming with Haiku...`);

    const { trimmed: trimmedResults, trimUsage } = await trimAllSearchResults(searchResults, config.clientName);
    const compactContext = buildCompactContext(trimmedResults);
    logCostEstimate('Stage 2 (trim)', trimUsage.input_tokens, trimUsage.output_tokens, MODELS.searchTrim);
    const stage2Cost = computeStageCost('scout-trim', trimUsage.input_tokens, trimUsage.output_tokens, MODELS.searchTrim);
    console.log(`[${new Date().toISOString()}] XSCOUT: stage 2 complete — context: ~${Math.round(compactContext.length / 4)} tokens`);

    // ── STAGE 3: Write brief (Sonnet, compact context) ─────────────────────
    console.log(`[${new Date().toISOString()}] XSCOUT: stage 3 — synthesizing brief...`);

    const stage3Response = await getAnthropicClient().messages.create({
      model: MODELS.briefWrite,
      max_tokens: 8000,
      messages: [{
        role: 'user',
        content: buildBriefPrompt(config, compactContext, previousBrief, weatherReport, reviewReport, instagramReport, redditReport, last30daysContextBlock),
      }],
    });

    const stage3InputTokens  = stage3Response.usage?.input_tokens  || 0;
    const stage3OutputTokens = stage3Response.usage?.output_tokens || 0;
    logCostEstimate('Stage 3 (brief)', stage3InputTokens, stage3OutputTokens, MODELS.briefWrite);
    const stage3Cost = computeStageCost('scout-synthesis', stage3InputTokens, stage3OutputTokens, MODELS.briefWrite);

    const fullText = stage3Response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    if (!fullText.trim()) {
      throw new Error('Stage 3 returned no text output');
    }

    let brief = parseBriefOutput(fullText, config, runId, startTime);
    const scoutStageCosts = [stage1Cost, stage2Cost, stage3Cost];

    // Layer 2: targeted retry if bracket repair also failed
    if (brief.needsRetry) {
      const { agentData: retried, retryCost } = await retryAgentData(compactContext, config, previousBrief, weatherReport, reviewReport, instagramReport, redditReport, last30daysContextBlock);
      brief.agentData = retried;
      if (retried) {
        console.log(`[${new Date().toISOString()}] XSCOUT: AGENT DATA recovered via retry`);
      }
      if (retryCost) scoutStageCosts.push(retryCost);
    }

    // Remove internal flag before saving
    delete brief.needsRetry;

    brief.agentData = hydrateAgentData(brief.agentData, weatherReport, redditReport, searchResults, compactContext, last30daysMapped);

    brief.stageCosts = scoutStageCosts;

    await saveLatestBrief(config.clientId, brief);

    const duration = ((Date.now() - startTime.getTime()) / 1000).toFixed(1);
    console.log(`[${new Date().toISOString()}] XSCOUT: run ${runId} completed in ${duration}s`);

    return brief;
  } catch (err) {
    console.error(`[${new Date().toISOString()}] XSCOUT ERROR:`, err.message);
    await logError(err, { module: 'xscout', runId, clientId: config.clientId });

    return {
      runId,
      timestamp: startTime.toISOString(),
      clientId: config.clientId,
      status: 'error',
      error: err.message,
      delta: null,
      humanBrief: null,
      agentData: null,
      rawOutput: null,
      stageCosts: [],
    };
  }
}

// ─── Output parsing ──────────────────────────────────────────────────────────

/**
 * Attempt to repair a truncated JSON string by closing any open brackets.
 * Walks the string char-by-char, tracking bracket depth while skipping string
 * literals. If the string is already valid JSON (stack empty), returns null —
 * there's nothing to repair. Returns the repaired string or null if unrecoverable.
 */
function repairJson(rawStr) {
  const stack = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < rawStr.length; i++) {
    const ch = rawStr[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }

  // Nothing open — string is structurally complete (parse error has another cause)
  if (stack.length === 0) return null;

  // Strip trailing comma or whitespace before closing
  let repaired = rawStr.trimEnd().replace(/,\s*$/, '');

  // Close all open brackets in reverse order
  for (let i = stack.length - 1; i >= 0; i--) {
    repaired += stack[i] === '{' ? '}' : ']';
  }

  return repaired;
}

/**
 * Layer 2 retry: ask Sonnet to produce ONLY the AGENT DATA JSON.
 * Called only when repairJson() fails to recover a parseable object.
 * Uses the same compact context Stage 3 had — no new searches needed.
 */
async function retryAgentData(compactContext, config, previousBrief, weatherReport = null, reviewReport = null, instagramReport = null, redditReport = null, last30daysContextBlock = '') {
  console.log(`[${new Date().toISOString()}] XSCOUT: retrying AGENT DATA extraction...`);

  const retryPrompt = `You are a data extraction agent. Based on the search intelligence below,
return ONLY a valid JSON object for the AGENT DATA section. No other text. No section headers.
No markdown fences. Valid JSON only, starting with { and ending with }.

${buildBriefPrompt(config, compactContext, previousBrief, weatherReport, reviewReport, instagramReport, redditReport, last30daysContextBlock)}

CRITICAL: Return ONLY the JSON object. Nothing before {. Nothing after }.`;

  const response = await getAnthropicClient().messages.create({
    model: MODELS.briefWrite,
    max_tokens: 2000,
    messages: [{ role: 'user', content: retryPrompt }],
  });

  const retryInputTokens  = response.usage?.input_tokens  || 0;
  const retryOutputTokens = response.usage?.output_tokens || 0;
  logCostEstimate('Stage 3 retry (AGENT DATA)', retryInputTokens, retryOutputTokens, MODELS.briefWrite);
  const retryCost = computeStageCost('scout-synthesis-retry', retryInputTokens, retryOutputTokens, MODELS.briefWrite);

  const raw = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  try {
    return { agentData: JSON.parse(raw), retryCost };
  } catch {
    // Extract just the JSON object if model added surrounding text
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try { return { agentData: JSON.parse(match[0]), retryCost }; } catch { /* fall through */ }
    }
    console.warn(`[${new Date().toISOString()}] XSCOUT: retry also failed to parse — storing null`);
    return { agentData: null, retryCost };
  }
}

function parseBriefOutput(fullText, config, runId, startTime) {
  const delta = extractSection(fullText, 'DELTA');
  const humanBrief = extractSection(fullText, 'HUMAN BRIEF');
  const agentDataRaw = extractSection(fullText, 'AGENT DATA');

  let agentData = null;
  let needsRetry = false;

  if (agentDataRaw) {
    try {
      agentData = JSON.parse(agentDataRaw);
    } catch (parseErr) {
      console.warn(`[${new Date().toISOString()}] XSCOUT: AGENT DATA parse failed — ${parseErr.message}`);
      console.warn(`[${new Date().toISOString()}] XSCOUT: raw tail (last 200 chars): ...${agentDataRaw.slice(-200)}`);

      // Layer 1: attempt bracket repair
      const repaired = repairJson(agentDataRaw);
      if (repaired) {
        try {
          agentData = JSON.parse(repaired);
          console.log(`[${new Date().toISOString()}] XSCOUT: AGENT DATA recovered via bracket repair`);
        } catch {
          console.warn(`[${new Date().toISOString()}] XSCOUT: bracket repair produced invalid JSON — scheduling retry`);
          needsRetry = true;
        }
      } else {
        console.warn(`[${new Date().toISOString()}] XSCOUT: repairJson returned null — scheduling retry`);
        needsRetry = true;
      }
    }
  }

  return {
    runId,
    timestamp: startTime.toISOString(),
    clientId: config.clientId,
    clientName: config.clientName,
    status: 'success',
    delta,
    humanBrief,
    agentData,
    needsRetry,
    rawOutput: fullText,
  };
}

function extractSection(text, sectionName) {
  const pattern = new RegExp(
    `===\\s*${sectionName}\\s*===\\s*\\n([\\s\\S]*?)(?=\\n===\\s*[A-Z]|$)`,
    'i'
  );
  const match = text.match(pattern);
  return match ? match[1].trim() : null;
}

// ─── Standalone execution ────────────────────────────────────────────────────

if (require.main === module) {
  const clientArgIndex = process.argv.indexOf('--client');
  const clientId = clientArgIndex >= 0 ? process.argv[clientArgIndex + 1] : DEFAULT_CONFIG.clientId;
  const config = requireClientConfig(clientId);
  console.log(`[${new Date().toISOString()}] XSCOUT: running in standalone mode`);
  runXScout(config)
    .then((brief) => {
      if (brief.status === 'success') {
        console.log('\n--- HUMAN BRIEF ---');
        console.log(brief.humanBrief);
        console.log('\n--- ESCALATIONS ---');
        (brief.agentData?.escalations || []).forEach((e) =>
          console.log(`  [${e.level}] ${e.status}: ${e.summary}`)
        );
      } else {
        console.error('Run failed:', brief.error);
      }
    })
    .catch((err) => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { runXScout, getLatestBrief, DEFAULT_CONFIG };
