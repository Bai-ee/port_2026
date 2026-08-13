'use strict';

// Brief section registry + compositions.
//
// Single source of truth for how brief content is organized: every renderable
// section is registered here with the dashboard card and agent group it
// belongs to, and each named brief is an ordered list of section ids. Brief
// names mirror the agent nav (Marketing Director, Creative Director, Social
// Media Manager, Website Developer) — plus Onboarding and the full Executive
// Daily roll-up. The HTML for each section still lives in the renderer
// (app/api/dashboard/brief-preview/route.js) — this module only describes
// organization, so tier gating and brief assembly are driven from one place
// without touching the design.
//
// Agent keys mirror DashboardPage groups:
//   knowledge  → Knowledge Officer
//   growth     → Marketing Director
//   content    → Creative Director
//   social     → Social Media Manager
//   website    → Website Developer
//   automation → Automation & Systems

const BRIEF_SECTIONS = {
  'last-hours': {
    title: 'The Last N Hours.', // headline is computed from the run delta at render time
    kicker: 'Marketing Director',
    secNum: 'EX1',
    agent: 'growth',
    agentLabel: 'Marketing Director',
    card: 'marketing-brief',
  },
  'listening': {
    title: "Who We're Listening To.",
    kicker: 'Marketing Director',
    secNum: 'EX2',
    agent: 'growth',
    agentLabel: 'Marketing Director',
    card: 'competitors',
  },
  'the-strategy': {
    title: 'The Strategy.',
    kicker: 'Marketing Director',
    secNum: 'EX3',
    agent: 'growth',
    agentLabel: 'Marketing Director',
    card: 'marketing-brief',
  },
  'scout-found': {
    title: 'What Scout Found.',
    kicker: 'Marketing Director',
    secNum: '01',
    agent: 'growth',
    agentLabel: 'Marketing Director',
    card: 'marketing-brief',
  },
  'company-foundation': {
    title: 'Company Foundation.',
    kicker: 'Knowledge Officer',
    secNum: 'CO',
    agent: 'knowledge',
    agentLabel: 'Knowledge Officer',
    card: 'brand-overview',
  },
  'site-performance': {
    title: 'Site Performance.',
    kicker: 'Website Developer',
    secNum: 'PB',
    agent: 'website',
    agentLabel: 'Website Developer',
    card: 'seo-performance',
  },
  'creative-system': {
    title: 'Creative System.',
    kicker: 'Creative Director',
    secNum: 'CB',
    agent: 'content',
    agentLabel: 'Creative Director',
    card: 'style-guide',
  },
  // Creative Brief (signup/first-run) asset sections. These render the proven
  // launch assets only — the device mockup, full-page screenshots, and the
  // studio motion mockup. The AI summary rides on the cover paragraph, so it
  // is not a body section here.
  'creative-mockup': {
    title: 'Across Devices.',
    kicker: 'Creative Director',
    secNum: 'CM',
    agent: 'content',
    agentLabel: 'Creative Director',
    card: 'multi-device-view',
  },
  'creative-screens': {
    title: 'Full Page.',
    kicker: 'Creative Director',
    secNum: 'CS',
    agent: 'content',
    agentLabel: 'Creative Director',
    card: 'multi-device-view',
  },
  'creative-social': {
    title: 'Social Preview.',
    kicker: 'Creative Director',
    secNum: 'CP',
    agent: 'content',
    agentLabel: 'Creative Director',
    card: 'social-preview',
  },
  'creative-studio': {
    title: 'In Motion.',
    kicker: 'Creative Director',
    secNum: 'CV',
    agent: 'content',
    agentLabel: 'Creative Director',
    card: 'mockup-studio',
  },
  'search-parameters': {
    title: 'Search Parameters.',
    kicker: 'Knowledge Officer',
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
    kicker: 'Marketing Director',
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
    kicker: 'Marketing Director',
    secNum: '03',
    agent: 'growth',
    agentLabel: 'Marketing Director',
    card: 'competitors',
  },
  'local-signals': {
    title: 'Local Signals.',
    kicker: 'Marketing Director',
    secNum: '04',
    agent: 'growth',
    agentLabel: 'Marketing Director',
    card: 'local-signals',
  },
  'viral-windows': {
    title: 'Viral Windows.',
    kicker: 'Marketing Director',
    secNum: '05',
    agent: 'growth',
    agentLabel: 'Marketing Director',
    card: 'marketing-brief',
  },
  'todays-move': {
    title: "Today's Move.",
    kicker: 'Creative Director',
    secNum: '06',
    agent: 'content',
    agentLabel: 'Creative Director',
    card: 'marketing-brief',
  },
  'campaign-30day': {
    title: '30-Day Campaign.',
    kicker: 'Social Media Manager',
    secNum: 'SC',
    agent: 'social',
    agentLabel: 'Social Media Manager',
    card: 'strategy-30',
  },
  'post-schedule': {
    title: 'Post Schedule.',
    kicker: 'Social Media Manager',
    secNum: 'XP',
    agent: 'social',
    agentLabel: 'Social Media Manager',
    card: 'social-media-posting',
  },
};

