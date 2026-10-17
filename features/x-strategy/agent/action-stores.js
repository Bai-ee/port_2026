// action-stores.js - audit log, autonomy setting and doc access for action-runtime.js.
// Firestore: agent_actions/{clientId}/log/{id}; client_configs/{clientId}.agentAutonomy; docs by path (snapshot/undo).
// Memory: same interfaces, for tests.

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export function createMemoryActionStores() {
  const logs = new Map(); // clientId -> Map(id -> row)
  const autonomy = new Map();
  const files = new Map(); // path -> data
  const rowsOf = (c) => (logs.get(c) || logs.set(c, new Map()).get(c));
  return {
    files,
    audit: {
      async append(clientId, id, row) { rowsOf(clientId).set(id, { ...clone(row), id }); },
      async get(clientId, id) { const r = rowsOf(clientId).get(id); return r ? clone(r) : null; },
      async update(clientId, id, patch) { const r = rowsOf(clientId).get(id); if (r) Object.assign(r, clone(patch)); },
      async recent(clientId, n) { return [...rowsOf(clientId).values()].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, n).map(clone); },
    },
    autonomy: { async get(c) { return autonomy.get(c) ?? null; }, async save(c, v) { autonomy.set(c, clone(v)); } },
    docs: {
      async get(path) { return files.has(path) ? clone(files.get(path)) : null; },
      async put(path, data) { files.set(path, clone(data)); },
      async remove(path) { files.delete(path); },
    },
  };
}

export function createFirestoreActionStores(db) {
  const logCol = (clientId) => db.collection('agent_actions').doc(clientId).collection('log');
  const docRef = (path) => { const [col, ...rest] = path.split('/'); return db.collection(col).doc(rest.join('/')); };
  return {
    audit: {
      async append(clientId, id, row) { await logCol(clientId).doc(id).set(clone(row)); },
      async get(clientId, id) { const s = await logCol(clientId).doc(id).get(); return s.exists ? { ...s.data(), id: s.id } : null; },
      async update(clientId, id, patch) { await logCol(clientId).doc(id).set(clone(patch), { merge: true }); },
      async recent(clientId, n) { const s = await logCol(clientId).orderBy('at', 'desc').limit(n).get(); return s.docs.map((d) => ({ ...d.data(), id: d.id })); },
    },
    autonomy: {
      async get(clientId) { const s = await db.collection('client_configs').doc(clientId).get(); return s.exists ? (s.data()?.agentAutonomy ?? null) : null; },
      async save(clientId, v) { await db.collection('client_configs').doc(clientId).set({ agentAutonomy: clone(v) }, { merge: true }); },
    },
    docs: {
      async get(path) { const s = await docRef(path).get(); return s.exists ? s.data() : null; },
      async put(path, data) { await docRef(path).set(clone(data)); },
      async remove(path) { await docRef(path).delete(); },
    },
  };
}
