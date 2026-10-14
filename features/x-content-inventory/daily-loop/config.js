// Daily loop constants: version, channel, timezone, caps, thresholds, slot times,
// and length limits. Which clients may run the loop is decided by features/client-readiness (assertClientReady).
// Decides nothing and computes nothing; it only names the numbers other modules use.
// Never imports a sibling module (leaf of the dependency graph).

import { HARD_LIMITS } from '../draft.js';

export const LOOP_VERSION = 3;
export const CHANNEL = 'x';
export const DEFAULT_TIMEZONE = 'America/Chicago';
export const MAX_SUGGESTIONS = 5;

/** Conversations older than this are history, not something to join. */
export const CONVERSATION_MAX_AGE_HOURS = 72;
/** Replies need a live thread — the measured early-reply window. */
export const REPLY_WINDOW_HOURS = 6;
/** One title/entity/facet term (weight 2) grounds a match; one story word does not. */
export const MIN_MATCH_SCORE = 2;
/** Below this the conversation is not about anything the owner holds. */
export const MIN_BRAND_FIT = 0.15;
/** Small evidence is shown as weak, never as a finding. */
export const MIN_EVIDENCE_N = 10;

export const SLOT_TIMES = ['09:30', '12:30', '17:30'];
export const MAX_LEN = { reply: 200, quote: HARD_LIMITS.quoteCaptionMax, original: 260 };
