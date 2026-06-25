'use strict';

// watchlist-pull.js — Handle-first X fetch. For each configured watchlist handle
// (marketingBriefConfig.kols), pulls that handle's REAL recent X activity via
// last30days `--x-handle <handle>` (targeted timeline), not a topic search with
// handles as low-weight context. Returns one timeline per handle so the brief can
// analyze each account specifically.
//
// Production path uses the shared X API timeline reader. The local last30days
// Python scraper is allowed only in development or when explicitly enabled.

const { buildRuntimeConfigFromFirestore } = require('../not-the-rug-brief/config-loader');
const { runAnalysisRecipe } = require('../intelligence/analysis-recipes/run-recipe');

const MAX_HANDLES = 6;
const MAX_OWN = 8;
const MAX_MENTIONS = 12;

function localLast30DaysAllowed() {
  return process.env.NODE_ENV !== 'production' || process.env.ALLOW_LOCAL_LAST30DAYS === 'true';
}

// Sort: engagement first, then recency, then relevance rank. Engagement is often
// 0 from the Bird scraper, so the recency/rank fallback keeps ordering sensible.
function byEngagementThenRecency(a, b) {
  if (b.engagementTotal !== a.engagementTotal) return b.engagementTotal - a.engagementTotal;
  const da = Date.parse(a.publishedAt || 0) || 0;
  const db = Date.parse(b.publishedAt || 0) || 0;
  if (db !== da) return db - da;
  return (b.score || 0) - (a.score || 0);
}

function mapRawX(it, fallbackHandle) {
  const eng = it.engagement || {};
  const likes = Number(eng.likes) || 0;
  const replies = Number(eng.replies) || 0;
  const reposts = Number(eng.reposts) || 0;
  return {
    author: String(it.author || '').replace(/^@+/, '') || fallbackHandle,
    text: String(it.body || it.snippet || it.title || '').trim(),
    url: it.url || '',
    publishedAt: it.published_at || null,
    likes, replies, reposts,
    engagementTotal: likes + replies + reposts,
    score: Number(it.local_rank_score) || 0,
  };
}

/**
 * Pull one handle's recent X activity via last30days --x-handle, split into the
 * handle's OWN posts vs MENTIONS of it, with per-post engagement. Reads the raw
 * items_by_source (per-tweet, with engagement) rather than the ranked clusters.
 * Never throws — errors are captured on the returned object.
 */
async function fetchHandleTimeline({ clientId, clientName, handle, lookbackDays, detail }) {
  const t0 = Date.now();
  const clean = String(handle || '').trim().replace(/^@+/, '');
  const empty = (error) => ({ handle: clean || handle, ownPosts: [], mentions: [], featured: null, engagementTotal: 0, count: 0, error, ms: Date.now() - t0 });
  if (clean.length < 2) return empty('invalid handle');

  // Detail toggles — what to pull per handle. tweets=own posts, mentions=others,
  // latestOnly=just their single most-recent post. Default = tweets + mentions.
  const tweets = detail?.tweets !== false;
  const mentionsOn = detail?.mentions !== false;
  const latestOnly = detail?.latestOnly === true;
  if (!tweets && !mentionsOn) return empty('detail off — enable Tweets or Mentions');

  const lb = Math.max(7, Number(lookbackDays) || 30);
  // One Bird search for a topic; returns mapped X items (never throws).
  const search = async (topic) => {
    let service;
    try {
      const { fetchLast30Days } = require('../not-the-rug-brief/services/last30days');
      service = await fetchLast30Days({ clientId, clientName, last30days: { enabled: true, sources: 'x', primaryTopic: topic, lookbackDays: lb } });
    } catch { return []; }
    if (!service || service.status === 'error' || service.status === 'empty') return [];
    const rawX = Array.isArray(service.rawOutput?.items_by_source?.x) ? service.rawOutput.items_by_source.x : [];
    return rawX.map((it) => mapRawX(it, clean)).filter((it) => it.text || it.url);
  };

  const isOwn = (it) => it.author.toLowerCase() === clean.toLowerCase();
  // `from:<handle>` = OWN posts. Plain `<handle>` = MENTIONS (different Bird query;
  // OR form mangles). Only run the searches the detail level asks for, in parallel.
  const byRecency = (a, b) => (Date.parse(b.publishedAt || 0) || 0) - (Date.parse(a.publishedAt || 0) || 0);
  const [ownRaw, menRaw] = await Promise.all([
    tweets ? search(`from:${clean}`) : Promise.resolve([]),
    mentionsOn ? search(clean) : Promise.resolve([]),
  ]);

  const ownAll = ownRaw.filter(isOwn);
  const ownPosts = latestOnly
    ? ownAll.sort(byRecency).slice(0, 1)                 // just their last post
    : ownAll.sort(byEngagementThenRecency).slice(0, MAX_OWN);
  const mentions = menRaw.filter((it) => !isOwn(it)).sort(byEngagementThenRecency).slice(0, MAX_MENTIONS);
  if (!ownPosts.length && !mentions.length) return empty('no X activity for this handle/window');

  // Featured = the handle's top OWN post (their voice); fall back to top mention.
  const featured = ownPosts[0] || mentions[0] || null;
  const engagementTotal = [...ownPosts, ...mentions].reduce((n, it) => n + it.engagementTotal, 0);

  return { handle: clean, ownPosts, mentions, featured, engagementTotal, count: ownPosts.length + mentions.length, error: null, ms: Date.now() - t0 };
}

