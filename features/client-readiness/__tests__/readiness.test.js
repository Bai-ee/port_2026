import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { __setReadinessDepsForTest, connectedAccountUserId, readClientReadiness, assertClientReady, resolveClientXHandle, requireClientXHandle } from '../index.js';

const require = createRequire(import.meta.url);
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');

// Never hit real Firestore/env for the lazy owner/home lookups.
__setReadinessDepsForTest({ lookupOwnerUserId: async () => '18508964', lookupIsHome: async () => false });
const ID = 'fixture-client-a';
async function seed({ client = {}, brain = 'approved', plan = true, username = 'fixture_a', xGrowth, brainHandle } = {}) {
  const db = makeFakeContext().adminDb;
  if (client) await db.collection('clients').doc(ID).set(client);
  if (brain) await db.collection('clients').doc(ID).collection('client_brain').doc('current').set({ status: brain, ...(brainHandle ? { identity: { xHandle: brainHandle } } : {}) });
  if (plan) await db.collection('x_strategy_plans').doc(ID).set({ version: 1 });
  if (username !== false) await db.collection('social_accounts').doc(ID).set({ platforms: { x: { username, oauth1: { appKey: 'k' } } } });
  if (xGrowth) await db.collection('client_configs').doc(ID).set({ marketingBriefConfig: { xGrowth } });
  return db;
}
const denied = (code) => (e) => e.status === 403 && e.code === code;

test('ready: approved Brain + plan doc + connected X', async () => {
  const r = await assertClientReady(await seed(), ID);
  assert.equal(r.ready, true);
  assert.deepEqual(r.missing, []);
});

test('each missing input is denied with the code naming it', async () => {
  await assert.rejects(assertClientReady(await seed({ brain: 'stale' }), ID), denied('client-brain-not-approved'));
  await assert.rejects(assertClientReady(await seed({ brain: null }), ID), denied('client-brain-not-approved'));
  await assert.rejects(assertClientReady(await seed({ plan: false }), ID), denied('client-plan-missing'));
  await assert.rejects(assertClientReady(await seed({ username: null }), ID), denied('client-x-not-connected'));
  await assert.rejects(assertClientReady(await seed({ username: false }), ID), denied('client-x-not-connected'));
  await assert.rejects(assertClientReady(await seed({ client: null }), ID), denied('client-not-found'));
  await assert.rejects(assertClientReady(await seed(), ''), (e) => e.status === 400 && e.code === 'client-id-required');
});

test('all missing inputs are listed; contentLoop.enabled is the explicit owner override', async () => {
  const db = await seed({ brain: 'draft', plan: false, username: false });
  await assert.rejects(assertClientReady(db, ID), (e) => e.missing.join() === 'client-brain-not-approved,client-plan-missing,client-x-not-connected');
  const r = await assertClientReady(await seed({ client: { contentLoop: { enabled: true } }, brain: 'stale', plan: false, username: false }), ID);
  assert.equal(r.override, true);
  // A truthy non-boolean is not the override.
  await assert.rejects(assertClientReady(await seed({ client: { contentLoop: { enabled: 'yes' } }, plan: false }), ID), denied('client-plan-missing'));
});

test('readiness never falls back to another client', async () => {
  const db = await seed();
  await assert.rejects(assertClientReady(db, 'fixture-client-b'), denied('client-not-found'));
  assert.equal((await readClientReadiness(db, 'fixture-client-b')).ready, false);
});

test('X handle: social account → saved xGrowth profile → Brain identity → none (never a default)', async () => {
  assert.deepEqual(await resolveClientXHandle(await seed({ username: '@fixture_a' }), ID), { handle: 'fixture_a', source: 'social-account' });
  assert.deepEqual(await resolveClientXHandle(await seed({ username: false, xGrowth: { ownHandle: '@prof' } }), ID), { handle: 'prof', source: 'xgrowth-profile' });
  assert.deepEqual(await resolveClientXHandle(await seed({ username: false }), ID, { xGrowth: { ownHandle: 'given' } }), { handle: 'given', source: 'xgrowth-profile' });
  assert.deepEqual(await resolveClientXHandle(await seed({ username: false, brainHandle: 'brainy' }), ID), { handle: 'brainy', source: 'client-brain' });
  const none = await seed({ username: false });
  assert.deepEqual(await resolveClientXHandle(none, ID), { handle: null, source: null });
  await assert.rejects(requireClientXHandle(none, ID), (e) => e.status === 409 && e.code === 'client-x-handle-missing');
});

