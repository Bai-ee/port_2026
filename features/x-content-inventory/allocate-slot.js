// Shared slot allocator (pure, no I/O, no Date.now). docs/plans/content-management-audit.md "Scheduling / slots".
// One place that answers "may this candidate take this time?" so producers stop re-implementing spacing/caps.
// The Discogs records scheduler imports the shared pieces below (OCCUPYING, postMs, isReply, findSpacingConflict,
// localDayKey, zonedTimeToUtcMs) instead of keeping its own copies.
//
// Not covered here (still scheduler/match.js business): entity cooldown and evergreen recycle windows.
import { mergeEngineConfig } from './engine-quota.js';
import { findPackageCollision } from '../social-posting/lifecycle.js';

export const OWNER_TIMEZONE = 'America/Chicago';
/** Statuses that hold a calendar slot / count against quotas. */
export const OCCUPYING = new Set(['scheduled', 'queued', 'approved', 'posting', 'posted']);
const DAY_MS = 86_400_000;

function parts(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const o = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, min: +o.minute };
}
export { parts as zonedParts };

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

/** The instant a row holds on the calendar (postedAt for posted rows), or null. */
export function postMs(p) {
  const t = Date.parse(p.status === 'posted' ? (p.postedAt || p.scheduledAt) : p.scheduledAt);
  return Number.isFinite(t) ? t : null;
}
export const isReply = (p) => Boolean(p.replyTo) || p.kind === 'reply';

/** First occupied entry (`{ ms }`) closer than `spacingMs` to `t`, else undefined. */
export function findSpacingConflict(occupied, t, spacingMs) {
  return occupied.find((o) => Math.abs(o.ms - t) < spacingMs);
}

/** Every authored (non-reply) row that holds a slot, as `{ ms, post }`. */
export function occupiedEntries(posts) {
  const out = [];
  for (const p of posts || []) {
    if (!p || !OCCUPYING.has(p.status) || isReply(p)) continue;
    const ms = postMs(p);
    if (ms != null) out.push({ ms, post: p });
  }
  return out;
}

const fmt = (ms) => new Date(ms).toISOString();

/**
 * @param {object} a
 * @param {object[]} a.posts      the client's full social_posts queue
 * @param {{id?:string,packageId?:string,engine?:string,entities?:string[],expiresAt?:string|number}} a.candidate
 * @param {string|number|Date} a.desiredAt
 * @param {object} [a.config]     { minSpacingMin, perDay, stepMin, horizonDays, minLeadMs, engineConfig }
 * @param {number|Date} a.now     injected clock
 * @param {string} [a.tz]
 * @returns {{ok:true, scheduledAt:string, reasons:string[]} | {ok:false, blockers:{code:string,message:string}[]}}
 */
