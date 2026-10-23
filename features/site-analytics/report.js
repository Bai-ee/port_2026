// report.js - builds the site stats for a beaconed site (today: Underground Existence) from site_analytics/{site}/events.
// The shape follows the client-site /api/stats contract the client MCP already reads (analytics.meta / range /
// dailyTrend / sources / pages / live, leads + applicants null when the site has none), so get_site_stats and
// get_daily_update work unchanged; beacon-only extras (visitors, clicks, mix plays, geo, devices) sit alongside.

import { SITES, EVENTS_COLLECTION } from './events.js';

export const REPORT_RANGES = Object.freeze(['today', '24h', '7d', '30d']);
const DAY_MS = 86_400_000;
const LIVE_MS = 60 * 60_000;
const PAGE = 1000;
export const SCAN_MAX = 20_000;
export const MAX_CUSTOM_DAYS = 90;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A window the caller asked for that cannot be served; the message is safe to show. */
export class RangeRequestError extends Error {
  constructor(message) { super(message); this.name = 'RangeRequestError'; this.expose = true; }
}

export const DEFINITIONS = Object.freeze({
  visitors: 'Distinct browsers (a random id kept in the browser\'s localStorage). Cleared storage, private windows or a second device count again.',
  sessions: 'Distinct visits. A visit ends after 30 minutes idle and is shared across tabs of the same browser.',
  engagedVisitPct: 'Visits with an engagement (15 seconds on a page or half a page scrolled), a click or a mix play, as a percentage of visits.',
  bounceRate: 'Visits that viewed exactly one page and did nothing else (no engagement, click or play), as a percentage of visits.',
  pagesPerSession: 'Page views divided by visits.',
  sessionDuration: 'Time between a visit\'s first and last event; a minimum, since time on the last page is not recorded. Single-event visits are left out.',
  sources: '"campaign:<utm_source>" when the link carried UTM tags, else "referral:<site>" from the referrer, else "direct" (typed, bookmarked, or the app hid the referrer). Counted once per visit, from its first page.',
  mixPlays: 'A mix starting on the site player (resume after pause is not counted again).',
  leads: 'This site has no forms, leads or applicants; those fields are null.',
});

// ---- time helpers (site-local calendar days) ---------------------------------------------------------------

