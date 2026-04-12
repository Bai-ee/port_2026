// normalize-last30days.js — normalization and Scout mapping for last30days data
//
// This module is a pure transformation layer — no I/O, no side effects.
// It converts last30days raw JSON output (from --emit=json) into:
//
//   1. NORMALIZED SIGNALS — platform-agnostic signal objects with full provenance.
//      Each signal retains its origin, platform, signalType, URL, and engagement data.
//      This is the portable, dashboard-ready layer.
//
//   2. MAPPED FIELDS — normalized signals bucketed into Scout agentData shapes
//      (brandMentions, competitorIntel, redditSignals, etc.).
//      Every mapped record retains provenance so downstream dashboards can trace
//      back to the source platform and original signal type.
//
//   3. CONTEXT BLOCK — a compact text block injected into Scout's search and
//      brief prompts so Sonnet is aware of what last30days found.
//
// ─── DATA MODEL ─────────────────────────────────────────────────────────────
//
// The last30days JSON report (schema.Report) contains:
//   - ranked_candidates: globally ranked + deduplicated items (preferred source)
//   - items_by_source: all raw items per platform (used for stats/fallback)
//
// Each Candidate has:
//   { candidate_id, source, title, url, snippet, final_score,
//     local_relevance, freshness, engagement, source_items[] }
//
// Each SourceItem (within source_items[]) has:
//   { item_id, source, title, body, url, author, container,
//     published_at, engagement{}, snippet, local_relevance, ... }
//
// ─── MULTI-CLIENT DESIGN ────────────────────────────────────────────────────
// Signal classification and bucket mapping are driven by clientConfig.last30days:
//   - brandTerms: string[] for brand_mention detection
//   - competitorNames: string[] for competitor_mention detection
//
// New clients add their own brandTerms and competitorNames — the classification
// and mapping logic stays unchanged. The signalMapping is extensible per-client
// if different buckets are needed later.

// ─── Signal type taxonomy ─────────────────────────────────────────────────────
//
// brand_mention         — content references the brand by name
// competitor_mention    — content references a known competitor
// recommendation_thread — someone asking for recommendations (high buyer intent)
// pain_point            — complaint or trust gap that positions the brand
// participation_opportunity — local/neighborhood thread to engage with
// content_opportunity   — trending topic suitable for content creation
// industry_trend        — category-level movement, relevant for strategic context
// social_proof          — review-like endorsement or positive community signal
// partnership_signal    — potential referral, collab, or cross-promotion
// prediction_market     — Polymarket odds relevant to the topic

const SIGNAL_TYPES = {
  BRAND_MENTION: 'brand_mention',
  COMPETITOR_MENTION: 'competitor_mention',
  RECOMMENDATION_THREAD: 'recommendation_thread',
  PAIN_POINT: 'pain_point',
  PARTICIPATION_OPPORTUNITY: 'participation_opportunity',
  CONTENT_OPPORTUNITY: 'content_opportunity',
  INDUSTRY_TREND: 'industry_trend',
  SOCIAL_PROOF: 'social_proof',
  PARTNERSHIP_SIGNAL: 'partnership_signal',
  PREDICTION_MARKET: 'prediction_market',
};

// ─── Classification helpers ───────────────────────────────────────────────────

function hasBrandMatch(text, brandTerms = []) {
  if (!text || !brandTerms.length) return false;
  const lower = text.toLowerCase();
  return brandTerms.some((term) => lower.includes(term.toLowerCase()));
}

function competitorMatch(text, competitorNames = []) {
  if (!text || !competitorNames.length) return null;
  const lower = text.toLowerCase();
  return competitorNames.find((name) => lower.includes(name.toLowerCase())) || null;
}

function classifyPlatformSignal(platform, text) {
  switch (platform) {
    case 'reddit': {
      if (/\b(looking for|recommend|recs|anyone know|need a|who do you use)\b/i.test(text)) {
        return SIGNAL_TYPES.RECOMMENDATION_THREAD;
      }
      if (/\b(price|expensive|cost|trust|reliable|bad experience|unreliable|canceled)\b/i.test(text)) {
        return SIGNAL_TYPES.PAIN_POINT;
      }
      return SIGNAL_TYPES.PARTICIPATION_OPPORTUNITY;
    }
    case 'hackernews':
      return SIGNAL_TYPES.INDUSTRY_TREND;
    case 'polymarket':
      return SIGNAL_TYPES.PREDICTION_MARKET;
    case 'youtube':
    case 'tiktok':
    case 'instagram':
      return SIGNAL_TYPES.CONTENT_OPPORTUNITY;
    default:
      return SIGNAL_TYPES.INDUSTRY_TREND;
  }
}

