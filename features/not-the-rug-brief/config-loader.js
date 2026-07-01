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

// Agent data contract v2.
//
// Key additions over v1:
//   runMeta       — timestamp, freshness window, queryTrace (audit trail of what was searched)
//   emptySections — machine-readable "Scout looked and found nothing" list; prevents Scribe
//                   from inferring absence = "didn't look" and fabricating content
//   signalType    — LIVE|BACKGROUND on each item; makes the routing tag machine-readable
//                   instead of prose-only so Scribe can sort/route without guessing
//   ageHours      — per-item recency; enables freshness-based ordering downstream
//   url on escalations — ties each escalation to its source item

const DEFAULT_AGENT_DATA_TEMPLATE = `{
  "runMeta": {
    "timestamp": "<ISO-8601>",
    "freshnessWindowDays": 1,
    "queryTrace": ["<exact query string used for each search>"]
  },
  "emptySections": ["<array of section names where Scout searched and found nothing, e.g. brandMentions>"],
  "brandMentions": [{"source":"...","author":"...","content":"...","sentiment":"positive|neutral|negative","reach":"high|medium|low","signalType":"LIVE|BACKGROUND","ageHours":0,"url":"<post permalink — not profile or homepage>"}],
  "competitorIntel": [{"competitor":"...","finding":"...","impact":"high|medium|low","signalType":"LIVE|BACKGROUND","ageHours":0,"url":"<post permalink — not profile or homepage>"}],
  "categoryTrends": [{"trend":"...","relevance":"high|medium|low","detail":"...","ageHours":0,"url":"<post or article permalink, optional>"}],
  "contentOpportunities": {
    "found": true,
    "opportunities": [{"topic":"...","whyNow":"...","format":"...","priority":"high|medium|low","source":"...","url":"<post permalink — not profile or homepage>"}],
    "searchedFor": ["trigger 1","trigger 2"]
  },
  "escalations": [{"level":"CRITICAL|IMPORTANT|QUIET","status":"NEW|CHANGED|ESCALATED|RESOLVED","summary":"...","url":"<source permalink, optional>"}]
}`;

