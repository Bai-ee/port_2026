import test from 'node:test';
import assert from 'node:assert/strict';
import { createUploadManager } from '../upload-manager.js';

const KB = 1024;
const fakeFile = (name, size, type = 'video/mp4') => ({ name, size, type, slice: (a, b) => ({ size: b - a }) });

function memStore() {
  const jobs = new Map(); const blobs = new Map();
  return {
    jobs, blobs,
    putJob: async (j) => { jobs.set(j.id, JSON.parse(JSON.stringify(j))); },
    deleteJob: async (id) => { jobs.delete(id); },
    listJobs: async () => [...jobs.values()],
    putBlob: async (k, b) => { blobs.set(k, b); },
    getBlob: async (k) => blobs.get(k) || null,
    deleteBlobsForJob: async (id) => { for (const k of [...blobs.keys()]) if (k.startsWith(`${id}::`)) blobs.delete(k); },
  };
}

function harness({ resumable = true, chunk = 4 * KB, store = memStore(), serverOffset = null, expireOnce = false, failChunkOnce = false } = {}) {
  const calls = []; const chunks = []; const signed = [];
  let expired = expireOnce; let failed = failChunkOnce; let received = 0;
  const request = async (path, body, clientId) => {
    calls.push({ path, body, clientId });
    if (path.includes('create-upload-session')) {
      return { session: { folder: 'track-a', uploads: body.files.map((f, i) => ({
        storagePath: `p/${f.name}`, safeName: f.name, size: f.size, contentType: f.type, kind: 'video', uploadUrl: 'https://signed/' + i,
        ...(f.withPoster ? { posterUpload: { storagePath: `p/${f.name}.jpg`, uploadUrl: 'https://signed/poster' } } : {}),
        ...(resumable ? { resumable: { sessionUri: `https://session/${i}` } } : {}),
      })) } };
    }
    if (path.includes('upload-status')) {
      if (expired) return { ok: true, expired: true };
      const off = serverOffset ?? received;
      return { ok: true, offset: off, complete: off >= body.size };
    }
    if (path.includes('upload-renew')) { expired = false; received = 0; return { ok: true, sessionUri: 'https://session/renewed' }; }
    if (path.includes('complete-upload')) return { ok: true };
    return { created: body.files, existing: [] };
  };
  const uploader = {
    putSigned: async (a) => { signed.push(a.upload.uploadUrl); },
    putChunk: async ({ sessionUri, start, end, size }) => {
      if (failed) { failed = false; throw new Error('Network error'); }
      if (expired) throw Object.assign(new Error('gone'), { status: 410 });
      chunks.push({ sessionUri, start, end, size });
      received = end + 1;
      return { status: end + 1 >= size ? 200 : 308 };
    },
  };
  const mgr = createUploadManager({ store, uploader, capturePoster: async () => ({ size: 3 }), sleep: async () => {}, chunkSize: chunk });
  mgr.configure({ request, ownerId: 'u1' });
  return { mgr, calls, chunks, signed, store };
}

const done = (mgr) => new Promise((res) => mgr.onJobDone(res));
const settle = async (mgr) => { for (let i = 0; i < 200 && mgr.isActive(); i += 1) await new Promise((r) => setImmediate(r)); };
const enq = (mgr, files) => mgr.enqueue({ clientId: 'client-x', bucketId: 'a', bucketName: 'A', folderMode: 'new', folderName: 'track-a', files });

test('chunks a file with correct offsets, ingests once, uses job clientId', async () => {
  const h = harness();
  const d = done(h.mgr);
  enq(h.mgr, [fakeFile('a.mp4', 10 * KB)]);
  const job = await d;
  assert.deepEqual(h.chunks.map((c) => [c.start, c.end]), [[0, 4095], [4096, 8191], [8192, 10239]]);
  assert.equal(h.calls.filter((c) => c.body.action === 'ingest-uploads').length, 1);
  assert.ok(h.calls.every((c) => c.clientId === 'client-x'));
  assert.ok(h.calls[0].body.resumable);
  assert.equal(job.summary, '1 added to A');
  assert.equal(h.store.jobs.size, 0);
  assert.equal(h.store.blobs.size, 0);
});

