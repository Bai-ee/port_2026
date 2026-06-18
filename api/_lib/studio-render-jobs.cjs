// studio-render-jobs.cjs — Job lifecycle for Mockup Studio video renders
//
// Gives the (currently synchronous) Cloud Run render a durable job record so a
// video can be "queued to render", tracked through status, and paired with a
// social post downstream.
//
//   queued → rendering → done
//                      → failed
//
// One Firestore doc per job:
//   render_jobs/{jobId}
//
// Fields:
//   clientId      owning client
//   status        queued | rendering | done | failed
//   recipe        trimmed render recipe summary (labels only — not the raw body)
//   postId        optional social-post id this render is paired with (null until paired)
//   capture       studio_video ref written on completion (same shape as studioCaptures[])
//   error         sanitized error string on failure
//   createdAt / updatedAt / startedAt / completedAt   ISO strings + server timestamp
//
// Status tracking only — the render itself still runs inline in the route. The
// job doc is what makes the render queue-able and pollable.

const { randomUUID } = require('crypto');
const fb = require('./firebase-admin.cjs');

const COLLECTION = 'render_jobs';

function trimRecipeSummary(recipe = {}) {
  return {
    url: String(recipe?.url || '').slice(0, 400),
    preset: String(recipe?.preset || '').slice(0, 80) || null,
    viewport: String(recipe?.device?.viewport || 'desktop').slice(0, 40),
    backdrop: String(recipe?.device?.backdrop || '').slice(0, 40) || null,
    seconds: Number(recipe?.output?.seconds) || null,
    fps: Number(recipe?.output?.fps) || null,
  };
}

/**
 * Create a render job in `queued` state.
 * @param {object} args
 * @param {string} args.clientId
 * @param {object} args.recipe   - the render recipe (stored trimmed)
 * @param {string} [args.postId] - social post id to pair this render with
 * @returns {Promise<{ jobId: string }>}
 */
async function createRenderJob({ clientId, recipe, postId = null }) {
  if (!clientId) throw new Error('clientId is required to create a render job.');
  const jobId = `render_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  await fb.adminDb.collection(COLLECTION).doc(jobId).set({
    jobId,
    clientId,
    status: 'queued',
    recipe: trimRecipeSummary(recipe),
    postId: postId || null,
    capture: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    createdAtTs: fb.FieldValue.serverTimestamp(),
    startedAt: null,
    completedAt: null,
  });
  return { jobId };
}

/** Mark a job as actively rendering. Non-fatal: never throws to the caller. */
async function markRenderJobRendering(jobId) {
  if (!jobId) return;
  const now = new Date().toISOString();
  await fb.adminDb.collection(COLLECTION).doc(jobId).set({
    status: 'rendering',
    startedAt: now,
    updatedAt: now,
  }, { merge: true }).catch(() => {});
}

/**
 * Complete a job — store the resulting studio_video capture ref.
 * @param {string} jobId
 * @param {object} capture - the capture ref appended to studioCaptures[]
 */
async function completeRenderJob(jobId, capture) {
  if (!jobId) return;
  const now = new Date().toISOString();
  await fb.adminDb.collection(COLLECTION).doc(jobId).set({
    status: 'done',
    capture: capture || null,
    error: null,
    completedAt: now,
    updatedAt: now,
  }, { merge: true }).catch(() => {});
}

/** Mark a job as failed with a sanitized message. */
async function failRenderJob(jobId, error) {
  if (!jobId) return;
  const now = new Date().toISOString();
  await fb.adminDb.collection(COLLECTION).doc(jobId).set({
    status: 'failed',
    error: String(error?.message || error || 'Render failed.').slice(0, 500),
    completedAt: now,
    updatedAt: now,
  }, { merge: true }).catch(() => {});
}

/** Pair (or re-pair) a job with a social post id. */
async function linkRenderJobToPost(jobId, postId) {
  if (!jobId) return;
  await fb.adminDb.collection(COLLECTION).doc(jobId).set({
    postId: postId || null,
    updatedAt: new Date().toISOString(),
  }, { merge: true }).catch(() => {});
}

/** Fetch a single job, scoped to its owning client. Returns null if missing/foreign. */
async function getRenderJob(jobId, clientId) {
  if (!jobId) return null;
  const snap = await fb.adminDb.collection(COLLECTION).doc(jobId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (clientId && data.clientId !== clientId) return null;
  return data;
}

/** List recent jobs for a client, newest first. */
async function listRenderJobs(clientId, limit = 20) {
  if (!clientId) return [];
  const snap = await fb.adminDb
    .collection(COLLECTION)
    .where('clientId', '==', clientId)
    .orderBy('createdAtTs', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((doc) => doc.data());
}

module.exports = {
  createRenderJob,
  markRenderJobRendering,
  completeRenderJob,
  failRenderJob,
  linkRenderJobToPost,
  getRenderJob,
  listRenderJobs,
};
