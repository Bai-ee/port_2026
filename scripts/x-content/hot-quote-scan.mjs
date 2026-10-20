#!/usr/bin/env node
// Hot quote scan: finds breakout posts worth quote-tweeting in two lanes (design | music) and stores N NEW picks.
//
// Pipeline: lane-graph refresh (--if-stale) -> breakout searches + rotating lane-graph accounts (bird, paced)
//   -> breakout test (design: velocity rank 36h; music: 5x the account's median, 72h) -> momentum re-read of the top posts
//   -> ONE small-model relevance judge call -> picks (3 design + 1 music by default, never repeated, never padded).
//
// COST: bird reads are free. The only paid call is the relevance judge (Claude Haiku, <= 24 posts, ~$0.001-0.005, cap $0.04).
// No X API, no ScrapeCreators. Reads only: `search`, `user-tweets`, `read` (never tweet/reply/follow/bookmark).
// Writes (only with --write): dashboard_state/{id}.marketingBrief.hotQuotes (replaced wholesale) and, when stale, xGrowth.laneGraph.
//
// Usage:
//   node scripts/x-content/hot-quote-scan.mjs --client <id>            # dry run: prints picks, writes nothing
//   node scripts/x-content/hot-quote-scan.mjs --client <id> --write
//   Options: --clients a,b · --pilot · --delay <ms> (default 6000) · --no-judge (skip the model; candidates only) · --skip-graph

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveScanClients } from '../../features/x-quote-targets/client-watchlist.js';
import { parseBirdJson, tweetsFromBird } from '../../features/x-quote-targets/bird-json.js';
import { laneGraphFromXGrowth } from '../../features/x-quote-targets/lane-graph.js';
import {
  HOT_ACCOUNTS_PER_RUN, ROTATION_POOL, POSTS_PER_ACCOUNT, POSTS_PER_SEARCH, MOMENTUM_READS, BIRD_DELAY_MS, JUDGE,
} from '../../features/x-quote-targets/hot-config.js';
import {
  HOT_LANES, expandQueries, accountMedianEngagement, buildCandidates, momentumOf, updateSnapshots, pruneShown,
  selectPicks, toPick, countQuotesToday, alreadyQuotedIds, buildHotQuotesPayload,
} from '../../features/x-quote-targets/hot-scan.js';
import { brainDigest, chooseJudgeCandidates, judgeCandidates } from '../../features/x-quote-targets/hot-judge.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const out = { write: false, client: '', clients: '', pilot: false, delay: BIRD_DELAY_MS, noJudge: false, skipGraph: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--write') out.write = true;
    else if (a === '--client') out.client = argv[++i] || '';
    else if (a === '--clients') out.clients = argv[++i] || '';
    else if (a === '--pilot') out.pilot = true;
    else if (a === '--delay') out.delay = Number(argv[++i]) || BIRD_DELAY_MS;
    else if (a === '--no-judge') out.noJudge = true;
    else if (a === '--skip-graph') out.skipGraph = true;
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
let limited = false;
let lastCall = 0;

