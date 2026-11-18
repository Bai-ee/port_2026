// stores.js - persistence for MCP-OPS: run records, the settings change log and a short-lease per-client lock.
// Pure interfaces with a memory implementation (tests) and a Firestore one. No import-time I/O.
//   mcp_ops_runs/{runId}        one row per run_refresh that actually started
//   mcp_settings_log/{changeId} one row per applied set_setting
//   mcp_ops_locks/{key}         lease doc (settings mutex + one active paid run per client+refresh). Holds no secrets.
//   mcp_ops_previews/{sha256}   single-use paid-run preview tokens: the doc id is the HASH of the token id (the token
//                               itself is never stored); .create() makes consumption atomic (a second create fails).

import { randomUUID } from 'node:crypto';

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const newId = (prefix) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

function memoryCollection() {
  const m = new Map();
  return {
    create: async (id, data) => { if (m.has(id)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 }); m.set(id, structuredClone(data)); },
    get: async (id) => (m.has(id) ? structuredClone(m.get(id)) : null),
    update: async (id, patch) => { if (!m.has(id)) throw new Error('missing'); m.set(id, { ...m.get(id), ...structuredClone(patch) }); },
    _raw: m,
  };
}

export function createMemoryOpsStores() {
  const locks = new Map();
  return {
    runs: memoryCollection(),
    changes: memoryCollection(),
    previews: memoryCollection(),
    locks: {
      acquire: async (key, { now, leaseMs }) => {
        const cur = locks.get(key);
        if (cur && cur.expiresAt > now) return null;
        const holder = randomUUID();
        locks.set(key, { holder, expiresAt: now + leaseMs });
        return holder;
      },
      release: async (key, holder) => { if (locks.get(key)?.holder === holder) locks.delete(key); },
      _raw: locks,
    },
  };
}

function firestoreCollection(db, name) {
  const ref = (id) => {
    if (!ID_RE.test(String(id))) throw new Error('bad id');
    return db.collection(name).doc(String(id));
  };
  return {
    create: async (id, data) => { await ref(id).create(data); }, // create-only: throws ALREADY_EXISTS on a reused id
    get: async (id) => { if (!ID_RE.test(String(id))) return null; const s = await ref(id).get(); return s.exists ? s.data() : null; },
    update: async (id, patch) => { await ref(id).set(patch, { merge: true }); },
  };
}

export function createFirestoreOpsStores(db) {
  return {
    runs: firestoreCollection(db, 'mcp_ops_runs'),
    changes: firestoreCollection(db, 'mcp_settings_log'),
    previews: firestoreCollection(db, 'mcp_ops_previews'),
    locks: {
      acquire: (key, { now, leaseMs }) => db.runTransaction(async (tx) => {
        const r = db.collection('mcp_ops_locks').doc(String(key));
        const s = await tx.get(r);
        if (s.exists && (s.data()?.expiresAt || 0) > now) return null;
        const holder = randomUUID();
        tx.set(r, { holder, expiresAt: now + leaseMs });
        return holder;
      }),
      release: (key, holder) => db.runTransaction(async (tx) => {
        const r = db.collection('mcp_ops_locks').doc(String(key));
        const s = await tx.get(r);
        if (s.exists && s.data()?.holder === holder) tx.delete(r);
      }),
    },
  };
}
