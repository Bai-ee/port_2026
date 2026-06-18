#!/usr/bin/env node
// Diagnose a client's data (why bootstrap / brief load times out). Loads
// .env.local creds, finds matching client docs, reports brief_runs + doc sizes.
//
// Run: node scripts/diag-client.mjs vivaocid

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

const needle = (process.argv[2] || 'vivaocid').toLowerCase();
const sizeKB = (obj) => Math.round(Buffer.byteLength(JSON.stringify(obj || {}), 'utf8') / 1024);

const snap = await fb.adminDb.collection('clients').get();
const matches = [];
snap.forEach((doc) => {
  const d = doc.data() || {};
  const hay = `${doc.id} ${d.name || ''} ${d.websiteUrl || d.website || ''} ${d.normalizedHost || ''}`.toLowerCase();
  if (hay.includes(needle)) matches.push({ id: doc.id, d });
});

console.log(`\nClients matching "${needle}": ${matches.length}\n`);
for (const m of matches) {
  console.log(`── ${m.id}`);
  console.log(`   name: ${m.d.name || '(none)'} | site: ${m.d.websiteUrl || m.d.website || '(none)'} | status: ${m.d.status || '(none)'}`);
  console.log(`   client doc size: ${sizeKB(m.d)} KB | createdAt: ${m.d.createdAt?.toDate?.()?.toISOString?.() || m.d.createdAt || '?'}`);
  try {
    const runs = await fb.adminDb.collection('clients').doc(m.id).collection('brief_runs').orderBy('createdAt', 'desc').limit(50).get();
    console.log(`   brief_runs: ${runs.size}`);
    let totalKB = 0;
    runs.forEach((r) => {
      const rd = r.data() || {};
      const kb = sizeKB(rd);
      totalKB += kb;
      const big = kb > 200 ? '  ⚠ LARGE' : '';
      console.log(`     · ${r.id}  status=${rd.status || '?'} type=${rd.pipelineType || '?'}  ${kb}KB${big}`);
    });
    console.log(`   brief_runs total: ${totalKB} KB${totalKB > 900 ? '  ⚠ heavy — can stall bootstrap/preview' : ''}`);
  } catch (e) {
    console.log(`   brief_runs read FAILED: ${e.message}`);
  }
  // dashboard_state doc size
  try {
    const ds = await fb.adminDb.collection('dashboard_state').doc(m.id).get();
    console.log(`   dashboard_state: ${ds.exists ? sizeKB(ds.data()) + ' KB' : 'none'}`);
  } catch (e) { console.log(`   dashboard_state read FAILED: ${e.message}`); }
  console.log();
}
process.exit(0);
