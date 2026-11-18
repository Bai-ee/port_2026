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
// Per client: every sync takes a required clientId, but READS NEVER NEED A CONNECTED X ACCOUNT. They always run on
// the owner/app credentials (env OAuth1 keys, read-only view: getXReadClient().readOnly), the same credentials
// x-search uses. Spend is metered in the x_api_usage ledger, tagged with the client the run was for (source
// 'x-monitor'), and gated by assertXBudget. WRITES are out of scope here and stay on getPlatformClient.
//
// The TARGET account (whose numbers are read) resolves free. HOME: global connection -> social_accounts userId ->
// an x_monitor doc listing it -> global userId -> saved handle. NON-HOME (owner rule 2026-11-18: a client's identity is
// the client's own handle; the owner connects @bai_ee to client workspaces only for API access): the brand handle
// (xGrowth.ownHandle -> Brain identity.xHandle, resolveClientHandle dep) -> the connected social_accounts account ONLY
// when its username equals the brand handle (or, with no brand handle, its userId is not the owner's) -> an x_monitor
// doc listing the client, ignoring the owner's own doc and, when a brand handle exists, any doc whose profile username
// differs -> the brand handle alone (accountId null). With only a handle the
// profile is read by username (users/by/username/:handle) which also stamps the id; posts/audience then run a
// profile lookup first (1 extra call). With neither an id nor a handle: 409 client-x-handle-missing. Private metrics are requested only when the target id is the
// owner credential's own user id (parsed from the OAuth1 token, no call); otherwise public fields only.

import { createRequire } from 'node:module';
import { assertXBudget, withXUsage } from '../x-api-usage/index.js';
import { getXOAuthConfigStatus, getXOAuthStatus } from '../social-posting/x-oauth.js';
import { getSocialAccount, toPublicAccount } from '../social-posting/social-accounts.js';
import { connectedAccountCounts, connectedAccountUserId } from '../client-readiness/index.js';
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
  // Owner/app credentials, read-only view (instrumented by twitter-service, so every call lands in the ledger).
  // Lazy import keeps this module light for tests and for routes that only call the free reads.
  getOwnerReadClient: async () => (await import('../social-posting/twitter-service.js')).getXReadClient().readOnly,
  getOwnerReadIdentity: async () => (await import('../social-posting/twitter-service.js')).getOwnerReadIdentity(),
  assertXBudget,
  // BRAND handle only (xGrowth / Brain): never the connected social username, which may be the owner's account.
  resolveClientHandle: async (clientId) => {
    const { resolveBrandHandle } = await import('../client-readiness/index.js');
    return resolveBrandHandle(require('../../api/_lib/firebase-admin.cjs').adminDb, clientId);
  },
  getSocialAccount: (clientId) => getSocialAccount(clientId, 'x'),
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

/** The metered X client: ALWAYS the owner/app read-only client, whatever the client's own connection is. Free to resolve. */
async function getMonitorClient() {
  return deps.getOwnerReadClient();
}

/**
 * Resolve the X account this client's monitor reads, without spending a call.
 * HOME: (with a global connection) the global token's userId -> social_accounts userId -> x_monitor doc listing the
 * client (latest profile sync wins) -> the global token's userId -> saved handle (accountId null).
 * NON-HOME: brand handle, then the connected account only if it is the client's own, then a matching x_monitor doc,
 * else the brand handle alone (accountId null); never the owner's account. Every result carries { accountId, username, handle, source }.
 */
export async function resolveAccountId(clientId) {
  requireClientId(clientId);
  const account = await deps.getSocialAccount(clientId);
  const hit = (accountId, username, source) => ({ accountId: String(accountId), username: username || null, handle: username || null, source });
  if (!(await isHomeClient(clientId))) return resolveNonHomeAccountId(clientId, account, hit);
  return resolveHomeAccountId(clientId, account, hit);
}

