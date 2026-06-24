'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const jobs = require('../media-jobs.cjs');
const { makeFakeContext } = require('./fake-firestore.cjs');

let fakeCtx;

beforeEach(() => {
  fakeCtx = makeFakeContext();
  jobs.__setTestContext(fakeCtx);
});

afterEach(() => {
  jobs.__setTestContext(null);
});

const RECIPE = {
  output: { durationSeconds: 30, width: 720, height: 720, fps: 30 },
  sourceFolders: ['skyline', 'neighborhood'],
  filter: { key: 'look_hard_bw' },
  overlay: { enabled: true, effect: 'retro_dust' },
  arweaveAudioUrl: 'https://arweave.net/abc',
};

// Force a job's stored lease to look expired so orphan reclaim can fire.
function expireLease(jobId) {
  fakeCtx.adminDb._patch(jobs.COLLECTION, jobId, {
    workerLease: { workerId: 'dead', leasedAt: '2020-01-01T00:00:00.000Z', leaseExpiresAt: '2020-01-01T00:01:00.000Z' },
  });
}

test('createMediaJob writes a queued doc with trimmed + full recipe', async () => {
  const { jobId } = await jobs.createMediaJob({ clientId: 'c1', recipe: RECIPE });
  const job = await jobs.getMediaJob(jobId, 'c1');
  assert.equal(job.status, 'queued');
  assert.equal(job.clientId, 'c1');
  assert.equal(job.type, 'video-remix');
  assert.equal(job.attempts, 0);
  assert.equal(job.recipe.durationSeconds, 30);
  assert.deepEqual(job.recipe.sourceFolders, ['skyline', 'neighborhood']);
  assert.equal(job.recipe.filter, 'look_hard_bw');
  assert.equal(job.recipe.overlay, 'retro_dust');
  assert.equal(job.recipeFull.arweaveAudioUrl, 'https://arweave.net/abc');
});

test('createMediaJob requires clientId and a known type', async () => {
  await assert.rejects(() => jobs.createMediaJob({ recipe: RECIPE }), /clientId is required/);
  await assert.rejects(() => jobs.createMediaJob({ clientId: 'c1', type: 'bogus', recipe: RECIPE }), /Unknown media job type/);
});

test('getMediaJob is client-scoped (foreign client cannot read)', async () => {
  const { jobId } = await jobs.createMediaJob({ clientId: 'owner', recipe: RECIPE });
  assert.equal(await jobs.getMediaJob(jobId, 'intruder'), null);
  assert.ok(await jobs.getMediaJob(jobId, 'owner'));
  assert.equal(await jobs.getMediaJob('missing', 'owner'), null);
});

test('claimNextMediaJob claims the oldest queued job and increments attempts', async () => {
  const a = await jobs.createMediaJob({ clientId: 'c1', recipe: RECIPE });
  const b = await jobs.createMediaJob({ clientId: 'c1', recipe: RECIPE });
  const claimed = await jobs.claimNextMediaJob({ workerId: 'w1' });
  assert.equal(claimed.jobId, a.jobId, 'oldest job claimed first');
  assert.equal(claimed.status, 'processing');
  assert.equal(claimed.attempts, 1);
  assert.ok(claimed.workerLease.leaseExpiresAt);
  // job b untouched
  assert.equal((await jobs.getMediaJob(b.jobId, 'c1')).status, 'queued');
});

test('singleton lease blocks a second concurrent claim', async () => {
  await jobs.createMediaJob({ clientId: 'c1', recipe: RECIPE });
  await jobs.createMediaJob({ clientId: 'c1', recipe: RECIPE });
  const first = await jobs.claimNextMediaJob({ workerId: 'w1' });
  assert.ok(first);
  const second = await jobs.claimNextMediaJob({ workerId: 'w2' });
  assert.equal(second, null, 'active lease must block another claim');
});

