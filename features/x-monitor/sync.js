// sync.js — the metered half of the X Monitor card.
//
// ⚠️ EVERY function in this file spends X API credits, and X spend is invisible
// to the Operating Cost card (docs/source-of-truth/X-API-AND-PROFILE-OPERATIONS.md
// §0/§3). Nothing here may run on a timer or as a side effect of loading a page:
// each call site passes through the card's confirm row, which names the call
// count first. Each function returns `callsMade` so that number stays honest.
//
// Why the X API and not the ScrapeCreators read path the SSOT prefers (§2c):
// ScrapeCreators has no X followers endpoint at all, and its /v1/twitter/user-tweets
// returns 0 posts for small accounts (verified: a 1.5k-follower account → 0,
// levelsio → 99). It also cannot see impressions/profile clicks, which only the
// authenticated owner can read. One /2/users/:id/tweets call returns 100 posts
// WITH impressions — cheaper in calls than ScrapeCreators' 1-credit-per-post
// view lookup. Reads stay on ScrapeCreators everywhere it can actually answer.

import { createRequire } from 'node:module';
import { getXOAuth2Client } from '../social-posting/x-oauth.js';
import { compactUser, diffRosters } from './audience-diff.js';
import {
  listSnapshots,
  readAccount,
  readRoster,
  saveProfile,
  saveSnapshot,
  saveSyncMeta,
  writeAudienceEvents,
  writePosts,
  writeRoster,
} from './store.js';

const require = createRequire(import.meta.url);
const { logUsage } = require('../../api/_lib/usage-logger.cjs');

const FOLLOWER_PAGE_SIZE = 1000;
const DEFAULT_MAX_FOLLOWER_PAGES = 6; // 6000 followers per sync, then truncate.
const PRIVATE_METRIC_WINDOW_DAYS = 30; // X only serves non-public metrics this far back.

const USER_FIELDS = 'public_metrics,description,profile_image_url,created_at,location,url,verified,protected';
const FOLLOWER_FIELDS = 'username,name,profile_image_url,public_metrics,description,created_at,verified';
const PUBLIC_TWEET_FIELDS = 'created_at,public_metrics,referenced_tweets';
const PRIVATE_TWEET_FIELDS = `${PUBLIC_TWEET_FIELDS},non_public_metrics,organic_metrics`;

// Call counts are logged (not dollars — X publishes no per-call rate we could
// apply honestly). This at least makes read volume visible next to the writes
// social-posting already logs.
function logCalls(action, calls, metadata = {}) {
  logUsage({
    module: 'x-monitor',
    action,
    provider: 'x-api',
    model: 'x-read',
    calls,
    costUsd: 0,
    metadata,
  }).catch(() => {});
}

// A failed sync used to leave no trace anywhere: syncProfile logged its call
// only on success, so a run that died on the X call wrote nothing to
// usage_events AND nothing to the store — "it didn't work" with no evidence.
// Every failure now lands on the account doc as sync.lastError, so the card,
// the logs, and anyone debugging later can all see the same reason.
async function recordFailure(op, err) {
  try {
    const { accountId } = await resolveAccountId();
    await saveSyncMeta(accountId, {
      lastError: {
        op,
        at: Date.now(),
        code: err?.code ?? err?.status ?? null,
        title: err?.data?.title || err?.data?.detail || null,
        message: String(err?.message || 'Unknown error').slice(0, 400),
      },
    });
  } catch {
    // Never let the bookkeeping swallow the real error.
  }
}

/** Resolve the connected account without spending a call (reads stored tokens). */
export async function resolveAccountId() {
  const { tokens } = await getXOAuth2Client();
  const accountId = tokens?.userId ? String(tokens.userId) : null;
  if (!accountId) {
    const err = new Error('The connected X token has no stored user id — reconnect the account.');
    err.status = 409;
    throw err;
  }
  return { accountId, username: tokens.username || null };
}

// ── Profile ──────────────────────────────────────────────────────────────────

