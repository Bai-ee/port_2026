'use strict';

// reply-templates.js — Rule-based owner-reply drafts for GBP reviews.
//
// Lifted from the Rosita's review flow (Claude_Rositas_GBP) and generalized
// with {{brand}} / {{phone}} tokens so any client can reuse them. These are
// the *inputs* Scribe later rewrites in brand voice — v1 ships the rule-based
// draft directly. Do NOT publish from here; drafts are for review only.

const REPLY_TEMPLATES = {
  // 4-5 star
  positive: [
    "Thank you so much for your wonderful review! We're thrilled you enjoyed your experience at {{brand}}. We look forward to seeing you again soon!",
    "Your kind words made our day! We're so happy you loved your visit. The whole team at {{brand}} takes pride in every detail — see you next time!",
  ],
  // 3 star
  neutral: [
    "Thank you for taking the time to share your feedback. We truly appreciate it and are always looking for ways to improve. We'd love the chance to give you a 5-star visit next time!",
    "We appreciate your honest review and the chance to do better. Please let us know what would make your next visit with {{brand}} excellent.",
  ],
  // 1-2 star
  negative: [
    "We sincerely apologize that your experience didn't meet expectations. Your feedback matters to us and we'd like to make it right. Please reach out to us directly at {{phone}} so we can address your concerns.",
    "We're sorry we fell short — this isn't the standard we hold ourselves to at {{brand}}. Please contact us at {{phone}} so we can understand what happened and fix it.",
  ],
};

const STAR_WORD_TO_NUM = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

function ratingToNumber(starRating) {
  if (typeof starRating === 'number') return starRating;
  return STAR_WORD_TO_NUM[String(starRating || '').toUpperCase()] || 0;
}

function sentimentForRating(rating) {
  if (rating <= 2) return 'negative';
  if (rating === 3) return 'neutral';
  return 'positive';
}

function fill(template, { brand = 'our team', phone = 'us' } = {}) {
  return String(template).replace(/\{\{brand\}\}/g, brand).replace(/\{\{phone\}\}/g, phone);
}

/**
 * Deterministic reply-draft input for a single review.
 * Returns { sentiment, draft } — the draft Scribe will optionally rewrite.
 * Stable selection (no randomness) so the pipeline is reproducible.
 */
function suggestReply(review, opts = {}) {
  const rating = ratingToNumber(review?.starRating);
  const sentiment = sentimentForRating(rating);
  const bank = REPLY_TEMPLATES[sentiment] || REPLY_TEMPLATES.neutral;
  const draft = fill(bank[0], opts);
  return { sentiment, draft };
}

module.exports = {
  REPLY_TEMPLATES,
  ratingToNumber,
  sentimentForRating,
  suggestReply,
};
