// Telegram command center — read models (track B).
//
// Read-only assembly of what the bot shows: the saved brief, the current
// quote-target scan, the social queue and the 7-day calendar. Everything is
// injected (db, brief/queue/calendar readers) so this module never reaches into
// globals. It never calls an LLM, a paid search or a refresh.

import { ctDate, addDays, buildMonthCalendar as defaultBuildMonthCalendar } from '../x-content-inventory/month-calendar.js';

export { ctDate, addDays };

const WEEK_DAYS = 7;

const nowMsOf = (now) => {
  const v = typeof now === 'function' ? now() : now;
  if (v instanceof Date) return v.getTime();
  return Number.isFinite(v) ? v : Date.now();
};

const dismissedIds = (dismissed) => new Set(
  (Array.isArray(dismissed) ? dismissed : [])
    .map((d) => (d && typeof d === 'object' ? d.id : d))
    .filter(Boolean)
    .map(String),
);

const newestFirst = (a, b) => (Date.parse(b?.updatedAt || b?.createdAt || '') || 0) - (Date.parse(a?.updatedAt || a?.createdAt || '') || 0);
const soonestFirst = (a, b) => (Date.parse(a?.scheduledAt || '') || Infinity) - (Date.parse(b?.scheduledAt || '') || Infinity);

/** Group queue rows into the buckets the bot cares about. Pure. */
export function groupQueue(rows) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const by = (pred) => list.filter(pred);
  return {
    needsReview: by((p) => p.status === 'needs_review').sort(newestFirst),
    awaitingApproval: by((p) => p.status === 'awaiting_approval').sort(soonestFirst),
    drafts: by((p) => p.status === 'draft').sort(newestFirst),
    failed: by((p) => p.status === 'failed' || p.status === 'expired').sort(newestFirst),
    manual: by((p) => p.status === 'manual').sort(soonestFirst),
  };
}

export function createReadModels(deps = {}) {
  const {
    db, getBriefForClient, readSocialQueue, buildMonthCalendar = defaultBuildMonthCalendar,
    readEngineConfig, getDigestConfig, getSocialPost, now,
  } = deps;

  async function readQuoteTargets(clientId) {
    if (!db) return { generatedAt: null, candidates: [] };
    try {
      const snap = await db.collection('dashboard_state').doc(clientId).get();
      const qt = snap.exists ? snap.data()?.marketingBrief?.quoteTargets : null;
      if (!qt) return { generatedAt: null, candidates: [] };
      const gone = dismissedIds(qt.dismissed);
      const candidates = (Array.isArray(qt.candidates) ? qt.candidates : []).filter((c) => c && !gone.has(String(c.id)));
      return { generatedAt: qt.generatedAt || null, candidates };
    } catch {
      return { generatedAt: null, candidates: [] };
    }
  }

  async function readTimezone(clientId) {
    try {
      const cfg = await getDigestConfig?.(clientId);
      const tz = cfg?.schedule?.timezone;
      return typeof tz === 'string' && tz ? tz : 'America/Chicago';
    } catch {
      return 'America/Chicago';
    }
  }

  async function loadBriefing(clientId) {
    let brief = null;
    try { brief = await getBriefForClient?.(clientId); } catch { brief = null; }
    const intel = brief?.intel && typeof brief.intel === 'object' ? brief.intel : null;
    const [quoteTargets, rows, tz] = await Promise.all([
      readQuoteTargets(clientId),
      Promise.resolve(readSocialQueue?.(clientId)).then((r) => r || []).catch(() => []),
      readTimezone(clientId),
    ]);
    return {
      clientId,
      clientName: brief?.clientName || null,
      intel,
      quoteTargets,
      queue: groupQueue(rows),
      tz,
      freshness: { briefAt: intel?.generatedAt || null, scanAt: quoteTargets.generatedAt || null },
    };
  }

  /** 7 days starting today (CT). Builds two months when the week crosses a month end. */
  async function loadCalendar(clientId, { now: nowOverride } = {}) {
    const nowMs = nowMsOf(nowOverride ?? now);
    const [config, rows] = await Promise.all([
      Promise.resolve(readEngineConfig?.(clientId)).catch(() => undefined),
      Promise.resolve(readSocialQueue?.(clientId)).then((r) => r || []),
    ]);
    const today = ctDate(nowMs);
    const dates = Array.from({ length: WEEK_DAYS }, (_, i) => addDays(today, i));
    const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
    const byDate = new Map();
    let cfg = null;
    let unplaced = [];
    for (const month of months) {
      const cal = buildMonthCalendar({ posts: rows, month, now: nowMs, config });
      cfg = cfg || cal.config;
      if (month === months[0]) unplaced = cal.unplaced || [];
      for (const week of cal.weeks) for (const day of week) {
        // Prefer the month that owns the date (proposals are identical either way).
        if (day.inMonth || !byDate.has(day.date)) byDate.set(day.date, day);
      }
    }
    const week = dates.map((d) => byDate.get(d)).filter(Boolean);
    return { today, week, tz: 'America/Chicago', config: cfg, unplaced };
  }

  async function loadAccountHandle(clientId) {
    if (!db) return null;
    try {
      const snap = await db.collection('social_accounts').doc(clientId).get();
      const u = snap.exists ? snap.data()?.platforms?.x?.username : null;
      return typeof u === 'string' && u.trim() ? u.trim().replace(/^@+/, '') : null;
    } catch {
      return null;
    }
  }

  async function loadPost(clientId, postId) {
    if (typeof getSocialPost === 'function') return (await getSocialPost(clientId, postId)) || null;
    const rows = (await readSocialQueue?.(clientId)) || [];
    return rows.find((p) => p && String(p.id) === String(postId)) || null;
  }

  return { loadBriefing, loadCalendar, loadAccountHandle, loadPost };
}
