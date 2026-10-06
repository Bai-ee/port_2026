// Engine-quota layer — decides which ENGINE each authored slot draws from,
// before any package is matched (docs/plans/ACTIVE-CONTENT-SYSTEM-PLAN.md §3b).
//
// WHY: `buildCalendar` decides WHEN and WHAT TYPE; `matchDay` decides WHICH
// PACKAGE. Neither knows that a day should not be four record posts, or that
// original thinking must never be crowded out. This sits between them and
// reserves supply lines first, so the match step only has to fill them.
//
// Pure + deterministic: no fs, no network, no clock (callers inject `now`).
// Same inputs always give the same allocation, so a plan can be re-derived and
// audited. The config is plain data so it can later come from Firestore
// (`content_system_config/x`) via `mergeEngineConfig` with no code change.

import { ENGINE_IDS, SERIES_ENGINE } from './engines.js';
import { SERIES } from './categories.js';

/** Owner-approved STARTING config — tune from data after ~4 weeks. */
export const DEFAULT_ENGINE_CONFIG = {
  authored: {
    targetPerDay: 4,
    capPerDay: 6,
    // Cold-start window: a post's first ~2h decide its reach, and an author's
    // 2nd post in one feed scores x0.5. Spaced posts beat bunched ones.
    minSpacingMin: 120,
  },
  engines: {
    // Protected floor: original thinking is never crowded out.
    identity: { minPerDay: 1, maxPerDay: 2, targetPerDay: 1, evergreenRecycleDays: 90 },
    record: {
      minPerDay: 0, maxPerDay: 2, targetPerDay: 1,
      maxSharePct: 40, entityCooldownDays: 30, evergreenRecycleDays: 180,
    },
    ue: { maxPerDay: 1, weeklyMin: 3, weeklyMax: 4, evergreenRecycleDays: 90 },
    client: { maxPerDay: 1, weeklyMin: 3, weeklyMax: null, evergreenRecycleDays: 90 },
  },
};

/**
 * Compat bridge: map bucket `share` fields onto the legacy engine config
 * shape (`mergeEngineConfig` overrides). Buckets whose id is not an engine id
 * are ignored for now (the planner still allocates per engine); an inactive
 * bucket gets maxPerDay 0. With DEFAULT_BUCKETS the merged result equals
 * DEFAULT_ENGINE_CONFIG, so passing buckets later changes nothing until the
 * owner edits a share. Feed the result to `mergeEngineConfig`.
 */
export function bucketsToEngineConfig(buckets) {
  const engines = {};
  if (!Array.isArray(buckets)) return { engines };
  for (const b of buckets) {
    if (!b || !ENGINE_IDS.includes(b.id)) continue;
    const s = b.share || {};
    const o = {};
    if (s.perDayMin !== undefined) o.minPerDay = s.perDayMin;
    if (s.perDayMax !== undefined) o.maxPerDay = s.perDayMax;
    if (s.targetPerDay !== undefined) o.targetPerDay = s.targetPerDay;
    if (s.perWeekMin !== undefined) o.weeklyMin = s.perWeekMin;
    if (s.perWeekMax !== undefined) o.weeklyMax = s.perWeekMax;
    if (s.maxSharePct !== undefined) o.maxSharePct = s.maxSharePct;
    if (b.active === false) { o.minPerDay = 0; o.maxPerDay = 0; o.targetPerDay = 0; }
    if (Object.keys(o).length) engines[b.id] = o;
  }
  return { engines };
}

/** Slot types the daily scan / ledger fill. They are identity by definition. */
export const DYNAMIC_SLOT_TYPES = ['quote-react', 'quote-commentary', 'self-quote'];

/** Tie-break order when two engines are equally needy: the scarce, bounded
 * engines first so the high-volume record engine only wins on merit. */
const ENGINE_TIEBREAK = ['client', 'ue', 'identity', 'record'];

const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isCount = (v) => Number.isInteger(v) && v >= 0;

