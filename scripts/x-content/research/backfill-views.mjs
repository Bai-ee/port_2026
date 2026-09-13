#!/usr/bin/env node
// Backfill view counts via ScrapeCreators /v1/twitter/tweet (1 credit per post).
// Budget-capped: refuses to exceed MAX_CREDITS.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SP = path.dirname(new URL(import.meta.url).pathname);
const MAX_CREDITS = Number(process.env.MAX_CREDITS || 150);
const HANDLE = process.env.HANDLE || 'seb__design';
const OUT = path.join(SP, process.env.VIEWS || 'seb-views.json');

function getKey() {
  let key = process.env.SCRAPECREATORS_API_KEY || '';
  if (!key) {
    const p = path.join(os.homedir(), '.config', 'last30days', '.env');
    const m = fs.readFileSync(p, 'utf8').match(/^\s*SCRAPECREATORS_API_KEY\s*=\s*(.+?)\s*$/m);
    if (m) key = m[1].trim().replace(/^["']|["']$/g, '');
  }
  return key;
}

const key = getKey();
if (!key) { console.error('no SCRAPECREATORS_API_KEY'); process.exit(1); }

const corpus = JSON.parse(fs.readFileSync(path.join(SP, process.env.CORPUS || 'seb-corpus.json'), 'utf8'));
const own = corpus.filter((t) => !/^RT @/.test(t.text || ''));

// Top performers carry the "what works" signal; random controls give the baseline.
const byLikes = own.slice().sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0));
const top = byLikes.slice(0, 100);
const topIds = new Set(top.map((t) => t.id));
const rest = own.filter((t) => !topIds.has(t.id));
for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
const controls = rest.slice(0, Math.max(0, MAX_CREDITS - top.length));

const targets = [...top, ...controls];
if (targets.length > MAX_CREDITS) {
  console.error(`refusing: ${targets.length} > MAX_CREDITS ${MAX_CREDITS}`);
  process.exit(1);
}
console.error(`backfilling views for ${targets.length} posts (${top.length} top + ${controls.length} control) = ${targets.length} credits`);

const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
let spent = 0;
let remaining = null;

for (const t of targets) {
  if (out[t.id] != null) continue;
  const url = `https://x.com/${HANDLE}/status/${t.id}`;
  try {
    const res = await fetch(`https://api.scrapecreators.com/v1/twitter/tweet?url=${encodeURIComponent(url)}`, {
      headers: { 'x-api-key': key, 'User-Agent': 'HitloopXResearch/1.0' },
    });
    if (!res.ok) { console.error(`${t.id}: HTTP ${res.status}`); continue; }
    const j = await res.json();
    spent += j.credits_charged ?? 1;
    if (j.credits_remaining != null) remaining = j.credits_remaining;
    const v = j.views?.count ?? j.tweet?.views?.count ?? null;
    out[t.id] = v == null ? null : Number(v);
  } catch (err) {
    console.error(`${t.id}: ${String(err.message).slice(0, 120)}`);
  }
  if (spent % 25 === 0) fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  await new Promise((r) => setTimeout(r, 250));
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
const got = Object.values(out).filter((v) => v != null).length;
console.error(`done. credits spent this run: ${spent}. remaining: ${remaining}. views resolved: ${got}/${Object.keys(out).length}`);
