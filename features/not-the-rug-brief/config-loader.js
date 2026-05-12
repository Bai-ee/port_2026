// config-loader.js — Runtime config loading strategy
//
// Resolves a runtime config object from two sources:
//
//   1. Static local registry (clients.js) — local dev and known clients.
//      Pass no firestoreClientConfig → uses the static registry.
//
//   2. Firestore client_configs document — dynamic / newly provisioned clients.
//      Pass the client_configs/{clientId} doc from Firestore → builds a generic
//      runtime config from sourceInputs and providerConfig.
//
// The Phase 3 worker will always pass a firestoreClientConfig.
// The local dev CLI (run.js) passes nothing and falls back to the static registry.

const { getClientConfig } = require('./clients');

// ─── Generic agent data template ──────────────────────────────────────────────

const DEFAULT_AGENT_DATA_TEMPLATE = `{
  "brandMentions": [{"source":"...","author":"...","content":"...","sentiment":"positive|neutral|negative","reach":"high|medium|low","url":"..."}],
  "competitorIntel": [{"competitor":"...","finding":"...","impact":"high|medium|low","url":"..."}],
  "categoryTrends": [{"trend":"...","relevance":"high|medium|low","detail":"..."}],
  "contentOpportunities": {
    "found": true,
    "opportunities": [{"topic":"...","whyNow":"...","format":"...","priority":"high|medium|low","source":"...","url":"..."}],
    "searchedFor": ["trigger 1","trigger 2"]
  },
  "escalations": [{"level":"CRITICAL|IMPORTANT|QUIET","status":"NEW|CHANGED|ESCALATED|RESOLVED","summary":"..."}]
}`;

