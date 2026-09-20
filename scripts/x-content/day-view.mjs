#!/usr/bin/env node
// Tomorrow's posting plan: every slot, and what content fills it.
//
// This is the thing you look at each morning. It answers "what do I post at
// 13:00" from inventory instead of from willpower, and where it cannot, it
// says exactly what is missing rather than showing an empty row.
//
// COST: zero. Pure local computation over a committed corpus and the local
// inventory file. No X API, no bird call, no LLM, no network at all.
//
// READ-ONLY, AND IT CANNOT POST. It proposes; drafting is P3 and publishing
// stays behind an explicit human action.
//
// Usage:
//   node scripts/x-content/day-view.mjs                 # today, tier 1 (5 posts)
//   node scripts/x-content/day-view.mjs --posts 8       # tier 2
//   node scripts/x-content/day-view.mjs --date 2026-09-25
//   node scripts/x-content/day-view.mjs --json

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeCorpus } from '../../features/x-benchmark/summarize.js';
import { buildCalendar } from '../../features/x-benchmark/build-calendar.js';
import { compareToBenchmark } from '../../features/x-benchmark/compare.js';
import { matchDay } from '../../features/x-content-inventory/match.js';
import { buildPostLedger, pickResurrectionCandidates, assetFatigue } from '../../features/x-content-inventory/ledger.js';
import { validateInventory } from '../../features/x-content-inventory/schema.js';
import { SERIES, REPLY_QUOTA_PER_DAY } from '../../features/x-content-inventory/categories.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const INVENTORY = path.join(REPO, 'features/x-content-inventory/content-packages.json');
const CORPUS = path.join(REPO, 'docs/audits/bai-ee-x-corpus.json');
const BENCHMARK = path.join(REPO, 'docs/audits/seb-design-x-corpus.json');

