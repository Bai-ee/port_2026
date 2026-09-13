#!/usr/bin/env node
// Scan quote targets for every enrolled client in ONE rate-limited sweep.
//
// scan-quote-targets.mjs scans one client against the hand-written watchlist.
// This is the multi-client form: it reads each enrolled client's profile,
// resolves their watchlist from their benchmark's ingested corpus, fetches each
// unique account ONCE under a shared budget, and fans the pool back out per
// client.
//
// ⚠️ The budget is shared because rate limit is the scarce resource, not time:
// a 39-account sweep returned 429 on 32 of them. N clients scanning
// independently would multiply that; this does not.
//
// ⚠️ LOCAL ONLY — `bird` needs the browser's x.com cookies. Same constraint as
// every other scan path in this repo.
//
// Usage:
//   node scripts/x-content/scan-all-clients.mjs                    # dry run, all enrolled
//   node scripts/x-content/scan-all-clients.mjs --write
//   node scripts/x-content/scan-all-clients.mjs --clients a,b --budget 10 --offset 5

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { rankQuoteTargets } from '../../features/x-quote-targets/rank.js';
import { buildScanPlan, partitionPool, DEFAULT_BUDGET } from '../../features/x-quote-targets/scan-plan.js';
import { WATCHLIST } from '../../features/x-quote-targets/watchlist.js';
import { mergeWatchlist } from '../../features/x-benchmark/derive-watchlist.js';
import { resolveXGrowthProfile } from '../../features/x-benchmark/profile.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RATE_LIMIT_BACKOFF_MS = 90_000;

function parseArgs(argv) {
  const out = { budget: DEFAULT_BUDGET, offset: 0, delay: 4000, perHandle: 12, limit: 12, retries: 1 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--clients') out.clients = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--budget') out.budget = Number(argv[++i]) || DEFAULT_BUDGET;
    else if (a === '--offset') out.offset = Number(argv[++i]) || 0;
    else if (a === '--delay') out.delay = Number(argv[++i]) || 4000;
    else if (a === '--per-handle') out.perHandle = Number(argv[++i]) || 12;
    else if (a === '--limit') out.limit = Number(argv[++i]) || 12;
    else if (a === '--write') out.write = true;
  }
  return out;
}

