import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createFirestoreQuoteScanQueue, SCAN_STATUS, SCAN_STALE_RUNNING_MS } from '../scan-queue.js';

const require = createRequire(import.meta.url);
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');

function setup(start = Date.parse('2026-10-18T19:00:00Z')) {
  const { adminDb } = makeFakeContext();
  let t = start;
  let n = 0;
  const q = createFirestoreQuoteScanQueue(adminDb, { now: () => t, idGen: () => `id${++n}` });
  return { q, advance: (ms) => { t += ms; } };
}

test('one open request per client: a second Refresh reuses the queued one; other clients get their own', async () => {
  const { q } = setup();
  const a = await q.request({ clientId: 'c1', requestedBy: 'o@x.com' });
  assert.equal(a.status, SCAN_STATUS.QUEUED);
  const again = await q.request({ clientId: 'c1' });
  assert.equal(again.requestId, a.requestId);
  assert.equal(again.reused, true);
  const other = await q.request({ clientId: 'c2' });
  assert.notEqual(other.requestId, a.requestId);
});

test('claim -> running with a lease; finish only with that lease; a finished request frees the client for a new one', async () => {
  const { q } = setup();
  const { requestId } = await q.request({ clientId: 'c1' });
  const job = await q.claimNext();
  assert.equal(job.id, requestId);
  assert.equal(job.status, SCAN_STATUS.RUNNING);
  assert.ok(job.leaseId);
  assert.equal(await q.claimNext(), null, 'nothing else to claim while it runs');
  assert.equal(await q.finish(requestId, 'not-my-lease', { status: SCAN_STATUS.DONE }), false);
  assert.equal(await q.finish(requestId, job.leaseId, { status: SCAN_STATUS.DONE, result: { candidates: 4 } }), true);
  const done = await q.get(requestId);
  assert.equal(done.status, SCAN_STATUS.DONE);
  assert.equal(done.result.candidates, 4);
  assert.ok(done.finishedAt);
  const next = await q.request({ clientId: 'c1' });
  assert.notEqual(next.requestId, requestId);
});

test('a running request older than 30 min is reclaimable; the old lease can no longer finish it', async () => {
  const { q, advance } = setup();
  const { requestId } = await q.request({ clientId: 'c1' });
  const first = await q.claimNext();
  advance(SCAN_STALE_RUNNING_MS + 1000);
  const second = await q.claimNext();
  assert.equal(second.id, requestId);
  assert.notEqual(second.leaseId, first.leaseId);
  assert.equal(await q.finish(requestId, first.leaseId, { status: SCAN_STATUS.DONE }), false);
  assert.equal(await q.finish(requestId, second.leaseId, { status: SCAN_STATUS.FAILED }), true);
});
