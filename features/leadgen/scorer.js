// Lead Gen — Scoring Engine
// Composite score across four dimensions. Pure function, no I/O.
// Source: docs/LEAD_GEN_PIPELINE_PLAN.md §2.2 / §2.3.

import { DEFAULT_SCORING_WEIGHTS, tierFromScore, letterGrade } from './constants.js';
import { TEMPLATE_PLATFORMS } from './quick-auditor.js';
import { geoPriority } from './geo-priority.js';

// ── SCORE_INPUTS ─────────────────────────────────────────────────────────────
// Per-signal list of every input that contributes to the score. The UI reads
// this to render the "what fired vs. what didn't" checklist on each row.
//
// Each input has:
//   key       - stable id
//   label     - human label
//   points    - max points it contributes when "hit"
//   evaluate  - ({ prospect, audit }) => 'hit' | 'miss' | 'planned' | 'na'
//                 hit     = currently contributing points to this lead's score
//                 miss    = checked, didn't trigger
//                 planned = input exists in the scorer but isn't wired yet
//                 na      = input is wired but data is unavailable for this row
//   detail    - optional ({ prospect, audit }) => string  (shown next to label)
//
// Signal "hit" semantics:
//   websiteQuality   — "hit" means the site has this deficiency (drives lead score UP)
//   businessSuccess  — "hit" means the business has this healthy signal
//   growthInvestment — "hit" means they invest in growth in this way
//   contactAccess    — "hit" means this contact channel is reachable
export const SCORE_INPUTS = {
  websiteQuality: {
    title: 'Site deficiencies (more = bigger opportunity)',
    items: [
      { key: 'notResponsive', label: 'No responsive viewport', points: 20,
        evaluate: ({ audit }) => audit?.isResponsive === false ? 'hit' : (audit?.isResponsive === true ? 'miss' : 'na') },
      { key: 'noHttps', label: 'Not on HTTPS', points: 10,
        evaluate: ({ audit }) => audit?.isHttps === false ? 'hit' : (audit?.isHttps === true ? 'miss' : 'na') },
      { key: 'slowLoad', label: 'Page load > 5s', points: 15,
        evaluate: ({ audit }) => audit?.loadTimeMs == null ? 'na' : (audit.loadTimeMs > 5000 ? 'hit' : 'miss'),
        detail: ({ audit }) => audit?.loadTimeMs != null ? `${(audit.loadTimeMs / 1000).toFixed(2)}s` : null },
      { key: 'templatePlatform', label: 'Template platform (Wix/Squarespace/etc.)', points: 10,
        evaluate: ({ audit }) => audit?.platform == null ? 'na' : (TEMPLATE_PLATFORMS.has(audit.platform) ? 'hit' : 'miss'),
        detail: ({ audit }) => audit?.platform || null },
      { key: 'noMetaDescription', label: 'Missing meta description', points: 5,
        evaluate: ({ audit }) => audit?.hasMetaDescription === false ? 'hit' : (audit?.hasMetaDescription === true ? 'miss' : 'na') },
      { key: 'noOgTags', label: 'Missing OpenGraph tags', points: 5,
        evaluate: ({ audit }) => audit?.hasOgTags === false ? 'hit' : (audit?.hasOgTags === true ? 'miss' : 'na') },
      { key: 'noJsonLd', label: 'No JSON-LD structured data', points: 5,
        evaluate: ({ audit }) => audit?.hasJsonLd === false ? 'hit' : (audit?.hasJsonLd === true ? 'miss' : 'na') },
    ],
  },
  businessSuccess: {
    title: 'Healthy-business signals',
    items: [
      { key: 'reviewsTier', label: 'Review count', points: 50,
        evaluate: ({ prospect }) => (prospect?.reviewCount ?? 0) > 0 ? 'hit' : 'miss',
        detail: ({ prospect }) => {
          const r = prospect?.reviewCount ?? 0;
          if (r >= 500) return `${r} (500+)`;
          if (r >= 150) return `${r} (150–499)`;
          if (r >= 50)  return `${r} (50–149)`;
          if (r > 0)    return `${r}`;
          return null;
        } },
      { key: 'ratingTier', label: 'Star rating', points: 35,
        evaluate: ({ prospect }) => (prospect?.rating ?? 0) >= 3.5 ? 'hit' : ((prospect?.rating ?? 0) > 0 ? 'miss' : 'na'),
        detail: ({ prospect }) => prospect?.rating != null ? `${prospect.rating}★` : null },
      { key: 'photosUploaded', label: 'Photos in GBP listing (>10)', points: 5,
        evaluate: ({ prospect }) => (prospect?.photosCount ?? 0) > 10 ? 'hit' : 'miss',
        detail: ({ prospect }) => prospect?.photosCount != null ? `${prospect.photosCount}` : null },
      { key: 'hours', label: 'Business hours filled', points: 5,
        evaluate: ({ prospect }) => prospect?.hoursComplete ? 'hit' : 'miss' },
      { key: 'priceLevel', label: 'Price level $$ or higher', points: 5,
        evaluate: ({ prospect }) => (prospect?.priceLevel ?? 0) >= 2 ? 'hit' : 'miss',
        detail: ({ prospect }) => prospect?.priceLevel ? '$'.repeat(prospect.priceLevel) : null },
    ],
  },
  growthInvestment: {
    title: 'Growth-investment signals',
    items: [
      { key: 'hasGoogleAds', label: 'Active Google Ads', points: 40,
        evaluate: () => 'planned' },
      { key: 'recentGbpPosts', label: 'Recent GBP posts (last 90d)', points: 15,
        evaluate: () => 'planned' },
      { key: 'gbpCompleteness', label: 'GBP profile completeness ≥ 70%', points: 15,
        evaluate: () => 'planned' },
      { key: 'recentPhotos', label: '5+ photos in listing', points: 10,
        evaluate: ({ prospect }) => (prospect?.photosCount ?? 0) > 5 ? 'hit' : 'miss',
        detail: ({ prospect }) => prospect?.photosCount != null ? `${prospect.photosCount}` : null },
      { key: 'hasBlog', label: 'Blog/news section on site', points: 10,
        evaluate: ({ audit }) => audit?.hasBlog === true ? 'hit' : (audit?.hasBlog === false ? 'miss' : 'na'),
        detail: ({ audit }) => audit?.blogLinksCount ? `${audit.blogLinksCount} link${audit.blogLinksCount === 1 ? '' : 's'}` : null },
      { key: 'hasSocial', label: 'Social media links on site', points: 10,
        evaluate: ({ audit }) => audit?.hasSocial === true ? 'hit' : (audit?.hasSocial === false ? 'miss' : 'na'),
        detail: ({ audit }) => {
          if (!audit?.socialLinksCount) return null;
          const platforms = (audit.socialPlatforms || []).map((p) => p.replace(/\.[a-z]+$/, '')).join(', ');
          return platforms ? `${audit.socialLinksCount} (${platforms})` : `${audit.socialLinksCount}`;
        } },
    ],
  },
  contactAccess: {
    title: 'Contact-channel signals',
    items: [
      { key: 'phone', label: 'Phone number', points: 30,
        evaluate: ({ prospect }) => prospect?.phone ? 'hit' : 'miss',
        detail: ({ prospect }) => prospect?.phone || null },
      { key: 'hasEmail', label: 'Email on homepage', points: 30,
        evaluate: ({ audit }) => audit?.hasEmail === true ? 'hit' : (audit?.hasEmail === false ? 'miss' : 'na'),
        detail: ({ audit }) => audit?.emailFound || null },
      { key: 'hasContactForm', label: 'Contact form on homepage', points: 20,
        evaluate: ({ audit }) => audit?.hasContactForm === true ? 'hit' : (audit?.hasContactForm === false ? 'miss' : 'na') },
      { key: 'address', label: 'Physical address', points: 10,
        evaluate: ({ prospect }) => prospect?.address ? 'hit' : 'miss' },
      { key: 'ownerKnown', label: 'Owner identified', points: 10,
        evaluate: ({ prospect }) => prospect?.ownerName ? 'hit' : 'planned' },
    ],
  },
};