const FIELD_RULES = {
  minPerDay: isCount,
  maxPerDay: isCount,
  targetPerDay: isCount,
  weeklyMin: isCount,
  weeklyMax: (v) => v === null || isCount(v),
  maxSharePct: (v) => Number.isFinite(v) && v >= 0 && v <= 100,
  entityCooldownDays: isCount,
  evergreenRecycleDays: isCount,
};

const AUTHORED_RULES = {
  targetPerDay: (v) => isCount(v) && v >= 1,
  capPerDay: (v) => isCount(v) && v >= 1,
  minSpacingMin: isCount,
};

/**
 * Deep-merge overrides onto the defaults. Invalid values, unknown engines and
 * unknown keys are ignored (the default stands), so a bad Firestore doc can
 * never produce an unplannable config. A min above its max is also rejected.
 */
export function mergeEngineConfig(overrides) {
  const cfg = JSON.parse(JSON.stringify(DEFAULT_ENGINE_CONFIG));
  if (!isObj(overrides)) return cfg;

  if (isObj(overrides.authored)) {
    for (const [k, rule] of Object.entries(AUTHORED_RULES)) {
      if (k in overrides.authored && rule(overrides.authored[k])) cfg.authored[k] = overrides.authored[k];
    }
    if (cfg.authored.targetPerDay > cfg.authored.capPerDay) cfg.authored.targetPerDay = cfg.authored.capPerDay;
  }

  if (isObj(overrides.engines)) {
    for (const id of ENGINE_IDS) {
      const o = overrides.engines[id];
      if (!isObj(o)) continue;
      const next = { ...cfg.engines[id] };
      for (const [k, rule] of Object.entries(FIELD_RULES)) {
        if (k in o && rule(o[k])) next[k] = o[k];
      }
      const minOk = (min, max) => max == null || (min ?? 0) <= max;
      if (!minOk(next.minPerDay, next.maxPerDay) || !minOk(next.weeklyMin, next.weeklyMax)) continue;
      cfg.engines[id] = next;
    }
  }
  return cfg;
}

function minutesOf(timeCT) {
  const [h, m] = String(timeCT ?? '12:00').split(':').map(Number);
  return (Number.isFinite(h) ? h : 12) * 60 + (Number.isFinite(m) ? m : 0);
}