// Named briefs — ordered section lists. 'executive-daily' is the default; it
// opens with the bento executive narrative (what changed → who we're
// listening to → strategy → 30-day plan) and carries the detail sections
// after it. Agent briefs carry the nav names; the former Competitor Brief
// folded into Marketing Director.
const EXECUTIVE_SECTIONS = [
  'last-hours',
  'listening',
  'the-strategy',
  'campaign-30day',
  'site-performance',
  'creative-system',
  'market-signals',
  'press-coverage',
  'watchlist',
  'competitor-snapshot',
  'local-signals',
  'viral-windows',
  'todays-move',
  'post-schedule',
];

const BRIEF_COMPOSITIONS = {
  'executive-daily': {
    label: 'Executive Brief',
    sections: EXECUTIVE_SECTIONS,
  },
  // The signup brief — the launch "Creative Brief". Renders only the proven
  // render assets (device mockup, full-page screenshots, studio motion mockup);
  // the AI summary rides on the cover. Distinct from the executive daily brief,
  // which keeps the full EXECUTIVE_SECTIONS roll-up. Internal key stays
  // 'onboarding' (render-time selection + briefSummaries.onboarding key it on).
  'onboarding': {
    label: 'Creative Brief',
    sections: ['creative-mockup', 'creative-screens', 'creative-social', 'creative-studio'],
  },
  'marketing-director': {
    label: 'Market Brief',
    sections: ['scout-found', 'market-signals', 'press-coverage', 'local-signals', 'viral-windows', 'watchlist', 'competitor-snapshot', 'local-weather'],
  },
  'creative-director': {
    label: 'Creative Director Brief',
    sections: ['creative-system', 'todays-move'],
  },
  'social-media-manager': {
    label: 'Strategy Brief',
    sections: ['campaign-30day', 'todays-move', 'post-schedule'],
  },
  'website-developer': {
    label: 'Website Developer Brief',
    sections: ['site-performance'],
  },
};

const DEFAULT_BRIEF_TYPE = 'executive-daily';

// Legacy composition keys → current ones, so old links keep working.
const BRIEF_TYPE_ALIASES = {
  'marketing': 'marketing-director',
  'competitor': 'marketing-director',
  'strategy': 'social-media-manager',
  'creative': 'creative-director',
  'performance': 'website-developer',
};

function resolveBriefType(briefType) {
  const key = BRIEF_TYPE_ALIASES[briefType] || briefType;
  return BRIEF_COMPOSITIONS[key] ? key : DEFAULT_BRIEF_TYPE;
}

function getComposition(briefType) {
  return BRIEF_COMPOSITIONS[resolveBriefType(briefType)];
}

// Tier entitlements — which named briefs each plan can open. Admins bypass.
// Drives both the API gate (?brief=) and the dashboard's locked brief rows,
// so unlocking a brief for a tier is a one-line change here.
// Tier ladder: free (one-time understanding) → weekly (awareness) →
// daily (decisions) → continuous (operations). 'paid' is kept as a
// back-compat alias for existing subscribers — same access as continuous.
const BRIEF_TIER_ACCESS = {
  free: ['onboarding'],
  weekly: ['onboarding', 'executive-daily', 'marketing-director'],
  daily: ['onboarding', 'executive-daily', 'marketing-director', 'social-media-manager'],
  continuous: [
    'onboarding',
    'executive-daily',
    'marketing-director',
    'creative-director',
    'social-media-manager',
    'website-developer',
  ],
  paid: [
    'onboarding',
    'executive-daily',
    'marketing-director',
    'creative-director',
    'social-media-manager',
    'website-developer',
  ],
};

function isBriefAllowed(tier, briefType, { isAdmin = false } = {}) {
  if (isAdmin) return true;
  const allowed = BRIEF_TIER_ACCESS[tier] || BRIEF_TIER_ACCESS.free;
  return allowed.includes(resolveBriefType(briefType));
}

// Producers — what an individual brief run executes. Module-backed briefs
// run their card modules via /api/dashboard/modules/run and the results
// upsert into dashboard_state.moduleBriefs, which the executive brief (and
// the individual brief view) renders from. Scout-backed briefs (marketing
// director) and social get their producers in phase 4b/4c.
const BRIEF_PRODUCERS = {
  'creative-director': { modules: ['multi-device-view', 'social-preview', 'style-guide', 'design-evaluation'] },
  'website-developer': { modules: ['seo-performance', 'agent-readiness'] },
};

module.exports = {
  BRIEF_SECTIONS,
  BRIEF_COMPOSITIONS,
  DEFAULT_BRIEF_TYPE,
  BRIEF_TYPE_ALIASES,
  BRIEF_TIER_ACCESS,
  BRIEF_PRODUCERS,
  getComposition,
  resolveBriefType,
  isBriefAllowed,
};