test('home-shaped client (stale Brain, social doc without username, override + saved profile handle) passes and resolves its own handle', async () => {
  const db = await seed({ client: { contentLoop: { enabled: true } }, brain: 'stale', username: null, xGrowth: { ownHandle: 'home_handle' } });
  assert.equal((await assertClientReady(db, ID)).ready, true);
  assert.deepEqual(await resolveClientXHandle(db, ID), { handle: 'home_handle', source: 'xgrowth-profile' });
  // Without the override the same client is denied, naming the first missing input.
  const off = await seed({ brain: 'stale', username: null, xGrowth: { ownHandle: 'home_handle' } });
  await assert.rejects(assertClientReady(off, ID), denied('client-brain-not-approved'));
});

test('a strategy-only client (no X connected) is ready with the handle saved in the Strategy X profile', async () => {
  const r = await assertClientReady(await seed({ username: false, xGrowth: { ownHandle: '@crittersquest' } }), ID);
  assert.deepEqual([r.ready, r.xHandle, r.xSource], [true, 'crittersquest', 'xgrowth-profile']);
  // A connected account that is NOT the brand handle no longer decides identity: the brand handle wins.
  const c = await readClientReadiness(await seed({ xGrowth: { ownHandle: 'other' } }), ID, { ownerUserId: '1', isHome: false });
  assert.deepEqual([c.xHandle, c.xSource], ['other', 'xgrowth-profile']);
  // Neither: still denied, and the fix names both ways.
  await assert.rejects(assertClientReady(await seed({ username: false, xGrowth: { ownHandle: '' } }), ID), (e) => e.code === 'client-x-not-connected' && /Strategy > X profile/.test(e.message));
});

// --- identity rule (owner 2026-11-18): the client's own handle; the owner's connected @bai_ee never counts ----
const OWNER = '18508964';
async function seedX({ x, xGrowth, brainHandle } = {}) {
  const db = await seed({ username: false, xGrowth, brainHandle });
  if (x) await db.collection('social_accounts').doc(ID).set({ platforms: { x } });
  return db;
}
const O = { ownerUserId: OWNER, isHome: false };

test('identity: CQ-like (connected @bai_ee owner id, brand crittersquest) resolves the brand handle, not the owner', async () => {
  const db = await seedX({ x: { username: 'bai_ee', userId: OWNER }, xGrowth: { ownHandle: '@crittersquest' } });
  assert.deepEqual(await resolveClientXHandle(db, ID, O), { handle: 'crittersquest', source: 'xgrowth-profile' });
  const r = await readClientReadiness(db, ID, O);
  assert.deepEqual([r.xHandle, r.xSource], ['crittersquest', 'xgrowth-profile']);
  const viaBrain = await seedX({ x: { username: 'bai_ee', userId: OWNER }, brainHandle: 'crittersquest' });
  assert.deepEqual(await resolveClientXHandle(viaBrain, ID, O), { handle: 'crittersquest', source: 'client-brain' });
});

test('identity: connected account equal to the brand handle (case-insensitive) counts', async () => {
  const db = await seedX({ x: { username: 'CrittersQuest', userId: '555' }, xGrowth: { ownHandle: 'crittersquest' } });
  assert.equal((await resolveClientXHandle(db, ID, O)).handle, 'crittersquest');
});

test('identity: no brand handle + connected account that is not the owner -> the connected account', async () => {
  const db = await seedX({ x: { username: 'client_own', userId: '555' } });
  assert.deepEqual(await resolveClientXHandle(db, ID, O), { handle: 'client_own', source: 'social-account' });
  const r = await readClientReadiness(db, ID, O);
  assert.deepEqual([r.xHandle, r.xSource, r.missing.some((m) => m.input === 'x-account')], ['client_own', 'social-account', false]);
});

