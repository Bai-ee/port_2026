// Quote-target scan via the PAID X API (data source 'x-api'; the default 'mac' path is scan-quote-targets.mjs + bird).
// SERVER-ONLY (default client = twitter-service.js). Same watchlist, same ranker, same stored payload as the script
// (scan-core.js builds it); only posts inside the quote window are requested (start_time = now - windowHours).
//
// Cost shape (estimateQuoteScan): per account = 1 users/by/username lookup (skipped when x_api_user_ids has the id)
// + 1 timeline call of perHandle posts (min 5, max 100). Accounts per run <= maxAccounts (default 15, rotating by offset).
// Not covered: track-list signals (listSignals) stay Mac-only. All I/O injected; tests use fakes.

import { readClientWatchlist, selectScanTargets } from './client-watchlist.js';
import { DEFAULT_WINDOW_HOURS } from './rank.js';
import { buildQuoteTargetsPayload } from './scan-core.js';
import { withXUsage as defaultWithXUsage, assertXBudget as defaultAssertXBudget } from '../x-api-usage/index.js';
import { TIMELINE_FIELDS, classifyXApiError, createMemoryUserIdCache } from '../x-strategy/x-api-pull.js';
import { DEFAULT_MAX_ACCOUNTS, DEFAULT_PER_HANDLE, clampPerHandle, estimateQuoteScan } from '../x-strategy/x-api-estimate.js';

export { DEFAULT_MAX_ACCOUNTS, DEFAULT_PER_HANDLE, estimateQuoteScan };
import { mapXApiPage } from '../x-strategy/x-api-mapper.js';

export const DEFAULT_SCAN_DEADLINE_MS = 80_000; // route maxDuration is 120 s (vercel.json app/api/**)
export const SCAN_METHOD = 'x-api users/:id/tweets (paid)';

/** Firestore writer: merge keeps the stored `dismissed` list, exactly like the script. */
export function createFirestoreQuotePayloadWriter(db) {
  return async (clientId, payload) => {
    await db.collection('dashboard_state').doc(clientId).set({ marketingBrief: { quoteTargets: payload } }, { merge: true });
  };
}

/**
 * @param {string} clientId
 * @param {Object} o
 * @param {{handle:string,vein:string,unproven?:boolean}[]} [o.watchlist]  else read via o.db / o.readWatchlist
 * @param {object} [o.db] @param {(clientId:string)=>Promise<object[]>} [o.readWatchlist]
 * @param {string} [o.only] @param {number} [o.offset] @param {number} [o.maxAccounts] @param {number} [o.perHandle] @param {number} [o.limit]
 * @param {number} [o.windowHours]
 * @param {object} [o.client] | o.getClient()  @param {object} [o.userIdCache]
 * @param {(clientId:string, payload:object)=>Promise<void>} [o.writePayload]  required when write
 * @param {boolean} [o.write=true] @param {boolean} [o.forceEmpty=false]
 * @param {{withXUsage?:Function, assertXBudget?:Function}} [o.usage]
 * @param {number} [o.deadlineMs] @param {()=>number} [o.now]
 * @returns {Promise<{ok:boolean, source:'x-api', clientId:string, wrote:boolean, calls:number, posts:number, payload?:object, stopped:string|null, skipped?:string, error?:string}>}
 */
