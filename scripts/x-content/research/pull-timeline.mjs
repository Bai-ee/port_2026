#!/usr/bin/env node
// Chain bird `user-tweets` pages (200/run cap) until we pass the cutoff date.
// Free path: bird uses the local browser's x.com cookies, no API credits.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SP = path.dirname(new URL(import.meta.url).pathname);
const BIRD = path.join(SP, 'birdtool', 'node_modules', '.bin', 'bird');
const HANDLE = process.argv[2] || '@seb__design';
const CUTOFF = new Date(process.argv[3] || '2026-06-10T00:00:00Z');
const OUT = path.join(SP, 'seb-corpus.json');

const all = [];
const seen = new Set();
let cursor = null;
let round = 0;

while (round < 12) {
  round += 1;
  const args = ['user-tweets', HANDLE, '-n', '200', '--max-pages', '10', '--delay', '1200', '--json'];
  if (cursor) args.push('--cursor', cursor);
  let raw;
  try {
    raw = execFileSync(BIRD, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    console.error(`round ${round} failed:`, String(err.stderr || err.message).slice(0, 300));
    break;
  }
  const start = raw.indexOf('{');
  const arrStart = raw.indexOf('[');
  const jsonStart = start === -1 ? arrStart : (arrStart === -1 ? start : Math.min(start, arrStart));
  let payload;
  try {
    payload = JSON.parse(raw.slice(jsonStart));
  } catch (err) {
    console.error(`round ${round} parse failed`, String(err.message).slice(0, 200));
    break;
  }
  const tweets = Array.isArray(payload) ? payload : (payload.tweets || []);
  const next = Array.isArray(payload) ? null : (payload.nextCursor || null);

  let added = 0;
  for (const t of tweets) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    all.push(t);
    added += 1;
  }
  const oldest = tweets.reduce((acc, t) => {
    const d = new Date(t.createdAt);
    return !acc || d < acc ? d : acc;
  }, null);
  console.error(`round ${round}: +${added} (total ${all.length}) oldest=${oldest ? oldest.toISOString() : 'n/a'} cursor=${next ? 'yes' : 'none'}`);

  if (oldest && oldest < CUTOFF) break;
  if (!next || added === 0) break;
  cursor = next;
}

all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
fs.writeFileSync(OUT, JSON.stringify(all, null, 2));
console.error(`wrote ${all.length} posts -> ${OUT}`);
