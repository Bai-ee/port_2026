'use strict';

// analyzers/index.js — Orchestrator for Layer-A card analyzers.
//
// One call fans out to every card the tier allows, dispatching to the
// registered impl. Heavy shared work (the synth call, design-system
// extraction) runs in runner.js BEFORE this — analyzers read from
// sharedResults, they do not trigger their own heavy work unless a specialty
// analyzer genuinely needs it.
//
// Entry point:
//   const { runAnalyzers } = require('./analyzers');
//   const { byCard } = await runAnalyzers({
//     sharedResults,   // { intake, styleGuide, styleGuideCost, siteMeta, pagespeed }
//     userContext,     // from buildUserContext(clientConfig)
//     evidence,        // SiteEvidence from site-fetcher.js
//     tier,            // 'free' | 'paid'
//   });

const { CARD_CONTRACT } = require('../card-contract');

const runtime = require('./runtime');
const passthrough = require('./passthrough');
const designSystem = require('./design-system');
const pagespeed = require('./pagespeed');

const REGISTRY = {
  runtime,
  passthrough,
  'design-system-extractor': designSystem,
  pagespeed,
};

function pickCards(tier) {
  if (tier === 'paid') return CARD_CONTRACT.filter((c) => c.tier === 'all' || c.tier === 'paid');
  return CARD_CONTRACT.filter((c) => c.tier === 'all');
}

async function runAnalyzers({ sharedResults = {}, userContext = null, evidence = null, tier = 'free' } = {}) {
  const cards = pickCards(tier);

  const entries = await Promise.all(cards.map(async (card) => {
    const impl = card.analyzer?.impl || 'passthrough';
    const analyzer = REGISTRY[impl] || passthrough;

    try {
      const result = await analyzer.run({ card, sharedResults, userContext, evidence });
      return [card.id, result];
    } catch (err) {
      return [card.id, {
        status: 'error',
        confidence: 'low',
        signals: null,
        notes: err && err.message ? err.message : 'analyzer threw',
        runCostData: null,
      }];
    }
  }));

  return { byCard: Object.fromEntries(entries) };
}

module.exports = { runAnalyzers, REGISTRY };