/** 1 call. Reads the live profile + counters and writes today's snapshot. */
export async function syncProfile() {
  const { client } = await getXOAuth2Client();
  let res;
  try {
    res = await client.v2.get('users/me', { 'user.fields': USER_FIELDS });
  } catch (err) {
    logCalls('profile-sync', 1, { failed: true });
    await recordFailure('profile', err);
    throw err;
  }
  const user = res?.data;
  if (!user?.id) throw new Error('X returned no profile for the connected account.');
  logCalls('profile-sync', 1);

  const metrics = user.public_metrics || {};
  const profile = {
    id: String(user.id),
    username: user.username || null,
    name: user.name || null,
    bio: user.description || null,
    avatar: user.profile_image_url || null,
    location: user.location || null,
    url: user.url || null,
    verified: Boolean(user.verified),
    protected: Boolean(user.protected),
    accountCreatedAt: user.created_at || null,
    followers: Number(metrics.followers_count) || 0,
    following: Number(metrics.following_count) || 0,
    posts: Number(metrics.tweet_count) || 0,
    listed: Number(metrics.listed_count) || 0,
    likesGiven: Number(metrics.like_count) || 0,
  };

  const at = Date.now();
  await saveProfile(profile.id, profile);
  const snapshot = await saveSnapshot(profile.id, { ...profile, source: 'x-api' }, at);
  await saveSyncMeta(profile.id, { profileAt: at });
  return { accountId: profile.id, profile, snapshot, callsMade: 1 };
}

// ── Posts ────────────────────────────────────────────────────────────────────

/**
 * 1 call (2 if the private-metric request is rejected and we retry public-only,
 * or if `deep` asks for the older public-metrics page).
 *
 * Default window is 30 days because that is exactly how far back X will serve
 * non_public_metrics/organic_metrics — asking for them on older posts is what
 * makes the whole request fail, so we bound the request instead of hoping.
 */
export async function syncPosts({ deep = false } = {}) {
  const { client } = await getXOAuth2Client();
  const { accountId } = await resolveAccountId();

  const startTime = new Date(Date.now() - PRIVATE_METRIC_WINDOW_DAYS * 86_400_000).toISOString();
  const base = { max_results: 100, exclude: 'retweets' };

  let callsMade = 0;
  let metricsSource = 'private';
  let raw;
  try {
    raw = await client.v2.get(`users/${accountId}/tweets`, {
      ...base,
      start_time: startTime,
      'tweet.fields': PRIVATE_TWEET_FIELDS,
    });
    callsMade += 1;
  } catch (err) {
    callsMade += 1;
    // Only a field-authorization refusal is worth a second call. A 429/402/401
    // means the retry would fail identically and just burn another credit.
    if (err?.code !== 400 && err?.code !== 403) {
      logCalls('posts-sync', callsMade, { failed: true });
      await recordFailure('posts', err);
      throw err;
    }
    metricsSource = 'public';
    raw = await client.v2.get(`users/${accountId}/tweets`, {
      ...base,
      start_time: startTime,
      'tweet.fields': PUBLIC_TWEET_FIELDS,
    });
    callsMade += 1;
  }

  let tweets = raw?.data || [];

  if (deep) {
    // Older history, public metrics only (X will not serve private metrics here).
    const older = await client.v2.get(`users/${accountId}/tweets`, {
      ...base,
      'tweet.fields': PUBLIC_TWEET_FIELDS,
    });
    callsMade += 1;
    const seen = new Set(tweets.map((t) => t.id));
    tweets = tweets.concat((older?.data || []).filter((t) => !seen.has(t.id)));
  }

  const username = (await readAccount(accountId))?.profile?.username || null;
  const posts = tweets.map((tweet) => normalizePost(tweet, username, metricsSource));
  const at = Date.now();
  await writePosts(accountId, posts, at);
  await saveSyncMeta(accountId, { postsAt: at, postsCount: posts.length, metricsSource });
  logCalls('posts-sync', callsMade, { metricsSource, deep, posts: posts.length });

  return { accountId, count: posts.length, metricsSource, callsMade };
}

