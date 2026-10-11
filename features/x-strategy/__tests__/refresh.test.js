import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRefreshService, createMemoryRefreshQueue, createFirestoreRefreshQueue,
  normalizeRefreshHandles, STALE_RUNNING_MS,
} from '../refresh.js';
import { makePages } from './fixtures/timeline-fixture.js';

const NOW = Date.parse('2026-10-11T12:00:00.000Z');

/** Fake corpus store honoring the T1a interface. Keeps rows per handle so before/after are real. */
function fakeStore({ failFor } = {}) {
  const rows = new Map();
  const writes = [];
  return {
    writes, rows,
    async writeMergedRows(handle, incoming, meta) {
      if (failFor === handle) throw new Error('disk full');
      const cur = rows.get(handle) || [];
      const ids = new Set(cur.map((r) => r.id));
      const added = incoming.filter((r) => !ids.has(r.id)).length;
      const next = [...cur, ...incoming.filter((r) => !ids.has(r.id))];
      rows.set(handle, next);
      writes.push({ handle, n: incoming.length, meta });
      return { before: cur.length, after: next.length, added, updated: incoming.length - added, viewsBefore: 0, viewsAfter: 0 };
    },
  };
}

/** runBird factory: behavior per handle. behaviors[handle] = {failOn:'first'|'c2'..., stderr} ; records calls by handle. */
function fakeBirdFactory(behaviors = {}) {
  const calls = [];
  const pages = makePages();
  const runBird = (args) => {
    const handle = args[1].replace(/^@/, '');
    calls.push(handle);
    const b = behaviors[handle];
    const ci = args.indexOf('--cursor');
    const cursor = ci === -1 ? null : args[ci + 1];
    if (b && b.failOn === (cursor || 'first')) throw Object.assign(new Error('Command failed'), { stderr: b.stderr });
    return JSON.stringify(pages[cursor ? Number(cursor.slice(1)) : 0]);
  };
  return { runBirdFor: () => runBird, calls };
}

function build({ behaviors, enabled = true, detect = { available: true }, store = fakeStore(), queueStore = createMemoryRefreshQueue(), nowFn = () => NOW } = {}) {
  const bird = fakeBirdFactory(behaviors);
  let n = 0;
  const svc = createRefreshService({
    store, queueStore, now: nowFn, enabled,
    detectBird: async () => detect,
    runBirdFor: bird.runBirdFor,
    idGen: () => `req${++n}`,
    ingestOptionsFor: () => ({ days: 365 }),
  });
  return { svc, store, queueStore, bird };
}

// ---- validation ----

test('more than 6 distinct handles rejected (400)', async () => {
  const { svc, queueStore } = build();
  const handles = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  await assert.rejects(() => svc.requestRefresh({ handles }), (e) => e.status === 400 && e.code === 'TOO_MANY_HANDLES');
  assert.equal(await queueStore.get('req1'), null); // nothing written
});

test('bad handle / empty list rejected', async () => {
  const { svc } = build();
  for (const bad of [['has space'], ['toolonghandle_over15'], ['a-b'], [''], ['@'], [42, null]]) {
    await assert.rejects(() => svc.requestRefresh({ handles: bad }), (e) => e.status === 400, JSON.stringify(bad));
  }
  await assert.rejects(() => svc.requestRefresh({ handles: [] }), { code: 'NO_HANDLES' });
  await assert.rejects(() => svc.requestRefresh({ handles: 'a' }), { code: 'NO_HANDLES' });
});

test('normalize strips @, lowercases, dedupes, keeps order; 7 inputs that dedupe to 6 are accepted', () => {
  assert.deepEqual(normalizeRefreshHandles(['@Seb__Design', 'seb__design', ' bai_ee ', 'BAI_EE']), ['seb__design', 'bai_ee']);
  assert.equal(normalizeRefreshHandles(['a', 'b', 'c', 'd', 'e', 'f', 'F']).length, 6);
});

// ---- queueing / gating ----

