#!/usr/bin/env node
// backfill-performance.mjs — Active Content System Phase 4 feedback loop.
//
// Joins posted social_posts (rows carrying twitterId/packageId/engine/postedAt)
// to free `bird` timeline metrics and prints a per-engine table.
//
// SAFETY
//  * DRY RUN by default: prints only. Zero X API calls (bird = browser cookies,
//    read-only user-tweets). Never posts, replies, follows or likes.
//  * Offline by default: posts come from --posts <fixture.json>. A real
//    Firestore read needs --firestore (+ --client). OWNER-ONLY.
//  * --write (owner-only, requires --firestore) sets social_posts.performance
//    and package.metrics.x {views,likes,replies,reposts,quotes,capturedAt}.
//
// Usage:
//   node scripts/x-content/backfill-performance.mjs --posts fixture.json --corpus corpus.json
//   node scripts/x-content/backfill-performance.mjs --posts fixture.json --bird @bai_ee
//   node scripts/x-content/backfill-performance.mjs --firestore --client <id> --bird @bai_ee [--write]
//
// Options:
//   --posts <path>     JSON array of social_posts rows (offline fixture)
//   --corpus <path>    bird/corpus JSON used as the metrics source (fixture fallback)
//   --views <path>     optional {tweetId: views} map (backfill-views.mjs output)
//   --bird <handle>    fetch the timeline live via bird (read-only)
//   --count <n>        bird tweets to fetch (default 200)
//   --window <days>    summary window (default 30; 0 = all time)
//
// CADENCE: run once daily. Each run is a SNAPSHOT at capture time.
// KNOWN GAP: the first ~2h decide a post's reach (x-2026-10-03 profile), but a
// daily capture lands hours-to-days after posting, so first-2h velocity cannot
// be measured. `ageHoursAtCapture` records how mature each number is. Measuring
// velocity would need a capture near post time (not built; needs a separate,
// owner-approved trigger). bird timeline also omits `views`; pass --views or
// rely on the corpus for them, otherwise views stay null (shown as unknown).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { joinPerformance, engineStats } from '../../features/x-content-inventory/performance.js';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}
const has = (n) => process.argv.includes(`--${n}`);
const readJson = (p) => JSON.parse(fs.readFileSync(path.resolve(p), 'utf8'));

const BIRD = path.join(os.homedir(), '.local/birdtool/node_modules/.bin/bird');

/** Normalise bird (replyCount/likeCount/...) and corpus (replies/likes/...) tweets to metrics-by-id. */
export function buildTimeline(tweets, views = {}, capturedAt = new Date().toISOString()) {
  const out = {};
  for (const t of tweets) {
    const id = String(t.id ?? '');
    if (!id) continue;
    const pick = (a, b) => (typeof t[a] === 'number' ? t[a] : (typeof t[b] === 'number' ? t[b] : null));
    out[id] = {
      views: typeof views[id] === 'number' ? views[id] : (typeof t.views === 'number' ? t.views : (typeof t.viewCount === 'number' ? t.viewCount : null)),
      likes: pick('likeCount', 'likes'),
      replies: pick('replyCount', 'replies'),
      reposts: pick('retweetCount', 'reposts'),
      quotes: pick('quoteCount', 'quotes'),
      bookmarks: pick('bookmarkCount', 'bookmarks'),
      capturedAt,
    };
  }
  return out;
}

