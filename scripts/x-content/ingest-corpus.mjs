#!/usr/bin/env node
// Ingest one X account's timeline into a stored corpus stat block.
//
// Replaces the pair of hardcoded research scripts (pull-timeline.mjs +
// analyze-corpus{,-baiee}.mjs, one copy per account, handle baked in) with one
// parameterized path, so a client's corpus and a benchmark's are built by
// identical code. A comparison between two differently-normalized corpora
// measures the normalizers.
//
// Usage:
//   node scripts/x-content/ingest-corpus.mjs --handle seb__design
//   node scripts/x-content/ingest-corpus.mjs --handle bai_ee --tz -5 --write
//   node scripts/x-content/ingest-corpus.mjs --handle x --out /tmp/corpus.json
//
// Dry run by default: prints the summary and writes nothing. --write persists
// the stat block to Firestore (x_corpora/{handle}); --out also dumps the raw
// normalized rows to a file, which is where they stay — rows are ~650KB per
// account and nothing downstream needs them.
//
// ⚠️ A bird timeline carries no VIEW counts, so an ingested corpus reports 0%
// view coverage and its engagement-rate figures are null. This is fine and
// expected: every `lift` in the system is likes-based precisely because likes
// are complete on every row and views are not. Views are a separate, metered
// backfill (scripts/x-content/research/backfill-views.mjs).
//
// ⚠️ RUNS LOCALLY, NOT ON VERCEL. `bird` reads the local browser's x.com
// cookies. This was re-tested on 2026-09-12: ScrapeCreators'
// /v1/twitter/user-tweets returns `{success:true, tweets:[]}` for
// @seb__design — a 1,549-follower account with 782 posts in the window — so it
// cannot serve a timeline for accounts this size, historical or fresh. The
// remaining hosted option is the paid X API, which is spend-gated
// (docs/source-of-truth/X-API-AND-PROFILE-OPERATIONS.md).

import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { normalizeTimeline } from '../../features/x-benchmark/normalize-corpus.js';
import { summarizeCorpus } from '../../features/x-benchmark/summarize.js';
import { untaggedShare } from '../../features/x-benchmark/taxonomy.js';
import { deriveWatchlist } from '../../features/x-benchmark/derive-watchlist.js';

const DEFAULT_DAYS = 65;
const MAX_ROUNDS = 12;

function parseArgs(argv) {
  const out = { tz: 0, days: DEFAULT_DAYS, rounds: MAX_ROUNDS, lanes: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--handle') out.handle = argv[++i] || '';
    else if (a === '--client') out.client = argv[++i] || '';
    else if (a === '--since') out.since = argv[++i] || '';
    else if (a === '--days') out.days = Number(argv[++i]) || DEFAULT_DAYS;
    else if (a === '--tz') out.tz = Number(argv[++i]) || 0;
    else if (a === '--lanes') out.lanes = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--rounds') out.rounds = Number(argv[++i]) || MAX_ROUNDS;
    else if (a === '--out') out.out = argv[++i] || '';
    else if (a === '--source') out.source = argv[++i] || 'bird';
    else if (a === '--write') out.write = true;
  }
  return out;
}

function resolveBird() {
  if (process.env.BIRD && existsSync(process.env.BIRD)) return process.env.BIRD;
  const candidates = [
    path.join(process.env.HOME || '', '.local/birdtool/node_modules/.bin/bird'),
    path.join(process.cwd(), 'node_modules/.bin/bird'),
  ];
  return candidates.find((p) => existsSync(p)) || 'bird';
}

