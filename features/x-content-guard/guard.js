// X content guard — deterministic pre-publish checks for @bai_ee.
//
// Contract deliberately mirrors `features/not-the-rug-brief/guardian.js`
// `runGuardian`: a single verdict object, `hardBlock` for things that must never
// ship, `flags` for things a human should look at, `reviewRequired` as the
// summary bit, and it never throws.
//
// Phase 1 is pure and offline: no network, no LLM, no cost. Where the
// deterministic signals are too weak to call a lane, the verdict says so via
// `needsLaneReview` rather than guessing — a model pass consumes that later.

import { scoreXPost } from '../x-growth/index.js';
import {
  CASINO_TERMS,
  AMBIGUOUS_CASINO,
  TICKER_RE,
  PRICE_CONTEXT_RE,
  POLITICS_TERMS,
  BAIT_TERMS,
  HARD_SELL_TERMS,
  LANE_SIGNALS,
  MECHANICS,
  LENGTH_TARGETS,
  BLOCKED_LANES,
} from './rules.js';

/** Strip the trailing t.co that X appends for attached media — it is not a link in the copy. */
function stripTrailingMediaUrl(text) {
  return String(text || '').replace(/\s*https:\/\/t\.co\/\w+\s*$/, '');
}

/**
 * A trailing x.com/twitter.com status URL is how X builds a quote tweet — the
 * post IS the link. Flagging it as an inline link would flag every correctly
 * composed quote-react.
 */