test('env flag off: request is queued only, bird never invoked', async () => {
  const { svc, bird } = build({ enabled: false });
  const out = await svc.requestRefresh({ handles: ['alice'], requestedBy: 'admin' });
  assert.deepEqual({ ...out }, { requestId: 'req1', status: 'queued' });
  assert.equal(out.drain, undefined);
  const doc = await svc.getRequestStatus('req1');
  assert.deepEqual(doc, { id: 'req1', handles: ['alice'], status: 'queued', requestedBy: 'admin', createdAt: '2026-10-11T12:00:00.000Z', results: {} });
  assert.equal(bird.calls.length, 0);
});

test('bird not detected: stays queued, no drain', async () => {
  const { svc, bird } = build({ detect: { available: false } });
  const out = await svc.requestRefresh({ handles: ['alice'] });
  assert.equal(out.drain, undefined);
  assert.equal((await svc.getRequestStatus('req1')).status, 'queued');
  assert.equal(bird.calls.length, 0);
});

test('enabled + detected: JSON result is only {requestId,status}; drain promise completes the request', async () => {
  const { svc, store } = build();
  const out = await svc.requestRefresh({ handles: ['alice', 'bob'] });
  assert.equal(JSON.stringify(out), '{"requestId":"req1","status":"queued"}');
  await out.drain;
  const doc = await svc.getRequestStatus('req1');
  assert.equal(doc.status, 'done');
  assert.deepEqual(Object.keys(doc.results), ['alice', 'bob']);
  assert.equal(doc.results.alice.rowCount, 36);
  assert.equal(doc.results.alice.added, 36);
  assert.equal(store.writes[0].meta.source, 'bird');
  assert.ok(doc.startedAt && doc.finishedAt);
});

// ---- typed failures ----

test('429 on 2nd of 3: first done, second rate-limited, third skipped, no further bird calls', async () => {
  const { svc, bird, store } = build({ behaviors: { bob: { failOn: 'first', stderr: 'HTTP 429 Too Many Requests' } } });
  const out = await svc.requestRefresh({ handles: ['alice', 'bob', 'carol'] });
  await out.drain;
  const doc = await svc.getRequestStatus('req1');
  assert.equal(doc.status, 'rate-limited');
  assert.equal(doc.results.alice.status, 'done');
  assert.equal(doc.results.bob.status, 'failed');
  assert.equal(doc.results.bob.errorKind, 'rate-limited');
  assert.deepEqual(doc.results.carol, { status: 'skipped' });
  assert.equal(bird.calls.includes('carol'), false);
  assert.equal(bird.calls.filter((h) => h === 'bob').length, 1);
  assert.equal(store.writes.length, 1); // only alice written
});

test('partial results kept on mid-pull 429: rows merged, handle partial, request rate-limited', async () => {
  const { svc, store } = build({ behaviors: { alice: { failOn: 'c2', stderr: '429' } } });
  const out = await svc.requestRefresh({ handles: ['alice', 'bob'] });
  await out.drain;
  const doc = await svc.getRequestStatus('req1');
  assert.equal(store.rows.get('alice').length, 24);
  assert.equal(doc.results.alice.status, 'partial');
  assert.equal(doc.results.alice.rowCount, 24);
  assert.equal(doc.results.alice.errorKind, 'rate-limited');
  assert.equal(doc.status, 'rate-limited');
  assert.equal(doc.results.bob.status, 'skipped');
});

test('EPERM -> bird-unavailable, remaining skipped', async () => {
  const { svc, bird } = build({ behaviors: { alice: { failOn: 'first', stderr: 'EPERM: operation not permitted' } } });
  const out = await svc.requestRefresh({ handles: ['alice', 'bob'] });
  await out.drain;
  const doc = await svc.getRequestStatus('req1');
  assert.equal(doc.status, 'bird-unavailable');
  assert.equal(doc.results.alice.errorKind, 'cookie-access');
  assert.equal(doc.results.bob.status, 'skipped');
  assert.equal(bird.calls.includes('bob'), false);
});