function mapXApiItem(item, fallbackHandle) {
  const metrics = item.metrics || {};
  const likes = Number(metrics.like_count || metrics.likes) || 0;
  const replies = Number(metrics.reply_count || metrics.replies) || 0;
  const reposts = Number(metrics.retweet_count || metrics.reposts) || 0;
  return {
    author: String(item.author || item.title || fallbackHandle || '').replace(/^@+/, '') || fallbackHandle,
    text: String(item.summary || item.text || item.title || '').trim(),
    url: item.url || '',
    publishedAt: item.createdAt || item.publishedAt || null,
    likes,
    replies,
    reposts,
    engagementTotal: likes + replies + reposts,
    score: 0,
  };
}

async function fetchTimelinesViaXApi({ handles, detail }) {
  const t0 = Date.now();
  const baseResults = handles.map((handle) => ({
    handle,
    ownPosts: [],
    mentions: [],
    featured: null,
    engagementTotal: 0,
    count: 0,
    error: null,
    ms: 0,
  }));

  if (detail?.tweets === false) {
    return baseResults.map((result) => ({
      ...result,
      error: 'X timeline pull is configured for Mentions only. Production mentions need X search access or the local last30days fallback.',
      ms: Date.now() - t0,
    }));
  }

  let timeline;
  try {
    const { fetchHandleTimelines } = await import('../social-posting/twitter-service.js');
    timeline = await fetchHandleTimelines(handles, { perHandle: detail?.latestOnly ? 1 : MAX_OWN });
  } catch (err) {
    return baseResults.map((result) => ({
      ...result,
      error: err?.message || 'X timeline reader failed.',
      ms: Date.now() - t0,
    }));
  }

  const grouped = new Map();
  for (const item of timeline.items || []) {
    const key = String(item.handle || item.tag || '').replace(/^@+/, '').toLowerCase();
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(mapXApiItem(item, key));
  }

  const sharedError = timeline.errors?.length ? timeline.errors.join('; ').slice(0, 240) : null;
  return baseResults.map((result) => {
    const ownPosts = (grouped.get(result.handle.toLowerCase()) || [])
      .sort(byEngagementThenRecency)
      .slice(0, detail?.latestOnly ? 1 : MAX_OWN);
    const engagementTotal = ownPosts.reduce((n, it) => n + it.engagementTotal, 0);
    const mentionsNote = detail?.mentions
      ? ' Mentions are not fetched by the production timeline reader yet.'
      : '';
    return {
      ...result,
      ownPosts,
      featured: ownPosts[0] || null,
      engagementTotal,
      count: ownPosts.length,
      error: ownPosts.length ? (mentionsNote.trim() || null) : (sharedError || `No recent X posts found for @${result.handle}.${mentionsNote}`.trim()),
      ms: Date.now() - t0,
    };
  });
}