function classifySignalType(platform, fullText, clientConfig = {}) {
  const brandTerms = clientConfig.last30days?.brandTerms || [];
  const competitorNames = clientConfig.last30days?.competitorNames || [];

  if (hasBrandMatch(fullText, brandTerms)) return SIGNAL_TYPES.BRAND_MENTION;

  const competitor = competitorMatch(fullText, competitorNames);
  if (competitor) return SIGNAL_TYPES.COMPETITOR_MENTION;

  return classifyPlatformSignal(platform, fullText);
}

function scoreClientRelevance(finalScore, signalType) {
  // Brand and buyer-intent signals are always high relevance
  const alwaysHigh = [
    SIGNAL_TYPES.BRAND_MENTION,
    SIGNAL_TYPES.RECOMMENDATION_THREAD,
    SIGNAL_TYPES.PAIN_POINT,
    SIGNAL_TYPES.PARTICIPATION_OPPORTUNITY,
  ];
  if (alwaysHigh.includes(signalType)) return 'high';

  const alwaysMedium = [
    SIGNAL_TYPES.COMPETITOR_MENTION,
    SIGNAL_TYPES.SOCIAL_PROOF,
    SIGNAL_TYPES.PARTNERSHIP_SIGNAL,
  ];
  if (alwaysMedium.includes(signalType)) return 'medium';

  // For everything else, use the last30days final_score
  if (finalScore >= 0.6) return 'high';
  if (finalScore >= 0.35) return 'medium';
  return 'low';
}

// ─── Engagement extraction ────────────────────────────────────────────────────
//
// last30days SourceItem.engagement is a plain dict — keys vary by platform.
// We normalize to a common shape for dashboard use.

function extractEngagement(sourceItems = [], platformHint = '') {
  // Aggregate engagement across source_items (candidates can be multi-source)
  const totals = { relevanceScore: 0, likes: 0, upvotes: 0, comments: 0, views: 0, reposts: 0, points: 0 };
  let count = 0;

  for (const item of sourceItems) {
    const eng = item.engagement || {};
    totals.relevanceScore += Number(item.engagement_score || item.local_relevance || 0);
    totals.likes     += Number(eng.likes     || eng.favorite_count || 0);
    totals.upvotes   += Number(eng.upvotes   || eng.score          || 0);
    totals.comments  += Number(eng.comments  || eng.num_comments   || 0);
    totals.views     += Number(eng.views     || eng.view_count     || 0);
    totals.reposts   += Number(eng.reposts   || eng.retweet_count  || 0);
    totals.points    += Number(eng.points    || eng.score          || 0);
    count++;
  }

  // Deduplicate zeros so the engagement object stays compact
  const result = {};
  if (totals.relevanceScore) result.relevanceScore = totals.relevanceScore / Math.max(count, 1);
  if (totals.likes)    result.likes    = totals.likes;
  if (totals.upvotes)  result.upvotes  = totals.upvotes;
  if (totals.comments) result.comments = totals.comments;
  if (totals.views)    result.views    = totals.views;
  if (totals.reposts)  result.reposts  = totals.reposts;
  if (totals.points)   result.points   = totals.points;
  return result;
}

function extractContainer(sourceItems = []) {
  // container = subreddit (reddit), channel name (youtube), handle (tiktok), etc.
  for (const item of sourceItems) {
    if (item.container) return item.container;
  }
  return '';
}

function extractAuthor(sourceItems = []) {
  for (const item of sourceItems) {
    if (item.author) return item.author;
  }
  return '';
}

function extractBody(sourceItems = []) {
  for (const item of sourceItems) {
    if (item.body && item.body.trim()) return item.body.slice(0, 400);
  }
  return '';
}

