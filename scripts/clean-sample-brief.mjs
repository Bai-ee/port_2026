#!/usr/bin/env node
// Remove the fake "Admin Dashboard" sample brief that the bootstrap seeder wrote
// into impersonated clients' dashboard_state.scribe. Targets ONLY the sample
// (headline 'Admin Dashboard' + 'sample brief' summary) so real scribe briefs
// are untouched. Dry-run by default; pass --apply to write.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const line of readFileSync(join(repoRoot, '.env.local'), 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (!m) continue;
  let v = m[2].trim(); if (/^["']/.test(v)) v = v.slice(1, -1); if (!(m[1] in process.env)) process.env[m[1]] = v;
}
const require = createRequire(import.meta.url);
const fb = require('../api/_lib/firebase-admin.cjs');

const APPLY = process.argv.includes('--apply');
const snap = await fb.adminDb.collection('dashboard_state').get();
const hits = [];
snap.forEach((doc) => {
  const b = doc.data()?.scribe?.brief;
  if (b && b.headline === 'Admin Dashboard' && /sample brief/i.test(b.summary || '')) hits.push(doc.id);
});

console.log(`Polluted dashboard_state docs (fake "Admin Dashboard" scribe): ${hits.length}`);
hits.forEach((id) => console.log('  -', id));

if (!hits.length) { console.log('Nothing to clean.'); process.exit(0); }
if (!APPLY) { console.log('\nDry run. Re-run with --apply to remove the sample scribe field.'); process.exit(0); }

for (const id of hits) {
  await fb.adminDb.collection('dashboard_state').doc(id).update({ scribe: fb.FieldValue.delete() });
  console.log('  cleaned', id);
}
console.log('\n✓ Removed fake sample scribe from', hits.length, 'client(s). Real marketingBrief now renders.');
process.exit(0);
