#!/usr/bin/env node
// Build the hot-quote-scan lane graph (design | music accounts raised automatically) for one client.
//
// COST: zero. bird reads only (`user-tweets`, `following`), no X API, no ScrapeCreators, no LLM.
// Runs on the operator's Mac (bird uses the browser's x.com cookies). Dry run by default; the graph is written to
// client_configs/{id}.marketingBriefConfig.xGrowth.laneGraph (merge, only that field) ONLY with --write.
//
// Usage:
//   node scripts/x-content/build-lane-graph.mjs --client <id>                    # dry run: counts + top lists
//   node scripts/x-content/build-lane-graph.mjs --client <id> --write
//   node scripts/x-content/build-lane-graph.mjs --client <id> --write --if-stale # no-op while the stored graph is < 7 days old (refresh worker hook)
//   Options: --delay <ms> (default 6000, between bird calls) · --corpora-dir <dir> (extra local <handle>.json corpora, merged by row id)
//            --extra-design a,b · --extra-music a,b (extra model handles) · --top <n> (rows printed per lane, default 10)
//
// Design lane: authors quoted by the design-track benchmarks' corpora (x_corpora/{handle}, committed-json fallback).
// Music lane:  following lists of the music-track benchmarks + the throwback model + the owner, bio-filtered.
// A 429 stops the run at once and writes nothing.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tracksOf } from '../../features/x-strategy/content-tracks.js';
import { STRATEGY_COLLECTIONS } from '../../features/x-strategy/contracts.js';
import { createFirestoreCorpusStore } from '../../features/x-strategy/corpus-store.js';
import { mergeRowsById } from '../../features/x-strategy/corpus-rows.js';
import { watchlistFromXGrowth } from '../../features/x-quote-targets/client-watchlist.js';
import {
  DEFAULT_EXTRA_MODELS, avoidTermsFromTopics, brainAvoidFrom, buildLaneGraph, isLaneGraphStale, laneGraphFromXGrowth, laneModels, toStoredLaneGraph,
} from '../../features/x-quote-targets/lane-graph.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csv = (v) => String(v || '').split(',').map((s) => s.trim().replace(/^@/, '').toLowerCase()).filter(Boolean);

function parseArgs(argv) {
  const out = { client: '', write: false, ifStale: false, delay: 6000, corporaDir: '', extraDesign: [], extraMusic: [], top: 10 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--client') out.client = argv[++i] || '';
    else if (a === '--write') out.write = true;
    else if (a === '--if-stale') out.ifStale = true;
    else if (a === '--delay') out.delay = Number(argv[++i]) || 6000;
    else if (a === '--corpora-dir') out.corporaDir = argv[++i] || '';
    else if (a === '--extra-design') out.extraDesign = csv(argv[++i]);
    else if (a === '--extra-music') out.extraMusic = csv(argv[++i]);
    else if (a === '--top') out.top = Number(argv[++i]) || 10;
  }
  return out;
}

function resolveBird() {
  if (process.env.BIRD && existsSync(process.env.BIRD)) return process.env.BIRD;
  return [path.join(process.env.HOME || '', '.local/birdtool/node_modules/.bin/bird'), path.join(REPO, 'node_modules/.bin/bird')]
    .find((p) => existsSync(p)) || '';
}

const args = parseArgs(process.argv.slice(2));
if (!/^[A-Za-z0-9_-]{3,80}$/.test(args.client)) {
  console.error('ERROR: --client <clientId> is required (there is no default client).');
  process.exit(1);
}
const BIRD = resolveBird();
if (!BIRD) {
  console.error('ERROR: `bird` not found. Set BIRD=/path/to/bird.');
  process.exit(1);
}

const require = createRequire(import.meta.url);
require(path.join(REPO, 'features/not-the-rug-brief/load-env'));
const fb = require(path.join(REPO, 'api/_lib/firebase-admin.cjs'));
const db = fb.adminDb;

