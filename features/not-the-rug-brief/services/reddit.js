// services/reddit.js — optional Reddit sourcing via official OAuth Data API

require('../load-env');

function getRedditConfig(config = {}) {
  return config.reddit || null;
}

function getEnv(name) {
  return name ? process.env[name] || '' : '';
}

function getUserAgent(reddit = {}) {
  return getEnv(reddit.userAgentEnv) || 'ScoutCrittersQuest/1.0';
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripMarkdownQuotes(value = '') {
  return String(value).replace(/[*_~`>#]/g, '').trim();
}

function clip(value = '', length = 220) {
  const clean = stripMarkdownQuotes(value).replace(/\s+/g, ' ').trim();
  if (clean.length <= length) return clean;
  return `${clean.slice(0, Math.max(0, length - 3)).trimEnd()}...`;
}

async function fetchAccessToken(reddit = {}) {
  const clientId = getEnv(reddit.clientIdEnv);
  const clientSecret = getEnv(reddit.clientSecretEnv);
  if (!clientId || !clientSecret) return null;

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({ grant_type: 'client_credentials' });
  const response = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': getUserAgent(reddit),
    },
    body: body.toString(),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Reddit token request ${response.status}: ${text.slice(0, 200)}`);
  }

  const payload = JSON.parse(text);
  return payload.access_token || null;
}

async function fetchListing(path, params, accessToken, reddit = {}) {
  const url = new URL(`https://oauth.reddit.com${path}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  });

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      Authorization: `bearer ${accessToken}`,
      'User-Agent': getUserAgent(reddit),
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Reddit API ${response.status}: ${text.slice(0, 200)}`);
  }

  return JSON.parse(text);
}

function parsePost(data = {}, kind = 'signal', query = '', subredditHint = '') {
  const title = stripMarkdownQuotes(data.title || '');
  const selftext = clip(data.selftext || '', 180);
  const permalink = data.permalink ? `https://www.reddit.com${data.permalink}` : '';
  const createdAt = data.created_utc ? new Date(data.created_utc * 1000).toISOString() : '';
  const body = [title, selftext].filter(Boolean).join(' ');

  return {
    id: data.name || data.id || permalink || `${kind}:${title}`,
    kind,
    query,
    subreddit: data.subreddit_name_prefixed || (data.subreddit ? `r/${data.subreddit}` : subredditHint),
    title,
    excerpt: selftext,
    permalink,
    createdAt,
    score: Number(data.score) || 0,
    numComments: Number(data.num_comments) || 0,
    author: data.author || '',
    body,
  };
}

