// 7-day unified calendar over social_posts (Active Content System §3f).
//
// Pure: rows in, grid out. No Firestore, no clock (`start` is explicit). The
// route reads the rows; the card renders this shape and re-derives nothing.
//
// Days are America/Chicago dates — the account's posting timezone — so a 23:30
// CT post is on that day, not the next UTC one.

import { DEFAULT_ENGINE_CONFIG } from './engine-quota.js';
import { ENGINE_IDS, isEngine } from './engines.js';

export const CALENDAR_TZ = 'America/Chicago';
export const WEEK_DAYS = 7;

/** Statuses that occupy a slot on the calendar. failed/expired never published. */
export const COUNTED_STATUSES = ['draft', 'approved', 'scheduled', 'queued', 'posting', 'posted', 'needs_review'];

const DAY_MS = 86_400_000;
const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: CALENDAR_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: CALENDAR_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

const ctDate = (ms) => dateFmt.format(new Date(ms));
const ctTime = (ms) => timeFmt.format(new Date(ms));

/** The 7 date keys starting at `start` (YYYY-MM-DD). Noon-UTC stepping keeps DST safe. */
export function weekDates(start) {
  const base = Date.parse(`${start}T12:00:00Z`);
  if (!Number.isFinite(base)) throw new Error('start must be YYYY-MM-DD');
  return Array.from({ length: WEEK_DAYS }, (_, i) => new Date(base + i * DAY_MS).toISOString().slice(0, 10));
}

function excerpt(text, max = 110) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function slotMs(post) {
  const iso = post?.scheduledAt || post?.postedAt || null;
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

/**
 * @param {object} input
 * @param {object[]} input.posts   social_posts rows (any window; filtered here)
 * @param {string} input.start     YYYY-MM-DD (CT) first day
 * @param {object} [input.config]  engine config (defaults to DEFAULT_ENGINE_CONFIG)
 */
export function buildWeekCalendar({ posts = [], start, config = DEFAULT_ENGINE_CONFIG } = {}) {
  const dates = weekDates(start);
  const cfg = config?.authored && config?.engines ? config : DEFAULT_ENGINE_CONFIG;
  const byDate = new Map(dates.map((d) => [d, []]));
  const unscheduled = [];

  for (const p of Array.isArray(posts) ? posts : []) {
    if (!p || !COUNTED_STATUSES.includes(p.status)) continue;
    if (p.replyTo) continue; // replies sit outside the authored cap
    const ms = slotMs(p);
    const row = {
      id: p.id ?? null,
      status: p.status,
      engine: isEngine(p.engine) ? p.engine : null,
      packageId: p.packageId ?? null,
      title: excerpt(p.title || p.content),
      content: typeof p.content === 'string' ? p.content : '',
      scheduledAt: p.scheduledAt ?? null,
      approvedAt: p.approvedAt ?? p.reviewedAt ?? null,
      needsReview: p.status === 'needs_review',
    };
    if (ms == null) {
      if (p.status === 'draft' || p.status === 'approved') unscheduled.push(row);
      continue;
    }
    const day = byDate.get(ctDate(ms));
    if (day) day.push({ ...row, ms, time: ctTime(ms) });
  }

  const weekCounts = Object.fromEntries(ENGINE_IDS.map((e) => [e, 0]));
  weekCounts.untagged = 0;
  const flags = [];

  const days = dates.map((date) => {
    const slots = byDate.get(date).sort((a, b) => a.ms - b.ms);
    const counts = Object.fromEntries(ENGINE_IDS.map((e) => [e, 0]));
    counts.untagged = 0;
    for (const s of slots) {
      const k = s.engine || 'untagged';
      counts[k] += 1;
      weekCounts[k] += 1;
    }

    const dayFlags = [];
    for (let i = 1; i < slots.length; i += 1) {
      const gapMin = Math.round((slots[i].ms - slots[i - 1].ms) / 60000);
      if (gapMin < cfg.authored.minSpacingMin) {
        dayFlags.push({ kind: 'spacing', date, message: `${slots[i - 1].time} and ${slots[i].time} are ${gapMin} min apart (min ${cfg.authored.minSpacingMin})` });
      }
    }
    if (slots.length > cfg.authored.capPerDay) {
      dayFlags.push({ kind: 'over-cap', date, message: `${slots.length} authored posts (cap ${cfg.authored.capPerDay})` });
    }
    for (const id of ENGINE_IDS) {
      const max = cfg.engines[id]?.maxPerDay;
      if (max != null && counts[id] > max) {
        dayFlags.push({ kind: 'engine-over-max', date, engine: id, message: `${id} ${counts[id]}/${max} per day` });
      }
    }
    flags.push(...dayFlags);

    return {
      date,
      total: slots.length,
      counts,
      flags: dayFlags,
      slots: slots.map(({ ms, ...s }) => s),
    };
  });

  const engines = {};
  for (const id of ENGINE_IDS) {
    const c = cfg.engines[id] ?? {};
    const entry = {
      week: weekCounts[id],
      weeklyMin: c.weeklyMin ?? null,
      weeklyMax: c.weeklyMax ?? null,
      maxPerDay: c.maxPerDay ?? null,
      minPerDay: c.minPerDay ?? null,
      targetPerDay: c.targetPerDay ?? null,
      belowWeeklyMin: c.weeklyMin != null && weekCounts[id] < c.weeklyMin,
    };
    if (entry.belowWeeklyMin) {
      flags.push({ kind: 'weekly-min', date: null, engine: id, message: `${id} ${weekCounts[id]}/${c.weeklyMin} for the week (weekly min)` });
    }
    engines[id] = entry;
  }

  return {
    start: dates[0],
    end: dates[dates.length - 1],
    tz: CALENDAR_TZ,
    config: { authored: cfg.authored },
    days,
    engines,
    weekTotal: days.reduce((n, d) => n + d.total, 0),
    untagged: weekCounts.untagged,
    unscheduled,
    flags,
  };
}
