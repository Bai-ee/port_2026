// Lead Gen — Constants
// Default scoring weights, thresholds, daily budgets, and pipeline stages.
// Source: docs/LEAD_GEN_PIPELINE_PLAN.md §2.3 / §2.4 / §1.2

export const PIPELINE_STAGES = [
  'discovered',
  'scored',
  'onboarding',
  'auditing',
  'audited',
  'generating',
  'ready',
  'packaged',
  'contacted',
];

export const TIER_LABELS = {
  hot:  { label: 'Hot',  threshold: 75 },
  warm: { label: 'Warm', threshold: 55 },
  cool: { label: 'Cool', threshold: 35 },
  cold: { label: 'Cold', threshold: 0  },
};

// Operator-tuned default: emphasize bad-site opportunity + popularity.
// Growth-investment is intentionally light because most of its inputs are
// not yet wired (Google Ads detection, GBP post recency, etc.).
export const DEFAULT_SCORING_WEIGHTS = {
  websiteQuality:   0.40,
  businessSuccess:  0.35,
  growthInvestment: 0.10,
  contactAccess:    0.15,
};

export const DEFAULT_THRESHOLDS = {
  autoAudit: 65,
  autoGenerate: 75,
  minimumScore: 55,  // Warm floor — prospects below this are discarded entirely.
};

export const DEFAULT_DAILY_BUDGET = {
  maxDiscoveries: 100,
  maxEnrichments: 30,
  maxAudits: 15,
  maxSiteGenerations: 5,
};

// Discovery-time quality filter — applied before scoring so we don't burn
// audit cost on obvious junk. Cheap rule-of-thumb checks only.
export const DISCOVERY_QUALITY_FLOOR = {
  minRating: 3.5,
  minReviews: 10,
  skipPermanentlyClosed: true,
  keepWhenNoWebsite: true,  // No-website prospects are prime opportunities.
};

// Geo priority — added to composite lead score after the four-signal weighting.
// Concentric: closer-to-home wins more. Score still dominates; geo nudges.
export const GEO_PRIORITY = {
  homeBase: 'DeKalb, IL',
  boost: {
    home:   8,  // DeKalb / Sycamore / Genoa zips
    metro:  5,  // Chicagoland (IL ZIPs starting with 60xx, excl. home set)
    state:  2,  // Rest of Illinois
    other:  0,  // Rest of US
  },
};

export const QUICK_AUDIT_TIMEOUT_MS = 8000;

export function tierFromScore(score) {
  if (score == null) return null;
  if (score >= TIER_LABELS.hot.threshold)  return 'hot';
  if (score >= TIER_LABELS.warm.threshold) return 'warm';
  if (score >= TIER_LABELS.cool.threshold) return 'cool';
  return 'cold';
}

export function letterGrade(score) {
  if (score == null) return null;
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}
