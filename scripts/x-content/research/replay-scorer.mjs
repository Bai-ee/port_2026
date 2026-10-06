#!/usr/bin/env node
// Replay the OLD (origin/main) and NEW scoreXPost over the real @bai_ee corpus.
// Evidence only: the composite is derived from verified action weights, not fit to this data.
// Usage: node scripts/x-content/research/replay-scorer.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const corpus = JSON.parse(fs.readFileSync(path.join(root, 'docs/audits/bai-ee-x-corpus.json'), 'utf8'));

// OLD scorer: pull from git, rewire its relative import to an absolute file URL.
let oldSrc;
for (const ref of ['origin/main', 'HEAD']) {
  try { oldSrc = execSync(`git show ${ref}:features/x-growth/score-draft.js`, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); break; } catch {}
}
if (!oldSrc) throw new Error('could not read old score-draft.js from git');
const profileUrl = pathToFileURL(path.join(root, 'features/x-growth/algorithm-profile.js')).href;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'old-scorer-'));
const oldFile = path.join(tmp, 'old-score-draft.mjs');
fs.writeFileSync(oldFile, oldSrc.replace("'./algorithm-profile.js'", `'${profileUrl}'`));
const { scoreXPost: oldScore } = await import(pathToFileURL(oldFile).href);
const { scoreXPost: newScore } = await import(pathToFileURL(path.join(root, 'features/x-growth/score-draft.js')).href);
fs.rmSync(tmp, { recursive: true, force: true });

function rank(a) {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = new Array(a.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}
function spearman(x, y) {
  if (x.length < 3) return NaN;
  const a = rank(x), b = rank(y), n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return num / Math.sqrt(da * db);
}
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const f = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '  n/a');

const originals = corpus.filter((p) => p.type !== 'retweet' && p.text);
const rows = originals.map((p) => {
  const ctx = { mediaType: p.media === 'video' ? 'video' : (p.media === 'image' || p.media === 'gif') ? 'image' : 'none' };
  const o = oldScore(p.text, ctx), n = newScore(p.text, ctx);
  return { id: p.id, type: p.type, text: p.text.replace(/\s+/g, ' ').slice(0, 56), views: p.views, likes: p.likes ?? 0, old: o.xGrowthScore, nw: n.xGrowthScore };
});

function report(label, subset, key) {
  const act = subset.map((r) => r[key]);
  console.log(`${label.padEnd(22)} n=${String(subset.length).padStart(3)}  old rho=${f(spearman(subset.map((r) => r.old), act))}  new rho=${f(spearman(subset.map((r) => r.nw), act))}`);
}
console.log(`Corpus originals: ${rows.length} (retweets skipped)`);
console.log('Spearman rank correlation vs actual');
report('views (where known)', rows.filter((r) => r.views != null), 'views');
report('likes (all originals)', rows, 'likes');
report('likes (views missing)', rows.filter((r) => r.views == null), 'likes');

// Top disagreements in rank-percentile between old and new.
const ro = rank(rows.map((r) => r.old)), rn = rank(rows.map((r) => r.nw));
const dis = rows.map((r, i) => ({ ...r, d: (rn[i] - ro[i]) / rows.length })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 10);
console.log('\nTop-10 rank disagreements (new minus old, percentile)');
console.log('shift   old   new   views likes type              text');
for (const r of dis) console.log(`${(r.d >= 0 ? '+' : '') + r.d.toFixed(2).padStart(5)}  ${f(r.old, 2)}  ${f(r.nw, 2)}  ${String(r.views ?? '-').padStart(5)} ${String(r.likes).padStart(5)} ${r.type.padEnd(17)} ${r.text}`);

console.log('\nPer-type means');
console.log('type               n   old    new   avgViews avgLikes');
for (const type of [...new Set(rows.map((r) => r.type))]) {
  const s = rows.filter((r) => r.type === type);
  const v = s.filter((r) => r.views != null).map((r) => r.views);
  console.log(`${type.padEnd(17)} ${String(s.length).padStart(3)}  ${f(mean(s.map((r) => r.old)), 3)}  ${f(mean(s.map((r) => r.nw)), 3)}  ${f(mean(v), 0).padStart(8)} ${f(mean(s.map((r) => r.likes)), 1).padStart(8)}`);
}
