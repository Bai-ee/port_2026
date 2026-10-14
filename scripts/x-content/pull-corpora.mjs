#!/usr/bin/env node
// Per-client benchmark corpus pull (multi-client F3).
//
// For each client: reads client_configs/{id}.marketingBriefConfig.xGrowth.ownHandle + .benchmarkHandles, pulls each
// handle's timeline via `bird` (local, browser cookies: FREE, no X API, no ScrapeCreators, no LLM) and merges the rows
// into the handle-keyed corpus store x_corpora/{handle}/rows/* + x_corpora/{handle}.rowsMeta. Same bird -> row
// conversion as the refresh worker (features/x-strategy/ingest.js ingestHandle). Logic: features/x-strategy/pull-corpora.js.
//
// The committed corpora (docs/audits/{bai-ee,seb-design}-x-corpus.json) stay a home-only seed: this script never
// writes them; it only merges fresh bird rows into Firestore.
//
// Usage:
//   node scripts/x-content/pull-corpora.mjs --client <id>                  # DRY RUN: resolve handles + stored row counts, no bird
//   node scripts/x-content/pull-corpora.mjs --client <id> --fetch          # dry run that pulls via bird, reports row counts, writes nothing
//   node scripts/x-content/pull-corpora.mjs --client <id> --write          # pull + merge-write
//   node scripts/x-content/pull-corpora.mjs --clients a,b,c --write        # sequential, one process
//   node scripts/x-content/pull-corpora.mjs --pilot --write                # clients from env PILOT_CLIENT_IDS
//   Options: --days <n> (history window, default 65) · --delay <ms> (between pulls, default 4000)
//   BIRD=/path/to/bird overrides the bird binary; X_STRATEGY_BIRD_COOKIE_SOURCE sets --cookie-source.
//
// Runs daily after the quote-target scan under the same launchd job (scripts/x-content/scan-and-pull.sh).
// Exit 1 when every client is skipped (no xGrowth handles) or a pulling run got no rows for any handle.

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveScanClients } from '../../features/x-quote-targets/client-watchlist.js';
import { createFirestoreCorpusStore } from '../../features/x-strategy/corpus-store.js';
import { createAsyncBirdRunner, resolveBird } from '../../features/x-strategy/ingest.js';
import { runPull, readClientXGrowth, createBirdFetchTimeline } from '../../features/x-strategy/pull-corpora.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');

export function parseArgs(argv) {
  const out = { write: false, fetch: false, client: '', clients: '', pilot: false, days: 0, delay: 4000 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--write') out.write = true;
    else if (a === '--fetch') out.fetch = true;
    else if (a === '--client') out.client = argv[++i] || '';
    else if (a === '--clients') out.clients = argv[++i] || '';
    else if (a === '--pilot') out.pilot = true;
    else if (a === '--days') out.days = Number(argv[++i]) || 0;
    else if (a === '--delay') out.delay = Number(argv[++i]) || 0;
  }
  return out;
}

async function main() {
  // Env before firebase-admin (or the SDK falls back to application-default creds) and before --pilot reads PILOT_CLIENT_IDS.
  const require = createRequire(import.meta.url);
  require(path.join(REPO, 'features/not-the-rug-brief/load-env'));

  const args = parseArgs(process.argv.slice(2));
  const scope = resolveScanClients(args, process.env);
  if (scope.error) {
    console.error(`ERROR: ${scope.error}`);
    process.exit(1);
  }
  const db = require(path.join(REPO, 'api/_lib/firebase-admin.cjs')).adminDb;
  const log = (line) => console.error(line);
  const pulls = args.write || args.fetch;
  const runBird = pulls ? createAsyncBirdRunner({ bird: resolveBird(), cookieSource: process.env.X_STRATEGY_BIRD_COOKIE_SOURCE || undefined }) : null;

  console.error(`pull-corpora: ${scope.clientIds.length} client(s) · ${args.write ? 'WRITE' : args.fetch ? 'DRY RUN (fetch)' : 'DRY RUN (no bird)'}`);
  const res = await runPull({
    clients: scope.clientIds,
    readXGrowth: (id) => readClientXGrowth(db, id),
    store: createFirestoreCorpusStore(db),
    fetchTimeline: runBird ? createBirdFetchTimeline({ runBird, days: args.days || undefined, log }) : undefined,
    write: args.write,
    fetch: args.fetch,
    delayMs: args.delay,
    log,
  });

  const summary = Object.entries(res.handles).map(([h, r]) => `@${h}:${r.status}${r.pulledRows !== undefined ? `(${r.pulledRows})` : `(stored ${r.storedRows})`}`);
  console.log(`\npull-corpora ${args.write ? 'wrote' : 'dry run'}: ${summary.join(' ') || 'no handles'}` +
    `${res.skippedClients ? ` · ${res.skippedClients} client(s) skipped` : ''}${res.stopped ? ` · stopped: ${res.stopped}` : ''}`);
  if (!args.write) console.log('DRY RUN — nothing written. Add --write to persist.');
  process.exit(res.exitCode);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`ERROR: ${err?.stack || err}`);
    process.exit(1);
  });
}