test('poster goes through simple signed PUT and its path is ingested', async () => {
  const h = harness();
  const d = done(h.mgr);
  enq(h.mgr, [fakeFile('a.mp4', 2 * KB)]);
  await d;
  assert.deepEqual(h.signed, ['https://signed/poster']);
  const ingest = h.calls.find((c) => c.body.action === 'ingest-uploads');
  assert.equal(ingest.body.files[0].posterPath, 'p/a.mp4.jpg');
});

test('falls back to signed PUT when no resumable session is offered', async () => {
  const h = harness({ resumable: false });
  const d = done(h.mgr);
  enq(h.mgr, [fakeFile('a.mp4', 10 * KB)]);
  await d;
  assert.equal(h.chunks.length, 0);
  assert.ok(h.signed.includes('https://signed/0'));
});

test('network error mid-upload asks the server for the offset and continues from it', async () => {
  const h = harness({ failChunkOnce: true, serverOffset: 4 * KB });
  const d = done(h.mgr);
  enq(h.mgr, [fakeFile('a.mp4', 10 * KB)]);
  await d;
  assert.ok(h.calls.some((c) => c.path.includes('upload-status')));
  assert.equal(h.chunks[0].start, 4 * KB);
});

test('expired session renews and restarts the file from offset 0', async () => {
  const h = harness({ expireOnce: true });
  const d = done(h.mgr);
  enq(h.mgr, [fakeFile('a.mp4', 6 * KB)]);
  await d;
  assert.ok(h.calls.some((c) => c.path.includes('upload-renew')));
  assert.equal(h.chunks[0].sessionUri, 'https://session/renewed');
  assert.equal(h.chunks[0].start, 0);
});

test('resumeAll continues from the server offset; missing Blob becomes needs-repick', async () => {
  const store = memStore();
  const first = harness({ store });
  // Persist an interrupted job by hand (as a reload would find it).
  const base = (key, name) => ({ key, name, size: 8 * KB, type: 'video/mp4', status: 'uploading', progress: 50, storagePath: `p/${name}`, posterPath: null, sessionUri: `https://session/${key}`, error: '', resume: false,
    upload: { storagePath: `p/${name}`, safeName: name, size: 8 * KB, contentType: 'video/mp4', kind: 'video', uploadUrl: 'u' } });
  await store.putJob({ id: 'old', ownerId: 'u1', clientId: 'client-x', bucketId: 'a', bucketName: 'A', folderMode: 'new', folderName: 'track-a', folder: 'track-a', stage: 'uploading', files: [base('f0', 'kept.mp4'), base('f1', 'gone.mp4')] });
  await store.putBlob('old::f0::file', fakeFile('kept.mp4', 8 * KB));
  const h = harness({ store, serverOffset: 4 * KB });
  await h.mgr.resumeAll();
  await settle(h.mgr);
  assert.equal(h.chunks[0].start, 4 * KB);
  const snap = h.mgr.getSnapshot()[0];
  assert.equal(snap.files[0].status, 'done');
  assert.equal(snap.files[1].status, 'needs-repick');
  assert.equal(snap.stage, 'error');
  assert.equal(h.calls.filter((c) => c.body.action === 'ingest-uploads').length, 0);
  // Re-pick finishes the job; ingest runs exactly once.
  const d = done(h.mgr);
  assert.equal(await h.mgr.repick('old', 'f1', fakeFile('gone.mp4', 8 * KB)), true);
  await d;
  assert.equal(h.calls.filter((c) => c.body.action === 'ingest-uploads').length, 1);
});

test('works with no persistence available', async () => {
  const dead = { putJob: async () => { throw new Error('x'); }, deleteJob: async () => { throw new Error('x'); }, listJobs: async () => { throw new Error('x'); }, putBlob: async () => { throw new Error('x'); }, getBlob: async () => { throw new Error('x'); }, deleteBlobsForJob: async () => { throw new Error('x'); } };
  const h = harness({ store: dead });
  const d = done(h.mgr);
  enq(h.mgr, [fakeFile('a.mp4', 5 * KB)]);
  await d;
  await h.mgr.resumeAll();
  assert.equal(h.mgr.getSnapshot()[0].stage, 'done');
});