test('non-typed failure on one handle does not stop the others; request is partial', async () => {
  const { svc } = build({ behaviors: { alice: { failOn: 'first', stderr: 'weird failure' } } });
  const out = await svc.requestRefresh({ handles: ['alice', 'bob'] });
  await out.drain;
  const doc = await svc.getRequestStatus('req1');
  assert.equal(doc.results.alice.status, 'failed');
  assert.equal(doc.results.bob.status, 'done');
  assert.equal(doc.status, 'partial');
});

test('store write failure is recorded per handle, never thrown', async () => {
  const { svc } = build({ store: fakeStore({ failFor: 'alice' }) });
  const out = await svc.requestRefresh({ handles: ['alice'] });
  await out.drain;
  const doc = await svc.getRequestStatus('req1');
  assert.equal(doc.status, 'failed');
  assert.match(doc.results.alice.error, /store write failed: disk full/);
});

// ---- lease ----

test('lease: two concurrent drains do not double-process', async () => {
  const { svc, bird } = build({ enabled: false });
  await svc.requestRefresh({ handles: ['alice'] });
  const [a, b] = await Promise.all([svc.drainRequest('req1'), svc.drainRequest('req1')]);
  assert.deepEqual([a.claimed, b.claimed].sort(), [false, true]);
  assert.equal(bird.calls.filter((h) => h === 'alice').length, 3); // one pull = 3 pages, once
});

test('idempotent: re-draining a finished request does nothing', async () => {
  const { svc, bird } = build({ enabled: false });
  await svc.requestRefresh({ handles: ['alice'] });
  await svc.drainRequest('req1');
  const before = bird.calls.length;
  const again = await svc.drainRequest('req1');
  assert.equal(again.claimed, false);
  assert.equal(again.request.status, 'done');
  assert.equal(bird.calls.length, before);
  assert.equal((await svc.drainRequest('missing')).request, null);
});

test('stale running (>30 min) is reclaimed and resumes; fresh running is left alone', async () => {
  const queueStore = createMemoryRefreshQueue();
  let t = NOW;
  const { svc, bird, store } = build({ queueStore, enabled: false, nowFn: () => t });
  const base = (id, startedAt) => ({ id, handles: ['alice', 'bob'], status: 'running', startedAt, requestedBy: null, createdAt: '2026-10-11T11:00:00.000Z', results: { alice: { status: 'done', rowCount: 5 } } });
  await queueStore.create(base('stale', new Date(NOW - STALE_RUNNING_MS - 1000).toISOString()));
  await queueStore.create(base('fresh', new Date(NOW - 60_000).toISOString()));
  const res = await svc.drainQueue();
  assert.deepEqual(res.requests, [{ id: 'stale', status: 'done' }]);
  assert.equal((await queueStore.get('fresh')).status, 'running');
  assert.equal(bird.calls.includes('alice'), false); // resumed: only bob pulled
  assert.ok(bird.calls.includes('bob'));
  assert.equal((await queueStore.get('stale')).results.alice.rowCount, 5);
  assert.equal(store.writes.length, 1);
});

test('drainQueue: oldest first, max respected; bird undetected -> nothing claimed', async () => {
  const { svc, queueStore } = build({ enabled: false });
  await queueStore.create({ id: 'late', handles: ['a'], status: 'queued', createdAt: '2026-10-11T11:30:00.000Z', results: {} });
  await queueStore.create({ id: 'early', handles: ['b'], status: 'queued', createdAt: '2026-10-11T10:00:00.000Z', results: {} });
  const res = await svc.drainQueue({ max: 1 });
  assert.deepEqual(res.requests.map((r) => r.id), ['early']);
  assert.equal((await queueStore.get('late')).status, 'queued');

  const off = build({ enabled: false, detect: { available: false } });
  await off.queueStore.create({ id: 'q', handles: ['a'], status: 'queued', createdAt: '2026-10-11T10:00:00.000Z', results: {} });
  assert.deepEqual(await off.svc.drainQueue(), { processed: 0, reason: 'bird-unavailable', requests: [] });
  assert.equal((await off.queueStore.get('q')).status, 'queued');
  assert.equal(off.bird.calls.length, 0);
});

// ---- Firestore queue implements the same contract (fake db) ----

