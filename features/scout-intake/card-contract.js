'use strict';

// card-contract.js — Source of truth for dashboard card generation.
//
// Every dashboard card has one entry here. The contract is read by:
//   - analyzers        (to know which impl runs, and whether failure is fatal)
//   - the Scribe pass  (to know short/expanded copy budgets per card)
//   - the dashboard UI (to know which field feeds which tile + modal)
//
// Adding or reshaping a card = edit this file. Everything else follows.
//
// Analyzer impls:
//   - 'passthrough'           default stub; echoes evidence, sets confidence from
//                             signal thickness. No LLM call.
//   - 'design-system-extractor'  Sonnet-backed CSS → tokens extractor
//                             (features/scout-intake/design-system-extractor.js).
//   - 'pagespeed'             PageSpeed Insights summary
//                             (features/intelligence/pagespeed.js).
//   - 'runtime'               UI chrome; no analyzer output, no copy generated.
//
// Copy budgets:
//   - short    = tile-face copy. Scribe aims inside [min, max].
//   - expanded = modal/expanded-state copy. Scribe aims inside [min, max].
//   - Soft caps: Scribe finishes the sentence it is in, never cuts mid-word.
//     Overshoot by up to ~15% is acceptable; undershoot is worse than overshoot.
//   - qualityScaling: when true, Scribe picks a target inside the range based
//     on analyzer confidence. Low confidence → near min. High confidence → near
//     max. Stops the model from padding weak evidence into long copy.
//
// Tiers:
//   - 'all'  generated for free and paid runs.
//   - 'paid' generated only when clientConfig.tier === 'paid'. Free-tier runs
//            return the tile with a locked-state placeholder.

const CARD_CONTRACT = [
  // ── Runtime / chrome ────────────────────────────────────────────────────
  {
    id: 'intake-terminal',
    role: 'runtime',
    analyzer: { impl: 'runtime', required: false },
    copy: null,
    qualityScaling: false,
    tier: 'all',
  },

  // ── Intake-fed cards (live today) ───────────────────────────────────────
  {
    id: 'brand-tone',
    role: 'brand-voice',
    sourceField: 'snapshot.brandTone',
    fallbackField: 'siteMeta',
    analyzer: { impl: 'passthrough', required: false },
    copy: {
      short:    { min: 80,  max: 180 },
      expanded: { min: 250, max: 600 },
    },
    qualityScaling: true,
    tier: 'all',
  },
  {
    id: 'style-guide',
    role: 'visual-identity',
    sourceField: 'snapshot.visualIdentity.styleGuide',
    analyzer: { impl: 'design-system-extractor', required: false },
    copy: {
      short:    { min: 80,  max: 180 },
      expanded: { min: 300, max: 800 },
    },
    qualityScaling: true,
    tier: 'all',
  },
  {
    id: 'seo-performance',
    role: 'technical-health',
    sourceField: 'intelligence.pagespeed',
    analyzer: { impl: 'pagespeed', required: false },
    copy: {
      short:    { min: 60,  max: 140 },
      expanded: { min: 250, max: 700 },
    },
    qualityScaling: true,
    tier: 'all',
  },
  {
    id: 'industry',
    role: 'fact',
    sourceField: 'snapshot.brandOverview.industry',
    analyzer: { impl: 'passthrough', required: false },
    copy: {
      short:    { min: 30,  max: 80 },
      expanded: { min: 150, max: 350 },
    },
    qualityScaling: true,
    tier: 'all',
  },
  {
    id: 'business-model',
    role: 'fact',
    sourceField: 'snapshot.brandOverview.businessModel',
    analyzer: { impl: 'passthrough', required: false },
    copy: {
      short:    { min: 30,  max: 80 },
      expanded: { min: 150, max: 350 },
    },
    qualityScaling: true,
    tier: 'all',
  },
  {
    id: 'priority-signal',
    role: 'signal',
    sourceField: 'signals.core[top]',
    analyzer: { impl: 'passthrough', required: false },
    copy: {
      short:    { min: 80,  max: 180 },
      expanded: { min: 250, max: 600 },
    },
    qualityScaling: true,
    tier: 'all',
  },
  {
    id: 'draft-post',
    role: 'content-draft',
    sourceField: 'outputsPreview.samplePost',
    analyzer: { impl: 'passthrough', required: false },
    // Short tracks platform-native post length (Twitter/X ~280).
    copy: {
      short:    { min: 140, max: 280 },
      expanded: { min: 300, max: 650 },
    },
    qualityScaling: true,
    tier: 'all',
  },
  {
    id: 'content-angle',
    role: 'strategy',
    sourceField: 'strategy.contentAngles[0]',
    analyzer: { impl: 'passthrough', required: false },
    copy: {
      short:    { min: 80,  max: 180 },
      expanded: { min: 250, max: 650 },
    },
    qualityScaling: true,
    tier: 'all',
  },
  {
    id: 'content-opportunities',
    role: 'strategy-list',
    sourceField: 'strategy.opportunityMap',
    analyzer: { impl: 'passthrough', required: false },
    // Multi-item list — expanded holds the fuller breakdown.
    copy: {
      short:    { min: 80,  max: 200 },
      expanded: { min: 400, max: 800 },
    },
    qualityScaling: true,
    tier: 'all',
  },

  // ── Upgrade-tier tiles (paid) ───────────────────────────────────────────
  // All paid tiles share a uniform budget for now. Per-tile tuning happens
  // when a tile moves off passthrough onto a real analyzer.
  ...[
    'creative-pipelines',
    'company-brain',
    'knowledge-assistant',
    'executive-support',
    'daily-operations',
    'email-marketing',
    'ai-research',
    'financial-tax',
    'compliance',
    'distribution-insight',
    'rapid-product',
    'self-improving',
    'reddit-community',
    'seo-content',
    'multi-agent-pipeline',
    'hyperlocal-signals',
    'platform-content-gen',
    'brand-safety-gate',
    'founder-daily-brief',
    'admin-dashboard-history',
    'image-generation',
    'knowledge-file-config',
  ].map((id) => ({
    id,
    role: 'upgrade-tile',
    analyzer: { impl: 'passthrough', required: false },
    copy: {
      short:    { min: 60,  max: 140 },
      expanded: { min: 200, max: 500 },
    },
    qualityScaling: true,
    tier: 'paid',
  })),
];

const CARDS_BY_ID = Object.fromEntries(CARD_CONTRACT.map((card) => [card.id, card]));

function getCard(cardId) {
  return CARDS_BY_ID[cardId] || null;
}

function cardsForTier(tier) {
  if (tier === 'paid') return CARD_CONTRACT.filter((c) => c.tier === 'paid' || c.tier === 'all');
  return CARD_CONTRACT.filter((c) => c.tier === 'all');
}

function cardsByAnalyzer(impl) {
  return CARD_CONTRACT.filter((c) => c.analyzer.impl === impl);
}

module.exports = {
  CARD_CONTRACT,
  CARDS_BY_ID,
  getCard,
  cardsForTier,
  cardsByAnalyzer,
};