function uniqueById(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function sortByFreshness(items = []) {
  return [...items].sort((a, b) => {
    const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
    if (bTime !== aTime) return bTime - aTime;
    return (b.numComments || 0) - (a.numComments || 0);
  });
}

function findNewItems(current = [], previous = []) {
  const previousIds = new Set((previous || []).map((item) => item.id));
  return current.filter((item) => !previousIds.has(item.id));
}

function classifyOpportunity(item = {}) {
  const text = `${item.title} ${item.excerpt}`.toLowerCase();
  if (/\b(looking for|recommend|recommendation|recs|anyone know|need a)\b/.test(text)) {
    return 'recommendation_request';
  }
  if (/\b(rover|wag|different walker|uncomfortable|trust|reliable|pack walk)\b/.test(text)) {
    return 'competitor_pain_point';
  }
  return 'local_signal';
}

function buildMentionInsight(item = {}) {
  const snippet = item.excerpt ? ` ${item.excerpt}` : '';
  return clip(`${item.title}.${snippet}`, 180);
}

function buildOpportunityReason(item = {}) {
  switch (classifyOpportunity(item)) {
    case 'recommendation_request':
      return 'Active recommendation request thread that could surface buyer language or participation opportunities.';
    case 'competitor_pain_point':
      return 'Thread contains trust, consistency, or competitor pain points relevant to Not The Rug positioning.';
    default:
      return 'Neighborhood dog-owner conversation that may inform content or comment participation.';
  }
}

function matchesBrandTerm(item = {}, brandTerms = []) {
  const body = (item.body || '').toLowerCase();
  return brandTerms.some((term) => {
    const normalized = String(term).toLowerCase().replace(/"/g, '').trim();
    if (!normalized) return false;
    return new RegExp(`\\b${escapeRegex(normalized)}\\b`, 'i').test(body);
  });
}

async function searchGlobal(accessToken, reddit, query, limit) {
  const payload = await fetchListing('/search', {
    q: query,
    sort: 'new',
    type: 'link',
    limit,
    t: 'month',
    raw_json: 1,
  }, accessToken, reddit);

  const children = payload?.data?.children || [];
  return children.map((child) => parsePost(child.data, 'mention', query));
}

async function searchSubreddit(accessToken, reddit, subreddit, query, limit) {
  const payload = await fetchListing(`/r/${subreddit}/search`, {
    q: query,
    sort: 'new',
    restrict_sr: 'on',
    type: 'link',
    limit,
    t: 'month',
    raw_json: 1,
  }, accessToken, reddit);

  const children = payload?.data?.children || [];
  return children.map((child) => parsePost(child.data, 'opportunity', query, `r/${subreddit}`));
}

function buildRedditContextBlock(report) {
  if (!report || report.status !== 'connected') return '';

  const mentionLines = (report.mentions || []).slice(0, 5).map((item) => (
    `- ${item.subreddit}: ${item.title} (${item.createdAt?.slice(0, 10) || 'unknown date'}, ${item.numComments} comments) — ${item.permalink}`
  )).join('\n') || '- none';

  const opportunityLines = (report.participationOpportunities || []).slice(0, 5).map((item) => (
    `- ${item.subreddit}: ${item.title} (${item.createdAt?.slice(0, 10) || 'unknown date'}, ${item.numComments} comments) — ${buildOpportunityReason(item)} ${item.permalink}`
  )).join('\n') || '- none';

  return `LIVE REDDIT SIGNALS:
- Mentions found: ${report.mentionCount}${report.newMentionCount ? ` (${report.newMentionCount} new since previous run)` : ''}
${mentionLines}
- Participation opportunities found: ${report.participationOpportunityCount}${report.newParticipationOpportunityCount ? ` (${report.newParticipationOpportunityCount} new since previous run)` : ''}
${opportunityLines}
Use this as the canonical Reddit source for brand mentions, recommendation threads, and neighborhood dog-owner participation opportunities. Do not invent replies or claim the brand has already engaged.`;
}

async function fetchRedditSignals(config = {}, previousReport = null) {
  const reddit = getRedditConfig(config);
  if (!reddit || reddit.provider !== 'oauth-app-only') return null;

  const accessToken = await fetchAccessToken(reddit);
  if (!accessToken) return null;

  const limit = reddit.limitPerQuery || 4;
  const brandTerms = reddit.brandTerms || ['not the rug', 'nottherug'];

  const mentionBuckets = await Promise.all(
    (reddit.mentionQueries || []).map((query) => searchGlobal(accessToken, reddit, query, limit))
  );

  const opportunityBuckets = await Promise.all(
    (reddit.subreddits || []).flatMap((subreddit) =>
      (reddit.opportunityQueries || []).map((query) => searchSubreddit(accessToken, reddit, subreddit, query, limit))
    )
  );

  const mentions = sortByFreshness(
    uniqueById(mentionBuckets.flat()).filter((item) => matchesBrandTerm(item, brandTerms))
  ).slice(0, reddit.maxMentions || 5).map((item) => ({
    ...item,
    insight: buildMentionInsight(item),
  }));

  const participationOpportunities = sortByFreshness(
    uniqueById(opportunityBuckets.flat())
  ).slice(0, reddit.maxParticipationOpportunities || 8).map((item) => ({
    ...item,
    opportunityType: classifyOpportunity(item),
    whyRelevant: buildOpportunityReason(item),
  }));

  const newMentions = findNewItems(mentions, previousReport?.mentions || []);
  const newParticipationOpportunities = findNewItems(participationOpportunities, previousReport?.participationOpportunities || []);

  return {
    clientId: config.clientId,
    provider: 'oauth-app-only',
    status: 'connected',
    fetchedAt: new Date().toISOString(),
    mentionCount: mentions.length,
    newMentionCount: newMentions.length,
    participationOpportunityCount: participationOpportunities.length,
    newParticipationOpportunityCount: newParticipationOpportunities.length,
    mentions,
    participationOpportunities,
    subreddits: reddit.subreddits || [],
  };
}

module.exports = {
  buildRedditContextBlock,
  fetchRedditSignals,
};
