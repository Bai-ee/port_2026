// plan-store.js - server-only persistence for x_strategy_plans/{clientId} (T1c).
// I/O is injected (`db` = firebase-admin Firestore); no firebase import here. Pure logic in plan-state.js.
// An absent doc reads as null and is NEVER auto-created: the first write is apply() with
// expectedVersion 0, which creates version 1.

import { applyChange, revertTo } from './plan-state.js';
import { STRATEGY_COLLECTIONS } from './contracts.js';

export class StrategyPlanError extends Error {
  /** @param {'version-conflict'|'invalid'|'not-found'} code */
  constructor(code, message, extra = {}) {
    super(message || code);
    this.name = 'StrategyPlanError';
    this.code = code;
    this.status = code === 'version-conflict' ? 409 : code === 'not-found' ? 404 : 400;
    Object.assign(this, extra); // errors[], currentVersion, reason
  }
}

function checkClientId(clientId) {
  if (typeof clientId !== 'string' || !clientId.trim() || clientId.includes('/')) {
    throw new StrategyPlanError('invalid', 'clientId is required');
  }
  return clientId.trim();
}

/** Turn a state-function result into {doc, changed} or throw. `current` is the doc read in the transaction. */
function resolve(result, current) {
  if (result && result.error) {
    if (result.error === 'noop') return { doc: current, changed: false };
    if (result.error === 'version-conflict') {
      throw new StrategyPlanError('version-conflict', 'plan was changed by someone else', { currentVersion: result.currentVersion });
    }
    throw new StrategyPlanError('invalid', result.errors?.join('; ') || result.error, {
      errors: result.errors ?? [], reason: result.error,
    });
  }
  return { doc: result, changed: true };
}

function makeStore(runTransaction) {
  return {
    async apply(clientId, request) {
      const id = checkClientId(clientId);
      return runTransaction(id, (current) => resolve(applyChange(current, request), current));
    },
    async revert(clientId, version, opts = {}) {
      const id = checkClientId(clientId);
      return runTransaction(id, (current) => {
        if (!current) throw new StrategyPlanError('not-found', 'no plan exists for this client');
        return resolve(revertTo(current, version, opts), current);
      });
    },
  };
}

/** @param {object} db  firebase-admin Firestore (injected) */
export function createFirestorePlanStore(db) {
  const ref = (id) => db.collection(STRATEGY_COLLECTIONS.plans).doc(id);
  const store = makeStore((id, fn) => db.runTransaction(async (tx) => {
    const snap = await tx.get(ref(id));
    const current = snap.exists ? snap.data() : null;
    const out = fn(current);
    if (out.changed) tx.set(ref(id), out.doc); // only write to x_strategy_plans/{clientId}
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

/** In-memory store for tests; models Firestore transaction semantics (commit fails + retries if the doc moved). */
export function createMemoryPlanStore() {
  const docs = new Map();
  const copy = (d) => (d ? JSON.parse(JSON.stringify(d)) : null);
  const store = makeStore(async (id, fn) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const read = docs.get(id);
      const readVersion = read ? read.version : 0;
      await Promise.resolve(); // yield: lets a concurrent transaction commit first
      const out = fn(copy(read));
      if ((docs.get(id)?.version ?? 0) !== readVersion) continue; // contention: retry like Firestore
      if (out.changed) docs.set(id, copy(out.doc));
      return { doc: copy(out.doc), changed: out.changed };
    }
    throw new StrategyPlanError('version-conflict', 'transaction contention');
  });
  return {
    ...store,
    async get(clientId) { return copy(docs.get(checkClientId(clientId))); },
  };
}
