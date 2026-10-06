// Quota-aware auto-scheduler for story-ready Discogs record drafts (engine 'record').
// docs/plans/ACTIVE-CONTENT-SYSTEM-PLAN.md section 3 / Phase 2A.
//
// PLACEMENT (owner timezone America/Chicago, DST-aware). Per candidate, per local day:
//   - records that day (scheduled/queued/approved/posting/posted) < min(perDay, engines.record.maxPerDay)
//   - records stay <= engines.record.maxSharePct of that day's authored posts. The denominator is
//     max(authored posts + 1, authored.targetPerDay) so a quiet day is judged against its planned size.
//   - >= authored.minSpacingMin from EVERY other scheduled/approved/posting/posted authored post (any engine).
//   - time: owner preferred 09:00 / 19:00 CT first; otherwise the nearest valid 15-min time in 08:00-21:00 CT.
//   - entity cooldown: no record sharing an artist/label (normalized) within engines.record.entityCooldownDays.
// Nothing posts unless the owner wrote the story (needsStory:false, no '[add your memory]'), and a record
// whose package needs approval is skipped until approved.
//
// The planner is pure. The IO wrapper schedules via updateSocialPost (patches the SAME draft;
// schedulePost would create a duplicate row), which keeps the '[add your memory]' 409 guard.
import { DISCOGS_SOURCE, packageId } from './draft-builder.js';
import { mergeEngineConfig } from '../x-content-inventory/engine-quota.js';
import { needsApproval } from '../x-content-inventory/schema.js';

export const OWNER_TIMEZONE = 'America/Chicago';
export const MEMORY_PLACEHOLDER = '[add your memory]';

export const DEFAULT_SCHEDULE_CONFIG = Object.freeze({
  timezone: OWNER_TIMEZONE,
  preferredLocal: ['09:00', '19:00'],
  windowLocal: ['08:00', '21:00'],
  stepMin: 15,
  perDay: null, // null = engines.record.targetPerDay
  minLeadMs: 15 * 60 * 1000,
  horizonDays: 21,
});

// Statuses that occupy the calendar / count against quotas.
const OCCUPYING = new Set(['scheduled', 'queued', 'approved', 'posting', 'posted']);
const DAY_MS = 86_400_000;

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
  if (!post || post.source !== DISCOGS_SOURCE) return false;
  if (post.status !== 'draft' && !(post.status === 'approved' && !post.scheduledAt)) return false;
  if (post.needsStory !== false) return false;
  if (!post.mediaUrl) return false;
  const text = String(post.content || '');
  if (!text.trim() || text.toLowerCase().includes(MEMORY_PLACEHOLDER)) return false;
  return true;
}

const fmtLocal = (ms, tz) => {
  const p = parts(new Date(ms), tz);
  return `${String(p.h).padStart(2, '0')}:${String(p.min).padStart(2, '0')}`;
};
const hhmm = (s) => s.split(':').map(Number);

function postMs(p) {
  const t = Date.parse(p.status === 'posted' ? (p.postedAt || p.scheduledAt) : p.scheduledAt);
  return Number.isFinite(t) ? t : null;
}
const isReply = (p) => Boolean(p.replyTo) || p.kind === 'reply';
const isRecordPost = (p) => p.engine === 'record' || p.source === DISCOGS_SOURCE;
const packageIdOf = (p) => p.packageId || (p.source === DISCOGS_SOURCE && p.sourceRef?.releaseId != null ? packageId(p.sourceRef.releaseId) : null);

