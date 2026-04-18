'use strict';

// card-contract.js — Source of truth for dashboard card generation.
//
// Every dashboard card has one entry here. The contract is read by:
//   - analyzers        (to know which impl runs, and whether failure is fatal)
//   - the Scribe pass  (to know short/expanded copy budgets per card)
//   - the dashboard UI (to know which field feeds which tile + modal)
//   - the Scout Data Map (to trace source → card influence)
//
// Adding or reshaping a card = edit this file. Everything else follows.
//
// ─── FIELD REFERENCE ────────────────────────────────────────────────────────
//
// id             stable card id. Used across analyzers, scribe, and UI.
// navLabel       UPPERCASE label rendered in DashboardPage nav/footer.
// navTitle       Human-friendly title rendered in DashboardPage card header.
// category       Dashboard grouping: 'design' | 'seo' | 'content' | 'systems'.
// role           Semantic role for Scribe prompt ('brand-voice', 'strategy', …).
// sourceField    Dotted pointer into the intake result that feeds this card.
// fallbackField  Secondary pointer used when sourceField is empty.
// analyzer       { impl, required } — analyzer impl to run for this card.
// copy           { short: {min,max}, expanded: {min,max} } — Scribe budgets.
// qualityScaling Whether Scribe should scale copy length by confidence.
// tier           'all' (free + paid) | 'paid' (locked on free).
//
// ─── NEW FIELDS (F1a) ───────────────────────────────────────────────────────
//
// analyzerSkills Array of skill ids to run before Scribe (P3+). When present,
//                supersedes analyzerSkill. Use getSkillIdsForCard() to resolve.
//
// analyzerSkill  Legacy single skill id. Kept for back-compat. When analyzerSkills
//                is set, this field is ignored by the runner. Null = no skill.
//
// actionClass    Scribe framing for this card. One of:
//                  'runtime'       chrome only, no copy
//                  'describe'      factual summary from signals
//                  'diagnose'      fact + gap detection
//                  'recommend'     gap + next-step recommendation
//                  'service-offer' gap + prescriptive service pitch
//
// sources        Array of source IDs that feed this card. Used by the Scout
//                Data Map and the admin Card Influence panel to show
//                provenance. Source IDs:
//                  site.html            crawled page bodies
//                  site.meta            OG / favicon / canonical
//                  synth.intake         LLM synthesis tool output
//                  synth.styleGuide     design-system extractor output
//                  intel.pagespeed      PageSpeed Insights intelligence
//                  scout.reddit         external-scout Reddit report
//                  scout.weather        external-scout NWS report
//                  scout.reviews        external-scout review-sentiment report
//                  scoutConfig.*        sub-keys of persisted scout config
//                  userContext          onboarding answers
//
// missingStateRules  Array of deterministic gap rules. Each rule:
//                  { id, when: string, reason: string, offer: string }
//                Evaluated BEFORE Scribe runs. When `when` is true, Scribe
//                receives { triggered: true, reason, offer } and must surface
//                the recommendation/service-offer in the `expanded` field.
//                `when` is a plain-English pointer to be codified in a
//                separate evaluator (F1b+); kept as strings here so the
//                contract stays declarative, not executable.
//
// ─── ANALYZER IMPLS ─────────────────────────────────────────────────────────
//
//   'passthrough'            default stub; echoes evidence, sets confidence
//                            from signal thickness. No LLM call.
//   'design-system-extractor'  Sonnet-backed CSS → tokens extractor
//                            (features/scout-intake/design-system-extractor.js).
//   'pagespeed'              PageSpeed Insights summary
//                            (features/intelligence/pagespeed.js).
//   'runtime'                UI chrome; no analyzer output, no copy generated.
//
// ─── COPY BUDGETS ───────────────────────────────────────────────────────────
//
//   short    = tile-face copy. Scribe aims inside [min, max].
//   expanded = modal/expanded-state copy. Scribe aims inside [min, max].
//   Soft caps: Scribe finishes the sentence it is in, never cuts mid-word.
//   Overshoot by up to ~15% is acceptable; undershoot is worse than overshoot.
//
// ─── TIERS ──────────────────────────────────────────────────────────────────
//
//   'all'  generated for free and paid runs.
//   'paid' generated only when clientConfig.tier === 'paid'. Free-tier runs
//          return the tile with a locked-state placeholder.

