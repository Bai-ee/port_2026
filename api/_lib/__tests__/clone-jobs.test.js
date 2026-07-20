'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const jobs = require('../clone-jobs.cjs');
const { makeFakeContext } = require('./fake-firestore.cjs');

let fakeCtx;

beforeEach(() => {
  fakeCtx = makeFakeContext();
  jobs.__setTestContext(fakeCtx);
});

afterEach(() => {
  jobs.__setTestContext(null);
});

function expireLease(jobId) {
  fakeCtx.adminDb._patch(jobs.COLLECTION, jobId, {
    workerLease: { workerId: 'dead', leasedAt: '2020-01-01T00:00:00.000Z', leaseExpiresAt: '2020-01-01T00:01:00.000Z' },
  });
}

test('createCloneJob writes a queued doc with defaults', async () => {
  const { jobId } = await jobs.createCloneJob({ clientId: 'c1', targetUrl: 'https://rositas.example.com', ownershipAttested: true });
  const job = await jobs.getCloneJob(jobId, 'c1');
  assert.equal(job.status, 'queued');
  assert.equal(job.clientId, 'c1');
  assert.equal(job.targetUrl, 'https://rositas.example.com');
  assert.equal(job.ownershipAttested, true);
  assert.equal(job.attempts, 0);
  assert.equal(job.platform, null);
  assert.deepEqual(job.pages, []);
  assert.equal(job.zip, null);
});

test('createCloneJob requires clientId, targetUrl, and true ownership attestation', async () => {
  await assert.rejects(() => jobs.createCloneJob({ targetUrl: 'https://x.com', ownershipAttested: true }), /clientId is required/);
  await assert.rejects(() => jobs.createCloneJob({ clientId: 'c1', ownershipAttested: true }), /targetUrl is required/);
  await assert.rejects(() => jobs.createCloneJob({ clientId: 'c1', targetUrl: 'https://x.com', ownershipAttested: false }), /attestation is required/);
  await assert.rejects(() => jobs.createCloneJob({ clientId: 'c1', targetUrl: 'https://x.com' }), /attestation is required/);
});

test('getCloneJob is client-scoped (foreign client cannot read)', async () => {
  const { jobId } = await jobs.createCloneJob({ clientId: 'owner', targetUrl: 'https://x.com', ownershipAttested: true });
  assert.equal(await jobs.getCloneJob(jobId, 'intruder'), null);
  assert.ok(await jobs.getCloneJob(jobId, 'owner'));
  assert.equal(await jobs.getCloneJob('missing', 'owner'), null);
});

test('claimCloneJob claims a specific queued job and increments attempts', async () => {
  const { jobId } = await jobs.createCloneJob({ clientId: 'c1', targetUrl: 'https://x.com', ownershipAttested: true });
  const claimed = await jobs.claimCloneJob(jobId, { workerId: 'w1' });
  assert.equal(claimed.jobId, jobId);
  assert.equal(claimed.status, 'processing');
  assert.equal(claimed.attempts, 1);
  assert.ok(claimed.workerLease.leaseExpiresAt);
});

test('claimCloneJob refuses a job that is already actively leased', async () => {
  const { jobId } = await jobs.createCloneJob({ clientId: 'c1', targetUrl: 'https://x.com', ownershipAttested: true });
  const first = await jobs.claimCloneJob(jobId, { workerId: 'w1' });
  assert.ok(first);
  const second = await jobs.claimCloneJob(jobId, { workerId: 'w2' });
  assert.equal(second, null, 'active lease on the same job must block a second claim');
});

test('claimNextCloneJob claims the oldest runnable job and lets independent jobs run concurrently', async () => {
  const a = await jobs.createCloneJob({ clientId: 'c1', targetUrl: 'https://a.com', ownershipAttested: true });
  const b = await jobs.createCloneJob({ clientId: 'c1', targetUrl: 'https://b.com', ownershipAttested: true });
  const claimedA = await jobs.claimNextCloneJob({ workerId: 'w1' });
  assert.equal(claimedA.jobId, a.jobId, 'oldest job claimed first');
  // Unlike media_jobs' singleton lock, a second independent job claims fine
  // while the first is still in flight — no shared exclusive resource.
  const claimedB = await jobs.claimNextCloneJob({ workerId: 'w2' });
  assert.equal(claimedB.jobId, b.jobId);
});

test('markCloneJobVerifying transitions status without touching the lease', async () => {
  const { jobId } = await jobs.createCloneJob({ clientId: 'c1', targetUrl: 'https://x.com', ownershipAttested: true });
  const claimed = await jobs.claimCloneJob(jobId, { workerId: 'w1' });
  await jobs.markCloneJobVerifying(jobId);
  const job = await jobs.getCloneJob(jobId, 'c1');
  assert.equal(job.status, 'verifying');
  assert.equal(job.workerLease.workerId, claimed.workerLease.workerId);
});

test('appendJobLog accumulates timestamped lines', async () => {
  const { jobId } = await jobs.createCloneJob({ clientId: 'c1', targetUrl: 'https://x.com', ownershipAttested: true });
  await jobs.appendJobLog(jobId, 'discoverPages: found 6 pages');
  await jobs.appendJobLog(jobId, 'mirrorAssets: 211 assets');
  const job = await jobs.getCloneJob(jobId, 'c1');
  assert.equal(job.log.length, 2);
  assert.equal(job.log[0].line, 'discoverPages: found 6 pages');
  assert.equal(job.log[1].line, 'mirrorAssets: 211 assets');
  assert.ok(job.log[0].t);
});

