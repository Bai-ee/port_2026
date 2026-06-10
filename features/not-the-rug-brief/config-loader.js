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

// In every schema below, "url" MUST be the canonical permalink of the SPECIFIC
// post / thread / comment / article being cited — never a profile page,
// homepage, or search results page. Omit the field if you cannot locate the
// post permalink. "profileUrl" is an optional separate field for the author's
// profile page. See the SOURCE LINK RULE block in xscout.js for full per-
// platform format rules.

const DEFAULT_AGENT_DATA_TEMPLATE = `{
  "brandMentions": [{"source":"...","author":"...","content":"...","sentiment":"positive|neutral|negative","reach":"high|medium|low","url":"<post permalink — not profile or homepage>"}],
  "competitorIntel": [{"competitor":"...","finding":"...","impact":"high|medium|low","url":"<post permalink — not profile or homepage>"}],
  "categoryTrends": [{"trend":"...","relevance":"high|medium|low","detail":"...","url":"<post or article permalink, optional>"}],
  "contentOpportunities": {
    "found": true,
    "opportunities": [{"topic":"...","whyNow":"...","format":"...","priority":"high|medium|low","source":"...","url":"<post permalink — not profile or homepage>"}],
    "searchedFor": ["trigger 1","trigger 2"]
  },
  "escalations": [{"level":"CRITICAL|IMPORTANT|QUIET","status":"NEW|CHANGED|ESCALATED|RESOLVED","summary":"..."}]
}`;

const MARKETING_BRIEF_AGENT_DATA_TEMPLATE = `{
  "brandMentions": [{"source":"...","author":"...","content":"...","sentiment":"positive|neutral|negative","reach":"high|medium|low","url":"<post permalink — not profile or homepage>"}],
  "competitorIntel": [{"competitor":"...","finding":"...","impact":"high|medium|low","url":"<post permalink — not profile or homepage>"}],
  "categoryTrends": [{"trend":"...","relevance":"high|medium|low","detail":"...","url":"<post or article permalink, optional>"}],
  "kolActivity": [{"name":"...","platform":"x","content":"...","followers":"...","sentiment":"...","url":"<post permalink — the specific tweet/comment, not the profile>","profileUrl":"<author profile URL, optional>"}],
  "escalations": [{"level":"CRITICAL|IMPORTANT|QUIET","status":"NEW|CHANGED|ESCALATED|RESOLVED","summary":"..."}],
  "viralOpportunities": {
    "found": true,
    "opportunities": [{"conversation":"...","url":"<permalink of the specific conversation/thread to engage with>","injectionAngle":"...","authenticity":"high|medium|low","windowHours":0,"suggestedReply":"..."}],
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
const DEFAULT_SOURCE_PLATFORMS = ['web', 'x', 'reddit', 'hackernews', 'instagram'];
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

// Site-restricted query templates per platform. Each emits a focused
// `site:<host>` search so Claude's web_search can probe one platform at a
// time — much higher hit rate than a single OR'd super-query.
const PLATFORM_SITE_QUERIES = {
  reddit:     { host: 'reddit.com',             label: 'REDDIT' },
  hackernews: { host: 'news.ycombinator.com',   label: 'HACKER NEWS' },
  youtube:    { host: 'youtube.com',            label: 'YOUTUBE' },
  // X tweet permalinks are indexed by Google but x.com is the canonical
  // host; site:x.com OR site:twitter.com catches both.
  x:          { host: 'x.com OR site:twitter.com', label: 'X / TWITTER' },
  // Instagram & TikTok are mostly anti-crawl — site: queries rarely return
  // useful results. We still emit the row so users see the attempt, but
  // expect thin output until last30days/ScrapeCreators can reach them.
  instagram:  { host: 'instagram.com',          label: 'INSTAGRAM' },
  tiktok:     { host: 'tiktok.com',             label: 'TIKTOK' },
};

// One dedicated search row per enabled non-web platform. The subject is
// "<brand> <category>" so the search is grounded in the client's beat.
function buildPerPlatformSearchRows({ companyName, ideaDescription, sourcePlatforms = [] }) {
  const subject = [companyName, ideaDescription ? ideaDescription.split(/\s+/).slice(0, 4).join(' ') : '']
    .filter(Boolean)
    .join(' ')
    .trim() || companyName;
  return sourcePlatforms
    .filter((key) => PLATFORM_SITE_QUERIES[key])
    .map((key) => {
      const spec = PLATFORM_SITE_QUERIES[key];
      return {
        label: spec.label,
        query: `site:${spec.host} ${subject}`,
        goal: `Find ${PLATFORM_LABELS[key] || key} threads/posts/videos directly via web search using a site-restricted query.`,
      };
    });
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

// Build dedicated searches for the watchlist (marketingBriefConfig.kols).
// These ALWAYS run — even when custom searches exist — so the configured
// accounts are actually queried by name (per-handle) or together (combined),
// instead of being silently skipped. Each handle is its own search so its
// results land in their own bucket and don't overwrite other queries.
function buildKolSearches({ marketingBriefConfig, companyName }) {
  const kols = Array.isArray(marketingBriefConfig?.kols)
    ? marketingBriefConfig.kols.map((k) => String(k || '').trim()).filter((k) => k.replace(/^@+/, '').trim().length >= 2)
    : [];
  if (!kols.length) return [];
  const brand = companyName || 'the brand';
  const mode = marketingBriefConfig?.kolSearchMode === 'combined' ? 'combined' : 'per-handle';
  if (mode === 'combined') {
    return [{
      label: 'WATCHLIST',
      query: kols.join(' OR '),
      goal: `Report recent activity from each watched account (${kols.join(', ')}). Note what each posted and flag anything worth a ${brand} narrative — even if not brand-specific.`,
    }];
  }
  return kols.map((handle) => ({
    label: `WATCHLIST ${handle}`,
    query: handle,
    goal: `Report ${handle}'s recent posts/activity. Attribute findings to ${handle} by name and flag anything worth a ${brand} narrative push, even if not brand-specific.`,
  }));
}

