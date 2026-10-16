#!/usr/bin/env node
// Daily scan for posts worth quote-reacting to.
//
// WHY THIS RUNS LOCALLY AND NOT ON VERCEL:
//   `bird` authenticates with the browser's x.com cookies, so it cannot run in
//   a serverless function. It is also the only path that sees fresh posts —
//   ScrapeCreators' /v1/twitter/user-tweets serves X's "most popular" module,
//   which returned **0 posts from the last 24h** for @rare_jpg. The X API can
//   do it in prod but costs 2 metered calls per handle and its spend is
//   invisible to the Operating Cost card.
//
//   So: this runs on the operator's machine, free, and pushes the result to
//   Firestore. The dashboard only ever reads.
//
// COST: zero. No X API, no ScrapeCreators, no LLM.
//
// Usage:
//   node scripts/x-content/scan-quote-targets.mjs --client <id>                 # dry run, one client
//   node scripts/x-content/scan-quote-targets.mjs --client <id> --write
//   node scripts/x-content/scan-quote-targets.mjs --clients a,b,c --write       # sequential, one process
//   node scripts/x-content/scan-quote-targets.mjs --pilot --write               # clients from env PILOT_CLIENT_IDS
//   BIRD=/path/to/bird node scripts/x-content/scan-quote-targets.mjs --client <id> --limit 10
//   node scripts/x-content/scan-quote-targets.mjs --client <id> --dry-run       # explicit alias of the default (no write)
//   node scripts/x-content/scan-quote-targets.mjs --client <id> --dry-run --list design:123456789=Label   # test-only
//
// Track lists (Track Lists -> Daily Signals): each content track in x_strategy_plans/{id} may carry X lists.
// The scan fetches them FIRST with `bird list-timeline <id> -n 100 --json` (1 fetch per list, free) and writes
// dashboard_state/{id}.marketingBrief.listSignals (replaced wholesale). Lists use the same --max-accounts budget
// (default 15): lists first, the watchlist handles get what is left (0 left => handle pass skipped, quoteTargets
// untouched). `--list <trackId>:<listId>[=Label]` (repeatable) injects lists WITHOUT touching the plan and is
// honored ONLY in a dry run (an error with --write).
//
// Per client (multi-client Phase 4.5): each client is scanned against ITS stored watchlist
// (client_configs/{id}.marketingBriefConfig.xGrowth.watchlist) and writes only its own
// dashboard_state/{id}.marketingBrief.quoteTargets. An empty watchlist skips that client (no write);
// there is no shared/default list.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readClientWatchlist, resolveScanClients, selectScanTargets } from '../../features/x-quote-targets/client-watchlist.js';
import { rankQuoteTargets, DEFAULT_WINDOW_HOURS } from '../../features/x-quote-targets/rank.js';
import { planListFetches } from '../../features/x-quote-targets/scan-plan.js';
import {
  collectTrackLists, toCandidate, toListCandidate, trimListPosts, buildListSignalsPayload,
} from '../../features/x-quote-targets/list-signals-scan.js';
import { tracksOf, parseListId, sanitizeListLabel } from '../../features/x-strategy/content-tracks.js';
import { STRATEGY_COLLECTIONS } from '../../features/x-strategy/contracts.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');

