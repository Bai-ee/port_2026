const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { makeFakeContext } = require('./fake-firestore.cjs');

const firebaseAdminPath = path.resolve(__dirname, '../firebase-admin.cjs');
const deletedAccountsPath = path.resolve(__dirname, '../deleted-accounts.cjs');

function loadModuleWithFakeFirebase() {
  delete require.cache[deletedAccountsPath];
  const fake = makeFakeContext();
  require.cache[firebaseAdminPath] = {
    id: firebaseAdminPath,
    filename: firebaseAdminPath,
    loaded: true,
    exports: fake,
  };
  const mod = require(deletedAccountsPath);
  return { fake, mod };
}

test('deleted-account records are audit history only and never block re-signup', async () => {
  const { fake, mod } = loadModuleWithFakeFirebase();

  await mod.recordDeletedAccount({
    email: 'BryanBalli@ParacDice.com',
    uid: 'user-1',
    clientId: 'client-1',
  });

  const stored = fake.adminDb._raw(mod.BLOCK_COLLECTION, 'bryanballi@paracdice.com');
  assert.equal(stored.email, 'bryanballi@paracdice.com');
  assert.equal(stored.uid, 'user-1');
  assert.equal(stored.clientId, 'client-1');

  assert.equal(await mod.isEmailBlocked('bryanballi@paracdice.com'), false);
});
