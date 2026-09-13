#!/usr/bin/env node
// Normalize + classify the @bai_ee corpus. Taxonomy is tuned to Bryan's actual
// subject matter, not seb's — a fair audit scores an account on its own veins.
import fs from 'node:fs';
import path from 'node:path';

const SP = path.dirname(new URL(import.meta.url).pathname);
const REPO = '/Users/bballi/Documents/Repos/Bballi_Portfolio';
const OUT_DIR = path.join(REPO, 'docs', 'audits');
const HANDLE = 'bai_ee';
const TZ_OFFSET_HOURS = -5; // US Central (CDT) — inferred from git commit offsets (191/200 at -0500)

const raw = JSON.parse(fs.readFileSync(path.join(SP, 'baiee-window.json'), 'utf8'));
const views = fs.existsSync(path.join(SP, 'baiee-views.json'))
  ? JSON.parse(fs.readFileSync(path.join(SP, 'baiee-views.json'), 'utf8'))
  : {};

const TOPICS = [
  ['web3-gaming', /crittersquest|clone|marketplace|nft|magiceden|trove|multiplier|shard|mint|terron|web3/i],
  ['design-engineering', /three\.?js|blender|webgl|shader|interaction|frontend|\bfe\b|template|line.?height|dieline|css|component|design engineering|interactive/i],
  ['music-archive-dj', /edittrax|mixtape|mix-?tape|arweave|loop(?:er|s)?\b|wav\b|slice|\bdj\b|arcmusicfest|vinyl|trax|record|ep\b|mateo|set\b|party|parties/i],
  ['client-work-status', /in the loop|in prog|hitloop|onboard|client|delivery|revision|landing page|refresh|wip\b|first look/i],
  ['craft-opinion', /design decision|visual .{0,3}(?:>|greater)|cohesive|high-?impact|systems?\b|aesthetic|craft/i],
  // SPLIT (2026-09-10): the old single 'crypto-finance' tag lumped paid client
  // design work in with speculation chatter, which made the client work look
  // like a liability. They are different lanes and score very differently.
  ['web3-design-work', /marketplace|collection|trait|game economy|art direction|brand(?:ing)?|ui\b|drop\b|mint(?:ing)?|onboarding|landing page|identity/i],
  ['crypto-speculation', /\bpump\b|rugged|\brug\b|shkreli|up only|\bape(?:d|ing)?\b|moon|bag(?:s|holder)|pnl|degen|\bct\b|price|market cap|\$[A-Z]{2,}/],
  ['decentralized-infra', /arweave|ipfs|permanent|decentraliz|forever|self-?host|on-?chain storage|archive/i],
  ['us-politics', /trump|kamala|booker|cruz|\bvote|senator|congress|president|political/i],
  ['platform-complaint', /\bct\b|algo(?:rithm)?|squarespace|shit ?show|3rd party|third party|platform|blocked|feed/i],
  ['personal-life', /my son|touched some grass|rainstorm|friends|home team|morning therapy|obsessive builder|myself/i],
  ['ai-tooling', /\bai\b|claude|generate|prompt|llm|custom tooling/i],
];

function classifyTopic(t) {
  const hay = [t.text || '', t.quotedTweet?.text || ''].join(' \n ');
  const hits = TOPICS.filter(([, re]) => re.test(hay)).map(([name]) => name);
  return hits.length ? hits : ['untagged-riff'];
}

function classifyType(t) {
  if (/^RT @/.test(t.text)) return 'retweet';
  if (t.inReplyToStatusId) return 'reply';
  if (t.quotedTweet) {
    if (t.quotedTweet.author?.username === HANDLE) return 'self-quote';
    return (t.text || '').length <= 90 ? 'quote-react' : 'quote-commentary';
  }
  return (Array.isArray(t.media) && t.media.length) ? 'original-showcase' : 'original-text';
}

function mediaKind(t) {
  if (!Array.isArray(t.media) || !t.media.length) return 'none';
  const kinds = new Set(t.media.map((m) => m.type));
  if (kinds.has('video')) return 'video';
  if (kinds.has('animated_gif')) return 'gif';
  return 'image';
}

