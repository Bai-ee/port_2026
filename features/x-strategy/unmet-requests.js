// unmet-requests.js - "requests the agent could not do", logged so the owner can review what to build next.
// The agent logs one whenever it answers "needs code: ..." or "needs you: ..."; the same request (normalized text)
// within a client is counted, not duplicated. Stored at agent_unmet_requests/{clientId}/items/{id}.
import { createHash } from 'node:crypto';

export const UNMET_KINDS = Object.freeze(['needs-code', 'needs-you']);
export const UNMET_STATUSES = Object.freeze(['open', 'planned', 'done', 'wont-do']);
const MAX = { request: 300, missing: 400 };

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export const unmetKeyOf = (request) => createHash('sha1').update(clip(request, MAX.request).toLowerCase()).digest('hex').slice(0, 20);

/** @returns {{ok:true, entry:object} | {ok:false, error:string}} */
export function normalizeUnmet({ request, missing, kind } = {}) {
  const r = clip(request, MAX.request);
  if (!r) return { ok: false, error: 'request is required (what the owner asked for)' };
  const k = UNMET_KINDS.includes(kind) ? kind : 'needs-code';
  return { ok: true, entry: { request: r, missing: clip(missing, MAX.missing), kind: k } };
}

export function createFirestoreUnmetStore(db, { FieldValue } = {}) {
  const col = (clientId) => db.collection('agent_unmet_requests').doc(clientId).collection('items');
  return {
    async log(clientId, entry, { now, by, threadId } = {}) {
      const ref = col(clientId).doc(unmetKeyOf(entry.request));
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const prev = snap.exists ? snap.data() : null;
        const doc = {
          ...entry, status: prev?.status ?? 'open', count: (prev?.count ?? 0) + 1,
          firstAt: prev?.firstAt ?? now, lastAt: now, by: by ?? prev?.by ?? null, threadId: threadId ?? prev?.threadId ?? null,
        };
        tx.set(ref, doc);
        return { id: ref.id, ...doc };
      });
    },
    async list(clientId, { status, limit = 50 } = {}) {
      const snap = await col(clientId).orderBy('lastAt', 'desc').limit(200).get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => !status || r.status === status).slice(0, limit);
    },
    async setStatus(clientId, id, status, { now } = {}) {
      if (!UNMET_STATUSES.includes(status)) throw new Error('bad status');
      await col(clientId).doc(id).set({ status, statusAt: now }, { merge: true });
      return true;
    },
  };
}

export function createMemoryUnmetStore() {
  const rows = new Map();
  const k = (c, id) => `${c}/${id}`;
  return {
    async log(clientId, entry, { now, by, threadId } = {}) {
      const id = unmetKeyOf(entry.request);
      const prev = rows.get(k(clientId, id));
      const doc = { ...entry, status: prev?.status ?? 'open', count: (prev?.count ?? 0) + 1, firstAt: prev?.firstAt ?? now, lastAt: now, by: by ?? prev?.by ?? null, threadId: threadId ?? prev?.threadId ?? null };
      rows.set(k(clientId, id), doc);
      return { id, ...doc };
    },
    async list(clientId, { status, limit = 50 } = {}) {
      return [...rows.entries()].filter(([key]) => key.startsWith(`${clientId}/`)).map(([key, v]) => ({ id: key.split('/')[1], ...v }))
        .sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt))).filter((r) => !status || r.status === status).slice(0, limit);
    },
    async setStatus(clientId, id, status) {
      if (!UNMET_STATUSES.includes(status)) throw new Error('bad status');
      const prev = rows.get(k(clientId, id)); if (!prev) return false;
      rows.set(k(clientId, id), { ...prev, status }); return true;
    },
  };
}
