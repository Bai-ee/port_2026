#!/usr/bin/env node
// Apply owner decision D1 to stored rendered-video packages (x_content_packages).
//   BAI-EE mixes -> owned; every other UE-hosted mix -> cleared (+rightsSource). Human rights untouched.
//
// Usage: node scripts/x-content/apply-ue-rights-policy.mjs            # dry run (default), prints counts only
//        node scripts/x-content/apply-ue-rights-policy.mjs --write    # writes (idempotent)
// WRITES to production Firestore only with --write. No X / LLM / paid calls.

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyUeRightsPolicy } from '../../features/rendered-videos/ue-rights-policy.js';

export { applyUeRightsPolicy };

const COLLECTION = 'x_content_packages';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function main() {
  const require = createRequire(import.meta.url);
  require(path.join(REPO, 'features/not-the-rug-brief/load-env'));
  const fb = require(path.join(REPO, 'api/_lib/firebase-admin.cjs'));
  const write = process.argv.includes('--write');
  const col = fb.adminDb.collection(COLLECTION);

  const store = {
    async listPackages() {
      const rows = [];
      let cursor = null;
      for (;;) {
        let q = col.orderBy('__name__');
        if (cursor) q = q.startAfter(cursor);
        const snap = await q.limit(500).get();
        if (!snap.docs.length) break;
        for (const d of snap.docs) rows.push({ id: d.id, ...(d.data() || {}) });
        cursor = snap.docs[snap.docs.length - 1];
        if (snap.docs.length < 500) break;
      }
      return rows;
    },
    async applyPatches(items) {
      for (let i = 0; i < items.length; i += 400) {
        const batch = fb.adminDb.batch();
        for (const { id, patch } of items.slice(i, i + 400)) batch.set(col.doc(id), { ...patch, updatedAt: Date.now() }, { merge: true });
        await batch.commit();
      }
    },
  };

  console.log(JSON.stringify(await applyUeRightsPolicy(store, { write })));
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e?.message || 'failed'); process.exit(1); });
}
