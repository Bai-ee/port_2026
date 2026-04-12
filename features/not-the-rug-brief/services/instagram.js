// services/instagram.js — optional Instagram activity sourcing via Meta Graph API

require('../load-env');

function getInstagramConfig(config = {}) {
  return config.instagram || null;
}

function getEnv(name) {
  return name ? process.env[name] || '' : '';
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Instagram API ${response.status}: ${text.slice(0, 200)}`);
  }

  return JSON.parse(text);
}

function buildGraphUrl(path, params) {
  const url = new URL(`https://graph.facebook.com/v23.0/${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  });
  return url.toString();
}

function sumMetric(items, key) {
  return items.reduce((total, item) => total + (Number(item[key]) || 0), 0);
}

function buildFollowerDelta(current, previous) {
  if (!previous || previous.followersCount == null || current.followersCount == null) return null;
  return current.followersCount - previous.followersCount;
}

function buildInstagramReviewInsight(report) {
  if (!report || report.status !== 'connected') return null;

  const followerPhrase = report.followerDelta == null
    ? `Followers currently at ${report.followersCount ?? 'unknown'}`
    : report.followerDelta > 0
      ? `Followers up by ${report.followerDelta} to ${report.followersCount}`
      : report.followerDelta < 0
        ? `Followers down by ${Math.abs(report.followerDelta)} to ${report.followersCount}`
        : `Followers steady at ${report.followersCount}`;

  const engagementPhrase = report.recentPostCount > 0
    ? `Latest ${report.recentPostCount} post(s) generated ${report.recentLikes} likes and ${report.recentComments} comments.`
    : 'No recent post metrics returned this cycle.';

  const takeaway = report.recentComments > 0
    ? 'Review the latest post comments and reply where the conversation is still active.'
    : 'Follower trend is available, but comment activity is quiet. Prioritize saves/shares language over reply bait.';

  return {
    source: 'Instagram',
    insight: `${followerPhrase}. ${engagementPhrase}`.trim(),
    sentiment: 'neutral',
    actionableTakeaway: takeaway,
    url: report.profileUrl || '',
    platform: 'instagram',
  };
}

function buildInstagramContextBlock(report) {
  if (!report || report.status !== 'connected') return '';

  return `LIVE INSTAGRAM INSIGHTS:
- Profile: ${report.username ? `@${report.username}` : 'unknown'}
- Followers: ${report.followersCount ?? 'unknown'}${report.followerDelta == null ? '' : ` (${report.followerDelta >= 0 ? '+' : ''}${report.followerDelta} vs previous run)`}
- Recent posts analyzed: ${report.recentPostCount}
- Recent engagement: ${report.recentLikes} likes, ${report.recentComments} comments
- Profile URL: ${report.profileUrl || 'unknown'}
Use this only for Instagram activity observations. Do not infer reach, impressions, or story metrics.`;
}

async function fetchInstagramInsights(config = {}, previousReport = null) {
  const instagram = getInstagramConfig(config);
  if (!instagram || instagram.provider !== 'meta-graph') return null;

  const accessToken = getEnv(instagram.accessTokenEnv);
  const userId = getEnv(instagram.userIdEnv);
  if (!accessToken || !userId) return null;

  const profile = await fetchJson(buildGraphUrl(userId, {
    fields: 'username,followers_count,media_count',
    access_token: accessToken,
  }));

  const mediaResponse = await fetchJson(buildGraphUrl(`${userId}/media`, {
    fields: 'id,caption,comments_count,like_count,permalink,timestamp',
    limit: instagram.recentMediaLimit || 3,
    access_token: accessToken,
  }));

  const media = Array.isArray(mediaResponse.data) ? mediaResponse.data : [];
  const current = {
    clientId: config.clientId,
    provider: 'meta-graph',
    status: 'connected',
    fetchedAt: new Date().toISOString(),
    username: profile.username || '',
    followersCount: Number(profile.followers_count) || 0,
    mediaCount: Number(profile.media_count) || 0,
    recentPostCount: media.length,
    recentLikes: sumMetric(media, 'like_count'),
    recentComments: sumMetric(media, 'comments_count'),
    latestPostUrl: media[0]?.permalink || '',
    latestPostTimestamp: media[0]?.timestamp || '',
    profileUrl: instagram.profileUrl || (profile.username ? `https://www.instagram.com/${profile.username}/` : ''),
    media: media.map((item) => ({
      id: item.id,
      permalink: item.permalink || '',
      timestamp: item.timestamp || '',
      likeCount: Number(item.like_count) || 0,
      commentsCount: Number(item.comments_count) || 0,
    })),
  };

  current.followerDelta = buildFollowerDelta(current, previousReport);
  return current;
}

module.exports = {
  buildInstagramContextBlock,
  buildInstagramReviewInsight,
  fetchInstagramInsights,
};