function extractPublishedAt(sourceItems = []) {
  // Use the most recent date across source_items
  const dates = sourceItems
    .map((item) => item.published_at)
    .filter(Boolean)
    .sort()
    .reverse();
  return dates[0] || '';
}

// ─── Primary normalizer ───────────────────────────────────────────────────────

/**
 * Normalize a single ranked_candidate into a platform-agnostic signal object.
 *
 * Normalized signal shape:
 * {
 *   id, origin, platform, signalType,
 *   title, body, url, author, container, publishedAt,
 *   engagement{}, finalScore,
 *   clientRelevance, competitorMatchedName, sentiment,
 *   fetchedAt, tags[]
 * }
 */
function normalizeCandidate(candidate, clientConfig, fetchedAt) {
  const platform = candidate.source || 'unknown';
  const sourceItems = candidate.source_items || [];

  const title  = candidate.title || '(untitled)';
  const body   = candidate.snippet || extractBody(sourceItems);
  const url    = candidate.url || '';
  const author = extractAuthor(sourceItems);
  const container = extractContainer(sourceItems);

  const fullText = `${title} ${body}`.trim();
  const signalType = classifySignalType(platform, fullText, clientConfig);
  const finalScore = Number(candidate.final_score) || 0;
  const clientRelevance = scoreClientRelevance(finalScore, signalType);

  const brandTerms = clientConfig.last30days?.brandTerms || [];
  const competitorNames = clientConfig.last30days?.competitorNames || [];

  return {
    // Provenance — never stripped
    id: candidate.candidate_id || candidate.item_id || url,
    origin: 'last30days',
    platform,
    signalType,

    // Content
    title,
    body,
    url,
    author,
    container, // subreddit, channel, handle, etc.
    publishedAt: extractPublishedAt(sourceItems),

    // Scoring
    engagement: extractEngagement(sourceItems, platform),
    finalScore,

    // Classification
    clientRelevance,
    competitorMatchedName: competitorMatch(fullText, competitorNames),
    hasBrandMention: hasBrandMatch(fullText, brandTerms),
    sentiment: 'neutral', // last30days v3 does not emit sentiment — can be enriched later

    // Metadata
    fetchedAt,
    tags: [],
  };
}

/**
 * Normalize all ranked candidates from a last30days service result.
 * Returns an array sorted: high relevance first, then by final_score descending.
 */
function normalizeSignals(serviceResult, clientConfig = {}) {
  if (!serviceResult?.rawOutput) return [];

  const raw = serviceResult.rawOutput;
  const fetchedAt = serviceResult.fetchedAt || new Date().toISOString();

  // Prefer ranked_candidates (globally deduped + ranked) over items_by_source
  const candidates = Array.isArray(raw.ranked_candidates)
    ? raw.ranked_candidates
    : [];

  if (candidates.length === 0) {
    // Fallback: flatten items_by_source into lightweight candidates
    const itemsBySource = raw.items_by_source || {};
    for (const [source, items] of Object.entries(itemsBySource)) {
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        candidates.push({
          candidate_id: item.item_id,
          item_id: item.item_id,
          source,
          title: item.title,
          url: item.url,
          snippet: item.snippet || item.body?.slice(0, 300) || '',
          final_score: item.local_rank_score || 0,
          source_items: [item],
        });
      }
    }
  }

  const normalized = [];
  for (const candidate of candidates) {
    try {
      normalized.push(normalizeCandidate(candidate, clientConfig, fetchedAt));
    } catch {
      // Skip malformed candidates — never break the pipeline
    }
  }

  const relevanceOrder = { high: 0, medium: 1, low: 2 };
  return normalized.sort((a, b) => {
    const ra = relevanceOrder[a.clientRelevance] ?? 2;
    const rb = relevanceOrder[b.clientRelevance] ?? 2;
    if (ra !== rb) return ra - rb;
    return b.finalScore - a.finalScore;
  });
}

// ─── Scout field mapper ───────────────────────────────────────────────────────
//
// Maps normalized signals into Scout agentData bucket shapes.
// Every mapped record retains provenance fields so dashboards can trace
// back to the source signal:
//   origin: 'last30days'
//   platform: 'reddit'|'x'|'youtube'|...
//   signalType: the last30days classification
//   url: canonical source URL

