#!/usr/bin/env node
// Pull an account's recent posts WITH views through `bird` and (optionally) store the snapshot get_recent_posts serves.
//
// WHY THIS RUNS ON THE MAC: bird authenticates with the browser's x.com cookies, so it cannot run on Vercel.
// The chat tool get_recent_posts reads the Firestore snapshot this writes (x_recent_posts/{clientId}__{handle});
// where bird can run in-process (X_STRATEGY_LOCAL_INGEST=1) the tool pulls live and writes the same snapshot.
//
// COST: zero. One `bird user-tweets --json-full` call (read-only). No X API, no ScrapeCreators, no LLM.
//
// Usage:
//   node scripts/x-content/pull-recent-posts.mjs --handle bai_ee                      # dry run: prints the tool result
//   node scripts/x-content/pull-recent-posts.mjs --handle bai_ee --client <id> --write # also stores the snapshot
//   --hours 48   look-back window of the printed result (default 48, max 168)
//   BIRD=/path/to/bird overrides the bird binary; X_STRATEGY_BIRD_COOKIE_SOURCE sets --cookie-source.

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAsyncBirdRunner, resolveBird } from '../../features/x-strategy/ingest.js';
import {
  createRecentPostsReader, createMemoryRecentPostsStore, createFirestoreRecentPostsStore, RECENT_DEFAULT_HOURS,
} from '../../features/x-strategy/recent-posts.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');

function parseArgs(argv) {
  const out = { handle: '', client: '', hours: RECENT_DEFAULT_HOURS, write: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--handle') out.handle = String(argv[++i] || '').replace(/^@+/, '');
    else if (a === '--client') out.client = argv[++i] || '';
    else if (a === '--hours') out.hours = Number(argv[++i]) || RECENT_DEFAULT_HOURS;
    else if (a === '--write') out.write = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!/^\w{1,15}$/.test(args.handle)) {
  console.error('ERROR: --handle <x-handle> is required.');
  process.exit(1);
}
if (args.write && !/^[A-Za-z0-9_-]{3,80}$/.test(args.client)) {
  console.error('ERROR: --write needs --client <clientId> (the snapshot is stored per client).');
  process.exit(1);
}

let store = createMemoryRecentPostsStore();
if (args.write) {
  const require = createRequire(import.meta.url);
  require(path.join(REPO, 'features/not-the-rug-brief/load-env')); // env before firebase-admin
  store = createFirestoreRecentPostsStore(require(path.join(REPO, 'api/_lib/firebase-admin.cjs')).adminDb);
}

const read = createRecentPostsReader({
  runBird: createAsyncBirdRunner({ bird: resolveBird(), cookieSource: process.env.X_STRATEGY_BIRD_COOKIE_SOURCE || undefined }),
  store,
});
const result = await read({ clientId: args.client || 'dry-run', handle: args.handle, hours: args.hours });
console.log(JSON.stringify(result, null, 2));
console.error(args.write ? `snapshot stored: x_recent_posts/${args.client}__${args.handle}` : 'dry run: nothing stored (add --client <id> --write)');
process.exit(result.available === false ? 1 : 0);
