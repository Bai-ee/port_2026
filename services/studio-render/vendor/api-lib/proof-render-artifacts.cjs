// proof-render-artifacts.cjs — Slice 4f Phase B (non-live). Durable storage
// for Proof render output (MP4 + poster), scoped per client/job, with a
// 7-day retention policy and signed read URLs minted on demand — never a
// stored expiry-sensitive URL, and never a local filesystem path exposed or
// persisted anywhere (the caller — proof-render-worker.mjs — remains
// responsible for deleting the local temp files after upload, unchanged
// from today's cleanup behavior).
//
// Mirrors api/_lib/studio-glb-assets.cjs's own established pattern: a
// namespaced object path per resource, `getSignedUrl({version:'v4', ...})`
// minted fresh at READ time (never persisted), and a test-context DI seam
// (`__setTestContext`) matching proof-render-jobs.cjs's own convention.
//
// Wired into proof-render-worker.mjs (Phase 1, STUDIO-DETERMINISTIC-FINAL-
// RENDER-SONNET-HANDOFF.md): runOneProofRenderJob calls uploadProofArtifacts
// after a successful render+ffprobe validation and before completeProofRenderJob,
// so a job can never become 'done' without a durable artifact. Signed-URL
// minting (mintReadUrls) is still route-layer-only (Phase 2) — no client
// request path calls it yet.

const { readFile } = require('node:fs/promises');
const realFb = require('./firebase-admin.cjs');

const PREFIX = 'proof-render-artifacts';
const RETENTION_DAYS = 7;
// Minted fresh per read (see mintReadUrls) — short-lived on purpose; never
// stored, so its own expiry is irrelevant to the artifact's real 7-day
// retention (a stale signed URL just gets re-minted on the next read).
const SIGNED_READ_TTL_MS = 15 * 60 * 1000;

// --- test seam (proof-render-jobs.cjs's own DI pattern) --------------------
let _ctx = null;
function __setTestContext(ctx) { _ctx = ctx; }
function ctx() { return _ctx || realFb; }
function bucket() { return ctx().adminStorage.bucket(); }

/**
 * Client/job/claim-scoped object path — the only path shape this module ever
 * produces or accepts. Caller-supplied ids are sanitized to a safe character
 * set (never taken as a literal path fragment), and a path outside
 * `PREFIX/<clientId>/<jobId>/<claimToken>/` is never constructed.
 *
 * Scoped by claimToken (not just clientId/jobId) so a losing claim's upload
 * can never physically overwrite a winning claim's already-durable artifact
 * object — see uploadProofArtifacts' own comment for the full race this
 * closes. A claimToken is a UUID (proof-render-jobs.cjs's
 * claimNextProofRenderJob), so the sanitized charset is never empty for a
 * real caller.
 */
