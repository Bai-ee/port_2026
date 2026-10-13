// strategy-doc-store.js - persistence for x_strategy_docs/{clientId}. I/O injected (`db` = firebase-admin
// Firestore); pure logic in strategy-doc.js. Same contract as plan-store.js: version-checked transactions, an
// absent doc is never auto-created by a read (get() returns null; callers show the seeded draft).

import { applyDocEdit, revertDoc, withLastReview } from './strategy-doc.js';
import { STRATEGY_COLLECTIONS } from './contracts.js';

export class StrategyDocError extends Error {
  /** @param {'version-conflict'|'invalid'|'not-found'|'version-unavailable'} code */
  constructor(code, message, extra = {}) {
    super(message || code);
    this.name = 'StrategyDocError';
    this.code = code;
    this.status = code === 'version-conflict' ? 409 : code === 'not-found' ? 404 : 400;
    Object.assign(this, extra);
  }
}

function checkClientId(clientId) {
  if (typeof clientId !== 'string' || !clientId.trim() || clientId.includes('/')) throw new StrategyDocError('invalid', 'clientId is required');
  return clientId.trim();
}

function resolve(result, current) {
  if (result && result.error) {
    if (result.error === 'noop') return { doc: current, changed: false };
    if (result.error === 'version-conflict') throw new StrategyDocError('version-conflict', 'the strategy document was changed elsewhere', { currentVersion: result.currentVersion });
    if (result.error === 'version-unavailable') throw new StrategyDocError('version-unavailable', 'that version is no longer in history');
    throw new StrategyDocError('invalid', result.errors?.join('; ') || result.error, { errors: result.errors ?? [] });
  }
  return { doc: result, changed: true };
}

function makeStore(runTransaction) {
  return {
    /** req: applyDocEdit request ({sections, by, source, reason?, proposalId?, expectedVersion, now?, base?}). */
    async apply(clientId, request) {
      const id = checkClientId(clientId);
      return runTransaction(id, (current) => resolve(applyDocEdit(current, request), current));
    },
    async revert(clientId, version, opts = {}) {
      const id = checkClientId(clientId);
      return runTransaction(id, (current) => {
        if (!current) throw new StrategyDocError('not-found', 'no strategy document exists for this client');
        return resolve(revertDoc(current, version, opts), current);
      });
    },
    /** Stamp lastReview on an existing doc; a missing doc is left missing (a draft has nothing to stamp). */
    async markReviewed(clientId, review) {
      const id = checkClientId(clientId);
      return runTransaction(id, (current) => (current ? { doc: withLastReview(current, review), changed: true } : { doc: null, changed: false }));
    },
  };
}

/** @param {object} db firebase-admin Firestore */
export function createFirestoreStrategyDocStore(db) {
  const ref = (id) => db.collection(STRATEGY_COLLECTIONS.docs).doc(id);
  const store = makeStore((id, fn) => db.runTransaction(async (tx) => {
    const snap = await tx.get(ref(id));
    const out = fn(snap.exists ? snap.data() : null);
    if (out.changed) tx.set(ref(id), out.doc);
    return out;
  }));
  return {
    ...store,
    async get(clientId) {
      const snap = await ref(checkClientId(clientId)).get();
      return snap.exists ? snap.data() : null;
    },
  };
}

/** In-memory store for tests. */
export function createMemoryStrategyDocStore() {
  const docs = new Map();
  const copy = (d) => (d ? JSON.parse(JSON.stringify(d)) : null);
  const store = makeStore(async (id, fn) => {
    const out = fn(copy(docs.get(id)));
    if (out.changed) docs.set(id, copy(out.doc));
    return { doc: copy(out.doc), changed: out.changed };
  });
  return { ...store, async get(clientId) { return copy(docs.get(checkClientId(clientId))); } };
}
