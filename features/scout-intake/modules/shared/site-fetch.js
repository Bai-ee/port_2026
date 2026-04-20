'use strict';

const { fetchSiteEvidence } = require('../../site-fetcher');

async function runSiteFetch({ websiteUrl, onPageFetched = null }) {
  try {
    const evidence = await fetchSiteEvidence(websiteUrl, { onPageFetched });
    return { ok: true, evidence };
  } catch (err) {
    return {
      ok: false,
      warning: { type: 'warning', code: 'fetch_failed', message: err.message, stage: 'fetch' },
      evidence: {
        url: websiteUrl,
        fetchedAt: new Date().toISOString(),
        pages: [],
        warnings: [`Fetch failed: ${err.message}`],
        thin: true,
      },
    };
  }
}

module.exports = { runSiteFetch };
