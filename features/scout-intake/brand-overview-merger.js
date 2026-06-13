'use strict';

const fb = require('../../api/_lib/firebase-admin.cjs');

const FIELDS = ['headline', 'summary', 'industry', 'businessModel', 'targetAudience', 'positioning'];

/**
 * Read the existing brandOverview for a client from dashboard_state.
 * Returns null when absent.
 */
async function readExistingBrandOverview(clientId) {
  try {
    const snap = await fb.adminDb.collection('dashboard_state').doc(clientId).get();
    return snap.data()?.snapshot?.brandOverview || null;
  } catch {
    return null;
  }
}

/**
 * Returns true when a field value looks like a real deliberate entry
 * rather than an empty string or placeholder.
 */
function isSubstantive(val) {
  if (!val || typeof val !== 'string') return false;
  const t = val.trim();
  return t.length >= 3;
}

/**
 * Merge a freshly-crawled brandOverview against the existing user-set one.
 *
 * Logic:
 * - If no existing user content → return crawled with source: 'crawl'
 * - If existing source is not 'user' → return crawled with source: 'crawl'
 *   (previous crawl or merge; let the new crawl win cleanly)
 * - If existing source is 'user' → run Haiku merge agent; return merged result
 *
 * Falls back to crawled data on any agent error — never blocks the pipeline.
 */
async function mergeBrandOverview(clientId, crawledBrandOverview) {
  if (!clientId || !crawledBrandOverview) return null;

  const existing = await readExistingBrandOverview(clientId);

  // No prior data — new crawl wins cleanly.
  if (!existing) {
    return { ...crawledBrandOverview, source: 'crawl' };
  }

  // Prior data was already crawl/merged — new crawl wins, but fill empty slots from prior.
  if (existing.source !== 'user') {
    const result = { ...crawledBrandOverview, source: 'crawl' };
    for (const field of FIELDS) {
      if (!isSubstantive(result[field]) && isSubstantive(existing[field])) {
        result[field] = existing[field];
      }
    }
    return result;
  }

  // User-set content is always preserved. Crawl only fills empty fields.
  // No AI agent — deterministic: user wins on every field they touched.
  const merged = {};
  for (const field of FIELDS) {
    merged[field] = isSubstantive(existing[field])
      ? existing[field]
      : (crawledBrandOverview[field] || '');
  }
  return {
    ...merged,
    source: 'user',
    mergedAt: new Date().toISOString(),
  };
}

module.exports = { mergeBrandOverview };
