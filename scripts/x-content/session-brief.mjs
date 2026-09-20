#!/usr/bin/env node
// The X strategy session brief: where the account stands RIGHT NOW, free.
//
// WHY THIS EXISTS: every strategy conversation used to start by re-deriving the
// same state by hand — pull the timeline, classify it, remember what the
// baseline was, check which rules got broken. That took five ad-hoc steps and
// each one was an opportunity to quote a number that was not measured. This is
// those steps, once, with the same normalizer and summarizer the corpora use,
// so a delta is a real change and not an artifact of two different taggers.
//
// COST: zero. `bird` reads the local browser's x.com cookies. No X API (that
// is spend-gated and invisible to the Operating Cost card), no ScrapeCreators
// (it returns an empty tweet list for accounts this size, verified 2026-09-12),
// no LLM.
//
// READ-ONLY. It never posts, replies, follows, or writes Firestore.
//
// Usage:
//   node scripts/x-content/session-brief.mjs                          # @bai_ee, 14 days
//   node scripts/x-content/session-brief.mjs --days 30
//   node scripts/x-content/session-brief.mjs --handle seb__design     # brief any account
//   node scripts/x-content/session-brief.mjs --benchmark seb__design  # + A/B gap report
//   node scripts/x-content/session-brief.mjs --json                   # machine output
//
// ⚠️ ONE PAGE, NOT A RE-BASELINE. This pulls a single timeline page (`-n`), so
// it is a session snapshot, not a corpus. It says so when the page did not
// reach back as far as --days. To actually re-baseline, run
// `scripts/x-content/ingest-corpus.mjs --handle <h> --days 65 --write`, which
// chains cursors and persists the stat block.
//
// ⚠️ REPLIES AND VIEWS ARE NOT IN HERE. X's profile timeline hides most
// replies and a bird timeline carries no view counts. Every reply/view figure
// this prints is therefore a floor or a null, never a measurement — the brief
// labels them rather than printing a confident 0.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeTimeline } from '../../features/x-benchmark/normalize-corpus.js';
import { summarizeCorpus } from '../../features/x-benchmark/summarize.js';
import { compareToBenchmark } from '../../features/x-benchmark/compare.js';
import { guardXPost } from '../../features/x-content-guard/index.js';
import { WATCHLIST } from '../../features/x-quote-targets/watchlist.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');

const DEFAULTS = { handle: 'bai_ee', days: 14, count: 100, tz: 0 };

/** bird refuses `-n` above 200 (its own 10-page safety cap) and exits non-zero
 * rather than clamping, so every count this script computes is clamped here. */
const MAX_COUNT = 200;

/** Targets are not invented here. They are the tier table and the day-30 row of
 * docs/plans/X-STRATEGY-SEB-MODEL.md §6 and §9, which were derived from the
 * measured @seb__design corpus. Change them there first, then here. */
const TARGETS = {
  tier1PostsPerDay: 5,
  tier2PostsPerDay: 8,
  authoredPerWeek: 35,
  retweetSharePct: 25,
  repliesPerWeek: 35,
  gapDays: 0,
};

function parseArgs(argv) {
  const out = { ...DEFAULTS, json: false, benchmark: '', baseline: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--handle') out.handle = String(argv[++i] || '').replace(/^@+/, '');
    else if (a === '--days') out.days = Number(argv[++i]) || DEFAULTS.days;
    else if (a === '-n' || a === '--count') out.count = Number(argv[++i]) || DEFAULTS.count;
    else if (a === '--tz') out.tz = Number(argv[++i]) || 0;
    else if (a === '--benchmark') out.benchmark = String(argv[++i] || '').replace(/^@+/, '');
    else if (a === '--baseline') out.baseline = argv[++i] || '';
    else if (a === '--json') out.json = true;
  }
  return out;
}

function resolveBird() {
  if (process.env.BIRD && existsSync(process.env.BIRD)) return process.env.BIRD;
  const candidates = [
    path.join(process.env.HOME || '', '.local/birdtool/node_modules/.bin/bird'),
    path.join(REPO, 'node_modules/.bin/bird'),
  ];
  return candidates.find((p) => existsSync(p)) || '';
}

