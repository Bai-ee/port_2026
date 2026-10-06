// Auto-scheduler for story-ready Discogs record drafts (series C1 'record-of-the-day').
//
// SLOT CHOICE (owner timezone America/Chicago, DST-aware):
//   09:00 CT is the primary slot, 19:00 CT the second (only used when perDay >= 2).
// Evidence:
//   - features/x-benchmark/build-calendar.js emits `original-showcase` (the type C1 fills,
//     see features/x-content-inventory/categories.js) at 09:00 and 19:00 CT in every day of
//     docs/audits/x-calendar-14day.json (14/14 days each).
//   - docs/plans/X-STRATEGY-SEB-MODEL.md daily slots: slot B 14:00 UTC (= 09:00 CDT) is
//     "original-showcase (video) - your best slot, best content".
//   - C1 perDay is 2 (categories.js); default here is 1/day, configurable up to that.
//   - The two slots are 10 h apart, so the 4 h record-to-record spacing always holds.
// Rules: never two records within 4 h; never stack within 60 min of ANY other scheduled
// post for the client; slots must be at least 15 min in the future.
//
// The planner is pure. The IO wrapper schedules via updateSocialPost (patches the SAME draft;
// schedulePost would create a duplicate row) which keeps the '[add your memory]' 409 guard.
import { DISCOGS_SOURCE } from './draft-builder.js';
import { SERIES } from '../x-content-inventory/categories.js';

export const OWNER_TIMEZONE = 'America/Chicago';
export const MEMORY_PLACEHOLDER = '[add your memory]';

export const DEFAULT_SCHEDULE_CONFIG = Object.freeze({
  timezone: OWNER_TIMEZONE,
  slotsLocal: ['09:00', '19:00'],
  perDay: 1,
  minRecordGapMs: 4 * 3600 * 1000,
  collisionWindowMs: 60 * 60 * 1000,
  minLeadMs: 15 * 60 * 1000,
  horizonDays: 21,
});

const ACTIVE = new Set(['scheduled', 'queued']);

function parts(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const o = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, min: +o.minute };
}

/** Local wall time in `tz` -> UTC ms (DST-safe; slots avoid the 02:00 gap). */
export function zonedTimeToUtcMs(y, m, d, h, min, tz) {
  const wall = Date.UTC(y, m - 1, d, h, min);
  let guess = wall;
  for (let i = 0; i < 3; i += 1) {
    const p = parts(new Date(guess), tz);
    const seen = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    guess += wall - seen;
  }
  return guess;
}

export function localDayKey(ms, tz) {
  const p = parts(new Date(ms), tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

export function isRecordReady(post) {
  if (!post || post.source !== DISCOGS_SOURCE || post.status !== 'draft') return false;
  if (post.needsStory !== false) return false;
  if (!post.mediaUrl) return false;
  const text = String(post.content || '');
  if (!text.trim() || text.toLowerCase().includes(MEMORY_PLACEHOLDER)) return false;
  return true;
}

/**
 * PURE. `posts` = every social_posts row for the client (drafts and scheduled).
 * Returns [{ postId, scheduledAt }] oldest draft first.
 */
export function planRecordSchedule({ posts = [], now = new Date(), config = {} } = {}) {
  const cfg = { ...DEFAULT_SCHEDULE_CONFIG, ...config };
  const perDay = Math.max(1, Math.min(cfg.perDay, SERIES.C1.perDay));
  const nowMs = new Date(now).getTime();

  const timeOf = (p) => Date.parse(p.scheduledAt);
  const occupied = posts.filter((p) => ACTIVE.has(p.status) && Number.isFinite(timeOf(p))).map(timeOf);
  const recordTimes = posts
    .filter((p) => p.source === DISCOGS_SOURCE && ACTIVE.has(p.status) && Number.isFinite(timeOf(p)))
    .map(timeOf);
  const perDayCount = new Map();
  for (const t of recordTimes) perDayCount.set(localDayKey(t, cfg.timezone), (perDayCount.get(localDayKey(t, cfg.timezone)) || 0) + 1);

  const candidates = posts.filter(isRecordReady)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id)));

  const today = parts(new Date(nowMs), cfg.timezone);
  function nextFreeSlot() {
    for (let dayOffset = 0; dayOffset <= cfg.horizonDays; dayOffset += 1) {
      // Date.UTC normalises overflow days/months for us.
      const base = new Date(Date.UTC(today.y, today.m - 1, today.d + dayOffset));
      const [y, m, d] = [base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate()];
      const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      for (const slot of cfg.slotsLocal) {
        if ((perDayCount.get(key) || 0) >= perDay) break;
        const [h, min] = slot.split(':').map(Number);
        const t = zonedTimeToUtcMs(y, m, d, h, min, cfg.timezone);
        if (t < nowMs + cfg.minLeadMs) continue;
        if (occupied.some((o) => Math.abs(o - t) < cfg.collisionWindowMs)) continue;
        if (recordTimes.some((o) => Math.abs(o - t) < cfg.minRecordGapMs)) continue;
        occupied.push(t);
        recordTimes.push(t);
        perDayCount.set(key, (perDayCount.get(key) || 0) + 1);
        return t;
      }
    }
    return null;
  }

  const plan = [];
  for (const post of candidates) {
    const t = nextFreeSlot();
    if (t == null) break; // horizon exhausted
    plan.push({ postId: post.id, scheduledAt: new Date(t).toISOString() });
  }
  return plan;
}

/**
 * IO wrapper. Loads the client's queue, plans, and (unless dryRun) patches each draft's
 * schedule in place. Never posts to X.
 */
export async function scheduleReadyRecords({ clientId, dryRun = false, now = new Date(), config = {} } = {}) {
  const { readSocialQueue, updateSocialPost } = await import('../social-posting/twitter-service.js');
  const posts = await readSocialQueue(clientId);
  const plan = planRecordSchedule({ posts, now, config });
  const byId = new Map(posts.map((p) => [p.id, p]));
  const notReady = posts
    .filter((p) => p.source === DISCOGS_SOURCE && p.status === 'draft' && !isRecordReady(p))
    .map((p) => ({
      postId: p.id,
      releaseId: p.sourceRef?.releaseId ?? null,
      reasons: [
        p.needsStory !== false && 'needsStory',
        String(p.content || '').toLowerCase().includes(MEMORY_PLACEHOLDER) && 'placeholder',
        !p.mediaUrl && 'noMedia',
      ].filter(Boolean),
    }));
  const scheduled = [];
  const errors = [];
  if (!dryRun) {
    for (const item of plan) {
      try {
        await updateSocialPost(clientId, item.postId, { scheduledAt: item.scheduledAt });
        scheduled.push(item);
      } catch (err) {
        errors.push({ ...item, error: err.message, status: err.status || 500 });
      }
    }
  }
  return {
    dryRun: Boolean(dryRun),
    clientId,
    plan: plan.map((i) => ({ ...i, releaseId: byId.get(i.postId)?.sourceRef?.releaseId ?? null })),
    scheduled,
    notReady,
    errors,
  };
}