function resolveBird() {
  if (process.env.BIRD && existsSync(process.env.BIRD)) return process.env.BIRD;
  const candidates = [
    path.join(process.env.HOME || '', '.local/birdtool/node_modules/.bin/bird'),
    path.join(REPO, 'node_modules/.bin/bird'),
  ];
  return candidates.find((p) => existsSync(p)) || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = parseArgs(process.argv.slice(2));
const BIRD = resolveBird();
if (!BIRD) {
  process.stderr.write('ERROR: `bird` not found. Set BIRD=/path/to/bird.\n');
  process.exit(1);
}

const require = createRequire(import.meta.url);
require(path.join(REPO, 'features/not-the-rug-brief/load-env'));
const fb = require(path.join(REPO, 'api/_lib/firebase-admin.cjs'));

/** Clients with the X growth profile switched on. */
async function loadEnrolledClients() {
  const snap = await fb.adminDb.collection('client_configs').get();
  const out = [];
  for (const doc of snap.docs) {
    const config = doc.data()?.marketingBriefConfig?.xGrowth;
    if (!config?.enabled) continue;
    if (args.clients && !args.clients.includes(doc.id)) continue;
    const profile = resolveXGrowthProfile({ config });
    if (!profile.ready) {
      process.stderr.write(`  skipping ${doc.id}: profile incomplete (${profile.missing.join(', ')})\n`);
      continue;
    }
    out.push({ clientId: doc.id, profile });
  }
  return out;
}

/**
 * A client's quote targets: the watchlist derived from their benchmark's
 * corpus, plus any curated entries. @bai_ee's hand-written WATCHLIST is used as
 * the curated set only for the client whose benchmark produced it — for
 * everyone else it would be someone else's taste.
 */
async function loadAccountsFor(profile) {
  const derived = [];
  for (const handle of profile.benchmarkHandles) {
    const snap = await fb.adminDb.collection('x_corpora').doc(handle.toLowerCase()).get();
    const seed = snap.exists ? snap.data()?.watchlistSeed : null;
    if (Array.isArray(seed)) derived.push(...seed);
  }
  const curated = profile.benchmarkHandles.some((h) => h.toLowerCase() === 'seb__design') ? WATCHLIST : [];
  return mergeWatchlist(derived, curated);
}

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

async function main() {
  const clients = await loadEnrolledClients();
  if (!clients.length) {
    process.stdout.write('No enrolled clients with a complete X growth profile.\n');
    return;
  }

  const withAccounts = [];
  for (const client of clients) {
    const accounts = await loadAccountsFor(client.profile);
    if (!accounts.length) {
      process.stderr.write(`  ${client.clientId}: no watchlist — has the benchmark corpus been ingested?\n`);
      continue;
    }
    withAccounts.push({ ...client, accounts });
  }

  const plan = buildScanPlan(withAccounts, { budget: args.budget, offset: args.offset });
  process.stdout.write(
    `${plan.meta.clients} clients · ${plan.meta.uniqueAccounts} unique accounts · fetching ${plan.meta.plannedFetches} `
    + `(per-client sweeps would have fetched ${plan.meta.naiveFetches})\n\n`,
  );
  if (plan.meta.starvedClients.length) {
    process.stdout.write(`⚠️  no accounts in this sweep for: ${plan.meta.starvedClients.join(', ')} — raise --budget or rotate --offset\n\n`);
  }

  const pool = [];
  const failures = [];
  const rateLimited = [];

  for (const [i, account] of plan.fetch.entries()) {
    if (i > 0) await sleep(args.delay);
    let posts = null;
    for (let attempt = 0; attempt <= args.retries; attempt += 1) {
      try {
        posts = fetchHandle(account.handle);
        break;
      } catch (err) {
        const msg = String(err?.stdout || err?.message || err);
        const is429 = /429|rate limit/i.test(msg);
        if (is429 && attempt < args.retries) {
          process.stderr.write(`  @${account.handle}: 429 — backing off ${RATE_LIMIT_BACKOFF_MS / 1000}s\n`);
          await sleep(RATE_LIMIT_BACKOFF_MS);
          continue;
        }
        if (is429) rateLimited.push(account.handle);
        else failures.push({ handle: account.handle, error: msg.slice(0, 120) });
        break;
      }
    }
    if (posts) {
      pool.push(...posts);
      process.stderr.write(`  @${account.handle}: ${posts.length} (for ${account.clients.join(', ')})\n`);
    } else {
      process.stderr.write(`  @${account.handle}: ${rateLimited.includes(account.handle) ? 'RATE LIMITED' : 'FAILED'}\n`);
    }
  }

  const split = partitionPool(pool, plan);
  const generatedAt = new Date().toISOString();
  const results = [];

  for (const client of withAccounts) {
    const posts = split[client.clientId] ?? [];
    const ranked = rankQuoteTargets(posts, { limit: args.limit });
    const payload = {
      generatedAt,
      method: 'bird user-tweets (local, free, shared sweep)',
      scanned: plan.fetch.filter((a) => a.clients.includes(client.clientId)).length,
      succeeded: plan.fetch.filter((a) => a.clients.includes(client.clientId)).length - failures.length - rateLimited.length,
      pooled: posts.length,
      failures,
      rateLimited,
      candidates: ranked.map((r) => ({
        id: r.post.id,
        url: r.post.author?.username && r.post.id ? `https://x.com/${r.post.author.username}/status/${r.post.id}` : null,
        author: r.post.author?.username || null,
        authorName: r.post.author?.name || null,
        text: String(r.post.text || '').replace(/\s+/g, ' ').slice(0, 280),
        createdAt: r.post.createdAt || null,
        ageHours: r.ageHours,
        likes: r.post.likeCount ?? 0,
        reposts: r.post.retweetCount ?? 0,
        replies: r.post.replyCount ?? 0,
        engagement: r.engagement,
        velocity: r.velocity,
        windowOpen: r.windowOpen,
        vein: r.vein,
        hasMedia: r.hasMedia,
        score: r.score,
        reasons: r.reasons,
      })),
    };
    results.push({ clientId: client.clientId, payload });
    process.stdout.write(`${client.clientId}: ${payload.candidates.length} candidates from ${posts.length} posts\n`);
  }

  if (!args.write) {
    process.stdout.write('\nDRY RUN — nothing written. Add --write to persist.\n');
    return;
  }

  for (const { clientId, payload } of results) {
    // Same guard as the single-client scan: a client whose every account
    // failed must not have its stored scan replaced by an empty one.
    if (payload.scanned > 0 && payload.succeeded === 0) {
      process.stderr.write(`  ${clientId}: every account failed — keeping the previous scan\n`);
      continue;
    }
    await fb.adminDb.collection('dashboard_state').doc(clientId)
      .set({ marketingBrief: { quoteTargets: payload } }, { merge: true });
    process.stdout.write(`wrote dashboard_state/${clientId}.marketingBrief.quoteTargets\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`${err?.stack || err}\n`);
  process.exit(1);
});
