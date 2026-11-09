import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeLifeStatus, STATUS_SCHEMA } from '../schema.js';
import { handleStatusWrite, handleStatusRead } from '../http.js';
import { writeStatus, readStatus } from '../store.js';

const good = () => ({
  schema: STATUS_SCHEMA, updatedAt: '2026-11-09T12:00:00Z', evil: 1,
  run: { enabled: 'on', state: 'running', startedAt: '2026-11-09T11:12:00Z', batch: '2020', step: 'download', stepStartedAt: null, stoppedAt: null, error: null, extra: 'x' },
  progress: { batchesDone: 1, batchesTotal: 7, batchesRemaining: ['2021', 'a/b'], assets: 10.4, pushed: 5, itemsPerMin: 3.5, etaFinishAt: 'nope' },
  machine: { power: 'AC', batteryPct: 80, diskFreeGb: 100, nasMounted: true, controlServerUp: false },
  recent: [{ at: '2026-11-09T11:12:00Z', msg: 'start 2020' }, { at: null, msg: '/Volumes/bryan/x' }],
});

test('sanitize: shape, unknown dropped, slashes dropped, caps', () => {
  const { ok, status } = sanitizeLifeStatus(good());
  assert.ok(ok);
  assert.equal(status.evil, undefined);
  assert.equal(status.run.extra, undefined);
  assert.deepEqual(status.progress.batchesRemaining, ['2021']);
  assert.equal(status.progress.assets, 10);
  assert.equal(status.progress.etaFinishAt, null);
  assert.equal(status.progress.unpushed, null);
  assert.equal(status.recent.length, 1);
  const big = good();
  big.run.error = 'e'.repeat(500);
  big.recent = Array.from({ length: 50 }, (_, i) => ({ at: null, msg: `m${i}` }));
  const s2 = sanitizeLifeStatus(big).status;
  assert.equal(s2.run.error.length, 200);
  assert.equal(s2.recent.length, 20);
  assert.ok(!JSON.stringify({ ...s2, schema: '' }).includes('/'));
});
test('sanitize: rejects bad input', () => {
  assert.equal(sanitizeLifeStatus(null).ok, false);
  assert.equal(sanitizeLifeStatus({ ...good(), schema: 'x' }).reason, 'bad-schema');
  assert.equal(sanitizeLifeStatus({ ...good(), updatedAt: 'soon' }).reason, 'bad-updatedAt');
});

const post = (body, tok) => ({ headers: new Headers(tok ? { authorization: `Bearer ${tok}` } : {}), json: async () => body });
const workerAuthStatus = (r) => (r.headers.get('authorization') === 'Bearer w' ? 200 : 401);
test('status write route: auth, validation, write', async () => {
  let saved = null;
  const deps = { workerAuthStatus, now: () => Date.UTC(2026, 10, 9), writeStatus: async (s, _db, at) => { saved = { s, at }; } };
  assert.equal((await handleStatusWrite(post(good()), deps)).status, 401);
  assert.equal((await handleStatusWrite(post({}, 'w'), deps)).status, 400);
  const r = await handleStatusWrite(post(good(), 'w'), deps);
  assert.equal(r.status, 200);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(saved.at, '2026-11-09T00:00:00.000Z');
  assert.equal(saved.s.evil, undefined);
});
test('status read route: public, null when missing', async () => {
  const none = await handleStatusRead({}, { readStatus: async () => null });
  assert.deepEqual(none.body, { status: null });
  assert.equal(none.headers['cache-control'], 'no-store');
  const some = await handleStatusRead({}, { readStatus: async () => ({ schema: STATUS_SCHEMA }) });
  assert.equal(some.body.status.schema, STATUS_SCHEMA);
  assert.equal((await handleStatusRead({}, { readStatus: async () => { throw new Error('boom'); } })).status, 500);
});
test('store: current doc with receivedAt', async () => {
  const data = {};
  const db = { collection: (c) => ({ doc: (id) => ({
    set: async (v) => { data[`${c}/${id}`] = v; },
    get: async () => ({ exists: !!data[`${c}/${id}`], data: () => data[`${c}/${id}`] }),
  }) }) };
  assert.equal(await readStatus(db), null);
  await writeStatus({ a: 1 }, db, 'T');
  assert.deepEqual(await readStatus(db), { a: 1, receivedAt: 'T' });
});
