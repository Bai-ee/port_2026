// Pure model for the Day view's daily baseline slots (awareness markers from the confirmed strategy doc; see
// features/x-strategy/daily-slots.js). Display only: nothing here schedules or fills a slot.
//
// A slot is FILLED when a post / draft / suggestion on that day sits within ±SLOT_MATCH_MIN of it, else OPEN.
// Each row fills at most one slot. When the slot's track is known, a same-track row is preferred and a row from a
// DIFFERENT known track never fills it; rows without a track can fill any slot. Requote targets are not posts yet,
// so they never fill a slot.

export const SLOT_MATCH_MIN = 60;

const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** 'HH:MM' -> minutes after midnight, or null. */
export function minutesOf(time) {
  const m = TIME_RE.exec(String(time ?? '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * @param {{slots?:Array<{time:string,minutes:number,track:string,trackId:string|null,note:string}>}|null} baseline
 * @param {Array<{id:string,time?:string,kind?:string,trackId?:string|null}>} rows  every row on the day (unfiltered)
 * @returns {Array<{time:string,minutes:number,track:string,trackId:string|null,note:string,state:'filled'|'open',matchedId:string|null}>}
 */
export function baselineSlotStates(baseline, rows) {
  const slots = Array.isArray(baseline?.slots) ? baseline.slots : [];
  const pool = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.kind !== 'requote')
    .map((r) => ({ id: r.id, min: minutesOf(r.time), trackId: r.trackId ?? null }))
    .filter((r) => r.min != null);
  const used = new Set();
  return [...slots].sort((a, b) => a.minutes - b.minutes).map((slot) => {
    const best = pool
      .filter((r) => !used.has(r.id) && Math.abs(r.min - slot.minutes) <= SLOT_MATCH_MIN)
      .filter((r) => !slot.trackId || !r.trackId || r.trackId === slot.trackId)
      .map((r) => ({ ...r, rank: (slot.trackId && r.trackId === slot.trackId ? 0 : 1) * 10_000 + Math.abs(r.min - slot.minutes) }))
      .sort((a, b) => a.rank - b.rank)[0];
    if (best) used.add(best.id);
    return { ...slot, state: best ? 'filled' : 'open', matchedId: best?.id ?? null };
  });
}

/** The once-a-day replies reminder ("5+ replies today"), or null when the baseline has none. */
export function repliesReminder(baseline) {
  const min = baseline?.replies?.min;
  return Number.isInteger(min) && min > 0 ? `${min}+ replies today` : null;
}