const MARKETING_BRIEF_AGENT_DATA_TEMPLATE = `{
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

// ─── Default intelligence config for generic clients ──────────────────────────

const DEFAULT_INTELLIGENCE_CONFIG = {
  primarySignalsKey: 'categoryTrends',
  primarySignalsLabel: 'Category Signals',
  promptPrimarySignalLabel: 'Category Context',
  primarySignalsFallback: 'No category signals detected this cycle.',
  contentOpportunitiesKey: 'contentOpportunities',
  contentOpportunitiesLabel: 'Content Opportunities',
  promptContentOpportunitiesLabel: 'Content Opportunities',
  contentOpportunitiesFallback: 'Scout found NO content opportunities this cycle.',
  brandMentionsLabel: 'Brand Mentions',
  relationshipSignalsKey: 'competitorIntel',
  relationshipSignalsLabel: 'Competitor Intel',
  promptRelationshipSignalsLabel: 'Competitor Intel',
  relationshipSignalsFallback: 'No competitor intel surfaced this cycle.',
};

const MARKETING_BRIEF_INTELLIGENCE_CONFIG = {
  primarySignalsKey: 'categoryTrends',
  primarySignalsLabel: "What's Happening in the Market",
  promptPrimarySignalLabel: 'Market Context',
  primarySignalsFallback: 'No market trends available.',
  reviewInsightsKey: 'reviewInsights',
  reviewInsightsLabel: 'Review Insights',
  promptReviewInsightsLabel: 'Review Insights',
  relationshipSignalsKey: 'kolActivity',
  relationshipSignalsLabel: 'KOLs',
  promptRelationshipSignalsLabel: 'KOL Activity',
  relationshipSignalsFallback: 'No KOL activity detected this cycle.',
  contentOpportunitiesKey: 'viralOpportunities',
  contentOpportunitiesLabel: 'Viral Opportunities',
  promptContentOpportunitiesLabel: 'Viral Opportunities',
  contentOpportunitiesFallback: 'Scout found NO viral opportunities this cycle.',
  brandMentionsLabel: 'Brand Mentions',
};

const ALLOWED_SOURCE_PLATFORMS = new Set(['web', 'x', 'reddit', 'instagram', 'youtube', 'tiktok', 'hackernews']);
const DEFAULT_SOURCE_PLATFORMS = ['web', 'x', 'reddit', 'instagram'];
const PLATFORM_LABELS = {
  web: 'web/news',
  x: 'X/Twitter',
  reddit: 'Reddit',
  instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  hackernews: 'Hacker News',
};

function normalizeSourcePlatforms(input) {
  const rows = Array.isArray(input) ? input : DEFAULT_SOURCE_PLATFORMS;
  const normalized = rows
    .map((item) => String(item || '').trim().toLowerCase())
    .filter((item) => ALLOWED_SOURCE_PLATFORMS.has(item));
  return Array.from(new Set(normalized.length ? normalized : ['web']));
}

function buildPlatformSearchQuery(sourcePlatforms = []) {
  const terms = [];
  if (sourcePlatforms.includes('x')) terms.push('Twitter OR X');
  if (sourcePlatforms.includes('reddit')) terms.push('site:reddit.com OR Reddit');
  if (sourcePlatforms.includes('instagram')) terms.push('site:instagram.com OR Instagram');
  if (sourcePlatforms.includes('youtube')) terms.push('site:youtube.com OR YouTube');
  if (sourcePlatforms.includes('tiktok')) terms.push('site:tiktok.com OR TikTok');
  if (sourcePlatforms.includes('hackernews')) terms.push('site:news.ycombinator.com OR Hacker News');
  return terms.join(' OR ');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractHostname(url) {
  try {
    return new URL(String(url || '')).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return String(url || '');
  }
}

function deriveCompanyName(hostname, clientId) {
  if (!hostname) return clientId || 'Client';
  const root = hostname.split('.')[0] || clientId || 'Client';
  return root
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildSearchPlan({ websiteUrl, ideaDescription, hostname, companyName, marketingBriefConfig = null, sourcePlatforms = DEFAULT_SOURCE_PLATFORMS }) {
  const configuredSearches = Array.isArray(marketingBriefConfig?.searches)
    ? marketingBriefConfig.searches
        .map((row, index) => ({
          label: String(row?.label || `SEARCH ${index + 1}`).trim(),
          query: String(row?.query || '').trim(),
          goal:  String(row?.goal || '').trim() || 'Find timely signals the brand can act on.',
        }))
        .filter((row) => row.query)
    : [];

  if (configuredSearches.length > 0) {
    const platformQuery = buildPlatformSearchQuery(sourcePlatforms);
    if (!platformQuery) return configuredSearches;
    return [
      ...configuredSearches,
      {
        label: 'SOURCE PLATFORMS',
        query: `${companyName} ${platformQuery}`,
        goal: `Find platform-specific conversation signals only from enabled sources: ${sourcePlatforms.map((key) => PLATFORM_LABELS[key] || key).join(', ')}.`,
      },
    ];
  }

  const brandQuery = [`"${companyName}"`, hostname ? `"${hostname}"` : null, hostname ? `site:${hostname}` : null]
    .filter(Boolean)
    .join(' OR ');

  const ideaTerms = ideaDescription
    ? ideaDescription.split(/[\s,./]+/).filter((t) => t.length > 3).slice(0, 6).join(' OR ')
    : null;

  const categoryQuery = ideaTerms || `${companyName} industry trends 2026`;
  const opportunityQuery = ideaDescription
    ? `best ${ideaDescription.split(/\s+/).slice(0, 4).join(' ')}`
    : `${companyName} reviews OR ${hostname} competitors`;

  const platformQuery = buildPlatformSearchQuery(sourcePlatforms);
  return [
    {
      label: 'BRAND',
      query: brandQuery,
      goal: 'Find direct brand mentions, direct web coverage, and community discussion.',
    },
    {
      label: 'CATEGORY',
      query: categoryQuery,
      goal: 'Capture broader category movement and external narratives the brand can react to.',
    },
    {
      label: 'CONTENT OPPORTUNITIES',
      query: opportunityQuery,
      goal: 'Find live conversations and topics where the brand can contribute credibly.',
    },
    ...(platformQuery ? [{
      label: 'SOURCE PLATFORMS',
      query: `${companyName} ${platformQuery}`,
      goal: `Find platform-specific conversation signals only from enabled sources: ${sourcePlatforms.map((key) => PLATFORM_LABELS[key] || key).join(', ')}.`,
    }] : []),
  ];
}

// ─── Core builder ─────────────────────────────────────────────────────────────

/**
 * Build a generic runtime config from a Firestore client_configs document.
 *
 * This is used when the client is not in the static registry (newly provisioned
 * clients). The runtime config shape is identical to the static registry shape
 * so all pipeline modules (xscout, scribe, guardian) can consume it without changes.
 *
 * @param {string} clientId
 * @param {object} clientConfig - client_configs/{clientId} document from Firestore
 */
function buildRuntimeConfigFromFirestore(clientId, clientConfig) {
  const sourceInputs = clientConfig?.sourceInputs || {};
  const marketingBriefConfig = clientConfig?.marketingBriefConfig || null;
  const websiteUrl = String(sourceInputs.websiteUrl || '');
  const ideaDescription = String(sourceInputs.ideaDescription || '').trim();
  const hostname = extractHostname(websiteUrl);
  const companyName = deriveCompanyName(hostname, clientId);
  const configuredKols = Array.isArray(marketingBriefConfig?.kols) ? marketingBriefConfig.kols.filter(Boolean) : [];
  const configuredCompetitors = Array.isArray(marketingBriefConfig?.competitors) ? marketingBriefConfig.competitors.filter(Boolean) : [];
  const configuredSourceFocus = String(marketingBriefConfig?.sourceFocus || '').trim();
  const configuredScoutInstructions = String(marketingBriefConfig?.scoutInstructions || '').trim();
  const configuredAgentDataTemplate = String(marketingBriefConfig?.agentDataTemplate || '').trim();
  const freshnessDays = Math.max(1, Math.min(30, Number(marketingBriefConfig?.freshnessDays || 7)));
  const hasMarketingBriefConfig = Boolean(marketingBriefConfig);
  const sourcePlatforms = hasMarketingBriefConfig
    ? normalizeSourcePlatforms(marketingBriefConfig?.sourcePlatforms)
    : ['web'];
  const enabledPlatformLabels = sourcePlatforms.map((key) => PLATFORM_LABELS[key] || key);
  const configuredSearchText = Array.isArray(marketingBriefConfig?.searches)
    ? marketingBriefConfig.searches.map((row) => `${row?.label || ''} ${row?.query || ''} ${row?.goal || ''}`).join(' ')
    : '';
  const viralTriggers = configuredSearchText
    .split(/\bOR\b|,|\n/gi)
    .map((item) => item.trim().replace(/^["']|["']$/g, ''))
    .filter((item) => item.length > 3)
    .slice(0, 12);

  return {
    clientId,
    clientName: companyName,
    clientDescriptor: ideaDescription || `a business at ${websiteUrl || clientId}`,
    websiteUrl,
    brandKeywords: [
      companyName ? `"${companyName}"` : null,
      hostname ? `"${hostname}"` : null,
    ].filter(Boolean),
    competitors: configuredCompetitors,
    categoryTerms: ideaDescription
      ? ideaDescription.split(/[,.\n]+/).map((t) => t.trim()).filter(Boolean).slice(0, 6)
      : [],
    kols: configuredKols,
    upcomingEvents: [],

    scout: {
      freshnessDays,
      sourceFocus: configuredSourceFocus || (ideaDescription
        ? `Focus on "${ideaDescription}". Find market signals, competitor activity, content opportunities, and audience conversations relevant to ${websiteUrl || companyName}.`
        : `Focus on brand signals, competitor activity, and content opportunities for ${websiteUrl || companyName}.`),
      analysisInstructions: configuredScoutInstructions || (hasMarketingBriefConfig
        ? 'Prioritize live community momentum, current news, sentiment shifts, KOL windows, and moments where the brand can credibly enter the conversation.'
        : undefined),
      sourcePlatforms,
      enabledSourceLabels: enabledPlatformLabels,
      preferredSources: enabledPlatformLabels,
      searchPlan: buildSearchPlan({ websiteUrl, ideaDescription, hostname, companyName, marketingBriefConfig, sourcePlatforms }),
      agentDataTemplate: configuredAgentDataTemplate || (hasMarketingBriefConfig ? MARKETING_BRIEF_AGENT_DATA_TEMPLATE : DEFAULT_AGENT_DATA_TEMPLATE),
    },

    intelligence: hasMarketingBriefConfig ? MARKETING_BRIEF_INTELLIGENCE_CONFIG : DEFAULT_INTELLIGENCE_CONFIG,

    viralTargets: {
      hashtags: [],
      injectableTopics: [
        ...(ideaDescription ? [ideaDescription] : []),
        ...configuredKols,
        ...configuredCompetitors,
      ].slice(0, 20),
      viralTriggers,
      exclusions: ['politics', 'lawsuit', 'hack', 'exploit', 'scam'],
    },

    last30days: sourcePlatforms.some((key) => ['x', 'reddit', 'instagram', 'youtube', 'tiktok', 'hackernews'].includes(key)) ? {
      enabled: true,
      primaryTopic: [
        companyName,
        ideaDescription,
        configuredCompetitors.join(' '),
        configuredKols.join(' '),
      ].filter(Boolean).join(' '),
      sources: sourcePlatforms
        .filter((key) => ['x', 'reddit', 'instagram', 'youtube', 'tiktok', 'hackernews'].includes(key))
        .join(','),
      lookbackDays: freshnessDays,
      subreddits: sourcePlatforms.includes('reddit') ? 'all' : '',
      brandTerms: [companyName, hostname].filter(Boolean),
      competitorNames: configuredCompetitors,
    } : { enabled: false },

    scribe: {
      role: hasMarketingBriefConfig ? 'founder brief content strategist' : 'content writer',
      fallbackTone: hasMarketingBriefConfig
        ? `Tone: sharp, timely, founder-ready, specific to ${companyName}.\nPrioritize concrete market signals, KOL windows, and X/Twitter-ready angles. Never use generic hype language, forced urgency, or empty superlatives.`
        : `Tone: clear, credible, human, specific to ${companyName}.\nNever use: generic hype language, forced urgency, or empty superlatives.`,
      pillarHints: hasMarketingBriefConfig ? {
        CRITICAL: 'urgent market response — the founder needs a fast, concrete communication angle.',
        IMPORTANT: 'timely market participation — lead with the live signal and the opening for the brand.',
        QUIET: 'signal creation — no live mention means create a useful, current conversation starter.',
      } : undefined,
      hardConstraints: hasMarketingBriefConfig ? [
        'Every piece connects to Scout\'s priority action',
        'Zero live signal = create signal, not react to it',
        'Never fabricate competitor activity',
        'Never make claims Scout did not surface',
        'Prioritize X/Twitter-ready hooks and credible reply windows',
        'Make the Content Angle useful to a founder deciding what to say today',
        'Each output complete and ready to copy-paste',
      ] : undefined,
    },

    guardian: {
      reviewerContext: ideaDescription || `a business at ${websiteUrl || clientId}`,
      competitorNames: configuredCompetitors,
      restrictedPatterns: [],
    },

    providerConfig: clientConfig?.providerConfig || { defaultProvider: 'anthropic' },
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load a runtime config for a given clientId.
 *
 * Strategy:
 *   1. If firestoreClientConfig is provided, build a runtime config from it.
 *      This is the production path — used by the Phase 3 worker.
 *   2. If the clientId is in the static registry, use that config.
 *      This is the local dev path — used by run.js and standalone module execution.
 *   3. Otherwise throw — cannot run without a config source.
 *
 * @param {string} clientId
 * @param {object|null} [firestoreClientConfig] - client_configs/{clientId} Firestore doc
 */
function loadRuntimeConfig(clientId, firestoreClientConfig = null) {
  if (firestoreClientConfig) {
    return buildRuntimeConfigFromFirestore(clientId, firestoreClientConfig);
  }

  const staticConfig = getClientConfig(clientId);
  if (staticConfig) {
    return staticConfig;
  }

  throw new Error(
    `No runtime config found for clientId "${clientId}". ` +
    `Pass a Firestore client_config document or add the client to the static registry in clients.js.`
  );
}

module.exports = {
  buildRuntimeConfigFromFirestore,
  loadRuntimeConfig,
};
