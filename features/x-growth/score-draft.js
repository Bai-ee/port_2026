import { getAlgorithmProfile, getActiveProfileId } from './algorithm-profile.js';

// ---------------------------------------------------------------------------
// Pattern banks — derived from the open-source X algorithm architecture docs.
// Weights are relative scoring nudges, NOT official X numeric values.
// ---------------------------------------------------------------------------

const REPLY_BOOSTERS = [
  { pattern: /\?/, delta: 0.15, reason: 'Question increases P(reply)' },
  { pattern: /\b(what do you think|thoughts\?|agree\?|disagree\?|hot take|unpopular opinion)\b/i, delta: 0.10, reason: 'Explicit conversation invitation' },
  { pattern: /\b(comment|reply|let me know|tell me)\b/i, delta: 0.06, reason: 'Soft reply prompt' },
];

const REPOST_BOOSTERS = [
  { pattern: /\b(thread|breakdown|guide|tips|how to|step-by-step)\b/i, delta: 0.12, reason: 'Educational/shareable framing' },
  { pattern: /\b(introducing|announcing|launching|releasing|just shipped)\b/i, delta: 0.08, reason: 'News-worthy announcement' },
  { pattern: /\b(new|update|feature)\b/i, delta: 0.05, reason: 'Informational freshness' },
];

const PROFILE_CLICK_BOOSTERS = [
  { pattern: /\b(building|shipping|working on|we built|we shipped)\b/i, delta: 0.10, reason: 'Builder credibility signals' },
  { pattern: /\b(founder|ceo|creator|engineer)\b/i, delta: 0.06, reason: 'Authority role mention' },
  { pattern: /\b(check out|see more|learn more|profile)\b/i, delta: 0.05, reason: 'Profile CTA' },
];

const DWELL_BOOSTERS = [
  { check: (t) => t.length >= 120 && t.length <= 260, delta: 0.08, reason: 'Optimal length for reading time' },
  { pattern: /\b(here is why|reason|because|the thing is|truth)\b/i, delta: 0.07, reason: 'Explanation framing increases dwell' },
  { pattern: /\d+/, delta: 0.05, reason: 'Specificity (numbers) increases credibility and dwell' },
];

const NEGATIVE_TRIGGERS = [
  { pattern: /\b(buy now|limited time|act now|don.?t miss|last chance)\b/i, negDelta: 0.25, signal: 'P(not_interested)', reason: 'Hard-sell language' },
  { pattern: /\b(100x|guaranteed|free money|get rich|passive income)\b/i, negDelta: 0.30, signal: 'P(report)', reason: 'Scam-associated phrasing' },
  { pattern: /\b(like if|rt if|retweet to|follow for|drop a like|drop a ❤️)\b/i, negDelta: 0.20, signal: 'P(not_interested)', reason: 'Engagement bait' },
  { pattern: /\b(giveaway.*follow|follow.*giveaway)\b/is, negDelta: 0.18, signal: 'P(report)', reason: 'Follow-to-win bait' },
];

