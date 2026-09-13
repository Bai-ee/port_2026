#!/usr/bin/env node
// Normalize + classify the @seb__design corpus, then emit the dataset files.
import fs from 'node:fs';
import path from 'node:path';

const SP = path.dirname(new URL(import.meta.url).pathname);
const REPO = '/Users/bballi/Documents/Repos/Bballi_Portfolio';
const OUT_DIR = path.join(REPO, 'docs', 'audits');
const HANDLE = 'seb__design';
const TZ_OFFSET_HOURS = 2; // CEST — inferred from posting window + German-language artifacts

const raw = JSON.parse(fs.readFileSync(path.join(SP, 'seb-corpus.json'), 'utf8'));
const views = fs.existsSync(path.join(SP, 'seb-views.json'))
  ? JSON.parse(fs.readFileSync(path.join(SP, 'seb-views.json'), 'utf8'))
  : {};

// Topics are matched against the caption AND the quoted post, because his
// quote-reactions are ~46 chars — the subject lives in what he is quoting.
const TOPICS = [
  ['japanese-asian-design', /japan|japanese|asian|korea|korean|타이포|tokyo|kanji/i],
  ['retro-analog-preinternet', /pre.?internet|pre.?ai|analog|vintage|retro|\b(?:70s|80s|90s)\b|flea market|windows xp|obsolete|early days of the digital|archive/i],
  ['editorial-typography', /editorial|typograph|type\b|typeface|font|zine|magazine|layout|grid|swiss|poster/i],
  ['motion-animation-web', /animation|animate|motion|scroll|slider|easing|shader|transition|interaction|webgl|three\.?js|smooth/i],
  ['anti-ai-slop', /ai slop|mediocre ai|ai.?free|completely ai free|just use ai|slop\b/i],
  ['own-work-process', /\b(?:i|i'?ve|ma|my)\b.*(?:made|built|designed|created|open figma|design itch)|unreleased project|concept design|process section|figma file|work in progress|wip\b/i],
  ['client-work-credit', /dev by @|illus by @|design by @|for @\w+|client|shipped|launched/i],
  ['freelance-business', /freelance|client|invoice|rate|pricing|9 to 5|full time|booking|discovery call|founders?\b|business/i],
  ['craft-advice', /i recommend|if you'?re starting out|plateau|here'?s (?:how|what)|rebuild it|you'?ll learn|always look outside|go back and clean|tips?\b/i],
  ['industry-hot-take', /hot take|unpopular|most designers|is a scam|ego and pride|fight me|controversial|mediocre/i],
  ['personal-vulnerability', /fallen off|hard truth|when i first started|my journey|struggle|burn(?:t|ed) out|i miss|makes u wonder|honestly/i],
  ['growth-milestone', /\b\d{3,4}\b\s*(?:follower|f)|holy number|let'?s goo+|thanks (?:everyone|to all|for the support)|so close to \d|milestone/i],
  ['platform-meta', /linkedin|algorithm|\balgo\b|notifications|chronically online|on x\b|contra/i],
  ['tools', /figma|framer|blender|after effects|photoshop|cursor|claude|midjourney|npm|plugin/i],
  ['audience-question', /\?\s*$|would u\b|would you\b|am i the only|anyone else|thoughts\?|fight me/i],
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
    // Self-quote = promoting his own earlier post; distinct play from curating others.
    if (t.quotedTweet.author?.username === HANDLE) return 'self-quote';
    return (t.text || '').length <= 90 ? 'quote-react' : 'quote-commentary';
  }
  return (Array.isArray(t.media) && t.media.length) ? 'original-showcase' : 'original-text';
}

function hasMedia(t) {
  return Array.isArray(t.media) && t.media.length > 0;
}

function mediaKind(t) {
  if (!hasMedia(t)) return 'none';
  const kinds = new Set(t.media.map((m) => m.type));
  if (kinds.has('video')) return 'video';
  if (kinds.has('animated_gif')) return 'gif';
  return 'image';
}

const rows = raw.map((t) => {
  const utc = new Date(t.createdAt);
  const local = new Date(utc.getTime() + TZ_OFFSET_HOURS * 3600 * 1000);
  const type = classifyType(t);
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
    type,
    media: mediaKind(t),
    hasLink: /https?:\/\/t\.co/.test(text.replace(/https:\/\/t\.co\/\w+$/, '')) || false,
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
fs.writeFileSync(path.join(OUT_DIR, 'seb-design-x-corpus.json'), JSON.stringify(rows, null, 2));

// CSV
const csvEsc = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const cols = ['id', 'url', 'utc', 'dateLocal', 'timeLocal', 'weekday', 'type', 'media', 'topics', 'chars', 'lines', 'likes', 'reposts', 'replies', 'views', 'engagement', 'engagementRate', 'quotedAuthor', 'text'];
const csv = [cols.join(',')]
  .concat(rows.map((r) => cols.map((c) => csvEsc(Array.isArray(r[c]) ? r[c].join('|') : r[c])).join(',')))
  .join('\n');
fs.writeFileSync(path.join(OUT_DIR, 'seb-design-x-corpus.csv'), csv);

// ---- stats ----
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

const perDay = {};
for (const r of rows) perDay[r.dateLocal] = (perDay[r.dateLocal] || 0) + 1;

const topicStats = {};
for (const r of rows) {
  for (const tp of r.topics) {
    topicStats[tp] = topicStats[tp] || { n: 0, likes: 0, replies: 0, reposts: 0 };
    topicStats[tp].n += 1;
    topicStats[tp].likes += r.likes;
    topicStats[tp].replies += r.replies;
    topicStats[tp].reposts += r.reposts;
  }
}

const mediaStats = {};
for (const r of rows.filter((x) => x.type !== 'retweet')) {
  mediaStats[r.media] = mediaStats[r.media] || { n: 0, likes: 0 };
  mediaStats[r.media].n += 1; mediaStats[r.media].likes += r.likes;
}

const stats = {
  handle: HANDLE,
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
  perDay,
  topicStats: Object.fromEntries(Object.entries(topicStats).map(([k, v]) => [k, {
    n: v.n,
    avgLikes: Number((v.likes / v.n).toFixed(1)),
    avgReplies: Number((v.replies / v.n).toFixed(1)),
    avgReposts: Number((v.reposts / v.n).toFixed(1)),
  }])),
  mediaStats: Object.fromEntries(Object.entries(mediaStats).map(([k, v]) => [k, { n: v.n, avgLikes: Number((v.likes / v.n).toFixed(1)) }])),
};
fs.writeFileSync(path.join(SP, 'seb-stats.json'), JSON.stringify(stats, null, 2));
console.log(JSON.stringify(stats, null, 2));
