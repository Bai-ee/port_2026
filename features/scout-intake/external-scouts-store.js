'use strict';

// external-scouts-store.js — Firestore-backed cache for external scout outputs.
//
// Replaces the filesystem cache used by the reference not-the-rug-brief
// package. Each scout source has its own sub-doc under:
//
//   client_configs/{clientId}.scoutCache.{sourceKey}
//
// Keeping the cache inside client_configs (rather than a new collection)
// means the same Firestore rules / admin tooling that reads scoutConfig
// already covers scoutCache too.

const fb = require('../../api/_lib/firebase-admin.cjs');

const VALID_KEYS = new Set(['weather', 'reviews', 'reddit', 'instagram', 'xscout']);

function assertKey(key) {
  if (!VALID_KEYS.has(key)) throw new Error(`external-scouts-store: unknown source key "${key}"`);
}

async function getCached(clientId, sourceKey) {
  assertKey(sourceKey);
  if (!clientId) return null;
  try {
    const snap = await fb.adminDb.collection('client_configs').doc(clientId).get();
    if (!snap.exists) return null;
    return snap.data()?.scoutCache?.[sourceKey] || null;
  } catch (err) {
    console.warn(`[external-scouts-store] read ${sourceKey} failed: ${err.message}`);
    return null;
  }
}

async function saveCached(clientId, sourceKey, payload) {
  assertKey(sourceKey);
  if (!clientId) throw new Error('saveCached: clientId required');
  await fb.adminDb.collection('client_configs').doc(clientId).set(
    {
      scoutCache: {
        [sourceKey]: payload || null,
      },
      updatedAt: fb.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function getAllCached(clientId) {
  if (!clientId) return {};
  try {
    const snap = await fb.adminDb.collection('client_configs').doc(clientId).get();
    if (!snap.exists) return {};
    return snap.data()?.scoutCache || {};
  } catch (err) {
    console.warn(`[external-scouts-store] bulk read failed: ${err.message}`);
    return {};
  }
}

module.exports = { getCached, saveCached, getAllCached, VALID_KEYS };
