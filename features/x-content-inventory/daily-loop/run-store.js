// Run persistence: doc ids, claim/lease rules, preserve-reviewed merge, and the
// memory + Firestore run stores (I/O injected).
// Decides whether a caller may run and what survives a regeneration; never drafts or reviews.
// Leaf module (the review actions build on it).

export const RUNS_COLLECTION = 'x_content_daily_runs';
export const CLAIM_LEASE_MS = 5 * 60 * 1000;
const REVIEWED = new Set(['saved', 'dismissed']);
const LATEST_LOOKBACK_DAYS = 7;

export const bad = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });

export function runDocId({ clientId, localDate, channel = 'x', version = 1 }) {
  return `${clientId}__${localDate}__${channel}__v${version}`;
}

// --- pure rules (shared by both stores) -------------------------------------

/** Should this caller run the generation? */
export function claimDecision(prev, { fingerprint, force = false, now, leaseMs = CLAIM_LEASE_MS }) {
  if (prev?.status === 'running' && Number(prev.claimedAt) + leaseMs > now) return { claimed: false, reason: 'in-progress' };
  if (prev?.status === 'complete' && prev.inputFingerprint === fingerprint && !force) return { claimed: false, reason: 'unchanged', run: prev };
  return { claimed: true };
}

/** Reviewed work survives a regeneration; fresh pending suggestions replace old pending ones. */
export function mergePreserved(prev, next) {
  const kept = (prev?.suggestions || []).filter((s) => REVIEWED.has(s.reviewState) || s.socialPostId);
  const keptIds = new Set(kept.map((s) => s.id));
  return { ...next, suggestions: [...kept, ...(next.suggestions || []).filter((s) => !keptIds.has(s.id))] };
}

// --- stores ----------------------------------------------------------------

export function createMemoryRunStore({ leaseMs = CLAIM_LEASE_MS } = {}) {
  const docs = new Map();
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  return {
    docs,
    async claim({ key, fingerprint, force, now }) {
      const id = runDocId(key);
      const decision = claimDecision(docs.get(id), { fingerprint, force, now, leaseMs });
      if (decision.claimed) docs.set(id, { ...(docs.get(id) || {}), ...key, status: 'running', claimedAt: now });
      return clone(decision);
    },
    async complete(run) {
      const id = runDocId(run);
      const merged = mergePreserved(docs.get(id), { ...run, status: 'complete' });
      docs.set(id, clone(merged));
      return clone(merged);
    },
    async fail(run) {
      const id = runDocId(run);
      docs.set(id, clone(mergePreserved(docs.get(id), { ...run, status: 'partial' })));
    },
    async read(key) { return clone(docs.get(runDocId(key)) || null); },
    async updateSuggestion(key, suggestionId, mutate) {
      const id = runDocId(key);
      const run = docs.get(id);
      const idx = run?.suggestions?.findIndex((s) => s.id === suggestionId) ?? -1;
      if (idx < 0) throw bad('Suggestion not found.', 404);
      const patch = await mutate(clone(run.suggestions[idx]), clone(run));
      run.suggestions[idx] = { ...run.suggestions[idx], ...patch };
      return clone(run.suggestions[idx]);
    },
  };
}

export function createFirestoreRunStore(db, { leaseMs = CLAIM_LEASE_MS } = {}) {
  const col = () => db.collection(RUNS_COLLECTION);
  return {
    async claim({ key, fingerprint, force, now }) {
      const ref = col().doc(runDocId(key));
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const decision = claimDecision(snap.exists ? snap.data() : null, { fingerprint, force, now, leaseMs });
        if (decision.claimed) tx.set(ref, { ...key, status: 'running', claimedAt: now }, { merge: true });
        return decision;
      });
    },
    async complete(run) {
      const ref = col().doc(runDocId(run));
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const merged = mergePreserved(snap.exists ? snap.data() : null, { ...run, status: 'complete', claimedAt: null });
        tx.set(ref, merged);
        return merged;
      });
    },
    async fail(run) {
      const ref = col().doc(runDocId(run));
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        tx.set(ref, mergePreserved(snap.exists ? snap.data() : null, { ...run, status: 'partial', claimedAt: null }));
      });
    },
    async read(key) {
      const snap = await col().doc(runDocId(key)).get();
      return snap.exists ? snap.data() : null;
    },
    /** Most recent run on or before `localDate`, without a composite index. */
    async latest({ clientId, localDate, channel = 'x', version }) {
      const [y, m, d] = localDate.split('-').map(Number);
      const refs = Array.from({ length: LATEST_LOOKBACK_DAYS }, (_, i) => {
        const day = new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10);
        return col().doc(runDocId({ clientId, localDate: day, channel, version }));
      });
      const snaps = await db.getAll(...refs);
      const hit = snaps.find((s) => s.exists);
      return hit ? hit.data() : null;
    },
    async updateSuggestion(key, suggestionId, mutate) {
      const ref = col().doc(runDocId(key));
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const run = snap.exists ? snap.data() : null;
        const idx = run?.suggestions?.findIndex((s) => s.id === suggestionId) ?? -1;
        if (idx < 0) throw bad('Suggestion not found.', 404);
        const patch = await mutate(run.suggestions[idx], run);
        const suggestions = run.suggestions.slice();
        suggestions[idx] = { ...suggestions[idx], ...patch };
        tx.update(ref, { suggestions });
        return suggestions[idx];
      });
    },
  };
}
