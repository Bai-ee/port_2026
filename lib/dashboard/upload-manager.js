// Background bucket-upload manager: a framework-free singleton store that keeps
// uploading after the Content Center modal closes and resumes after a refresh.
//   session (resumable) -> per file: poster + resumable chunks -> complete-upload -> ingest-uploads
// React reads it with useSyncExternalStore(subscribe, getSnapshot).
// Network goes through an injected request(path, body, clientId) so the job's own
// ?as= client id is used even if the dashboard client switcher changes later.
import { toIngestFiles, summarizeIngest } from '../../components/dashboard/x-content/bucket-upload-model.js';
import { captureVideoPoster } from './capture-video-poster.js';
import { uploadFileToSignedUrl } from './upload-signed-url.js';
import { createIdbUploadStore, blobKey } from './upload-store-idb.js';

export const CHUNK_SIZE = 8 * 1024 * 1024; // multiple of 256 KiB (GCS requirement)
const MEDIA = (action) => `/api/dashboard/media?action=${encodeURIComponent(action)}`;
const QUOTE_TARGETS = '/api/dashboard/quote-targets';
const MAX_ATTEMPTS = 5;

const ACTIVE = new Set(['queued', 'session', 'uploading', 'completing', 'ingesting']);

class ExpiredSession extends Error {}

function isRetryable(err) {
  const s = err?.status;
  return !s || s >= 500 || s === 429 || s === 408;
}