function normalizePost(tweet, username, metricsSource) {
  const pub = tweet.public_metrics || {};
  const nonPublic = tweet.non_public_metrics || {};
  const organic = tweet.organic_metrics || {};
  const referenced = tweet.referenced_tweets?.[0]?.type || null;
  const impressions = firstNumber(nonPublic.impression_count, organic.impression_count, pub.impression_count);

  return {
    id: String(tweet.id),
    text: String(tweet.text || ''),
    url: username ? `https://x.com/${username}/status/${tweet.id}` : `https://x.com/i/web/status/${tweet.id}`,
    createdAt: tweet.created_at || null,
    kind: referenced === 'replied_to' ? 'reply' : referenced === 'quoted' ? 'quote' : 'post',
    metricsSource: impressions == null ? 'public' : metricsSource,
    metrics: {
      likes: num(pub.like_count),
      retweets: num(pub.retweet_count),
      replies: num(pub.reply_count),
      quotes: num(pub.quote_count),
      bookmarks: num(pub.bookmark_count),
      impressions,
      profileClicks: firstNumber(nonPublic.user_profile_clicks, organic.user_profile_clicks),
      linkClicks: firstNumber(nonPublic.url_link_clicks, organic.url_link_clicks),
    },
  };
}

// ── Audience ─────────────────────────────────────────────────────────────────

/** Free: how many follower pages the next audience sync will cost. */
export async function estimateAudienceCalls(accountId) {
  const account = await readAccount(accountId);
  const followers = Number(account?.profile?.followers) || 0;
  const pages = Math.max(1, Math.ceil(followers / FOLLOWER_PAGE_SIZE));
  return { followers, pages: Math.min(pages, DEFAULT_MAX_FOLLOWER_PAGES), capped: pages > DEFAULT_MAX_FOLLOWER_PAGES };
}

/**
 * 1 call per 1000 followers. Pulls the full follower roster, diffs it against
 * the stored one, and records who arrived and who left.
 *
 * The truncation guard matters: if the page cap or a rate limit cuts the fetch
 * short we still store the partial roster, but mark it incomplete so no diff —
 * this run's or the next one's — can turn "not fetched" into "unfollowed".
 */
export async function syncAudience({ maxPages = DEFAULT_MAX_FOLLOWER_PAGES } = {}) {
  const { client } = await getXOAuth2Client();
  const { accountId } = await resolveAccountId();

  const users = [];
  let paginationToken = null;
  let pages = 0;
  let rateLimited = false;

  do {
    let res;
    try {
      res = await client.v2.get(`users/${accountId}/followers`, {
        max_results: FOLLOWER_PAGE_SIZE,
        'user.fields': FOLLOWER_FIELDS,
        ...(paginationToken ? { pagination_token: paginationToken } : {}),
      });
    } catch (err) {
      // A mid-scan 429/402 must not discard the pages we already paid for.
      if (pages > 0 && (err?.code === 429 || err?.code === 402)) {
        rateLimited = true;
        break;
      }
      logCalls('audience-sync', pages + 1, { failed: true });
      await recordFailure('audience', err);
      throw err;
    }
    pages += 1;
    users.push(...(res?.data || []).map(compactUser));
    paginationToken = res?.meta?.next_token || null;
  } while (paginationToken && pages < maxPages);

  const truncated = Boolean(paginationToken) || rateLimited;
  const complete = !truncated;
  logCalls('audience-sync', pages, { followers: users.length, complete });

  const previous = await readRoster(accountId);
  const nextById = new Map(users.map((u) => [u.id, u]));
  const diff = diffRosters(previous.byId, nextById, {
    prevComplete: previous.complete,
    nextComplete: complete,
  });

  const at = Date.now();
  const events = [
    ...diff.gained.map((user) => ({ type: 'gained', detectedAt: at, user })),
    ...diff.lost.map((user) => ({ type: 'lost', detectedAt: at, user })),
  ];
  const eventResult = events.length ? await writeAudienceEvents(accountId, events) : { written: 0, dropped: 0 };

  await writeRoster(accountId, users, { complete, at });
  await saveSyncMeta(accountId, {
    audienceAt: at,
    rosterSize: users.length,
    rosterComplete: complete,
    lastGained: diff.gained.length,
    lastLost: diff.lost.length,
  });

  return {
    accountId,
    callsMade: pages,
    rosterSize: users.length,
    complete,
    truncated,
    rateLimited,
    baseline: diff.baseline,
    lossesSuppressed: diff.lossesSuppressed,
    gained: diff.gained.length,
    lost: diff.lost.length,
    eventsDropped: eventResult.dropped,
  };
}

// ── Free reads ───────────────────────────────────────────────────────────────

/** Zero X calls — everything the card renders comes from stored snapshots. */
export async function readOverview(accountId) {
  const [account, snapshots] = await Promise.all([
    readAccount(accountId),
    listSnapshots(accountId),
  ]);
  return { account, snapshots };
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function firstNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
