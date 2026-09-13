// Generate a posting calendar from a measured gap, instead of writing one by
// hand.
//
// `docs/audits/x-calendar-15day.json` is 15 days of slots a person wrote after
// reading the comparison. This produces the same shape — the shape
// features/x-quote-targets/day-plan.js already consumes — from the gap report,
// so a second client gets a calendar without a second act of authorship.
//
// What it decides:
//   how many slots  <- the cadence tier (profile.resolveTier)
//   which types     <- projection.targetMix, the ACTIONABLE mix from compare.js
//   which hours     <- the account's OWN best hours, never the benchmark's
//   which lane      <- the client's own lanes, rotated
//
// ⚠️ Hours come from the client's own history because clock hours are not
// comparable across accounts (different timezones, different audiences).
// Copying a benchmark's posting times would be the one cross-account
// comparison the data explicitly does not support.
//
// Pure and deterministic: no fs, no network, no clock, no randomness. Same
// inputs always produce the same calendar, which is what makes it reviewable.

/** Measured: the benchmark runs ~1.96 posts per occupied hour and 73% of its
 * posts share an hour with another. Density is not the lever — volume is — so
 * the generator packs to this density and adds HOURS as volume grows, rather
 * than spreading thin. */
export const POSTS_PER_OCCUPIED_HOUR = 2;

/** Fallback posting hours when the account has no history worth reading —
 * daytime, spread, in the account's own local clock. */
export const DEFAULT_HOURS = [9, 11, 13, 15, 17, 19];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SLOT_LETTERS = 'ABCDEFGHIJKLMNOP';

/** Every type whose target is a live post found by the daily scan. Everything
 * else is copy the client writes, which is why only these carry a `brief`
 * describing what to look for. */
const DYNAMIC_TYPES = new Set(['quote-react', 'quote-commentary']);

const BRIEFS = {
  'quote-react': 'a post climbing right now in this lane — react in one line, no question mark',
  'quote-commentary': 'a post worth adding a real opinion to, not just a reaction',
  'original-showcase': 'something you made — video out-reaches image inside this type',
  'original-text': 'one idea, stated. no link',
  'self-quote': 'quote your own best post from the last few days and add what it left out',
  reply: 'reply to someone in your lane — conversation surface, not reach',
};

