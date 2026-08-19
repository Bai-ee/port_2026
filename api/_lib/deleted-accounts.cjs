// Deleted-account audit history.
//
// Deleting an account records the email in deleted_account_emails/{email} for
// operational history only. It must not block a future signup: users are allowed
// to delete an account and come back later with the same email.
const fb = require('./firebase-admin.cjs');

const BLOCK_COLLECTION = 'deleted_account_emails';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

async function isEmailBlocked(email) {
  normalizeEmail(email);
  return false;
}

// Called from account deletion. Records the deletion as audit/history only.
async function recordDeletedAccount({ email, uid = null, clientId = null }) {
  const normalized = normalizeEmail(email);
  if (!normalized) return;
  const ref = fb.adminDb.collection(BLOCK_COLLECTION).doc(normalized);
  await ref.set({
    email: normalized,
    uid,
    clientId,
    deletedAt: fb.FieldValue.serverTimestamp(),
  });
}

module.exports = {
  BLOCK_COLLECTION,
  isEmailBlocked,
  normalizeEmail,
  recordDeletedAccount,
};