test('completeMediaJob stores output, clears lease, frees the queue', async () => {
  await jobs.createMediaJob({ clientId: 'c1', recipe: RECIPE });
  const queued = await jobs.createMediaJob({ clientId: 'c1', recipe: RECIPE });
  const claimed = await jobs.claimNextMediaJob({ workerId: 'w1' });
  const output = { type: 'video_remix', variant: 'video', storagePath: 'clients/c1/media/generated/x.mp4' };
  await jobs.completeMediaJob(claimed.jobId, output);
  const done = await jobs.getMediaJob(claimed.jobId, 'c1');
  assert.equal(done.status, 'done');
  assert.equal(done.output.storagePath, 'clients/c1/media/generated/x.mp4');
  assert.equal(done.workerLease, null);
  // queue lease freed → next job is now claimable
  const next = await jobs.claimNextMediaJob({ workerId: 'w2' });
  assert.equal(next.jobId, queued.jobId);
});

test('failMediaJob marks failed and frees the queue', async () => {
  await jobs.createMediaJob({ clientId: 'c1', recipe: RECIPE });
  const claimed = await jobs.claimNextMediaJob({ workerId: 'w1' });
  await jobs.failMediaJob(claimed.jobId, new Error('ffmpeg blew up'));
  const failed = await jobs.getMediaJob(claimed.jobId, 'c1');
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /ffmpeg blew up/);
  assert.equal(failed.workerLease, null);
});

test('requeueMediaJob backs off then re-claims, exhausts after MAX_ATTEMPTS', async () => {
  const { jobId } = await jobs.createMediaJob({ clientId: 'c1', recipe: RECIPE });

  // Drive the job through the full retry budget.
  for (let i = 1; i <= jobs.MAX_ATTEMPTS; i += 1) {
    const claimed = await jobs.claimNextMediaJob({ workerId: 'w1' });
    assert.ok(claimed, `claim #${i} should succeed`);
    assert.equal(claimed.attempts, i);
    const res = await jobs.requeueMediaJob(jobId, new Error(`fail ${i}`));
    if (i < jobs.MAX_ATTEMPTS) {
      assert.equal(res.requeued, true);
      // Backoff sets a future nextAttemptAt → not immediately claimable.
      assert.equal(await jobs.claimNextMediaJob({ workerId: 'w1' }), null);
      // Clear the backoff gate to allow the next attempt.
      fakeCtx.adminDb._patch(jobs.COLLECTION, jobId, { nextAttemptAt: null, nextAttemptAtTs: null });
    } else {
      assert.equal(res.exhausted, true);
    }
  }
  const job = await jobs.getMediaJob(jobId, 'c1');
  assert.equal(job.status, 'failed');
  assert.equal(job.attempts, jobs.MAX_ATTEMPTS);
});

test('orphaned processing job (expired lease) is reclaimed', async () => {
  const { jobId } = await jobs.createMediaJob({ clientId: 'c1', recipe: RECIPE });
  const claimed = await jobs.claimNextMediaJob({ workerId: 'w1' });
  assert.equal(claimed.jobId, jobId);
  // Simulate worker death: lease expires, lock left dangling.
  expireLease(jobId);
  fakeCtx.adminDb._patch(jobs.LOCK_COLLECTION, jobs.MEDIA_LOCK_DOC, {
    jobId, leaseExpiresAt: '2020-01-01T00:01:00.000Z',
  });
  const reclaimed = await jobs.claimNextMediaJob({ workerId: 'w2' });
  assert.ok(reclaimed, 'expired processing job must be reclaimable');
  assert.equal(reclaimed.jobId, jobId);
  assert.equal(reclaimed.attempts, 2);
});

test('listMediaJobs returns newest-first and filters by type', async () => {
  const a = await jobs.createMediaJob({ clientId: 'c1', type: 'video-remix', recipe: RECIPE });
  const b = await jobs.createMediaJob({ clientId: 'c1', type: 'arweave-archive', recipe: {} });
  await jobs.createMediaJob({ clientId: 'other', recipe: RECIPE });

  const all = await jobs.listMediaJobs('c1');
  assert.equal(all.length, 2);
  assert.equal(all[0].jobId, b.jobId, 'newest first');

  const remixOnly = await jobs.listMediaJobs('c1', { type: 'video-remix' });
  assert.equal(remixOnly.length, 1);
  assert.equal(remixOnly[0].jobId, a.jobId);
});