test('updateJobFields merges stage-result fields without clobbering siblings', async () => {
  const { jobId } = await jobs.createCloneJob({ clientId: 'c1', targetUrl: 'https://x.com', ownershipAttested: true });
  await jobs.updateJobFields(jobId, { platform: 'shopify' });
  await jobs.updateJobFields(jobId, { assetCount: 211, totalBytes: 48_000_000 });
  const job = await jobs.getCloneJob(jobId, 'c1');
  assert.equal(job.platform, 'shopify');
  assert.equal(job.assetCount, 211);
  assert.equal(job.totalBytes, 48_000_000);
  assert.equal(job.clientId, 'c1', 'sibling field untouched');
});

test('completeCloneJob stores zip/preview/verifyReport, clears lease', async () => {
  const { jobId } = await jobs.createCloneJob({ clientId: 'c1', targetUrl: 'https://x.com', ownershipAttested: true });
  await jobs.claimCloneJob(jobId, { workerId: 'w1' });
  await jobs.completeCloneJob(jobId, {
    zip: { storagePath: 'clients/c1/site-clone/x/site.zip', downloadUrl: 'https://x', bytes: 1000 },
    preview: { vercelUrl: 'https://preview.example.com', deploymentId: 'dpl_1' },
    verifyReport: { consoleErrors: 0, httpErrors: 0, pagesChecked: 6, pass: true },
    assetCount: 211,
    totalBytes: 48_000_000,
    pages: [{ path: '/', localFile: 'index.html' }],
  });
  const job = await jobs.getCloneJob(jobId, 'c1');
  assert.equal(job.status, 'done');
  assert.equal(job.zip.bytes, 1000);
  assert.equal(job.preview.vercelUrl, 'https://preview.example.com');
  assert.equal(job.verifyReport.pass, true);
  assert.equal(job.assetCount, 211);
  assert.equal(job.workerLease, null);
});

test('failCloneJob marks failed and attaches a verify report when the gate fails', async () => {
  const { jobId } = await jobs.createCloneJob({ clientId: 'c1', targetUrl: 'https://x.com', ownershipAttested: true });
  await jobs.claimCloneJob(jobId, { workerId: 'w1' });
  await jobs.failCloneJob(jobId, new Error('A6 gate failed: 3 console errors'), {
    verifyReport: { consoleErrors: 3, httpErrors: 0, pagesChecked: 6, pass: false },
  });
  const job = await jobs.getCloneJob(jobId, 'c1');
  assert.equal(job.status, 'failed');
  assert.match(job.error, /A6 gate failed/);
  assert.equal(job.verifyReport.pass, false);
  assert.equal(job.workerLease, null);
});

test('requeueCloneJob backs off then re-claims, exhausts after MAX_ATTEMPTS', async () => {
  const { jobId } = await jobs.createCloneJob({ clientId: 'c1', targetUrl: 'https://x.com', ownershipAttested: true });

  for (let i = 1; i <= jobs.MAX_ATTEMPTS; i += 1) {
    const claimed = await jobs.claimCloneJob(jobId, { workerId: 'w1' });
    assert.ok(claimed, `claim #${i} should succeed`);
    assert.equal(claimed.attempts, i);
    const res = await jobs.requeueCloneJob(jobId, new Error(`fail ${i}`));
    if (i < jobs.MAX_ATTEMPTS) {
      assert.equal(res.requeued, true);
      assert.equal(await jobs.claimCloneJob(jobId, { workerId: 'w1' }), null, 'backoff blocks immediate re-claim');
      fakeCtx.adminDb._patch(jobs.COLLECTION, jobId, { nextAttemptAt: null, nextAttemptAtTs: null });
    } else {
      assert.equal(res.exhausted, true);
    }
  }
  const job = await jobs.getCloneJob(jobId, 'c1');
  assert.equal(job.status, 'failed');
  assert.equal(job.attempts, jobs.MAX_ATTEMPTS);
});

test('orphaned processing job (expired lease) is reclaimed via claimNextCloneJob', async () => {
  const { jobId } = await jobs.createCloneJob({ clientId: 'c1', targetUrl: 'https://x.com', ownershipAttested: true });
  const claimed = await jobs.claimCloneJob(jobId, { workerId: 'w1' });
  assert.equal(claimed.jobId, jobId);
  expireLease(jobId);
  const reclaimed = await jobs.claimNextCloneJob({ workerId: 'w2' });
  assert.ok(reclaimed, 'expired processing job must be reclaimable');
  assert.equal(reclaimed.jobId, jobId);
  assert.equal(reclaimed.attempts, 2);
});

test('listCloneJobs returns newest-first, scoped to the client', async () => {
  const a = await jobs.createCloneJob({ clientId: 'c1', targetUrl: 'https://a.com', ownershipAttested: true });
  const b = await jobs.createCloneJob({ clientId: 'c1', targetUrl: 'https://b.com', ownershipAttested: true });
  await jobs.createCloneJob({ clientId: 'other', targetUrl: 'https://c.com', ownershipAttested: true });

  const all = await jobs.listCloneJobs('c1');
  assert.equal(all.length, 2);
  assert.equal(all[0].jobId, b.jobId, 'newest first');

  const scoped = await jobs.listCloneJobs('other');
  assert.equal(scoped.length, 1);
});
