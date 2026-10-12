// Daily loop constants: version, channel, timezone, caps, thresholds, slot times,
// length limits, and the owner-only POC gate.
// Decides nothing and computes nothing; it only names the numbers other modules use.
// Never imports a sibling module (leaf of the dependency graph).

import { HARD_LIMITS } from '../draft.js';

export const LOOP_VERSION = 3;
export const CHANNEL = 'x';
export const DEFAULT_TIMEZONE = 'America/Chicago';
export const MAX_SUGGESTIONS = 5;

/** ⚠️ POC isolation. The inventory store is global and the corpora are
 * Bryan's, so the selected dashboard client does NOT establish isolation.
 * Anything not on this list is rejected until client-scoped inputs exist. */
export const OWNER_CLIENT_IDS = ['bryan-balli-WUoltG84'];

export function assertOwnerClient(clientId) {
  if (!OWNER_CLIENT_IDS.includes(clientId)) {
    const err = new Error(`Daily loop is limited to the owner account during the POC; ${clientId || '(none)'} is not enabled.`);
    err.status = 403;
    throw err;
  }
}

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
