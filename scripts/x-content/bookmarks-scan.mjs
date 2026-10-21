#!/usr/bin/env node
// Bookmarks scan: reads the owner's X bookmarks, judges the new ones against the Brain, and stores picks he can act on.
//
// Pipeline: `bird bookmarks` (one read) -> upsert x_bookmarks/{id}/items (never overwrites a judge or a decision)
//   -> ONE small-model judge call over the UNJUDGED items only (<= 24 per run) -> picks payload
//   (up to 12 open items: respond = quote | reply | swipe, with a one-line "how", grounded only in the Brain's authority claims).
//
// COST: bird is free (browser cookies, one small read). The only paid call is the judge (Claude Haiku, <= 24 posts,
// ~$0.001-0.005, cap $0.04). No X API, no ScrapeCreators. Read-only: only `whoami` and `bookmarks` (never tweet/reply/follow/unbookmark).
// bird reads the logged-in browser account's bookmarks, so a client is scanned only when that account IS the client's X handle.
// Writes (only with --write): x_bookmarks/{clientId}/items/*, dashboard_state/{clientId}.marketingBrief.bookmarkPicks.
//
// Usage:
//   node scripts/x-content/bookmarks-scan.mjs --client <id>             # dry run: reads + prints picks, writes nothing
//   node scripts/x-content/bookmarks-scan.mjs --client <id> --write
//   Options: --clients a,b · --pilot · --limit <n> (default 200) · --no-judge (skip the model; items are stored unjudged with --write)

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveScanClients } from '../../features/x-quote-targets/client-watchlist.js';
import { parseBirdJson, tweetsFromBird } from '../../features/x-quote-targets/bird-json.js';
import { JUDGE } from '../../features/x-quote-targets/hot-config.js';
import { brainDigest, judgeBookmarks, selectBookmarkCandidates, BOOKMARK_LIMITS } from '../../features/x-bookmarks/judge.js';
import {
  bookmarkFromBird, upsertBookmarks, listBookmarks, setJudge, buildBookmarkPicksPayload, writeBookmarkPicks,
} from '../../features/x-bookmarks/store.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const DEFAULT_LIMIT = 200;

function parseArgs(argv) {
  const out = { write: false, client: '', clients: '', pilot: false, limit: DEFAULT_LIMIT, noJudge: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--write') out.write = true;
    else if (a === '--client') out.client = argv[++i] || '';
    else if (a === '--clients') out.clients = argv[++i] || '';
    else if (a === '--pilot') out.pilot = true;
    else if (a === '--limit') out.limit = Math.max(1, Math.min(Number(argv[++i]) || DEFAULT_LIMIT, 500));
    else if (a === '--no-judge') out.noJudge = true;
  }
  return out;
}

function resolveBird() {
  if (process.env.BIRD && existsSync(process.env.BIRD)) return process.env.BIRD;
  return [path.join(process.env.HOME || '', '.local/birdtool/node_modules/.bin/bird'), path.join(REPO, 'node_modules/.bin/bird')]
    .find((p) => existsSync(p)) || '';
}

const require = createRequire(import.meta.url);
require(path.join(REPO, 'features/not-the-rug-brief/load-env'));
const args = parseArgs(process.argv.slice(2));
const scope = resolveScanClients(args, process.env);
if (scope.error) { console.error(`ERROR: ${scope.error}`); process.exit(1); }
const BIRD = resolveBird();
if (!BIRD) { console.error('ERROR: `bird` not found. Set BIRD=/path/to/bird.'); process.exit(1); }
const db = require(path.join(REPO, 'api/_lib/firebase-admin.cjs')).adminDb;

class RateLimited extends Error {}

/** One read-only bird call -> stdout. A 429 is a RateLimited error; anything else a short Error. */
function bird(argv) {
  try {
    return execFileSync(BIRD, argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const msg = String(err?.stdout || err?.stderr || err?.message || err);
    if (/429|rate limit/i.test(msg)) throw new RateLimited(msg.slice(0, 100));
    throw new Error(msg.slice(0, 140).replace(/\s+/g, ' '));
  }
}

async function callModel({ system, user, maxTokens }) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model: JUDGE.model, max_tokens: maxTokens, system, output_config: { effort: 'low' },
    messages: [{ role: 'user', content: user }],
  });
  return { text: res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'), usage: res.usage };
}

/** The X handle bird is logged in as (from `bird whoami`), or '' when it cannot be read. */
function loggedInHandle() {
  try { return (bird(['whoami']).match(/@([A-Za-z0-9_]+)/) || [])[1]?.toLowerCase() || ''; } catch { return ''; }
}

