// Filler for the daily reply minimum (slot R): the live conversation most worth joining.
// Decides which narrative, or why none; never judges brand fit (select.js pre-filters
// narratives with brandFitApplies('reply')) and never writes the reply.
// Pure; depends on config only.

import { REPLY_WINDOW_HOURS } from './config.js';

/** A reply needs a thread still inside the early-reply window; highest momentum wins. */
export function fillReplySlot({ slot, narratives = [], now }) {
  // Re-age at `now`: narratives may have been grouped earlier than this fill.
  const ageOf = (n) => {
    const t = Date.parse(n?.anchor?.createdAt ?? '');
    return now != null && Number.isFinite(t) ? Math.round(((now - t) / 3_600_000) * 10) / 10 : n?.momentum?.ageHours ?? null;
  };
  const live = narratives
    .filter((n) => ageOf(n) != null && ageOf(n) <= REPLY_WINDOW_HOURS)
    .sort((a, b) => b.momentum.score - a.momentum.score || String(a.id).localeCompare(String(b.id)));
  const best = live[0];
  if (!best) {
    const reason = narratives.length
      ? `no conversation inside the ${REPLY_WINDOW_HOURS}h reply window (${narratives.length} older)`
      : 'no live conversation to reply to';
    return { slot, gap: { code: `slot-unfilled:${slot.letter}`, reason } };
  }
  return {
    slot, narrative: best, anchor: best.anchor,
    matchScore: best.momentum.score,
    matchReason: `anchor is ${ageOf(best)}h old, inside the ${REPLY_WINDOW_HOURS}h reply window`,
  };
}