function fmt(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** Engines that can serve a slot type, derived from the series data so the
 * mapping cannot drift from categories.js. */
export function enginesForSlotType(type) {
  const out = new Set();
  for (const [key, s] of Object.entries(SERIES)) {
    if (s.slotTypes.includes(type)) out.add(SERIES_ENGINE[key] ?? 'identity');
  }
  if (DYNAMIC_SLOT_TYPES.includes(type)) out.add('identity');
  return ENGINE_IDS.filter((e) => out.has(e));
}

/**
 * Assign an engine to every authored slot.
 *
 * Clock convention matches plan-day.js: slot `timeCT` and post times are read
 * on the same wall-clock axis (the UTC fields), and `date` is YYYY-MM-DD.
 *
 * @param {object} input
 * @param {object[]} input.slots        calendar slots for ONE day (timeCT, type)
 * @param {object} [input.config]       from mergeEngineConfig; defaults if omitted
 * @param {{engine:string, postedAt:string|number}[]} [input.recentPosts]
 * @param {number} [input.now]          epoch ms
 * @param {string} [input.date]         YYYY-MM-DD; defaults to now's UTC date
 * @returns {{ slots: object[], counts: object, weekly: object, warnings: string[] }}
 *   each slot gains `engine` (null when skipped), `engineReason`, and — when
 *   spacing pushed it later — `timeCT` rewritten with `calendarTimeCT` kept.
 */
export function allocateEngines(input = {}) {
  const config = input.config ?? DEFAULT_ENGINE_CONFIG;
  const slotsIn = Array.isArray(input.slots) ? input.slots : [];
  const recent = Array.isArray(input.recentPosts) ? input.recentPosts : [];
  const now = Number.isFinite(input.now) ? input.now : Date.now();
  const date = input.date ?? new Date(now).toISOString().slice(0, 10);
  const dayStart = Date.parse(`${date}T00:00:00Z`);
  const dayEnd = dayStart + DAY_MS;
  const weekStart = dayEnd - WEEK_DAYS * DAY_MS;
  const warnings = [];

  const dayCount = Object.fromEntries(ENGINE_IDS.map((e) => [e, 0]));
  const weekCount = Object.fromEntries(ENGINE_IDS.map((e) => [e, 0]));
  let lastPostMin = null;
  for (const p of recent) {
    const t = typeof p?.postedAt === 'number' ? p.postedAt : Date.parse(p?.postedAt ?? '');
    if (!Number.isFinite(t) || !ENGINE_IDS.includes(p.engine)) continue;
    if (t >= weekStart && t < dayEnd) weekCount[p.engine] += 1;
    if (t >= dayStart && t < dayEnd) {
      dayCount[p.engine] += 1;
      const min = Math.floor((t - dayStart) / 60_000);
      lastPostMin = lastPostMin == null ? min : Math.max(lastPostMin, min);
    }
  }
  const postedToday = Object.values(dayCount).reduce((a, b) => a + b, 0);

  // 1. Order chronologically (stable), then enforce the daily cap and the
  //    spacing. Spacing shifts a slot LATER; a slot pushed past midnight is
  //    skipped rather than silently double-booked.
  const ordered = slotsIn
    .map((s, i) => ({ s, i, min: minutesOf(s.timeCT) }))
    .sort((a, b) => a.min - b.min || a.i - b.i);

  const spacing = config.authored.minSpacingMin;
  const room = Math.max(0, config.authored.capPerDay - postedToday);
  let prev = lastPostMin;
  const work = ordered.map((o, n) => {
    if (n >= room) return { ...o, skip: `over the daily cap of ${config.authored.capPerDay}` };
    const earliest = prev == null ? o.min : Math.max(o.min, prev + spacing);
    if (earliest > 23 * 60 + 59) return { ...o, skip: `no room left in the day at ${spacing}min spacing` };
    prev = earliest;
    return { ...o, at: earliest };
  });

  const live = work.filter((w) => !w.skip);
  const totalAuthored = postedToday + live.length;
  const assigned = new Map(); // index -> { engine, reason }

  const take = (w, engine, reason) => {
    assigned.set(w.i, { engine, reason });
    dayCount[engine] += 1;
    weekCount[engine] += 1;
  };
  const cfgOf = (e) => config.engines[e] ?? {};
  const dayOpen = (e) => dayCount[e] < (cfgOf(e).maxPerDay ?? Infinity);
  const weekOpen = (e) => cfgOf(e).weeklyMax == null || weekCount[e] < cfgOf(e).weeklyMax;
  const shareOpen = (e) => {
    const pct = cfgOf(e).maxSharePct;
    if (pct == null) return true;
    // Strict: floor, so records can never exceed the share, even on small days.
    return dayCount[e] + 1 <= Math.floor((pct / 100) * totalAuthored);
  };

  // 2. Dynamic slots (scan / ledger) are identity by definition.
  for (const w of live) {
    if (!DYNAMIC_SLOT_TYPES.includes(w.s.type)) continue;
    if (dayOpen('identity')) take(w, 'identity', `${w.s.type} slot is filled from the scan/ledger, so it is identity`);
    else w.skip = `identity is at its max of ${cfgOf('identity').maxPerDay}/day`;
  }

  // 3. Protected identity floor: if the day has no identity yet, claim a
  //    compatible open slot (prefer the earliest) before anyone else can.
  const idMin = cfgOf('identity').minPerDay ?? 0;
  while (dayCount.identity < idMin) {
    const w = live.find((x) => !x.skip && !assigned.has(x.i) && enginesForSlotType(x.s.type).includes('identity'));
    if (!w || !dayOpen('identity')) {
      warnings.push(`identity floor of ${idMin}/day unmet: no compatible open slot`);
      break;
    }
    take(w, 'identity', `protected identity floor (min ${idMin}/day)`);
  }

  // 4. Everything else, most-constrained slot first (fewest compatible
  //    engines) so a text-only slot is not stranded by a flexible one.
  const open = live
    .filter((w) => !w.skip && !assigned.has(w.i))
    .map((w) => ({ w, compat: enginesForSlotType(w.s.type) }))
    .sort((a, b) => a.compat.length - b.compat.length || a.w.i - b.w.i);

  for (const { w, compat } of open) {
    const cands = compat.filter((e) => dayOpen(e) && weekOpen(e) && shareOpen(e));
    if (!cands.length) {
      w.skip = `no engine can take a ${w.s.type} slot (maxPerDay / weekly max / share cap reached)`;
      continue;
    }
    const scored = cands.map((e) => {
      const c = cfgOf(e);
      let score = 0;
      if (c.weeklyMin != null && weekCount[e] < c.weeklyMin) score += 10 * (c.weeklyMin - weekCount[e]);
      const target = c.targetPerDay ?? 0;
      score += dayCount[e] < target ? 3 * (target - dayCount[e]) : -5;
      if ((c.minPerDay ?? 0) > dayCount[e]) score += 100;
      score -= ENGINE_TIEBREAK.indexOf(e) * 0.01;
      return { e, score };
    }).sort((a, b) => b.score - a.score || ENGINE_TIEBREAK.indexOf(a.e) - ENGINE_TIEBREAK.indexOf(b.e));
    const pick = scored[0].e;
    const c = cfgOf(pick);
    const why = c.weeklyMin != null && weekCount[pick] < c.weeklyMin
      ? `behind weekly min (${weekCount[pick]}/${c.weeklyMin})`
      : `best fit among ${cands.join('/')}`;
    take(w, pick, why);
  }

  // 4b. Share caps are measured on what actually gets authored. Slots skipped
  //     above shrink the denominator, so release the latest slots of an engine
  //     until its share holds — strict, never "close enough".
  for (const e of ENGINE_IDS) {
    const pct = cfgOf(e).maxSharePct;
    if (pct == null) continue;
    for (;;) {
      const authored = postedToday + assigned.size;
      if (dayCount[e] <= Math.floor((pct / 100) * authored)) break;
      const victim = live.filter((w) => assigned.get(w.i)?.engine === e).pop();
      if (!victim) break;
      assigned.delete(victim.i);
      dayCount[e] -= 1;
      weekCount[e] -= 1;
      victim.skip = `${e} share cap of ${pct}% of authored posts`;
    }
  }

  // 5. Weekly minimums are a pacing signal, not a gate — warn when a window
  //    cannot be met so it shows up in the plan instead of silently slipping.
  for (const e of ENGINE_IDS) {
    const min = cfgOf(e).weeklyMin;
    if (min != null && weekCount[e] < min) warnings.push(`${e}: ${weekCount[e]}/${min} this week (weekly min not yet met)`);
  }

  const out = work
    .slice()
    .sort((a, b) => a.i - b.i)
    .map((w) => {
      const a = assigned.get(w.i);
      if (!a) return { ...w.s, engine: null, engineReason: w.skip ?? 'unassigned', engineSkipped: true };
      const shifted = w.at !== w.min;
      return {
        ...w.s,
        engine: a.engine,
        engineReason: a.reason,
        ...(shifted ? { calendarTimeCT: w.s.timeCT, timeCT: fmt(w.at), spacingShifted: true } : {}),
      };
    });

  const counts = Object.fromEntries(ENGINE_IDS.map((e) => [e, dayCount[e]]));
  const weekly = Object.fromEntries(ENGINE_IDS.map((e) => [e, weekCount[e]]));
  return { slots: out, counts, weekly, warnings };
}