// HOME: its own account is the owner's, so the connected account / global token / x_monitor tag are all its own.
async function resolveHomeAccountId(clientId, account, hit) {
  if (account && (await homeUsesGlobal(clientId, account))) {
    const global = await deps.readGlobalStatus();
    return hit(global.userId, global.username, 'global');
  }
  if (account?.userId) return hit(account.userId, account.username, 'social_accounts');
  const stored = await deps.findAccountIdForClient(clientId);
  if (stored) {
    let storedUsername = null;
    try { storedUsername = (await readAccount(stored))?.profile?.username || null; } catch { /* name is cosmetic */ }
    // Free re-check: the saved handle (Strategy / Brain) may have changed since the id was stamped. When it differs from
    // the stored account's username, follow the handle so a typo'd or old handle does not stay pinned to a stranger.
    if (storedUsername) {
      let saved = null;
      try { saved = await deps.resolveClientHandle(clientId); } catch { saved = null; }
      const savedHandle = String(saved?.handle || '').replace(/^@/, '');
      if (savedHandle && savedHandle.toLowerCase() !== String(storedUsername).toLowerCase()) {
        return { accountId: null, username: savedHandle, handle: savedHandle, source: saved.source || 'handle' };
      }
    }
    return hit(stored, account?.username || storedUsername, 'x_monitor');
  }
  if (!account && (await isHomeClient(clientId))) {
    const global = await deps.readGlobalStatus();
    if (global?.userId) return hit(global.userId, global.username, 'global');
  }
  let resolved = null;
  try { resolved = await deps.resolveClientHandle(clientId); } catch { resolved = null; }
  if (resolved?.handle) return { accountId: null, username: resolved.handle, handle: resolved.handle, source: resolved.source || 'handle' };
  return { accountId: null, username: account?.username || null, handle: account?.username || null, source: null };
}

// NON-HOME: identity is the client's own handle (see header). Free; never returns the owner's account.
async function resolveNonHomeAccountId(clientId, account, hit) {
  let ownerId = null;
  try { ownerId = String((await deps.getOwnerReadIdentity())?.userId || '') || null; } catch { ownerId = null; }
  let brand = null;
  try { brand = await deps.resolveClientHandle(clientId); } catch { brand = null; }
  const brandHandle = String(brand?.handle || '').replace(/^@+/, '') || null;
  const counts = connectedAccountCounts(account, { brandHandle, ownerUserId: ownerId });
  const accountUserId = connectedAccountUserId(account);
  if (counts && accountUserId) return hit(accountUserId, account.username, 'social_accounts');
  // Fail closed: with no owner id and no brand handle the owner-doc filter cannot run, so skip the x_monitor fallback.
  const stored = (!ownerId && !brandHandle) ? null : await deps.findAccountIdForClient(clientId, { skipSocial: true, ownerUserId: ownerId, brandHandle });
  if (stored) return hit(stored, brandHandle || (counts ? account.username : null), 'x_monitor');
  if (brandHandle) return { accountId: null, username: brandHandle, handle: brandHandle, source: brand.source || 'handle' };
  // No brand handle: only a connected account that is not the owner's can name the client (userId-less: by username).
  if (counts) return { accountId: null, username: account.username, handle: account.username, source: null };
  return { accountId: null, username: null, handle: null, source: null };
}

function handleMissingError() {
  const err = new Error('No X account or handle is saved for this client. Save the X handle in Strategy > X profile or in the Client Brain, then run the sync again.');
  err.status = 409;
  err.code = 'client-x-handle-missing';
  return err;
}

/**
 * Budget gate (free: one ledger read). Runs before any X call; a cap hit throws XBudgetError (429).
 * `estimatePosts` counts read units, like the other X readers.
 */
async function guardBudget(clientId, estimatePosts) {
  await deps.assertXBudget({ source: 'x-monitor', clientId, estimatePosts });
}

/**
 * Posts/audience need the numeric id. With only a handle, run the profile lookup first (1 extra call), which
 * stamps the id, then continue. Never fails with account-id-unknown while a handle exists.
 */
async function ensureAccountId(clientId) {
  const resolved = await resolveAccountId(clientId);
  if (resolved.accountId) return { ...resolved, extraCalls: 0 };
  if (!resolved.handle) throw handleMissingError();
  const profile = await syncProfileImpl({ clientId });
  return { accountId: profile.accountId, username: resolved.username, handle: resolved.handle, source: resolved.source, extraCalls: profile.callsMade };
}

