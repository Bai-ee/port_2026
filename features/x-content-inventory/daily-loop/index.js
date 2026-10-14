// Public surface of the daily loop. Explicit export lists, so module-internal
// helpers exported for siblings (STOPWORDS, SLOT_TIMES, arrayValues, …) never leak.
// Decides nothing; only names what callers may import via ../daily-loop.js.

export { LOOP_VERSION, CHANNEL, DEFAULT_TIMEZONE, MAX_SUGGESTIONS,
  CONVERSATION_MAX_AGE_HOURS, REPLY_WINDOW_HOURS, MIN_MATCH_SCORE, MIN_BRAND_FIT, MIN_EVIDENCE_N } from './config.js';
export { tokenize, packageTerms, packagePhrases, phraseHits, WEAK_TERMS, isRealStory } from './text.js';
export { contentBasis, packageEligibility, INELIGIBLE_REASONS } from './content-basis.js';
export { buildBrandProfile, brandFit, discoveryQueries } from './brand.js';
export { normalizeConversationPost, conversationMomentum, groupNarratives, conversationPostsFrom } from './conversations.js';
export { performanceEvidence, deriveStrategy } from './evidence.js';
export { matchScore, selectSuggestions } from './select.js';
export { buildContributionPrompt, fallbackCopy, guardTypeFor, checkSuggestionText } from './copy.js';
export { localDateOf, zonedTimeToIso, stableHash, suggestionIdFor, socialPostIdFor } from './time-ids.js';
export { describeInputs, inputFingerprint, runDailyLoop } from './run.js';