function fakeDb() {
  const data = new Map();
  const snap = (id) => ({ exists: data.has(id), id, data: () => structuredClone(data.get(id)) });
  const docRef = (id) => ({
    id,
    get: async () => snap(id),
    create: async (d) => { if (data.has(id)) throw new Error('ALREADY_EXISTS'); data.set(id, structuredClone(d)); },
  });
  return {
    data,
    collection: (name) => {
      assert.equal(name, 'x_strategy_refresh_requests');
      return {
        doc: docRef,
        where: (f, op, v) => {
          assert.equal(f, 'status'); assert.equal(op, '==');
          return { limit: () => ({ get: async () => ({ docs: [...data.keys()].filter((k) => data.get(k).status === v).map(snap) }) }) };
        },
      };
    },
    runTransaction: async (fn) => fn({
      get: async (ref) => snap(ref.id),
      update: (ref, patch) => data.set(ref.id, { ...data.get(ref.id), ...structuredClone(patch) }),
    }),
  };
}

test('Firestore queue: same behavior through the service (create/claim/list/lease)', async () => {
  const db = fakeDb();
  const queueStore = createFirestoreRefreshQueue(db);
  const { svc } = build({ queueStore, enabled: false });
  await svc.requestRefresh({ handles: ['alice', 'bob'] });
  assert.equal(db.data.get('req1').status, 'queued');
  assert.equal((await queueStore.listQueued({ now: NOW })).length, 1);
  const [a, b] = await Promise.all([svc.drainRequest('req1'), svc.drainRequest('req1')]);
  assert.deepEqual([a.claimed, b.claimed].sort(), [false, true]);
  assert.equal(db.data.get('req1').status, 'done');
  assert.equal((await queueStore.listQueued({ now: NOW })).length, 0);
  assert.equal(await queueStore.update('nope', { status: 'x' }), null);
  await assert.rejects(() => queueStore.create({ id: 'req1' }));
});

// ---- lease fencing / heartbeat / revalidation ----

const MIN = 60_000;

test('zombie worker is fenced: after reclaim its writes are rejected, no more bird calls, new owner results survive', async () => {
  const queueStore = createMemoryRefreshQueue();
  let t = NOW;
  const calls = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const pages = makePages();
  // Worker A blocks inside alice's pull; the clock then advances past staleness and worker B reclaims.
  const mk = (blockAlice) => ({
    runBirdFor: () => async (args) => {
      const handle = args[1].replace(/^@/, '');
      calls.push(handle);
      if (blockAlice && handle === 'alice') await gate;
      const ci = args.indexOf('--cursor');
      return JSON.stringify(pages[ci === -1 ? 0 : Number(args[ci + 1].slice(1))]);
    },
  });
  const common = { store: fakeStore(), queueStore, now: () => t, enabled: false, detectBird: async () => ({ available: true }), ingestOptionsFor: () => ({ days: 365 }) };
  const a = createRefreshService({ ...common, ...mk(true), idGen: () => 'req1' });
  const b = createRefreshService({ ...common, ...mk(false), idGen: () => 'req1' });
  await a.requestRefresh({ handles: ['alice', 'bob'] });
  const pA = a.drainRequest('req1');
  await new Promise((r) => setImmediate(r));
  t += STALE_RUNNING_MS + 1000;
  const rB = await b.drainRequest('req1');
  assert.equal(rB.claimed, true);
  assert.equal(rB.request.status, 'done');
  const callsBeforeRelease = calls.length;
  release();
  const rA = await pA;
  assert.equal(rA.lost, true);
  const doc = await queueStore.get('req1');
  assert.equal(doc.status, 'done');
  assert.equal(doc.leaseId, rB.request.leaseId);
  assert.equal(doc.finishedAt, rB.request.finishedAt);
  assert.equal(calls.slice(callsBeforeRelease).includes('bob'), false); // A never started 'bob'
});

