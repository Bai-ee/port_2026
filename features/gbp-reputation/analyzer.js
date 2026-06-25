'use strict';

// analyzer.js — Deterministic GBP reputation analyzer (pure, no LLM, no I/O).
//
// Input: a raw GBP payload (Rosita's-app review shape + profile flags).
// Output: the normalized card shape defined in the plan
//   (gbp-reputation-card-plan.md → "Normalized Data Shape").
//
// Risk levels: 'setup' | 'urgent' | 'attention' | 'healthy'.
// Negative unreplied reviews always outrank positive ones for priority.
// Scribe is used later only for human-facing copy; this stays deterministic.

const { ratingToNumber, sentimentForRating, suggestReply } = require('./reply-templates');
const { resolveChecklist } = require('./seo-checklist');

function disconnectedResult() {
  return {
    connected: false,
    setupRequired: true,
    riskLevel: 'setup',
    priorityAction: {
      label: 'Connect Google Business Profile',
      reason: 'No live reputation data is available yet.',
      severity: 'setup',
    },
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function newest(a, b) {
  return new Date(b.createTime || 0) - new Date(a.createTime || 0);
}

/**
 * Normalize + analyze a raw GBP payload.
 * @param {object|null} raw
 * @returns normalized shape (see plan)
 */
function analyzeGbpReputation(raw) {
  if (!raw || raw.connected === false) return disconnectedResult();

  const brand = raw.brand || raw.locationName || 'your business';
  const phone = raw.phone || 'us';
  const site = raw.site || raw.profileUrl || 'your website';

  const reviews = Array.isArray(raw.reviews) ? raw.reviews : [];
  const rated = reviews.map((r) => ({ ...r, _rating: ratingToNumber(r.starRating) }));

  const reviewCount = raw.reviewCount != null ? raw.reviewCount : rated.length;
  const ratingAverage = raw.ratingAverage != null
    ? round1(raw.ratingAverage)
    : (rated.length ? round1(rated.reduce((s, r) => s + r._rating, 0) / rated.length) : 0);

  const unreplied = rated.filter((r) => !r.reviewReply);
  const negativeReviews = rated.filter((r) => r._rating > 0 && r._rating <= 2);
  const negativeUnreplied = unreplied.filter((r) => r._rating > 0 && r._rating <= 2);

  // Reviews needing reply — negative first, then newest.
  const reviewsNeedingReply = [...unreplied].sort((a, b) => {
    const an = a._rating <= 2 ? 0 : 1;
    const bn = b._rating <= 2 ? 0 : 1;
    if (an !== bn) return an - bn;
    return newest(a, b);
  });

  const suggestedReplies = reviewsNeedingReply.map((r) => {
    const { sentiment, draft } = suggestReply(r, { brand, phone });
    return {
      reviewName: r.name || null,
      reviewer: r.reviewer?.displayName || r.reviewer || 'Customer',
      rating: r._rating,
      sentiment,
      draft,
    };
  });

  const profileHealth = {
    hasWebsite: Boolean(raw.profileHealth?.hasWebsite),
    hasPhone: Boolean(raw.profileHealth?.hasPhone),
    hasHours: Boolean(raw.profileHealth?.hasHours),
    hasPhotos: Boolean(raw.profileHealth?.hasPhotos),
    hasRecentPosts: Boolean(raw.profileHealth?.hasRecentPosts),
    hasMenuOrProducts: Boolean(raw.profileHealth?.hasMenuOrProducts),
  };
  const profileGaps = Object.entries(profileHealth).filter(([, v]) => !v).map(([k]) => k);

  const seoChecklist = resolveChecklist(raw.checklistCompletedIds || [], { brand, site });

  // Priority action + risk level — deterministic precedence.
  let riskLevel;
  let priorityAction;
  if (negativeUnreplied.length > 0) {
    riskLevel = 'urgent';
    priorityAction = {
      label: `Reply to ${negativeUnreplied.length} negative review${negativeUnreplied.length > 1 ? 's' : ''}`,
      reason: 'Negative unreplied reviews are the highest reputation risk.',
      severity: 'high',
    };
  } else if (unreplied.length > 0) {
    riskLevel = 'attention';
    priorityAction = {
      label: `Reply to ${unreplied.length} review${unreplied.length > 1 ? 's' : ''}`,
      reason: 'Unreplied reviews lower responsiveness signals and customer trust.',
      severity: 'medium',
    };
  } else if (profileGaps.length > 0 || seoChecklist.priorityItems.length > 0) {
    riskLevel = 'healthy';
    const gapLabel = seoChecklist.priorityItems[0]?.label || 'Close a profile completeness gap';
    priorityAction = {
      label: gapLabel,
      reason: 'Reviews are handled — local SEO and profile gaps are the next lever.',
      severity: 'low',
    };
  } else {
    riskLevel = 'healthy';
    priorityAction = {
      label: 'Maintain weekly posts and review responses',
      reason: 'Reputation is healthy — keep the cadence.',
      severity: 'low',
    };
  }

  return {
    connected: true,
    setupRequired: false,
    locationName: raw.locationName || brand,
    profileUrl: raw.profileUrl || '',
    ratingAverage,
    reviewCount,
    unrepliedCount: unreplied.length,
    negativeUnrepliedCount: negativeUnreplied.length,
    newestReviews: [...rated].sort(newest).slice(0, 5),
    reviewsNeedingReply,
    negativeReviews,
    suggestedReplies,
    profileHealth,
    profileGaps,
    seoChecklist,
    riskLevel,
    priorityAction,
  };
}

module.exports = { analyzeGbpReputation, disconnectedResult };