export async function scanQuoteTargetsViaXApi(clientId, {
  watchlist, db, readWatchlist, only = '', offset = 0, maxAccounts = DEFAULT_MAX_ACCOUNTS, perHandle = DEFAULT_PER_HANDLE, limit = 12,
  windowHours = DEFAULT_WINDOW_HOURS, client, getClient, userIdCache, writePayload, write = true, forceEmpty = false,
  usage = {}, deadlineMs = DEFAULT_SCAN_DEADLINE_MS, now = Date.now,
} = {}) {
  const withXUsage = usage.withXUsage || defaultWithXUsage;
  const assertXBudget = usage.assertXBudget || defaultAssertXBudget;
  const cache = userIdCache || createMemoryUserIdCache();
  const out = { ok: false, source: 'x-api', clientId, wrote: false, calls: 0, posts: 0, stopped: null };

  const list = watchlist || (readWatchlist ? await readWatchlist(clientId) : db ? await readClientWatchlist(db, clientId) : null);
  if (!Array.isArray(list)) throw new Error('scanQuoteTargetsViaXApi: watchlist, readWatchlist or db is required');
  if (!list.length) return { ...out, skipped: 'no-watchlist', error: 'No watchlist saved for this client; nothing scanned.' };
  const targets = selectScanTargets(list, { only, maxAccounts, offset });
  if (!targets.length) return { ...out, skipped: 'no-targets', error: 'Nothing to scan (the handle is not on this client\'s watchlist).' };
  if (write && typeof writePayload !== 'function') throw new Error('scanQuoteTargetsViaXApi: writePayload is required to write');

  let xc = client;
  if (!xc) {
    try { xc = await (getClient || (async () => (await import('../social-posting/twitter-service.js')).getXReadClient()))(); } catch (err) {
      return { ...out, stopped: 'no-credentials', error: String(err?.message || 'X API credentials are not configured.').slice(0, 200) };
    }
  }

  const per = clampPerHandle(perHandle);
  const startTime = new Date(now() - windowHours * 3_600_000).toISOString();
  const deadlineAt = now() + deadlineMs;
  const pool = [];
  const failures = [];
  const rateLimited = [];

  for (const acct of targets) {
    if (out.stopped) { failures.push({ handle: acct.handle, error: `skipped (${out.stopped})` }); continue; }
    if (now() > deadlineAt) { out.stopped = 'deadline'; failures.push({ handle: acct.handle, error: 'skipped (deadline)' }); continue; }
    try {
      await assertXBudget({ source: 'quote-targets', clientId, estimatePosts: per });
      await withXUsage({ clientId, source: 'quote-targets' }, async () => {
        let id = await cache.get(acct.handle).catch(() => null);
        let user = null;
        if (!id) {
          const res = await xc.v2.userByUsername(acct.handle);
          out.calls += 1;
          id = res?.data?.id;
          user = res?.data || null;
          if (!id) throw Object.assign(new Error('user not found'), { code: 404 });
          await cache.set(acct.handle, id).catch(() => {});
        }
        const res = await xc.v2.userTimeline(String(id), { ...TIMELINE_FIELDS, max_results: per, exclude: ['retweets'], start_time: startTime });
        out.calls += 1;
        const page = res?.data && !Array.isArray(res.data) && ('data' in res.data || 'meta' in res.data) ? res.data : (res || {});
        const posts = mapXApiPage(page, { author: { username: acct.handle, ...(user?.name ? { name: user.name } : {}) } });
        out.posts += posts.length;
        pool.push(...posts);
      });
    } catch (err) {
      const c = classifyXApiError(err);
      if (c.kind === 'rate-limited') rateLimited.push(acct.handle); else failures.push({ handle: acct.handle, error: c.message });
      if (c.stop) out.stopped = c.kind;
    }
  }

  const payload = buildQuoteTargetsPayload({
    pool, watchlist: list, scanned: targets.length, failures, rateLimited, method: SCAN_METHOD,
    limit, windowHours, now: now(), generatedAt: new Date(now()).toISOString(), extra: { source: 'x-api' },
  });
  out.payload = payload;
  // Same guard as the script: a sweep where EVERY account failed must not replace a good stored scan with an empty one.
  if (payload.succeeded === 0 && !forceEmpty) {
    return { ...out, error: `All ${targets.length} accounts failed${failures[0] ? ` (${failures[0].error})` : ''}; stored scan kept.` };
  }
  if (write) { await writePayload(clientId, payload); out.wrote = true; }
  out.ok = true;
  return out;
}
