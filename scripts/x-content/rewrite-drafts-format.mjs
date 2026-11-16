#!/usr/bin/env node
// Rewrite a client's open drafts (draft / awaiting_approval) into its live post format
// (features/social-posting/post-format.js rewritePostText). Approved, scheduled and posted rows are never touched.
// Quote / narrative drafts ("[add your take]") have no format and are skipped.
//
// DEFAULT IS A DRY RUN: prints every before -> after. --apply writes through updateSocialPost (revision-checked).
//   node scripts/x-content/rewrite-drafts-format.mjs --client <id> [--apply]
// Run from a checkout that has .env.local (Firebase admin).

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
require(path.join(REPO, 'features/not-the-rug-brief/load-env'));
const fb = require(path.join(REPO, 'api/_lib/firebase-admin.cjs'));
const { rewritePostText, checkLiveReady } = await import(path.join(REPO, 'features/social-posting/post-format.js'));
const svc = await import(path.join(REPO, 'features/social-posting/twitter-service.js'));

const argv = process.argv.slice(2);
const client = argv[argv.indexOf('--client') + 1];
const apply = argv.includes('--apply');
if (!client || argv.indexOf('--client') < 0) { console.error('Usage: rewrite-drafts-format.mjs --client <id> [--apply]'); process.exit(1); }

const OPEN = new Set(['draft', 'awaiting_approval']);
const db = fb.adminDb;
const posts = (await svc.readSocialQueue(client)).filter((p) => OPEN.has(p.status));
const pkgIds = [...new Set(posts.map((p) => p.packageId).filter(Boolean))];
const pkgs = new Map();
for (let i = 0; i < pkgIds.length; i += 300) {
  // eslint-disable-next-line no-await-in-loop
  const snaps = await db.getAll(...pkgIds.slice(i, i + 300).map((id) => db.collection('x_content_packages').doc(id)));
  for (const s of snaps) if (s.exists) pkgs.set(s.id, { id: s.id, ...s.data() });
}

const tally = { changed: 0, same: 0, skipped: {}, stillNotReady: 0, written: 0, failed: 0 };
for (const p of posts) {
  const out = rewritePostText(p, pkgs.get(p.packageId) || null, client);
  if (out.skip) { tally.skipped[out.skip] = (tally.skipped[out.skip] || 0) + 1; continue; }
  if (out.content === p.content) { tally.same += 1; continue; }
  tally.changed += 1;
  const ready = checkLiveReady({ ...p, content: out.content }, { clientId: client });
  if (!ready.ready) tally.stillNotReady += 1;
  console.log(`\n--- ${p.id} (${p.status}, ${p.source || '-'})${ready.ready ? '' : `  NOT READY: ${ready.issues.map((i) => i.code).join(', ')}`}`);
  console.log(`BEFORE\n${p.content}\nAFTER\n${out.content}`);
  if (apply) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await svc.updateSocialPost(client, p.id, { content: out.content }, { expectedRevision: p.revision || 0 });
      tally.written += 1;
    } catch (err) {
      tally.failed += 1;
      console.log(`  ! write failed: ${err.message}`);
    }
  }
}
console.log(`\n${client}: ${posts.length} open · ${apply ? `written ${tally.written}, failed ${tally.failed}` : `would change ${tally.changed}`} · unchanged ${tally.same} · still not ready ${tally.stillNotReady} · skipped ${JSON.stringify(tally.skipped)}`);
process.exit(0);