async function scanClient(clientId) {
  const now = Date.now();
  const notes = [];
  const [cfgSnap, brainSnap] = await Promise.all([
    db.collection('client_configs').doc(clientId).get(),
    db.collection('clients').doc(clientId).collection('client_brain').doc('current').get(),
  ]);
  const ownHandle = String(cfgSnap.exists ? cfgSnap.data()?.marketingBriefConfig?.xGrowth?.ownHandle || '' : '').replace(/^@/, '').toLowerCase();
  if (!ownHandle) {
    console.log(`[${clientId}] skipped: no xGrowth.ownHandle (client not set up for X growth); nothing scanned or written.`);
    return false;
  }
  const me = loggedInHandle();
  if (me !== ownHandle) {
    console.log(`[${clientId}] skipped: bird is logged in as ${me ? `@${me}` : 'an unknown account'}, not @${ownHandle}; bookmarks belong to the logged-in account.`);
    return false;
  }

  // 1. Read bookmarks (one call). A 429 stops everything and never overwrites stored picks.
  let tweets;
  try {
    tweets = tweetsFromBird(parseBirdJson(bird(['bookmarks', '-n', String(args.limit), '--json'])));
  } catch (err) {
    if (err instanceof RateLimited) { console.error(`\n[${clientId}] ERROR: rate limited (429) reading bookmarks - nothing written.`); return true; }
    throw err;
  }
  const rows = tweets.map((t) => bookmarkFromBird(t, now)).filter(Boolean);
  if (rows.length < tweets.length) notes.push(`${tweets.length - rows.length} bookmark(s) had no usable id/author and were skipped`);

  // 2. Upsert (write only). Dry run works from the stored items + the fresh read, in memory.
  let newIds = [];
  let stored = [];
  if (args.write) {
    const up = await upsertBookmarks(db, clientId, rows, now);
    newIds = up.newIds;
    stored = await listBookmarks(db, clientId, { limit: 500 });
  } else {
    stored = await listBookmarks(db, clientId, { limit: 500 });
    const known = new Map(stored.map((x) => [x.id, x]));
    newIds = rows.filter((r) => !known.has(r.id)).map((r) => r.id);
    const fresh = rows.filter((r) => !known.has(r.id)).map((r) => ({ ...r, firstSeenAt: new Date(now).toISOString(), judge: null, decision: null }));
    stored = [...fresh, ...stored];
  }

  // 3. Judge only the unjudged items (cap 24 per run, newest first).
  let judgedCount = 0;
  let costUsd = 0;
  const candidates = selectBookmarkCandidates(stored, BOOKMARK_LIMITS.maxCandidates);
  if (args.noJudge) notes.push(`judge skipped (--no-judge): ${candidates.length} item(s) left unjudged`);
  else if (candidates.length) {
    try {
      const r = await judgeBookmarks({ candidates, digest: brainDigest(brainSnap.exists ? brainSnap.data() : null), callModel, now });
      costUsd = r.costUsd;
      notes.push(...r.notes);
      const byId = new Map(stored.map((x) => [x.id, x]));
      for (const { item, judge } of r.judged) {
        if (!judge) continue;
        byId.get(item.id).judge = judge;
        judgedCount += 1;
        if (args.write) await setJudge(db, clientId, item.id, judge);
      }
    } catch (err) {
      notes.push(`judge failed: ${String(err?.message || err).slice(0, 120)}`);
    }
  }

  // 4. Picks payload + report.
  const payload = buildBookmarkPicksPayload({ items: stored, now, newThisRun: newIds.length, judged: judgedCount, costUsd, notes });
  console.log(`\n=== [${clientId}] bookmarks (${args.write ? 'WRITE' : 'DRY RUN'}) ===`);
  console.log(`read ${rows.length} | total stored ${payload.total} | new ${payload.newThisRun} | judged this run ${judgedCount} | open picks ${payload.picks.length} | cost $${payload.costUsd}`);
  for (const p of payload.picks) {
    console.log(`\n[${p.respond}] ${p.url}  fit ${p.fit}  ${p.lane}/${p.angle}  ${p.ageHours}h  ${p.likes} likes\n  @${p.author}: ${p.text.slice(0, 110)}\n  how: ${p.how}\n  why: ${p.why}`);
  }
  if (notes.length) console.log(`\nnotes: ${notes.join(' | ')}`);

  if (!args.write) { console.log('\nDRY RUN - nothing written. Add --write to persist.'); return false; }
  await writeBookmarkPicks(db, clientId, payload);
  console.log(`\n[${clientId}] wrote bookmarkPicks (${payload.picks.length} picks) to dashboard_state/${clientId}.marketingBrief.bookmarkPicks`);
  return false;
}

let failed = 0;
for (const clientId of scope.clientIds) {
  try {
    if (await scanClient(clientId)) failed += 1;
  } catch (err) {
    failed += 1;
    console.error(`\n[${clientId}] ERROR: ${String(err?.message || err).slice(0, 200)}`);
  }
}
process.exit(failed ? 1 : 0);
