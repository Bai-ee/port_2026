// Hot picks on the calendar. Pure: the calendar reader, daily-fill and the daily loop read ONLY marketingBrief.hotQuotes
// (the legacy watchlist quoteTargets feed no longer reaches them; its data stays stored for the agent / other UIs).
//
// A refresh REPLACES hotQuotes wholesale, so "the latest refresh's picks replace the previous unacted ones" is automatic:
// picks the owner already acted on live on as saved posts, picks he passed are in `hotQuotes.dismissed`.

import { QUOTES_PER_DAY, DEFAULT_QUOTE_SLOT_TIMES } from './hot-config.js';
import { localDay } from './hot-scan.js';

const HOUR = 3_600_000;
const DEFAULT_WINDOW_HOURS = 36;

export const windowHoursOf = (t) => (Number.isFinite(Number(t?.windowHours)) && Number(t.windowHours) > 0 ? Number(t.windowHours) : DEFAULT_WINDOW_HOURS);

/**
 * Open hot picks (not passed, window still open, best rank first) in the calendar quote-target shape.
 * @param {object|null} hotQuotes  raw marketingBrief.hotQuotes
 */
export function hotPicksToTargets(hotQuotes, { now = Date.now() } = {}) {
  const dismissed = new Set((Array.isArray(hotQuotes?.dismissed) ? hotQuotes.dismissed : []).map(String));
  const picks = [...(hotQuotes?.picks?.design || []), ...(hotQuotes?.picks?.music || [])];
  return picks
    .filter((p) => p && p.id && p.url && !dismissed.has(String(p.id)))
    .filter((p) => Date.parse(p.createdAt || '') + windowHoursOf(p) * HOUR > now)
    .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
    .map((p) => ({
      id: String(p.id), url: p.url, text: p.text, handle: p.author || null, author: p.author || null, authorName: p.authorName ?? null,
      createdAt: p.createdAt, trackId: null, hasMedia: Boolean(p.mediaUrl), mediaUrl: p.mediaUrl ?? null, windowHours: windowHoursOf(p),
      hot: { lane: p.lane, momentum: p.momentum, fit: p.fit, angle: p.angle, why: p.why },
    }));
}

const STATUS_ID_RE = /status\/(\d+)/;
/**
 * Current unacted hot picks for the agent's next_post quote slots: open picks (not passed, window open) minus those the owner
 * already acted on (a non-rejected saved post that quotes them, by sourceRef / fillSource / URL in the text).
 * @param {object|null} hotQuotes raw marketingBrief.hotQuotes
 * @param {object[]} posts raw social_posts rows (may be empty)
 */
export function unactedHotPicks(hotQuotes, posts, { now = Date.now() } = {}) {
  const acted = new Set();
  for (const p of Array.isArray(posts) ? posts : []) {
    if (!p || p.status === 'rejected') continue;
    const ref = p.sourceRef && typeof p.sourceRef === 'object' ? p.sourceRef : null;
    if (ref?.kind === 'quote-target') { if (ref.id != null) acted.add(String(ref.id)); const u = STATUS_ID_RE.exec(String(ref.url ?? ''))?.[1]; if (u) acted.add(u); }
    if (p.fillSource?.type === 'quote-target' && p.fillSource.id != null) acted.add(String(p.fillSource.id));
    for (const m of String(p.content ?? '').matchAll(/https:\/\/(?:x|twitter)\.com\/\w+\/status\/(\d+)/gi)) acted.add(m[1]);
  }
  return hotPicksToTargets(hotQuotes, { now }).filter((t) => !acted.has(t.id));
}

/** The daily loop's `scan` input from hot picks: same shape as a stored quoteTargets payload ({generatedAt, candidates}). */
export function hotScanForLoop(hotQuotes, { now = Date.now() } = {}) {
  if (!hotQuotes?.scannedAt) return null;
  return {
    generatedAt: hotQuotes.scannedAt,
    candidates: hotPicksToTargets(hotQuotes, { now }).map((t) => ({
      id: t.id, url: t.url, author: t.author, authorName: t.authorName, text: t.text, createdAt: t.createdAt, hasMedia: t.hasMedia,
      mediaUrl: t.mediaUrl, windowHours: t.windowHours, vein: t.hot.lane, score: t.hot.fit, reasons: t.hot.why ? [t.hot.why] : [],
    })),
  };
}

/** Quote slot times (CT 'HH:MM', ascending) from the baseline slots: those whose note says quote; else the defaults. */
export function quoteSlotTimes(baselineSlots) {
  const times = (Array.isArray(baselineSlots?.slots) ? baselineSlots.slots : []).filter((s) => /quote/i.test(`${s.note || ''}`)).map((s) => s.time);
  return times.length ? times : [...DEFAULT_QUOTE_SLOT_TIMES];
}

/** Quotes still allowed today: the scan's own count when it ran today (CT), minus quote posts saved today since; never above the daily cap. */
export function quotesLeftToday(hotQuotes, { quotePostsToday = 0, now = Date.now() } = {}) {
  const scanToday = hotQuotes?.scannedAt && localDay(Date.parse(hotQuotes.scannedAt)) === localDay(now);
  const fromScan = scanToday && Number.isFinite(hotQuotes.quotesLeftToday) ? hotQuotes.quotesLeftToday : QUOTES_PER_DAY;
  return Math.max(0, Math.min(fromScan, QUOTES_PER_DAY - quotePostsToday));
}

/**
 * Put each open pick on the next open baseline quote slot, the rest are 'extra'. Slots already used today (quotes posted)
 * are skipped in order. Adds { slotTime, slotKind: 'baseline'|'extra', quotesLeftToday } to each target.
 */
export function assignQuoteSlots(targets, { slotTimes = DEFAULT_QUOTE_SLOT_TIMES, quotesPostedToday = 0, left = QUOTES_PER_DAY } = {}) {
  const open = slotTimes.slice(Math.min(Math.max(0, quotesPostedToday), slotTimes.length));
  return (targets || []).map((t, i) => ({
    ...t,
    slotTime: open[i] || null,
    slotKind: open[i] ? 'baseline' : 'extra',
    quotesLeftToday: left,
  }));
}
