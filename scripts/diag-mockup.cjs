'use strict';

/*
 * Read-only diagnostic for the Cross-Device Layouts (multi-device-view) card.
 * Resolves the signed-in user's clientId, reads dashboard_state, prints the
 * stored device-mockup URL + capture state, HEAD-checks the URL (200 vs 404),
 * and downloads the image to scripts/diag-mockup-current.webp so it can be
 * inspected. Does NOT write anything back to Firestore/Storage.
 *
 * Usage: node scripts/diag-mockup.cjs [email]   (default: bryanballi@gmail.com)
 */

const fs = require('fs');
const path = require('path');

// ── Load .env.local manually (standalone node, no Next env injection) ──
function loadEnv(file) {
  const full = path.join(process.cwd(), file);
  if (!fs.existsSync(full)) return;
  for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnv('.env.local');
loadEnv('.env');

const fb = require('../api/_lib/firebase-admin.cjs');

async function headCheck(url) {
  try {
    const res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' } });
    return { status: res.status, contentType: res.headers.get('content-type'), len: res.headers.get('content-length') };
  } catch (err) {
    return { status: 'FETCH_ERROR', error: err.message };
  }
}

async function main() {
  const email = process.argv[2] || 'bryanballi@gmail.com';
  console.log(`\n=== multi-device-view mockup diagnostic — ${email} ===\n`);

  const userRec = await fb.adminAuth.getUserByEmail(email);
  const uid = userRec.uid;
  const userSnap = await fb.adminDb.collection('users').doc(uid).get();
  const clientId = userSnap.exists ? (userSnap.data()?.clientId || null) : null;
  console.log('uid       :', uid);
  console.log('clientId  :', clientId);
  if (!clientId) { console.log('No clientId on user profile — aborting.'); return; }

  const dashSnap = await fb.adminDb.collection('dashboard_state').doc(clientId).get();
  if (!dashSnap.exists) { console.log('No dashboard_state doc — aborting.'); return; }
  const dash = dashSnap.data() || {};
  const art = dash.artifacts || {};
  const mod = dash.modules?.['multi-device-view'] || null;

  console.log('\n-- run/module state --');
  console.log('latestRunStatus      :', dash.latestRunStatus || null);
  console.log('latestRunId          :', dash.latestRunId || null);
  console.log('module status        :', mod?.status || null);
  console.log('module errorMessage  :', mod?.errorMessage || mod?.errorCode || null);

  console.log('\n-- artifacts present --');
  const mockup = art.homepageDeviceMockup || null;
  const hs = art.homepageScreenshots || {};
  const fp = art.fullPageScreenshots || {};
  console.log('homepageDeviceMockup :', mockup ? 'yes' : 'MISSING');
  console.log('viewport screenshots :', ['desktop','tablet','mobile'].filter((k) => hs[k]?.downloadUrl).join(', ') || 'none');
  console.log('full-page screenshots:', ['desktop-full','tablet-full','mobile-full'].filter((k) => fp[k]?.downloadUrl).join(', ') || 'none');

  if (!mockup?.downloadUrl) {
    console.log('\nNo mockup downloadUrl stored — the card has no composite to show.');
    console.log('=> "broken image" = stale/empty reference; last composite did not produce a mockup.');
    return;
  }

  console.log('\n-- device mockup --');
  console.log('capturedAt :', mockup.capturedAt || null);
  console.log('storagePath:', mockup.storagePath || null);
  console.log('downloadUrl:', mockup.downloadUrl);

  const check = await headCheck(mockup.downloadUrl);
  console.log('\n-- HTTP check --');
  console.log(check);

  if (check.status === 200 || check.status === 206) {
    const res = await fetch(mockup.downloadUrl);
    const buf = Buffer.from(await res.arrayBuffer());
    const out = path.join('scripts', 'diag-mockup-current.webp');
    fs.writeFileSync(out, buf);
    console.log(`\nDownloaded current mockup -> ${out} (${buf.length} bytes)`);
  } else {
    console.log('\n=> URL does NOT resolve (object missing). This is the broken image:');
    console.log('   dashboard_state references a mockup object that is 404/inaccessible.');
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('DIAG FAILED:', e.message); process.exit(1); });
