import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readClientReadiness, assertClientReady, resolveClientXHandle, requireClientXHandle } from '../index.js';

const require = createRequire(import.meta.url);
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');

const ID = 'fixture-client-a';
async function seed({ client = {}, brain = 'approved', plan = true, username = 'fixture_a', xGrowth, brainHandle } = {}) {
  const db = makeFakeContext().adminDb;
  if (client) await db.collection('clients').doc(ID).set(client);
  if (brain) await db.collection('clients').doc(ID).collection('client_brain').doc('current').set({ status: brain, ...(brainHandle ? { identity: { xHandle: brainHandle } } : {}) });
  if (plan) await db.collection('x_strategy_plans').doc(ID).set({ version: 1 });
  if (username !== false) await db.collection('social_accounts').doc(ID).set({ platforms: { x: { username } } });
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