const CARD_CONTRACT = [
  // ── Runtime / chrome ────────────────────────────────────────────────────
  {
    id: 'intake-terminal',
    navLabel: 'INTAKE TERMINAL',
    navTitle: 'Intake Terminal',
    category: 'runtime',
    role: 'runtime',
    analyzer: { impl: 'runtime', required: false },
    analyzerSkill: 'run-health-audit',              // legacy single-skill field
    analyzerSkills: ['run-health-audit'],           // P3+ multi-skill
    // Copy budgets added — the card now has a post-run modal state that
    // surfaces the audit's own health (warnings, thin data, stage failures)
    // via Scribe. During the live run, the card still renders the event stream;
    // post-run, the modal shows tabs with run-health findings + solutions.
    copy: {
      short:    { min: 60,  max: 160 },
      expanded: { min: 200, max: 600 },
    },
    qualityScaling: true,
    tier: 'all',
    // actionClass upgraded from 'runtime' to 'diagnose' — the run-health-audit
    // skill produces findings about the run itself (PSI failed, data thin,
    // synth failed). Scribe opens with the most significant run issue and
    // points to the Solutions tab for diagnostic next steps.
    actionClass: 'diagnose',
    sources: ['runtime.health'],
    missingStateRules: [],
  },

  // ── Intake-fed cards (live today) ───────────────────────────────────────
  {
    id: 'brief',
    navLabel: 'BRIEF',
    navTitle: 'Brief',
    category: 'design',
    role: 'summary-brief',
    sourceField: 'snapshot.brandOverview',
    analyzer: { impl: 'passthrough', required: false },
    analyzerSkill: null,
    copy: {
      short:    { min: 100, max: 220 },
      expanded: { min: 400, max: 900 },
    },
    qualityScaling: true,
    tier: 'all',
    actionClass: 'describe',
    sources: ['synth.intake', 'site.meta', 'userContext'],
    missingStateRules: [
      {
        id: 'intake-thin',
        when: 'evidence.thin === true OR snapshot.brandOverview missing',
        reason: 'Intake did not produce enough signal to generate a reliable brief.',
        offer: 'Discovery sprint + deeper content capture before brief generation.',
      },
    ],
  },
  {
    id: 'brand-tone',
    navLabel: 'BRAND TONE',   // swaps to 'SITE META' at render time when siteMeta present
    navTitle: 'Brand Tone',
    category: 'design',
    role: 'brand-voice',
    sourceField: 'snapshot.brandTone',
    fallbackField: 'siteMeta',
    analyzer: { impl: 'passthrough', required: false },
    analyzerSkill: 'site-meta-audit',             // legacy single-skill field
    analyzerSkills: ['site-meta-audit'],          // P3+ multi-skill (scalable)
    copy: {
      short:    { min: 80,  max: 180 },
      expanded: { min: 250, max: 600 },
    },
    qualityScaling: true,
    tier: 'all',
    // actionClass upgraded from 'describe' to 'diagnose' — the site-meta-audit
    // skill produces actionable findings (missing OG image, missing favicon,
    // missing canonical). Scribe opens with the top problem and points to the
    // Solutions tab via the diagnose-role voice rules in card-voice.js.
    actionClass: 'diagnose',
    sources: ['synth.intake', 'site.meta'],
    missingStateRules: [
      {
        id: 'no-brand-tone-signals',
        when: 'snapshot.brandTone empty AND siteMeta empty',
        reason: 'No voice markers or public meta surface captured from the site.',
        offer: 'Brand voice workshop + OG / social tag implementation.',
      },
    ],
  },
  {
    id: 'style-guide',
    navLabel: 'STYLE GUIDE',
    navTitle: 'Style Guide',
    category: 'design',
    role: 'visual-identity',
    sourceField: 'snapshot.visualIdentity.styleGuide',
    analyzer: { impl: 'design-system-extractor', required: false },
    analyzerSkill: 'style-guide-audit',            // legacy single-skill field
    analyzerSkills: ['style-guide-audit'],         // P3+ multi-skill
    copy: {
      short:    { min: 80,  max: 180 },
      expanded: { min: 300, max: 800 },
    },
    qualityScaling: true,
    tier: 'all',
    // actionClass upgraded from 'describe' to 'diagnose' — the style-guide-audit
    // skill produces actionable findings (body text too small, no brand
    // typography, thin palette). Scribe leads with the top problem and points
    // to the Solutions tab via diagnose-role voice rules in card-voice.js.
    actionClass: 'diagnose',
    sources: ['synth.styleGuide', 'site.html'],
    missingStateRules: [
      {
        id: 'style-guide-unwired',
        when: 'design-system-extractor not yet wired into runner',
        reason: 'Style guide reads from STYLE_GUIDE_MOCK until the extractor is plugged in.',
        offer: 'Wire extractor (engineering, not a client-facing service-offer).',
      },
    ],
  },
  {
    id: 'seo-performance',
    navLabel: 'SEO + PERF',
    navTitle: 'SEO + Performance',
    category: 'seo',
    role: 'technical-health',
    sourceField: 'intelligence.pagespeed',
    analyzer: { impl: 'pagespeed', required: false },
    analyzerSkills: ['seo-depth-audit'],
    analyzerSkill: 'seo-depth-audit',   // legacy — kept for UI back-compat
    copy: {
      short:    { min: 60,  max: 140 },
      expanded: { min: 250, max: 700 },
    },
    qualityScaling: true,
    tier: 'all',
    actionClass: 'diagnose',
    sources: ['intel.pagespeed', 'site.meta'],
    missingStateRules: [
      {
        id: 'pagespeed-performance-critical',
        when: 'intelligence.pagespeed.scores.performance < 50',
        reason: 'Core Web Vitals are below the passing threshold.',
        offer: 'Performance remediation: image optimization, JS deferral, CDN, critical CSS.',
      },
      {
        id: 'pagespeed-seo-low',
        when: 'intelligence.pagespeed.scores.seo < 80',
        reason: 'SEO signals (meta, crawlability, semantic tags) are incomplete.',
        offer: 'On-page SEO pass: meta tags, alt text, schema, canonical hygiene.',
      },
    ],
  },
  {
    id: 'industry',
    navLabel: 'INDUSTRY',
    navTitle: 'Industry',
    category: 'content',
    role: 'fact',
    sourceField: 'snapshot.brandOverview.industry',
    analyzer: { impl: 'passthrough', required: false },
    analyzerSkill: null,
    copy: {
      short:    { min: 30,  max: 80 },
      expanded: { min: 150, max: 350 },
    },
    qualityScaling: true,
    tier: 'all',
    actionClass: 'describe',
    sources: ['synth.intake'],
    missingStateRules: [
      {
        id: 'industry-unknown',
        when: 'snapshot.brandOverview.industry is null or generic',
        reason: 'Crawled pages did not clearly identify a vertical.',
        offer: 'Positioning interview to lock category language.',
      },
    ],
  },
  {
    id: 'business-model',
    navLabel: 'MODEL',
    navTitle: 'Business Model',
    category: 'content',
    role: 'fact',
    sourceField: 'snapshot.brandOverview.businessModel',
    analyzer: { impl: 'passthrough', required: false },
    analyzerSkill: null,
    copy: {
      short:    { min: 30,  max: 80 },
      expanded: { min: 150, max: 350 },
    },
    qualityScaling: true,
    tier: 'all',
    actionClass: 'describe',
    sources: ['synth.intake', 'site.html'],
    missingStateRules: [
      {
        id: 'no-pricing-signal',
        when: 'no /pricing page fetched AND no CTAs suggesting commerce',
        reason: 'No pricing, packaging, or checkout signal on the live site.',
        offer: 'Offer-stack + pricing page build.',
      },
    ],
  },
  {
    id: 'priority-signal',
    navLabel: 'PRIORITY SIGNAL',
    navTitle: 'Priority Signal',
    category: 'content',
    role: 'signal',
    sourceField: 'signals.core[top]',
    analyzer: { impl: 'passthrough', required: false },
    analyzerSkill: null,
    copy: {
      short:    { min: 80,  max: 180 },
      expanded: { min: 250, max: 600 },
    },
    qualityScaling: true,
    tier: 'all',
    actionClass: 'recommend',
    sources: ['synth.intake', 'scout.reddit', 'userContext'],
    missingStateRules: [
      {
        id: 'priority-no-signals',
        when: 'signals.core empty AND externalSignals.reddit empty',
        reason: 'No validated positioning or audience urgency surfaced.',
        offer: 'Discovery sprint to capture founder intent + audience research.',
      },
    ],
  },
  {
    id: 'draft-post',
    navLabel: 'DRAFT POST',
    navTitle: 'Draft Post',
    category: 'content',
    role: 'content-draft',
    sourceField: 'outputsPreview.samplePost',
    analyzer: { impl: 'passthrough', required: false },
    analyzerSkill: null,
    // Short tracks platform-native post length (Twitter/X ~280).
    copy: {
      short:    { min: 140, max: 280 },
      expanded: { min: 300, max: 650 },
    },
    qualityScaling: true,
    tier: 'all',
    actionClass: 'recommend',
    sources: ['synth.intake', 'scout.reddit', 'userContext'],
    missingStateRules: [
      {
        id: 'draft-thin-voice',
        when: 'snapshot.brandTone confidence=low',
        reason: 'Not enough brand voice material to draft credibly.',
        offer: 'Voice calibration + 10-post editorial kit.',
      },
    ],
  },
  {
    id: 'content-angle',
    navLabel: 'CONTENT ANGLE',
    navTitle: 'Content Angle',
    category: 'content',
    role: 'strategy',
    sourceField: 'strategy.contentAngles[0]',
    analyzer: { impl: 'passthrough', required: false },
    analyzerSkill: null,
    copy: {
      short:    { min: 80,  max: 180 },
      expanded: { min: 250, max: 650 },
    },
    qualityScaling: true,
    tier: 'all',
    actionClass: 'recommend',
    sources: ['synth.intake', 'scout.reddit'],
    missingStateRules: [
      {
        id: 'angle-weak-audience',
        when: 'strategy.contentAngles empty',
        reason: 'Audience/problem framing is too thin to commit to an angle.',
        offer: 'Editorial positioning workshop.',
      },
    ],
  },
  {
    id: 'content-opportunities',
    navLabel: 'CONTENT OPPORTUNITIES',
    navTitle: 'Content Opportunities',
    category: 'content',
    role: 'strategy-list',
    sourceField: 'strategy.opportunityMap',
    analyzer: { impl: 'passthrough', required: false },
    analyzerSkill: null,
    // Multi-item list — expanded holds the fuller breakdown.
    copy: {
      short:    { min: 80,  max: 200 },
      expanded: { min: 400, max: 800 },
    },
    qualityScaling: true,
    tier: 'all',
    actionClass: 'recommend',
    sources: ['synth.intake', 'scout.reddit', 'scout.weather', 'scoutConfig.searchPlan'],
    missingStateRules: [
      {
        id: 'opportunities-empty',
        when: 'strategy.opportunityMap empty AND externalSignals.reddit.participationOpportunities empty',
        reason: 'No concrete opportunities surfaced in synth or external scouts.',
        offer: 'Full content-ops audit (keyword + community + seasonal windows).',
      },
    ],
  },
  {
    id: 'competitor-info',
    navLabel: 'COMPETITOR INFO',
    navTitle: 'Competitor Info',
    category: 'systems',
    role: 'market-intel',
    sourceField: 'scoutConfig.competitors',
    analyzer: { impl: 'passthrough', required: false },
    analyzerSkill: null,
    copy: {
      short:    { min: 80,  max: 180 },
      expanded: { min: 300, max: 700 },
    },
    qualityScaling: true,
    tier: 'all',
    actionClass: 'describe',
    sources: ['scoutConfig.competitors', 'synth.intake'],
    missingStateRules: [
      {
        id: 'competitors-not-mapped',
        when: 'scoutConfig.competitors empty',
        reason: 'Scout config did not surface comparable competitors.',
        offer: 'Competitive landscape mapping + positioning matrix.',
      },
    ],
  },
  {
    id: 'signals',
    navLabel: 'SIGNALS',
    navTitle: 'Signals',
    category: 'systems',
    role: 'signal-feed',
    sourceField: 'externalSignals',
    analyzer: { impl: 'passthrough', required: false },
    analyzerSkill: null,
    copy: {
      short:    { min: 80,  max: 180 },
      expanded: { min: 300, max: 800 },
    },
    qualityScaling: true,
    tier: 'all',
    actionClass: 'diagnose',
    sources: ['scout.reddit', 'scout.weather', 'scout.reviews', 'scoutConfig.capabilitiesActive'],
    missingStateRules: [
      {
        id: 'external-scouts-not-wired',
        when: 'externalSignals not yet populated by runner',
        reason: 'External scouts exist but runner.js does not invoke them yet (Phase E1 pending).',
        offer: 'Enable live signal collection for this client (internal wiring, not a client service).',
      },
    ],
  },
  {
    id: 'marketing',
    navLabel: 'MARKETING',
    navTitle: 'Marketing',
    category: 'content',
    role: 'strategy',
    sourceField: 'strategy.postStrategy',
    analyzer: { impl: 'passthrough', required: false },
    analyzerSkill: null,
    copy: {
      short:    { min: 80,  max: 200 },
      expanded: { min: 400, max: 800 },
    },
    qualityScaling: true,
    tier: 'all',
    actionClass: 'recommend',
    sources: ['synth.intake', 'scout.reddit', 'scoutConfig.searchPlan', 'userContext'],
    missingStateRules: [
      {
        id: 'marketing-no-frame',
        when: 'signals.core empty AND strategy.contentAngles empty',
        reason: 'No priority signal or content angle to anchor a marketing recommendation.',
        offer: 'Strategy sprint: positioning, funnel, channel mix, 30-day plan.',
      },
    ],
  },

  // ── New service-oriented cards (F1a) ────────────────────────────────────
  // These cards evaluate the live site against service-offer rules. Their
  // copy is prescriptive: gap + fix + service pitch. Wired in F1b doc and
  // Scribe update in a later phase.
  {
    id: 'website-landing',
    navLabel: 'WEBSITE & LANDING',
    navTitle: 'Website & Landing Page',
    category: 'seo',
    role: 'site-health',
    sourceField: 'evidence.pages',
    analyzer: { impl: 'passthrough', required: false },
    analyzerSkill: 'conversion-audit',             // legacy single-skill field
    analyzerSkills: ['conversion-audit'],          // P3+ multi-skill
    copy: {
      short:    { min: 80,  max: 200 },
      expanded: { min: 400, max: 900 },
    },
    qualityScaling: true,
    tier: 'all',
    // actionClass stays 'service-offer' — Scribe's service-offer voice rules
    // already frame gaps as opportunities with a subtle close. The skill
    // produces actionable conversion findings that slot into that framing.
    actionClass: 'service-offer',
    sources: ['site.html', 'site.meta', 'intel.pagespeed'],
    missingStateRules: [
      {
        id: 'thin-content',
        when: 'evidence.thin === true',
        reason: 'Homepage has minimal long-form copy — unlikely to rank or convert.',
        offer: 'Copy + IA rebuild for the primary landing surface.',
      },
      {
        id: 'single-page-site',
        when: 'evidence.pages.length < 2',
        reason: 'Single-page site with no supporting landing or pricing routes.',
        offer: 'Multi-page build: pricing, services, about, contact.',
      },
      {
        id: 'no-primary-cta',
        when: 'evidence.pages[home].ctaTexts empty',
        reason: 'No recognizable call-to-action on the homepage.',
        offer: 'Conversion rate optimization: hero CTA, lead magnet, form.',
      },
      {
        id: 'performance-blocks-conversion',
        when: 'intelligence.pagespeed.scores.performance < 50',
        reason: 'Slow load times measurably hurt conversion and bounce.',
        offer: 'Performance tune: images, fonts, JS, third-party scripts.',
      },
    ],
  },
  {
    id: 'brand-identity-design',
    navLabel: 'BRAND IDENTITY',
    navTitle: 'Brand Identity & Design',
    category: 'design',
    role: 'brand-assets',
    sourceField: 'siteMeta',
    analyzer: { impl: 'passthrough', required: false },
    analyzerSkill: 'brand-asset-gap',              // legacy single-skill field
    analyzerSkills: ['brand-asset-gap'],           // P3+ multi-skill
    copy: {
      short:    { min: 80,  max: 200 },
      expanded: { min: 400, max: 900 },
    },
    qualityScaling: true,
    tier: 'all',
    // actionClass stays 'service-offer' — the brand-asset-gap skill produces
    // findings framed as identity-coherence opportunities (inconsistent brand
    // name, template defaults, thin positioning). Service-offer voice frames
    // each gap as a chance to rebuild, not a failure to diagnose.
    actionClass: 'service-offer',
    sources: ['site.meta', 'synth.intake', 'synth.styleGuide', 'site.html'],
    missingStateRules: [
      {
        id: 'no-favicon',
        when: '!siteMeta.favicon',
        reason: 'No favicon — site appears unbranded in browser tabs and bookmarks.',
        offer: 'Favicon + Apple touch icon production.',
      },
      {
        id: 'no-og-image',
        when: '!siteMeta.ogImage',
        reason: 'No Open Graph image — link previews on social are blank.',
        offer: 'Social preview asset set (OG + Twitter Card) tuned to brand.',
      },
      {
        id: 'no-theme-color',
        when: '!siteMeta.themeColor',
        reason: 'No theme-color meta — mobile chrome defaults to neutral.',
        offer: 'Brand color pass: theme-color, safe-area, PWA manifest.',
      },
      {
        id: 'no-apple-touch-icon',
        when: '!siteMeta.appleTouchIcon',
        reason: 'No Apple touch icon — home-screen saves look generic.',
        offer: 'App icon set + home-screen polish.',
      },
      {
        id: 'no-canonical',
        when: '!siteMeta.canonical',
        reason: 'No canonical URL — duplicate-content risk and weak SEO hygiene.',
        offer: 'Canonical + robots + sitemap cleanup.',
      },
    ],
  },

  // ── Upgrade-tier tiles (paid) ───────────────────────────────────────────
  // All paid tiles share a uniform budget and default to 'service-offer'
  // action class — the free-tier view shows the locked CTA that pitches
  // the underlying service.
  ...[
    ['creative-pipelines',      'CREATIVE PIPELINES',        'Creative Pipelines'],
    ['company-brain',           'COMPANY BRAIN',             'Company Brain'],
    ['knowledge-assistant',     'KNOWLEDGE ASSISTANT',       'Internal Knowledge Assistant'],
    ['executive-support',       'EXECUTIVE SUPPORT',         'Executive Support Automation'],
    ['daily-operations',        'DAILY OPERATIONS',          'Daily Operations Engine'],
    ['email-marketing',         'EMAIL MARKETING',           'Email Marketing Automation'],
    ['ai-research',             'AI RESEARCH',               'AI-Powered Research'],
    ['financial-tax',           'FINANCIAL & TAX',           'Financial & Tax Processing'],
    ['compliance',              'COMPLIANCE MONITORING',     'Compliance Monitoring'],
    ['distribution-insight',    'DISTRIBUTION & INSIGHT',    'Distribution & Insight Automation'],
    ['rapid-product',           'RAPID PRODUCT DEV',         'Rapid Product Development'],
    ['self-improving',          'SELF-IMPROVING',            'Self-Improving Systems'],
    ['reddit-community',        'REDDIT & COMMUNITY',        'Reddit & Community'],
    ['seo-content',             'SEO CONTENT',               'SEO Content'],
    ['multi-agent-pipeline',    'MULTI-AGENT PIPELINE',      'Multi-Agent Intelligence Pipeline'],
    ['hyperlocal-signals',      'HYPERLOCAL SIGNALS',        'Hyperlocal Signal Aggregation'],
    ['platform-content-gen',    'PLATFORM CONTENT GEN',      'Platform-Specific Content Generation'],
    ['brand-safety-gate',       'BRAND SAFETY GATE',         'Brand Safety & Quality Gate'],
    ['founder-daily-brief',     'FOUNDER DAILY BRIEF',       'Founder-Facing Daily Brief'],
    ['admin-dashboard-history', 'ADMIN & BRIEF HISTORY',     'Admin Dashboard & Brief History'],
    ['image-generation',        'IMAGE GENERATION',          'Image Generation & Asset Management'],
    ['knowledge-file-config',   'KNOWLEDGE FILE CONFIG',     'Knowledge-File Client Configuration'],
  ].map(([id, navLabel, navTitle]) => ({
    id,
    navLabel,
    navTitle,
    category: 'upgrade',
    role: 'upgrade-tile',
    analyzer: { impl: 'passthrough', required: false },
    analyzerSkill: null,
    copy: {
      short:    { min: 60,  max: 140 },
      expanded: { min: 200, max: 500 },
    },
    qualityScaling: true,
    tier: 'paid',
    actionClass: 'service-offer',
    sources: [],
    missingStateRules: [],
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

function cardsByCategory(category) {
  return CARD_CONTRACT.filter((c) => c.category === category);
}

function cardsByActionClass(actionClass) {
  return CARD_CONTRACT.filter((c) => c.actionClass === actionClass);
}

function cardsBySource(sourceId) {
  return CARD_CONTRACT.filter((c) => Array.isArray(c.sources) && c.sources.includes(sourceId));
}

/**
 * Resolve the effective list of analyzer skill ids for a card.
 * Prefers analyzerSkills[] (P3+). Falls back to [analyzerSkill] for legacy cards.
 * Returns [] when no skill is declared.
 *
 * @param {object} card
 * @returns {string[]}
 */
function getSkillIdsForCard(card) {
  if (Array.isArray(card?.analyzerSkills) && card.analyzerSkills.length > 0) {
    return card.analyzerSkills;
  }
  if (card?.analyzerSkill) {
    return [card.analyzerSkill];
  }
  return [];
}

module.exports = {
  CARD_CONTRACT,
  CARDS_BY_ID,
  getCard,
  cardsForTier,
  cardsByAnalyzer,
  cardsByCategory,
  cardsByActionClass,
  cardsBySource,
  getSkillIdsForCard,
};
