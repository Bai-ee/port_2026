// brief-lease.js — a short lease on a draft while a model call is in flight (author / feedback / rollback), so a double click or a
// second tab cannot run the same authoring twice. `authoring: {key, at}` is written in a draft-only transaction BEFORE the model call;
// any unexpired lease blocks the next request (409 'authoring-in-progress'); it expires after LEASE_MS and is cleared when the call ends.
// `bump` also increments a counter in videoBriefMeta in the same transaction (feedbackCount / rollbackCount: unique request-id suffixes).

const POSTS = 'social_posts';
export const LEASE_MS = 150_000;

/** Returns { ok:true, post, n } (post = the row as it is now, n = the bumped counter or null) or { ok:false, status, reasons }. */
export async function takeLease(db, { postId, clientId, key, now = Date.now(), bump = null }) {
  const ref = db.collection(POSTS).doc(String(postId));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? snap.data() : null;
    if (!cur || cur.clientId !== clientId) return { ok: false, status: 404, reasons: ['post-not-found'] };
    if (cur.status !== 'draft') return { ok: false, status: 409, reasons: ['not-draft'] };
    const at = Date.parse(cur.authoring?.at || '');
    if (cur.authoring?.key && Number.isFinite(at) && now - at < LEASE_MS) return { ok: false, status: 409, reasons: ['authoring-in-progress'] };
    const n = bump ? (Number(cur.videoBriefMeta?.[bump]) || 0) + 1 : null;
    const patch = { authoring: { key, at: new Date(now).toISOString() }, ...(bump ? { videoBriefMeta: { ...cur.videoBriefMeta, [bump]: n } } : {}) };
    tx.set(ref, patch, { merge: true });
    return { ok: true, post: { id: String(postId), ...cur, ...patch }, n };
  });
}

/** Clear the lease if it is still ours. Best-effort. */
export async function releaseLease(db, { postId, key }) {
  try {
    const ref = db.collection(POSTS).doc(String(postId));
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists && snap.data().authoring?.key === key) tx.set(ref, { authoring: null }, { merge: true });
    });
  } catch { /* the lease expires by itself */ }
}
