// Build one day's posting plan: slots, matched content, named gaps.
//
// Extracted from day-view.mjs so the drafting path and the view share ONE
// implementation. Two scripts each assembling the plan their own way is how
// the drafted copy ends up describing a different slot than the one on screen.
//
// Pure apart from the corpus/inventory the caller hands in — no fs, no
// network, clock injected.

import { summarizeCorpus } from '../x-benchmark/summarize.js';
import { buildCalendar } from '../x-benchmark/build-calendar.js';
import { compareToBenchmark } from '../x-benchmark/compare.js';
import { matchDay } from './match.js';
import { buildPostLedger, pickResurrectionCandidates, assetFatigue } from './ledger.js';
import { validateInventory } from './schema.js';

/** A type has to earn this much more than the benchmark's own average before
 * it is worth adopting on lift alone. */
export const ADOPT_MIN_LIFT = 1.3;
/** Below this share, the account effectively does not run the type. */
export const ADOPT_MAX_OWN_SHARE = 3;
/** Mirrors MIN_CLASS_N in summarize.js — the benchmark needs enough posts of
 * the type for its lift to mean anything. */
export const ADOPT_MIN_BENCH_N = 8;

/**
 * ⚠️ ADOPTION FLOOR — a high-lift type you never post cannot enter the plan.
 *
 * Two individually-correct mechanisms hide it:
 *
 * 1. `compareToBenchmark` DAMPS mix moves on purpose (blind mix-matching
 *    scored 0.84× on the real pair), so a 0%-share type is nudged to ~1% and
 *    never wins a slot.
 * 2. Gap analysis is SHARE-based, so it cannot flag a type the benchmark also
 *    posts rarely.
 *
 * Self-quote is exactly that, measured: the benchmark runs it at 2.49% share
 * but 1.67× lift — its highest-lift type — and this account has posted one in
 * 84. The reason to adopt it is LIFT, not share.
 *
 * ⚠️ This is a PROPOSED change to `build-calendar.js`, deliberately living
 * outside it until someone agrees with it. That module is shared and tested.
 */
export function applyAdoptionFloor(slots, own, bench) {
  if (!own?.byType || !bench?.byType) return slots;
  const present = new Set(slots.map((s) => s.type));

  const candidates = Object.entries(bench.byType)
    .filter(([type, b]) => !present.has(type)
      && b.n >= ADOPT_MIN_BENCH_N
      && Number(b.lift) >= ADOPT_MIN_LIFT
      && Number(own.byType[type]?.share ?? 0) < ADOPT_MAX_OWN_SHARE)
    .sort((a, b2) => Number(b2[1].lift) - Number(a[1].lift));

  if (!candidates.length) return slots;
  const [type, cell] = candidates[0];

  const counts = slots.reduce((acc, s) => { acc[s.type] = (acc[s.type] ?? 0) + 1; return acc; }, {});
  const donor = Object.entries(counts).sort((a, b2) => b2[1] - a[1])[0];
  // Never take a type to zero — the plan should still look like the
  // recommended mix, with one slot borrowed.
  if (!donor || donor[1] < 2) return slots;

  const out = [...slots];
  const idx = out.map((s) => s.type).lastIndexOf(donor[0]);
  if (idx === -1) return out;
  out[idx] = {
    ...out[idx],
    type,
    adopted: true,
    adoptedFrom: donor[0],
    adoptReason: `benchmark runs ${type} at ${cell.share}% share but ${cell.lift}× lift (n=${cell.n}); you run it at ${own.byType[type]?.share ?? 0}%`,
  };
  return out;
}

/**
 * @param {object} input
 * @param {object[]} input.corpusRows   the account's own normalized posts
 * @param {object[]} [input.benchmarkRows]  a benchmark corpus, for the gap report
 * @param {object[]} input.packages     the content inventory
 * @param {string} input.date           YYYY-MM-DD
 * @param {number} [input.posts]        authored posts for the day
 * @param {string} [input.handle]
 * @param {string[]} [input.lanes]
 * @param {number} [input.now]          epoch ms, injected for testability
 */
export function buildDayPlan(input = {}) {
  const {
    corpusRows = [], benchmarkRows = null, packages = [],
    date = new Date().toISOString().slice(0, 10),
    posts = 5, handle = 'bai_ee', lanes = ['music', 'craft', 'work', 'meta'],
    now = Date.now(),
  } = input;

  const audit = validateInventory(packages);
  const ownStats = summarizeCorpus(corpusRows, { handle });

  // Backfilled from post history, so self-quote slots work before the
  // inventory holds anything and before a single new post goes out.
  const ledgerEntries = buildPostLedger(corpusRows);
  const resurrections = pickResurrectionCandidates(ledgerEntries, { today: now, limit: 5 });
  const fatigue = assetFatigue(ledgerEntries);

  // ⚠️ Without a gap report, buildCalendar falls back to the account's CURRENT
  // mix — a self-fulfilling loop that can only repeat its existing habits.
  const benchStats = benchmarkRows ? summarizeCorpus(benchmarkRows, { handle: 'benchmark' }) : null;
  const report = benchStats ? compareToBenchmark({ own: ownStats, benchmark: benchStats }) : null;

  const calendar = buildCalendar({
    report: report ?? undefined,
    ownStats,
    tier: { tier: posts >= 8 ? 2 : 1, authoredPerDay: posts, label: posts >= 8 ? 'Competitive' : 'Foundation' },
    profile: { lanes },
    days: 1,
    startDate: date,
  });

  const day = calendar.days?.[0] ?? { slots: [] };

  // Effort gating needs to know how far away each slot is, so a 07:00 slot on
  // a day that has already started is not offered a five-hour shoot.
  const slots = applyAdoptionFloor(day.slots, ownStats, benchStats).map((s) => {
    const [h, m] = String(s.timeCT ?? '12:00').split(':').map(Number);
    const when = Date.parse(`${date}T${String(h).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}:00Z`);
    return { ...s, hoursFromNow: Math.max(0, (when - now) / 3_600_000) };
  });

  const matched = matchDay({ slots, packages, today: now, ledger: fatigue, resurrections });

  return { date, audit, ownStats, benchStats, report, ...matched };
}