function localParts(ms, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return p;
}
export const localDate = (ms, timeZone) => { const p = localParts(ms, timeZone); return `${p.year}-${p.month}-${p.day}`; };
const offsetAt = (ms, timeZone) => { const p = localParts(ms, timeZone); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000; };
/** UTC instant of 00:00 site time on a YYYY-MM-DD date. */
export function localMidnight(ymd, timeZone) {
  const guess = Date.parse(`${ymd}T00:00:00Z`);
  // Two passes so a DST change between the guess and the real midnight still lands on 00:00 local.
  const first = guess - offsetAt(guess, timeZone);
  return guess - offsetAt(first, timeZone);
}
const shiftDate = (ymd, days) => new Date(Date.parse(`${ymd}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** range (today | 24h | 7d | 30d) or from/to (YYYY-MM-DD in the site timezone, inclusive, at most 90 days, not future). */
export function resolveWindow(range, now, timeZone, { from, to } = {}) {
  if (from || to) {
    if (!DATE_RE.test(String(from)) || !DATE_RE.test(String(to))) throw new RangeRequestError('from and to must both be YYYY-MM-DD dates.');
    if (from > to) throw new RangeRequestError('from must be on or before to.');
    if (to > localDate(now, timeZone)) throw new RangeRequestError('to cannot be in the future.');
    const days = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY_MS) + 1;
    if (days > MAX_CUSTOM_DAYS) throw new RangeRequestError(`A custom range can cover at most ${MAX_CUSTOM_DAYS} days.`);
    return { key: 'custom', start: localMidnight(from, timeZone), end: Math.min(localMidnight(shiftDate(to, 1), timeZone), now), days, timeZone };
  }
  if (range === '24h') return { key: '24h', start: now - DAY_MS, end: now, days: 1, timeZone };
  const days = range === 'today' ? 1 : range === '30d' ? 30 : 7;
  const first = shiftDate(localDate(now, timeZone), -(days - 1));
  return { key: range, start: localMidnight(first, timeZone), end: now, days, timeZone };
}

// ---- Firestore read --------------------------------------------------------------------------------------

/** Newest-first pages back to `since` (no range filter, so no composite index). Also returns the first-ever event time. */
export async function readEvents(db, site, since) {
  const col = db.collection(EVENTS_COLLECTION(site));
  const out = [];
  let last = null;
  let truncated = false;
  for (;;) {
    if (out.length >= SCAN_MAX) { truncated = true; break; }
    let q = col.orderBy('ts', 'desc').limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    let done = snap.docs.length < PAGE;
    for (const d of snap.docs) {
      const e = d.data();
      if (typeof e.ts === 'number' && e.ts < since) { done = true; break; }
      out.push(e);
    }
    if (done) break;
    last = snap.docs.at(-1);
  }
  let firstTs = null;
  try {
    const first = await col.orderBy('ts', 'asc').limit(1).get();
    firstTs = first.docs[0]?.data()?.ts ?? null;
  } catch { /* optional */ }
  return { events: out, truncated, firstTs };
}

// ---- aggregation -----------------------------------------------------------------------------------------

const bump = (map, k, by = 1) => { if (k) map.set(k, (map.get(k) || 0) + by); };
const topRows = (map, n, key, valueKey) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ [key]: k, [valueKey]: v }));
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

/** 'campaign:<utm>' | 'referral:<host>' | 'direct' (same labels as the client-site contract). */
export const sourceOf = (e) => (e.utmSource ? `campaign:${e.utmSource}` : e.refHost ? `referral:${e.refHost}` : 'direct');

const rangeKey = (range) => (REPORT_RANGES.includes(range) ? range : '7d');
const windowJson = (win) => ({ key: win.key, startIso: new Date(win.start).toISOString(), endIso: new Date(win.end).toISOString(), days: win.days, timezone: win.timeZone });

export function buildReport(allEvents, { site, range = '7d', from, to, now, testMode = false, truncated = false, firstTs = null }) {
  const cfg = SITES[site];
  const timeZone = cfg.timeZone;
  const win = resolveWindow(rangeKey(range), now, timeZone, { from, to });
  const mode = (e) => Boolean(e.test) === testMode;
  const rows = allEvents.filter((e) => typeof e?.ts === 'number' && e.ts >= win.start && e.ts <= win.end + 60_000 && mode(e)).sort((a, b) => a.ts - b.ts);

  const visitors = new Set();
  const sessions = new Map(); // sid -> { events: [], pageviews, active }
  const byDay = new Map();
  const pages = new Map(); const pageSessions = new Map();
  const clicks = new Map(); const outbound = new Map(); const plays = new Map(); const playSessions = new Map();
  const countries = new Map(); const cities = new Map(); const devices = new Map(); const sources = new Map(); const referrers = new Map();
  let pageviews = 0;

  const dayRow = (d) => { if (!byDay.has(d)) byDay.set(d, { date: d, pageviews: 0, sessions: new Set(), visitors: new Set(), engaged: new Set() }); return byDay.get(d); };

  for (const e of rows) {
    visitors.add(e.vid);
    const day = dayRow(localDate(e.ts, timeZone));
    day.sessions.add(e.sid); day.visitors.add(e.vid);
    let s = sessions.get(e.sid);
    if (!s) {
      s = { first: e.ts, last: e.ts, pageviews: 0, active: false };
      sessions.set(e.sid, s);
      // Source from the visit's first page; a visit whose first event is not a page view began before the window.
      bump(sources, e.type === 'pageview' ? sourceOf(e) : 'unknown (visit began before this range)');
      bump(referrers, e.ref);
      bump(countries, e.country || 'unknown');
      bump(cities, e.city ? [e.city, e.region, e.country].filter(Boolean).join(', ') : null);
      bump(devices, e.device || 'unknown');
    }
    s.last = e.ts;
    if (e.type === 'pageview') {
      pageviews += 1; day.pageviews += 1; s.pageviews += 1;
      bump(pages, e.path);
      if (!pageSessions.has(e.path)) pageSessions.set(e.path, new Set());
      pageSessions.get(e.path).add(e.sid);
    } else {
      s.active = true; day.engaged.add(e.sid);
      if (e.type === 'click') {
        bump(clicks, JSON.stringify([e.label || '(no label)', e.href || null, e.kind || null]));
        if (e.kind === 'outbound' && e.href) { try { bump(outbound, new URL(e.href).hostname.replace(/^www\./, '')); } catch { /* ignore */ } }
      } else if (e.type === 'play') {
        const mix = e.label || '(unknown mix)';
        bump(plays, mix);
        if (!playSessions.has(mix)) playSessions.set(mix, new Set());
        playSessions.get(mix).add(e.sid);
      }
    }
  }

  const all = [...sessions.values()];
  const bounced = all.filter((s) => s.pageviews === 1 && !s.active).length;
  const engaged = all.filter((s) => s.active).length;
  const spans = all.filter((s) => s.last > s.first).map((s) => Math.round((s.last - s.first) / 1000));

  const live = allEvents.filter((e) => typeof e?.ts === 'number' && e.ts >= now - LIVE_MS && e.ts <= now + 60_000 && mode(e));
  const status = firstTs == null ? 'no_data_yet' : rows.length ? 'ok' : 'zero_activity';

  const analytics = {
    meta: { status, generatedAt: new Date(now).toISOString(), trackingStartDate: firstTs ? new Date(firstTs).toISOString() : null, testMode, degraded: [], eventsTruncated: truncated },
    range: windowJson(win),
    pageviews,
    sessions: sessions.size,
    visitors: visitors.size,
    engagedVisitPct: pct(engaged, sessions.size),
    bouncedSessions: bounced,
    bounceRatePct: pct(bounced, sessions.size),
    pagesPerSession: sessions.size ? Math.round((pageviews / sessions.size) * 100) / 100 : null,
    sessionDuration: { measuredSessions: spans.length, medianSeconds: median(spans), meanSeconds: spans.length ? Math.round(spans.reduce((a, b) => a + b, 0) / spans.length) : null, note: DEFINITIONS.sessionDuration },
    dailyTrend: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({ date: d.date, pageviews: d.pageviews, sessions: d.sessions.size, visitors: d.visitors.size, engagedSessions: d.engaged.size })),
    sources: topRows(sources, 20, 'source', 'sessions'),
    referrers: topRows(referrers, 15, 'url', 'sessions'),
    pages: [...pages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([route, n]) => ({ route, pageviews: n, sessions: pageSessions.get(route).size })),
    clicks: [...clicks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, n]) => { const [label, href, kind] = JSON.parse(k); return { label, href, kind, clicks: n }; }),
    outboundLinks: topRows(outbound, 15, 'host', 'clicks'),
    mixPlays: [...plays.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([mix, n]) => ({ mix, plays: n, sessions: playSessions.get(mix).size })),
    countries: topRows(countries, 20, 'country', 'sessions'),
    cities: topRows(cities, 20, 'city', 'sessions'),
    devices: topRows(devices, 5, 'device', 'sessions'),
    live: { windowMinutes: 60, startIso: new Date(now - LIVE_MS).toISOString(), endIso: new Date(now).toISOString(), pageviews: live.filter((e) => e.type === 'pageview').length, sessions: new Set(live.map((e) => e.sid)).size },
  };

  return { site: new URL(cfg.url).hostname, generatedAt: new Date(now).toISOString(), range: win.key, analytics, leads: null, applicants: null, definitions: DEFINITIONS, degraded: [] };
}

/** One call: read the window from Firestore and build the report. */
export async function getSiteReport({ db, site, range = '7d', from, to, now, testMode = false }) {
  if (!SITES[site]) throw new Error(`Unknown site "${site}".`);
  const win = resolveWindow(rangeKey(range), now, SITES[site].timeZone, { from, to });
  const { events, truncated, firstTs } = await readEvents(db, site, Math.min(win.start, now - LIVE_MS));
  return buildReport(events, { site, range, from, to, now, testMode, truncated, firstTs });
}

// ---- per-visit paths (same envelope as the client-site /api/stats/sessions) --------------------------------

export const SESSIONS_DEFAULT_LIMIT = 25;
export const SESSIONS_MAX_LIMIT = 100;
const MAX_TRAIL_EVENTS = 40;

function toPath(sid, list) {
  const views = list.filter((e) => e.type === 'pageview');
  const first = list[0];
  const startedBeforeWindow = first.type !== 'pageview';
  const trail = list.slice(0, MAX_TRAIL_EVENTS).map((e) => {
    const step = { at: new Date(e.ts).toISOString(), event: e.type, route: e.path || null };
    if (e.label) step.label = e.label;
    if (e.href && e.type === 'click') step.href = e.href;
    return step;
  });
  return {
    sid,
    visitor: first.vid,
    startedAt: new Date(first.ts).toISOString(),
    endedAt: new Date(list.at(-1).ts).toISOString(),
    durationSeconds: Math.round((list.at(-1).ts - first.ts) / 1000),
    source: startedBeforeWindow ? null : sourceOf(first),
    startedBeforeWindow,
    entryRoute: views[0]?.path ?? null,
    exitRoute: views.at(-1)?.path ?? null,
    pageviews: views.length,
    engaged: list.some((e) => e.type !== 'pageview'),
    bounced: views.length === 1 && list.every((e) => e.type === 'pageview'),
    mixPlays: list.filter((e) => e.type === 'play').map((e) => e.label || '(unknown mix)'),
    location: [first.city, first.region, first.country].filter(Boolean).join(', ') || null,
    device: first.device || null,
    trail,
    trailTruncated: list.length > MAX_TRAIL_EVENTS,
  };
}

export function buildSessionPaths(allEvents, { site, range = '24h', from, to, now, limit = SESSIONS_DEFAULT_LIMIT, truncated = false, testMode = false }) {
  const cfg = SITES[site];
  const win = resolveWindow(REPORT_RANGES.includes(range) ? range : '24h', now, cfg.timeZone, { from, to });
  const bySession = new Map();
  for (const e of allEvents.filter((x) => typeof x?.ts === 'number' && x.ts >= win.start && x.ts <= win.end + 60_000 && Boolean(x.test) === testMode).sort((a, b) => a.ts - b.ts)) {
    if (!bySession.has(e.sid)) bySession.set(e.sid, []);
    bySession.get(e.sid).push(e);
  }
  const n = Math.min(Math.max(Number(limit) || SESSIONS_DEFAULT_LIMIT, 1), SESSIONS_MAX_LIMIT);
  const paths = [...bySession].map(([sid, list]) => toPath(sid, list)).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, n);
  return {
    site: new URL(cfg.url).hostname,
    generatedAt: new Date(now).toISOString(),
    range: windowJson(win),
    totalSessions: bySession.size,
    returned: paths.length,
    sessions: paths,
    eventsTruncated: truncated,
    note: 'A session is one visit, ending after 30 minutes idle. "visitor" is a random id kept in that browser: the same id on two sessions is the same browser coming back. It is never linked to a name or contact.',
  };
}

export async function getSessionPaths({ db, site, range = '24h', from, to, now, limit, testMode = false }) {
  if (!SITES[site]) throw new Error(`Unknown site "${site}".`);
  const win = resolveWindow(REPORT_RANGES.includes(range) ? range : '24h', now, SITES[site].timeZone, { from, to });
  const { events, truncated } = await readEvents(db, site, win.start);
  return buildSessionPaths(events, { site, range, from, to, now, limit, truncated, testMode });
}
