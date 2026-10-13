// Minimal in-memory Firestore double: collection/doc/where(==)/orderBy/limit/startAfter/get/count/listCollections.
// Paths are flat strings; a document at "a/b" is a doc, "a" a collection.

export function createFakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed)); // path -> data
  const colOf = (path) => path.split('/').slice(0, -1).join('/');
  const idOf = (path) => path.split('/').at(-1);
  const snap = (path) => ({ id: idOf(path), exists: docs.has(path), data: () => (docs.has(path) ? structuredClone(docs.get(path)) : undefined), ref: docRef(path) });

  function docRef(path) {
    return {
      path,
      get: async () => snap(path),
      set: async (d) => { docs.set(path, structuredClone(d)); },
      listCollections: async () => {
        const names = new Set();
        for (const k of docs.keys()) if (k.startsWith(`${path}/`)) names.add(k.slice(path.length + 1).split('/')[0]);
        return [...names].map((id) => ({ id }));
      },
    };
  }

  function query(colPath, state = { where: [], order: null, limit: Infinity, after: null }) {
    const run = () => {
      let rows = [...docs.keys()].filter((k) => colOf(k) === colPath).map(snap);
      for (const [f, v] of state.where) rows = rows.filter((r) => f.split('.').reduce((o, p) => o?.[p], r.data()) === v);
      if (state.order) {
        const [f, dir] = state.order;
        rows.sort((a, b) => { const x = a.data()[f]; const y = b.data()[f]; return (x > y ? 1 : x < y ? -1 : 0) * (dir === 'desc' ? -1 : 1); });
      }
      if (state.after) { const i = rows.findIndex((r) => r.id === state.after.id); rows = rows.slice(i + 1); }
      return rows.slice(0, state.limit);
    };
    return {
      where: (f, op, v) => { if (op !== '==') throw new Error('only =='); return query(colPath, { ...state, where: [...state.where, [f, v]] }); },
      orderBy: (f, dir = 'asc') => query(colPath, { ...state, order: [f, dir] }),
      limit: (n) => query(colPath, { ...state, limit: n }),
      startAfter: (s) => query(colPath, { ...state, after: s }),
      get: async () => { const rows = run(); return { docs: rows, size: rows.length, empty: !rows.length }; },
      count: () => ({ get: async () => ({ data: () => ({ count: run().length }) }) }),
      doc: (id) => docRef(`${colPath}/${id}`),
      add: async (d) => { const id = `auto${docs.size}`; docs.set(`${colPath}/${id}`, structuredClone(d)); return { id }; },
    };
  }

  return {
    _docs: docs,
    collection: (name) => query(name),
    doc: (path) => docRef(path),
    listCollections: async () => [...new Set([...docs.keys()].map((k) => k.split('/')[0]))].map((id) => ({ id })),
  };
}
