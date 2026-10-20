// "Time to post" alerts for the daily baseline slots (strategy doc Formats, Chicago time). Pure: the scheduler feeds it
// today's calendar day + the parsed slots and enqueues what it returns. A slot that already has a post near it is skipped:
// that post gets the regular handoff card (with its media), so the owner is never told twice about one slot.
import { escapeHtml, localToMs } from './handoff.js';

export const SLOT_TZ = 'America/Chicago';
export const SLOT_COVER_MS = 45 * 60000; // a post within 45 min of the slot time fills it
const QUOTE_RE = /quote/i;
const DONE = new Set(['rejected', 'failed']);

export const isQuoteSlot = (slot) => QUOTE_RE.test(`${slot?.track || ''} ${slot?.note || ''}`);

/** Epoch ms of an "HH:MM" Chicago slot on `date` (YYYY-MM-DD); null for a time skipped by a clock change. */
export function slotMs(date, time) {
  const [year, month, day] = String(date).split('-').map(Number);
  const [hour, minute] = String(time).split(':').map(Number);
  return localToMs({ year, month, day, hour, minute }, SLOT_TZ);
}

/** Calendar rows that are real posts (not display-only suggestions / requotes) and still count. */
const postRows = (day) => (day?.posts || []).filter((r) => r && r.kind !== 'suggestion' && r.kind !== 'requote' && !DONE.has(r.status));

/** True when a post already sits within SLOT_COVER_MS of the slot. */
export function slotCovered(day, ms) {
  return postRows(day).some((r) => Number.isFinite(r.ms) && Math.abs(r.ms - ms) <= SLOT_COVER_MS);
}

/** The hot pick for a quote slot: the one the calendar assigned to this slot time, else the best open one. */
export function quotePickFor(day, slot) {
  const picks = (day?.posts || []).filter((r) => r?.kind === 'requote');
  const r = picks.find((p) => p.time === slot.time) || picks[0];
  if (!r) return null;
  return {
    id: r.quoteTargetId, url: r.quotedUrl, handle: r.quotedHandle || r.handle || null, text: String(r.quotedText || r.text || ''),
    momentum: r.hot?.momentum || null, why: r.hot?.why || null, quotesLeftToday: r.quotesLeftToday ?? null,
  };
}

/** Today's open daily-loop suggestion for the slot's track (by track id, else label), or null. */
export function suggestionFor(suggestions, slot) {
  const open = (suggestions || []).filter((s) => s?.state === 'open');
  const label = String(slot?.track || '').trim().toLowerCase();
  return open.find((s) => slot?.trackId && s.track === slot.trackId)
    || open.find((s) => label && String(s.trackLabel || '').trim().toLowerCase() === label)
    || null;
}

/**
 * Slots due for an alert now: slot time in (now, now + leadMinutes], not already covered by a post.
 * @returns {Array<{dedupKey:string, date:string, time:string, track:string, note:string, quote:boolean, at:string}>}
 */
export function dueSlotAlerts({ clientId, day, slots, now, leadMinutes }) {
  if (!day?.date) return [];
  const out = [];
  for (const slot of slots || []) {
    const ms = slotMs(day.date, slot.time);
    if (ms == null || ms <= now || ms - now > leadMinutes * 60000) continue;
    if (slotCovered(day, ms)) continue;
    out.push({
      dedupKey: `slot:${clientId}:${day.date}:${slot.time.replace(':', '')}`,
      date: day.date, time: slot.time, track: slot.track, trackId: slot.trackId ?? null, note: slot.note || '', quote: isQuoteSlot(slot),
      at: new Date(ms).toISOString(),
    });
  }
  return out;
}

const hhmm12 = (time) => {
  const [h, m] = String(time).split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

/** Header message for a slot alert. `pick` (quote slot) / `suggestion` (other slots) may be null. */
export function slotAlertHtml(alert, { pick = null, suggestion = null } = {}) {
  const lines = [`<b>Time to post: ${escapeHtml(hhmm12(alert.time))} CT</b>`, `${escapeHtml(alert.track)}${alert.note ? `: ${escapeHtml(alert.note)}` : ''}`];
  if (alert.quote) {
    if (pick) {
      lines.push(`Quote @${escapeHtml(String(pick.handle || '').replace(/^@/, ''))}${pick.momentum ? ` (${escapeHtml(pick.momentum)})` : ''}: ${escapeHtml(pick.url)}`);
      if (pick.text) lines.push(`<blockquote>${escapeHtml(pick.text.slice(0, 280))}</blockquote>`);
      if (pick.why) lines.push(`Why: ${escapeHtml(String(pick.why).slice(0, 160))}`);
      if (pick.quotesLeftToday != null) lines.push(`Quotes left today: ${pick.quotesLeftToday}`);
      lines.push('Write your comment and quote it on X.');
    } else {
      lines.push('No open hot picks. Run Hot now in HITLOOP to find one, or skip this slot.');
    }
  } else if (suggestion) {
    lines.push('Nothing scheduled yet. Today\'s suggestion for this slot is below.');
  } else {
    lines.push('Nothing drafted for this slot.');
  }
  return lines.join('\n');
}
