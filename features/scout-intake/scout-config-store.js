'use strict';

// scout-config-store.js — Firestore-backed read/write for the per-client
// scout enrichment config. Shape mirrors a `clients.js` entry from the
// external scout library (without scribe/guardian — we own those) so an
// admin edit surface later can treat the doc as if it were a .js module.
//
// Storage path: client_configs/{clientId}.scoutConfig

const fb = require('../../api/_lib/firebase-admin.cjs');

/**
 * Read the saved scoutConfig for a client. Returns null when absent.
 */
async function getScoutConfig(clientId) {
  if (!clientId) return null;
  try {
    const snap = await fb.adminDb.collection('client_configs').doc(clientId).get();
    if (!snap.exists) return null;
    return snap.data()?.scoutConfig || null;
  } catch (err) {
    console.warn(`[scout-config-store] read failed for ${clientId}: ${err.message}`);
    return null;
  }
}

/**
 * Persist a scoutConfig. Merges into client_configs/{clientId} so other
 * client config fields (onboardingAnswers, sourceInputs, etc.) stay intact.
 */
async function saveScoutConfig(clientId, scoutConfig) {
  if (!clientId) throw new Error('saveScoutConfig: clientId required');
  if (!scoutConfig || typeof scoutConfig !== 'object') {
    throw new Error('saveScoutConfig: scoutConfig must be an object');
  }
  await fb.adminDb.collection('client_configs').doc(clientId).set(
    {
      scoutConfig,
      updatedAt: fb.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

module.exports = { getScoutConfig, saveScoutConfig };
