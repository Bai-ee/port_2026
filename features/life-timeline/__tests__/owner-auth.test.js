import test from 'node:test';
import assert from 'node:assert/strict';
import { requireLifeOwner } from '../owner-auth.js';

const req = (tok) => ({ headers: new Headers(tok ? { authorization: `Bearer ${tok}` } : {}) });
const verify = async (r) => {
  const a = r.headers.authorization;
  if (a === 'Bearer good') return { uid: 'owner' };
  if (a === 'Bearer other') return { uid: 'someone' };
  throw new Error('bad');
};
const env = { LIFE_OWNER_UIDS: 'x, owner' };

test('503 when unset or empty', async () => {
  for (const e of [{}, { LIFE_OWNER_UIDS: ' , ' }]) {
    await assert.rejects(requireLifeOwner(req('good'), { verifyRequestUser: verify, env: e }), (x) => x.status === 503);
  }
});
test('401 bad/missing token', async () => {
  await assert.rejects(requireLifeOwner(req('nope'), { verifyRequestUser: verify, env }), (x) => x.status === 401);
  await assert.rejects(requireLifeOwner(req(null), { verifyRequestUser: verify, env }), (x) => x.status === 401);
});
test('403 non-owner, 200 owner', async () => {
  await assert.rejects(requireLifeOwner(req('other'), { verifyRequestUser: verify, env }), (x) => x.status === 403);
  assert.equal((await requireLifeOwner(req('good'), { verifyRequestUser: verify, env })).uid, 'owner');
});
