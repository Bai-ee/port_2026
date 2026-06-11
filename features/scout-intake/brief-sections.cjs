'use strict';

// Brief section registry + compositions.
//
// Single source of truth for how brief content is organized: every renderable
// section is registered here with the dashboard card and agent group it
// belongs to, and each named brief (Onboarding, Executive Daily, Competitor…)
// is an ordered list of section ids. The HTML for each section still lives in
// the renderer (app/api/dashboard/brief-preview/route.js) — this module only
// describes organization, so tier gating and brief assembly can be driven
// from one place without touching the design.
//
// Agent keys mirror DashboardPage groups:
//   knowledge  → Knowledge Officer
//   growth     → Marketing Director
//   content    → Creative Director
//   social     → Social Media Manager
//   website    → Website Developer
//   automation → Automation & Systems

const BRIEF_SECTIONS = {
  'scout-found': {
    title: 'What Scout Found.',
    kicker: 'Marketing Brief',
    secNum: '01',
    agent: 'growth',
    agentLabel: 'Marketing Director',
    card: 'marketing-brief',
  },
  'company-foundation': {
    title: 'Company Foundation.',
    kicker: 'Company Brief',
    secNum: 'CO',
    agent: 'knowledge',
    agentLabel: 'Knowledge Officer',
    card: 'brand-overview',
  },
  'site-performance': {
    title: 'Site Performance.',
    kicker: 'Performance Brief',
    secNum: 'PB',
    agent: 'website',
    agentLabel: 'Website Developer',
    card: 'seo-performance',
  },
  'creative-system': {
    title: 'Creative System.',
    kicker: 'Creative Brief',
    secNum: 'CB',
    agent: 'content',
    agentLabel: 'Creative Director',
    card: 'style-guide',
  },
  'search-parameters': {
    title: 'Search Parameters.',
    kicker: 'Research Brief',
    secNum: 'RP',
    agent: 'knowledge',
    agentLabel: 'Knowledge Officer',
    card: 'research-focus',
  },
  'local-weather': {
    title: 'Local Weather.',
    kicker: null, // renders without a kicker today — keep design as-is
    secNum: 'WX',
    agent: 'growth',
    agentLabel: 'Marketing Director',
    card: 'local-weather',
  },
  'market-signals': {
    title: 'Market Signals.',
    kicker: 'Marketing Brief',
    secNum: '02',
    agent: 'growth',
    agentLabel: 'Marketing Director',
    card: 'kol-signals',
  },
  'watchlist': {
    title: 'Watchlist.',
    kicker: null, // renders without a kicker today — keep design as-is
    secNum: 'W',
    agent: 'growth',
    agentLabel: 'Marketing Director',
    card: 'kol-signals',
  },
  'competitor-snapshot': {
    title: 'Competitor Snapshot.',
    kicker: 'Competitor Brief',
    secNum: '03',
    agent: 'growth',
    agentLabel: 'Marketing Director',
    card: 'competitors',
  },
  'local-signals': {
    title: 'Local Signals.',
    kicker: 'Marketing Brief',
    secNum: '04',
    agent: 'growth',
    agentLabel: 'Marketing Director',
    card: 'local-signals',
  },
  'viral-windows': {
    title: 'Viral Windows.',
    kicker: 'Marketing Brief',
    secNum: '05',
    agent: 'growth',
    agentLabel: 'Marketing Director',
    card: 'marketing-brief',
  },
  'todays-move': {
    title: "Today's Move.",
    kicker: 'Strategy Brief',
    secNum: '06',
    agent: 'content',
    agentLabel: 'Creative Director',
    card: 'marketing-brief',
  },
  'campaign-30day': {
    title: '30-Day Campaign.',
    kicker: 'Strategy Brief',
    secNum: 'SC',
    agent: 'growth',
    agentLabel: 'Marketing Director',
    card: 'strategy-30',
  },
  'post-schedule': {
    title: 'Post Schedule.',
    kicker: 'Strategy Brief',
    secNum: 'XP',
    agent: 'social',
    agentLabel: 'Social Media Manager',
    card: 'social-media-posting',
  },
};

// Named briefs — ordered section lists. 'executive-daily' is the default and
// MUST stay in exactly today's render order: it is the full report every
// other brief is carved from. The others become selectable in Phase 2 and
// tier-gated in Phase 3.
const BRIEF_COMPOSITIONS = {
  'executive-daily': {
    label: 'Executive Daily Brief',
    sections: [
      'scout-found',
      'company-foundation',
      'site-performance',
      'creative-system',
      'search-parameters',
      'local-weather',
      'market-signals',
      'watchlist',
      'competitor-snapshot',
      'local-signals',
      'viral-windows',
      'todays-move',
      'campaign-30day',
      'post-schedule',
    ],
  },
  'onboarding': {
    label: 'Onboarding Brief',
    sections: ['company-foundation', 'scout-found', 'search-parameters'],
  },
  'competitor': {
    label: 'Competitor Brief',
    sections: ['competitor-snapshot', 'market-signals', 'watchlist'],
  },
  'marketing': {
    label: 'Marketing Brief',
    sections: ['scout-found', 'market-signals', 'local-signals', 'viral-windows', 'watchlist'],
  },
  'strategy': {
    label: 'Strategy Brief',
    sections: ['campaign-30day', 'todays-move', 'post-schedule'],
  },
  'creative': {
    label: 'Creative Brief',
    sections: ['creative-system', 'todays-move'],
  },
  'performance': {
    label: 'Performance Brief',
    sections: ['site-performance', 'local-weather'],
  },
};

const DEFAULT_BRIEF_TYPE = 'executive-daily';

function getComposition(briefType) {
  return BRIEF_COMPOSITIONS[briefType] || BRIEF_COMPOSITIONS[DEFAULT_BRIEF_TYPE];
}

module.exports = { BRIEF_SECTIONS, BRIEF_COMPOSITIONS, DEFAULT_BRIEF_TYPE, getComposition };
