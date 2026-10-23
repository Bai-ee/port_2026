// Tiny IndexedDB wrapper for the background upload manager: job metadata +
// the file / poster Blobs, kept until a job finishes so a refresh can resume.
// Every call swallows errors (private mode, Safari eviction, quota) and the
// manager keeps working in memory; reads resolve null / [] when unavailable.
const DB_NAME = 'hitloop-uploads';
const DB_VERSION = 1;
const JOBS = 'jobs';
const BLOBS = 'blobs';

function openDb(idb) {
  return new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(JOBS)) db.createObjectStore(JOBS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
    req.onblocked = () => reject(new Error('indexedDB blocked'));
  });
}

export function blobKey(jobId, fileKey, kind) {
  return `${jobId}::${fileKey}::${kind}`;
}

export function createIdbUploadStore(idb = typeof indexedDB !== 'undefined' ? indexedDB : null) {
  let dbPromise = null;
  const db = () => {
    if (!idb) return Promise.resolve(null);
    if (!dbPromise) dbPromise = openDb(idb).catch(() => null);
    return dbPromise;
  };
  const run = async (storeName, mode, fn, fallback) => {
    try {
      const d = await db();
      if (!d) return fallback;
      return await new Promise((resolve, reject) => {
        const tx = d.transaction(storeName, mode);
        const out = fn(tx.objectStore(storeName));
        tx.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('indexedDB aborted'));
      });
    } catch {
      return fallback;
    }
  };
  return {
    putJob: (job) => run(JOBS, 'readwrite', (s) => s.put(job), undefined),
    deleteJob: (id) => run(JOBS, 'readwrite', (s) => s.delete(id), undefined),
    listJobs: () => run(JOBS, 'readonly', (s) => s.getAll(), []).then((r) => (Array.isArray(r) ? r : [])),
    putBlob: (key, blob) => run(BLOBS, 'readwrite', (s) => s.put(blob, key), undefined),
    getBlob: (key) => run(BLOBS, 'readonly', (s) => s.get(key), null).then((r) => r || null),
    deleteBlobsForJob: (jobId) => run(BLOBS, 'readwrite', (s) => s.delete(IDBKeyRange.bound(`${jobId}::`, `${jobId}::￿`)), undefined),
  };
}
