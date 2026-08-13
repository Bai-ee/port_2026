// Market Signals / Marketing Brief config builders — source-platform
// lists, scout search-row generators, and config stat helpers.
// Extracted from DashboardPage.jsx module scope (Phase 2 decomposition)
// — move-only, no behavior change.

export const MARKETING_BRIEF_SOURCE_PLATFORMS = [
  { key: 'web', label: 'Web / News', status: 'ready', description: 'Checks recent web results and news so the brief knows what people can find about your market.' },
  { key: 'x', label: 'X / Twitter', status: 'ready', description: 'Looks for timely posts and conversations your marketing director should know about.' },
  { key: 'reddit', label: 'Reddit', status: 'ready', description: 'Reads customer-style questions and complaints so the strategy uses real buyer language.' },
  { key: 'instagram', label: 'Instagram', status: 'ready', description: 'Reviews creator and brand activity so visual and social ideas stay current.' },
  { key: 'youtube', label: 'YouTube', status: 'available', description: 'Finds video discussions that can reveal education topics, objections, and content angles.' },
  { key: 'tiktok', label: 'TikTok', status: 'available', description: 'Checks short-form trends that may shape what your audience is watching right now.' },
  { key: 'hackernews', label: 'Hacker News', status: 'available', description: 'Reviews startup and technical discussions when they matter to the client category.' },
];
// Web + X are the free defaults; Reddit and Instagram are unlocked and default-on
// (both run on the last30days / ScrapeCreators engine). Everything else stays
// locked behind an upgrade.
export const UNLOCKED_SOURCE_PLATFORMS = ['web', 'x', 'reddit', 'instagram'];
export const DEFAULT_MARKETING_BRIEF_SOURCE_PLATFORMS = ['web', 'x', 'reddit', 'instagram'];
// Analysis skills that read the live Watchlist X timelines (watchlistTimelines /
// reply pool). When one of these is enabled, the report paths re-pull the current
// handles first so the skill never analyzes a stale pull from old handles.
export const WATCHLIST_RECIPE_IDS = ['watchlist-analysis', 'reply-targets'];
export const SEARCH_PLAN_CUSTOM_MAX = 8;
export const BRAND_KEYWORD_RECOMMENDED_MIN = 2;
export const BRAND_KEYWORD_RECOMMENDED_MAX = 6;
export const CATEGORY_TERM_RECOMMENDED_MIN = 3;
export const CATEGORY_TERM_RECOMMENDED_MAX = 6;
export const CATEGORY_TERMS_USED_IN_GENERATED_SEARCH = 4;
// Web Search + Platforms card — Web is the free, toggleable default; the launch
// and startup directories are locked until their search layer ships.
export const WEB_SEARCH_SOURCES = [
  { key: 'web',              label: 'Web / News',            locked: false, description: 'Checks the open web for useful market news, launches, and pages your audience may see.' },
  { key: 'producthunt',      label: 'Product Hunt',          locked: true },
  { key: 'betalist',         label: 'Betalist',              locked: true },
  { key: 'uneed',            label: 'Uneed',                 locked: true },
  { key: 'trustmrr',         label: 'TrustMRR',              locked: true },
  { key: 'fazier',           label: 'Fazier',                locked: true },
  { key: 'openalternative',  label: 'OpenAlternative',       locked: true },
  { key: 'microlaunch',      label: 'Microlaunch',           locked: true },
  { key: 'peerlist',         label: 'Peerlist',              locked: true },
  { key: 'tinylaunch',       label: 'TinyLaunch',            locked: true },
  { key: 'saashub',          label: 'SaaSHub',               locked: true },
  { key: 'indiehackers',     label: 'Indie Hackers',         locked: true },
  { key: 'hackernews',       label: 'Hacker News',           locked: true },
  { key: 'toolfolio',        label: 'Toolfolio',             locked: true },
  { key: 'tinystartup',      label: 'Tiny Startup',          locked: true },
  { key: 'sideprojectors',   label: 'SideProjectors',        locked: true },
  { key: 'alternativeto',    label: 'AlternativeTo',         locked: true },
  { key: 'launchigniter',    label: 'LaunchIgniter',         locked: true },
  { key: 'peerpush',         label: 'PeerPush',              locked: true },
  { key: 'saasgenius',       label: 'SaaS Genius',           locked: true },
  { key: 'theresanaiforthat', label: "There's an AI for that", locked: true },
  { key: 'devhunt',          label: 'DevHunt',               locked: true },
];
// Social Media Signals (Media) card — X, Reddit, and Instagram feed the brief
// today (all on the last30days / ScrapeCreators engine); the rest are locked
// until the social search layer ships.
export const SOCIAL_SIGNAL_SOURCES = [
  { key: 'x',         label: 'X / Twitter', locked: false, description: 'Finds timely conversations and reply windows a social manager could act on.' },
  { key: 'reddit',    label: 'Reddit',      locked: false, description: 'Finds questions, complaints, and recommendations that reveal what buyers care about.' },
  { key: 'instagram', label: 'Instagram',   locked: false, description: 'Reviews creator and brand posts for visual direction and social ideas.' },
  { key: 'tiktok',    label: 'TikTok',      locked: true,  description: 'Checks short-form trends that could shape quick content ideas.' },
  { key: 'youtube',   label: 'YouTube',     locked: true,  description: 'Finds video topics and creator discussions worth learning from.' },
  { key: 'linkedin',  label: 'LinkedIn',    locked: true,  description: 'Looks for professional conversations, buyer pain points, and B2B signals.' },
  { key: 'facebook',  label: 'Facebook',    locked: true,  description: 'Checks group and page discussion where local or niche audiences may talk.' },
  { key: 'threads',   label: 'Threads',     locked: true,  description: 'Looks for newer social conversations that may become content opportunities.' },
  { key: 'bluesky',   label: 'Bluesky',     locked: true,  description: 'Looks for newer social conversations that may become content opportunities.' },
  { key: 'pinterest', label: 'Pinterest',   locked: true,  description: 'Checks visual search behavior and inspiration patterns for the audience.' },
];
export function classifyMarketingBriefPlatform(url, explicitPlatform) {
  if (explicitPlatform) {
    const p = String(explicitPlatform).toLowerCase();
    if (p === 'twitter') return 'x';
    if (['web', 'x', 'reddit', 'instagram', 'youtube', 'tiktok', 'hackernews'].includes(p)) return p;
  }
  const u = String(url || '').toLowerCase();
  if (u.includes('twitter.com') || u.includes('x.com/')) return 'x';
  if (u.includes('reddit.com')) return 'reddit';
  if (u.includes('instagram.com')) return 'instagram';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('tiktok.com')) return 'tiktok';
  if (u.includes('news.ycombinator.com')) return 'hackernews';
  return 'web';
}
export function deriveMarketingBriefPerPlatformResults(agentData, selectedPlatforms) {
  const platforms = Array.isArray(selectedPlatforms) && selectedPlatforms.length
    ? selectedPlatforms
    : DEFAULT_MARKETING_BRIEF_SOURCE_PLATFORMS;
  const buckets = Object.fromEntries(platforms.map((k) => [k, []]));
  const push = (key, item) => { if (buckets[key]) buckets[key].push(item); };

  if (agentData && typeof agentData === 'object') {
    (agentData.kolActivity || []).forEach((row) => {
      if (!row) return;
      push(classifyMarketingBriefPlatform(row.url, row.platform), {
        title: row.name || row.content || 'KOL signal',
        summary: row.content || '',
        url: row.url || null,
        kind: 'KOL',
      });
    });
    (agentData.brandMentions || []).forEach((row) => {
      if (!row) return;
      push(classifyMarketingBriefPlatform(row.url, row.source), {
        title: row.author || row.source || 'Mention',
        summary: row.content || '',
        url: row.url || null,
        kind: 'Mention',
      });
    });
    (agentData.competitorIntel || []).forEach((row) => {
      if (!row) return;
      push(classifyMarketingBriefPlatform(row.url, null), {
        title: row.competitor || 'Competitor move',
        summary: row.finding || '',
        url: row.url || null,
        kind: 'Competitor',
      });
    });
    (agentData.viralOpportunities?.opportunities || []).forEach((row) => {
      if (!row) return;
      push(classifyMarketingBriefPlatform(row.url, null), {
        title: row.injectionAngle || row.conversation || 'Viral window',
        summary: row.conversation || row.suggestedReply || '',
        url: row.url || null,
        kind: 'Viral',
      });
    });
    (agentData.categoryTrends || []).forEach((row) => {
      if (!row) return;
      push('web', {
        title: row.trend || 'Category trend',
        summary: row.detail || '',
        url: null,
        kind: 'Trend',
      });
    });
  }

  const out = {};
  platforms.forEach((k) => {
    out[k] = { count: buckets[k].length, items: buckets[k].slice(0, 5) };
  });
  return out;
}
export function splitMarketingBriefTerms(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[\n,]+/);
  return raw
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}
export function quoteBrandSearchTerm(term) {
  const clean = String(term || '').trim();
  if (!clean) return '';
  if (/^".*"$/.test(clean) || /\b(OR|AND|site:)\b/i.test(clean)) return clean;
  return /\s/.test(clean) ? `"${clean}"` : clean;
}
export function getClientHostname(client) {
  try {
    const raw = client?.websiteUrl || client?.website || '';
    return raw ? new URL(raw).hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
}
export function buildGeneratedScoutSearchRows(config, client) {
  const brandName = String(config?.brandName || client?.companyName || client?.name || 'the brand').trim();
  const hostname = getClientHostname(client);
  const brandTerms = splitMarketingBriefTerms(config?.brandKeywords).length
    ? splitMarketingBriefTerms(config?.brandKeywords).map(quoteBrandSearchTerm)
    : [brandName ? quoteBrandSearchTerm(brandName) : '', hostname ? quoteBrandSearchTerm(hostname) : ''];
  const brandQuery = [...brandTerms, hostname ? `site:${hostname}` : null].filter(Boolean).join(' OR ') || quoteBrandSearchTerm(brandName);
  const categoryTerms = splitMarketingBriefTerms(config?.categoryTerms);
  const categorySubject = categoryTerms.slice(0, CATEGORY_TERMS_USED_IN_GENERATED_SEARCH).join(' OR ');
  const categoryQuery = categorySubject || `${brandName} industry news OR market trends`;
  const opportunitySubject = categoryTerms[0] || brandName;

  return [
    {
      label: 'BRAND',
      query: brandQuery,
      goal: 'Find direct brand mentions, official updates, web coverage, and discussion hooks.',
    },
    {
      label: 'CATEGORY',
      query: categoryQuery,
      goal: `Track the top ${Math.min(CATEGORY_TERMS_USED_IN_GENERATED_SEARCH, Math.max(categoryTerms.length, 1))} category themes for market movement and narratives.`,
    },
    {
      label: 'OPPORTUNITIES',
      query: `${opportunitySubject} recommendations OR alternatives OR problems OR launches`,
      goal: 'Find active conversations where the brand can contribute credibly.',
    },
  ];
}
export function buildRecommendedCustomSearchRows(config, client) {
  const generated = buildGeneratedScoutSearchRows(config, client);
  const brandName = String(config?.brandName || client?.companyName || client?.name || 'the brand').trim();
  const categoryTerms = splitMarketingBriefTerms(config?.categoryTerms);
  const categorySubject = categoryTerms.slice(0, 3).join(' OR ') || `${brandName} industry`;
  const competitors = splitMarketingBriefTerms(config?.competitors).slice(0, 4);
  const competitorQuery = competitors.length
    ? `${competitors.join(' OR ')} launch OR pricing OR reviews OR complaints`
    : `${brandName} competitors OR alternatives OR reviews`;

  return [
    generated[0],
    {
      label: 'CATEGORY MOMENTUM',
      query: `${categorySubject} news OR trends OR discussion`,
      goal: 'Find current market movement, buyer language, and timely narratives.',
    },
    {
      label: 'COMPETITORS',
      query: competitorQuery,
      goal: 'Find competitor launches, sentiment shifts, and comparison conversations.',
    },
    {
      label: 'PAIN POINTS',
      query: `${categorySubject} problem OR complaint OR recommendation OR how to`,
      goal: 'Find audience pain, objections, and practical content opportunities.',
    },
    {
      label: 'SOCIAL WINDOWS',
      query: `${brandName} Twitter OR X OR Reddit OR community OR influencer`,
      goal: 'Find reply windows, KOL commentary, and community threads worth entering.',
    },
  ].slice(0, SEARCH_PLAN_CUSTOM_MAX);
}
export function getMarketingBriefSearchStats(config, client) {
  const brandKeywords = splitMarketingBriefTerms(config?.brandKeywords);
  const categoryTerms = splitMarketingBriefTerms(config?.categoryTerms);
  const customSearches = Array.isArray(config?.searches)
    ? config.searches.filter((row) => String(row?.query || '').trim())
    : [];
  const kols = splitMarketingBriefTerms(config?.kols);
  const mode = config?.kolSearchMode === 'combined' ? 'combined' : 'per-handle';
  const watchlistSearches = mode === 'combined' ? (kols.length ? 1 : 0) : kols.length;
  const platforms = Array.isArray(config?.sourcePlatforms) && config.sourcePlatforms.length
    ? config.sourcePlatforms
    : DEFAULT_MARKETING_BRIEF_SOURCE_PLATFORMS;
  const platformSearches = platforms.filter((key) => key !== 'web').length;
  const generatedRows = buildGeneratedScoutSearchRows(config, client);
  const baseRows = customSearches.length ? customSearches.length : generatedRows.length;
  const totalSearches = baseRows + watchlistSearches + platformSearches;
  return {
    brandKeywords,
    categoryTerms,
    customSearches,
    generatedRows,
    generatedMode: customSearches.length === 0,
    baseRows,
    watchlistSearches,
    platformSearches,
    totalSearches,
  };
}
export function buildDefaultMarketingBriefConfig(client, dashboardState) {
  const companyName = client?.companyName || dashboardState?.clientName || 'the brand';
  // Inherit Brand & Keywords from the site-audit-generated scoutConfig so the
  // card arrives prefilled — the user confirms/enhances rather than starts blank.
  const auditScoutConfig = dashboardState?.scoutConfig || null;
  const stripQuotes = (s) => String(s || '').replace(/^["']|["']$/g, '').trim();
  const seededBrandKeywords = Array.isArray(auditScoutConfig?.brandKeywords)
    ? auditScoutConfig.brandKeywords.map(stripQuotes).filter(Boolean)
    : [];
  const seededCategoryTerms = Array.isArray(auditScoutConfig?.categoryTerms)
    ? auditScoutConfig.categoryTerms.map(stripQuotes).filter(Boolean)
    : [];
  const seededBrandName = auditScoutConfig?.clientName || companyName;
  return {
    sourceFocus: `Find timely market signals, founder-relevant news, KOL commentary, and social conversations ${companyName} can credibly participate in. Prioritize X/Twitter-ready angles.`,
    scoutInstructions: [
      'Prioritize live community momentum, current news, sentiment shifts, and moments where the brand can credibly enter the conversation.',
      'Treat KOL posts, X/Twitter discussions, Reddit threads, launch announcements, and comparison conversations as high-value signals.',
      'Separate [LIVE] signals from [BACKGROUND] context.',
      'The final brief should help a founder decide what to say today, where to say it, and why now.',
    ].join('\n'),
    freshnessDays: 1,
    sourcePlatforms: DEFAULT_MARKETING_BRIEF_SOURCE_PLATFORMS,
    kolSearchMode: 'per-handle',
    weather: { enabled: false, zip: '' },
    brandName: seededBrandName,
    brandKeywords: seededBrandKeywords.join('\n'),
    categoryTerms: seededCategoryTerms.join('\n'),
    acknowledgedCards: {},
    kols: '',
    competitors: '',
    // Enabled analysis-skill recipe ids (Market Signals card). Empty = none run.
    analysisRecipes: [],
    // Include the approved Client Brain in the brief analysis (Market Signals toggle). On by default.
    includeClientBrain: true,
    // Local reputation listener — GBP review/profile/SEO health (Market Signals toggle).
    gbpReputation: { enabled: false },
    // Watchlist pull detail level — what to fetch per handle.
    watchlistDetail: { tweets: true, mentions: true, latestOnly: false },
    agentDataTemplate: `{
  "brandMentions": [{"source":"...","author":"...","content":"...","sentiment":"positive|neutral|negative","reach":"high|medium|low","url":"<post permalink — not profile or homepage>"}],
  "competitorIntel": [{"competitor":"...","finding":"...","impact":"high|medium|low","url":"<post permalink — not profile or homepage>"}],
  "categoryTrends": [{"trend":"...","relevance":"high|medium|low","detail":"...","url":"<post or article permalink, optional>"}],
  "pressCoverage": [{"headline":"<the article's actual headline>","publication":"<publication or site name>","summary":"<what it says and why it matters to this brand>","angle":"brand|competitor|category","sentiment":"positive|neutral|negative","publishedAt":"<ISO date if known>","url":"<direct article URL — REQUIRED, omit the item if you cannot cite it>"}],
  "kolActivity": [{"name":"...","platform":"x","content":"...","followers":"...","sentiment":"...","url":"<post permalink — the specific tweet/comment, not the profile>","profileUrl":"<author profile URL, optional>"}],
  "escalations": [{"level":"CRITICAL|IMPORTANT|QUIET","status":"NEW|CHANGED|ESCALATED|RESOLVED","summary":"..."}],
  "viralOpportunities": {
    "found": true,
    "opportunities": [{"conversation":"...","url":"<permalink of the specific conversation/thread to engage with>","injectionAngle":"...","authenticity":"high|medium|low","windowHours":0,"suggestedReply":"..."}],
    "searchedFor": ["trigger 1","trigger 2"]
  }
}`,
    searches: [],
    scribeTone: `Tone: sharp, timely, founder-ready, specific to ${companyName}.\nPrioritize concrete market signals, KOL windows, and X/Twitter-ready angles. Never use generic hype language, forced urgency, or empty superlatives.`,
    scribeHardConstraints: [
      'Every piece connects to Scout\'s priority action',
      'Zero live signal = create signal, not react to it',
      'Never fabricate competitor activity',
      'Never make claims Scout did not surface',
      'Prioritize X/Twitter-ready hooks and credible reply windows',
      'Make the Content Angle useful to a founder deciding what to say today',
      'Each output complete and ready to copy-paste',
    ].join('\n'),
    guardianReviewerContext: `${companyName} — review for factual accuracy against the brand's known positioning and for brand-voice match. Flag forced hype, unsupported claims, or off-tone phrasing.`,
    guardianRestrictedPatterns: '',
  };
}
export function joinConfigList(value) {
  return Array.isArray(value) ? value.join('\n') : String(value || '');
}
