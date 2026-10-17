// Shared by both quote-target scan sources: the local bird script (scripts/x-content/scan-quote-targets.mjs) and the
// X API scanner (x-api-scan.js). Pure: the stored dashboard_state.marketingBrief.quoteTargets payload has ONE shape.
import { rankQuoteTargets } from './rank.js';
import { toCandidate } from './list-signals-scan.js';

/**
 * Rank a pooled set of posts and build the stored payload (same keys, same order as the original script).
 * @param {Object} o
 * @param {object[]} o.pool          bird-shaped posts from every scanned account
 * @param {{handle:string}[]} o.watchlist
 * @param {number} o.scanned         accounts attempted
 * @param {{handle:string,error:string}[]} o.failures
 * @param {string[]} o.rateLimited
 * @param {string} o.method          'bird user-tweets (local, free)' | 'x-api users/:id/tweets (paid)'
 * @param {number} o.limit @param {number} o.windowHours @param {string} [o.generatedAt] @param {number} [o.now]
 * @param {object} [o.extra]         extra keys appended after the common ones (e.g. {source:'x-api'})
 */
export function buildQuoteTargetsPayload({ pool, watchlist, scanned, failures, rateLimited, method, limit, windowHours, generatedAt = new Date().toISOString(), now, extra = {} }) {
  const ranked = rankQuoteTargets(pool, { limit, windowHours, watchlist, ...(now !== undefined ? { now } : {}) });
  const candidates = ranked.map(toCandidate);
  return {
    generatedAt,
    method,
    windowHours,
    scanned,
    succeeded: scanned - failures.length - rateLimited.length,
    pooled: pool.length,
    failures,
    rateLimited,
    candidates,
    ...extra,
  };
}