test('heartbeat keeps a long job unreclaimable (leaseAt, not startedAt, drives staleness)', async () => {
  const queueStore = createMemoryRefreshQueue();
  let t = NOW;
  const { svc } = build({ queueStore, enabled: false, nowFn: () => t });
  await queueStore.create({ id: 'long', handles: ['a'], status: 'queued', createdAt: '2026-10-11T11:00:00.000Z', results: {} });
  await queueStore.update('long', { status: 'running', leaseId: 'L', startedAt: new Date(NOW - 45 * MIN).toISOString(), leaseAt: new Date(NOW - MIN).toISOString() });
  assert.equal((await svc.drainRequest('long')).claimed, false);
  assert.deepEqual(await queueStore.listQueued({ now: t }), []);
  t += 31 * MIN; // heartbeat lapses -> reclaimable
  assert.equal((await queueStore.listQueued({ now: t })).length, 1);
});

test('drain heartbeat advances leaseAt and records leaseId', async () => {
  let t = NOW;
  const { svc } = build({ enabled: false, nowFn: () => (t += 1000) });
  await svc.requestRefresh({ handles: ['alice', 'bob'] });
  const r = await svc.drainRequest('req1');
  assert.ok(Date.parse(r.request.leaseAt) > Date.parse(r.request.startedAt));
  assert.ok(r.request.leaseId);
});

test('legacy running doc without leaseAt is still reclaimable by startedAt', async () => {
  const queueStore = createMemoryRefreshQueue();
  const { svc } = build({ queueStore, enabled: false });
  await queueStore.create({ id: 'old', handles: ['alice'], status: 'running', startedAt: new Date(NOW - STALE_RUNNING_MS - 1000).toISOString(), createdAt: '2026-10-11T11:00:00.000Z', results: {} });
  await queueStore.create({ id: 'young', handles: ['alice'], status: 'running', startedAt: new Date(NOW - MIN).toISOString(), createdAt: '2026-10-11T11:00:00.000Z', results: {} });
  const res = await svc.drainQueue();
  assert.deepEqual(res.requests, [{ id: 'old', status: 'done' }]);
  assert.equal((await queueStore.get('young')).status, 'running');
});

test('tampered queue doc handles are re-validated: marked failed, bird never called', async () => {
  for (const bad of [['--help'], ['a b'], ['ok', '-x']]) {
    const { svc, queueStore, bird } = build({ enabled: false });
    await queueStore.create({ id: 't', handles: bad, status: 'queued', createdAt: '2026-10-11T11:00:00.000Z', results: {} });
    const r = await svc.drainRequest('t');
    assert.equal(r.request.status, 'failed', JSON.stringify(bad));
    assert.match(r.request.error, /invalid handles/);
    assert.equal(bird.calls.length, 0);
  }
});

test('bird timeout: typed kind, partial rows kept, other handles continue', async () => {
  const pages = makePages();
  const timeoutErr = () => Object.assign(new Error('bird timed out after 90000ms'), { code: 'ETIMEDOUT', killed: true });
  const runBird = (args) => {
    const handle = args[1].replace(/^@/, '');
    const ci = args.indexOf('--cursor');
    const cursor = ci === -1 ? null : args[ci + 1];
    if (handle === 'alice' && cursor === 'c2') throw timeoutErr();
    if (handle === 'bob') throw timeoutErr();
    return JSON.stringify(pages[cursor ? Number(cursor.slice(1)) : 0]);
  };
  const store = fakeStore();
  const queueStore = createMemoryRefreshQueue();
  const svc = createRefreshService({ store, queueStore, now: () => NOW, enabled: false, detectBird: async () => ({ available: true }), runBirdFor: () => runBird, idGen: () => 'req1', ingestOptionsFor: () => ({ days: 365 }) });
  await svc.requestRefresh({ handles: ['alice', 'bob', 'carol'] });
  const r = await svc.drainRequest('req1');
  assert.equal(r.request.results.alice.status, 'partial');
  assert.equal(r.request.results.alice.errorKind, 'timeout');
  assert.equal(store.rows.get('alice').length, 24);
  assert.equal(r.request.results.bob.status, 'failed');
  assert.equal(r.request.results.bob.errorKind, 'timeout');
  assert.equal(r.request.results.carol.status, 'done');
  assert.equal(r.request.status, 'partial');
});
