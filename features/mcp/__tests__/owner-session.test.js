import test from 'node:test';
import assert from 'node:assert/strict';
import { ownerAuthorization, _resetOwnerSessionCache } from '../owner-session.js';

const fakeAuth = () => {
  const calls = [];
  return { calls, getUserByEmail: async (e) => { calls.push(['user', e]); return { uid: 'u1' }; }, createCustomToken: async (uid, claims) => { calls.push(['custom', uid, claims]); return 'ct'; } };
};
const okFetch = (seen) => async (url, init) => { seen.push([url, JSON.parse(init.body)]); return { ok: true, json: async () => ({ idToken: 'id-1', expiresIn: '3600' }) }; };

test('mints a real ID token for the verified admin email, then reuses it until near expiry', async () => {
  _resetOwnerSessionCache();
  const auth = fakeAuth(); const seen = [];
  const a = await ownerAuthorization({ email: 'o@x.com' }, { auth, fetch: okFetch(seen), apiKey: 'k', now: () => 0 });
  assert.equal(a, 'Bearer id-1');
  assert.deepEqual(seen[0][1], { token: 'ct', returnSecureToken: true });
  assert.ok(seen[0][0].includes('key=k'));
  await ownerAuthorization({ email: 'o@x.com' }, { auth, fetch: okFetch(seen), apiKey: 'k', now: () => 60_000 });
  assert.equal(seen.length, 1); // cached
  await ownerAuthorization({ email: 'o@x.com' }, { auth, fetch: okFetch(seen), apiKey: 'k', now: () => 3_400_000 });
  assert.equal(seen.length, 2); // inside the 5 min margin: re-minted
});

test('no api key, unknown user or a failed sign-in => null (the chat falls back to cards)', async () => {
  _resetOwnerSessionCache();
  assert.equal(await ownerAuthorization({ email: 'o@x.com' }, { apiKey: '', fetch: async () => ({}) }), null);
  const missing = { getUserByEmail: async () => { throw new Error('no user'); }, createCustomToken: async () => 'ct' };
  assert.equal(await ownerAuthorization({ email: 'o@x.com' }, { auth: missing, fetch: okFetch([]), apiKey: 'k' }), null);
  const bad = async () => ({ ok: false, json: async () => ({}) });
  assert.equal(await ownerAuthorization({ email: 'o@x.com' }, { auth: fakeAuth(), fetch: bad, apiKey: 'k' }), null);
  assert.equal(await ownerAuthorization({}, { auth: fakeAuth(), fetch: okFetch([]), apiKey: 'k' }), null);
});