const rows = raw.map((t) => {
  const utc = new Date(t.createdAt);
  const local = new Date(utc.getTime() + TZ_OFFSET_HOURS * 3600 * 1000);
  const text = t.text || '';
  const likes = t.likeCount ?? 0;
  const reposts = t.retweetCount ?? 0;
  const replies = t.replyCount ?? 0;
  const v = views[t.id] ?? null;
  return {
    id: t.id,
    url: `https://x.com/${HANDLE}/status/${t.id}`,
    utc: utc.toISOString(),
    dateLocal: local.toISOString().slice(0, 10),
    timeLocal: local.toISOString().slice(11, 16),
    hourLocal: local.getUTCHours(),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][local.getUTCDay()],
    type: classifyType(t),
    media: mediaKind(t),
    topics: classifyTopic(t),
    chars: text.length,
    lines: text.split('\n').length,
    text,
    likes,
    reposts,
    replies,
    views: v,
    engagement: likes + reposts + replies,
    engagementRate: v ? Number((((likes + reposts + replies) / v) * 100).toFixed(2)) : null,
    quotedAuthor: t.quotedTweet?.author?.username || null,
    quotedText: t.quotedTweet?.text || null,
    conversationId: t.conversationId || null,
  };
});

rows.sort((a, b) => new Date(b.utc) - new Date(a.utc));
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'bai-ee-x-corpus.json'), JSON.stringify(rows, null, 2));

const csvEsc = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const cols = ['id', 'url', 'utc', 'dateLocal', 'timeLocal', 'weekday', 'type', 'media', 'topics', 'chars', 'lines', 'likes', 'reposts', 'replies', 'views', 'engagement', 'engagementRate', 'quotedAuthor', 'text'];
fs.writeFileSync(path.join(OUT_DIR, 'bai-ee-x-corpus.csv'),
  [cols.join(',')].concat(rows.map((r) => cols.map((c) => csvEsc(Array.isArray(r[c]) ? r[c].join('|') : r[c])).join(','))).join('\n'));

const days = new Set(rows.map((r) => r.dateLocal));
const byType = {};
for (const r of rows) byType[r.type] = (byType[r.type] || 0) + 1;
const hourHist = Array.from({ length: 24 }, () => ({ n: 0, likes: 0 }));
for (const r of rows) { hourHist[r.hourLocal].n += 1; hourHist[r.hourLocal].likes += r.likes; }
const dayHist = {};
for (const r of rows) {
  dayHist[r.weekday] = dayHist[r.weekday] || { n: 0, likes: 0 };
  dayHist[r.weekday].n += 1; dayHist[r.weekday].likes += r.likes;
}
const topicStats = {};
for (const r of rows) {
  for (const tp of r.topics) {
    topicStats[tp] = topicStats[tp] || { n: 0, likes: 0, replies: 0, reposts: 0, views: 0, vn: 0 };
    const s = topicStats[tp];
    s.n += 1; s.likes += r.likes; s.replies += r.replies; s.reposts += r.reposts;
    if (r.views != null) { s.views += r.views; s.vn += 1; }
  }
}
const mediaStats = {};
for (const r of rows.filter((x) => x.type !== 'retweet')) {
  mediaStats[r.media] = mediaStats[r.media] || { n: 0, likes: 0, views: 0, vn: 0 };
  mediaStats[r.media].n += 1; mediaStats[r.media].likes += r.likes;
  if (r.views != null) { mediaStats[r.media].views += r.views; mediaStats[r.media].vn += 1; }
}

const stats = {
  handle: HANDLE,
  tzOffsetHours: TZ_OFFSET_HOURS,
  pulledAt: new Date().toISOString(),
  posts: rows.length,
  firstPost: rows[rows.length - 1].utc,
  lastPost: rows[0].utc,
  daysCovered: days.size,
  spanDays: Math.round((new Date(rows[0].utc) - new Date(rows[rows.length - 1].utc)) / 86400000),
  postsPerActiveDay: Number((rows.length / days.size).toFixed(2)),
  byType,
  hourHist: hourHist.map((h, i) => ({ hour: i, n: h.n, avgLikes: h.n ? Number((h.likes / h.n).toFixed(1)) : 0 })),
  dayHist,
  topicStats: Object.fromEntries(Object.entries(topicStats).map(([k, v]) => [k, {
    n: v.n,
    avgLikes: Number((v.likes / v.n).toFixed(1)),
    avgReplies: Number((v.replies / v.n).toFixed(1)),
    avgReposts: Number((v.reposts / v.n).toFixed(1)),
    avgViews: v.vn ? Math.round(v.views / v.vn) : null,
  }])),
  mediaStats: Object.fromEntries(Object.entries(mediaStats).map(([k, v]) => [k, {
    n: v.n,
    avgLikes: Number((v.likes / v.n).toFixed(1)),
    avgViews: v.vn ? Math.round(v.views / v.vn) : null,
  }])),
};
fs.writeFileSync(path.join(SP, 'baiee-stats.json'), JSON.stringify(stats, null, 2));
fs.writeFileSync(path.join(OUT_DIR, 'bai-ee-x-stats.json'), JSON.stringify(stats, null, 2));
console.log(JSON.stringify({ posts: stats.posts, byType, days: stats.daysCovered, perDay: stats.postsPerActiveDay }, null, 2));
