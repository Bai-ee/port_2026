'use strict';

// opportunity-signals-search.js — Opportunity Signals search refresh (Market
// Signals elevated feature, per docs/plans/OPPORTUNITY-SIGNALS-MARKET-SIGNALS-PLAN.md).
// Searches Reddit + Instagram via the prod-safe ScrapeCreators Node client for a
// client's editable buying-signal query rows, normalizes results into one item
// shape, dedupes, and persists to dashboard_state.marketingBrief.opportunitySignals.
// Recipes must not fetch data — this is the Scout-side step; the
// opportunity-signals analyzer recipe reads what this writes.
//
// ⚠️ X/Twitter search uses the real X API (features/social-posting/twitter-service.js
// searchXPosts) — ScrapeCreators has no X search endpoint (see docs/x-content/README.md).
// X API spend is NOT visible on the Operating Cost card (see
// docs/source-of-truth/X-API-AND-PROFILE-OPERATIONS.md) and is paid per call, so X is
// deliberately kept OUT of the unattended daily cron: refreshOpportunitySignals only
// searches X when called with { allowX: true } — the dashboard's manual "Refresh Now"
// action (app/api/dashboard/opportunity-signals/refresh/route.js) passes that; the
// pre-digest-refresh cron/worker does not, so an automated run silently drops any
// enabled 'x' platform with a warning rather than spending on it unattended.

const fb = require('../../api/_lib/firebase-admin.cjs');
const { searchReddit, searchInstagram, hasApiKey } = require('./external-scouts/scrapecreators-client.js');

const DEFAULT_MAX_QUERIES_PER_RUN = 4;
const DEFAULT_MAX_ITEMS_PER_PLATFORM = 10;
const SUPPORTED_PLATFORMS = new Set(['reddit', 'instagram', 'x']);

function str(v) { return String(v == null ? '' : v).trim(); }

function normalizeItem(raw, { platform, queryLabel, query }) {
  return {
    platform,
    queryLabel: queryLabel || '',
    query: query || '',
    title: str(raw.title),
    text: str(raw.summary),
    author: str(raw.author),
    handle: str(raw.subreddit || raw.tag || ''),
    url: str(raw.url),
    publishedAt: raw.publishedAt || null,
    engagement: raw.engagement || {},
    source: raw.source || `scrapecreators-${platform}`,
    raw: null,
  };
}

function dedupeItems(items, maxPerPlatform) {
  const seen = new Set();
  const byPlatform = new Map();
  const out = [];
  for (const it of items) {
    const key = (it.url || `${it.platform}|${it.author}|${it.title}`).toLowerCase();
    if (!key.trim() || seen.has(key)) continue;
    const countForPlatform = byPlatform.get(it.platform) || 0;
    if (countForPlatform >= maxPerPlatform) continue;
    seen.add(key);
    byPlatform.set(it.platform, countForPlatform + 1);
    out.push(it);
  }
  return out;
}

/** Search enabled platforms for a client's enabled Opportunity Signals query
 *  rows and persist the normalized pool. Best-effort — never throws. Skips
 *  cleanly (no cost) when the feature is disabled or no API key is configured,
 *  matching the refreshPlatformSignals convention in pre-digest-refresh.
 *
 *  @param {boolean} [opts.allowX] — must be explicitly true to search X (paid,
 *    untracked on the Operating Cost card). Callers from the unattended cron
 *    must NOT set this; only a deliberate dashboard action should. */
