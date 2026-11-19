import assert from 'node:assert/strict';
import test from 'node:test';
import { planBatch, CURATION_BATCH_CLIENT_ID } from '../curation-batch.js';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const job = (status, hoursAgo, extra = {}) => ({ status, type: 'video-remix', clientId: CURATION_BATCH_CLIENT_ID, createdAt: new Date(NOW - hoursAgo * 3600e3).toISOString(), ...extra });

test('empty history allows the requested count', () => {
  assert.deepEqual(planBatch({ requested: 3, jobs: [], now: NOW }), { count: 3, inflight: 0, last24h: 0, reason: null });
});

test('requested is clamped to 1..5 and defaults when invalid', () => {
  assert.equal(planBatch({ requested: 99, jobs: [], now: NOW }).count, 5);
  assert.equal(planBatch({ requested: 0, jobs: [], now: NOW }).count, 1);
  assert.equal(planBatch({ requested: -4, jobs: [], now: NOW }).count, 1);
  assert.equal(planBatch({ requested: 'x', jobs: [], now: NOW }).count, 5);
});

test('inflight (queued + processing) reduces room up to 5', () => {
  const jobs = [job('queued', 0.1), job('processing', 0.1), job('done', 1)];
  const p = planBatch({ requested: 5, jobs, now: NOW });
  assert.equal(p.inflight, 2);
  assert.equal(p.count, 3);
});

test('inflight full -> 0 with reason', () => {
  const jobs = Array.from({ length: 5 }, () => job('queued', 0.1));
  assert.deepEqual(planBatch({ requested: 5, jobs, now: NOW }), { count: 0, inflight: 5, last24h: 5, reason: 'inflight-full' });
});

test('24h window counts only recent jobs and caps at 20', () => {
  const old = Array.from({ length: 10 }, () => job('done', 30));
  assert.equal(planBatch({ requested: 5, jobs: old, now: NOW }).last24h, 0);
  const recent = Array.from({ length: 18 }, () => job('done', 2));
  const p = planBatch({ requested: 5, jobs: recent, now: NOW });
  assert.equal(p.last24h, 18);
  assert.equal(p.count, 2);
});

test('daily cap reached -> 0 with daily-cap reason', () => {
  const jobs = Array.from({ length: 20 }, () => job('done', 3));
  const p = planBatch({ requested: 5, jobs, now: NOW });
  assert.equal(p.count, 0);
  assert.equal(p.reason, 'daily-cap');
});

test('over-cap history floors at 0; other clients/types ignored', () => {
  const jobs = [...Array.from({ length: 25 }, () => job('done', 1)), job('queued', 1, { clientId: 'someone-else' }), job('queued', 1, { type: 'other' })];
  const p = planBatch({ requested: 5, jobs, now: NOW });
  assert.equal(p.count, 0);
  assert.equal(p.inflight, 0);
});

test('a stale queued job (never reconciled) stops counting as in flight after 30 min', () => {
  const jobs = Array.from({ length: 5 }, () => job('queued', 1));
  const p = planBatch({ requested: 5, jobs, now: NOW });
  assert.equal(p.inflight, 0);
  assert.equal(p.count, 5);
});