function parseArgs(argv) {
  // maxAccounts defaults to 15: a 39-account sweep reliably exhausts X's
  // GraphQL UserTweets budget and returns 429 on most of it, even paced at 4s.
  // Scanning a rotating 15 keeps the run inside the limit; --offset rotates.
  const out = { write: false, client: '', clients: '', pilot: false, forceEmpty: false, limit: 12, perHandle: 12, windowHours: DEFAULT_WINDOW_HOURS, only: '', delay: 4000, retries: 1, maxAccounts: 15, offset: 0, dryRun: false, listOverrides: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--write') out.write = true;
    else if (a === '--client') out.client = argv[++i] || '';
    else if (a === '--clients') out.clients = argv[++i] || '';
    else if (a === '--pilot') out.pilot = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--list') out.listOverrides.push(argv[++i] || '');
    else if (a === '--force-empty') out.forceEmpty = true;
    else if (a === '--limit') out.limit = Number(argv[++i]) || 12;
    else if (a === '--per-handle') out.perHandle = Number(argv[++i]) || 12;
    else if (a === '--window') out.windowHours = Number(argv[++i]) || DEFAULT_WINDOW_HOURS;
    else if (a === '--only') out.only = argv[++i] || '';
    else if (a === '--delay') out.delay = Number(argv[++i]) || 4000;
    else if (a === '--retries') out.retries = Number(argv[++i]) ?? 1;
    else if (a === '--max-accounts') out.maxAccounts = Number(argv[++i]) || 0;
    else if (a === '--offset') out.offset = Number(argv[++i]) || 0;
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

// Env before firebase-admin (or the SDK falls back to application-default creds) and before --pilot reads PILOT_CLIENT_IDS.
const require = createRequire(import.meta.url);
require(path.join(REPO, 'features/not-the-rug-brief/load-env'));

const args = parseArgs(process.argv.slice(2));
if (args.listOverrides.length && args.write) {
  console.error('ERROR: --list is a test-only override and is honored only in a dry run; it cannot be combined with --write.');
  process.exit(1);
}
if (args.dryRun && args.write) {
  console.error('ERROR: --dry-run and --write are contradictory.');
  process.exit(1);
}
const listOverrides = [];
for (const spec of args.listOverrides) {
  const m = String(spec).match(/^([a-z0-9_-]+):([^=]+?)(?:=(.*))?$/i);
  const id = m ? parseListId(m[2]) : null;
  if (!m || !id) {
    console.error(`ERROR: bad --list "${spec}" (expected <trackId>:<listId-or-url>[=Label])`);
    process.exit(1);
  }
  listOverrides.push({ id, label: sanitizeListLabel(m[3]) || `List ${id}`, trackId: m[1] });
}
const scope = resolveScanClients(args, process.env);
if (scope.error) {
  console.error(`ERROR: ${scope.error}`);
  process.exit(1);
}
const BIRD = resolveBird();
if (!BIRD) {
  console.error('ERROR: `bird` not found. Install it and set BIRD=/path/to/bird, e.g.');
  console.error('  mkdir -p ~/.local/birdtool && cd ~/.local/birdtool && npm init -y && npm i @steipete/bird');
  process.exit(1);
}
const fb = require(path.join(REPO, 'api/_lib/firebase-admin.cjs'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * ⚠️ X's GraphQL UserTweets endpoint rate-limits hard. Scanning 39 accounts
 * back-to-back returned 429 on 32 of them. Pace the calls, and treat a 429 as
 * "wait and retry", not "this account failed".
 */
function fetchHandle(handle) {
  const raw = execFileSync(
    BIRD,
    ['user-tweets', `@${handle}`, '-n', String(args.perHandle), '--json'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const start = raw.indexOf('[') === -1 ? raw.indexOf('{') : raw.indexOf('[');
  const parsed = JSON.parse(raw.slice(start));
  return Array.isArray(parsed) ? parsed : parsed.tweets || [];
}

/** One list's recent posts (a list is a single fetch: 100 posts per call). Same output shape as fetchHandle. */
function fetchList(listId) {
  const raw = execFileSync(
    BIRD,
    ['list-timeline', String(listId), '-n', '100', '--json'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const start = raw.indexOf('[') === -1 ? raw.indexOf('{') : raw.indexOf('[');
  const parsed = JSON.parse(raw.slice(start));
  return Array.isArray(parsed) ? parsed : parsed.tweets || [];
}

const RATE_LIMIT_BACKOFF_MS = 90_000;

/**
 * List pass: fetch each list, rank (minEngagement 0 — lists are owner-curated, so low-engagement niches must
 * survive; score still orders them), map, trim. A failed/429 list gets count 0 and never aborts the client.
 * Writes marketingBrief.listSignals (wholesale replace) only with --write. Returns true = this client failed.
 */
async function scanLists(clientId, lists) {
  const byTrack = {};
  let succeeded = 0;
  console.error(`\n[${clientId}] fetching ${lists.length} track list${lists.length === 1 ? '' : 's'} via ${BIRD}`);
  for (const [i, list] of lists.entries()) {
    if (i > 0) await sleep(args.delay);
    let posts = null;
    let status = 'FAILED';
    for (let attempt = 0; attempt <= args.retries; attempt += 1) {
      try {
        posts = fetchList(list.id);
        break;
      } catch (err) {
        const msg = String(err?.stdout || err?.message || err);
        const is429 = /429|rate limit/i.test(msg);
        if (is429 && attempt < args.retries) {
          process.stderr.write(`  list ${list.id}: 429 — backing off ${RATE_LIMIT_BACKOFF_MS / 1000}s\n`);
          await sleep(RATE_LIMIT_BACKOFF_MS);
          continue;
        }
        status = is429 ? 'RATE LIMITED' : `FAILED (${msg.slice(0, 80).replace(/\s+/g, ' ')})`;
        break;
      }
    }
    const slot = (byTrack[list.trackId] ||= { lists: [], posts: [] });
    let kept = [];
    if (posts) {
      succeeded += 1;
      const ranked = rankQuoteTargets(posts, { limit: 100, perAuthor: 100, windowHours: args.windowHours, minEngagement: 0 });
      const mapped = ranked.map((r) => toListCandidate(r, { trackId: list.trackId, listId: list.id }));
      kept = trimListPosts(mapped, { now: Date.now(), windowHours: args.windowHours });
      slot.posts.push(...kept);
      console.log(`  list ${list.id} (${list.label}) → track ${list.trackId}: fetched ${posts.length}, kept ${kept.length}`);
    } else {
      console.error(`  list ${list.id} (${list.label}) → track ${list.trackId}: ${status}`);
    }
    slot.lists.push({ id: list.id, label: list.label, fetchedAt: new Date().toISOString(), count: kept.length });
  }
  for (const [trackId, slot] of Object.entries(byTrack)) {
    slot.posts.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    console.log(`  track ${trackId}: ${slot.posts.length} kept across ${slot.lists.length} list${slot.lists.length === 1 ? '' : 's'}`);
  }

  if (!args.write) {
    console.log(`\n[${clientId}] DRY RUN — listSignals not written. Add --write to persist.`);
    return false;
  }
  if (lists.length > 0 && succeeded === 0) {
    console.error(`\n[${clientId}] ERROR: all ${lists.length} lists failed — refusing to overwrite the stored listSignals.`);
    console.error('  Fix the cause and re-run. Use --force-empty only if you genuinely want to clear it.');
    if (!args.forceEmpty) return true;
  }
  const payload = buildListSignalsPayload({ generatedAt: new Date().toISOString(), byTrack });
  // mergeFields on the dotted path REPLACES listSignals wholesale (no deep-merge of byTrack), so removed tracks don't linger.
  await fb.adminDb
    .collection('dashboard_state')
    .doc(clientId)
    .set({ marketingBrief: { listSignals: payload } }, { mergeFields: ['marketingBrief.listSignals'] });
  console.log(`\n[${clientId}] wrote listSignals (${Object.keys(byTrack).length} tracks) to dashboard_state/${clientId}.marketingBrief.listSignals`);
  return false;
}

/** Scan one client against its own watchlist; returns an exit-worthy failure flag (true = this client failed). */
async function scanClient(clientId) {
  const watchlist = await readClientWatchlist(fb.adminDb, clientId);
  let allLists;
  if (listOverrides.length) {
    allLists = listOverrides;
  } else {
    const planSnap = await fb.adminDb.collection(STRATEGY_COLLECTIONS.plans).doc(clientId).get();
    allLists = collectTrackLists(tracksOf(planSnap.exists ? planSnap.data() : null));
  }
  if (!watchlist.length && !allLists.length) {
    console.error(`\n[${clientId}] no watchlist saved (client_configs/${clientId}.marketingBriefConfig.xGrowth.watchlist) and no track lists — skipped, nothing written.`);
    skippedNoWatchlist += 1;
    return false;
  }

  // Budget: a list = 1 fetch, lists first; handles get the remainder. --max-accounts 0 keeps its "no cap" meaning.
  const noCap = !args.maxAccounts;
  const planned = noCap ? { lists: allLists, handleBudget: 0 } : planListFetches(allLists, args.maxAccounts);
  let listsFailed = false;
  if (planned.lists.length) listsFailed = await scanLists(clientId, planned.lists);

  // selectScanTargets treats maxAccounts 0 as "no cap", so a spent budget must skip the handle pass, not pass 0.
  if (!watchlist.length) return listsFailed;
  if (!noCap && planned.handleBudget === 0 && !args.only) {
    console.error(`\n[${clientId}] list fetches used the whole ${args.maxAccounts}-fetch budget — handle pass skipped, quoteTargets untouched.`);
    return listsFailed;
  }
  const handleFailed = await scanHandles(clientId, watchlist, noCap ? 0 : planned.handleBudget);
  return listsFailed || handleFailed;
}

/** Handle pass (the original scan): returns true = this client failed. */
async function scanHandles(clientId, watchlist, handleBudget) {
  const targets = selectScanTargets(watchlist, { ...args, maxAccounts: handleBudget });
  if (!targets.length) {
    console.error(`\n[${clientId}] nothing to scan${args.only ? ` (@${args.only.replace(/^@/, '')} is not on this client's watchlist)` : ''} — skipped, nothing written.`);
    return false;
  }
  console.error(`\n[${clientId}] scanning ${targets.length} of ${watchlist.length} accounts via ${BIRD}` +
    `${args.offset ? ` (offset ${args.offset})` : ''}`);

  const pool = [];
  const failures = [];
  const rateLimited = [];

  for (const [i, acct] of targets.entries()) {
    if (i > 0) await sleep(args.delay);

    let posts = null;
    for (let attempt = 0; attempt <= args.retries; attempt += 1) {
      try {
        posts = fetchHandle(acct.handle);
        break;
      } catch (err) {
        const msg = String(err?.stdout || err?.message || err);
        const is429 = /429|rate limit/i.test(msg);
        if (is429 && attempt < args.retries) {
          process.stderr.write(`  @${acct.handle}: 429 — backing off ${RATE_LIMIT_BACKOFF_MS / 1000}s\n`);
          await sleep(RATE_LIMIT_BACKOFF_MS);
          continue;
        }
        if (is429) rateLimited.push(acct.handle);
        else failures.push({ handle: acct.handle, error: msg.slice(0, 120) });
        break;
      }
    }

    if (posts) {
      pool.push(...posts);
      process.stderr.write(`  @${acct.handle}: ${posts.length}\n`);
    } else {
      process.stderr.write(`  @${acct.handle}: ${rateLimited.includes(acct.handle) ? 'RATE LIMITED' : 'FAILED'}\n`);
    }
  }

  const ranked = rankQuoteTargets(pool, { limit: args.limit, windowHours: args.windowHours, watchlist });

  const candidates = ranked.map(toCandidate);

  const payload = {
    generatedAt: new Date().toISOString(),
    method: 'bird user-tweets (local, free)',
    windowHours: args.windowHours,
    scanned: targets.length,
    succeeded: targets.length - failures.length - rateLimited.length,
    pooled: pool.length,
    failures,
    rateLimited,
    candidates,
  };

  console.log(`\n[${clientId}] pooled ${pool.length} posts from ${payload.succeeded}/${targets.length} accounts` +
    `${rateLimited.length ? `, ${rateLimited.length} rate-limited` : ''}` +
    `${failures.length ? `, ${failures.length} failed` : ''}\n`);
  if (rateLimited.length) {
    console.log(`⚠️  rate-limited: ${rateLimited.map((h) => '@' + h).join(', ')}`);
    console.log('    re-run with a larger --delay, or scan in two passes.\n');
  }
  console.log(`=== [${clientId}] top ${candidates.length} quote-react candidates (window ${args.windowHours}h) ===`);
  candidates.forEach((c, i) => {
    console.log(`\n${String(i + 1).padStart(2)}. ${c.score.toFixed(3)}  @${c.author}  ${c.ageHours}h  ${c.velocity}/h  ${c.engagement} eng`);
    console.log(`    ${c.text.slice(0, 96)}`);
    console.log(`    ${c.reasons.join(' · ')}`);
    if (c.url) console.log(`    ${c.url}`);
  });

  if (!args.write) {
    console.log(`\n[${clientId}] DRY RUN — nothing written. Add --write to persist.`);
    return false;
  }

  // ⚠️ A sweep where EVERY account failed is an environment problem, not a quiet
  // window, and writing it replaces a good scan with an empty one — which is
  // exactly what a broken launchd PATH did here for weeks while reporting a
  // clean run. A genuinely empty window still writes: it has successes, just no
  // candidates worth quoting.
  if (targets.length > 0 && payload.succeeded === 0) {
    console.error(`\n[${clientId}] ERROR: all ${targets.length} accounts failed — refusing to overwrite the stored scan with an empty one.`);
    if (failures.length) console.error(`  first error: ${failures[0].error}`);
    console.error('  Fix the cause and re-run. Use --force-empty only if you genuinely want to clear it.');
    if (!args.forceEmpty) return true;
  }

  await fb.adminDb
    .collection('dashboard_state')
    .doc(clientId)
    .set({ marketingBrief: { quoteTargets: payload } }, { merge: true });

  console.log(`\n[${clientId}] wrote ${candidates.length} candidates to dashboard_state/${clientId}.marketingBrief.quoteTargets`);
  return false;
}

// Sequential on purpose: the bird rate limit is shared, so clients never scan in parallel.
let failed = 0;
let skippedNoWatchlist = 0;
for (const [i, clientId] of scope.clientIds.entries()) {
  if (i > 0) await sleep(args.delay);
  try {
    if (await scanClient(clientId)) failed += 1;
  } catch (err) {
    failed += 1;
    console.error(`\n[${clientId}] ERROR: ${String(err?.message || err).slice(0, 200)}`);
  }
}
// Every requested client lacking a watchlist is a misconfiguration (e.g. the home seed never ran), not a quiet day:
// exit non-zero so the launchd log shows it instead of quoteTargets silently going stale.
if (failed || skippedNoWatchlist === scope.clientIds.length) process.exit(1);
