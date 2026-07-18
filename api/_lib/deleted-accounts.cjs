// Re-signup blocklist for deleted accounts.
//
// Deleting an account records the email in deleted_account_emails/{email};
// signup (client provisioning) is refused for emails in the list with
// DELETED_ACCOUNT_MESSAGE. Sole exception: REUSABLE_DELETE_EMAIL (the test
// account) is never recorded — deleting it clears any stale entry instead, so
// it can cycle signup → delete → signup freely.
const fb = require('./firebase-admin.cjs');

const BLOCK_COLLECTION = 'deleted_account_emails';
const REUSABLE_DELETE_EMAIL = 'sangamondivide@gmail.com';
const DELETED_ACCOUNT_MESSAGE = 'Deleted Account, Contact Bryan.';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

async function isEmailBlocked(email) {
  const normalized = normalizeEmail(email);
  if (!normalized || normalized === REUSABLE_DELETE_EMAIL) return false;
  const snap = await fb.adminDb.collection(BLOCK_COLLECTION).doc(normalized).get();
  return snap.exists;
}

// Called from account deletion. Records the block, or clears any stale entry
// for the reusable test account.
async function recordDeletedAccount({ email, uid = null, clientId = null }) {
  const normalized = normalizeEmail(email);
  if (!normalized) return;
  const ref = fb.adminDb.collection(BLOCK_COLLECTION).doc(normalized);
  if (normalized === REUSABLE_DELETE_EMAIL) {
    await ref.delete();
    return;
  }
  await ref.set({
    email: normalized,
    uid,
    clientId,
    deletedAt: fb.FieldValue.serverTimestamp(),
  });
}

module.exports = {
  BLOCK_COLLECTION,
  DELETED_ACCOUNT_MESSAGE,
  REUSABLE_DELETE_EMAIL,
  isEmailBlocked,
  normalizeEmail,
  recordDeletedAccount,
};