function clientIdFrom(opts) {
  return typeof opts === 'string' ? opts : opts?.clientId;
}

// ── Profile ──────────────────────────────────────────────────────────────────

/**
 * 1 call. Reads the live profile + counters and writes today's snapshot, on the owner read client.
 * users/:id when the id is known, else users/by/username/:handle. The response id is authoritative for where the
 * rows land, so a handle-only client gets its id stamped here (no extra call).
 */
async function syncProfileImpl(opts = {}) {
  const clientId = requireClientId(clientIdFrom(opts));
  const target = await resolveAccountId(clientId);
  if (!target.accountId && !target.handle) throw handleMissingError(); // never users/me: that is the owner, not this client
  await guardBudget(clientId, 1);
  const client = await getMonitorClient();
  const path = target.accountId ? `users/${target.accountId}` : `users/by/username/${encodeURIComponent(target.handle)}`;
  let res;
  try {
    res = await client.v2.get(path, { 'user.fields': USER_FIELDS });
  } catch (err) {
    logCalls(clientId, 'profile-sync', 1, { failed: true });
    await recordFailure(clientId, 'profile', err, target.accountId);
    throw err;
  }
  const user = res?.data;
  if (!user?.id) throw new Error('X returned no profile for this account.');
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
 * 1 call (+1 profile lookup when only a handle is known; 2 if the private-metric request is rejected and we retry public-only,
 * or if `deep` asks for the older public-metrics page).
 *
 * Default window is 30 days because that is exactly how far back X will serve
 * non_public_metrics/organic_metrics — asking for them on older posts is what
 * makes the whole request fail, so we bound the request instead of hoping.
 */
async function syncPostsImpl({ clientId: rawClientId, deep = false } = {}) {
  const clientId = requireClientId(rawClientId);
  const { accountId, extraCalls } = await ensureAccountId(clientId); // handle-only: profile lookup first
  await guardBudget(clientId, deep ? 200 : 100);
  const client = await getMonitorClient();
  const ownerId = (await deps.getOwnerReadIdentity())?.userId || null;
  const privateAllowed = Boolean(ownerId) && String(accountId) === String(ownerId);

  const startTime = new Date(Date.now() - PRIVATE_METRIC_WINDOW_DAYS * 86_400_000).toISOString();
  const base = { max_results: 100, exclude: 'retweets' };

  let callsMade = 0;
  let metricsSource = privateAllowed ? 'private' : 'public';
  let raw;
  try {
    raw = await client.v2.get(`users/${accountId}/tweets`, {
      ...base,
      start_time: startTime,
      'tweet.fields': privateAllowed ? PRIVATE_TWEET_FIELDS : PUBLIC_TWEET_FIELDS,
    });
    callsMade += 1;
  } catch (err) {
    callsMade += 1;
    // Only a field-authorization refusal on a PRIVATE request is worth a second call. A 429/402/401
    // means the retry would fail identically and just burn another credit.
    if (!privateAllowed || (err?.code !== 400 && err?.code !== 403)) {
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

  return { clientId, accountId, count: posts.length, metricsSource, callsMade: callsMade + extraCalls };
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
async function syncAudienceImpl({ clientId: rawClientId, maxPages = DEFAULT_MAX_FOLLOWER_PAGES } = {}) {
  const clientId = requireClientId(rawClientId);
  const { accountId, extraCalls } = await ensureAccountId(clientId); // handle-only: profile lookup first
  const est = await estimateAudienceCalls(accountId);
  await guardBudget(clientId, Math.min(est.pages, maxPages) * FOLLOWER_PAGE_SIZE);
  const client = await getMonitorClient();

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
    callsMade: pages + extraCalls,
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

// Every X Monitor sync is attributed to its client + the 'x-monitor' source in the X API usage ledger.
const tagged = (fn) => (opts) => withXUsage({ clientId: clientIdFrom(opts) || null, source: 'x-monitor' }, () => fn(opts));
export const syncProfile = tagged(syncProfileImpl);
export const syncPosts = tagged(syncPostsImpl);
export const syncAudience = tagged(syncAudienceImpl);
