#!/usr/bin/env node
// Render a mockup video on the local GPU and write it straight into the client's
// studioCaptures (same shape the Studio captures rail + cards read) via
// firebase-admin. Lets us deliver a video "to the card" without the authed HTTP
// route or the cloud host. One-off operational helper.
//
// Run: node scripts/render-to-card.mjs [clientId]   (auto-picks if omitted)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// Load .env.local so firebase-admin.cjs finds its credentials.
for (const line of readFileSync(join(repoRoot, '.env.local'), 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(m[1] in process.env)) process.env[m[1]] = v;
}

const require = createRequire(import.meta.url);
const fb = require('../api/_lib/firebase-admin.cjs');
const { saveBufferArtifact } = require('../api/_lib/storage-artifacts.cjs');
const { renderVideo } = await import('../services/studio-render/render.mjs');

// Pick the client: arg, or the dashboard_state doc with the most studioCaptures.
async function pickClientId() {
  if (process.argv[2]) return process.argv[2];
  const snap = await fb.adminDb.collection('dashboard_state').get();
  let best = null, bestN = -1;
  snap.forEach((doc) => {
    const n = Array.isArray(doc.data()?.studioCaptures) ? doc.data().studioCaptures.length : 0;
    if (n > bestN) { bestN = n; best = doc.id; }
  });
  if (!best && !snap.empty) best = snap.docs[0].id;
  if (!best) throw new Error('No dashboard_state docs found — pass a clientId explicitly.');
  console.log(`Auto-picked clientId=${best} (${bestN} existing captures)`);
  return best;
}

const recipe = {
  url: 'https://hitloop.agency',
  preset: 'push-rotate-flat',
  output: { seconds: 8, fps: 30, width: 1920, height: 1200, siteSpeed: 1 },
  device: { viewport: 'desktop', backdrop: 'home', loop: true },
  capture: { warmupMs: 400 },
  scroll: { target: { selector: '#reel-player-shell' }, startAt: 0.25, arriveAt: 0.85, align: 'center' },
};

const clientId = await pickClientId();
console.log('Rendering on local GPU…');
const { buffer, info } = await renderVideo(recipe);
console.log(`Rendered ${(buffer.length / 1024 / 1024).toFixed(2)}MB`, info);

const stamp = Date.now();
const capturedAt = new Date().toISOString();
const stored = await saveBufferArtifact({
  storagePath: `clients/${clientId}/studio/render-${stamp}.webm`,
  buffer,
  contentType: 'video/webm',
  metadata: { artifactType: 'studio_video', clientId, capturedAt, sourceUrl: recipe.url, renderedBy: 'render-to-card-local-gpu' },
});

const ref = {
  type: 'studio_video', variant: 'video',
  label: `Cloud render · desktop · ${recipe.output.seconds}s`,
  viewportId: 'desktop', durationSeconds: recipe.output.seconds, sourceUrl: recipe.url,
  storageProvider: 'firebase-storage', bucket: stored.bucket, storagePath: stored.storagePath,
  contentType: stored.contentType, sizeBytes: stored.sizeBytes, capturedAt, downloadUrl: stored.downloadUrl,
  renderInfo: info,
};

const docRef = fb.adminDb.collection('dashboard_state').doc(clientId);
await fb.adminDb.runTransaction(async (tx) => {
  const snap = await tx.get(docRef);
  const current = Array.isArray(snap.data()?.studioCaptures) ? snap.data().studioCaptures : [];
  const next = [...current.filter((i) => i?.storagePath !== ref.storagePath), ref].slice(-40);
  tx.set(docRef, { studioCaptures: next }, { merge: true });
});

console.log(`\n✓ Written to studioCaptures for clientId=${clientId}`);
console.log(`  downloadUrl: ${stored.downloadUrl}`);
process.exit(0);