class RateLimited extends Error {}

// Read-only bird calls only. Paced by the caller; any 429 aborts the whole run.
function bird(argv) {
  try {
    const raw = execFileSync(BIRD, argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    // stdout is pure JSON (warnings go to stderr); a bare indexOf('[') would land inside bio text
    return JSON.parse(raw.slice(raw.search(/^[[{]/m)));
  } catch (err) {
    const msg = String(err?.stdout || err?.stderr || err?.message || err);
    if (/429|rate limit/i.test(msg)) throw new RateLimited(msg.slice(0, 120));
    throw new Error(msg.slice(0, 160).replace(/\s+/g, ' '));
  }
}

let lastCall = 0;
async function paced(argv) {
  const wait = lastCall + args.delay - Date.now();
  if (lastCall && wait > 0) await sleep(wait);
  try { return bird(argv); } finally { lastCall = Date.now(); }
}

const idOfHandle = async (handle) => {
  const tweets = await paced(['user-tweets', `@${handle}`, '-n', '1', '--json']);
  const list = Array.isArray(tweets) ? tweets : tweets.tweets || [];
  return list[0]?.authorId || list[0]?.author?.id || null;
};

const followingOf = async (userId) => {
  const res = await paced(['following', '--user', String(userId), '--all', '-n', '100', '--json']);
  return Array.isArray(res) ? res : res.users || [];
};

function readLocalCorpus(dir, handle) {
  if (!dir) return [];
  const file = [path.join(dir, `${handle}.json`), path.join(dir, `${handle}-12mo.json`)].find((p) => existsSync(p));
  if (!file) return [];
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return Array.isArray(parsed) ? parsed : parsed.rows || [];
}

async function main() {
  const clientId = args.client;
  const [planSnap, cfgSnap, brainSnap] = await Promise.all([
    db.collection(STRATEGY_COLLECTIONS.plans).doc(clientId).get(),
    db.collection('client_configs').doc(clientId).get(),
    db.collection('clients').doc(clientId).collection('client_brain').doc('current').get(),
  ]);
  const planDoc = planSnap.exists ? planSnap.data() : null;
  const plan = planDoc?.plan && typeof planDoc.plan === 'object' ? planDoc.plan : planDoc;
  const xGrowth = cfgSnap.exists ? cfgSnap.data()?.marketingBriefConfig?.xGrowth || {} : {};
  const ownHandle = String(xGrowth.ownHandle || '').replace(/^@/, '').toLowerCase();
  if (!ownHandle) throw new Error(`client_configs/${clientId} has no xGrowth.ownHandle`);

  if (args.ifStale && !isLaneGraphStale(laneGraphFromXGrowth(xGrowth))) {
    console.log(`[${clientId}] lane graph is fresh (builtAt ${laneGraphFromXGrowth(xGrowth).builtAt}) - nothing to do.`);
    return;
  }

  const tracks = tracksOf(plan);
  const extraModels = {
    design: [...DEFAULT_EXTRA_MODELS.design, ...args.extraDesign],
    music: [...DEFAULT_EXTRA_MODELS.music, ...args.extraMusic],
  };
  const models = laneModels({ tracks, benchmarkPrimary: plan?.benchmarkPrimary, extraModels });
  console.error(`[${clientId}] owner @${ownHandle} | design models: ${models.design.join(', ') || '-'} | music models: ${models.music.join(', ') || '-'}`);

  // Brain: avoid handles / avoid-topic words (read only).
  const brain = brainSnap.exists ? brainSnap.data() : {};
  const { topics: avoidTopics, handles: avoidHandles } = brainAvoidFrom(brain);
  const avoidTerms = avoidTermsFromTopics(avoidTopics);
  console.error(`[${clientId}] brain keys: ${Object.keys(brain).slice(0, 14).join(',') || '(none)'} | avoid topics: ${avoidTopics.length}`);

  // Design: corpora of the design models (Firestore rows, committed fallback) plus optional local corpora.
  const store = createFirestoreCorpusStore(db);
  const corpora = {};
  const corpusInfo = {};
  for (const h of models.design) {
    const stored = await store.readRows(h);
    const local = readLocalCorpus(args.corporaDir, h);
    corpora[h] = local.length ? mergeRowsById(stored.rows, local) : stored.rows;
    corpusInfo[h] = { rows: corpora[h].length, source: stored.source, local: local.length };
  }

  // Music: following lists (owner first; its list also resolves model user ids for free).
  const following = {};
  const fetchNotes = [];
  const sources = [...models.music, ownHandle];
  const ownerId = await idOfHandle(ownHandle);
  if (!ownerId) throw new Error(`could not resolve a user id for @${ownHandle}`);
  const ownerFollowing = await followingOf(ownerId);
  following[ownHandle] = ownerFollowing;
  for (const h of models.music) {
    let id = ownerFollowing.find((u) => String(u.username).toLowerCase() === h)?.id || null;
    if (!id) id = await idOfHandle(h);
    if (!id) { fetchNotes.push(`@${h}: user id not found`); continue; }
    following[h] = await followingOf(id);
  }
  console.error(`[${clientId}] following lists: ${sources.map((s) => `${s}=${(following[s] || []).length}`).join(' ')}`);

  const graph = buildLaneGraph({ tracks, benchmarkPrimary: plan?.benchmarkPrimary, ownHandle, corpora, following, avoidHandles, avoidTerms, extraModels });
  const watch = new Set(watchlistFromXGrowth(xGrowth).map((w) => w.handle.toLowerCase()));

  console.log(`\n=== [${clientId}] lane graph (${args.write ? 'WRITE' : 'DRY RUN'}) ===`);
  console.log(`corpora: ${Object.entries(corpusInfo).map(([h, c]) => `${h} ${c.rows} rows (${c.source}${c.local ? `, +${c.local} local` : ''})`).join(' | ')}`);
  console.log(`avoid: handles=${avoidHandles.length} terms=[${avoidTerms.join(', ')}] | dropped ${JSON.stringify(graph.meta.dropped)}`);
  for (const lane of ['design', 'music']) {
    const list = graph[lane];
    console.log(`\n${lane}: ${list.length} accounts (${graph.meta.found[lane]} found, stored cap applied) | already on watchlist: ${list.filter((a) => watch.has(a.handle.toLowerCase())).length}`);
    list.slice(0, args.top).forEach((a, i) => console.log(`  ${String(i + 1).padStart(2)}. @${a.handle}  w=${a.weight}  ${a.source}${watch.has(a.handle.toLowerCase()) ? '  [watchlist]' : ''}`));
  }
  if (fetchNotes.length) console.log(`\nnotes: ${fetchNotes.join('; ')}`);

  if (!args.write) {
    console.log('\nDRY RUN - nothing written. Add --write to persist.');
    return;
  }
  if (!graph.design.length && !graph.music.length) throw new Error('both lanes are empty - refusing to overwrite the stored graph.');
  const stored = toStoredLaneGraph(graph, { builtAt: new Date().toISOString() });
  await db.collection('client_configs').doc(clientId).set({ marketingBriefConfig: { xGrowth: { laneGraph: stored } } }, { mergeFields: ['marketingBriefConfig.xGrowth.laneGraph'] });
  console.log(`\nwrote xGrowth.laneGraph (design ${stored.design.length}, music ${stored.music.length}) to client_configs/${clientId}.`);
}

main().then(() => process.exit(0)).catch((err) => {
  if (err instanceof RateLimited) console.error(`\nSTOPPED: 429 rate limit (${err.message}). Nothing written. Re-run later with a larger --delay.`);
  else console.error(`\nERROR: ${String(err?.message || err).slice(0, 300)}`);
  process.exit(1);
});
