// post-window.js — pure range/window math for the X Monitor posts panel.
// Client-safe: no node builtins, no Firestore, no network.

import { engagementRate } from './audience-diff.js';

const DAY_MS = 86_400_000;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Is `value` (epoch ms or ISO string) inside the range?
 * `range` is days (fractional ok; 0/falsy = all time) or `{ sinceMs }`.
 * A `{ sinceMs }` with no usable timestamp behaves like ALL.
 */
export function withinRange(value, range, now = Date.now()) {
  if (range && typeof range === 'object') {
    if (!Number.isFinite(range.sinceMs)) return true;
    const ms = typeof value === 'number' ? value : Date.parse(value || '');
    return Number.isFinite(ms) && ms >= range.sinceMs;
  }
  if (!range) return true;
  const ms = typeof value === 'number' ? value : Date.parse(value || '');
  if (!Number.isFinite(ms)) return false;
  return ms >= now - range * DAY_MS;
}

/** Totals over the posts inside `range`. impressions is null when none reported one. */
export function windowTotals(posts = [], range = 0, sync = null, now = Date.now()) {
  const spec = range === 'sync' ? { sinceMs: sync?.postsAt } : range;
  const rows = (posts || []).filter((p) => withinRange(p.createdAt, spec, now));
  const t = { posts: rows.length, impressions: 0, likes: 0, retweets: 0, replies: 0, quotes: 0, bookmarks: 0 };
  let anyImpressions = false;
  let impressionsOfCounted = 0;
  for (const p of rows) {
    const m = p.metrics || {};
    t.likes += num(m.likes);
    t.retweets += num(m.retweets);
    t.replies += num(m.replies);
    t.quotes += num(m.quotes);
    t.bookmarks += num(m.bookmarks);
    if (m.impressions != null && Number.isFinite(Number(m.impressions))) {
      anyImpressions = true;
      t.impressions += Number(m.impressions);
      impressionsOfCounted += Number(m.impressions);
    }
  }
  t.impressions = anyImpressions ? t.impressions : null;
  t.er = anyImpressions ? engagementRate({ ...t, impressions: impressionsOfCounted }) : null;
  return t;
}

/** "just now" / "5 min ago" / "3 h ago" / "2 d ago"; null for a bad timestamp. */
export function relativeTime(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return null;
  const diff = Math.max(0, now - ms);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}