const MARKETING_BRIEF_AGENT_DATA_TEMPLATE = `{
  "runMeta": {
    "timestamp": "<ISO-8601>",
    "freshnessWindowDays": 1,
    "queryTrace": ["<exact query string used for each search>"]
  },
  "emptySections": ["<array of section names where Scout searched and found nothing, e.g. brandMentions, kolActivity>"],
  "brandMentions": [{"source":"...","author":"...","content":"...","sentiment":"positive|neutral|negative","reach":"high|medium|low","signalType":"LIVE|BACKGROUND","ageHours":0,"url":"<post permalink — not profile or homepage>"}],
  "competitorIntel": [{"competitor":"...","finding":"...","impact":"high|medium|low","signalType":"LIVE|BACKGROUND","ageHours":0,"url":"<post permalink — not profile or homepage>"}],
  "categoryTrends": [{"trend":"...","relevance":"high|medium|low","detail":"...","ageHours":0,"url":"<post or article permalink, optional>"}],
  "kolActivity": [{"name":"...","platform":"x","content":"...","followers":"...","sentiment":"positive|neutral|negative","signalType":"LIVE|BACKGROUND","ageHours":0,"url":"<post permalink — the specific tweet/comment, not the profile>","profileUrl":"<author profile URL, optional>"}],
  "escalations": [{"level":"CRITICAL|IMPORTANT|QUIET","status":"NEW|CHANGED|ESCALATED|RESOLVED","summary":"...","url":"<source permalink, optional>"}],
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

function buildSearchPlan({ websiteUrl, ideaDescription, hostname, companyName, brandKeywords = [], categoryTerms = [], marketingBriefConfig = null, sourcePlatforms = DEFAULT_SOURCE_PLATFORMS, audienceSignals = [] }) {
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
  // Prefer positioning-derived audience signal queries over generic "best X alternatives".
  // Audience signals look for sub-layer conversations — where the target audience is
  // discussing the pain point BEFORE they found this brand. Much higher signal quality.
  const audienceQuery = Array.isArray(audienceSignals) && audienceSignals.length
    ? audienceSignals.slice(0, 3).join(' OR ')
    : null;
  const opportunityQuery = audienceQuery
    || ((categoryQuery || ideaDescription)
      ? `best ${opportunitySubject} recommendations OR alternatives OR problems`
      : `${companyName} reviews OR ${hostname} competitors`);

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
      goal: audienceQuery
        ? 'Find sub-layer conversations where the target audience is discussing their pain points — the communities and threads this brand is positioned to answer.'
        : 'Find live conversations and topics where the brand can contribute credibly.',
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
  const positioningContext = scoutConfig?.positioningContext || null;
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
  const configuredIgHandles = Array.isArray(marketingBriefConfig?.instagramHandles) ? marketingBriefConfig.instagramHandles.filter(Boolean) : [];
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

  // Resolved category terms (card values, else split from the idea) — reused by
  // the category row, last30days topic, and the Reddit opportunity fallback.
  const resolvedCategoryTerms = configuredCategoryTerms.length
    ? configuredCategoryTerms
    : (ideaDescription
      ? ideaDescription.split(/[,.\n]+/).map((t) => t.trim()).filter(Boolean).slice(0, 6)
      : []);
  // Clean X handle list for last30days --x-related (handles must NOT go in the topic).
  const cleanXHandles = configuredKols
    .map((h) => String(h || '').trim().replace(/^@+/, ''))
    .filter((h) => h.length >= 2)
    .slice(0, 6);
  // Clean Instagram creator handles for last30days --ig-creators (accounts to watch).
  const cleanIgHandles = configuredIgHandles
    .map((h) => String(h || '').trim().replace(/^@+/, ''))
    .filter((h) => h.length >= 2)
    .slice(0, 6);
  // A CLEAN last30days topic: brand + a few category terms only. Competitor URLs
  // and @handles jammed into the topic malformed the X/Bird query and it failed.
  const cleanLast30Topic = [companyName, ...resolvedCategoryTerms.slice(0, 3)]
    .filter(Boolean).join(' ').slice(0, 120);

  // Saved events (Events card) → upcomingEvents with computed daysOut.
  // Past events are dropped; horizon capped at 60 days out.
  const nowMs = Date.now();
  const upcomingEvents = (Array.isArray(marketingBriefConfig?.events) ? marketingBriefConfig.events : [])
    .map((e) => {
      const dateMs = Date.parse(`${e?.date}T12:00:00`);
      if (Number.isNaN(dateMs)) return null;
      const daysOut = Math.round((dateMs - nowMs) / 86400000);
      if (daysOut < 0 || daysOut > 60) return null;
      return {
        event: String(e.event || '').trim(),
        date: e.date,
        daysOut,
        location: String(e.location || '').trim(),
        url: String(e.url || '').trim(),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.daysOut - b.daysOut)
    .slice(0, 12);

  // Custom user-entered local signals (Events card free-form rows). Merged into
  // the brief's Local Signals at hydration — never overwritten by Scout output.
  const customLocalSignals = Array.isArray(marketingBriefConfig?.localSignals)
    ? marketingBriefConfig.localSignals.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 12)
    : [];

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
    categoryTerms: resolvedCategoryTerms,
    kols: configuredKols,
    instagramHandles: configuredIgHandles,
    upcomingEvents,
    customLocalSignals,

    scout: {
      freshnessDays,
      sourceFocus: configuredSourceFocus || (() => {
        const posAudienceHint = positioningContext?.audienceSignals?.length
          ? ` Prioritize conversations where the target audience discusses their pain points: ${positioningContext.audienceSignals.slice(0, 2).join('; ')}.`
          : '';
        return ideaDescription
          ? `Focus on "${ideaDescription}". Find market signals, competitor activity, content opportunities, and audience conversations relevant to ${websiteUrl || companyName}.${posAudienceHint}`
          : `Focus on brand signals, competitor activity, and content opportunities for ${websiteUrl || companyName}.${posAudienceHint}`;
      })(),
      analysisInstructions: configuredScoutInstructions || (hasMarketingBriefConfig
        ? 'Prioritize live community momentum, current news, sentiment shifts, KOL windows, and moments where the brand can credibly enter the conversation.'
        : undefined),
      sourcePlatforms,
      enabledSourceLabels: enabledPlatformLabels,
      preferredSources: enabledPlatformLabels,
      searchPlan: buildSearchPlan({ websiteUrl, ideaDescription, hostname, companyName, brandKeywords: configuredBrandKeywords, categoryTerms: configuredCategoryTerms, marketingBriefConfig, sourcePlatforms, audienceSignals: positioningContext?.audienceSignals }),
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
      // Merge custom search triggers with positioning-derived sub-layer triggers.
      // Positioning triggers look for community conversations about the problem
      // BEFORE someone found a solution — the most valuable search real-estate.
      viralTriggers: [
        ...viralTriggers,
        ...(positioningContext?.viralTriggers || []),
      ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 12),
      exclusions: ['politics', 'lawsuit', 'hack', 'exploit', 'scam'],
    },

    last30days: sourcePlatforms.some((key) => ['x', 'reddit', 'instagram', 'youtube', 'tiktok', 'hackernews'].includes(key)) ? {
      enabled: true,
      primaryTopic: cleanLast30Topic || companyName,
      sources: sourcePlatforms
        .filter((key) => ['x', 'reddit', 'instagram', 'youtube', 'tiktok', 'hackernews'].includes(key))
        .join(','),
      // Social sources are sparse over 1 day — widen to at least a week.
      lookbackDays: Math.max(7, freshnessDays),
      xRelated: cleanXHandles.join(','),
      igCreators: cleanIgHandles.join(','),
      subreddits: sourcePlatforms.includes('reddit') ? 'all' : '',
      brandTerms: [companyName, hostname].filter(Boolean),
      competitorNames: configuredCompetitors,
    } : { enabled: false },

    // Dedicated Reddit scout for the daily brief. Only emitted when the user
    // toggled Reddit as a source platform. provider 'web-search' = credential-free
    // site:reddit.com via search-engine indexing (DuckDuckGo) — no Reddit OAuth or
    // API. Queries come from the Marketing Director's scoutConfig.reddit, falling
    // back to brand keywords (mentions) and category + competitors (opportunities)
    // so a sparse config still searches. Same shape the Test cards use.
    reddit: sourcePlatforms.includes('reddit') ? (() => {
      const sr = clientConfig?.scoutConfig?.reddit || {};
      const toList = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
      const mentions = toList(sr.mentionQueries);
      const opps = toList(sr.opportunityQueries);
      const brandFallback = [companyName, ...configuredBrandKeywords.map((t) => t.replace(/^["']|["']$/g, ''))].filter(Boolean).slice(0, 4);
      const oppFallback = [...resolvedCategoryTerms, ...configuredCompetitors].filter(Boolean).slice(0, 4);
      return {
        provider:           'web-search',
        subreddits:         toList(sr.subreddits),
        mentionQueries:     mentions.length ? mentions : brandFallback,
        opportunityQueries: opps.length ? opps : oppFallback,
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