const args = parseArgs(process.argv.slice(2));
const BIRD = resolveBird();
if (!BIRD) {
  console.error('ERROR: `bird` not found. Install it and set BIRD=/path/to/bird, e.g.');
  console.error('  mkdir -p ~/.local/birdtool && cd ~/.local/birdtool && npm init -y && npm i @steipete/bird');
  console.error('Then log in to x.com in Chrome — bird reads that session\'s cookies.');
  process.exit(1);
}

function fetchTimeline(handle, count) {
  let raw;
  try {
    raw = execFileSync(
      BIRD,
      ['user-tweets', `@${handle}`, '-n', String(Math.min(count, MAX_COUNT)), '--json'],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (err) {
    const msg = String(err?.stderr || err?.message || err).trim().split('\n')[0];
    // A 429 here is X's GraphQL budget, not a broken script. Say which it is —
    // the fix for one is "wait", for the other "log in to x.com in Chrome".
    const hint = /429|rate limit/i.test(msg)
      ? 'X rate-limited the timeline read. Wait a few minutes and re-run.'
      : 'Check that bird is authenticated: `bird whoami` should print @<your account>.';
    throw new Error(`bird could not read @${handle}: ${msg}\n  ${hint}`);
  }
  // bird prints warnings (e.g. Safari cookie EPERM) before the payload, so the
  // parse starts at the first structural character rather than at byte 0.
  const bracket = raw.indexOf('[');
  const brace = raw.indexOf('{');
  const start = bracket === -1 ? brace : (brace === -1 ? bracket : Math.min(bracket, brace));
  if (start === -1) throw new Error('bird returned no JSON payload');
  const parsed = JSON.parse(raw.slice(start));
  return Array.isArray(parsed) ? parsed : (parsed.tweets || []);
}

/** The committed research corpus for an account, if one exists. Summarized with
 * the SAME function as the live pull — a delta between two differently-built
 * stat blocks measures the builders, not the account. */
function loadBaseline(handle, override) {
  const file = override || path.join(REPO, 'docs/audits', `${handle.toLowerCase().replace(/_+/g, '-')}-x-corpus.json`);
  if (!existsSync(file)) return null;
  const rows = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(rows) || !rows.length) return null;
  return { file: path.relative(REPO, file), stats: summarizeCorpus(rows, { handle }), rows };
}

function pct(n) { return n == null ? '—' : `${n}%`; }
function num(n, d = 2) { return n == null ? '—' : Number(n).toFixed(d); }

/** Gap days are counted from YESTERDAY back. Today is still in progress, so
 * counting it as a gap would report a false miss every morning. Today's own
 * count is reported separately. */
function gapDaysIn(rows, days) {
  const seen = new Set(rows.map((r) => r.dateLocal));
  const out = [];
  for (let i = 1; i < days; i += 1) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    if (!seen.has(d)) out.push(d);
  }
  return out.reverse();
}

/** The mechanical rules of docs/plans/X-STRATEGY-SEB-MODEL.md §7, checked
 * against what actually went out. These are cheap, measured, and the ones most
 * often broken by hand-posting in the moment. */