const SPAM_CHECKS = [
  { check: (t) => (t.match(/#\w+/g) || []).length > 3, negDelta: 0.12, reason: 'Excessive hashtags (>3)' },
  { check: (t) => (t.match(/[A-Z]/g) || []).length / Math.max(t.length, 1) > 0.45, negDelta: 0.10, reason: 'Excessive caps' },
];

const LINK_PATTERN = /https?:\/\/\S+/;

// ---------------------------------------------------------------------------

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function applyPatternBoosters(text, boosters, base) {
  let score = base;
  const matched = [];
  for (const b of boosters) {
    const hit = b.pattern ? b.pattern.test(text) : (b.check ? b.check(text) : false);
    if (hit) {
      score += b.delta ?? 0;
      matched.push(b.reason);
    }
  }
  return { score: clamp01(score), matched };
}

function detectPostType(text, context = {}) {
  const t = text.toLowerCase();
  const hint = String(context.postTypeHint || context.postType || '').toLowerCase();

  if (hint && [
    'authority', 'reply-loop', 'proof-loop', 'kol-adjacent',
    'case-study', 'offer', 'asset', 'conversation-starter',
  ].includes(hint)) return hint;

  if (/\b(result|grew|increased|case study|proof)\b/.test(t)) return 'proof-loop';
  if (/\b(buy|offer|deal|discount|price|book|sign up|join now)\b/.test(t)) return 'offer';
  if (LINK_PATTERN.test(text) && /\b(check out|link|try)\b/.test(t)) return 'offer';
  if (/\?/.test(text) && t.length < 180) return 'reply-loop';
  if (/\b(thread|breakdown|tip|how to|guide)\b/.test(t)) return 'case-study';
  if (/\b(we built|we shipped|building|shipped)\b/.test(t)) return 'authority';
  if (/\b(photo|image|video|watch)\b/.test(t)) return 'asset';
  return 'conversation-starter';
}

function primaryActionForType(postType) {
  const profile = getAlgorithmProfile();
  const hint = profile.postTypeScoringHints?.[postType];
  return hint?.primaryAction || 'reply';
}

/**
 * Score a draft X post against algorithm profile assumptions.
 *
 * @param {string} text - Raw post text
 * @param {Object} [context] - Optional context
 * @param {string} [context.postTypeHint] - Preferred post type
 * @param {string} [context.mediaType]    - 'video' | 'image' | 'none'
 * @param {string} [context.objective]    - x-growth objective id
 * @param {string} [context.kind]         - 'reply' to score as a reply: re-weights
 *                                           toward substance/credibility, away from
 *                                           announcement framing, penalises links harder
 * @returns {Object} Score result
 */
export function scoreXPost(text, context = {}) {
  const profile = getAlgorithmProfile();
  const t = String(text || '');

  // Reply potential
  const replyResult = applyPatternBoosters(t, REPLY_BOOSTERS, 0.30);

  // Repost potential
  const repostResult = applyPatternBoosters(t, REPOST_BOOSTERS, 0.20);

  // Profile click potential
  const profileClickResult = applyPatternBoosters(t, PROFILE_CLICK_BOOSTERS, 0.20);

  // Dwell potential
  const dwellResult = applyPatternBoosters(t, DWELL_BOOSTERS, 0.25);

  // Topic authority signal (consistent, specific, builds credibility)
  let topicAuthority = 0.20;
  if (/\d+/.test(t)) topicAuthority += 0.08;
  if (t.length >= 80) topicAuthority += 0.05;
  if (/\b(because|reason|why|truth|insight)\b/i.test(t)) topicAuthority += 0.07;
  topicAuthority = clamp01(topicAuthority);

  // Negative feedback risk
  let negFeedbackRisk = 0.0;
  const negReasons = [];
  for (const n of NEGATIVE_TRIGGERS) {
    if (n.pattern.test(t)) {
      negFeedbackRisk += n.negDelta;
      negReasons.push(n.reason);
    }
  }
  for (const s of SPAM_CHECKS) {
    if (s.check(t)) {
      negFeedbackRisk += s.negDelta;
      negReasons.push(s.reason);
    }
  }
  negFeedbackRisk = clamp01(negFeedbackRisk);

  // Link risk
  const hasLink = LINK_PATTERN.test(t);
  const linkRisk = hasLink ? 0.65 : 0.0;

  // Media boosts
  const mediaType = String(context.mediaType || 'none');
  let mediaBonus = 0;
  if (mediaType === 'video') mediaBonus = 0.20;
  else if (mediaType === 'image') mediaBonus = 0.15;

  // Composite xGrowthScore — weight positive signals, penalise neg feedback.
  // Reply mode re-weights toward substance and credibility (dwell + topic
  // authority) and away from announcement/repost framing, and penalises links
  // harder: links in replies are down-ranked with no "move to first reply" escape.
  const isReply = String(context.kind || '') === 'reply';
  const raw = isReply
    ? (
        replyResult.score * 0.20 +
        dwellResult.score * 0.30 +
        topicAuthority * 0.25 +
        profileClickResult.score * 0.10 +
        repostResult.score * 0.05 +
        mediaBonus * 0.05 -
        negFeedbackRisk * 0.30 -
        linkRisk * 0.20
      )
    : (
        replyResult.score * 0.25 +
        repostResult.score * 0.20 +
        profileClickResult.score * 0.15 +
        dwellResult.score * 0.15 +
        topicAuthority * 0.10 +
        mediaBonus * 0.15 -
        negFeedbackRisk * 0.30 -
        linkRisk * 0.10
      );

  const xGrowthScore = clamp01(raw);

  const postType = detectPostType(t, context);
  const targetAction = primaryActionForType(postType);

  // Warnings
  const warnings = [];
  if (negReasons.length) warnings.push(...negReasons.map((r) => ({ type: 'negativeFeedbackRisk', message: r })));
  if (hasLink) warnings.push({ type: 'linkRisk', message: profile.assumptions?.linkRisk?.hypothesis || 'External link may reduce For You distribution.' });

  // Recommendations
  const recommendations = [];
  if (isReply) {
    // A reply earns reach through substance — a specific insight or a genuine
    // question. Announcement/repost framing does not apply, and links in replies
    // are suppressed with no first-reply escape hatch.
    if (replyResult.score < 0.40 && topicAuthority < 0.35) {
      recommendations.push({ priority: 'medium', action: 'Add a specific insight or a genuine question', reason: 'Thin reply — substance or a real question raises P(reply) and dwell' });
    }
    if (hasLink) {
      recommendations.push({ priority: 'high', action: 'Remove the link from the reply', reason: 'Links in replies are down-ranked; reference the source in plain text instead' });
    }
    if (negFeedbackRisk > 0.20) {
      recommendations.push({ priority: 'high', action: 'Remove hard-sell or engagement-bait language', reason: 'High P(not_interested) risk' });
    }
  } else {
    if (replyResult.score < 0.40 && !/\?/.test(t)) {
      recommendations.push({ priority: 'high', action: 'Add a question', reason: 'Raises P(reply) — high-weight positive signal' });
    }
    if (repostResult.score < 0.30) {
      recommendations.push({ priority: 'medium', action: 'Add shareable framing', reason: 'Tip, announcement, or insight increases P(repost)' });
    }
    if (negFeedbackRisk > 0.20) {
      recommendations.push({ priority: 'high', action: 'Remove hard-sell or engagement-bait language', reason: 'High P(not_interested) risk' });
    }
    if (hasLink && context.objective !== 'leads-or-calls') {
      recommendations.push({ priority: 'medium', action: 'Move link to first reply', reason: 'Reduces linkRisk without losing CTA' });
    }
  }

  const allReasons = [
    ...replyResult.matched,
    ...repostResult.matched,
    ...profileClickResult.matched,
    ...dwellResult.matched,
  ];

  return {
    algorithmProfileVersion: profile.id,
    xGrowthScore,
    targetAction,
    postType,
    scores: {
      replyPotential:         replyResult.score,
      repostPotential:        repostResult.score,
      profileClickPotential:  profileClickResult.score,
      topicAuthority,
      dwellPotential:         dwellResult.score,
      negativeFeedbackRisk:   negFeedbackRisk,
      linkRisk,
    },
    warnings,
    recommendations,
    hypothesis: allReasons.length
      ? allReasons.join('; ')
      : 'No strong positive or negative signals detected.',
  };
}
