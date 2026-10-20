#!/usr/bin/env node
// X Strategy refresh worker: drains x_strategy_refresh_requests/* on the Mac (where bird + browser cookies live).
// Plan: docs/plans/X-STRATEGY-TAB-MASTER-PLAN.md T1b.
//
// Usage:
//   node scripts/x-content/strategy-refresh-worker.mjs --once              # drain whatever is queued, then exit
//   node scripts/x-content/strategy-refresh-worker.mjs --loop 300          # drain every 300s until killed
//
// Reads/writes: x_strategy_refresh_requests/*, (via the corpus store) x_corpora/{handle}/rows/*, and the own-post
// metrics snapshots x_recent_posts/{clientId}__{handle} (hourly, or on request from get_recent_posts).
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
import { createFirestoreQuoteScanQueue, SCAN_STATUS, SCAN_MODES } from '../../features/x-quote-targets/scan-queue.js';
import { createAsyncBirdRunner, resolveBird, classifyBirdError } from '../../features/x-strategy/ingest.js';
import { createRecentPostsReader, createFirestoreRecentPostsStore, recentPullDue } from '../../features/x-strategy/recent-posts.js';

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
const HOT_SCAN_TIMEOUT_MS = 25 * 60 * 1000; // includes the --if-stale lane-graph refresh the hot scan runs first
function runQuoteScan(clientId, mode = SCAN_MODES.QUOTE) {
  // 'hot' = the hot quote scan (judged breakout picks); anything else = the legacy watchlist scan
  const script = mode === SCAN_MODES.HOT ? 'hot-quote-scan.mjs' : 'scan-quote-targets.mjs';
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(REPO, 'scripts/x-content/', script), '--client', clientId, '--write'],
      { cwd: REPO, timeout: mode === SCAN_MODES.HOT ? HOT_SCAN_TIMEOUT_MS : SCAN_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ ok: !err, code: err?.code ?? 0, output: `${stdout || ''}\n${stderr || ''}` }));
  });
}

// Weekly lane-graph refresh: after a finished scan the builder re-runs only when the stored graph is >= 7 days old
// (--if-stale), so it rides the existing 60s launchd job instead of needing its own. Failure/429 never affects the scan.
const LANE_GRAPH_TIMEOUT_MS = 15 * 60 * 1000;
function runLaneGraphRefresh(clientId) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(REPO, 'scripts/x-content/build-lane-graph.mjs'), '--client', clientId, '--write', '--if-stale'],
      { cwd: REPO, timeout: LANE_GRAPH_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ ok: !err, output: `${stdout || ''}\n${stderr || ''}` }));
  });
}

/** Claim + run queued quote scans (one per pass is plenty: each takes a few minutes and X rate-limits bursts). */
async function drainQuoteScans(db) {
  const queue = createFirestoreQuoteScanQueue(db);
  const job = await queue.claimNext();
  if (!job) return null;
  const mode = job.mode === SCAN_MODES.HOT ? SCAN_MODES.HOT : SCAN_MODES.QUOTE;
  log(`[${new Date().toISOString()}] ${mode} scan ${job.id} for ${job.clientId}`);
  const startedAt = Date.now();
  const run = await runQuoteScan(job.clientId, mode);
  const snap = await db.collection('dashboard_state').doc(job.clientId).get().catch(() => null);
  const brief = snap?.exists ? snap.data()?.marketingBrief || {} : {};
  let status;
  let result;
  if (mode === SCAN_MODES.HOT) {
    const h = brief.hotQuotes || {};
    const fresh = Date.parse(h.scannedAt || '') >= startedAt - 1000;
    const picks = [...(h.picks?.design || []), ...(h.picks?.music || [])];
    status = run.ok ? SCAN_STATUS.DONE : (/\b429\b|rate.?limit/i.test(run.output) ? SCAN_STATUS.RATE_LIMITED : SCAN_STATUS.FAILED);
    result = fresh
      ? { mode, picks: picks.length, quotesLeftToday: h.quotesLeftToday ?? null, costUsd: h.costUsd ?? null, scannedAt: h.scannedAt }
      : { mode, picks: 0, scannedAt: null };
  } else {
    const q = brief.quoteTargets || {};
    const rateLimited = /\b429\b|rate.?limit/i.test(run.output) && !(q.candidates || []).length;
    status = run.ok ? (rateLimited ? SCAN_STATUS.RATE_LIMITED : SCAN_STATUS.DONE) : SCAN_STATUS.FAILED;
    result = {
      candidates: Array.isArray(q.candidates) ? q.candidates.length : 0,
      scanned: q.scanned ?? null, succeeded: q.succeeded ?? null, generatedAt: q.generatedAt || null,
      note: /no watchlist saved/.test(run.output) ? 'No watchlist saved for this client: add watched accounts first.' : null,
    };
  }
  await queue.finish(job.id, job.leaseId, { status, result, ...(run.ok ? {} : { error: run.output.trim().split('\n').slice(-3).join(' ').slice(0, 300) }) });
  log(`[${new Date().toISOString()}] ${mode} scan ${job.id} -> ${status} (${mode === SCAN_MODES.HOT ? `${result.picks} picks` : `${result.candidates} candidates`})`);
  // The hot scan refreshes a stale lane graph itself; only the legacy scan needs the worker to do it.
  if (status === SCAN_STATUS.DONE && mode === SCAN_MODES.QUOTE) {
    const graph = await runLaneGraphRefresh(job.clientId);
    log(`[${new Date().toISOString()}] lane graph ${job.clientId}: ${graph.ok ? graph.output.trim().split('\n').slice(-1)[0] : `failed ${graph.output.trim().split('\n').slice(-1)[0]}`}`);
  }
  return { id: job.id, status };
}

