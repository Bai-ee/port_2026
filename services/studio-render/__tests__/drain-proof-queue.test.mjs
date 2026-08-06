// drain-proof-queue.test.mjs — Phase 3. Real claim+render+upload+complete
// cycles (same fake Firestore/Storage context as proof-render-worker.test.mjs)
// against the bounded manual drain command.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { normalizeArtSceneRecipe } from '../art-recipe.mjs';
import { checkCapabilities } from '../art-render-validation.mjs';
import { drain, DEFAULT_MAX_ITERATIONS } from '../scripts/drain-proof-queue.mjs';

const require = createRequire(import.meta.url);
// Vendored — must be the SAME module instance proof-render-worker.mjs itself requires.
const jobs = require('../vendor/api-lib/proof-render-jobs.cjs');
const artifacts = require('../vendor/api-lib/proof-render-artifacts.cjs');
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');

const CLIENT_A = 'client-a';
const OWNER_A = 'user-a1';
const SMALL_PARAMS = { width: 160, height: 160, fps: 8, durationSeconds: 0.2, warmupFrames: 2 };

let fakeCtx;
beforeEach(() => {
  fakeCtx = makeFakeContext();
  jobs.__setTestContext(fakeCtx);
  artifacts.__setTestContext(fakeCtx);
});
afterEach(() => {
  jobs.__setTestContext(null);
  artifacts.__setTestContext(null);
});

async function enqueue(scene = {}) {
  const recipe = normalizeArtSceneRecipe({ kind: 'art-scene-v2', schemaVersion: 1, scene: { envIntensity: 0, ...scene } }).recipe;
  const capabilities = checkCapabilities(recipe);
  assert.equal(capabilities.supported, true);
  return jobs.createProofRenderJob({ clientId: CLIENT_A, ownerUid: OWNER_A, recipe, warnings: [], capabilities, renderParams: SMALL_PARAMS });
}

test('DEFAULT_MAX_ITERATIONS is a sane positive bound', () => {
  assert.ok(Number.isFinite(DEFAULT_MAX_ITERATIONS));
  assert.ok(DEFAULT_MAX_ITERATIONS > 0);
});

test('drains every queued job and stops as soon as the queue reports empty', async () => {
  const jobA = await enqueue({ mat: { baseColor: '#ff0000' } });
  const jobB = await enqueue({ mat: { baseColor: '#00ff00' } });

  const summary = await drain({ maxIterations: 10 });
  assert.equal(summary.done, 2);
  assert.equal(summary.queued, 0);
  assert.equal(summary.failed, 0);
  assert.equal(summary.iterations, 3, '2 real claims + 1 empty-queue check');

  const doneA = await jobs.getProofRenderJob(jobA.jobId, { clientId: CLIENT_A });
  const doneB = await jobs.getProofRenderJob(jobB.jobId, { clientId: CLIENT_A });
  assert.equal(doneA.status, 'done');
  assert.equal(doneB.status, 'done');
});

test('an empty queue returns immediately with a zeroed summary', async () => {
  const summary = await drain({ maxIterations: 10 });
  assert.deepEqual(summary, { done: 0, queued: 0, failed: 0, lostClaim: 0, iterations: 1 });
});

test('stops at maxIterations even if the queue still has (or keeps producing) work, rather than running forever', async () => {
  await enqueue({ mat: { baseColor: '#111111' } });
  await enqueue({ mat: { baseColor: '#222222' } });
  await enqueue({ mat: { baseColor: '#333333' } });

  const summary = await drain({ maxIterations: 2 });
  assert.equal(summary.iterations, 2);
  assert.equal(summary.done, 2, 'exactly maxIterations worth of real claims, no more');

  // One job must still be genuinely left in the queue — the cap actually bounded work, it didn't silently finish everything anyway.
  const remaining = await jobs.listProofRenderJobs(CLIENT_A, 5);
  assert.ok(remaining.some((j) => j.status === 'queued'));
});
