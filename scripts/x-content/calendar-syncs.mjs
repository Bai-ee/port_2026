#!/usr/bin/env node
// Show, set or run a client's calendar syncs (client_configs/{clientId}.calendarSyncs, see
// features/social-posting/calendar-sync.js): the other clients whose scheduled posts this client also publishes on
// its own accounts, with the X mode (copy | repost | off), Instagram mode (copy | off), delay in minutes and mode
// (draft = copies wait unscheduled on the calendar, the default | schedule = copies auto-post).
//
// DEFAULT IS A DRY RUN: prints the current list, the proposed list and what a sync would create / retire.
// Nothing is written and nothing is scheduled.
// --apply (OWNER ONLY): writes the proposed list, then runs the sync once (draft mode: unscheduled drafts on this
//   client's calendar; schedule mode: scheduled mirrors that publish through the normal due sweep).
// --run (OWNER ONLY): runs the sync once with the saved list (no config change).
//
// Usage:
//   node scripts/x-content/calendar-syncs.mjs --client <id>                                   # show + dry-run plan
//   node scripts/x-content/calendar-syncs.mjs --client <id> --set <src[:x[:ig[:delay[:mode]]]],...>   # dry run
//   node scripts/x-content/calendar-syncs.mjs --client <id> --set <...> --apply                # OWNER ONLY
//   node scripts/x-content/calendar-syncs.mjs --client <id> --run                              # OWNER ONLY
//   x defaults to copy, ig to off, delay to 0, mode to draft.  --set ""  clears the list.

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { requireClientArg } from './_client-arg.mjs';
import { normalizeCalendarSyncs, readCalendarSyncs, planCalendarSync, runCalendarSync, instagramUsable } from '../../features/social-posting/calendar-sync.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
require(path.join(REPO, 'features/not-the-rug-brief/load-env'));
const fb = require(path.join(REPO, 'api/_lib/firebase-admin.cjs'));

const clientId = requireClientArg();
const argv = process.argv.slice(2);
const si = argv.indexOf('--set');
const apply = argv.includes('--apply');
const runOnly = argv.includes('--run');
const db = fb.adminDb;

const fmt = (list) => (list.length ? list.map((e) => `${e.clientId} x=${e.x} ig=${e.instagram} delay=${e.offsetMinutes}m mode=${e.mode}`).join(' | ') : '(none)');
const current = await readCalendarSyncs(clientId, { db });
console.log(`client   ${clientId}`);
console.log(`current  ${fmt(current)}`);

let proposed = current;
if (si > -1) {
  const raw = String(argv[si + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [id, x, instagram, delay, mode] = s.split(':');
    return { clientId: id, x: x || 'copy', instagram: instagram || 'off', offsetMinutes: Number(delay) || 0, mode: mode || 'draft' };
  });
  proposed = normalizeCalendarSyncs(raw, clientId);
  for (const e of proposed) {
    if (!(await db.collection('clients').doc(e.clientId).get()).exists) { console.error(`unknown client: ${e.clientId}`); process.exit(1); }
  }
  console.log(`proposed ${fmt(proposed)}`);
}

// Dry-run plan against the live queues (reads only).
const svc = await import('../../features/social-posting/twitter-service.js');
const { getSocialAccount } = await import('../../features/social-posting/social-accounts.js');
const igAllowed = proposed.some((e) => e.instagram === 'copy') ? instagramUsable(await getSocialAccount(clientId, 'instagram').catch(() => null)) : false;
const viewerPosts = await svc.readSocialQueue(clientId);
for (const entry of proposed) {
  const sourcePosts = await svc.readSocialQueue(entry.clientId);
  const plan = planCalendarSync({ entry, viewer: clientId, sourcePosts, viewerPosts, igAllowed });
  console.log(`plan     ${entry.clientId}: create ${plan.create.length}, retire ${plan.retire.length}, keep ${plan.keep.length}, skip ${plan.skipped.length}${entry.instagram === 'copy' && !igAllowed ? ' (Instagram off: no usable account)' : ''}`);
  for (const c of plan.create) console.log(`  + ${c.payload.scheduledAt || `draft@${c.payload.plannedAt}`}  ${c.payload.kind === 'repost' ? '[repost] ' : ''}${String(c.payload.content).replace(/\s+/g, ' ').slice(0, 70)}  targets=${JSON.stringify(c.payload.targets)}`);
  for (const r of plan.retire) console.log(`  - ${r.scheduledAt || `draft@${r.plannedAt}`}  ${r.id}  ${String(r.content).replace(/\s+/g, ' ').slice(0, 60)}`);
  for (const s of plan.skipped) console.log(`  ~ ${s.postId} ${s.reason}`);
}

if (!apply && !runOnly) {
  console.log('dry run — pass --apply (writes + runs) or --run (runs the saved list).');
  process.exit(0);
}
if (apply) {
  await db.collection('client_configs').doc(clientId).set({ calendarSyncs: proposed }, { merge: true });
  console.log(`written  ${fmt(await readCalendarSyncs(clientId, { db }))}`);
}
const result = await runCalendarSync(clientId, { db, svc });
for (const e of result.entries) {
  console.log(`ran      ${e.clientId}: created ${e.created}, retired ${e.retired}, kept ${e.kept}, skipped ${e.skipped.length}`);
  for (const err of e.errors) console.log(`  ! ${err.stage} ${err.postId || err.sourcePostId || ''} ${err.code || ''} ${err.message}`);
}