const TRAILING_QUOTE_URL = /\s*https:\/\/(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/\d+\/?\s*$/i;

function stripTrailingQuoteUrl(text) {
  return String(text || '').replace(TRAILING_QUOTE_URL, '');
}

function hasInlineLink(text) {
  return /https?:\/\/\S+/i.test(stripTrailingQuoteUrl(stripTrailingMediaUrl(text)));
}

function matchAll(terms, haystack) {
  return terms.filter((t) => t.re.test(haystack)).map((t) => t.code);
}

/**
 * Deterministic lane classification.
 * Returns { lane, confidence, scores } — `confidence: 'low'` means the caller
 * should defer to a model rather than trust the label.
 */
export function classifyLane(text, { quotedText = '' } = {}) {
  const hay = `${text || ''} \n ${quotedText || ''}`;

  if (matchAll(POLITICS_TERMS, hay).length) return { lane: 'politics', confidence: 'high', scores: {} };
  if (matchAll(CASINO_TERMS, hay).length) return { lane: 'casino', confidence: 'high', scores: {} };
  if (TICKER_RE.test(hay) && PRICE_CONTEXT_RE.test(hay)) {
    return { lane: 'casino', confidence: 'high', scores: {} };
  }

  const scores = {};
  for (const [lane, patterns] of Object.entries(LANE_SIGNALS)) {
    scores[lane] = patterns.reduce((n, re) => n + (re.test(hay) ? 1 : 0), 0);
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topLane, topScore] = ranked[0];
  const runnerUp = ranked[1] ? ranked[1][1] : 0;

  if (topScore === 0) return { lane: 'unknown', confidence: 'low', scores };
  // A tie between two lanes is not a confident call.
  if (topScore === runnerUp) return { lane: topLane, confidence: 'low', scores };
  return { lane: topLane, confidence: topScore >= 2 ? 'high' : 'low', scores };
}

/**
 * @param {object} post - { text, type, media, quotedText, quotedAuthor }
 *   type:  quote-react | quote-commentary | original-showcase | original-text |
 *          self-quote | reply | retweet
 *   media: video | image | gif | none
 * @param {object} [opts] - { handle } for self-quote detection
 * @returns {object} verdict
 */
export function guardXPost(post = {}, opts = {}) {
  const errorVerdict = {
    readyToPublish: false,
    hardBlock: false,
    lane: 'unknown',
    laneConfidence: 'low',
    needsLaneReview: true,
    xGrowthScore: null,
    concerns: [],
    flags: [],
    reviewRequired: true,
    note: 'Guard error — manual review required',
  };

  try {
    const text = String(post.text || '');
    const type = String(post.type || 'original-text');
    const media = String(post.media || 'none');
    const quotedText = String(post.quotedText || '');
    const body = stripTrailingMediaUrl(text);
    const hay = `${text} \n ${quotedText}`;

    const concerns = [];
    const flags = [];
    const addFlag = (code, severity, issue) => flags.push({ code, severity, issue });

    // --- Lane -------------------------------------------------------------
    const { lane, confidence, scores } = classifyLane(text, { quotedText });

    // --- Check 1: blocked lanes (pure, hardBlock) --------------------------
    let hardBlock = false;
    if (BLOCKED_LANES.has(lane)) {
      hardBlock = true;
      const codes = [
        ...matchAll(CASINO_TERMS, hay),
        ...matchAll(POLITICS_TERMS, hay),
      ];
      concerns.push(
        lane === 'politics'
          ? 'Political content. 4 such posts averaged 0 likes and 59 views, and they blur the author embedding the retrieval tower uses to surface you.'
          : 'Speculation content. This is the casino lane, not the work — it does not reach and it repositions the feed.',
      );
      codes.forEach((code) => addFlag(code, 'major', `blocked-lane term (${lane})`));
    }

    // --- Check 1b: ambiguous mechanism names (never a block, always a review) ---
    matchAll(AMBIGUOUS_CASINO, hay).forEach((code) => {
      addFlag(code, 'major', 'reads as speculation out of context — confirm the subject is the work, not the asset');
    });

    // --- Check 2: bait + hard sell (flags) ---------------------------------
    matchAll(BAIT_TERMS, text).forEach((code) => {
      addFlag(code, 'major', 'engagement bait — likely filtered pre-rank');
      concerns.push('Engagement bait is filtered before ranking (repo profile: engagementBaitPenalty, high confidence).');
    });
    matchAll(HARD_SELL_TERMS, text).forEach((code) =>
      addFlag(code, 'minor', 'hard-sell phrasing correlates with not_interested / mute_author'),
    );

    // --- Check 3: mechanics (flags, mostly auto-fixable) -------------------
    if (MECHANICS.hashtag.re.test(text)) {
      addFlag(MECHANICS.hashtag.code, MECHANICS.hashtag.severity, 'hashtag — the model account used 0 in 603 authored posts');
    }
    if (hasInlineLink(text)) {
      addFlag(MECHANICS.inlineLink.code, MECHANICS.inlineLink.severity, 'inline link — move to the first self-reply (costs ~44% of engagement)');
    }
    if (type === 'original-showcase') {
      if (media === 'none') {
        addFlag(MECHANICS.showcaseNoMedia.code, MECHANICS.showcaseNoMedia.severity, 'showcase post with no media');
      } else if (media === 'image' || media === 'gif') {
        addFlag(MECHANICS.imageOnShowcase.code, MECHANICS.imageOnShowcase.severity, 'video out-reaches image 3.4x within this post type');
      }
    }
    if (type === 'retweet') {
      addFlag(MECHANICS.retweet.code, MECHANICS.retweet.severity, 'OONRetweetReplyFilter removes retweets for non-followers — cannot reach a stranger');
    }

    // --- Check 4: length vs the model's measured targets (minor) -----------
    const target = LENGTH_TARGETS[type];
    if (target && body.length) {
      if (body.length < target.min) {
        addFlag('len-short', 'minor', `${body.length} chars; ${type} works around ${target.ideal}`);
      } else if (body.length > target.max) {
        addFlag('len-long', 'minor', `${body.length} chars; ${type} works around ${target.ideal}`);
      }
    }

    // --- Check 5: algorithmic score (deterministic, no cost) ---------------
    let xGrowthScore = null;
    try {
      const mediaType = media === 'video' || media === 'image' ? media : 'none';
      const scored = scoreXPost(text, { mediaType, kind: type === 'reply' ? 'reply' : 'post' });
      xGrowthScore = typeof scored?.xGrowthScore === 'number' ? scored.xGrowthScore : null;
    } catch {
      // Scoring is advisory; never let it fail the guard.
      addFlag('score-unavailable', 'minor', 'scoreXPost did not return a score');
    }

    // --- Verdict -----------------------------------------------------------
    const majorFlag = flags.some((f) => f.severity === 'major');
    // Unknown or contested lanes are exactly the case the deterministic rules
    // cannot settle — a broad regex here is what produced ~50% false positives.
    const needsLaneReview = confidence === 'low' || lane === 'unknown';
    const reviewRequired = hardBlock || majorFlag || needsLaneReview;

    let note;
    if (hardBlock) note = `Blocked: ${lane} lane.`;
    else if (majorFlag) note = 'Publishable after the major flags are resolved.';
    else if (needsLaneReview) note = 'Clean, but the lane is unclear — needs a judgement pass.';
    else note = `Clear. Lane: ${lane}.`;

    return {
      readyToPublish: !hardBlock && !majorFlag && !needsLaneReview,
      hardBlock,
      lane,
      laneConfidence: confidence,
      laneScores: scores,
      needsLaneReview,
      xGrowthScore,
      concerns,
      flags,
      reviewRequired,
      note,
    };
  } catch (err) {
    return { ...errorVerdict, note: `Guard error — manual review required (${err?.message || 'unknown'})` };
  }
}
