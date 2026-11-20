// brief-versions.js — video version history of one post: social_posts/{id}/video_versions/{n}.
// {n, requestId, requestHash, request, feedback|null, kind:'author'|'feedback'|'rollback', fromN?, jobId, mediaUrl, posterUrl, createdAt, by}.
// Every write here is best-effort: a history failure must never block authoring, rendering or attaching. Never stores prompts or model output.

const POSTS = 'social_posts';
const VERSIONS = 'video_versions';
export const VERSION_KINDS = ['author', 'feedback', 'rollback'];

const col = (db, postId) => db.collection(POSTS).doc(String(postId)).collection(VERSIONS);

/** All versions of a post, newest first. */
export async function listVersions(db, postId) {
  const snap = await col(db, postId).get();
  return snap.docs.map((d) => d.data()).filter((v) => v && Number.isFinite(Number(v.n))).sort((a, b) => Number(b.n) - Number(a.n));
}

/** Append a version (n = highest n + 1). Returns the version or null. */
export async function writeVersion(db, postId, { requestId, requestHash = null, request, feedback = null, kind, fromN = null, jobId = null, by = null, now = Date.now() }) {
  try {
    const n = ((await listVersions(db, postId))[0]?.n || 0) + 1;
    const v = {
      n, requestId, requestHash, request, feedback: feedback ? String(feedback) : null, kind: VERSION_KINDS.includes(kind) ? kind : 'author',
      ...(fromN != null ? { fromN: Number(fromN) } : {}), jobId, mediaUrl: null, posterUrl: null, createdAt: new Date(now).toISOString(), by: by ? String(by).slice(0, 200) : null,
    };
    await col(db, postId).doc(String(n)).set(v);
    return v;
  } catch {
    return null;
  }
}

/** Record the render job on the newest version of `requestId` (the render started after the version was written). */
export async function setVersionJob(db, postId, requestId, jobId) {
  try {
    const v = (await listVersions(db, postId)).find((x) => x.requestId === requestId);
    if (v && v.jobId !== jobId) await col(db, postId).doc(String(v.n)).set({ jobId }, { merge: true });
  } catch { /* history only */ }
}

/** When a job's video attaches: fill mediaUrl/posterUrl on the newest version of that job's howto request. */
export async function fillVersionMedia(db, job) {
  try {
    if (!job?.postId || !job.downloadUrl) return false;
    const v = (await listVersions(db, job.postId)).find((x) => x.jobId === job.jobId) || (await listVersions(db, job.postId)).find((x) => job.howtoId && x.requestId === job.howtoId);
    if (!v) return false;
    await col(db, job.postId).doc(String(v.n)).set({ jobId: job.jobId, mediaUrl: job.downloadUrl, posterUrl: job.posterUrl || null }, { merge: true });
    return true;
  } catch {
    return false;
  }
}
