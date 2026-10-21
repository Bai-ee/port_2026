// "Right now" projection for the Today card: which daily baseline slot is current/next, whether it is filled, the one
// next action, and how fresh the data behind it is. Pure: the route feeds it today's calendar day (a grid day with `.posts`
// rows), the baseline slots and the freshness timestamps. Slot coverage / quote picks reuse telegram/slot-alerts.js.
import { SLOT_TZ, slotMs, slotCovered, isQuoteSlot, quotePickFor, SLOT_COVER_MS } from '../telegram/slot-alerts.js';

export const SLOT_WINDOW_AFTER_MS = 120 * 60000; // a slot stays "current" this long after its time
const FRESHNESS = [
  { id: 'posts', label: 'Post metrics', staleAfterHours: 24, key: 'postsAt' },
  { id: 'hot-picks', label: 'Hot picks', staleAfterHours: 6, key: 'hotPicksAt' },
  { id: 'quote-targets', label: 'Quote targets', staleAfterHours: 24, key: 'quoteTargetsAt' },
];
const PRECEDENCE = ['posted', 'scheduled', 'approved', 'draft', 'suggested', 'pick', 'empty'];
const COVERED = new Set(['posted', 'scheduled', 'approved']);

const rowState = (r) => {
  if (r.state === 'posted') return 'posted';
  if (r.state === 'scheduled' || r.state === 'manual') return 'scheduled';
  if (r.state === 'approved') return 'approved';
  return 'draft'; // pending | awaiting | held | failed all need the owner
};
const rank = (s) => PRECEDENCE.indexOf(s);

function localTimeOf(now, tz) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(now));
}

function freshnessOf(freshness, now) {
  return FRESHNESS.map((f) => {
    const raw = freshness?.[f.key] ?? null;
    const ms = raw == null ? NaN : (typeof raw === 'number' ? raw : Date.parse(raw));
    const asOf = Number.isFinite(ms) ? new Date(ms).toISOString() : null;
    return { id: f.id, label: f.label, asOf, staleAfterHours: f.staleAfterHours, stale: asOf == null || now - ms > f.staleAfterHours * 3600000 };
  });
}

function projectSlot(slot, day, ms) {
  const base = { time: slot.time, track: slot.track || '', ms };
  const open = { kind: 'open-calendar', ref: null };
  if (ms == null) return { ...base, state: 'empty', item: null, action: { label: 'Open calendar', ...open } };
  // Best real post near the slot (slotCovered decides what counts; precedence picks which one shows).
  const posts = (day?.posts || []).filter((r) => r?.kind === 'post' && slotCovered({ posts: [r] }, ms));
  const best = posts.sort((a, b) => rank(rowState(a)) - rank(rowState(b)))[0];
  if (best) {
    const state = rowState(best);
    const item = { kind: 'post', id: best.id, title: best.title || '', link: best.permalink || null, status: best.status, revision: best.revision ?? null };
    if (state === 'draft') {
      const approvable = best.status === 'draft' || best.status === 'awaiting_approval';
      return { ...base, state, item, action: approvable ? { label: 'Approve', kind: 'approve', ref: { postId: best.id, expectedRevision: best.revision ?? null } } : { label: 'Open editor', kind: 'open-editor', ref: { postId: best.id } } };
    }
    return { ...base, state, item, action: { label: 'Open calendar', kind: 'none', ref: null } };
  }
  if (isQuoteSlot(slot)) {
    const pick = quotePickFor(day, slot);
    const picks = (day?.posts || []).filter((r) => r?.kind === 'requote').length;
    if (pick) return { ...base, state: 'pick', picks, item: { kind: 'requote', id: pick.id, title: pick.text.slice(0, 80), link: pick.url || null }, action: { label: 'Pick a quote', kind: 'pick-quote', ref: { quoteTargetId: pick.id } } };
  }
  const sug = (day?.posts || []).find((r) => r?.kind === 'suggestion' && (r.slot?.timeCT === slot.time || (Number.isFinite(r.ms) && Math.abs(r.ms - ms) <= SLOT_COVER_MS)));
  if (sug) return { ...base, state: 'suggested', item: { kind: 'suggestion', id: sug.suggestionId || sug.id, title: sug.title || '' }, action: { label: 'Review suggestion', ...open } };
  return { ...base, state: 'empty', item: null, action: { label: 'Open calendar', ...open } };
}

function headlineOf(slots, focus, now) {
  if (focus == null) return slots.some((s) => s.ms != null && s.ms + SLOT_WINDOW_AFTER_MS > now) ? 'All slots covered' : 'No more slots today';
  const s = slots[focus];
  const head = `${s.time} ${s.track || 'Slot'}`;
  if (s.state === 'draft') return s.action.kind === 'approve' ? `${head} — draft ready, approve it` : `${head} — draft needs attention`;
  if (s.state === 'suggested') return `${head} — suggestion ready, review it`;
  if (s.state === 'pick') return `${s.time} quote slot empty — pick from ${s.picks} hot pick${s.picks === 1 ? '' : 's'}`;
  return `${head} — nothing drafted`;
}

/**
 * @returns {{nowIso:string, tz:string, localTime:string, slots:object[], current:number|null, next:number|null, focus:number|null,
 *   headline:string, action:object|null, freshness:object[]}}
 */
export function projectNow({ day, baselineSlots, hotQuotes: _hotQuotes = null, now, tz = SLOT_TZ, freshness } = {}) {
  const date = day?.date;
  const slots = (baselineSlots?.slots || []).map((s) => projectSlot(s, day, date ? slotMs(date, s.time) : null));
  let current = null;
  slots.forEach((s, i) => {
    if (s.ms != null && now >= s.ms - SLOT_COVER_MS && now < s.ms + SLOT_WINDOW_AFTER_MS) current = i; // latest matching wins
  });
  const nextIdx = slots.findIndex((s) => s.ms != null && s.ms > now);
  const next = nextIdx < 0 ? null : nextIdx;
  // Focus = first slot not yet over that still needs something from the owner.
  const focusIdx = slots.findIndex((s) => s.ms != null && s.ms + SLOT_WINDOW_AFTER_MS > now && !COVERED.has(s.state));
  const focus = focusIdx < 0 ? null : focusIdx;
  return {
    nowIso: new Date(now).toISOString(), tz, localTime: localTimeOf(now, tz),
    slots: slots.map(({ ms: _ms, ...s }) => s), current, next, focus,
    headline: headlineOf(slots, focus, now), action: focus == null ? null : slots[focus].action,
    freshness: freshnessOf(freshness, now),
  };
}
