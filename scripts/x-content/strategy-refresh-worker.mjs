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
import { execFile } from 'node:child_process';
import { createFirestoreQuoteScanQueue, SCAN_STATUS } from '../../features/x-quote-targets/scan-queue.js';

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

// Refresh "Quote targets" (Mac source): run the same free bird scan the 6:30 launchd job runs, for one client.
const SCAN_TIMEOUT_MS = 10 * 60 * 1000;
function runQuoteScan(clientId) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(REPO, 'scripts/x-content/scan-quote-targets.mjs'), '--client', clientId, '--write'],
      { cwd: REPO, timeout: SCAN_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ ok: !err, code: err?.code ?? 0, output: `${stdout || ''}\n${stderr || ''}` }));
  });
}

/** Claim + run queued quote scans (one per pass is plenty: each takes a few minutes and X rate-limits bursts). */
async function drainQuoteScans(db) {
  const queue = createFirestoreQuoteScanQueue(db);
  const job = await queue.claimNext();
  if (!job) return null;
  log(`[${new Date().toISOString()}] quote scan ${job.id} for ${job.clientId}`);
  const run = await runQuoteScan(job.clientId);
  const snap = await db.collection('dashboard_state').doc(job.clientId).get().catch(() => null);
  const q = snap?.exists ? snap.data()?.marketingBrief?.quoteTargets || {} : {};
  const rateLimited = /\b429\b|rate.?limit/i.test(run.output) && !(q.candidates || []).length;
  const status = run.ok ? (rateLimited ? SCAN_STATUS.RATE_LIMITED : SCAN_STATUS.DONE) : SCAN_STATUS.FAILED;
  const result = {
    candidates: Array.isArray(q.candidates) ? q.candidates.length : 0,
    scanned: q.scanned ?? null, succeeded: q.succeeded ?? null, generatedAt: q.generatedAt || null,
    note: /no watchlist saved/.test(run.output) ? 'No watchlist saved for this client: add watched accounts first.' : null,
  };
  await queue.finish(job.id, job.leaseId, { status, result, ...(run.ok ? {} : { error: run.output.trim().split('\n').slice(-3).join(' ').slice(0, 300) }) });
  log(`[${new Date().toISOString()}] quote scan ${job.id} -> ${status} (${result.candidates} candidates)`);
  return { id: job.id, status };
}

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
    const scan = await drainQuoteScans(db).catch((err) => { log(`quote scan drain failed: ${err?.message}`); return null; });
    if (scan) await beat(scan.id);
    if (args.once) break;
    await sleep(args.loop * 1000);
  } while (true); // eslint-disable-line no-constant-condition
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`${err?.stack || err}\n`);
  process.exit(1);
});