function artifactStoragePath(clientId, jobId, claimToken, fileName) {
  const safeClientId = String(clientId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const safeJobId = String(jobId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const safeClaimToken = String(claimToken || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeClientId || !safeJobId || !safeClaimToken) {
    throw new Error('clientId, jobId, and claimToken are required for an artifact path.');
  }
  return `${PREFIX}/${safeClientId}/${safeJobId}/${safeClaimToken}/${fileName}`;
}

/**
 * Uploads the local mp4/poster files (already produced by renderArtScene,
 * still on local disk at this point) to Storage at a client/job/claim-scoped
 * path. Returns ONLY the storage paths + a computed retention expiry —
 * never a signed URL (minted fresh on read, see mintReadUrls below) and
 * never the local path itself. The caller remains responsible for deleting
 * the local temp files afterward — this function neither reads their
 * lifecycle nor deletes them.
 *
 * `claimToken` (Phase 1 — STUDIO-DETERMINISTIC-FINAL-RENDER-SONNET-
 * HANDOFF.md) scopes the object path per claim, not just per job: if a
 * worker's claim is reclaimed by a newer worker (stale lease) but its
 * in-flight upload finishes anyway, it uploads to ITS OWN claim-scoped
 * path — never the same path a newer claim's own (already-completed)
 * upload wrote to. Without this, two claims racing on the SAME
 * clientId/jobId path could have the LOSING claim's upload physically land
 * after the WINNING claim's, silently corrupting an already-`done` job's
 * artifact even though completeProofRenderJob's own fencing correctly
 * rejected the stale claim's metadata write. The worker deletes its own
 * claim-scoped objects on a stale-claim completion failure (best-effort);
 * any it can't clean up synchronously are still scoped/harmless and
 * eligible for the same retention sweep as any other artifact.
 *
 * ── P2-2 fix ("timed-out or partially failed uploads leave unreachable
 * Storage objects") ─────────────────────────────────────────────────────
 * `Promise.all([save, save])` rejects on the FIRST failing save — but the
 * OTHER file may already have landed (or lands moments later regardless).
 * Without cleanup, that successfully-saved object has nothing referencing
 * it: `uploadProofArtifacts` itself never returns (the whole call rejects),
 * so no `artifact` object is ever built, and it's invisible to the normal
 * expiresAt-based retention sweep (proof-render-retention.cjs), which only
 * ever looks at objects a job record already points to. On any upload
 * failure, this now best-effort-deletes BOTH claim-scoped paths
 * (deleteProofArtifacts already uses ignoreNotFound:true per-file, so
 * deleting a path that was never actually written is a harmless no-op) —
 * never allowed to mask the ORIGINAL upload error, and never allowed to
 * throw past its own catch (a cleanup failure is logged, not re-thrown).
 * This does NOT cover every case: raceUploadAgainstDeadline
 * (proof-render-worker.mjs) can abandon this promise entirely on a total-
 * deadline timeout while the save() calls keep running in the background —
 * this function's own try/catch never even gets a chance to run for that
 * specific race. reclaimOrphanedProofRenderArtifacts (proof-render-
 * retention.cjs) is the backstop for that case: a sweep over Storage
 * objects that finds anything with no owning job record (or whose owning
 * job has since moved on to a different claim) and reclaims it, skipping
 * anything whose job is still queued/rendering.
 */
async function uploadProofArtifacts({ clientId, jobId, claimToken, mp4Path, posterPath }) {
  const mp4StoragePath = artifactStoragePath(clientId, jobId, claimToken, 'proof.mp4');
  const posterStoragePath = artifactStoragePath(clientId, jobId, claimToken, 'poster.jpg');
  const [mp4Buffer, posterBuffer] = await Promise.all([readFile(mp4Path), readFile(posterPath)]);
  const b = bucket();
  try {
    await Promise.all([
      b.file(mp4StoragePath).save(mp4Buffer, { contentType: 'video/mp4' }),
      b.file(posterStoragePath).save(posterBuffer, { contentType: 'image/jpeg' }),
    ]);
  } catch (uploadErr) {
    await deleteProofArtifacts({ mp4StoragePath, posterStoragePath }).catch((cleanupErr) => {
      console.warn(`[proof-render-artifacts] failed to clean up a partially-failed upload for ${clientId}/${jobId}/${claimToken}: ${cleanupErr?.message}`);
    });
    throw uploadErr; // the ORIGINAL failure, never replaced or masked by a cleanup outcome
  }
  const expiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return { mp4StoragePath, posterStoragePath, expiresAt, retentionDays: RETENTION_DAYS };
}

/**
 * Mints FRESH signed read URLs at request time for an already-uploaded
 * artifact's storage paths — nothing expiry-sensitive is ever persisted
 * (same discipline as studio-glb-assets.cjs's own mintReadUrl). Called by
 * the GET route, not by toClientView itself (that projection is
 * synchronous; signing is not).
 */
async function mintReadUrls({ mp4StoragePath, posterStoragePath }) {
  const b = bucket();
  const [[mp4Url], [posterUrl]] = await Promise.all([
    b.file(mp4StoragePath).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + SIGNED_READ_TTL_MS }),
    b.file(posterStoragePath).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + SIGNED_READ_TTL_MS }),
  ]);
  return { mp4Url, posterUrl };
}

/** Deletes a single raw Storage object path — a no-op (never throws) if it doesn't exist. */
async function deleteStorageObject(objectPath) {
  await bucket().file(objectPath).delete({ ignoreNotFound: true });
}

/**
 * Deletes both artifact objects for a job — the per-job primitive the
 * retention sweep calls once `expiresAt` has passed (proof-render-
 * retention.cjs's sweepExpiredProofRenderArtifacts) — and reused by
 * uploadProofArtifacts' own P2-2 partial-failure cleanup above. This
 * module does not itself schedule or run that sweep (no cron wired here);
 * it only provides the operation, matching the plan's own "never silently
 * add storage without a defined cleanup procedure" instruction.
 */
async function deleteProofArtifacts({ mp4StoragePath, posterStoragePath }) {
  await Promise.all([deleteStorageObject(mp4StoragePath), deleteStorageObject(posterStoragePath)]);
}

/**
 * Lists raw Storage object paths under this module's own PREFIX — the raw
 * listing primitive a P2-2 orphan-reclaim sweep needs (proof-render-
 * retention.cjs's reclaimOrphanedProofRenderArtifacts) to find candidate
 * objects with no owning job record. Returns bare path strings only; this
 * module never cross-references them against Firestore job records itself
 * — that orchestration belongs to proof-render-retention.cjs, matching this
 * module's own scope (Storage primitives only, no Firestore access, same
 * discipline the rest of this file already follows).
 */
async function listArtifactStorageObjects({ maxResults } = {}) {
  const b = bucket();
  const [files] = await b.getFiles({ prefix: `${PREFIX}/`, ...(maxResults ? { maxResults } : {}) });
  return files.map((f) => f.name);
}

module.exports = {
  PREFIX,
  RETENTION_DAYS,
  artifactStoragePath,
  uploadProofArtifacts,
  mintReadUrls,
  deleteProofArtifacts,
  deleteStorageObject,
  listArtifactStorageObjects,
  __setTestContext,
};
