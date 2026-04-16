#!/usr/bin/env node
'use strict';

// reset-stuck-run.cjs — finds the latest running brief_run and marks it failed.
// Run from repo root: node scripts/reset-stuck-run.cjs
// Reads .env.local automatically. Uses FIREBASE_ADMIN_* env var prefix.

const fs   = require('fs');
const path = require('path');

// Manual .env.local parse — avoids dotenv banner injection issues
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue }     = require('firebase-admin/firestore');

function parseKey(raw) {
  return String(raw || '').replace(/^"|"$/g, '').replace(/\\n/g, '\n');
}

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey:  parseKey(process.env.FIREBASE_ADMIN_PRIVATE_KEY),
    }),
  });
}
const db = getFirestore();

async function patchDashboard(clientId) {
  const now = FieldValue.serverTimestamp();

  // 1. Fix any stuck runs in the client subcollection (what the dashboard reads for currentRun.status)
  const subSnap = await db.collection('clients').doc(clientId)
    .collection('brief_runs')
    .where('status', '==', 'running')
    .limit(5)
    .get();

  if (!subSnap.empty) {
    const runUpdate = {
      status:      'failed',
      workerLease: null,
      completedAt: now,
      updatedAt:   now,
      error: {
        message:  'Run reset manually via reset-stuck-run.cjs',
        stage:    'psi',
        failedAt: new Date().toISOString(),
        exhausted: false,
      },
    };
    for (const doc of subSnap.docs) {
      console.log(`  Patching subcollection run: ${doc.id} → failed`);
      await db.collection('clients').doc(clientId)
        .collection('brief_runs').doc(doc.id)
        .set(runUpdate, { merge: true });
      // Also patch top-level brief_runs for consistency
      await db.collection('brief_runs').doc(doc.id)
        .set(runUpdate, { merge: true });
    }
  } else {
    console.log('  No running runs in client subcollection (may already be cleared).');
  }

  // 2. Patch dashboard_state so the retry button appears
  await db.collection('dashboard_state').doc(clientId).set({
    latestRunStatus: 'failed',
    updatedAt: now,
    errorState: {
      message:      'Run timed out. Click to retry.',
      failedAt:     new Date().toISOString(),
      retryPending: true,
    },
  }, { merge: true });

  // 3. Patch client doc
  await db.collection('clients').doc(clientId).set({
    latestRunStatus: 'failed',
    status:          'provisioning',
    updatedAt:       now,
  }, { merge: true });

  console.log(`\nDone. dashboard_state/${clientId} patched — retry button should appear.`);
}

async function main() {
  const args = process.argv.slice(2);
  const patchIdx = args.indexOf('--patch-dashboard');

  // Mode: --patch-dashboard <clientId>
  // Use when the run was already cleared but dashboard_state was never updated.
  if (patchIdx !== -1) {
    const clientId = args[patchIdx + 1];
    if (!clientId) {
      console.error('Usage: node scripts/reset-stuck-run.cjs --patch-dashboard <clientId>');
      process.exit(1);
    }
    console.log(`Patching dashboard_state for clientId: ${clientId}`);
    await patchDashboard(clientId);
    return;
  }

  // Default mode: find running brief_runs and mark them failed.
  const snap = await db.collection('brief_runs')
    .where('status', '==', 'running')
    .limit(10)
    .get();

  if (snap.empty) {
    console.log('No running brief_runs found. Nothing to reset.');
    console.log('If the run was already cleared but the dashboard is still stuck, run:');
    console.log('  node scripts/reset-stuck-run.cjs --patch-dashboard <clientId>');
    return;
  }

  for (const doc of snap.docs) {
    const run = doc.data();
    const runId   = doc.id;
    const clientId = run.clientId || '(unknown)';
    const startedAt = run.startedAt?.toDate?.()?.toISOString?.() || run.startedAt || '?';
    console.log(`\nFound running run:`);
    console.log(`  runId:    ${runId}`);
    console.log(`  clientId: ${clientId}`);
    console.log(`  startedAt: ${startedAt}`);
    console.log(`  attempts:  ${run.attempts ?? 0}`);
  }

  if (snap.docs.length > 1) {
    console.log('\nMultiple running runs found. Resetting the most recent one.');
  }

  const doc     = snap.docs[0];
  const runId   = doc.id;
  const clientId = doc.data().clientId;
  const now     = FieldValue.serverTimestamp();

  const runUpdate = {
    status:      'failed',
    workerLease: null,
    completedAt: now,
    updatedAt:   now,
    error: {
      message:  'Run reset manually via reset-stuck-run.cjs',
      stage:    'psi',
      failedAt: new Date().toISOString(),
      attempts: doc.data().attempts ?? 1,
      exhausted: false,
    },
  };

  const writes = [
    db.collection('brief_runs').doc(runId).set(runUpdate, { merge: true }),
  ];

  if (clientId) {
    writes.push(
      db.collection('clients').doc(clientId)
        .collection('brief_runs').doc(runId)
        .set(runUpdate, { merge: true }),
      db.collection('dashboard_state').doc(clientId).set({
        latestRunStatus: 'failed',
        updatedAt: now,
        errorState: {
          message:      'Run timed out. Click to retry.',
          failedAt:     new Date().toISOString(),
          retryPending: true,
        },
      }, { merge: true }),
      db.collection('clients').doc(clientId).set({
        latestRunStatus: 'failed',
        status:          'provisioning',
        updatedAt:       now,
      }, { merge: true }),
    );
  }

  await Promise.all(writes);

  console.log(`\nDone. Run ${runId} marked failed.`);
  if (clientId) {
    console.log(`dashboard_state/${clientId} updated — retry button should appear.`);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
