#!/usr/bin/env node
// Seed the 15-day calendar into `social_posts` as DRAFTS.
//
// SAFETY PROPERTIES — read before changing anything here:
//  * Writes `status:'draft'` with `scheduledAt:null`. The publish sweep only
//    picks up `scheduled|queued|failed` (`twitter-service.js` DUE_STATUSES), so
//    nothing seeded here can ever auto-publish. Posting stays a manual act.
//  * Makes ZERO X API calls. Firestore only.
//  * Dry-run is the default. `--execute` is required to write.
//  * Every post is re-guarded here even though the calendar was guarded at
//    build time — the file is editable by hand and the guard is cheap.
//    Anything with `hardBlock` is refused, never written.
//
// Usage:
//   node scripts/x-content/seed-calendar-drafts.mjs                      # dry run
//   node scripts/x-content/seed-calendar-drafts.mjs --client <id> --execute --max 40

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { guardXPost } from '../../features/x-content-guard/index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const CALENDAR = path.join(REPO, 'docs/audits/x-calendar-15day.json');

function parseArgs(argv) {
  const out = { execute: false, client: '', max: Infinity, days: Infinity };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--execute') out.execute = true;
    else if (a === '--client') out.client = argv[++i] || '';
    else if (a === '--max') out.max = Number(argv[++i]) || Infinity;
    else if (a === '--days') out.days = Number(argv[++i]) || Infinity;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const calendar = JSON.parse(readFileSync(CALENDAR, 'utf8'));

// Flatten to a write list, guarding as we go.
const candidates = [];
for (const day of calendar.days) {
  if (day.day > args.days) continue;
  for (const slot of day.slots) {
    const copy = String(slot.copy || '').trim();
    if (!copy) continue;
    // Retweets are not drafts — they have no copy of their own to publish.
    if (slot.type === 'retweet') continue;

    const verdict = guardXPost({
      text: copy,
      type: slot.type,
      media: slot.asset ? 'video' : 'none',
    });

    candidates.push({
      day: day.day,
      weekday: day.weekday,
      slot: slot.slot,
      timeCT: slot.timeCT,
      type: slot.type,
      lane: slot.lane,
      copy,
      chars: copy.length,
      selfReply: slot.selfReply || null,
      asset: slot.asset || null,
      brief: slot.brief || null,
      verdict,
    });
  }
}

const blocked = candidates.filter((c) => c.verdict.hardBlock);
const tooLong = candidates.filter((c) => c.chars > 280);
const writable = candidates.filter((c) => !c.verdict.hardBlock && c.chars <= 280).slice(0, args.max);

const byLane = {};
const byType = {};
for (const c of writable) {
  byLane[c.lane] = (byLane[c.lane] || 0) + 1;
  byType[c.type] = (byType[c.type] || 0) + 1;
}

console.log(`calendar: ${calendar.days.length} days, ${candidates.length} draftable slots\n`);
console.log('=== gate ===');
console.log(`  hard-blocked (refused)  ${blocked.length}`);
console.log(`  over 280 chars (refused) ${tooLong.length}`);
console.log(`  writable                 ${writable.length}${args.max !== Infinity ? ` (capped at ${args.max})` : ''}`);
console.log(`  lanes  ${Object.entries(byLane).map(([k, v]) => `${k}:${v}`).join('  ')}`);
console.log(`  types  ${Object.entries(byType).map(([k, v]) => `${k}:${v}`).join('  ')}\n`);

for (const c of blocked) console.log(`  REFUSED d${c.day} ${c.slot} [${c.verdict.lane}] ${c.copy.slice(0, 60)}`);
for (const c of tooLong) console.log(`  REFUSED d${c.day} ${c.slot} ${c.chars} chars`);
if (blocked.length || tooLong.length) console.log();

if (!args.execute) {
  console.log('=== DRY RUN — nothing written. Preview of the first day ===\n');
  writable
    .filter((c) => c.day === writable[0]?.day)
    .forEach((c) => {
      console.log(`  ${c.timeCT}  ${c.type} / ${c.lane}  (${c.chars}ch, score ${c.verdict.xGrowthScore ?? '—'})`);
      console.log(`    ${c.copy.replace(/\n/g, ' ⏎ ')}`);
      if (c.asset) console.log(`    FILM: ${c.asset}`);
      if (c.selfReply) console.log(`    REPLY: ${c.selfReply.replace(/\n/g, ' ⏎ ')}`);
      console.log();
    });
  console.log(`Would write ${writable.length} drafts.`);
  console.log('To write them:  --client <clientId> --execute [--max N] [--days N]');
  process.exit(0);
}

if (!args.client) {
  console.error('ERROR: --client <clientId> is required with --execute.');
  console.error('Refusing to guess a tenant — drafts would land on the wrong account.');
  process.exit(1);
}

// Env must be injected BEFORE firebase-admin initialises, or the admin SDK falls
// back to application-default credentials and every write fails with
// "Could not load the default credentials".
const require = createRequire(import.meta.url);
require(path.join(REPO, 'features/not-the-rug-brief/load-env'));

// Import lazily: this pulls in firebase-admin and needs env, which a dry run should not require.
const { createSocialPost } = await import('../../features/social-posting/twitter-service.js');

let ok = 0;
let failed = 0;
for (const c of writable) {
  try {
    const post = await createSocialPost(args.client, {
      content: c.copy,
      source: 'calendar-15day',
      status: 'draft',
      scheduledAt: null,
      platform: 'x',
    });
    ok += 1;
    console.log(`  wrote d${String(c.day).padStart(2)} ${c.slot} ${c.type.padEnd(18)} ${post.id}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAILED d${c.day} ${c.slot}: ${err?.message || err}`);
  }
}

console.log(`\ndone. ${ok} drafts written, ${failed} failed.`);
console.log('They are drafts with scheduledAt:null — the publish sweep ignores them. Post manually from the Copywriter card.');