async function refreshOpportunitySignals(clientId, { allowX = false } = {}) {
  if (!clientId) return { ok: false, skipped: true, reason: 'no-clientId' };
  if (!hasApiKey()) return { ok: false, skipped: true, reason: 'no-key' };

  let cfg;
  try {
    const snap = await fb.adminDb.collection('client_configs').doc(clientId).get();
    cfg = snap.exists ? (snap.data()?.marketingBriefConfig?.opportunitySignals || null) : null;
  } catch (err) {
    return { ok: false, error: `client_configs read failed: ${err.message}` };
  }
  if (!cfg?.enabled) return { ok: false, skipped: true, reason: 'disabled' };

  const requestedPlatforms = (Array.isArray(cfg.platforms) ? cfg.platforms : []).map((p) => str(p).toLowerCase());
  const unsupportedRequested = requestedPlatforms.filter((p) => p && !SUPPORTED_PLATFORMS.has(p));
  const warnings = [];
  if (unsupportedRequested.length) {
    warnings.push(`Platform(s) not recognized: ${unsupportedRequested.join(', ')}.`);
  }
  let platforms = requestedPlatforms.filter((p) => SUPPORTED_PLATFORMS.has(p));
  if (platforms.includes('x') && !allowX) {
    platforms = platforms.filter((p) => p !== 'x');
    warnings.push('X is enabled but this run is not a manual dashboard trigger — X search only runs from the "Refresh Now" button (paid, kept out of the automated cron).');
  }

  const maxQueriesPerRun = Number.isFinite(cfg.maxQueriesPerRun) ? Math.max(1, Math.min(8, cfg.maxQueriesPerRun)) : DEFAULT_MAX_QUERIES_PER_RUN;
  const maxItemsPerPlatform = Number.isFinite(cfg.maxItemsPerPlatform) ? Math.max(1, Math.min(30, cfg.maxItemsPerPlatform)) : DEFAULT_MAX_ITEMS_PER_PLATFORM;

  const rows = (Array.isArray(cfg.queries) ? cfg.queries : [])
    .filter((row) => row?.enabled !== false && str(row?.query))
    .slice(0, maxQueriesPerRun);

  if (!platforms.length) return { ok: false, skipped: true, reason: 'no-supported-platforms', warnings };
  if (!rows.length) return { ok: false, skipped: true, reason: 'no-enabled-queries', warnings };

  const queriesTried = rows.map((row) => ({ label: row.label || '', query: row.query, enabled: true }));

  // One search call per (platform, enabled row) pair, all concurrent — wall-clock
  // = the slowest single call, not the sum. Per-row (not merged) so each result
  // keeps its queryLabel; ScrapeCreators/X bill per query term either way, so
  // this costs the same as merging, it just preserves attribution.
  let searchXPosts = null;
  if (platforms.includes('x')) {
    ({ searchXPosts } = await import('../social-posting/twitter-service.js'));
  }
  const jobs = [];
  for (const platform of platforms) {
    for (const row of rows) jobs.push({ platform, row });
  }
  const settled = await Promise.all(jobs.map(async ({ platform, row }) => {
    const call = platform === 'reddit'
      ? searchReddit({ queries: [row.query], limit: maxItemsPerPlatform, maxQueries: 1 })
      : platform === 'instagram'
        ? searchInstagram({ queries: [row.query], limit: maxItemsPerPlatform, maxQueries: 1 })
        : searchXPosts(row.query, { limit: Math.max(10, maxItemsPerPlatform) }); // X min max_results is 10
    const r = await call;
    if (!r.ok) { warnings.push(`${platform} "${row.label || row.query}": ${r.error}`); return []; }
    return r.items.slice(0, maxItemsPerPlatform).map((it) => normalizeItem(it, { platform, queryLabel: row.label, query: row.query }));
  }));
  const collected = settled.flat();
  const items = dedupeItems(collected, maxItemsPerPlatform);

  const payload = {
    generatedAt: new Date().toISOString(),
    platforms,
    queriesTried,
    items,
    meta: { maxQueriesPerRun, maxItemsPerPlatform, warnings },
  };

  try {
    await fb.adminDb.collection('dashboard_state').doc(clientId).set(
      { marketingBrief: { opportunitySignals: payload }, updatedAt: fb.FieldValue.serverTimestamp() },
      { merge: true }
    );
  } catch (err) {
    return { ok: false, error: `persist failed: ${err.message}`, itemCount: items.length };
  }

  return { ok: true, itemCount: items.length, platforms, warnings };
}

module.exports = { refreshOpportunitySignals };
