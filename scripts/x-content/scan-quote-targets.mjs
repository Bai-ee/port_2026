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
//   node scripts/x-content/scan-quote-targets.mjs                       # dry run
//   node scripts/x-content/scan-quote-targets.mjs --client <id> --write
//   BIRD=/path/to/bird node scripts/x-content/scan-quote-targets.mjs --limit 10

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WATCHLIST } from '../../features/x-quote-targets/watchlist.js';
import { rankQuoteTargets, DEFAULT_WINDOW_HOURS } from '../../features/x-quote-targets/rank.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');

function parseArgs(argv) {
  // maxAccounts defaults to 15: a 39-account sweep reliably exhausts X's
  // GraphQL UserTweets budget and returns 429 on most of it, even paced at 4s.
  // Scanning a rotating 15 keeps the run inside the limit; --offset rotates.
  const out = { write: false, client: '', limit: 12, perHandle: 12, windowHours: DEFAULT_WINDOW_HOURS, only: '', delay: 4000, retries: 1, maxAccounts: 15, offset: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--write') out.write = true;
    else if (a === '--client') out.client = argv[++i] || '';
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

const args = parseArgs(process.argv.slice(2));
const BIRD = resolveBird();
if (!BIRD) {
  console.error('ERROR: `bird` not found. Install it and set BIRD=/path/to/bird, e.g.');
  console.error('  mkdir -p ~/.local/birdtool && cd ~/.local/birdtool && npm init -y && npm i @steipete/bird');
  process.exit(1);
}

function selectTargets() {
  if (args.only) {
    return WATCHLIST.filter((a) => a.handle.toLowerCase() === args.only.replace(/^@/, '').toLowerCase());
  }
  // Proven accounts first, then the unproven Bryan-specific veins, so a
  // truncated scan always keeps the highest-value half of the list.
  const ordered = [...WATCHLIST].sort((a, b) => Number(!!a.unproven) - Number(!!b.unproven));
  if (!args.maxAccounts || args.maxAccounts >= ordered.length) return ordered;
  const start = ((args.offset % ordered.length) + ordered.length) % ordered.length;
  return Array.from({ length: args.maxAccounts }, (_, i) => ordered[(start + i) % ordered.length]);
}

const targets = selectTargets();

console.error(`scanning ${targets.length} of ${WATCHLIST.length} accounts via ${BIRD}` +
  `${args.offset ? ` (offset ${args.offset})` : ''}`);

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

const RATE_LIMIT_BACKOFF_MS = 90_000;
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

const ranked = rankQuoteTargets(pool, { limit: args.limit, windowHours: args.windowHours });

const candidates = ranked.map((r) => ({
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
}));

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

console.log(`\npooled ${pool.length} posts from ${payload.succeeded}/${targets.length} accounts` +
  `${rateLimited.length ? `, ${rateLimited.length} rate-limited` : ''}` +
  `${failures.length ? `, ${failures.length} failed` : ''}\n`);
if (rateLimited.length) {
  console.log(`⚠️  rate-limited: ${rateLimited.map((h) => '@' + h).join(', ')}`);
  console.log('    re-run with a larger --delay, or scan in two passes.\n');
}
console.log(`=== top ${candidates.length} quote-react candidates (window ${args.windowHours}h) ===`);
candidates.forEach((c, i) => {
  console.log(`\n${String(i + 1).padStart(2)}. ${c.score.toFixed(3)}  @${c.author}  ${c.ageHours}h  ${c.velocity}/h  ${c.engagement} eng`);
  console.log(`    ${c.text.slice(0, 96)}`);
  console.log(`    ${c.reasons.join(' · ')}`);
  if (c.url) console.log(`    ${c.url}`);
});

if (!args.write) {
  console.log('\nDRY RUN — nothing written. Add --client <id> --write to persist.');
  process.exit(0);
}

if (!args.client) {
  console.error('\nERROR: --client <clientId> is required with --write.');
  process.exit(1);
}

// Env before firebase-admin, or the SDK falls back to application-default creds.
const require = createRequire(import.meta.url);
require(path.join(REPO, 'features/not-the-rug-brief/load-env'));
const fb = require(path.join(REPO, 'api/_lib/firebase-admin.cjs'));

await fb.adminDb
  .collection('dashboard_state')
  .doc(args.client)
  .set({ marketingBrief: { quoteTargets: payload } }, { merge: true });

console.log(`\nwrote ${candidates.length} candidates to dashboard_state/${args.client}.marketingBrief.quoteTargets`);
