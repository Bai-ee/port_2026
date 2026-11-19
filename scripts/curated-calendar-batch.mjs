#!/usr/bin/env node
// curated-calendar-batch.mjs — put owner-approved curated Video Remix videos (rv-*, curation.state 'approved') on the
// media owner's `ue` calendar as REVIEW DRAFTS, one a day from tomorrow, through the existing calendar-batch path
// (features/x-content-inventory/calendar-batch.js). Drafts only: never approves, schedules or publishes.
// Copy = the client's mix format (post-format.js); media = the item's own video (same signers as the daily loop).
//
//   node scripts/curated-calendar-batch.mjs            # preview (read-only)
//   node scripts/curated-calendar-batch.mjs --execute  # write the drafts (production; owner OK required)
//
// Skips approved videos already used (any non-rejected social_posts row), matching lastUsed in the daily fill.
// Order: oldest approval first, but the same title never lands on two days in a row.
// Reads .env.local from the repo root (or ENV_FILE). Re-runs are safe: idempotencyKey calendar-batch:<id>.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = process.env.ENV_FILE || path.join(root, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m && process.env[m[1].trim()] === undefined) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
const execute = process.argv.includes('--execute');
const require = createRequire(import.meta.url);
const EV_LONG_SIGN_MS = 6.9 * 24 * 60 * 60 * 1000; // as app/api/worker/daily-loop/route.js

const fb = require('../api/_lib/firebase-admin.cjs');
const bridge = require('../api/_lib/editvideos-bridge.cjs');
const { createStrategyHandlersFromDb } = await import('../features/x-strategy/route-handlers.js');
const { pickMedia } = await import('../features/x-content-inventory/item-actions.js');
const { readAllPackages } = await import('../features/x-content-inventory/store.js');
const { tokenUrlFor } = await import('../features/x-content-inventory/thumbs.js');
const { mediaOwnerClientId } = await import('../features/rendered-videos/firestore-sync.js');
const { bucketOfPackage } = await import('../features/x-strategy/content-tracks.js');
const { draftTextFor, needsOwnerStory } = await import('../features/x-content-inventory/calendar-batch.js');

const db = fb.adminDb;
const clientId = mediaOwnerClientId();
if (!clientId) throw new Error('no media owner client id (RENDERED_VIDEOS_CLIENT_ID)');

const packages = await readAllPackages({ clientId, db });
const posts = await db.collection('social_posts').where('clientId', '==', clientId).select('packageId', 'status').get();
const usedIds = new Set(posts.docs.map((d) => d.data()).filter((r) => r.packageId && r.status !== 'rejected').map((r) => r.packageId));
const approved = packages.filter((p) => p?.id && p.curation?.state === 'approved' && bucketOfPackage(p) === 'ue');
const excluded = approved.filter((p) => usedIds.has(p.id));
const fresh = approved.filter((p) => !usedIds.has(p.id))
  .sort((a, b) => String(a.curation?.at || '').localeCompare(String(b.curation?.at || '')) || a.id.localeCompare(b.id));

// FIFO, but never the same title on consecutive days: take the oldest whose title differs from yesterday's.
const key = (p) => String(p.title ?? p.id).toLowerCase().trim();
const ordered = [];
const left = [...fresh];
while (left.length) {
  const prev = ordered.length ? key(ordered.at(-1)) : null;
  const i = Math.max(0, left.findIndex((p) => key(p) !== prev));
  ordered.push(left.splice(i, 1)[0]);
}

console.log(`client ${clientId}: approved ue ${approved.length}, already used ${excluded.length}, to place ${ordered.length}`);
for (const p of excluded) console.log(`  excluded (already used): ${p.id} ${p.title}`);
if (!ordered.length) process.exit(0);
// Every item must produce postable mix copy (the preview below shows only 20 rows, text cut to 140).
const unformatted = ordered.filter((p) => needsOwnerStory(p) || /\[add your/i.test(draftTextFor(p)));
if (unformatted.length) { console.error('STOP: not in the postable format:', unformatted.map((p) => `${p.id} ${p.title}`)); process.exit(1); }

const signers = {
  async signEvLong(p) {
    try {
      const [url] = await bridge.bridgeBucket().file(p).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + EV_LONG_SIGN_MS });
      return url;
    } catch { return null; }
  },
  hitloopUrl: (p) => tokenUrlFor(fb.adminStorage.bucket(), p),
};
const handlers = createStrategyHandlersFromDb(db, {
  readPackages: (id) => readAllPackages({ clientId: id, db }),
  mediaForItem: (id, pkg) => (pkg && pkg.clientId === id ? pickMedia(pkg, signers) : null),
});

const spec = { select: { bucketId: 'ue', ids: ordered.map((p) => p.id) }, dateRule: { kind: 'spread', perDay: 1 }, order: 'ids', limit: ordered.length };
const context = { clientId };
const preview = await handlers.handle('strategy-calendar-batch-preview', { clientId, spec }, context);
if (!preview?.ok) { console.error('preview failed:', preview); process.exit(1); }
for (const r of preview.rows) console.log(`\n${r.reviewOn}  ${r.packageId}  needsStory=${r.needsStory}\n${r.content}`);
console.log('\ncounts', JSON.stringify(preview.counts), 'first', preview.firstDate, 'last', preview.lastDate);
if (preview.counts?.drafts !== ordered.length || Object.keys(preview.counts?.skipped || {}).length) {
  console.error('STOP: preview does not place every item', JSON.stringify(preview.counts), JSON.stringify(preview.skipped)); process.exit(1);
}

if (!execute) { console.log('\npreview only; pass --execute to write drafts'); process.exit(0); }
const out = await handlers.handle('strategy-calendar-batch-create', { clientId, spec }, context);
console.log('\nexecuted:', JSON.stringify({ ok: out?.ok, created: out?.created, existing: out?.existing, placed: out?.placed, failed: out?.failed, firstDate: out?.firstDate, lastDate: out?.lastDate }));
process.exit(out?.ok && !out.failed?.length ? 0 : 1);
