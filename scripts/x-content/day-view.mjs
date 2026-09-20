#!/usr/bin/env node
// Today's posting plan: every slot, and what content fills it.
//
// This is the thing you look at each morning. It answers "what do I post at
// 13:00" from inventory instead of from willpower, and where it cannot, it
// says exactly what is missing rather than showing an empty row.
//
// COST: zero. Pure local computation over a committed corpus and the local
// inventory file. No X API, no bird call, no LLM, no network at all.
//
// READ-ONLY, AND IT CANNOT POST. It proposes; drafting is `draft-day.mjs` and
// publishing stays behind an explicit human action.
//
// The plan itself is built by features/x-content-inventory/plan-day.js, which
// draft-day.mjs also uses — two scripts assembling the plan their own way is
// how drafted copy ends up describing a different slot than the one on screen.
//
// Usage:
//   node scripts/x-content/day-view.mjs                 # today, tier 1 (5 posts)
//   node scripts/x-content/day-view.mjs --posts 8       # tier 2
//   node scripts/x-content/day-view.mjs --date 2026-09-25
//   node scripts/x-content/day-view.mjs --json

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDayPlan } from '../../features/x-content-inventory/plan-day.js';
import { SERIES, REPLY_QUOTA_PER_DAY } from '../../features/x-content-inventory/categories.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const INVENTORY = path.join(REPO, 'features/x-content-inventory/content-packages.json');
const CORPUS = path.join(REPO, 'docs/audits/bai-ee-x-corpus.json');
const BENCHMARK = path.join(REPO, 'docs/audits/seb-design-x-corpus.json');

function parseArgs(argv) {
  const out = { posts: 5, date: new Date().toISOString().slice(0, 10), json: false, handle: 'bai_ee' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--posts') out.posts = Number(argv[++i]) || 5;
    else if (a === '--date') out.date = argv[++i] || out.date;
    else if (a === '--handle') out.handle = argv[++i] || out.handle;
    else if (a === '--json') out.json = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (!existsSync(INVENTORY)) {
  console.error(`No inventory at ${path.relative(REPO, INVENTORY)}. Nothing to plan from.`);
  process.exit(1);
}

const plan = buildDayPlan({
  corpusRows: JSON.parse(readFileSync(CORPUS, 'utf8')),
  benchmarkRows: existsSync(BENCHMARK) ? JSON.parse(readFileSync(BENCHMARK, 'utf8')) : null,
  packages: JSON.parse(readFileSync(INVENTORY, 'utf8')),
  date: args.date,
  posts: args.posts,
  handle: args.handle,
});

if (args.json) {
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  process.exit(0);
}

const out = [];
out.push('');
out.push(`POSTING PLAN — ${plan.date}  ·  ${args.posts} authored posts + ${REPLY_QUOTA_PER_DAY} replies`);
out.push(`  inventory: ${plan.audit.total} packages (${plan.audit.valid} valid) · filled ${plan.filled}/${plan.slots.length} slots`);
out.push('');

for (const s of plan.slots) {
  const head = `  ${s.timeCT}  ${String(s.slot).padEnd(2)} ${String(s.type).padEnd(18)} ${String(s.lane ?? '').padEnd(6)}`;
  if (s.source === 'scan') {
    out.push(`${head} ← daily scan (quote target found at 06:30)`);
    continue;
  }
  if (s.source === 'ledger') {
    if (!s.story) { out.push(`${head} ⚠️ ${s.matchReason}`); continue; }
    out.push(`${head} ← your own post, re-surfaced${s.adopted ? '  [adopted slot]' : ''}`);
    if (s.adoptReason) out.push(`      adopted: ${s.adoptReason}`);
    out.push(`      ${String(s.story).replace(/\n/g, ' ').slice(0, 100)}`);
    out.push(`      ${s.asset ?? ''}   why: ${s.matchReason}`);
    continue;
  }
  if (!s.packageId) {
    const gap = plan.gaps.find((g) => g.slot === s.slot);
    out.push(`${head} ⚠️ GAP`);
    out.push(`      need: ${gap?.need ?? 'unknown'}`);
    continue;
  }
  out.push(`${head} ← ${s.packageId}  [${s.series}]`);
  out.push(`      ${String(s.story ?? '').slice(0, 110)}${(s.story ?? '').length > 110 ? '…' : ''}`);
  out.push(`      asset: ${s.asset ?? '—'}   self-reply: ${s.selfReply ?? '—'}   why: ${s.matchReason}`);
}

if (plan.unfilled) {
  out.push('');
  out.push(`${plan.unfilled} unfilled slot${plan.unfilled === 1 ? '' : 's'}. That number is the inventory shortfall, not a scheduling bug —`);
  out.push('add packages in the series named above, or lower --posts until the inventory can carry the day.');
}

out.push('');
out.push('Series available: ' + Object.entries(SERIES).map(([k, s]) => `${k}=${s.label}`).join(' · '));
out.push('Copy: run `node scripts/x-content/draft-day.mjs` to draft it.');
out.push('');

process.stdout.write(`${out.join('\n')}\n`);
