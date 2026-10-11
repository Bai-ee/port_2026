// In-memory Firestore fake for social-archive tests. Supports exactly what the contract allows:
// collection().doc().get/set(merge)/delete, where('f','==',v) chains, limit, get, batch().set/delete/commit.
// Anything else (range ops, arrayUnion, orderBy) throws so a module cannot silently depend on it.
export function makeDb() {
  const cols = new Map();
  const writes = []; // every mutation: { op, col, id }
  const col = (n) => { if (!cols.has(n)) cols.set(n, new Map()); return cols.get(n); };
  const FieldValue = {
    arrayUnion: () => { throw new Error('arrayUnion is not allowed by the contract'); },
    serverTimestamp: () => ({ __ts: true }),
  };
  const docRef = (n, id) => ({
    id,
    async get() { const d = cols.get(n)?.get(id); return { id, exists: d !== undefined, data: () => (d ? structuredClone(d) : undefined) }; },
    async set(data, o) {
      writes.push({ op: 'set', col: n, id });
      col(n).set(id, o?.merge ? { ...(col(n).get(id) || {}), ...structuredClone(data) } : structuredClone(data));
    },
    async delete() { writes.push({ op: 'delete', col: n, id }); col(n).delete(id); },
  });
  const query = (n, spec = {}) => ({
    where: (f, op, v) => {
      if (op !== '==') throw new Error(`unsupported where op ${op} (equality only)`);
      return query(n, { ...spec, wheres: [...(spec.wheres || []), [f, v]] });
    },
    limit: (l) => query(n, { ...spec, lim: l }),
    orderBy: () => { throw new Error('orderBy is not allowed by the contract'); },
    async get() {
      let rows = [...(cols.get(n) || new Map()).entries()].map(([id, data]) => ({ id, data }));
      for (const [f, v] of spec.wheres || []) rows = rows.filter((r) => r.data[f] === v);
      if (spec.lim) rows = rows.slice(0, spec.lim);
      return { size: rows.length, empty: !rows.length, docs: rows.map((r) => ({ id: r.id, exists: true, data: () => structuredClone(r.data) })) };
    },
  });
  const db = {
    FieldValue, cols, writes,
    collection: (n) => ({ doc: (id) => docRef(n, id), ...query(n) }),
    batches: [],
    batch() {
      const ops = [];
      const b = {
        set: (ref, d, o) => { ops.push(() => ref.set(d, o)); return b; },
        delete: (ref) => { ops.push(() => ref.delete()); return b; },
        commit: async () => { db.batches.push(ops.length); for (const op of ops) await op(); },
      };
      return b;
    },
  };
  return db;
}
