import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { recordWorkerSeen, readWorkerHealth, WORKER_COLLECTION } from '../refresh.js';
import { workerHealthLine } from '../ui-model.js';
import { createStrategyHandlers } from '../route-handlers.js';
import { createMemoryCorpusStore } from '../corpus-store.js';
import { createMemoryPlanStore } from '../plan-store.js';
import { createRefreshService, createMemoryRefreshQueue, createFirestoreRefreshQueue } from '../refresh.js';

const require = createRequire(import.meta.url);
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');

const NOW = Date.parse('2026-10-11T12:00:00.000Z');
const min = (m) => NOW - m * 60000;
// fake-firestore has no doc.create(); the test queue seeds with set() and keeps the real get/query paths.
const fakeQueue = (db) => ({ ...createFirestoreRefreshQueue(db), async create(d) { await db.collection('x_strategy_refresh_requests').doc(d.id).set(d); return d; } });
const iso = (ms) => new Date(ms).toISOString();

test('recordWorkerSeen writes then merges (idle poll keeps lastRequestId)', async () => {
  const db = makeFakeContext().adminDb;
  await recordWorkerSeen(db, { workerId: 'w1', now: min(10), requestId: 'r1' });
  await recordWorkerSeen(db, { workerId: 'w1', now: NOW });
  const d = (await db.collection(WORKER_COLLECTION).doc('w1').get()).data();
  assert.equal(d.lastSeenAt, iso(NOW));
  assert.equal(d.lastPollAt, iso(NOW));
  assert.equal(d.lastRequestId, 'r1');
  assert.ok(d.version);
  await assert.rejects(() => recordWorkerSeen(db, { workerId: '' }));
});

test('readWorkerHealth: never / recent / stale boundaries', async () => {
  const db = makeFakeContext().adminDb;
  assert.deepEqual(await readWorkerHealth(db, { now: NOW, clientId: 'c1' }), { lastSeenAt: null, ageMinutes: null, state: 'never', staleAfterMinutes: 15, oldestQueuedAgeMinutes: null });
  await recordWorkerSeen(db, { workerId: 'w1', now: min(15) });
  assert.equal((await readWorkerHealth(db, { now: NOW })).state, 'recent'); // exactly 15 min
  await recordWorkerSeen(db, { workerId: 'w1', now: min(16) });
  const h = await readWorkerHealth(db, { now: NOW });
  assert.equal(h.state, 'stale');
  assert.equal(h.ageMinutes, 16);
  await recordWorkerSeen(db, { workerId: 'w2', now: min(2) }); // freshest worker wins
  assert.deepEqual([(await readWorkerHealth(db, { now: NOW })).state, (await readWorkerHealth(db, { now: NOW })).ageMinutes], ['recent', 2]);
});

test('oldestQueuedAgeMinutes counts only THIS client, queued only', async () => {
  const db = makeFakeContext().adminDb;
  const q = fakeQueue(db);
  await q.create({ id: 'a', status: 'queued', clientId: 'c1', createdAt: iso(min(30)), handles: ['x'] });
  await q.create({ id: 'b', status: 'queued', clientId: 'c1', createdAt: iso(min(5)), handles: ['x'] });
  await q.create({ id: 'c', status: 'queued', clientId: 'c2', createdAt: iso(min(300)), handles: ['x'] });
  await q.create({ id: 'd', status: 'queued', createdAt: iso(min(400)), handles: ['x'] }); // legacy, no clientId
  await q.create({ id: 'e', status: 'done', clientId: 'c1', createdAt: iso(min(500)), handles: ['x'] });
  assert.equal((await readWorkerHealth(db, { now: NOW, clientId: 'c1' })).oldestQueuedAgeMinutes, 30);
  assert.equal((await readWorkerHealth(db, { now: NOW, clientId: 'c2' })).oldestQueuedAgeMinutes, 300);
  assert.equal((await readWorkerHealth(db, { now: NOW, clientId: 'c3' })).oldestQueuedAgeMinutes, null);
});

test('workerHealthLine wording', () => {
  const lines = [
    workerHealthLine({ state: 'recent', ageMinutes: 3 }),
    workerHealthLine({ state: 'recent', ageMinutes: 0 }),
    workerHealthLine({ state: 'stale', ageMinutes: 120 }),
    workerHealthLine({ state: 'stale', ageMinutes: 20 }),
    workerHealthLine({ state: 'never' }),
  ];
  assert.equal(lines[0], 'Worker last seen 3 min ago');
  assert.equal(lines[2], 'Worker not seen for 2 h — refresh requests will stay queued until it runs');
  assert.equal(lines[4], 'Worker has never reported in (not running, or an older worker without this signal)');
  for (const l of lines) assert.doesNotMatch(l, /online|offline/i);
  assert.equal(workerHealthLine(undefined), null);
  assert.equal(workerHealthLine({}), null);
});

test('handlers include workerHealth, client-scoped, and tag requests with clientId', async () => {
  const db = makeFakeContext().adminDb;
  const queueStore = fakeQueue(db);
  const corpusStore = createMemoryCorpusStore({ loadCommitted: () => null });
  const refreshService = createRefreshService({ store: corpusStore, queueStore, now: () => NOW, enabled: false, idGen: (() => { let n = 0; return () => `req-${++n}`; })() });
  await queueStore.create({ id: 'other', status: 'queued', clientId: 'c2', createdAt: iso(min(900)), handles: ['x'] });
  await recordWorkerSeen(db, { workerId: 'w1', now: min(3) });
  const h = createStrategyHandlers({
    corpusStore, planStore: createMemoryPlanStore(), refreshService, clock: () => NOW,
    readXGrowthConfig: async () => ({ ownHandle: 'me_acct', benchmarkHandles: [], timezone: 'America/Chicago' }),
    evaluate: async () => ({}),
    readWorkerHealth: (clientId) => readWorkerHealth(db, { now: NOW, clientId }),
  });
  const ctx = { clientId: 'c1' };
  const r = await h.handle('strategy-refresh', { clientId: 'c1' }, ctx, { decoded: { uid: 'u' } });
  assert.equal(r.ok, true);
  assert.equal((await queueStore.get(r.requestId)).clientId, 'c1');

  const s = await h.handle('strategy-refresh-status', { clientId: 'c1', requestId: r.requestId }, ctx);
  assert.equal(s.workerHealth.state, 'recent');
  assert.equal(s.workerHealth.ageMinutes, 3);
  assert.equal(s.workerHealth.oldestQueuedAgeMinutes, 0); // c1's own request only; c2's 900 min is ignored
  const only = await h.handle('strategy-refresh-status', { clientId: 'c1', workerOnly: true }, ctx);
  assert.equal(only.ok, true);
  assert.ok(only.workerHealth && !only.request);
  assert.equal((await h.handle('strategy-refresh-status', { clientId: 'c2' }, ctx)).status, 403);
  assert.equal((await h.handle('strategy-refresh-status', {}, ctx)).status, 400);

  const g = await h.handle('strategy-get', { clientId: 'c1' }, ctx);
  assert.equal(g.workerHealth.state, 'recent');
});