function buildSearchPlan({ websiteUrl, ideaDescription, hostname, companyName, brandKeywords = [], categoryTerms = [], marketingBriefConfig = null, sourcePlatforms = DEFAULT_SOURCE_PLATFORMS }) {
  const configuredSearches = Array.isArray(marketingBriefConfig?.searches)
    ? marketingBriefConfig.searches
        .map((row, index) => ({
          label: String(row?.label || `SEARCH ${index + 1}`).trim(),
          query: String(row?.query || '').trim(),
          goal:  String(row?.goal || '').trim() || 'Find timely signals the brand can act on.',
        }))
        .filter((row) => row.query)
    : [];

  const perPlatformRows = buildPerPlatformSearchRows({ companyName, ideaDescription, sourcePlatforms });
  const kolRows = buildKolSearches({ marketingBriefConfig, companyName });

  // De-dupe: don't append a row whose label collides with an existing row
  // (case-insensitive match on label OR same query string).
  const isDuplicate = (row, existing) => existing.some((e) =>
    e.label.toLowerCase() === row.label.toLowerCase() || e.query === row.query
  );
  const appendNovel = (base, rows) => {
    const out = [...base];
    for (const row of rows) { if (!isDuplicate(row, out)) out.push(row); }
    return out;
  };

  if (configuredSearches.length > 0) {
    // Watchlist searches run even alongside custom searches — they were
    // previously skipped, which is why named handles never got queried.
    return appendNovel(configuredSearches, [...kolRows, ...perPlatformRows]);
  }

  const brandTokens = Array.isArray(brandKeywords) && brandKeywords.length
    ? brandKeywords.map((t) => (/\s/.test(t) && !/^".*"$/.test(t) ? `"${t}"` : t))
    : [`"${companyName}"`, hostname ? `"${hostname}"` : null];
  const brandQuery = [...brandTokens, hostname ? `site:${hostname}` : null]
    .filter(Boolean)
    .join(' OR ');

  const categoryQuery = Array.isArray(categoryTerms) && categoryTerms.length
    ? categoryTerms.slice(0, 4).join(' OR ')
    : null;
  const ideaTerms = ideaDescription
    ? ideaDescription.split(/[\s,./]+/).filter((t) => t.length > 3).slice(0, 6).join(' OR ')
    : null;

  const resolvedCategoryQuery = categoryQuery || ideaTerms || `${companyName} industry trends 2026`;
  const opportunitySubject = Array.isArray(categoryTerms) && categoryTerms.length
    ? categoryTerms[0]
    : (ideaDescription ? ideaDescription.split(/\s+/).slice(0, 4).join(' ') : companyName);
  const opportunityQuery = (categoryQuery || ideaDescription)
    ? `best ${opportunitySubject} recommendations OR alternatives OR problems`
    : `${companyName} reviews OR ${hostname} competitors`;

  const defaultPlan = [
    {
      label: 'BRAND',
      query: brandQuery,
      goal: 'Find direct brand mentions, direct web coverage, and community discussion.',
    },
    {
      label: 'CATEGORY',
      query: resolvedCategoryQuery,
      goal: 'Capture broader category movement and external narratives the brand can react to.',
    },
    {
      label: 'CONTENT OPPORTUNITIES',
      query: opportunityQuery,
      goal: 'Find live conversations and topics where the brand can contribute credibly.',
    },
  ];

  return appendNovel(defaultPlan, [...kolRows, ...perPlatformRows]);
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
  const scoutConfig = clientConfig?.scoutConfig || null;
  const websiteUrl = String(sourceInputs.websiteUrl || '');
  const ideaDescription = String(sourceInputs.ideaDescription || '').trim();
  const hostname = extractHostname(websiteUrl);
  // Brand identity is canonical in scoutConfig (the audit store, kept in sync by
  // the Brand & Keywords card save → scoutConfig mirror). Read scoutConfig first
  // so a Run resolves the same brandKeywords / categoryTerms / clientName the
  // audit and external scouts use; fall back to the card config, then to derived.
  // These drive the BRAND search row, the X/last30days topic, and Reddit mentions.
  const cleanList = (arr) => (Array.isArray(arr) ? arr.map((s) => String(s || '').trim()).filter(Boolean) : []);
  const configuredBrandName = String(scoutConfig?.clientName || marketingBriefConfig?.brandName || '').trim();
  const scoutBrandKeywords = cleanList(scoutConfig?.brandKeywords);
  const configuredBrandKeywords = scoutBrandKeywords.length
    ? scoutBrandKeywords
    : cleanList(marketingBriefConfig?.brandKeywords);
  const scoutCategoryTerms = cleanList(scoutConfig?.categoryTerms);
  const configuredCategoryTerms = scoutCategoryTerms.length
    ? scoutCategoryTerms
    : cleanList(marketingBriefConfig?.categoryTerms);
  const companyName = configuredBrandName || deriveCompanyName(hostname, clientId);
  const configuredKols = Array.isArray(marketingBriefConfig?.kols) ? marketingBriefConfig.kols.filter(Boolean) : [];
  const configuredCompetitors = Array.isArray(marketingBriefConfig?.competitors) ? marketingBriefConfig.competitors.filter(Boolean) : [];
  const configuredSourceFocus = String(marketingBriefConfig?.sourceFocus || '').trim();
  const configuredScoutInstructions = String(marketingBriefConfig?.scoutInstructions || '').trim();
  const configuredAgentDataTemplate = String(marketingBriefConfig?.agentDataTemplate || '').trim();
  const configuredScribeTone = String(marketingBriefConfig?.scribeTone || '').trim();
  const configuredScribeHardConstraints = Array.isArray(marketingBriefConfig?.scribeHardConstraints)
    ? marketingBriefConfig.scribeHardConstraints.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const configuredGuardianReviewerContext = String(marketingBriefConfig?.guardianReviewerContext || '').trim();
  const configuredGuardianRestrictedPatterns = Array.isArray(marketingBriefConfig?.guardianRestrictedPatterns)
    ? marketingBriefConfig.guardianRestrictedPatterns.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
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
    brandKeywords: configuredBrandKeywords.length
      ? configuredBrandKeywords.map((t) => (/^".*"$/.test(t) ? t : `"${t}"`))
      : [
          companyName ? `"${companyName}"` : null,
          hostname ? `"${hostname}"` : null,
        ].filter(Boolean),
    competitors: configuredCompetitors,
    categoryTerms: configuredCategoryTerms.length
      ? configuredCategoryTerms
      : (ideaDescription
        ? ideaDescription.split(/[,.\n]+/).map((t) => t.trim()).filter(Boolean).slice(0, 6)
        : []),
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
      searchPlan: buildSearchPlan({ websiteUrl, ideaDescription, hostname, companyName, brandKeywords: configuredBrandKeywords, categoryTerms: configuredCategoryTerms, marketingBriefConfig, sourcePlatforms }),
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

    // Dedicated Reddit scout for the daily brief. Only emitted when the user
    // toggled Reddit as a source platform. provider 'web-search' = credential-free
    // site:reddit.com via Claude web_search (no Reddit OAuth needed). Queries are
    // sourced from the Marketing Director's generated scoutConfig.reddit; brand
    // mention queries fall back to the company name so a brand-new config still
    // returns mentions. Note: runRedditWebSearch requires ≥1 subreddit to run.
    reddit: sourcePlatforms.includes('reddit') ? (() => {
      const sr = clientConfig?.scoutConfig?.reddit || {};
      const toList = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
      const mentions = toList(sr.mentionQueries);
      return {
        provider:           'web-search',
        subreddits:         toList(sr.subreddits),
        mentionQueries:     mentions.length ? mentions : [companyName].filter(Boolean),
        opportunityQueries: toList(sr.opportunityQueries),
      };
    })() : undefined,

    scribe: {
      role: hasMarketingBriefConfig ? 'founder brief content strategist' : 'content writer',
      fallbackTone: configuredScribeTone || (hasMarketingBriefConfig
        ? `Tone: sharp, timely, founder-ready, specific to ${companyName}.\nPrioritize concrete market signals, KOL windows, and X/Twitter-ready angles. Never use generic hype language, forced urgency, or empty superlatives.`
        : `Tone: clear, credible, human, specific to ${companyName}.\nNever use: generic hype language, forced urgency, or empty superlatives.`),
      pillarHints: hasMarketingBriefConfig ? {
        CRITICAL: 'urgent market response — the founder needs a fast, concrete communication angle.',
        IMPORTANT: 'timely market participation — lead with the live signal and the opening for the brand.',
        QUIET: 'signal creation — no live mention means create a useful, current conversation starter.',
      } : undefined,
      hardConstraints: configuredScribeHardConstraints.length > 0
        ? configuredScribeHardConstraints
        : (hasMarketingBriefConfig ? [
            'Every piece connects to Scout\'s priority action',
            'Zero live signal = create signal, not react to it',
            'Never fabricate competitor activity',
            'Never make claims Scout did not surface',
            'Prioritize X/Twitter-ready hooks and credible reply windows',
            'Make the Content Angle useful to a founder deciding what to say today',
            'Each output complete and ready to copy-paste',
          ] : undefined),
    },

    guardian: {
      reviewerContext: configuredGuardianReviewerContext || ideaDescription || `a business at ${websiteUrl || clientId}`,
      competitorNames: configuredCompetitors,
      restrictedPatterns: configuredGuardianRestrictedPatterns,
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