// Helper for the UI: returns the evaluated status + detail for each input
// in a signal, given a prospect + persisted audit.
export function evaluateSignalInputs(signalKey, { prospect, audit }) {
  const def = SCORE_INPUTS[signalKey];
  if (!def) return { title: '', items: [] };
  return {
    title: def.title,
    items: def.items.map((it) => ({
      key: it.key,
      label: it.label,
      points: it.points,
      status: it.evaluate({ prospect, audit }),
      detail: it.detail ? it.detail({ prospect, audit }) : null,
    })),
  };
}

// ── Signal calculators ───────────────────────────────────────────────────────

// Signal 1 — Website Quality (0–100). Higher = worse site = bigger opportunity.
// Driven by quickSiteAudit output.
export function websiteQualityScore(audit) {
  if (!audit) return 0;
  // The quick-auditor already produces a 0–100 deficiency score. Use it
  // directly so this signal is consistent with the auditor's output.
  return Math.max(0, Math.min(100, audit.siteScore || 0));
}

// Signal 2 — Business Success (0–100). Derived from Google Business data.
export function businessSuccessScore({ reviewCount, rating, photosCount, hoursComplete, priceLevel }) {
  let s = 0;
  // Review count tier
  if (reviewCount >= 500)      s += 50;
  else if (reviewCount >= 150) s += 40;
  else if (reviewCount >=  50) s += 25;
  else if (reviewCount >    0) s += 10;
  // Rating tier
  if (rating >= 4.5)      s += 35;
  else if (rating >= 4.0) s += 25;
  else if (rating >= 3.5) s += 10;
  // Engagement signals
  if (photosCount > 10)   s += 5;
  if (hoursComplete)      s += 5;
  if (priceLevel >= 2)    s += 5;
  return Math.min(100, s);
}