test('identity: no brand handle + connected account IS the owner -> 409 client-x-handle-missing, readiness x-account missing', async () => {
  const db = await seedX({ x: { username: 'bai_ee', userId: OWNER } });
  assert.deepEqual(await resolveClientXHandle(db, ID, O), { handle: null, source: null });
  await assert.rejects(requireClientXHandle(db, ID, O), (e) => e.status === 409 && e.code === 'client-x-handle-missing');
  const r = await readClientReadiness(db, ID, O);
  assert.deepEqual([r.xHandle, r.xSource, r.missing.some((m) => m.input === 'x-account')], [null, null, true]);
});

test('identity: the home client keeps the owner account as its own', async () => {
  const db = await seedX({ x: { username: 'bai_ee', userId: OWNER } });
  assert.deepEqual(await resolveClientXHandle(db, ID, { ownerUserId: OWNER, isHome: true }), { handle: 'bai_ee', source: 'social-account' });
  assert.equal((await readClientReadiness(db, ID, { ownerUserId: OWNER, isHome: true })).xHandle, 'bai_ee');
});

test('identity: a connected account that differs from the brand handle is ignored', async () => {
  const db = await seedX({ x: { username: 'someone_else', userId: '555' }, xGrowth: { ownHandle: 'crittersquest' } });
  assert.equal((await resolveClientXHandle(db, ID, O)).handle, 'crittersquest');
});

test('connectedAccountCounts: a userId-less connection counts only as the client\'s own oauth1 dev app; unknown owner fails closed', async () => {
  const { connectedAccountCounts } = await import('../index.js');
  assert.equal(connectedAccountCounts({ username: 'bai_ee', accessToken: 't' }, { ownerUserId: '18508964' }), false);
  assert.equal(connectedAccountCounts({ username: 'ue', oauth1: { appKey: 'k' } }, { ownerUserId: '18508964' }), true);
  assert.equal(connectedAccountCounts({ username: 'bai_ee', userId: '18508964' }, { ownerUserId: '18508964' }), false);
  assert.equal(connectedAccountCounts({ username: 'other', userId: '42' }, { ownerUserId: null }), false);
  assert.equal(connectedAccountCounts({ username: 'other', userId: '42' }, { ownerUserId: '18508964' }), true);
  assert.equal(connectedAccountCounts({ username: 'bai_ee', userId: '18508964' }, { brandHandle: 'crittersquest', ownerUserId: '18508964' }), false);
});

test('connectedAccountCounts: oauth1 accessToken prefix is parsed as the userId (owner compare applies)', async () => {
  const { connectedAccountCounts } = await import('../index.js');
  const o = { ownerUserId: '18508964' };
  assert.equal(connectedAccountUserId({ oauth1: { accessToken: '18508964-abc' } }), '18508964');
  assert.equal(connectedAccountCounts({ username: 'bai_ee', oauth1: { accessToken: '18508964-abc' } }, o), false);
  assert.equal(connectedAccountCounts({ username: 'ue', oauth1: { accessToken: '42-abc' } }, o), true);
  assert.equal(connectedAccountCounts({ username: 'ue', oauth1: { accessToken: '42-abc' } }, { ownerUserId: null }), false);
  assert.equal(connectedAccountCounts({ username: 'ue', oauth1: { accessToken: 'opaque' } }, o), true);
});

test('pickIdentity skips the owner lookup when the account has no id to compare; readiness no longer returns xUsername', async () => {
  let lookups = 0;
  __setReadinessDepsForTest({ lookupOwnerUserId: async () => { lookups += 1; return '18508964'; }, lookupIsHome: async () => false });
  try {
    const r = await readClientReadiness(await seed({ xGrowth: undefined }), ID);
    assert.equal(r.xHandle, 'fixture_a');
    assert.equal('xUsername' in r, false);
    assert.equal(lookups, 0);
  } finally {
    __setReadinessDepsForTest({ lookupOwnerUserId: async () => '18508964', lookupIsHome: async () => false });
  }
});
