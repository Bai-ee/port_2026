'use strict';

// source-inventory.js — Source of truth for what each scout source collects,
// how it collects it, and what raw payload it returns. Read by:
//   - /api/admin/scout-data-map (admin UI data map)
//   - docs/SCOUT_DATA_MAP.md   (written by hand, kept aligned with this file)
//
// Source IDs here MUST match the strings used in card-contract.js `sources: []`.

const SOURCE_INVENTORY = [
  {
    id: 'site.html',
    label: 'Site HTML',
    category: 'site',
    collection: {
      method: 'fetch() (Node)',
      detail: 'HTTP GET per page. UA = "Mozilla/5.0 (compatible; BrandintelBot/1.0)". 8s timeout per page. Regex extraction — no DOM parser.',
      auth: 'none',
      costPerRun: 'free',
      file: 'features/scout-intake/site-fetcher.js',
    },
    payloadFields: [
      'pages[].url',
      'pages[].type (homepage|about|pricing|services|contact)',
      'pages[].title',
      'pages[].metaDescription',
      'pages[].h1 (≤150ch each)',
      'pages[].h2 (≤150ch each, 10 max)',
      'pages[].navLabels (2–50ch, 14 unique max)',
      'pages[].ctaTexts (2–80ch, 6 unique max)',
      'pages[].bodyParagraphs (40–600ch, sliced to 300, 8 max)',
      'pages[].socialLinks (8 unique max)',
      'pages[].contactClues (email + phone, 4 max, prefixed)',
      'thin (boolean — under 200ch total body text)',
      'warnings[]',
    ],
    freshness: 'Per pipeline run. Not cached.',
  },
  {
    id: 'site.meta',
    label: 'Site Meta (OG + favicon)',
    category: 'site',
    collection: {
      method: 'regex over homepage HTML',
      detail: 'OG + Twitter + link-rel extraction with priority order. URLs resolved to absolute via new URL().',
      auth: 'none',
      costPerRun: 'free',
      file: 'features/scout-intake/site-fetcher.js::extractSiteMeta',
    },
    payloadFields: [
      'title (og:title → twitter:title → <title>)',
      'description (og → twitter → meta[name=description])',
      'siteName (og:site_name → hostname)',
      'ogImage (og:image → og:image:secure_url → twitter:image)',
      'ogImageAlt',
      'favicon (link[rel=icon|shortcut icon])',
      'appleTouchIcon (link[rel=apple-touch-icon])',
      'themeColor (meta[name=theme-color])',
      'canonical (link[rel=canonical])',
      'locale (og:locale → html[lang])',
      'type (og:type)',
    ],
    freshness: 'Per pipeline run. Homepage only.',
  },
  {
    id: 'synth.intake',
    label: 'Synthesis Intake',
    category: 'llm',
    collection: {
      method: 'Anthropic API · Claude Sonnet 4.5 · tool_use (forced)',
      detail: 'One call to write_brand_intake tool over formatted site evidence. 4096 max tokens.',
      auth: 'ANTHROPIC_API_KEY',
      costPerRun: '~$0.004–$0.012',
      file: 'features/scout-intake/intake-synthesizer.js',
    },
    payloadFields: [
      'snapshot.brandOverview.{headline,summary,industry,businessModel,targetAudience,positioning}',
      'snapshot.brandTone.{primary,secondary,tags[],writingStyle}',
      'snapshot.visualIdentity.{summary,colorPalette,styleNotes}',
      'signals.core[] (2–5, {label,summary,source,relevance})',
      'strategy.postStrategy.{approach,frequency,formats[]}',
      'strategy.contentAngles[] (3–5, {angle,rationale,format})',
      'strategy.opportunityMap[] (2–4, {opportunity,why,priority})',
      'outputsPreview.{samplePost,sampleCaption}',
      'systemPreview.{modulesUnlocked[],nextStep}',
    ],
    freshness: 'Per pipeline run.',
  },
  {
    id: 'synth.styleGuide',
    label: 'Design System Extractor',
    category: 'llm',
    collection: {
      method: 'Anthropic API · Claude Sonnet · CSS → design tokens',
      detail: 'Reads up to ~60KB of CSS, extracts typography/colors/layout/motion tokens. NOT YET WIRED into runner.',
      auth: 'ANTHROPIC_API_KEY',
      costPerRun: '~$0.01 when wired',
      file: 'features/scout-intake/design-system-extractor.js',
    },
    payloadFields: [
      'typography.{headingSystem,bodySystem}',
      'colors.{primary,secondary,neutral}',
      'layout.{grid,maxWidth,borderRadius}',
      'motion.{level,scrollPatterns[],durations[]}',
    ],
    freshness: 'N/A — unwired.',
  },
  {
    id: 'intel.pagespeed',
    label: 'PageSpeed Insights',
    category: 'intelligence',
    collection: {
      method: 'Google PageSpeed Insights REST API',
      detail: 'Mobile strategy by default. Runs on the canonical pipeline, not in scout-intake runner.',
      auth: 'PageSpeed API key (public, rate-limited)',
      costPerRun: 'free (rate-limited)',
      file: 'features/intelligence/pagespeed.js',
    },
    payloadFields: [
      'scores.{performance,accessibility,bestPractices,seo}',
      'coreWebVitals.{lcp,fid,cls,ttfb,fcp}',
      'metaCoverage (title, meta desc, viewport, lang)',
      'opportunities[]',
    ],
    freshness: 'On demand via intelligence rerun endpoint.',
  },
  {
    id: 'scout.reddit',
    label: 'Reddit Scout (web_search)',
    category: 'external-scout',
    collection: {
      method: 'Anthropic API · Sonnet + web_search tool (scoped to site:reddit.com)',
      detail: 'Credential-free alternative to Reddit OAuth. Uses scoutConfig.reddit.{subreddits,mentionQueries,opportunityQueries}. 5 web_search tool uses per run.',
      auth: 'ANTHROPIC_API_KEY',
      costPerRun: '~$0.02',
      file: 'features/scout-intake/external-scouts/reddit-web-search.js',
    },
    payloadFields: [
      'mentions[] (5 max, {title,subreddit,summary,insight,url})',
      'participationOpportunities[] (8 max, {title,subreddit,summary,opportunityType,whyRelevant,url})',
      'mentionCount, newMentionCount',
      'participationOpportunityCount, newParticipationOpportunityCount',
      'subreddits[]',
      'status, fetchedAt',
    ],
    freshness: 'Cached per client via external-scouts-store. Diff vs previous run.',
  },
  {
    id: 'scout.weather',
    label: 'Weather (NWS)',
    category: 'external-scout',
    collection: {
      method: 'National Weather Service REST API',
      detail: 'Public API. Gated on scoutConfig.weather.provider === "nws" + neighborhoods list. Only set for local, foot-traffic-sensitive clients.',
      auth: 'none (NWS_USER_AGENT header recommended)',
      costPerRun: 'free',
      file: 'features/not-the-rug-brief/services/weather.js',
    },
    payloadFields: [
      'overall.summary',
      'neighborhoods[].{name,lat,lon,forecast,alerts}',
      'operationalWindow',
    ],
    freshness: 'Per scout run.',
  },
  {
    id: 'scout.reviews',
    label: 'Reviews (web_search)',
    category: 'external-scout',
    collection: {
      method: 'Anthropic API · Sonnet + web_search tool',
      detail: 'Gated on scoutConfig.reviews.provider === "web-search" + sources list. Only set for clients with likely GMB/Yelp/TripAdvisor presence.',
      auth: 'ANTHROPIC_API_KEY',
      costPerRun: '~$0.02',
      file: 'features/not-the-rug-brief/services/reviews.js',
    },
    payloadFields: [
      'overallStatus (connected|partial|error)',
      'sources[].{key,label,status,rating,count,lastReviewedAt}',
      'sentimentDelta vs previous run',
    ],
    freshness: 'Cached per client. Diff vs previous run.',
  },
  {
    id: 'scoutConfig.brandKeywords',
    label: 'Scout Config · Brand Keywords',
    category: 'scout-config',
    collection: {
      method: 'Anthropic API · Sonnet (scout-config-generator)',
      detail: 'Generated once per client from intake + evidence. Cached at client_configs/{id}.scoutConfig.',
      auth: 'ANTHROPIC_API_KEY',
      costPerRun: '~$0.008 (one-time)',
      file: 'features/scout-intake/scout-config-generator.js',
    },
    payloadFields: ['brandKeywords[] (brand names, domain, taglines)'],
    freshness: 'Cached. Regenerate manually from admin UI.',
  },
  {
    id: 'scoutConfig.competitors',
    label: 'Scout Config · Competitors',
    category: 'scout-config',
    collection: {
      method: 'Anthropic API · Sonnet (scout-config-generator)',
      detail: 'Inferred from intake + category terms.',
      auth: 'ANTHROPIC_API_KEY',
      costPerRun: 'included in config gen',
      file: 'features/scout-intake/scout-config-generator.js',
    },
    payloadFields: ['competitors[] (prefixed INFERRED: ... when inferred)'],
    freshness: 'Cached.',
  },
  {
    id: 'scoutConfig.categoryTerms',
    label: 'Scout Config · Category Terms',
    category: 'scout-config',
    collection: {
      method: 'Anthropic API · Sonnet (scout-config-generator)',
      detail: 'Vertical + sub-vertical language for non-branded searches.',
      auth: 'ANTHROPIC_API_KEY',
      costPerRun: 'included in config gen',
      file: 'features/scout-intake/scout-config-generator.js',
    },
    payloadFields: ['categoryTerms[] (10 typical)'],
    freshness: 'Cached.',
  },
  {
    id: 'scoutConfig.searchPlan',
    label: 'Scout Config · Search Plan',
    category: 'scout-config',
    collection: {
      method: 'Anthropic API · Sonnet (scout-config-generator)',
      detail: '5-query plan: BRAND, COMPETITORS, CATEGORY, KOLS, VIRAL WINDOWS.',
      auth: 'ANTHROPIC_API_KEY',
      costPerRun: 'included in config gen',
      file: 'features/scout-intake/scout-config-generator.js',
    },
    payloadFields: [
      'searchPlan[] ({label,query,goal})',
      'freshnessDays',
      'sourceFocus (narrative)',
      'analysisInstructions (narrative)',
    ],
    freshness: 'Cached.',
  },
  {
    id: 'scoutConfig.capabilitiesActive',
    label: 'Scout Config · Capabilities',
    category: 'scout-config',
    collection: {
      method: 'Derived during config generation',
      detail: 'Which scout modules are active/inactive for this client. e.g. weather off for SaaS, reviews off for brands without GMB.',
      auth: 'ANTHROPIC_API_KEY',
      costPerRun: 'included in config gen',
      file: 'features/scout-intake/scout-config-generator.js',
    },
    payloadFields: [
      'capabilitiesActive[] (brandKeywords, competitors, categoryTerms, kols, reddit, scout, …)',
      'capabilitiesInactive[] ({id,reason})',
    ],
    freshness: 'Cached.',
  },
  {
    id: 'userContext',
    label: 'User Context (onboarding)',
    category: 'user',
    collection: {
      method: 'Form submission from onboarding flow',
      detail: 'Stored per client; injected into synth + scribe prompts.',
      auth: 'signed-in user',
      costPerRun: 'free',
      file: 'features/scout-intake/user-context.js',
    },
    payloadFields: [
      'stage',
      'intent',
      'services',
      'priority',
      'currentState',
      'blocker',
      'outputExpectation',
    ],
    freshness: 'Static until user re-onboards.',
  },
  {
    id: 'runtime.health',
    label: 'Runtime Health',
    category: 'runtime',
    collection: {
      method: 'derived from pipeline runtime state',
      detail: 'Aggregated at runtime from warnings[], stage cost data, evidence thinness, and pipeline stats. Passed only to skills that audit the run itself (run-health-audit).',
      auth: 'none (internal pipeline state)',
      costPerRun: 'free (no external call)',
      file: 'features/scout-intake/runner.js::buildRuntimeHealthPayload',
    },
    payloadFields: [
      'warnings[] ({ code, message, stage })',
      'pagesFetched (count of pages successfully fetched)',
      'thin (boolean — true if evidence.thin was set)',
      'costs ({ synth, styleGuide, scribe, aiSeo, total } in USD)',
      'stagesFailed[] (codes extracted from warnings — psi, fetch, synth, styleguide, scribe, ai-seo, etc.)',
      'pipelineDurationMs (wall time from start to normalize, when available)',
    ],
    freshness: 'Per run — computed fresh on every pipeline invocation.',
  },
  {
    id: 'image.homepageMockup',
    label: 'Homepage Full-Page Mockup',
    category: 'artifact',
    collection: {
      method: 'Read from dashboard_state.artifacts.fullPageScreenshots["desktop-full"] (or homepageDeviceMockup)',
      detail: 'Public URL of the full-page desktop screenshot captured by the multi-device-view module. Passed to vision-capable skills as an image content block.',
      auth: 'None (public download URL).',
      costPerRun: 'Vision tokens (~1500–3000 per image depending on resolution).',
      file: 'features/scout-intake/modules/design-evaluation.js',
    },
    payloadFields: [
      '{ __image: true, url: string }',
    ],
    freshness: 'Per run of multi-device-view module.',
  },
];

const SOURCES_BY_ID = Object.fromEntries(SOURCE_INVENTORY.map((s) => [s.id, s]));

function getSource(id) {
  return SOURCES_BY_ID[id] || null;
}

function sourcesByCategory(category) {
  return SOURCE_INVENTORY.filter((s) => s.category === category);
}

module.exports = {
  SOURCE_INVENTORY,
  SOURCES_BY_ID,
  getSource,
  sourcesByCategory,
};