function parseArgs(argv) {
  const out = { posts: 5, date: new Date().toISOString().slice(0, 10), json: false, handle: 'bai_ee' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--posts') out.posts = Number(argv[++i]) || 5;
    else if (a === '--date') out.date = argv[++i] || out.date;
    else if (a === '--handle') out.handle = argv[++i] || out.handle;
    else if (a === '--json') out.json = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (!existsSync(INVENTORY)) {
  console.error(`No inventory at ${path.relative(REPO, INVENTORY)}. Nothing to plan from.`);
  process.exit(1);
}

const packages = JSON.parse(readFileSync(INVENTORY, 'utf8'));
const audit = validateInventory(packages);

// Hours come from the account's OWN posting history — never from a benchmark's
// clock. Different timezone, different audience.
const corpusRows = JSON.parse(readFileSync(CORPUS, 'utf8'));
const ownStats = summarizeCorpus(corpusRows, { handle: args.handle });

// The ledger is BACKFILLED from post history, so self-quote slots work before
// the inventory has anything in it — and before a single new post goes out.
const ledgerEntries = buildPostLedger(corpusRows);
const resurrections = pickResurrectionCandidates(ledgerEntries, { today: Date.now(), limit: 5 });
const fatigue = assetFatigue(ledgerEntries);

// ⚠️ WITHOUT A GAP REPORT, buildCalendar falls back to the account's CURRENT
// mix — a self-fulfilling loop that can only ever repeat the account's
// existing habits back at it. The calendar should plan the corrected mix, not
// the observed one.
//
// Note this fixes the over-posted types (it correctly cuts quote-commentary,
// which this account runs at 16.67% and 0.58× lift) but NOT the never-posted
// ones — see the adoption floor below for why that needs a separate rule.
const benchStats = existsSync(BENCHMARK)
  ? summarizeCorpus(JSON.parse(readFileSync(BENCHMARK, 'utf8')), { handle: 'seb__design' })
  : null;
const report = benchStats ? compareToBenchmark({ own: ownStats, benchmark: benchStats }) : null;

const calendar = buildCalendar({
  report: report ?? undefined,
  ownStats,
  tier: { tier: args.posts >= 8 ? 2 : 1, authoredPerDay: args.posts, label: args.posts >= 8 ? 'Competitive' : 'Foundation' },
  profile: { lanes: ['music', 'craft', 'work', 'meta'] },
  days: 1,
  startDate: args.date,
});

const day = calendar.days?.[0] ?? { slots: [] };
const now = Date.now();

/** A type has to earn this much more than the benchmark's own average before
 * it is worth adopting on lift alone. */
const ADOPT_MIN_LIFT = 1.3;
/** Below this share, the account effectively does not run the type. */
const ADOPT_MAX_OWN_SHARE = 3;
/** The benchmark needs enough posts of the type for its lift to mean anything
 * — mirrors MIN_CLASS_N in summarize.js. */
const ADOPT_MIN_BENCH_N = 8;

/**
 * ⚠️ ADOPTION FLOOR — a high-lift type you never post cannot enter the plan.
 *
 * Two mechanisms conspire to hide it, and both are individually correct:
 *
 * 1. `compareToBenchmark` DAMPS mix moves on purpose ("a share delta is not a
 *    recommendation" — blind mix-matching scored 0.84× on the real pair). So a
 *    type at 0% own share is nudged to ~1%, which never wins a slot.
 * 2. Gap analysis is SHARE-based, so it cannot flag a type the benchmark also
 *    posts rarely.
 *
 * Self-quote is exactly that case, measured on these corpora: the benchmark
 * runs it at **2.49% share but 1.67× lift — its highest-lift type**, and this
 * account has posted one in 84. No share comparison will ever surface that.
 * The reason to adopt it is LIFT, not share.
 *
 * So: one slot a day for the best such type, taken from the most
 * over-allocated one. Applied here rather than in `build-calendar.js` because
 * that module is shared and tested — this is a PROPOSED change to it, written
 * where it can be evaluated first. See the handoff doc.
 */
function applyAdoptionFloor(slots, own, bench) {
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
  // Never take a type down to zero — the plan should still look like the
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

// Effort gating needs to know how far away each slot is, so a 07:00 slot on a
// day that has already started is not offered a five-hour shoot.
const slots = applyAdoptionFloor(day.slots, ownStats, benchStats).map((s) => {
  const [h, m] = String(s.timeCT ?? '12:00').split(':').map(Number);
  const when = Date.parse(`${args.date}T${String(h).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}:00Z`);
  return { ...s, hoursFromNow: Math.max(0, (when - now) / 3_600_000) };
});

const result = matchDay({ slots, packages, today: now, ledger: fatigue, resurrections });

if (args.json) {
  process.stdout.write(`${JSON.stringify({ date: args.date, inventory: audit, ...result }, null, 2)}\n`);
  process.exit(0);
}

const out = [];
out.push('');
out.push(`POSTING PLAN — ${args.date}  ·  ${args.posts} authored posts + ${REPLY_QUOTA_PER_DAY} replies`);
out.push(`  inventory: ${audit.total} packages (${audit.valid} valid) · filled ${result.filled}/${slots.length} slots`);
out.push('');

for (const s of result.slots) {
  const head = `  ${s.timeCT}  ${String(s.slot).padEnd(2)} ${String(s.type).padEnd(18)} ${String(s.lane ?? '').padEnd(6)}`;
  if (s.source === 'scan') {
    out.push(`${head} ← daily scan (quote target found at 06:30)`);
    continue;
  }
  if (s.source === 'ledger') {
    if (!s.story) { out.push(`${head} ⚠️ ${s.matchReason}`); continue; }
    out.push(`${head} ← your own post, re-surfaced${s.adopted ? '  [adopted slot]' : ''}`);
    if (s.adoptReason) out.push(`      adopted: ${s.adoptReason}`);
    out.push(`      ${String(s.story).replace(/\n/g, ' ').slice(0, 100)}`);
    out.push(`      ${s.asset ?? ''}   why: ${s.matchReason}`);
    continue;
  }
  if (!s.packageId) {
    const gap = result.gaps.find((g) => g.slot === s.slot);
    out.push(`${head} ⚠️ GAP`);
    out.push(`      need: ${gap?.need ?? 'unknown'}`);
    continue;
  }
  out.push(`${head} ← ${s.packageId}  [${s.series}]`);
  out.push(`      ${String(s.story ?? '').slice(0, 110)}${(s.story ?? '').length > 110 ? '…' : ''}`);
  out.push(`      asset: ${s.asset ?? '—'}   self-reply: ${s.selfReply ?? '—'}   why: ${s.matchReason}`);
}

if (result.unfilled) {
  out.push('');
  out.push(`${result.unfilled} unfilled slot${result.unfilled === 1 ? '' : 's'}. That number is the inventory shortfall, not a scheduling bug —`);
  out.push('add packages in the series named above, or lower --posts until the inventory can carry the day.');
}

out.push('');
out.push('Series available: ' + Object.entries(SERIES).map(([k, s]) => `${k}=${s.label}`).join(' · '));
out.push('Copy is not drafted yet (P3). This view proposes WHAT to post, not the words.');
out.push('');

process.stdout.write(`${out.join('\n')}\n`);
