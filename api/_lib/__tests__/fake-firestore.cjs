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
    this._filters = []; this._limit = Infinity; this._order = null;
  }
  where(field, op, value) {
    if (op !== '==') throw new Error(`fake-firestore only supports '==' (got ${op})`);
    this._filters.push({ field, value }); return this;
  }
  orderBy(field, dir = 'asc') { this._order = { field, dir }; return this; }
  limit(n) { this._limit = n; return this; }
  _rows() {
    const map = this._store.get(this._collection) || new Map();
    let rows = [...map.entries()].map(([id, data]) => ({ id, data }));
    rows = rows.filter(({ data }) => this._filters.every((f) => data?.[f.field] === f.value));
    if (this._order) {
      const { field, dir } = this._order;
      const ms = (d) => (d?.[field]?.toMillis ? d[field].toMillis() : Date.parse(d?.[field] || 0) || 0);
      rows.sort((a, b) => (dir === 'desc' ? ms(b.data) - ms(a.data) : ms(a.data) - ms(b.data)));
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
  constructor() { this._store = new Map(); }
  collection(name) { return new Collection(this._store, name); }
  async runTransaction(fn) {
    // Sequential, no isolation — adequate for single-worker queue tests.
    const tx = {
      get: (refOrQuery) => (refOrQuery instanceof DocRef
        ? refOrQuery.get()
        : refOrQuery.get()),
      set: (ref, data, opts = {}) => { ref.set(data, opts); },
    };
    return fn(tx);
  }
  // test helpers
  _raw(collection, id) { return this._store.get(collection)?.get(id); }
  _patch(collection, id, partial) {
    const map = this._store.get(collection);
    map.set(id, { ...map.get(id), ...partial });
  }
}

function makeFakeContext() {
  return { adminDb: new FakeDb(), FieldValue };
}

module.exports = { makeFakeContext, timestamp, FieldValue };