// Own-post metrics (get_recent_posts): hourly per client with an X handle, or sooner when a reader asked. One bird
// user-tweets call per client (free, read-only). Scheduled pulls skip 06:20-06:50 CT so they never compete with the
// 06:30 hot scan for the bird rate limit; a requested pull always runs.
const CT = 'America/Chicago';
function inScanQuietWindow(ms) {
  const [h, m] = new Intl.DateTimeFormat('en-US', { timeZone: CT, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms)).split(':').map(Number);
  const min = h * 60 + m;
  return min >= 6 * 60 + 20 && min < 6 * 60 + 50;
}

async function pullRecentPosts(db) {
  const snap = await db.collection('client_configs').where('marketingBriefConfig.xGrowth.ownHandle', '>', '').get();
  const store = createFirestoreRecentPostsStore(db);
  const runBird = createAsyncBirdRunner({ bird: resolveBird(), cookieSource: process.env.X_STRATEGY_BIRD_COOKIE_SOURCE || 'chrome' });
  const out = [];
  for (const doc of snap.docs) {
    const clientId = doc.id;
    const handle = String(doc.data()?.marketingBriefConfig?.xGrowth?.ownHandle || '').replace(/^@+/, '').toLowerCase();
    if (!/^\w{1,15}$/.test(handle)) continue;
    const key = `${clientId}__${handle}`;
    const now = Date.now();
    const prev = await store.get(key).catch(() => null);
    const due = recentPullDue(prev, now);
    if (!due || (due === 'scheduled' && inScanQuietWindow(now))) continue;
    // ttlMs 0: this reader always pulls live; it writes the snapshot (with carried-forward checkpoints) on success.
    const read = createRecentPostsReader({ runBird, store, ttlMs: 0 });
    const r = await read({ clientId, handle, hours: 168 }).catch((err) => ({ available: false, reason: String(err?.message || err) }));
    if (r.source === 'bird-live') {
      out.push({ clientId, handle, due, ok: true, posts: r.count, needsMetrics: r.needsMetrics?.length ?? 0 });
    } else {
      const message = String(r.caveats?.find((c) => /live pull failed/.test(c)) || r.reason || 'pull failed').slice(0, 200);
      await store.markFailed(key, { at: now, due, kind: classifyBirdError({ message }), message }).catch(() => {});
      out.push({ clientId, handle, due, ok: false, error: message });
      if (/rate-limited/.test(message)) break; // one 429 is enough for this pass
    }
  }
  return out;
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
    const pulls = await pullRecentPosts(db).catch((err) => { log(`recent-posts pull failed: ${err?.message}`); return []; });
    if (pulls.length) log(`[${new Date().toISOString()}] recent posts ${JSON.stringify(pulls)}`);
    if (args.once) break;
    await sleep(args.loop * 1000);
  } while (true); // eslint-disable-line no-constant-condition
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`${err?.stack || err}\n`);
  process.exit(1);
});