/**
 * Map normalized signals into Scout-compatible agentData buckets.
 * Returns: { brandMentions, competitorIntel, redditSignals,
 *            contentOpportunities, localDemandSignals, partnershipOpportunities }
 */
function mapToScoutFields(normalizedSignals, clientConfig = {}) {
  const mapped = {
    brandMentions: [],
    competitorIntel: [],
    redditSignals: [],
    contentOpportunities: [],
    localDemandSignals: [],
    partnershipOpportunities: [],
  };

  for (const signal of normalizedSignals) {
    // Common provenance footer attached to every mapped record
    const provenance = {
      origin: signal.origin,          // always 'last30days'
      platform: signal.platform,
      signalType: signal.signalType,
      url: signal.url,
    };

    switch (signal.signalType) {
      case SIGNAL_TYPES.BRAND_MENTION:
        mapped.brandMentions.push({
          source: signal.platform,
          author: signal.author,
          content: signal.body || signal.title,
          sentiment: signal.sentiment,
          reach: signal.clientRelevance,
          url: signal.url,
          ...provenance,
        });
        break;

      case SIGNAL_TYPES.COMPETITOR_MENTION:
        mapped.competitorIntel.push({
          competitor: signal.competitorMatchedName || 'unknown',
          finding: signal.body || signal.title,
          impact: signal.clientRelevance,
          url: signal.url,
          ...provenance,
        });
        break;

      case SIGNAL_TYPES.RECOMMENDATION_THREAD:
      case SIGNAL_TYPES.PAIN_POINT:
      case SIGNAL_TYPES.PARTICIPATION_OPPORTUNITY:
        // Reddit and other community threads → redditSignals
        mapped.redditSignals.push({
          title: signal.title,
          subreddit: signal.container || signal.platform,
          signalType: signal.signalType,
          summary: signal.body,
          actionableTakeaway: buildRedditTakeaway(signal.signalType),
          url: signal.url,
          ...provenance,
        });
        break;

      case SIGNAL_TYPES.CONTENT_OPPORTUNITY:
      case SIGNAL_TYPES.INDUSTRY_TREND:
        if (signal.clientRelevance !== 'low') {
          mapped.contentOpportunities.push({
            topic: signal.title,
            whyNow: signal.body,
            format: inferContentFormat(signal.platform),
            priority: signal.clientRelevance,
            source: signal.platform,
            url: signal.url,
            ...provenance,
          });
        }
        break;

      case SIGNAL_TYPES.SOCIAL_PROOF:
        // Treat as a review-like insight — surface in localDemandSignals
        mapped.localDemandSignals.push({
          signal: signal.title,
          relevance: signal.clientRelevance,
          detail: signal.body,
          ...provenance,
        });
        break;

      case SIGNAL_TYPES.PARTNERSHIP_SIGNAL:
        mapped.partnershipOpportunities.push({
          partner: signal.author || signal.platform,
          type: 'community',
          finding: signal.body || signal.title,
          priority: signal.clientRelevance,
          url: signal.url,
          ...provenance,
        });
        break;

      case SIGNAL_TYPES.PREDICTION_MARKET:
        // Prediction markets → local demand signals (timing / demand confidence)
        mapped.localDemandSignals.push({
          signal: signal.title,
          relevance: signal.clientRelevance,
          detail: signal.body,
          ...provenance,
        });
        break;

      default:
        // Unknown types fall into localDemandSignals as a catch-all
        if (signal.clientRelevance !== 'low') {
          mapped.localDemandSignals.push({
            signal: signal.title,
            relevance: signal.clientRelevance,
            detail: signal.body,
            ...provenance,
          });
        }
    }
  }

  return mapped;
}

function buildRedditTakeaway(signalType) {
  switch (signalType) {
    case SIGNAL_TYPES.RECOMMENDATION_THREAD:
      return 'Recommendation thread surfaced by last30days — high buyer intent, potential participation window.';
    case SIGNAL_TYPES.PAIN_POINT:
      return 'Pain point thread — contains buyer language around trust, price, or reliability relevant to positioning.';
    default:
      return 'Neighborhood or community thread surfaced by last30days — potential content hook or participation opportunity.';
  }
}

