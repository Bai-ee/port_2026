'use strict';

// pagespeed.js — Stub analyzer for the SEO + Performance card.
//
// PageSpeed Insights runs as a separate intelligence pipeline today
// (features/intelligence/pagespeed.js) and is merged at the dashboard level.
// Once a runner stage feeds pagespeed results into sharedResults.pagespeed,
// this analyzer echoes them through. Until then it returns status:'empty' so
// the Scribe pass knows the card has no source data.

async function run({ sharedResults }) {
  const ps = sharedResults?.pagespeed || null;

  if (!ps) {
    return {
      status: 'empty',
      confidence: 'low',
      signals: null,
      notes: 'pagespeed not yet wired into intake pipeline',
      runCostData: null,
    };
  }

  return {
    status: 'ok',
    confidence: 'high',
    signals: ps,
    notes: null,
    runCostData: null,
  };
}

module.exports = { run };
