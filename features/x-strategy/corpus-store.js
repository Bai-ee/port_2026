// Server-only I/O for the chunked corpus rows store (master plan §5).
//   x_corpora/{handle}/rows/{0..n}   each {rows: Row[<=250]}
//   x_corpora/{handle}.rowsMeta      merged onto the doc, never overwriting other fields (stats, watchlistSeed, ...)
// Writes touch ONLY those two locations. `db` is injected (firebase-admin Firestore shape); no Firestore access at import.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chunkRows, unchunkRows, buildRowsMeta, mergeRowsById } from './corpus-rows.js';

const ROOT = 'x_corpora';
const ROWS = 'rows';
const MAX_BATCH_OPS = 400;
const HANDLE_RE = /^[a-z0-9_]{1,15}$/;

const COMMITTED_FILES = Object.freeze({
  bai_ee: '../../docs/audits/bai-ee-x-corpus.json',
  seb__design: '../../docs/audits/seb-design-x-corpus.json',
});

export class CorpusStoreError extends Error {
  /** @param {'invalid-handle'|'firestore'|'committed'} code */
  constructor(code, message, cause) {
    super(message);
    this.name = 'CorpusStoreError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

export function normalizeHandle(handle) {
  const h = String(handle ?? '').trim().replace(/^@+/, '').toLowerCase();
  if (!HANDLE_RE.test(h)) throw new CorpusStoreError('invalid-handle', `Invalid X handle: ${JSON.stringify(String(handle ?? ''))}`);
  return h;
}

/** Default committed-corpus loader: handle -> rows[] or null when no committed file exists. */
export function defaultLoadCommitted(handle) {
  const rel = COMMITTED_FILES[handle];
  if (!rel) return null;
  try {
    const rows = JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
    return Array.isArray(rows) ? rows : null;
  } catch (e) {
    throw new CorpusStoreError('committed', `Could not read committed corpus for ${handle}: ${e.message}`, e);
  }
}

const sameRow = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function wrap(fn) {
  try { return await fn(); } catch (e) {
    if (e instanceof CorpusStoreError) throw e;
    throw new CorpusStoreError('firestore', `Corpus store I/O failed: ${e.message}`, e);
  }
}

/**
 * Shared logic over a backend:
 *   readChunks(handle) -> [{index, rows}]   readMeta(handle) -> object|null
 *   writeChunks(handle, chunks, meta)       replaces all chunks (deleting surplus) and merges rowsMeta
 *   writeMetaOnly(handle, meta)
 */
function createStore(backend, { loadCommitted = defaultLoadCommitted } = {}) {
  async function loadExisting(handle) {
    const chunks = (await wrap(() => backend.readChunks(handle))).slice().sort((a, b) => a.index - b.index);
    if (chunks.length) {
      const rows = unchunkRows(chunks.map((c) => c.rows));
      const stored = await wrap(() => backend.readMeta(handle));
      return { rows, meta: stored ?? buildRowsMeta(rows, { pulledAt: null, source: 'bird' }), source: 'firestore' };
    }
    const committed = await wrap(async () => loadCommitted(handle));
    if (Array.isArray(committed) && committed.length) {
      return { rows: committed, meta: buildRowsMeta(committed, { pulledAt: null, source: 'committed-json' }), source: 'committed-json' };
    }
    return { rows: [], meta: null, source: 'none' };
  }

  const viewsOf = (rows) => rows.filter((r) => r && r.views !== null && r.views !== undefined).length;

  return {
    async readRows(handle) {
      return loadExisting(normalizeHandle(handle));
    },

    async writeMergedRows(handle, incomingRows, { pulledAt, source = 'bird' } = {}) {
      const h = normalizeHandle(handle);
      const existing = await loadExisting(h);
      const incoming = Array.isArray(incomingRows) ? incomingRows : [];
      const before = existing.rows.length;
      const viewsBefore = viewsOf(existing.rows);
      if (!incoming.length) {
        return { before, after: before, added: 0, updated: 0, viewsBefore, viewsAfter: viewsBefore, wrote: false };
      }
      const merged = mergeRowsById(existing.rows, incoming);
      const prevById = new Map(existing.rows.map((r) => [String(r.id), r]));
      let added = 0;
      let updated = 0;
      for (const r of merged) {
        const prev = prevById.get(String(r.id));
        if (!prev) added += 1; else if (!sameRow(prev, r)) updated += 1;
      }
      const meta = buildRowsMeta(merged, { pulledAt, source });
      const unchanged = added === 0 && updated === 0 && existing.source === 'firestore';
      if (unchanged) await wrap(() => backend.writeMetaOnly(h, meta));
      else await wrap(() => backend.writeChunks(h, chunkRows(merged), meta));
      return { before, after: merged.length, added, updated, viewsBefore, viewsAfter: viewsOf(merged), wrote: !unchanged };
    },

    async seedFromCommitted(handle, { force = false } = {}) {
      const h = normalizeHandle(handle);
      if (!force) {
        const chunks = await wrap(() => backend.readChunks(h));
        if (chunks.length) return { seeded: false, reason: 'rows-exist', rowCount: unchunkRows(chunks.map((c) => c.rows)).length };
      }
      const committed = await wrap(async () => loadCommitted(h));
      if (!Array.isArray(committed) || !committed.length) return { seeded: false, reason: 'no-committed-file', rowCount: 0 };
      const meta = buildRowsMeta(committed, { pulledAt: null, source: 'committed-json' });
      await wrap(() => backend.writeChunks(h, chunkRows(committed), meta));
      return { seeded: true, rowCount: committed.length, meta };
    },
  };
}

// ---------------------------------------------------------------------------

/** @param {object} db firebase-admin Firestore (injected). */
export function createFirestoreCorpusStore(db, opts = {}) {
  const docRef = (h) => db.collection(ROOT).doc(h);
  const rowsCol = (h) => docRef(h).collection(ROWS);

  const backend = {
    async readChunks(h) {
      const snap = await rowsCol(h).get();
      const out = [];
      snap.forEach((d) => {
        const index = Number(d.id);
        const data = d.data() || {};
        if (Number.isInteger(index) && Array.isArray(data.rows)) out.push({ index, rows: data.rows });
      });
      return out;
    },
    async readMeta(h) {
      const snap = await docRef(h).get();
      return snap.exists ? (snap.data() || {}).rowsMeta ?? null : null;
    },
    async writeChunks(h, chunks, meta) {
      const ops = chunks.map((rows, i) => ({ type: 'set', ref: rowsCol(h).doc(String(i)), data: { rows } }));
      const existingSnap = await rowsCol(h).get();
      existingSnap.forEach((d) => {
        const i = Number(d.id);
        if (!Number.isInteger(i) || i >= chunks.length) ops.push({ type: 'delete', ref: d.ref ?? rowsCol(h).doc(d.id) });
      });
      for (let i = 0; i < ops.length; i += MAX_BATCH_OPS) {
        const batch = db.batch();
        for (const op of ops.slice(i, i + MAX_BATCH_OPS)) {
          if (op.type === 'set') batch.set(op.ref, op.data); else batch.delete(op.ref);
        }
        await batch.commit();
      }
      await docRef(h).set({ rowsMeta: meta }, { merge: true });
    },
    async writeMetaOnly(h, meta) {
      await docRef(h).set({ rowsMeta: meta }, { merge: true });
    },
  };
  return createStore(backend, opts);
}

/**
 * In-memory store, same interface. `docs` models x_corpora/{handle} fields (so tests can prove
 * rowsMeta writes do not clobber siblings); `chunks` models the rows subcollection.
 */
export function createMemoryCorpusStore(opts = {}) {
  const docs = new Map();   // handle -> fields object
  const chunks = new Map(); // handle -> Map(index -> rows)
  const backend = {
    async readChunks(h) {
      return [...(chunks.get(h) ?? new Map()).entries()].map(([index, rows]) => ({ index, rows: rows.map((r) => ({ ...r })) }));
    },
    async readMeta(h) {
      return docs.get(h)?.rowsMeta ?? null;
    },
    async writeChunks(h, next, meta) {
      chunks.set(h, new Map(next.map((rows, i) => [i, rows.map((r) => ({ ...r }))])));
      docs.set(h, { ...(docs.get(h) ?? {}), rowsMeta: meta });
    },
    async writeMetaOnly(h, meta) {
      docs.set(h, { ...(docs.get(h) ?? {}), rowsMeta: meta });
    },
  };
  const store = createStore(backend, opts);
  store._docs = docs;
  store._chunks = chunks;
  return store;
}