/**
 * Pull every configured watchlist handle's timeline. Production uses X API
 * timelines; development may fall back to the local last30days Python scraper.
 *
 * @returns {Promise<{ ok, handles: Array<{handle,items,count,error,ms}>, count, ms, error }>}
 */
async function runWatchlistPull({ clientId, clientConfig = {}, lookbackDays, detail }) {
  const t0 = Date.now();
  let cfg;
  try {
    cfg = buildRuntimeConfigFromFirestore(clientId, clientConfig || {});
  } catch (err) {
    return { ok: false, handles: [], count: 0, ms: Date.now() - t0, error: `config build failed: ${err.message}` };
  }

  // Detail level: explicit param wins, else the saved config, else default (both).
  const cfgDetail = clientConfig?.marketingBriefConfig?.watchlistDetail || {};
  const resolvedDetail = {
    tweets: detail?.tweets ?? cfgDetail.tweets ?? true,
    mentions: detail?.mentions ?? cfgDetail.mentions ?? true,
    latestOnly: detail?.latestOnly ?? cfgDetail.latestOnly ?? false,
  };
  if (!resolvedDetail.tweets && !resolvedDetail.mentions) {
    return { ok: false, handles: [], count: 0, ms: Date.now() - t0, error: 'Watchlist detail is off — enable Tweets or Mentions.' };
  }

  const handles = (Array.isArray(cfg.kols) ? cfg.kols : [])
    .map((h) => String(h || '').trim().replace(/^@+/, ''))
    .filter((h) => h.length >= 2)
    .slice(0, MAX_HANDLES);

  if (!handles.length) {
    return { ok: false, handles: [], count: 0, ms: Date.now() - t0, error: 'No watchlist handles configured — add handles in the Watchlist card.' };
  }

  const lb = lookbackDays || cfg.scout?.freshnessDays || 30;
  let results = await fetchTimelinesViaXApi({ handles, detail: resolvedDetail });

  if (!results.some((r) => r.count > 0) && localLast30DaysAllowed()) {
    results = [];
    for (const h of handles) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await fetchHandleTimeline({ clientId, clientName: cfg.clientName, handle: h, lookbackDays: lb, detail: resolvedDetail }));
    }
  }

  // Spotlight = the handle with the most engagement this window (scribe focus).
  // Falls back to the most-posts handle when engagement is all zero.
  const live = results.filter((r) => r.count > 0);
  const spotlight = live.length
    ? [...live].sort((a, b) => (b.engagementTotal - a.engagementTotal) || (b.count - a.count))[0].handle
    : null;

  // Top-of-report scribe: run the watchlist-analysis recipe over a compact view
  // of the pulled data (posts + mentions + engagement). Best-effort — a failed
  // analysis never blocks returning the timelines.
  let analysis = null;
  if (live.length) {
    const compact = live.map((r) => ({
      handle: r.handle,
      engagementTotal: r.engagementTotal,
      ownPosts: (r.ownPosts || []).slice(0, 6).map((p) => ({ text: p.text, likes: p.likes, replies: p.replies, reposts: p.reposts })),
      mentions: (r.mentions || []).slice(0, 6).map((p) => ({ author: p.author, text: p.text, likes: p.likes, replies: p.replies, reposts: p.reposts })),
    }));
    try {
      const res = await runAnalysisRecipe({ recipeId: 'watchlist-analysis', content: compact, context: `Client: ${cfg.clientName || clientId}` });
      if (res?.ok) analysis = { text: res.analysis, costUsd: res.costUsd };
    } catch { /* non-fatal */ }
  }

  return {
    ok: live.length > 0,
    handles: results,
    spotlight,
    analysis,
    count: results.reduce((n, r) => n + r.count, 0),
    engagementTotal: results.reduce((n, r) => n + (r.engagementTotal || 0), 0),
    ms: Date.now() - t0,
    error: live.length ? null : results.map((r) => r.error).filter(Boolean)[0] || 'No watchlist timelines returned data.',
  };
}

module.exports = { runWatchlistPull, fetchHandleTimeline };