export function allocatePostSlot({ posts = [], candidate = {}, desiredAt, config = {}, now, tz } = {}) {
  const nowMs = new Date(now).getTime();
  const desiredMs = new Date(desiredAt).getTime();
  if (!Number.isFinite(nowMs)) return { ok: false, blockers: [{ code: 'invalid-now', message: 'A valid "now" is required.' }] };
  if (!Number.isFinite(desiredMs)) return { ok: false, blockers: [{ code: 'invalid-desired-time', message: 'desiredAt is not a valid time.' }] };

  const zone = tz || config.timezone || OWNER_TIMEZONE;
  const eng = mergeEngineConfig(config.engineConfig);
  const spacingMin = Number.isFinite(config.minSpacingMin) ? config.minSpacingMin : eng.authored.minSpacingMin;
  const spacingMs = spacingMin * 60_000;
  const perDay = Number.isInteger(config.perDay) ? config.perDay : eng.authored.capPerDay;
  const stepMs = (Number.isFinite(config.stepMin) && config.stepMin > 0 ? config.stepMin : 15) * 60_000;
  const horizonMs = (Number.isFinite(config.horizonDays) ? config.horizonDays : 7) * DAY_MS;
  const minLeadMs = Number.isFinite(config.minLeadMs) ? config.minLeadMs : 0;

  const collision = findPackageCollision(posts, { packageId: candidate.packageId, selfId: candidate.id ?? null });
  if (collision) {
    return { ok: false, blockers: [{ code: 'package-already-pending', message: `Package ${candidate.packageId} already has an open copy (${collision.id}, ${collision.status}).` }] };
  }

  const expiresMs = candidate.expiresAt == null ? null : new Date(candidate.expiresAt).getTime();
  const hasExpiry = Number.isFinite(expiresMs);
  if (hasExpiry && expiresMs <= nowMs) {
    return { ok: false, blockers: [{ code: 'opportunity-expired', message: `Opportunity expired at ${fmt(expiresMs)}.` }] };
  }

  const occupied = occupiedEntries(posts);
  const engine = candidate.engine || null;
  const engCfg = engine ? eng.engines[engine] : null;
  const engineOf = (p) => (p.engine === 'record' || p.source === 'discogs-ingest' ? 'record' : p.engine);

  const earliest = Math.max(desiredMs, nowMs + minLeadMs);
  const limit = desiredMs + horizonMs;
  const desiredLocal = parts(new Date(desiredMs), zone);
  let last = null; // most recent reason a time was rejected
  for (let t = earliest; t <= limit; t += stepMs) {
    if (hasExpiry && t >= expiresMs) {
      return { ok: false, blockers: [{ code: 'opportunity-expired', message: `No free slot before the opportunity expires at ${fmt(expiresMs)}.${last ? ` Last conflict: ${last.message}` : ''}` }] };
    }
    const key = localDayKey(t, zone);
    const todays = occupied.filter((o) => localDayKey(o.ms, zone) === key);
    if (todays.length >= perDay) {
      last = { code: 'per-day-cap', message: `${key}: ${todays.length}/${perDay} authored posts already that day.` };
      // Retry the same local time of day on the next local day.
      const cur = parts(new Date(t), zone);
      t = zonedTimeToUtcMs(cur.y, cur.m, cur.d + 1, desiredLocal.h, desiredLocal.min, zone) - stepMs;
      continue;
    }
    if (engCfg) {
      const same = todays.filter((o) => engineOf(o.post) === engine).length;
      if (engCfg.maxPerDay != null && same >= engCfg.maxPerDay) {
        last = { code: 'engine-cap', message: `${key}: ${engine} engine ${same}/${engCfg.maxPerDay} already that day.` };
        continue;
      }
      if (engCfg.maxSharePct != null) {
        const share = Math.round(((same + 1) / Math.max(todays.length + 1, eng.authored.targetPerDay)) * 100);
        if (share > engCfg.maxSharePct) {
          last = { code: 'engine-share', message: `${key}: ${engine} share would be ${share}% (max ${engCfg.maxSharePct}%).` };
          continue;
        }
      }
    }
    const near = findSpacingConflict(occupied, t, spacingMs);
    if (near) {
      last = { code: 'spacing-violation', message: `Within ${spacingMin} min of another post at ${fmt(near.ms)}.` };
      continue;
    }
    const reasons = t === desiredMs ? [] : [`moved from ${fmt(desiredMs)}${last ? `: ${last.message}` : ''}`];
    return { ok: true, scheduledAt: fmt(t), reasons };
  }
  const l = last || { code: 'no-slot', message: 'No free slot inside the horizon.' };
  return { ok: false, blockers: [{ code: l.code, message: l.message }] };
}

/**
 * Adapter: queue rows -> the `recentPosts` shape engine-quota/match expect ({engine, postedAt, entities}).
 * engine-quota counts only rows with a postedAt, so occupying rows are mapped with their calendar instant
 * (postedAt for posted rows, scheduledAt otherwise). Rows without a known time or engine, replies and
 * non-occupying statuses are dropped. Times are returned on engine-quota's axis (CT wall clock as UTC epoch).
 */
export function recentPostsFromQueue(posts, { tz = 'America/Chicago' } = {}) {
  // engine-quota buckets by the CT calendar date read as UTC midnight (slot times are CT wall minutes), so each
  // real instant is shifted onto that axis: the CT wall clock expressed as a UTC epoch.
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const wallAsUtc = (ms) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  };
  return occupiedEntries(posts).map(({ ms, post }) => ({
    engine: post.engine === 'record' || post.source === 'discogs-ingest' ? 'record' : post.engine,
    postedAt: wallAsUtc(ms),
    ...(Array.isArray(post.entities) ? { entities: post.entities } : {}),
  })).filter((r) => r.engine);
}