/** Chain bird's paged user-tweets until the cutoff is passed. */
function pullTimeline(handle, sinceIso, rounds) {
  const bird = resolveBird();
  const cutoff = Date.parse(sinceIso);
  const all = [];
  const seen = new Set();
  let cursor = null;

  for (let round = 1; round <= rounds; round += 1) {
    const args = ['user-tweets', `@${handle}`, '-n', '200', '--max-pages', '10', '--delay', '1200', '--json'];
    if (cursor) args.push('--cursor', cursor);
    let raw;
    try {
      raw = execFileSync(bird, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      process.stderr.write(`round ${round} failed: ${String(err.stderr || err.message).slice(0, 300)}\n`);
      break;
    }
    const objStart = raw.indexOf('{');
    const arrStart = raw.indexOf('[');
    const jsonStart = objStart === -1 ? arrStart : (arrStart === -1 ? objStart : Math.min(objStart, arrStart));
    if (jsonStart === -1) { process.stderr.write(`round ${round}: no JSON in output\n`); break; }
    let payload;
    try {
      payload = JSON.parse(raw.slice(jsonStart));
    } catch (err) {
      process.stderr.write(`round ${round} parse failed: ${String(err.message).slice(0, 200)}\n`);
      break;
    }
    const tweets = Array.isArray(payload) ? payload : (payload.tweets || []);
    const next = Array.isArray(payload) ? null : (payload.nextCursor || null);

    let added = 0;
    let oldest = null;
    for (const t of tweets) {
      if (!t?.id || seen.has(t.id)) continue;
      seen.add(t.id);
      all.push(t);
      added += 1;
      const d = Date.parse(t.createdAt);
      if (Number.isFinite(d) && (oldest === null || d < oldest)) oldest = d;
    }
    process.stderr.write(
      `round ${round}: +${added} (total ${all.length}) oldest=${oldest ? new Date(oldest).toISOString().slice(0, 10) : 'n/a'}\n`,
    );
    if (oldest !== null && Number.isFinite(cutoff) && oldest < cutoff) break;
    if (!next || added === 0) break;
    cursor = next;
  }
  return all;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const handle = String(args.handle || '').replace(/^@+/, '').trim();

  if (!handle) {
    process.stderr.write('ERROR: --handle <account> is required.\n');
    process.exit(1);
  }
  if (args.source && args.source !== 'bird') {
    process.stderr.write(
      `ERROR: --source ${args.source} is not available. ScrapeCreators returns an empty tweet list for accounts of this size (verified 2026-09-12), and the X API is spend-gated. bird is the only path.\n`,
    );
    process.exit(1);
  }

  const since = args.since || new Date(Date.now() - args.days * 86_400_000).toISOString();
  process.stderr.write(`Pulling @${handle} back to ${since.slice(0, 10)}…\n`);

  const rawTweets = pullTimeline(handle, since, args.rounds);
  if (!rawTweets.length) {
    process.stderr.write('No posts returned. Is bird authenticated (browser cookies) and the handle correct?\n');
    process.exit(1);
  }

  const { rows, dropped } = normalizeTimeline(rawTweets, {
    handle,
    tzOffsetHours: args.tz,
    lanes: args.lanes,
    since,
  });
  const stats = summarizeCorpus(rows, { handle });
  // Derived here, at ingest, because it is the one artifact that needs the raw
  // rows — and the rows are not stored.
  const watchlist = deriveWatchlist(rows, { ownHandle: handle });

  const meta = {
    source: 'bird',
    posts: rows.length,
    droppedRows: dropped,
    firstDate: stats.cadence.firstDate,
    lastDate: stats.cadence.lastDate,
    tzOffsetHours: args.tz,
    since,
    clientId: args.client || null,
    watchlistAccounts: watchlist.accounts.length,
    watchlistCoverage: watchlist.meta.coverageAchieved,
  };

  process.stdout.write(`\n@${handle} — ${rows.length} posts over ${stats.cadence.activeDays} active days\n`);
  process.stdout.write(`  ${stats.cadence.postsPerActiveDay}/day  ·  ${stats.cadence.authoredPerActiveDay} authored/day  ·  ${stats.cadence.postsPerOccupiedHour}/occupied hour\n`);
  process.stdout.write(`  authored ${stats.authoredShare}%  ·  stranger-eligible ${stats.strangerEligibleShare}%  ·  views coverage ${Math.round((stats.base.viewsCoverage ?? 0) * 100)}%\n`);
  process.stdout.write(`  untagged ${Math.round((untaggedShare(rows) ?? 0) * 100)}% (45–55% is normal)\n`);
  process.stdout.write(`  watchlist: ${watchlist.accounts.length} accounts covering ${Math.round(watchlist.meta.coverageAchieved * 100)}% of quote-derived likes\n`);
  const byType = Object.entries(stats.byType).sort((a, b) => b[1].n - a[1].n);
  for (const [type, cell] of byType) {
    process.stdout.write(`    ${type.padEnd(20)} n=${String(cell.n).padStart(4)}  ${String(cell.share).padStart(5)}%  lift ${cell.lift}\n`);
  }

  if (args.out) {
    writeFileSync(args.out, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
    process.stderr.write(`\nWrote ${rows.length} normalized rows -> ${args.out}\n`);
  }

  if (!args.write) {
    process.stdout.write('\nDry run. Re-run with --write to persist the stat block to x_corpora/.\n');
    return;
  }

  const { saveCorpus } = await import('../../features/x-benchmark/store.js');
  await saveCorpus(handle, { stats, watchlistSeed: watchlist.accounts, meta });
  process.stdout.write(`\nSaved x_corpora/${handle.toLowerCase()} (stat block only — rows are not stored).\n`);
}

main().catch((err) => {
  process.stderr.write(`${err?.stack || err}\n`);
  process.exit(1);
});