// Browser XHR chunk PUT for a resumable session URI. Resolves { status } for 200/201/308.
export function xhrPutChunk({ sessionUri, blob, start, end, size, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', sessionUri);
    xhr.setRequestHeader('Content-Range', size === 0 ? 'bytes */0' : `bytes ${start}-${end}/${size}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded); };
    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 201 || xhr.status === 308) resolve({ status: xhr.status });
      else reject(Object.assign(new Error(`Upload failed (${xhr.status})`), { status: xhr.status }));
    };
    xhr.onerror = () => reject(new Error('Network error during upload.'));
    xhr.onabort = () => reject(new Error('Upload aborted.'));
    xhr.send(size === 0 ? null : blob.slice(start, end + 1));
  });
}

const defaultUploader = { putSigned: uploadFileToSignedUrl, putChunk: xhrPutChunk };
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createUploadManager(opts = {}) {
  const store = opts.store || createIdbUploadStore();
  const uploader = opts.uploader || defaultUploader;
  const capturePoster = opts.capturePoster || captureVideoPoster;
  const sleep = opts.sleep || defaultSleep;
  const chunkSize = opts.chunkSize || CHUNK_SIZE;

  let request = null;
  let ownerId = null;
  let jobs = [];
  const blobs = new Map(); // `${jobId}::${fileKey}::file|poster` -> Blob (memory copy)
  const listeners = new Set();
  const finishListeners = new Set();
  let snapshot = [];
  let pumping = false;
  let seq = 0;

  const emit = () => {
    snapshot = jobs.map((j) => ({ ...j, files: j.files.map((f) => ({ ...f })) }));
    syncUnloadGuard();
    listeners.forEach((l) => l());
  };
  const persist = (job) => {
    const { files, ...rest } = job;
    return store.putJob({ ...rest, files: files.map((f) => ({ ...f })) }).catch(() => {});
  };
  const patchFile = (job, f, p, save = false) => {
    Object.assign(f, p);
    emit();
    if (save) persist(job);
  };
  const setStage = (job, stage, extra = {}) => { Object.assign(job, { stage }, extra); emit(); return persist(job); };

  // ── beforeunload guard ──
  const guard = (e) => { e.preventDefault(); e.returnValue = ''; return ''; };
  let guarded = false;
  function syncUnloadGuard() {
    if (typeof window === 'undefined') return;
    const active = jobs.some((j) => ACTIVE.has(j.stage));
    if (active && !guarded) { window.addEventListener('beforeunload', guard); guarded = true; }
    else if (!active && guarded) { window.removeEventListener('beforeunload', guard); guarded = false; }
  }

  const req = (path, body, job) => request(path, body, job.clientId);
  const reqRetry = async (path, body, job) => {
    for (let attempt = 0; ; attempt += 1) {
      try { return await req(path, body, job); } catch (err) {
        if (attempt + 1 >= MAX_ATTEMPTS || !isRetryable(err)) throw err;
        await sleep(Math.min(1000 * 2 ** attempt, 15000));
      }
    }
  };

  async function getBlob(job, f, kind) {
    const key = blobKey(job.id, f.key, kind);
    if (blobs.has(key)) return blobs.get(key);
    const b = await store.getBlob(key).catch(() => null);
    if (b) blobs.set(key, b);
    return b || null;
  }

  // ── resumable byte upload for one file; returns when complete ──
  async function uploadResumable(job, f, blob, upload) {
    const size = blob.size;
    let offset = 0;
    if (f.resume) {
      offset = await syncOffset(job, f, size);
      if (offset === size && size > 0) return;
    }
    let attempt = 0;
    while (true) {
      if (job.cancelled) throw new Error('Cancelled');
      const end = Math.min(offset + chunkSize, size) - 1;
      try {
        const base = offset;
        const res = await uploader.putChunk({
          sessionUri: f.sessionUri, blob, start: offset, end, size, contentType: upload.contentType,
          onProgress: (loaded) => setProgress(f, Math.min(size, base + loaded), size),
        });
        attempt = 0;
        if (res.status === 200 || res.status === 201) return;
        offset = end + 1; // 308: continue
        setProgress(f, offset, size);
        if (offset >= size) offset = await syncOffset(job, f, size); // server must confirm the tail
        if (offset === size) return;
      } catch (err) {
        if (err instanceof ExpiredSession || err?.status === 404 || err?.status === 410) throw new ExpiredSession('expired');
        if (!isRetryable(err) || attempt + 1 >= MAX_ATTEMPTS) throw err;
        await sleep(Math.min(1000 * 2 ** attempt, 15000));
        attempt += 1;
        offset = await syncOffset(job, f, size); // never trust local state after an interruption
        if (offset === size && size > 0) return;
      }
    }
  }

  async function syncOffset(job, f, size) {
    const st = await reqRetry(MEDIA('upload-status'), { sessionUri: f.sessionUri, size }, job);
    if (st?.expired) throw new ExpiredSession('expired');
    if (st?.complete) return size;
    const off = Math.max(0, Math.min(size, Number(st?.offset) || 0));
    setProgress(f, off, size);
    return off;
  }

  function setProgress(f, done, size) {
    const pct = size ? Math.floor((done / size) * 100) : 100;
    if (pct !== f.progress) { f.progress = pct; emit(); }
  }

  async function uploadOneFile(job, f) {
    const blob = await getBlob(job, f, 'file');
    if (!blob) {
      patchFile(job, f, { status: 'needs-repick', error: 'This file is no longer stored by the browser. Re-pick it to continue.' }, true);
      return;
    }
    patchFile(job, f, { status: 'uploading', error: '' }, true);
    const upload = f.upload;
    if (upload.posterUpload && !f.posterPath && !f.posterSkipped) {
      let pb = await getBlob(job, f, 'poster');
      if (!pb) {
        pb = await capturePoster(blob).catch(() => null);
        if (pb) { blobs.set(blobKey(job.id, f.key, 'poster'), pb); store.putBlob(blobKey(job.id, f.key, 'poster'), pb).catch(() => {}); }
      }
      if (pb) {
        try { await uploader.putSigned({ file: pb, upload: upload.posterUpload, onProgress: () => {} }); f.posterPath = upload.posterUpload.storagePath; } catch { f.posterSkipped = true; }
      } else f.posterSkipped = true;
      persist(job);
    }
    if (f.sessionUri) {
      try {
        await uploadResumable(job, f, blob, upload);
      } catch (err) {
        if (!(err instanceof ExpiredSession)) throw err;
        const renewed = await reqRetry(MEDIA('upload-renew'), { storagePath: upload.storagePath, contentType: upload.contentType }, job);
        if (!renewed?.sessionUri) throw new Error('Could not renew the upload session.');
        f.sessionUri = renewed.sessionUri; f.resume = false; f.progress = 0;
        await persist(job);
        await uploadResumable(job, f, blob, upload);
      }
    } else {
      await uploader.putSigned({ file: blob, upload, onProgress: (p) => { if (p !== f.progress) { f.progress = p; emit(); } } });
    }
    patchFile(job, f, { status: 'done', progress: 100, resume: false }, true);
  }

  async function runJob(job) {
    try {
      if (!job.folder) {
        await setStage(job, 'session');
        const data = await reqRetry(MEDIA('create-upload-session'), {
          folderMode: job.folderMode, folderName: job.folderName, orientation: 'auto', resumable: true,
          files: job.files.map((f) => ({ name: f.name, type: f.type, size: f.size, withPoster: String(f.type || '').startsWith('video/') })),
        }, job);
        const uploads = Array.isArray(data?.session?.uploads) ? data.session.uploads : [];
        if (uploads.length !== job.files.length) throw new Error('Upload session did not return a URL for every file.');
        job.files.forEach((f, i) => { f.upload = uploads[i]; f.storagePath = uploads[i].storagePath; f.sessionUri = uploads[i].resumable?.sessionUri || null; });
        job.folder = data.session.folder;
      }
      {
        await setStage(job, 'uploading');
        for (const f of job.files) {
          if (job.cancelled) return;
          if (f.status === 'done' || f.status === 'needs-repick') continue;
          try { await uploadOneFile(job, f); } catch (err) {
            if (job.cancelled) return;
            patchFile(job, f, { status: 'error', error: err.message || 'Upload failed.' }, true);
          }
        }
        if (job.files.some((f) => f.status !== 'done')) {
          const bad = job.files.find((f) => f.status === 'needs-repick') || job.files.find((f) => f.status === 'error');
          await setStage(job, 'error', { error: bad?.error || 'Some files did not upload.' });
          return;
        }
        await setStage(job, 'completing');
        const rows = job.files.map((f) => ({ fullPath: f.upload.storagePath, name: f.upload.safeName, size: f.upload.size, contentType: f.upload.contentType, kind: f.upload.kind, posterPath: f.posterPath || null }));
        job.rows = rows;
        await reqRetry(MEDIA('complete-upload'), { folder: job.folder, files: rows }, job);
        await setStage(job, 'ingesting');
      }
      const result = await reqRetry(QUOTE_TARGETS, { action: 'ingest-uploads', bucketId: job.bucketId, folder: job.folder, files: toIngestFiles(job.rows) }, job);
      job.result = result;
      job.summary = summarizeIngest(result, job.bucketName);
      await setStage(job, 'done', { error: '' });
      cleanupStorage(job);
      finishListeners.forEach((l) => { try { l(snapshotJob(job.id)); } catch { /* listener error */ } });
    } catch (err) {
      if (!job.cancelled) await setStage(job, 'error', { error: err.message || 'Upload failed.' });
    }
  }

  const snapshotJob = (id) => snapshot.find((j) => j.id === id);
  function cleanupStorage(job) {
    for (const k of [...blobs.keys()]) if (k.startsWith(`${job.id}::`)) blobs.delete(k);
    store.deleteBlobsForJob(job.id).catch(() => {});
    store.deleteJob(job.id).catch(() => {});
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      let job;
      while ((job = jobs.find((j) => j.stage === 'queued' && !j.cancelled))) await runJob(job);
    } finally { pumping = false; }
  }

  return {
    subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
    getSnapshot() { return snapshot; },
    onJobDone(l) { finishListeners.add(l); return () => finishListeners.delete(l); },
    configure({ request: r, ownerId: o } = {}) { if (r) request = r; if (o !== undefined) ownerId = o; },
    isActive() { return jobs.some((j) => ACTIVE.has(j.stage)); },

    // { clientId, bucketId, bucketName, folderMode, folderName, files: File[] } -> job id
    enqueue({ clientId = null, bucketId, bucketName, folderMode, folderName, files }) {
      const id = `up-${Date.now().toString(36)}-${(seq += 1)}`;
      const job = {
        id, ownerId, clientId, bucketId, bucketName, folderMode, folderName, folder: '', stage: 'queued', error: '', result: null, summary: '', createdAt: Date.now(),
        files: Array.from(files).map((file, i) => ({ key: `f${i}`, name: file.name, size: file.size, type: file.type, status: 'queued', progress: 0, storagePath: '', posterPath: null, sessionUri: null, error: '', upload: null, resume: false })),
      };
      Array.from(files).forEach((file, i) => blobs.set(blobKey(id, `f${i}`, 'file'), file));
      jobs = [...jobs, job];
      emit();
      persist(job);
      Array.from(files).forEach((file, i) => store.putBlob(blobKey(id, `f${i}`, 'file'), file).catch(() => {}));
      pump();
      return id;
    },

    // Restore unfinished jobs from IndexedDB (call once auth is ready).
    async resumeAll() {
      let saved = [];
      try { saved = await store.listJobs(); } catch { saved = []; }
      const known = new Set(jobs.map((j) => j.id));
      for (const j of saved) {
        if (known.has(j.id) || (j.ownerId && ownerId && j.ownerId !== ownerId) || j.stage === 'done') continue;
        const job = { ...j, cancelled: false, files: j.files.map((f) => ({ ...f, resume: Boolean(f.sessionUri) && f.status !== 'done' })) };
        job.files.forEach((f) => { if (f.status === 'uploading') f.status = 'queued'; });
        if (job.stage !== 'error') job.stage = 'queued'; // error jobs stay visible until Retry
        jobs.push(job);
      }
      emit();
      pump();
    },

    retry(jobId) {
      const job = jobs.find((j) => j.id === jobId);
      if (!job || ACTIVE.has(job.stage)) return;
      job.files.forEach((f) => { if (f.status === 'error') Object.assign(f, { status: 'queued', error: '', resume: Boolean(f.sessionUri) }); });
      Object.assign(job, { stage: 'queued', error: '' });
      emit(); persist(job);
      pump();
    },

    // Give a needs-repick file its bytes back (must match name + size).
    async repick(jobId, fileKey, file) {
      const job = jobs.find((j) => j.id === jobId);
      const f = job?.files.find((x) => x.key === fileKey);
      if (!f || !file || file.name !== f.name || file.size !== f.size) return false;
      blobs.set(blobKey(job.id, f.key, 'file'), file);
      store.putBlob(blobKey(job.id, f.key, 'file'), file).catch(() => {});
      Object.assign(f, { status: 'queued', error: '', resume: Boolean(f.sessionUri) });
      if (!job.files.some((x) => x.status === 'needs-repick')) { job.stage = 'queued'; job.error = ''; }
      emit(); persist(job); pump();
      return true;
    },

    dismiss(jobId) {
      const job = jobs.find((j) => j.id === jobId);
      if (!job) return;
      job.cancelled = true;
      jobs = jobs.filter((j) => j.id !== jobId);
      for (const k of [...blobs.keys()]) if (k.startsWith(`${jobId}::`)) blobs.delete(k);
      store.deleteBlobsForJob(jobId).catch(() => {});
      store.deleteJob(jobId).catch(() => {});
      emit();
    },
  };
}

export const uploadManager = createUploadManager();