function fetchBird(handle, count) {
  const raw = execFileSync(BIRD, ['user-tweets', handle, '-n', String(count), '--max-pages', '10', '--delay', '1200', '--json'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  const s = raw.search(/[\[{]/);
  const payload = JSON.parse(raw.slice(s));
  return Array.isArray(payload) ? payload : (payload.tweets || []);
}

function fmt(v, d = 0) { return v == null ? '—' : (Math.round(v * 10 ** d) / 10 ** d).toString(); }

function printTable(stats) {
  console.log(`\nPer-engine performance (window ${stats.windowDays ? stats.windowDays + 'd' : 'all time'}, min n=${stats.minN}, ${stats.total} posts, ${stats.unmeasured} unmeasured)`);
  console.log('engine      n  meas  medViews  medLikes  medValue  replies/1kV  trend        rank');
  for (const [k, s] of Object.entries(stats.engines)) {
    const trend = s.trend.state === 'insufficient' ? 'insufficient' : `${s.trend.state} ${s.trend.pct}%`;
    console.log(`${k.padEnd(10)} ${String(s.n).padStart(2)}  ${String(s.measured).padStart(4)}  ${fmt(s.medianViews).padStart(8)}  ${fmt(s.medianLikes, 1).padStart(8)}  ${fmt(s.medianValue, 1).padStart(8)}  ${fmt(s.replyRate, 2).padStart(11)}  ${trend.padEnd(12)} ${s.insufficient ? 'n<5 (not ranked)' : s.rank}`);
  }
}

async function main() {
  const write = has('write');
  const useFirestore = has('firestore');
  if (write && !useFirestore) { console.error('--write requires --firestore (owner-only).'); process.exit(1); }

  let posts; let packages = [];
  if (useFirestore) {
    const clientId = arg('client');
    if (!clientId) { console.error('--client <id> required with --firestore'); process.exit(1); }
    const { readSocialQueue } = await import('../../features/social-posting/twitter-service.js');
    const { readInventory } = await import('../../features/x-content-inventory/store.js');
    posts = await readSocialQueue(clientId);
    packages = (await readInventory())?.packages ?? [];
  } else {
    const p = arg('posts');
    if (!p) { console.error('--posts <fixture.json> required (offline). Real Firestore needs --firestore.'); process.exit(1); }
    posts = readJson(p);
  }
  posts = posts.filter((x) => x.twitterId);

  const views = arg('views') ? readJson(arg('views')) : {};
  let tweets = [];
  if (arg('bird')) tweets = fetchBird(arg('bird'), Number(arg('count', 200)));
  else if (arg('corpus')) tweets = readJson(arg('corpus'));
  else { console.error('Need a metrics source: --bird <handle> or --corpus <path>.'); process.exit(1); }
  const timeline = buildTimeline(tweets, views);

  const rows = joinPerformance({ posts, timeline, packages });
  console.log(`posted posts with twitterId: ${posts.length}; matched to timeline: ${rows.filter((r) => r.metrics).length}; timeline tweets: ${Object.keys(timeline).length}`);
  const stats = engineStats(rows, { windowDays: Number(arg('window', 30)), now: Date.now() });
  printTable(stats);

  if (!write) { console.log('\nDRY RUN — nothing written. (--write is owner-only.)'); return; }

  const { createRequire } = await import('node:module');
  const fb = createRequire(import.meta.url)('../../api/_lib/firebase-admin.cjs');
  const { upsertPackage } = await import('../../features/x-content-inventory/store.js');
  const latestByPkg = new Map();
  let n = 0;
  for (const r of rows) {
    if (!r.metrics || !r.id) continue;
    const { views: v, likes, replies, reposts, quotes, capturedAt } = r.metrics;
    const perf = { views: v, likes, replies, reposts, quotes, capturedAt };
    await fb.adminDb.collection('social_posts').doc(r.id).update({ performance: perf });
    n += 1;
    if (r.packageId && (!latestByPkg.has(r.packageId) || r.postedAt > latestByPkg.get(r.packageId).postedAt)) latestByPkg.set(r.packageId, { postedAt: r.postedAt, perf });
  }
  const byId = new Map(packages.map((p) => [p.id, p]));
  for (const [id, { perf }] of latestByPkg) {
    const pkg = byId.get(id);
    if (pkg) await upsertPackage({ ...pkg, metrics: { ...(pkg.metrics || {}), x: perf } }, { returnPackages: false });
  }
  console.log(`\nWROTE performance on ${n} posts, metrics.x on ${latestByPkg.size} packages.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