function ruleCheck(rows) {
  const authored = rows.filter((r) => r.type !== 'retweet');
  const findings = [];
  for (const r of authored) {
    const hits = [];
    if (/#\w/.test(r.text)) hits.push('hashtag');
    // A trailing status URL is how X composes a quote tweet and is exempt; a
    // link anywhere else costs ~44% of engagement (measured on the benchmark).
    if (r.hasLink && !/https?:\/\/(x|twitter)\.com\/\w+\/status\/\d+\s*$/i.test(r.text)) hits.push('inline-link');
    if (r.media === 'image') hits.push('image-only (text out-reaches image)');
    if (r.type === 'quote-commentary') hits.push('quote caption >90ch (commentary, lower reach than a reaction)');
    const verdict = guardXPost({ text: r.text, type: r.type, media: r.media, quotedText: r.quotedText || '' });
    if (verdict.hardBlock) hits.push(`guard hard-block: ${verdict.concerns?.[0]?.code || 'see guard'}`);
    if (verdict.lane === 'casino' || verdict.lane === 'politics') hits.push(`lane: ${verdict.lane}`);
    if (hits.length) findings.push({ id: r.id, url: r.url, utc: r.utc, text: r.text.slice(0, 80), hits });
  }
  return findings;
}

function quoteTargetAudit(rows) {
  const onList = new Set(WATCHLIST.map((a) => a.handle.toLowerCase()));
  const counts = new Map();
  for (const r of rows) {
    if (!r.quotedAuthor) continue;
    const h = r.quotedAuthor.toLowerCase();
    const cur = counts.get(h) || { handle: r.quotedAuthor, n: 0, likes: 0, onWatchlist: onList.has(h) };
    cur.n += 1;
    cur.likes += r.likes || 0;
    counts.set(h, cur);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n);
}

function briefOne(handle, count = args.count) {
  let raws;
  try {
    raws = fetchTimeline(handle, count);
  } catch (err) {
    // A read failure is an operator problem (cookies, rate limit), not a bug —
    // print the actionable line, not a stack.
    console.error(String(err?.message || err));
    process.exit(1);
  }
  const since = new Date(Date.now() - args.days * 86_400_000).toISOString();
  const { rows } = normalizeTimeline(raws, { handle, tzOffsetHours: args.tz, since });
  const oldestReturned = raws
    .map((t) => Date.parse(t?.createdAt))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];
  // If the page's oldest post is NEWER than the window we asked for, the window
  // is truncated by the page size and every per-day figure is computed over a
  // shorter span than requested. Say so rather than quietly under-reporting.
  const truncated = Number.isFinite(oldestReturned) && oldestReturned > Date.parse(since);
  return {
    handle,
    since,
    truncated,
    pulled: raws.length,
    rows,
    stats: summarizeCorpus(rows, { handle }),
  };
}

const own = briefOne(args.handle);
if (!own.rows.length) {
  console.error(`No posts for @${args.handle} in the last ${args.days} days (pulled ${own.pulled}). Is bird authenticated?`);
  process.exit(1);
}

const baseline = loadBaseline(args.handle, args.baseline);
const violations = ruleCheck(own.rows);
const quotes = quoteTargetAudit(own.rows);
const gaps = gapDaysIn(own.rows, args.days);
const todayKey = new Date().toISOString().slice(0, 10);
const todayCount = own.rows.filter((r) => r.dateLocal === todayKey).length;

let comparison = null;
if (args.benchmark) {
  // A benchmark worth copying posts several times more than you do, so the same
  // page size covers a much shorter span of its timeline — and a truncated
  // benchmark window understates exactly the volume gap the comparison exists
  // to measure. Pull it deeper.
  const bench = briefOne(args.benchmark, MAX_COUNT);
  comparison = {
    benchmarkHandle: args.benchmark,
    benchmarkPosts: bench.rows.length,
    benchmarkTruncated: bench.truncated,
    report: compareToBenchmark({ own: own.stats, benchmark: bench.stats }),
  };
}

const payload = {
  generatedAt: new Date().toISOString(),
  window: { days: args.days, since: own.since, truncated: own.truncated },
  handle: own.handle,
  live: own.stats,
  baseline: baseline ? { file: baseline.file, stats: baseline.stats } : null,
  targets: TARGETS,
  gapDays: gaps,
  today: { date: todayKey, posts: todayCount, note: 'day in progress — not counted as a gap' },
  violations,
  quoteTargets: quotes,
  comparison,
  unmeasurable: [
    'replies — X hides most replies on a profile timeline; treat any reply count here as a floor',
    'views / impressions — a bird timeline carries none; backfill costs 1 ScrapeCreators credit per post',
    'follower delta — needs an x-monitor sync (~3 X API calls, spend-gated, invisible to the Operating Cost card)',
  ],
};

if (args.json) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(0);
}

const s = own.stats;
const out = [];
out.push('');
out.push(`X SESSION BRIEF — @${own.handle}`);
out.push(`  window ${args.days}d since ${own.since.slice(0, 10)} · ${own.rows.length} posts · pulled ${own.pulled} · free (bird)`);
if (own.truncated) {
  out.push(`  ⚠️ one page only reached back to ${own.rows[own.rows.length - 1].dateLocal} — per-day figures cover that span, not ${args.days}d. Raise -n or run ingest-corpus.mjs.`);
}

