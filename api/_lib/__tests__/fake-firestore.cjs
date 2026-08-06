// fake-firestore.cjs — minimal in-memory Firestore for unit-testing the media
// job queue without a live project. Supports only the subset media-jobs.cjs
// uses: doc set/get (merge), single equality where(), limit, orderBy(desc),
// runTransaction (sequential, no isolation), and FieldValue sentinels.

let _clock = 1_700_000_000_000; // fixed base so createdAtTs ordering is stable
function nextClockMs() { _clock += 1; return _clock; }

function timestamp(ms) {
  return { __ts: true, _ms: ms, toMillis() { return ms; } };
}

const FieldValue = {
  serverTimestamp() { return { __sentinel: 'serverTimestamp' }; },
  increment(by) { return { __sentinel: 'increment', by }; },
};

function resolveValue(value, prevValue) {
  if (value && value.__sentinel === 'serverTimestamp') return timestamp(nextClockMs());
  if (value && value.__sentinel === 'increment') return Number(prevValue || 0) + Number(value.by || 0);
  return value;
}

function applyWrite(prev, incoming, merge) {
  const base = merge ? { ...(prev || {}) } : {};
  for (const [k, v] of Object.entries(incoming)) {
    base[k] = resolveValue(v, base[k]);
  }
  return base;
}

class DocRef {
  constructor(store, collection, id) {
    this._store = store; this._collection = collection; this.id = id;
  }
  get _map() {
    if (!this._store.has(this._collection)) this._store.set(this._collection, new Map());
    return this._store.get(this._collection);
  }
  async set(data, opts = {}) {
    const prev = this._map.get(this.id);
    this._map.set(this.id, applyWrite(prev, data, !!opts.merge));
  }
  async get() { return snapshot(this, this._map.get(this.id)); }
  async delete() { this._map.delete(this.id); }
}

function snapshot(ref, data) {
  return {
    id: ref.id,
    ref,
    exists: data !== undefined,
    data() { return data; },
  };
}

class Query {
  constructor(store, collection) {
    this._store = store; this._collection = collection;
    this._filters = []; this._limit = Infinity; this._order = null; this._startAfterId = null;
  }
  where(field, op, value) {
    if (op !== '==') throw new Error(`fake-firestore only supports '==' (got ${op})`);
    this._filters.push({ field, value }); return this;
  }
  orderBy(field, dir = 'asc') { this._order = { field, dir }; return this; }
  limit(n) { this._limit = n; return this; }
  // Cursor continuation (added for the proof-render-jobs.cjs pagination
  // fix, P2-1) — mirrors real Firestore's own documented behavior: a
  // DocumentSnapshot passed to startAfter() with NO explicit orderBy()
  // paginates using the query's default implicit order (by document
  // ID/__name__, ascending) — exactly the no-new-composite-index shape
  // listDoneJobsWithArtifacts relies on. Also accepts a bare id string
  // directly, for callers that don't have a full snapshot handy.
  startAfter(cursor) {
    this._startAfterId = cursor && typeof cursor === 'object' && 'id' in cursor ? cursor.id : cursor;
    return this;
  }
  _rows() {
    const map = this._store.get(this._collection) || new Map();
    let rows = [...map.entries()].map(([id, data]) => ({ id, data }));
    rows = rows.filter(({ data }) => this._filters.every((f) => data?.[f.field] === f.value));
    if (this._order) {
      const { field, dir } = this._order;
      const ms = (d) => (d?.[field]?.toMillis ? d[field].toMillis() : Date.parse(d?.[field] || 0) || 0);
      rows.sort((a, b) => (dir === 'desc' ? ms(b.data) - ms(a.data) : ms(a.data) - ms(b.data)));
    } else {
      // Firestore's own implicit default order when no orderBy() is given:
      // ascending by document ID (__name__) — needed so startAfter() below
      // has a stable, deterministic order to continue from.
      rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }
    if (this._startAfterId != null) {
      const idx = rows.findIndex((r) => r.id === this._startAfterId);
      rows = idx === -1 ? [] : rows.slice(idx + 1);
    }
    return rows.slice(0, this._limit);
  }
  async get() {
    return {
      docs: this._rows().map(({ id, data }) => snapshot(new DocRef(this._store, this._collection, id), data)),
    };
  }
}