// Signal 3 — Growth Investment (0–100). Are they spending on growth already?
export function growthInvestmentScore({ hasGoogleAds, recentGbpPosts, gbpCompleteness, recentPhotos, hasBlog, hasSocial }) {
  let s = 0;
  if (hasGoogleAds)            s += 40;
  if (recentGbpPosts)          s += 15;
  if (gbpCompleteness >= 0.7)  s += 15;
  if (recentPhotos)            s += 10;
  if (hasBlog)                 s += 10;
  if (hasSocial)               s += 10;
  return Math.min(100, s);
}

// Signal 4 — Contact Accessibility (0–100). Can we actually reach them?
export function contactAccessScore({ phone, hasEmail, hasContactForm, address, ownerKnown }) {
  let s = 0;
  if (phone)            s += 30;
  if (hasEmail)         s += 30;
  if (hasContactForm)   s += 20;
  if (address)          s += 10;
  if (ownerKnown)       s += 10;
  return Math.min(100, s);
}

// ── Composite ────────────────────────────────────────────────────────────────

function buildRecommendation(signals) {
  if (signals.websiteQuality >= 70 && signals.businessSuccess >= 60) {
    return 'Top-tier opportunity — bad site, healthy business. Push to full audit + preview generation.';
  }
  if (signals.websiteQuality >= 50 && signals.growthInvestment >= 40) {
    return 'Active grower with weak site. Strong outreach candidate.';
  }
  if (signals.websiteQuality >= 70 && signals.contactAccess < 40) {
    return 'Bad site but hard to reach. Worth a manual outreach pass before automating.';
  }
  if (signals.businessSuccess < 30) {
    return 'Weak business signals — likely not yet ready to invest. Deprioritize.';
  }
  return 'Standard mid-tier prospect. Process if budget allows.';
}

export function calculateLeadScore(rawSignals, weightsOverride = null) {
  const weights = { ...DEFAULT_SCORING_WEIGHTS, ...(weightsOverride || {}) };

  const signals = {
    websiteQuality:   Math.max(0, Math.min(100, rawSignals.websiteQuality   ?? 0)),
    businessSuccess:  Math.max(0, Math.min(100, rawSignals.businessSuccess  ?? 0)),
    growthInvestment: Math.max(0, Math.min(100, rawSignals.growthInvestment ?? 0)),
    contactAccess:    Math.max(0, Math.min(100, rawSignals.contactAccess    ?? 0)),
  };

  const composite =
    signals.websiteQuality   * weights.websiteQuality   +
    signals.businessSuccess  * weights.businessSuccess  +
    signals.growthInvestment * weights.growthInvestment +
    signals.contactAccess    * weights.contactAccess;

  const score = Math.round(composite);
  return {
    score,
    grade: letterGrade(score),
    tier: tierFromScore(score),
    breakdown: signals,
    weights,
    recommendation: buildRecommendation(signals),
  };
}

// Convenience: build all four signals from a prospect + quick-audit result.
// Used by the discover route so the wiring is trivial.
export function scoreProspect({ prospect, audit, weightsOverride = null, geoBoostOverride = null }) {
  const websiteQuality = websiteQualityScore(audit);

  const businessSuccess = businessSuccessScore({
    reviewCount:    prospect.reviewCount   ?? 0,
    rating:         prospect.rating        ?? 0,
    photosCount:    prospect.photosCount   ?? 0,
    hoursComplete:  prospect.hoursComplete ?? false,
    priceLevel:     prospect.priceLevel    ?? 0,
  });

  // Without enrichment we don't have Ads detection or GBP-post recency yet —
  // pass conservative defaults; enrichment phase will refine these.
  const growthInvestment = growthInvestmentScore({
    hasGoogleAds:    prospect.hasGoogleAds    ?? false,
    recentGbpPosts:  prospect.recentGbpPosts  ?? false,
    gbpCompleteness: prospect.gbpCompleteness ?? 0,
    recentPhotos:    prospect.photosCount > 5,
    hasBlog:         audit?.hasBlog   ?? false,
    hasSocial:       audit?.hasSocial ?? false,
  });

  const contactAccess = contactAccessScore({
    phone:          Boolean(prospect.phone),
    hasEmail:       audit?.hasEmail        ?? false,
    hasContactForm: audit?.hasContactForm  ?? false,
    address:        Boolean(prospect.address),
    ownerKnown:     Boolean(prospect.ownerName),
  });

  const base = calculateLeadScore(
    { websiteQuality, businessSuccess, growthInvestment, contactAccess },
    weightsOverride,
  );

  // Geo boost — added to composite, capped at 100. Tier/grade re-derive
  // from the final score so the table reflects the geo-adjusted ranking.
  const geo = geoPriority({ address: prospect.address, boostOverride: geoBoostOverride });
  const finalScore = Math.min(100, base.score + (geo.boost || 0));

  return {
    ...base,
    baseScore: base.score,
    score: finalScore,
    grade: letterGrade(finalScore),
    tier: tierFromScore(finalScore),
    geo: { tier: geo.tier, boost: geo.boost, label: geo.label },
  };
}
