'use strict';

// conversation-intake-store.js — Firestore-backed read/write for the per-client
// "Conversation Intake" payload. The Marketing Director pastes a daily team
// conversation dump (Discord/WhatsApp export); the parser distills it into
// tagged items that the daily brief pipeline reads as extra source context.
//
// Storage path: client_configs/{clientId}.conversationIntake
//   { items: [{ type, summary, relevance, sourceQuote }],
//     rawCharCount, itemCount, digestedAtIso }
//
// Lives on the same client_configs doc as scoutConfig / marketingBriefConfig so
// runtime.js receives it for free via the clientConfig param (no extra read).

const fb = require('../../api/_lib/firebase-admin.cjs');

/**
 * Read the saved conversation intake for a client. Returns null when absent.
 */
async function getConversationIntake(clientId) {
  if (!clientId) return null;
  try {
    const snap = await fb.adminDb.collection('client_configs').doc(clientId).get();
    if (!snap.exists) return null;
    return snap.data()?.conversationIntake || null;
  } catch (err) {
    console.warn(`[conversation-intake-store] read failed for ${clientId}: ${err.message}`);
    return null;
  }
}

/**
 * Persist a conversation intake payload. Merges into client_configs/{clientId}
 * so scoutConfig / marketingBriefConfig / other fields stay intact.
 */
async function saveConversationIntake(clientId, conversationIntake) {
  if (!clientId) throw new Error('saveConversationIntake: clientId required');
  if (!conversationIntake || typeof conversationIntake !== 'object') {
    throw new Error('saveConversationIntake: conversationIntake must be an object');
  }
  await fb.adminDb.collection('client_configs').doc(clientId).set(
    {
      conversationIntake,
      updatedAt: fb.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

module.exports = { getConversationIntake, saveConversationIntake };
