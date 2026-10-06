import { getAlgorithmProfile, getActiveProfileId } from './algorithm-profile.js';

// ---------------------------------------------------------------------------
// Pattern banks — derived from the open-source X algorithm architecture docs.
// Weights are relative scoring nudges, NOT official X numeric values.
// ---------------------------------------------------------------------------

// HEURISTIC pattern banks: these are text-pattern guesses at what the Phoenix
// model might predict, not X-published values. The VERIFIED numbers are the
// action weights in the algorithm profile (rankingWeights), used in the composite.
//
// Owner-measured on @bai_ee: audience questions landed BELOW baseline, so a '?'
// is only a token nudge; reply potential comes from substance (a specific claim,
// a number, a contrarian read) that gives people something to answer.
const REPLY_BOOSTERS = [
  { pattern: /\?/, delta: 0.03, reason: 'Question (weak: measured below baseline on @bai_ee)' },
  { pattern: /\b(what do you think|thoughts\?|agree\?|disagree\?|hot take|unpopular opinion)\b/i, delta: 0.04, reason: 'Explicit conversation invitation' },
  { pattern: /\b(comment|reply|let me know|tell me)\b/i, delta: 0.02, reason: 'Soft reply prompt' },
  { pattern: /\b(most \w+ (are|get|think)|nobody|everyone|wrong|overrated|underrated|actually|instead)\b/i, delta: 0.10, reason: 'Opinionated claim people can answer' },
  { pattern: /\d+/, delta: 0.05, reason: 'Specific number gives replies something to engage' },
  { pattern: /\b(because|the reason|here is why|here's why)\b/i, delta: 0.06, reason: 'Reasoned claim invites a substantive reply' },
];

const REPOST_BOOSTERS = [
  { pattern: /\b(thread|breakdown|guide|tips|how to|step-by-step)\b/i, delta: 0.12, reason: 'Educational/shareable framing' },
  { pattern: /\b(introducing|announcing|launching|releasing|just shipped)\b/i, delta: 0.08, reason: 'News-worthy announcement' },
  { pattern: /\b(new|update|feature)\b/i, delta: 0.05, reason: 'Informational freshness' },
];

// Copy-link (20) and DM share (5) are the top positive actions: people send
// things that are references, rare/useful, or show how something was made.
const SHARE_BOOSTERS = [
  { pattern: /\b(reference|resource|resources|cheat ?sheet|template|checklist|list of|toolkit|free to use|bookmark)\b/i, delta: 0.14, reason: 'Reference/resource worth saving and sending' },
  { pattern: /\b(rare|unreleased|never released|out of print|lost|first ever|only copy|archive|archived|found|discovered)\b/i, delta: 0.12, reason: 'Rare or hard-to-find information' },
  { pattern: /\b(how (i|we) (made|built|designed|did)|how it was made|behind the scenes|process|breakdown|made with|built with|step-by-step)\b/i, delta: 0.14, reason: 'How-it-was-made detail people forward' },
  { pattern: /\d+/, delta: 0.04, reason: 'Concrete specifics are easier to send' },
  { check: (t) => t.length >= 100, delta: 0.04, reason: 'Enough substance to be worth sending' },
];

// Follow-author (4.0) follows from consistent identity and authority, not from
// a one-off post: first-person craft, named work, track record.
const FOLLOW_BOOSTERS = [
  { pattern: /\b(i (design|make|build|write|ship|draw|produce|run)|we (design|make|build|ship)|my (work|studio|process|practice))\b/i, delta: 0.14, reason: 'First-person craft identity' },
  { pattern: /\b(case study|client|clients|portfolio|years of|since \d{4})\b/i, delta: 0.10, reason: 'Track-record / authority signal' },
  { pattern: /\b(founder|ceo|creator|engineer|designer|director)\b/i, delta: 0.06, reason: 'Authority role mention' },
  { pattern: /\b(building|shipping|working on|we built|we shipped)\b/i, delta: 0.06, reason: 'Builder credibility' },
];

// Kept for output stability only: profile_click carries ZERO ranking weight.
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

// Owner-measured on @bai_ee: link posts lose ~44% engagement.
const LINK_ENGAGEMENT_FACTOR = 0.56;
const REPLY_LINK_ENGAGEMENT_FACTOR = 0.40;
// One report/mute/not-interested outweighs hundreds of likes (rankingWeights
// negative), so negative risk is weighted asymmetrically, well above any single
// positive term in the composite.
const NEG_RISK_PENALTY = 0.60;
// Measured on @bai_ee (video > text > still); the verified media weights are ~0.
const VIDEO_MEASURED_BONUS = 0.05;

// Post-mode composite weights come from the profile's verified action weights.
// Weights are sqrt-compressed because the p(action) inputs are coarse text
// heuristics: raw 20:1 ratios would let one heuristic decide the whole score.
function compositeWeights() {
  const pos = getAlgorithmProfile().rankingWeights?.positive || {};
  const w = (v, fallback) => Math.sqrt(Math.max(0, Number.isFinite(v) ? v : fallback));
  return {
    reply: w((pos.reply ?? 5) + (pos.quote ?? 5), 10),
    share: w((pos.share_via_copy_link ?? 20) + (pos.share_via_dm ?? 5), 25),
    follow: w(pos.follow_author ?? 4, 4),
    repost: w(pos.retweet ?? 1, 1),
    dwell: w(pos.cont_click_dwell_time ?? 0.4, 0.4),
    profileClick: w(pos.profile_click ?? 0, 0),
  };
}

// Reply-mode weights: a reply earns reach through substance (heuristic split in
// the same spirit as the verified weights: reply/dwell/authority first, follow
// and share secondary, repost irrelevant).
const REPLY_MODE_WEIGHTS = { reply: 0.30, dwell: 0.25, topicAuthority: 0.25, follow: 0.10, share: 0.10 };

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

  // Share + follow potential (verified top-weighted actions)
  const shareResult = applyPatternBoosters(t, SHARE_BOOSTERS, 0.15);
  const followResult = applyPatternBoosters(t, FOLLOW_BOOSTERS, 0.15);

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

  // Media: verified weights are ~0; only the measured video > text > still prior applies.
  const mediaType = String(context.mediaType || 'none');
  const mediaBonus = mediaType === 'video' ? VIDEO_MEASURED_BONUS : 0;

  // Composite xGrowthScore: expected-value over the verified action weights
  // (share/reply dominate, repost small, profile_click zero), scaled by the
  // measured link penalty, minus an asymmetric negative-feedback penalty.
  const isReply = String(context.kind || '') === 'reply';
  let positive;
  if (isReply) {
    const rw = REPLY_MODE_WEIGHTS;
    positive =
      replyResult.score * rw.reply +
      dwellResult.score * rw.dwell +
      topicAuthority * rw.topicAuthority +
      followResult.score * rw.follow +
      shareResult.score * rw.share;
  } else {
    const w = compositeWeights();
    const total = w.reply + w.share + w.follow + w.repost + w.dwell + w.profileClick;
    positive = total > 0 ? (
      replyResult.score * w.reply +
      shareResult.score * w.share +
      followResult.score * w.follow +
      repostResult.score * w.repost +
      dwellResult.score * w.dwell +
      profileClickResult.score * w.profileClick
    ) / total : 0;
  }
  const linkFactor = hasLink ? (isReply ? REPLY_LINK_ENGAGEMENT_FACTOR : LINK_ENGAGEMENT_FACTOR) : 1;
  const raw = positive * linkFactor + mediaBonus - negFeedbackRisk * NEG_RISK_PENALTY;

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
    // A reply earns reach through substance. Links in replies are suppressed
    // with no first-reply escape hatch.
    if (replyResult.score < 0.40 && topicAuthority < 0.35) {
      recommendations.push({ priority: 'medium', action: 'Add a specific insight, number, or concrete detail', reason: 'Thin reply: substance raises P(reply) and dwell' });
    }
    if (hasLink) {
      recommendations.push({ priority: 'high', action: 'Remove the link from the reply', reason: 'Links in replies are down-ranked; reference the source in plain text instead' });
    }
    if (negFeedbackRisk > 0.20) {
      recommendations.push({ priority: 'high', action: 'Remove hard-sell or engagement-bait language', reason: 'High P(not_interested) risk' });
    }
  } else {
    if (negFeedbackRisk > 0.20) {
      recommendations.push({ priority: 'high', action: 'Remove hard-sell or engagement-bait language', reason: 'One report/mute outweighs hundreds of likes' });
    }
    if (shareResult.score < 0.30) {
      recommendations.push({ priority: 'high', action: 'Add something worth sending: a reference, a rare detail, or how it was made', reason: 'Copy-link (20) and DM share (5) are the highest-weighted actions' });
    }
    if (replyResult.score < 0.35) {
      recommendations.push({ priority: 'medium', action: 'Make a specific, answerable claim', reason: 'Substance earns replies (5, +15 from mutuals); a bare question measured below baseline' });
    }
    if (hasLink && context.objective !== 'leads-or-calls') {
      recommendations.push({ priority: 'medium', action: 'Move link to first reply', reason: 'Link posts lose ~44% engagement (measured); keeps the CTA' });
    }
  }

  const allReasons = [
    ...replyResult.matched,
    ...shareResult.matched,
    ...followResult.matched,
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
      sharePotential:         shareResult.score,
      followPotential:        followResult.score,
      repostPotential:        repostResult.score,
      profileClickPotential:  profileClickResult.score, // zero ranking weight; informational
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