class Collection extends Query {
  doc(id) { return new DocRef(this._store, this._collection, id); }
}

class FakeDb {
  constructor() { this._store = new Map(); this._txChain = Promise.resolve(); }
  collection(name) { return new Collection(this._store, name); }
  async runTransaction(fn) {
    const tx = {
      get: (refOrQuery) => (refOrQuery instanceof DocRef
        ? refOrQuery.get()
        : refOrQuery.get()),
      set: (ref, data, opts = {}) => { ref.set(data, opts); },
    };
    // Fully serialized: each transaction body (including its own internal
    // awaits) settles before the next one starts, so every transaction
    // observes all prior transactions' committed writes. Real Firestore
    // gives the equivalent guarantee via optimistic-concurrency retries at
    // commit time; full serialization is a stronger, deterministic
    // stand-in — needed so version-check logic implemented inside
    // runTransaction (studio-templates.cjs updateTemplate) is testable
    // deterministically under a concurrent Promise.all, not just sequential
    // awaits.
    const result = this._txChain.then(() => fn(tx), () => fn(tx));
    this._txChain = result.then(() => undefined, () => undefined);
    return result;
  }
  // test helpers
  _raw(collection, id) { return this._store.get(collection)?.get(id); }
  _patch(collection, id, partial) {
    const map = this._store.get(collection);
    map.set(id, { ...map.get(id), ...partial });
  }
}

// ── Minimal in-memory Storage bucket (Phase 1, Final Render artifacts) ─────
// Supports only what api/_lib/proof-render-artifacts.cjs uses:
// file(path).save(buffer, {contentType}), .getSignedUrl({action, expires})
// (returns [url], matching the real @google-cloud/storage return shape),
// and .delete({ignoreNotFound}). Objects are kept in a plain Map keyed by
// storage path — good enough to assert "was this path written/deleted",
// not a byte-for-byte GCS emulator.
class FakeStorageFile {
  constructor(bucket, path) { this._bucket = bucket; this._path = path; }
  async save(buffer, opts = {}) {
    this._bucket._store.set(this._path, { buffer, contentType: opts.contentType || null });
  }
  async getSignedUrl({ action = 'read', expires } = {}) {
    return [`https://fake-storage.local/${this._bucket._name}/${this._path}?action=${action}&expires=${expires}`];
  }
  async delete(opts = {}) {
    const existed = this._bucket._store.has(this._path);
    this._bucket._store.delete(this._path);
    if (!existed && !opts.ignoreNotFound) {
      const err = new Error(`fake-storage: no such object: ${this._path}`);
      err.code = 404;
      throw err;
    }
  }
  // Mirrors real @google-cloud/storage File#exists / File#download tuple
  // shapes — added for studio-screen-stills.cjs (Slice F2 pinned stills).
  async exists() {
    return [this._bucket._store.has(this._path)];
  }
  async download() {
    const entry = this._bucket._store.get(this._path);
    if (!entry) {
      const err = new Error(`fake-storage: no such object: ${this._path}`);
      err.code = 404;
      throw err;
    }
    return [entry.buffer];
  }
}

class FakeStorageBucket {
  constructor(name = 'fake-bucket') { this._name = name; this._store = new Map(); }
  file(path) { return new FakeStorageFile(this, path); }
  // Mirrors the real @google-cloud/storage bucket.getFiles({prefix,
  // maxResults}) shape (a [files] tuple, each file exposing `.name`) —
  // added for the P2-2 orphan-reclaim sweep, which needs to list Storage
  // objects that no job record references. Deliberately simple (no
  // pagination token support — this fake never has enough objects in a
  // test to need it).
  async getFiles({ prefix, maxResults } = {}) {
    let names = [...this._store.keys()];
    if (prefix) names = names.filter((n) => n.startsWith(prefix));
    names.sort();
    if (Number.isFinite(maxResults)) names = names.slice(0, maxResults);
    return [names.map((name) => ({ name }))];
  }
  // test helper — direct read without going through getSignedUrl/a real fetch
  _raw(path) { return this._store.get(path); }
}

function makeFakeContext() {
  const bucket = new FakeStorageBucket();
  return { adminDb: new FakeDb(), FieldValue, adminStorage: { bucket: () => bucket } };
}

module.exports = { makeFakeContext, timestamp, FieldValue };