function inferContentFormat(platform) {
  switch (platform) {
    case 'tiktok': return 'short-form video';
    case 'instagram': return 'reel or story';
    case 'youtube': return 'long-form video';
    default: return 'post';
  }
}

// ─── Scout context block ──────────────────────────────────────────────────────

/**
 * Build the context block injected into Scout's search and brief prompts.
 * Compact by design — Scout's prompts are already large.
 */
function buildLast30DaysContextBlock(serviceResult, mappedSignals) {
  if (!serviceResult || serviceResult.status !== 'success') return '';
  if (!mappedSignals) return '';

  const { topic, lookbackDays, fetchedAt, sources } = serviceResult;
  const dateLabel = fetchedAt ? fetchedAt.slice(0, 10) : 'unknown date';

  const lines = [
    `LAST30DAYS SOCIAL INTELLIGENCE (topic: "${topic}", last ${lookbackDays || 30} days, fetched: ${dateLabel}):`,
  ];

  const redditSignals        = mappedSignals.redditSignals        || [];
  const brandMentions        = mappedSignals.brandMentions        || [];
  const competitorIntel      = mappedSignals.competitorIntel      || [];
  const contentOpportunities = mappedSignals.contentOpportunities || [];
  const localDemandSignals   = mappedSignals.localDemandSignals   || [];

  if (redditSignals.length > 0) {
    lines.push('Reddit / community signals:');
    redditSignals.slice(0, 5).forEach((s) => {
      const sub = s.subreddit ? ` (${s.subreddit})` : '';
      lines.push(`  - [${s.signalType}]${sub} ${s.title}: ${s.summary?.slice(0, 120) || ''}`);
    });
  }

  if (brandMentions.length > 0) {
    lines.push('Brand mentions (social):');
    brandMentions.slice(0, 3).forEach((m) => {
      const by = m.author ? ` @${m.author}` : '';
      lines.push(`  - [${m.platform}]${by}: ${m.content?.slice(0, 120) || ''}`);
    });
  }

  if (competitorIntel.length > 0) {
    lines.push('Competitor signals:');
    competitorIntel.slice(0, 3).forEach((c) => {
      lines.push(`  - [${c.platform}] ${c.competitor}: ${c.finding?.slice(0, 120) || ''}`);
    });
  }

  if (contentOpportunities.length > 0) {
    lines.push('Content opportunities (social):');
    contentOpportunities.slice(0, 3).forEach((op) => {
      lines.push(`  - [${op.platform}/${op.format}] ${op.topic}: ${op.whyNow?.slice(0, 100) || ''}`);
    });
  }

  if (localDemandSignals.length > 0) {
    lines.push('Local / demand signals:');
    localDemandSignals.slice(0, 3).forEach((d) => {
      lines.push(`  - [${d.platform || 'web'}] ${d.signal}: ${d.detail?.slice(0, 100) || ''}`);
    });
  }

  if (lines.length === 1) {
    lines.push('  No high-relevance signals found in this cycle.');
  }

  const sourceList = sources || 'default sources';
  lines.push(`Sources searched: ${sourceList}. Do not re-search these unless you need corroboration.`);

  return lines.join('\n');
}

// ─── Stats helper (for logging / reporting) ───────────────────────────────────

function summarizeLast30DaysResult(serviceResult, normalizedSignals = []) {
  if (!serviceResult) return 'last30days: not run';
  if (serviceResult.status === 'error') return `last30days: error — ${serviceResult.error}`;
  if (serviceResult.status === 'empty') return 'last30days: no results';
  if (serviceResult.status !== 'success') return `last30days: ${serviceResult.status}`;

  const counts = {};
  for (const signal of normalizedSignals) {
    counts[signal.platform] = (counts[signal.platform] || 0) + 1;
  }

  const sourceSummary = Object.entries(counts)
    .map(([src, n]) => `${src}=${n}`)
    .join(', ');

  return `last30days: ${normalizedSignals.length} signals (${sourceSummary || 'none'})`;
}

module.exports = {
  normalizeSignals,
  mapToScoutFields,
  buildLast30DaysContextBlock,
  summarizeLast30DaysResult,
  SIGNAL_TYPES,
};