/** One paced, read-only bird call -> parsed JSON. After a 429 every later call is skipped (returns null). */
async function bird(argv) {
  if (limited) return null;
  const wait = lastCall + args.delay - Date.now();
  if (lastCall && wait > 0) await sleep(wait);
  try {
    const raw = execFileSync(BIRD, argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    return parseBirdJson(raw);
  } catch (err) {
    const msg = String(err?.stdout || err?.stderr || err?.message || err);
    if (/429|rate limit/i.test(msg)) { limited = true; throw new RateLimited(msg.slice(0, 100)); }
    throw new Error(msg.slice(0, 140).replace(/\s+/g, ' '));
  } finally {
    lastCall = Date.now();
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

/** Next `n` accounts of a lane, rotating through the top ROTATION_POOL of the graph from a stored offset. */
function rotate(accounts, offset, n) {
  const pool = (accounts || []).slice(0, ROTATION_POOL);
  if (!pool.length) return { picked: [], next: 0 };
  const take = Math.min(n, pool.length);
  const picked = Array.from({ length: take }, (_, i) => pool[(offset + i) % pool.length]);
  return { picked, next: (offset + take) % pool.length };
}

async function scanClient(clientId) {
  const now = Date.now();
  const notes = [];
  const [cfgSnap, stateSnap, brainSnap] = await Promise.all([
    db.collection('client_configs').doc(clientId).get(),
    db.collection('dashboard_state').doc(clientId).get(),
    db.collection('clients').doc(clientId).collection('client_brain').doc('current').get(),
  ]);
  // A client with no own X handle is not set up for X growth: a skip (exit 0), never a failure, and no lane-graph work.
  if (!String(cfgSnap.exists ? cfgSnap.data()?.marketingBriefConfig?.xGrowth?.ownHandle || '' : '').replace(/^@/, '')) {
    console.log(`[${clientId}] skipped: no xGrowth.ownHandle (client not set up for X growth); nothing scanned or written.`);
    return false;
  }

  // 1. Weekly lane-graph refresh (no-op while < 7 days old). A failure never stops the scan.
  if (args.write && !args.skipGraph) {
    try {
      const out = execFileSync(process.execPath, [path.join(REPO, 'scripts/x-content/build-lane-graph.mjs'), '--client', clientId, '--write', '--if-stale'],
        { cwd: REPO, encoding: 'utf8', timeout: 15 * 60 * 1000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
      console.error(`[${clientId}] lane graph: ${out.trim().split('\n').slice(-1)[0]}`);
    } catch (err) {
      notes.push(`lane graph refresh failed: ${String(err?.message || err).slice(0, 80)}`);
    }
  }

  const cfgSnap2 = args.write && !args.skipGraph ? await db.collection('client_configs').doc(clientId).get() : cfgSnap;
  const xGrowth = cfgSnap2.exists ? cfgSnap2.data()?.marketingBriefConfig?.xGrowth || {} : {};
  const ownHandle = String(xGrowth.ownHandle || '').replace(/^@/, '');
  if (!ownHandle) throw new Error(`client_configs/${clientId} has no xGrowth.ownHandle`);
  const graph = laneGraphFromXGrowth(xGrowth);
  if (!graph) notes.push('no lane graph stored: account sources skipped, searches only');
  const prev = stateSnap.exists ? stateSnap.data()?.marketingBrief?.hotQuotes || {} : {};
  const digest = brainDigest(brainSnap.exists ? brainSnap.data() : null);

  const entries = { design: [], music: [] };
  const stats = { searches: 0, accounts: 0, posts: 0 };
  const guard = async (label, fn) => {
    try { return await fn(); } catch (err) {
      notes.push(`${label}: ${err instanceof RateLimited ? '429 rate limited' : err.message}`);
      return null;
    }
  };

  // 2. Quotes already posted today (owner's recent timeline, CT day).
  const own = await guard('owner timeline', () => bird(['user-tweets', `@${ownHandle}`, '-n', '40', '--json']));
  const ownTweets = own ? tweetsFromBird(own) : [];
  const postedToday = countQuotesToday(ownTweets, now);
  if (!own) notes.push('quotes posted today unknown: counted as 0');

  // 3. Breakout searches, per lane.
  for (const lane of HOT_LANES) {
    for (const q of expandQueries(lane, now)) {
      const res = await guard(`search(${lane})`, () => bird(['search', q, '-n', String(POSTS_PER_SEARCH), '--json']));
      if (!res) continue;
      stats.searches += 1;
      for (const post of tweetsFromBird(res)) entries[lane].push({ post, via: 'search' });
    }
  }

  // 4. Lane-graph accounts, rotated.
  const rotation = { design: prev.rotation?.design || 0, music: prev.rotation?.music || 0 };
  for (const lane of HOT_LANES) {
    const { picked, next } = rotate(graph?.[lane], rotation[lane], HOT_ACCOUNTS_PER_RUN[lane]);
    for (const acct of picked) {
      const res = await guard(`@${acct.handle}`, () => bird(['user-tweets', `@${acct.handle}`, '-n', String(POSTS_PER_ACCOUNT), '--json']));
      if (!res) continue;
      stats.accounts += 1;
      const posts = tweetsFromBird(res);
      for (const post of posts) entries[lane].push({ post, via: 'account', accountMedian: accountMedianEngagement(posts, { excludeId: post.id }) });
    }
    rotation[lane] = next;
  }
  stats.posts = entries.design.length + entries.music.length;

  // 5. Candidates (breakout test), then momentum: re-read the top posts for fresh counts.
  const shown = pruneShown(prev.shown, now);
  const excludeIds = new Set([...Object.keys(shown), ...alreadyQuotedIds(ownTweets)]);
  const build = () => Object.fromEntries(HOT_LANES.map((l) => [l, buildCandidates(l, entries[l], { now, excludeIds, ownHandle })]));
  let cands = build();
  const topIds = [...cands.design.slice(0, MOMENTUM_READS - 3), ...cands.music.slice(0, 3)].map((c) => c.id);
  for (const id of topIds) {
    const fresh = await guard(`read ${id}`, () => bird(['read', id, '--json']));
    if (!fresh?.id) continue;
    for (const lane of HOT_LANES) for (const e of entries[lane]) if (e.post.id === id) e.post = { ...e.post, ...fresh, media: fresh.media?.length ? fresh.media : e.post.media };
  }
  cands = build();
  const withMomentum = (c) => ({ ...c, momentum: momentumOf(prev.snapshots?.[c.id], c, now) });

  // 6. Relevance judge (one call), then picks.
  const toJudge = chooseJudgeCandidates(cands).map(withMomentum);
  let judged = [];
  let costUsd = 0;
  if (args.noJudge) notes.push('judge skipped (--no-judge): no picks');
  else if (toJudge.length) {
    try {
      const r = await judgeCandidates({ candidates: toJudge, digest, callModel });
      judged = r.judged;
      costUsd = r.costUsd;
      notes.push(...r.notes);
    } catch (err) {
      notes.push(`judge failed: ${String(err?.message || err).slice(0, 120)}`);
    }
  }
  const sel = selectPicks(judged, { shownIds: excludeIds });
  const picks = { design: sel.design.map((c) => toPick(c, now)), music: sel.music.map((c) => toPick(c, now)) };
  if (sel.all.length < 4 && judged.length) notes.push(`only ${sel.all.length} of ${judged.length} judged posts passed (fit >= ${JUDGE.threshold}): fewer picks rather than padding`);

  const nextShown = { ...shown };
  for (const p of [...picks.design, ...picks.music]) nextShown[p.id] = p;
  const payload = buildHotQuotesPayload({
    scannedAt: new Date(now).toISOString(), picks, postedToday, costUsd, notes,
    shown: nextShown, snapshots: updateSnapshots(prev.snapshots, [...cands.design, ...cands.music], now), rotation,
    stats: { ...stats, candidates: { design: cands.design.length, music: cands.music.length }, judged: judged.length, rateLimited: limited },
  });

  // 7. Report.
  console.log(`\n=== [${clientId}] hot quotes (${args.write ? 'WRITE' : 'DRY RUN'}) ===`);
  console.log(`searches ${stats.searches}, accounts ${stats.accounts}, posts ${stats.posts} | candidates design ${cands.design.length} music ${cands.music.length} | judged ${judged.length} | cost $${payload.costUsd}`);
  console.log(`quotes posted today ${postedToday}, left ${payload.quotesLeftToday}`);
  for (const p of [...picks.design, ...picks.music]) {
    console.log(`\n[${p.lane}] ${p.url}  fit ${p.fit}  ${p.momentum}  ${p.ageHours}h  ${p.engagement} eng  angle:${p.angle}\n  @${p.author}: ${p.text.slice(0, 110)}\n  why: ${p.why}`);
  }
  if (notes.length) console.log(`\nnotes: ${notes.join(' | ')}`);

  if (!args.write) { console.log('\nDRY RUN - nothing written. Add --write to persist.'); return false; }
  if (limited && !stats.posts) { console.error(`\n[${clientId}] ERROR: rate limited (429) before any post was read - refusing to overwrite the stored scan.`); return true; }
  await db.collection('dashboard_state').doc(clientId).set({ marketingBrief: { hotQuotes: payload } }, { mergeFields: ['marketingBrief.hotQuotes'] });
  console.log(`\n[${clientId}] wrote hotQuotes (${sel.all.length} picks) to dashboard_state/${clientId}.marketingBrief.hotQuotes`);
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
