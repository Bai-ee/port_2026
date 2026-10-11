import test from 'node:test';
import assert from 'node:assert/strict';
import { checkBindingAccess } from '../access.js';

const env = { PILOT_OWNER_UIDS: 'u1', PILOT_CLIENT_IDS: 'c1', NODE_ENV: 'test' };
const binding = (over = {}) => ({ status: 'active', uid: 'u1', clientId: 'c1', telegramUserId: '111', ...over });

test('active pilot owner binding passes', () => {
  assert.deepEqual(checkBindingAccess(binding(), env), { ok: true, uid: 'u1', clientId: 'c1' });
});

test('missing, revoked and incomplete bindings are denied with a reason', () => {
  assert.equal(checkBindingAccess(null, env).ok, false);
  assert.equal(checkBindingAccess(null, env).reason, 'unbound');
  assert.equal(checkBindingAccess(binding({ status: 'revoked' }), env).reason, 'revoked');
  assert.equal(checkBindingAccess(binding({ uid: '' }), env).ok, false);
});

test('non-pilot uid and non-pilot client are denied by the shared pilot gate', () => {
  assert.equal(checkBindingAccess(binding({ uid: 'stranger' }), env).reason, 'pilot-not-owner');
  assert.equal(checkBindingAccess(binding({ clientId: 'other' }), env).reason, 'pilot-wrong-client');
});

test('production with no pilot allowlist fails closed', () => {
  const r = checkBindingAccess(binding(), { VERCEL_ENV: 'production' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'pilot-not-configured');
});

test('access is evaluated per call against the env it is given (no caching)', () => {
  assert.equal(checkBindingAccess(binding(), env).ok, true);
  assert.equal(checkBindingAccess(binding(), { ...env, PILOT_OWNER_UIDS: 'someone-else' }).ok, false);
});
