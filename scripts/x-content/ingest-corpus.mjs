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

import { writeFileSync } from 'node:fs';
import { untaggedShare } from '../../features/x-benchmark/taxonomy.js';
import { ingestHandle, createBirdRunner, resolveBird, DEFAULT_DAYS, MAX_ROUNDS } from '../../features/x-strategy/ingest.js';

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

  // Paging, cutoff, normalize -> summarize -> watchlist all live in features/x-strategy/ingest.js (shared with the
  // strategy refresh path). This wrapper keeps argv, the stdout summary, --out, --write and exit codes.
  let result;
  try {
    result = await ingestHandle({
      handle,
      tz: args.tz,
      days: args.days,
      since: args.since,
      rounds: args.rounds,
      lanes: args.lanes,
      clientId: args.client,
      runBird: createBirdRunner({ bird: resolveBird() }),
      log: (line) => process.stderr.write(`${line}\n`),
    });
  } catch (err) {
    if (err?.code === 'NO_POSTS') {
      process.stderr.write('No posts returned. Is bird authenticated (browser cookies) and the handle correct?\n');
      process.exit(1);
    }
    throw err;
  }
  const { rows, stats, watchlist, meta } = result;

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
