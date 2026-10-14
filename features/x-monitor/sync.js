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

//
// Per client: every sync takes a required clientId. The X client comes from
// that client's own Social Accounts connection (getPlatformClient); the X user
// id from social_accounts/{clientId}.platforms.x.userId (or an x_monitor root
// doc that already lists the client). The ONE documented exception is the home
// client (resolveDigestClientId) with no per-client X doc: it keeps the legacy
// global OAuth2 token and its userId, exactly as before multi-client. Every
// other client without its own connection fails closed (409) — never @bai_ee.

import { createRequire } from 'node:module';
import { getXOAuth2Client, getXOAuthConfigStatus, getXOAuthStatus } from '../social-posting/x-oauth.js';
import { getPlatformClient, getSocialAccount, toPublicAccount } from '../social-posting/social-accounts.js';
import { compactUser, diffRosters } from './audience-diff.js';
import {
  findAccountIdForClient,
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

const defaultDeps = {
  getPlatformClient: (clientId) => getPlatformClient(clientId, 'x'),
  getSocialAccount: (clientId) => getSocialAccount(clientId, 'x'),
  getXOAuth2Client,
  readGlobalStatus: () => getXOAuthStatus(),
  readConfigStatus: () => getXOAuthConfigStatus(),
  resolveHomeClientId: () => require('../intelligence/_digest-config.js').resolveDigestClientId(),
  findAccountIdForClient,
  logUsage: (entry) => require('../../api/_lib/usage-logger.cjs').logUsage(entry),
};
let deps = { ...defaultDeps };

/** Test-only: override collaborators (X client, account lookups, logger). Returns a restore function. */
export function __setXMonitorDepsForTest(overrides = {}) {
  const prev = deps;
  deps = { ...deps, ...overrides };
  return () => { deps = prev; };
}

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
function logCalls(clientId, action, calls, metadata = {}) {
  Promise.resolve()
    .then(() => deps.logUsage({
      module: 'x-monitor',
      action,
      provider: 'x-api',
      model: 'x-read',
      calls,
      costUsd: 0,
      clientId,
      metadata,
    }))
    .catch(() => {});
}

// A failed sync used to leave no trace anywhere: syncProfile logged its call
// only on success, so a run that died on the X call wrote nothing to
// usage_events AND nothing to the store — "it didn't work" with no evidence.
// Every failure now lands on the account doc as sync.lastError, so the card,
// the logs, and anyone debugging later can all see the same reason.
async function recordFailure(clientId, op, err, knownAccountId = null) {
  try {
    const accountId = knownAccountId || (await resolveAccountId(clientId)).accountId;
    if (!accountId) return; // nothing to attach the error to; the thrown error still reaches the caller
    await saveSyncMeta(accountId, {
      lastError: {
        op,
        at: Date.now(),
        code: err?.code ?? err?.status ?? null,
        title: err?.data?.title || err?.data?.detail || null,
        message: String(err?.message || 'Unknown error').slice(0, 400),
      },
    }, { clientId });
  } catch {
    // Never let the bookkeeping swallow the real error.
  }
}

function requireClientId(clientId) {
  if (!clientId || typeof clientId !== 'string') {
    const err = new Error('clientId is required for X Monitor syncs.');
    err.status = 400;
    err.code = 'client-id-required';
    throw err;
  }
  return clientId;
}

async function isHomeClient(clientId) {
  try {
    const home = await deps.resolveHomeClientId();
    return Boolean(home) && home === clientId;
  } catch {
    return false; // fail closed
  }
}

/**
 * The metered X client for this client. Free to resolve (reads stored tokens;
 * may refresh an expiring OAuth2 token, which is not a metered call).
 */
/**
 * Documented home exception: the home client's X Monitor stays on the legacy global connection (the account its
 * history lives under) whenever that connection exists, even if home ALSO has a per-client X doc (used for
 * publishing tests). Without a global connection, home behaves like any other client. Never true for a non-home
 * client.
 */
async function homeUsesGlobal(clientId, account) {
  if (!(await isHomeClient(clientId))) return false;
  if (!account) return true;
  try {
    const global = await deps.readGlobalStatus();
    return Boolean(global?.connected && global?.userId);
  } catch {
    return false;
  }
}

async function getMonitorClient(clientId) {
  const account = await deps.getSocialAccount(clientId);
  if (await homeUsesGlobal(clientId, account)) {
    // No clientId => the legacy global token (x-oauth.js); only ever reached for the home client.
    const { client } = await deps.getXOAuth2Client(account ? null : clientId);
    return client;
  }
  const { client } = await deps.getPlatformClient(clientId);
  return client;
}

/**
 * Resolve the X user id this client monitors without spending a call.
 * Order: (home with a global connection) the global token's userId → social_accounts userId → x_monitor doc
 * listing the client → (home only) the global token's userId. Returns { accountId: null } when unknown.
 */
export async function resolveAccountId(clientId) {
  requireClientId(clientId);
  const account = await deps.getSocialAccount(clientId);
  if (account && (await homeUsesGlobal(clientId, account))) {
    const global = await deps.readGlobalStatus();
    return { accountId: String(global.userId), username: global.username || null, source: 'global' };
  }
  if (account?.userId) return { accountId: String(account.userId), username: account.username || null, source: 'social_accounts' };
  const stored = await deps.findAccountIdForClient(clientId);
  if (stored) return { accountId: String(stored), username: account?.username || null, source: 'x_monitor' };
  if (!account && (await isHomeClient(clientId))) {
    const global = await deps.readGlobalStatus();
    if (global?.userId) return { accountId: String(global.userId), username: global.username || null, source: 'global' };
  }
  return { accountId: null, username: account?.username || null, source: null };
}

async function requireAccountId(clientId) {
  const resolved = await resolveAccountId(clientId);
  if (!resolved.accountId) {
    const err = new Error('The X user id for this client is not known yet. Run Sync profile first.');
    err.status = 409;
    err.code = 'account-id-unknown';
    throw err;
  }
  return resolved;
}

function clientIdFrom(opts) {
  return typeof opts === 'string' ? opts : opts?.clientId;
}

// ── Profile ──────────────────────────────────────────────────────────────────

/**
 * 1 call. Reads the live profile + counters and writes today's snapshot.
 * The users/me response id is authoritative for where the rows land, so a
 * client whose stored X doc has no userId still gets a correct account (no
 * extra call).
 */
export async function syncProfile(opts = {}) {
  const clientId = requireClientId(clientIdFrom(opts));
  const client = await getMonitorClient(clientId);
  let res;
  try {
    res = await client.v2.get('users/me', { 'user.fields': USER_FIELDS });
  } catch (err) {
    logCalls(clientId, 'profile-sync', 1, { failed: true });
    await recordFailure(clientId, 'profile', err);
    throw err;
  }
  const user = res?.data;
  if (!user?.id) throw new Error('X returned no profile for the connected account.');
  logCalls(clientId, 'profile-sync', 1);

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
  await saveProfile(profile.id, profile, { clientId });
  const snapshot = await saveSnapshot(profile.id, { ...profile, source: 'x-api' }, at);
  await saveSyncMeta(profile.id, { profileAt: at }, { clientId });
  return { clientId, accountId: profile.id, profile, snapshot, callsMade: 1 };
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
export async function syncPosts({ clientId: rawClientId, deep = false } = {}) {
  const clientId = requireClientId(rawClientId);
  const client = await getMonitorClient(clientId); // 409 account-not-connected first
  const { accountId } = await requireAccountId(clientId);

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
      logCalls(clientId, 'posts-sync', callsMade, { failed: true });
      await recordFailure(clientId, 'posts', err, accountId);
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
  await saveSyncMeta(accountId, { postsAt: at, postsCount: posts.length, metricsSource }, { clientId });
  logCalls(clientId, 'posts-sync', callsMade, { metricsSource, deep, posts: posts.length });

  return { clientId, accountId, count: posts.length, metricsSource, callsMade };
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
export async function syncAudience({ clientId: rawClientId, maxPages = DEFAULT_MAX_FOLLOWER_PAGES } = {}) {
  const clientId = requireClientId(rawClientId);
  const client = await getMonitorClient(clientId); // 409 account-not-connected first
  const { accountId } = await requireAccountId(clientId);

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
      logCalls(clientId, 'audience-sync', pages + 1, { failed: true });
      await recordFailure(clientId, 'audience', err, accountId);
      throw err;
    }
    pages += 1;
    users.push(...(res?.data || []).map(compactUser));
    paginationToken = res?.meta?.next_token || null;
  } while (paginationToken && pages < maxPages);

  const truncated = Boolean(paginationToken) || rateLimited;
  const complete = !truncated;
  logCalls(clientId, 'audience-sync', pages, { followers: users.length, complete });

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
  }, { clientId });

  return {
    clientId,
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

/**
 * Zero X calls. Connection status for this client's X Monitor, in the shape
 * the card already reads ({ config, connected, username, userId, ... }).
 * Home with no per-client doc → the legacy global status (documented exception).
 */
export async function readClientConnection(clientId) {
  requireClientId(clientId);
  const account = await deps.getSocialAccount(clientId);
  if (await homeUsesGlobal(clientId, account)) {
    return { ...(await deps.readGlobalStatus()), clientId, source: 'global' };
  }
  const pub = toPublicAccount(account);
  return {
    config: deps.readConfigStatus(),
    connected: pub.connected,
    username: pub.username,
    userId: pub.userId,
    scope: pub.scope,
    authMode: pub.authMode,
    expiresAt: account?.expiresAt || null,
    updatedAt: pub.updatedAt,
    clientId,
    source: account ? 'client' : null,
  };
}

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
