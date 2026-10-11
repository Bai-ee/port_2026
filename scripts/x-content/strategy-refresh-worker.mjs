#!/usr/bin/env node
// X Strategy refresh worker: drains x_strategy_refresh_requests/* on the Mac (where bird + browser cookies live).
// Plan: docs/plans/X-STRATEGY-TAB-MASTER-PLAN.md T1b.
//
// Usage:
//   node scripts/x-content/strategy-refresh-worker.mjs --once              # drain whatever is queued, then exit
//   node scripts/x-content/strategy-refresh-worker.mjs --loop 300          # drain every 300s until killed
//
// Reads/writes: x_strategy_refresh_requests/* and (via the corpus store) x_corpora/{handle}/rows/*.
// bird is the FREE path (browser cookies); no X API, no ScrapeCreators, no model calls. bird detection is
// `bird --version` only. Cookie source: env X_STRATEGY_BIRD_COOKIE_SOURCE (default 'chrome').
// A drain that hits 429 stops the request ('rate-limited'); it does not retry within the same run.

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { createRefreshService, createFirestoreRefreshQueue, recordWorkerSeen } from '../../features/x-strategy/refresh.js';
import { createFirestoreCorpusStore } from '../../features/x-strategy/corpus-store.js';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');

function parseArgs(argv) {
  const out = { once: false, loop: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--once') out.once = true;
    else if (argv[i] === '--loop') out.loop = Number(argv[++i]) || 0;
  }
  return out;
}

function firebase() {
  require(path.join(REPO, 'features/not-the-rug-brief/load-env'));
  return require(path.join(REPO, 'api/_lib/firebase-admin.cjs'));
}

const log = (line) => process.stderr.write(`${line}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.once && !(args.loop > 0)) {
    log('Usage: strategy-refresh-worker.mjs --once | --loop <seconds>');
    process.exit(1);
  }
  const db = firebase().adminDb;
  const svc = createRefreshService({
    store: createFirestoreCorpusStore(db),
    queueStore: createFirestoreRefreshQueue(db),
    enabled: false, // the worker drains explicitly; it never self-triggers from requestRefresh
    log,
  });

  // Heartbeat: x_strategy_workers/{workerId}. Never fatal: a failed write must not stop the drain.
  const workerId = process.env.X_STRATEGY_WORKER_ID || `worker-${os.hostname().toLowerCase().replace(/[^a-z0-9_-]+/g, '-')}`;
  const beat = (requestId = null) => recordWorkerSeen(db, { workerId, now: Date.now(), requestId }).catch((err) => log(`heartbeat failed: ${err?.message}`));

  do {
    await beat();
    const res = await svc.drainQueue();
    log(`[${new Date().toISOString()}] drained ${res.processed}${res.reason ? ` (${res.reason})` : ''}${res.requests.length ? ` ${JSON.stringify(res.requests)}` : ''}`);
    if (res.requests.length) await beat(res.requests[res.requests.length - 1].id);
    if (args.once) break;
    await sleep(args.loop * 1000);
  } while (true); // eslint-disable-line no-constant-condition
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`${err?.stack || err}\n`);
  process.exit(1);
});