function isObj(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Pick the hours to post in, best-performing first, then ordered by clock.
 *
 * Reads the account's own byHour block: hours it has actually posted in, ranked
 * by lift. An hour with too little history to judge is not promoted on the
 * strength of one lucky post.
 */
export function pickHours(ownStats, count) {
  const need = Math.max(1, count);
  const rows = Array.isArray(ownStats?.byHour) ? ownStats.byHour : [];
  const ranked = rows
    .filter((h) => (h.n ?? 0) >= 3 && Number.isFinite(h.lift))
    .sort((a, b) => b.lift - a.lift || a.hour - b.hour)
    .map((h) => h.hour);

  const chosen = [];
  for (const hour of ranked) {
    if (chosen.length >= need) break;
    chosen.push(hour);
  }
  // Top up from the defaults, skipping hours already taken, so a thin history
  // produces a full day rather than three slots stacked on one hour.
  for (const hour of DEFAULT_HOURS) {
    if (chosen.length >= need) break;
    if (!chosen.includes(hour)) chosen.push(hour);
  }
  // Still short (a very high tier): fill daytime hours in order.
  for (let hour = 8; hour <= 22 && chosen.length < need; hour += 1) {
    if (!chosen.includes(hour)) chosen.push(hour);
  }
  return chosen.slice(0, need).sort((a, b) => a - b);
}

/**
 * Turn a target mix (percentages by type) into a whole number of slots.
 *
 * Largest-remainder, so the slot counts sum to exactly `slots` and a type with
 * a small share still gets its slot on the days it is owed one rather than
 * being rounded out of existence.
 */
export function allocateSlots(targetMix, slots) {
  const entries = Object.entries(isObj(targetMix) ? targetMix : {})
    .filter(([, share]) => Number(share) > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!entries.length || slots <= 0) return {};

  const total = entries.reduce((sum, [, share]) => sum + Number(share), 0);
  const exact = entries.map(([type, share]) => [type, (Number(share) / total) * slots]);
  const out = {};
  let assigned = 0;
  for (const [type, value] of exact) {
    out[type] = Math.floor(value);
    assigned += out[type];
  }
  const remainders = exact
    .map(([type, value]) => [type, value - Math.floor(value)])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  let i = 0;
  while (assigned < slots && remainders.length) {
    const [type] = remainders[i % remainders.length];
    out[type] += 1;
    assigned += 1;
    i += 1;
  }
  return Object.fromEntries(Object.entries(out).filter(([, n]) => n > 0));
}

/**
 * Build a calendar.
 *
 * @param {object} input
 * @param {object} input.report - compareToBenchmark() output
 * @param {object} input.ownStats - summarizeCorpus() block for the client
 * @param {object} input.tier - resolveTier() output
 * @param {object} [input.profile] - resolveXGrowthProfile() output (lanes)
 * @param {number} [input.days=15]
 * @param {string} [input.startDate] - YYYY-MM-DD; only used to label weekdays
 * @returns {object} { meta, days: [{ day, weekday, slots: [...] }] }
 */
export function buildCalendar(input = {}) {
  const report = isObj(input.report) ? input.report : {};
  const ownStats = isObj(input.ownStats) ? input.ownStats : {};
  const tier = isObj(input.tier) ? input.tier : { tier: 1, authoredPerDay: 4, label: 'Foundation' };
  const profile = isObj(input.profile) ? input.profile : {};
  const days = clampInt(input.days, 1, 60, 15);

  const slotsPerDay = clampInt(tier.authoredPerDay, 1, 16, 4);
  const hoursNeeded = Math.ceil(slotsPerDay / POSTS_PER_OCCUPIED_HOUR);
  const hours = pickHours(ownStats, hoursNeeded);

  const targetMix = isObj(report.projection?.targetMix) && Object.keys(report.projection.targetMix).length
    ? report.projection.targetMix
    // No comparison available: fall back to the client's own current mix, which
    // at least reflects what they can actually produce.
    : Object.fromEntries(Object.entries(ownStats.byType ?? {}).map(([t, v]) => [t, v.share]));

  const allocation = allocateSlots(targetMix, slotsPerDay);

  // One flat, repeating sequence of types, ordered so the same type does not
  // sit in consecutive slots where the day allows otherwise.
  const sequence = [];
  const pools = Object.entries(allocation).map(([type, n]) => ({ type, left: n }));
  while (pools.some((p) => p.left > 0)) {
    pools.sort((a, b) => b.left - a.left || a.type.localeCompare(b.type));
    const next = pools.find((p) => p.left > 0 && p.type !== sequence[sequence.length - 1])
      ?? pools.find((p) => p.left > 0);
    next.left -= 1;
    sequence.push(next.type);
  }

  const lanes = Array.isArray(profile.lanes) && profile.lanes.length ? profile.lanes : ['general'];
  const startMs = Date.parse(`${String(input.startDate ?? '')}T00:00:00Z`);

  const outDays = [];
  for (let d = 0; d < days; d += 1) {
    const slots = [];
    for (let s = 0; s < slotsPerDay; s += 1) {
      // Rotate the type sequence by day so a type never lands in the same slot
      // every single day.
      const type = sequence[(s + d) % sequence.length];
      const hour = hours[Math.floor(s / POSTS_PER_OCCUPIED_HOUR) % hours.length];
      const minute = (s % POSTS_PER_OCCUPIED_HOUR) * 30;
      slots.push({
        slot: SLOT_LETTERS[s] ?? `S${s}`,
        timeCT: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
        type,
        lane: lanes[(d + s) % lanes.length],
        brief: BRIEFS[type] ?? 'post in your lane',
        copy: null,
        asset: null,
        selfReply: null,
        // Dynamic slots are filled by the daily scan; the rest need copy the
        // client writes. day-plan.js reads `type` to decide which is which, so
        // this flag is for humans reading the calendar.
        dynamic: DYNAMIC_TYPES.has(type),
        guard: { hardBlock: false, lane: null, reviewRequired: true },
      });
    }
    outDays.push({
      day: d + 1,
      weekday: Number.isFinite(startMs) ? WEEKDAYS[new Date(startMs + d * 86_400_000).getUTCDay()] : null,
      theme: null,
      slots,
    });
  }

  return {
    meta: {
      generated: true,
      generatedFrom: {
        ownHandle: report.ownHandle ?? ownStats.handle ?? null,
        benchmarkHandle: report.benchmarkHandle ?? null,
      },
      tier: tier.tier,
      tierLabel: tier.label ?? null,
      slotsPerDay,
      occupiedHours: hours.length,
      hours,
      targetMix,
      allocation,
      days,
      // ⚠️ These times are the ACCOUNT'S OWN local clock, taken from its own
      // history. They are not the benchmark's hours and must not be presented
      // as "when the benchmark posts".
      hoursSource: (ownStats.byHour ?? []).some((h) => (h.n ?? 0) >= 3) ? 'own-history' : 'defaults',
      startDate: input.startDate ?? null,
    },
    days: outDays,
  };
}
