#!/usr/bin/env node
// Replay the whole @bai_ee corpus through the content guard and measure how
// often it would have been wrong. A guard that blocks good work is worse than
// no guard, so the headline number here is: did anything that actually
// performed get hard-blocked?
//
// Run: node scripts/x-content/research/replay-guard.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { guardXPost } from '../../../features/x-content-guard/index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../');
const CORPUS = path.join(REPO, 'docs/audits/bai-ee-x-corpus.json');
const OUT = path.join(REPO, 'docs/audits/x-guard-replay.json');

// A post that beat the account's median reach is, by definition, working.
// Blocking one of these is the failure mode that matters.
const GOOD_VIEW_FLOOR = 300;

const posts = JSON.parse(readFileSync(CORPUS, 'utf8'));
const rows = posts.map((p) => {
  const verdict = guardXPost({
    text: p.text,
    type: p.type,
    media: p.media,
    quotedText: p.quotedText,
  });
  return { id: p.id, url: p.url, date: p.dateLocal, type: p.type, media: p.media, views: p.views, likes: p.likes, verdict };
});

const withViews = rows.filter((r) => r.views != null);
const blocked = rows.filter((r) => r.verdict.hardBlock);
const falsePositives = blocked.filter((r) => (r.views ?? 0) >= GOOD_VIEW_FLOOR);
const needsReview = rows.filter((r) => r.verdict.needsLaneReview);
const cleanPass = rows.filter((r) => r.verdict.readyToPublish);

const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) : '0.0');

const laneCounts = {};
const lanePerf = {};
for (const r of rows) {
  const l = r.verdict.lane;
  laneCounts[l] = (laneCounts[l] || 0) + 1;
  if (r.views != null) {
    lanePerf[l] = lanePerf[l] || { n: 0, views: 0 };
    lanePerf[l].n += 1;
    lanePerf[l].views += r.views;
  }
}

const flagCounts = {};
for (const r of rows) for (const f of r.verdict.flags) flagCounts[f.code] = (flagCounts[f.code] || 0) + 1;

console.log(`corpus: ${rows.length} posts (${withViews.length} with view counts)\n`);

console.log('=== headline ===');
console.log(`  hard-blocked          ${blocked.length} (${pct(blocked.length, rows.length)}%)`);
console.log(`  FALSE POSITIVES       ${falsePositives.length}  <- blocked despite >=${GOOD_VIEW_FLOOR} views`);
console.log(`  needs lane review     ${needsReview.length} (${pct(needsReview.length, rows.length)}%)`);
console.log(`  clean pass            ${cleanPass.length} (${pct(cleanPass.length, rows.length)}%)\n`);

if (falsePositives.length) {
  console.log('!!! FALSE POSITIVES — the guard would have stopped these:');
  falsePositives
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
    .forEach((r) => console.log(`  ${String(r.views).padStart(5)}v  ${r.verdict.lane.padEnd(9)} ${r.verdict.flags.map((f) => f.code).join(',')}`));
  console.log();
}

console.log('=== what got hard-blocked ===');
blocked
  .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
  .slice(0, 12)
  .forEach((r) => {
    const p = posts.find((x) => x.id === r.id);
    console.log(`  ${String(r.views ?? 0).padStart(5)}v ${String(r.likes).padStart(3)}L [${r.verdict.lane}] ${p.text.replace(/\n/g, ' ').slice(0, 78)}`);
  });
console.log();

console.log('=== lane distribution (avg views where known) ===');
Object.entries(laneCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([lane, n]) => {
    const perf = lanePerf[lane];
    const avg = perf ? Math.round(perf.views / perf.n) : null;
    console.log(`  ${lane.padEnd(10)} n=${String(n).padStart(3)}  avgViews=${avg == null ? '—' : avg}`);
  });
console.log();

console.log('=== flags raised ===');
Object.entries(flagCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([code, n]) => console.log(`  ${code.padEnd(26)} ${n}`));

writeFileSync(
  OUT,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      corpusSize: rows.length,
      goodViewFloor: GOOD_VIEW_FLOOR,
      summary: {
        hardBlocked: blocked.length,
        falsePositives: falsePositives.length,
        needsLaneReview: needsReview.length,
        cleanPass: cleanPass.length,
      },
      laneCounts,
      flagCounts,
      rows,
    },
    null,
    2,
  ),
);
console.log(`\nwrote ${path.relative(REPO, OUT)}`);