out.push('');
out.push('CADENCE');
out.push(`  posts/active day      ${num(s.cadence.postsPerActiveDay)}   target ${TARGETS.tier1PostsPerDay} (tier 1) / ${TARGETS.tier2PostsPerDay} (tier 2)`);
out.push(`  authored/active day   ${num(s.cadence.authoredPerActiveDay)}`);
out.push(`  authored share        ${pct(s.authoredShare)}   target retweet share ≤ ${TARGETS.retweetSharePct}% (authored ≥ ${100 - TARGETS.retweetSharePct}%)`);
out.push(`  stranger-eligible     ${pct(s.strangerEligibleShare)}`);
out.push(`  posts/occupied hour   ${num(s.cadence.postsPerOccupiedHour)}   benchmark 1.96 — density is not the lever, volume is`);
out.push(`  gap days              ${gaps.length} of ${args.days - 1}   target ${TARGETS.gapDays}${gaps.length ? `   [${gaps.join(', ')}]` : ''}`);
out.push(`  today so far          ${todayCount} post${todayCount === 1 ? '' : 's'} (${new Date().toISOString().slice(0, 10)}, day in progress)`);

out.push('');
out.push('MIX (authored, share of authored, lift vs this account\'s own average likes)');
const baseType = baseline?.stats?.byType || {};
for (const [type, cell] of Object.entries(s.byType).sort((a, b) => b[1].n - a[1].n)) {
  const was = baseType[type]?.share;
  const delta = was == null ? '' : `  (baseline ${was}%${cell.share > was ? ' ↑' : cell.share < was ? ' ↓' : ' ='})`;
  out.push(`  ${type.padEnd(20)} n=${String(cell.n).padStart(3)}  ${String(cell.share).padStart(5)}%  lift ${num(cell.lift)}${delta}`);
}
if (baseline) out.push(`  baseline: ${baseline.file} (${baseline.stats.cadence.firstDate} → ${baseline.stats.cadence.lastDate}, ${baseline.stats.authoredPosts} authored)`);

out.push('');
out.push(`RULE CHECK — ${violations.length} of ${own.rows.filter((r) => r.type !== 'retweet').length} authored posts broke a mechanical rule`);
for (const v of violations) {
  out.push(`  ${v.utc.slice(0, 16)}  ${v.hits.join(' · ')}`);
  out.push(`      ${JSON.stringify(v.text)}  ${v.url}`);
}
if (!violations.length) out.push('  clean.');

out.push('');
out.push('QUOTE TARGETS — who got quoted, and whether they are on the derived watchlist');
if (!quotes.length) out.push('  none in this window.');
for (const q of quotes) {
  out.push(`  @${q.handle.padEnd(22)} ${String(q.n).padStart(2)}×  ${String(q.likes).padStart(4)} likes earned  ${q.onWatchlist ? 'on watchlist' : '⚠️ OFF watchlist'}`);
}

if (comparison) {
  const r = comparison.report;
  out.push('');
  out.push(`A/B vs @${comparison.benchmarkHandle} — ${comparison.benchmarkPosts} posts in the same window`);
  if (comparison.benchmarkTruncated) out.push('  ⚠️ benchmark page truncated — its per-day figures cover a shorter span.');
  for (const g of r.gaps.slice(0, 8)) {
    const impact = g.impact ? `  impact ${g.impact > 0 ? '+' : ''}${(g.impact * 100).toFixed(0)}%` : '';
    out.push(`  [${g.unit}] ${g.headline}${g.direction ? `  → ${g.direction}` : ''}${impact}`);
  }
  if (r.projection) {
    out.push(`  projection: mix ${num(r.projection.mixMultiplier)}× · volume ${num(r.projection.volumeRatio)}× · combined ${num(r.projection.combined)}× (ceiling, not a forecast)`);
  }
  for (const w of r.warnings) out.push(`  ⚠️ ${w}`);
}

out.push('');
out.push('NOT MEASURED HERE (do not fill these in from memory)');
for (const u of payload.unmeasurable) out.push(`  · ${u}`);
out.push('');
out.push('Docs: docs/source-of-truth/X-STRATEGY-SESSION-PROTOCOL.md · X-GROWTH-SYSTEM.md · docs/plans/X-STRATEGY-SEB-MODEL.md');
out.push('');

process.stdout.write(`${out.join('\n')}\n`);