/** Normalized entity key (same shape store/match use): trimmed, NFKC, collapsed, lowercase. */
export function entityKey(e) {
  return String(e ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}
const keysOf = (pkg) => (Array.isArray(pkg?.entities) ? pkg.entities : []).map(entityKey).filter(Boolean);

/**
 * PURE. `posts` = every social_posts row for the client. `packages` = { [packageId]: package }
 * (used for entities + approval). Returns { scheduled: [{postId, releaseId, scheduledAt, reason}],
 * skipped: [{postId, releaseId, reasons[]}] }, oldest draft first.
 */
export function planRecordSchedule({ posts = [], packages = {}, now = new Date(), config = {} } = {}) {
  const cfg = { ...DEFAULT_SCHEDULE_CONFIG, ...config };
  const eng = mergeEngineConfig(config.engineConfig);
  const rec = eng.engines.record;
  const tz = cfg.timezone;
  const perDay = Math.max(1, Math.min(Number.isInteger(cfg.perDay) ? cfg.perDay : (rec.targetPerDay ?? 1), rec.maxPerDay ?? 2));
  const spacingMs = eng.authored.minSpacingMin * 60_000;
  const sharePct = rec.maxSharePct ?? 100;
  const cooldownDays = rec.entityCooldownDays ?? 0;
  const nowMs = new Date(now).getTime();

  // Calendar occupancy: [{ ms, record }] for every authored post that holds a slot.
  const occupied = [];
  // Cooldown ledger: record-engine posts -> { ms, keys, id }.
  const ledger = [];
  for (const p of posts) {
    if (!OCCUPYING.has(p.status) || isReply(p)) continue;
    const ms = postMs(p);
    if (ms == null) continue;
    occupied.push({ ms, record: isRecordPost(p) });
    if (isRecordPost(p)) {
      const pid = packageIdOf(p);
      ledger.push({ ms, id: pid, keys: keysOf(packages[pid]) });
    }
  }
  for (const [pid, pkg] of Object.entries(packages)) {
    const ms = Date.parse(pkg?.lastPostedAt ?? '');
    if (Number.isFinite(ms) && (pkg.engine === 'record' || pid.startsWith('discogs-'))) ledger.push({ ms, id: pid, keys: keysOf(pkg), fromPackage: true });
  }

  const candidates = posts.filter(isRecordReady)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id)));

  const [wsH, wsM] = hhmm(cfg.windowLocal[0]);
  const [weH, weM] = hhmm(cfg.windowLocal[1]);
  const today = parts(new Date(nowMs), tz);

  function dayTimes(y, m, d) {
    const start = zonedTimeToUtcMs(y, m, d, wsH, wsM, tz);
    const end = zonedTimeToUtcMs(y, m, d, weH, weM, tz);
    const pref = cfg.preferredLocal.map((s) => { const [h, mi] = hhmm(s); return zonedTimeToUtcMs(y, m, d, h, mi, tz); });
    const out = [];
    for (let t = start; t <= end; t += cfg.stepMin * 60_000) out.push(t);
    for (const t of pref) if (!out.includes(t)) out.push(t);
    const dist = (t) => Math.min(...pref.map((q) => Math.abs(q - t)));
    return { times: out.sort((a, b) => dist(a) - dist(b) || a - b), pref };
  }

  const scheduled = [];
  const skipped = [];
  for (const post of candidates) {
    const releaseId = post.sourceRef?.releaseId ?? null;
    const pid = packageIdOf(post);
    const pkg = packages[pid];
    if (pkg && needsApproval(pkg) && post.status !== 'approved') {
      skipped.push({ postId: post.id, releaseId, reasons: ['needs approval before it can be scheduled'] });
      continue;
    }
    const keys = keysOf(pkg);
    let placed = null;
    const blockers = [];
    for (let dayOffset = 0; dayOffset <= cfg.horizonDays && !placed; dayOffset += 1) {
      const base = new Date(Date.UTC(today.y, today.m - 1, today.d + dayOffset));
      const [y, m, d] = [base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate()];
      const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const todays = occupied.filter((o) => localDayKey(o.ms, tz) === key);
      const recs = todays.filter((o) => o.record).length;
      if (recs >= perDay) { blockers.push(`${key}: record cap ${recs}/${perDay}`); continue; }
      const share = Math.round(((recs + 1) / Math.max(todays.length + 1, eng.authored.targetPerDay)) * 100);
      if (share > sharePct) { blockers.push(`${key}: record share would be ${share}% (max ${sharePct}%)`); continue; }
      const { times, pref } = dayTimes(y, m, d);
      let why = null;
      for (const t of times) {
        if (t < nowMs + cfg.minLeadMs) { why = why || 'time already past'; continue; }
        const near = occupied.find((o) => Math.abs(o.ms - t) < spacingMs);
        if (near) { why = why || `within ${eng.authored.minSpacingMin} min of another post at ${fmtLocal(near.ms, tz)} CT`; continue; }
        const clash = cooldownDays && ledger.find((l) => l.id !== pid && Math.abs(l.ms - t) < cooldownDays * DAY_MS && l.keys.some((k) => keys.includes(k)));
        if (clash) { blockers.push(`${key}: entity cooldown (${cooldownDays}d) - shares "${clash.keys.find((k) => keys.includes(k))}" with a record near ${new Date(clash.ms).toISOString().slice(0, 10)}`); why = null; times.length = 0; break; }
        placed = { t, key, recs, todays: todays.length, preferred: pref.includes(t), share };
        break;
      }
      if (!placed && why) blockers.push(`${key}: no valid time in window (${why})`);
    }
    if (!placed) {
      skipped.push({ postId: post.id, releaseId, reasons: blockers.length ? blockers.slice(0, 4) : ['no free day inside the horizon'] });
      continue;
    }
    occupied.push({ ms: placed.t, record: true });
    ledger.push({ ms: placed.t, id: pid, keys });
    const when = `${placed.key} ${fmtLocal(placed.t, tz)} CT`;
    scheduled.push({
      postId: post.id,
      releaseId,
      scheduledAt: new Date(placed.t).toISOString(),
      reason: `scheduled ${when} (${placed.preferred ? 'owner preferred slot' : 'nearest valid time to 09:00/19:00 in 08:00-21:00 window'}): `
        + `${placed.recs}/${perDay} records and ${placed.todays} authored post(s) already that day, record share ${placed.share}% <= ${sharePct}%, `
        + `>= ${eng.authored.minSpacingMin} min from other posts, no ${cooldownDays}d entity clash.`,
    });
  }
  return { scheduled, skipped };
}

/**
 * IO wrapper. Loads the client's queue + packages, plans, and (unless dryRun) patches each draft's
 * schedule in place. Never posts to X. `deps` is injectable for tests.
 */
export async function scheduleReadyRecords({ clientId, dryRun = false, now = new Date(), config = {}, deps = {} } = {}) {
  const readSocialQueue = deps.readSocialQueue || (await import('../social-posting/twitter-service.js')).readSocialQueue;
  const updateSocialPost = deps.updateSocialPost || (await import('../social-posting/twitter-service.js')).updateSocialPost;
  const getPackage = deps.getPackage || (await import('../x-content-inventory/store.js')).getPackage;
  const posts = await readSocialQueue(clientId);
  const ids = [...new Set(posts.filter((p) => isRecordPost(p) && (OCCUPYING.has(p.status) || isRecordReady(p))).map(packageIdOf).filter(Boolean))];
  const packages = {};
  for (const id of ids) {
    const pkg = await getPackage(id);
    if (pkg) packages[id] = pkg;
  }
  const { scheduled: plan, skipped } = planRecordSchedule({ posts, packages, now, config });
  const notReady = posts
    .filter((p) => p.source === DISCOGS_SOURCE && (p.status === 'draft' || p.status === 'approved') && !p.scheduledAt && !isRecordReady(p))
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
  return { dryRun: Boolean(dryRun), clientId, plan, scheduled, skipped, notReady, errors };
}
