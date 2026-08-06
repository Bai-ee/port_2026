// proof-render-retention.cjs — Phase 2 (STUDIO-DETERMINISTIC-FINAL-RENDER-
// SONNET-HANDOFF.md): "Enforce retention using a bucket lifecycle rule or a
// tested scheduled cleanup path calling deleteProofArtifacts. Do not rely on
// expiresAt metadata alone."
//
// This module IS the tested scheduled-cleanup path — pure orchestration
// logic, dependency-injected via jobs.cjs/artifacts.cjs's own existing test
// seams, no new Firestore/Storage access of its own. It is deliberately NOT
// wired to a live cron route or Vercel schedule yet: registering a new
// route/cron is a deployment-surface change (new function in the Hobby
// packaging budget, a new vercel.json entry) gated behind this handoff's own
// Phase 7 approval stop, same as every other production-mutation item there.
//
// AUTHORITATIVE CLEANUP MECHANISM (selected, Phase 7 deployment gate): a
// bucket LIFECYCLE RULE — delete objects under `proof-render-artifacts/`
// with age ≥ RETENTION_DAYS (7, proof-render-artifacts.cjs) — is the
// production guarantee for BOTH expired referenced artifacts AND orphaned
// partial/abandoned uploads. Age-based, so it cannot starve; catches every
// object regardless of whether any job record references it; aligns with
// `expiresAt` (= upload time + RETENTION_DAYS), and the read path
// (proof-render-view.cjs) never signs past `expiresAt`, so an object
// outliving its expiry by the rule's own firing lag is unreachable anyway.
// Applying that rule is a bucket-configuration cloud mutation — Phase 7
// approval required; it is NOT yet applied.
//
// The two sweeps below are therefore tested, bounded, BEST-EFFORT tools
// (manual/cron fast path: immediate cleanup + clearing the job doc's own
// `artifact` field), not the durability guarantee. In particular,
// reclaimOrphanedProofRenderArtifacts lists only the first `maxResults`
// objects in lexicographic order per call — orphans beyond a first page
// full of skip-class objects are NOT reached by that call (documented on
// the function itself); the lifecycle rule is what guarantees they still
// die at age RETENTION_DAYS.
//
// Until either is wired in, `expiresAt` alone does NOT delete anything; the
// route layer (app/api/dashboard/proof-render/route.js) still reports an
// honest `expired:true` (no signed URL) once `expiresAt` has passed, exactly
// as required, independent of whether this sweep has run yet.

const jobs = require('./proof-render-jobs.cjs');
const artifacts = require('./proof-render-artifacts.cjs');

const DEFAULT_SWEEP_LIMIT = 50;
// A generous ceiling on how many raw Storage objects one reclaim call ever
// lists — same "the scan itself cannot run unbounded" discipline as
// listDoneJobsWithArtifacts' own maxScanned (P2-1). Two objects (mp4 +
// poster) per claim, so this covers up to ~100 claim-scoped groups per call.
const DEFAULT_ORPHAN_SCAN_LIMIT = 200;

// Matches artifactStoragePath's own shape exactly: PREFIX/clientId/jobId/
// claimToken/fileName — anything that doesn't match this is never touched
// by the reclaim sweep (defense in depth: an unrecognized path is left
// alone, not guessed at).
const ARTIFACT_OBJECT_PATH_PATTERN = new RegExp(`^${artifacts.PREFIX}/([^/]+)/([^/]+)/([^/]+)/[^/]+$`);

function parseArtifactObjectPath(objectPath) {
  const match = ARTIFACT_OBJECT_PATH_PATTERN.exec(objectPath);
  if (!match) return null;
  const [, clientId, jobId, claimToken] = match;
  return { clientId, jobId, claimToken };
}

/**
 * Sweeps up to `limit` completed jobs, deleting Storage objects (and
 * clearing the job's own `artifact` field) for every one whose
 * `artifact.expiresAt` is at or before `now`. Bounded and sequential
 * (no-await-in-loop is deliberate here — a small, infrequent, cron-shaped
 * sweep has no reason to fan out N concurrent Storage deletes) so one
 * job's failure never aborts the rest of the batch; every outcome is
 * tallied in the returned summary, never silently dropped.
 */
async function sweepExpiredProofRenderArtifacts({ limit = DEFAULT_SWEEP_LIMIT, now = Date.now() } = {}) {
  const candidates = await jobs.listDoneJobsWithArtifacts({ limit });
  const summary = { scanned: candidates.length, deleted: 0, skipped: 0, errors: 0, errorDetails: [] };

  for (const job of candidates) {
    const expiresMs = Date.parse(job.artifact?.expiresAt || '');
    if (!Number.isFinite(expiresMs) || expiresMs > now) continue; // not yet expired — not this sweep's concern
    try {
      // eslint-disable-next-line no-await-in-loop -- deliberately sequential, see the function's own comment
      await artifacts.deleteProofArtifacts(job.artifact);
      // eslint-disable-next-line no-await-in-loop
      const cleared = await jobs.clearExpiredProofRenderArtifact(job.jobId, job.artifact);
      if (cleared) summary.deleted += 1;
      else summary.skipped += 1; // superseded between list and delete — the Storage objects are gone either way, just not OUR job doc write
    } catch (err) {
      summary.errors += 1;
      summary.errorDetails.push({ jobId: job.jobId, message: err?.message || String(err) });
      console.warn(`[proof-render-retention] failed to sweep artifact for job ${job.jobId}: ${err?.message}`);
    }
  }

  return summary;
}

/**
 * P2-2 ("timed-out or partially failed uploads leave unreachable Storage
 * objects") — the backstop sweepExpiredProofRenderArtifacts above cannot
 * be: that sweep only ever looks at Storage objects a job record's own
 * `artifact` field already points to. A partial/timed-out upload whose
 * promise was abandoned (raceUploadAgainstDeadline, proof-render-
 * worker.mjs) can leave an object in Storage that NO job record ever
 * references — invisible to the normal sweep, accruing cost forever.
 *
 * Lists up to `maxResults` raw objects under artifacts' own PREFIX, groups
 * them by the `(clientId, jobId, claimToken)` triple their path encodes
 * (artifactStoragePath's own shape), and for each group:
 *   - no job record exists at all for that (clientId, jobId) → orphan, delete.
 *   - the job exists and is still 'queued' or 'rendering' → SKIP, always —
 *     "be careful not to delete objects belonging to jobs that are still
 *     in flight" — regardless of whether this specific claimToken is the
 *     job's CURRENT active claim or a stale one from an earlier attempt;
 *     the safe answer is to leave anything touching an in-flight job alone
 *     entirely and let a LATER sweep (once the job reaches done/failed)
 *     reconsider it.
 *   - the job is terminal (done/failed) and this claimToken IS the job's
 *     own current authoritative `artifact` (path match) → SKIP — still
 *     referenced; sweepExpiredProofRenderArtifacts owns that lifecycle.
 *   - the job is terminal and this claimToken is NOT the job's current
 *     artifact (a superseded/losing claim's leftovers, or a job that has
 *     since been cleared/re-completed under a different claim) → orphan,
 *     delete.
 *
 * Best-effort and per-group isolated, same discipline as
 * sweepExpiredProofRenderArtifacts above: one group's failure never aborts
 * the rest, every outcome is tallied, nothing here is silently dropped.
 *
 * ⚠️ Bounded, NOT starvation-safe on its own: `maxResults` caps a single
 * lexicographically-ordered listing from the START of the prefix, so if the
 * first page is filled entirely with skip-class objects (live referenced
 * artifacts / in-flight claims), orphans sorted after them are never
 * reached by this call — and a repeat call rescans the same first page.
 * That is acceptable BECAUSE this sweep is the best-effort fast path only;
 * the authoritative cleanup is the age-based bucket lifecycle rule selected
 * in this module's header (Phase 7 deployment gate), which deletes every
 * object at age RETENTION_DAYS regardless of position or reference state.
 */
async function reclaimOrphanedProofRenderArtifacts({ maxResults = DEFAULT_ORPHAN_SCAN_LIMIT } = {}) {
  const objectPaths = await artifacts.listArtifactStorageObjects({ maxResults });
  const groups = new Map(); // "clientId/jobId/claimToken" -> { clientId, jobId, claimToken, paths: [...] }
  for (const objectPath of objectPaths) {
    const parsed = parseArtifactObjectPath(objectPath);
    if (!parsed) continue; // unrecognized shape — never touched
    const key = `${parsed.clientId}/${parsed.jobId}/${parsed.claimToken}`;
    if (!groups.has(key)) groups.set(key, { ...parsed, paths: [] });
    groups.get(key).paths.push(objectPath);
  }

  const summary = { scannedObjects: objectPaths.length, groups: groups.size, deleted: 0, skipped: 0, errors: 0, errorDetails: [] };

  for (const { clientId, jobId, claimToken, paths } of groups.values()) {
    try {
      // eslint-disable-next-line no-await-in-loop -- deliberately sequential, see the function's own comment
      const job = await jobs.getProofRenderJob(jobId, { clientId });
      if (job && (job.status === 'queued' || job.status === 'rendering')) {
        summary.skipped += 1; // still in flight — never touched, regardless of claimToken
        continue;
      }
      const isCurrentArtifact = job?.artifact?.mp4StoragePath === artifacts.artifactStoragePath(clientId, jobId, claimToken, 'proof.mp4');
      if (isCurrentArtifact) {
        summary.skipped += 1; // still the job's own authoritative, referenced artifact
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(paths.map((p) => artifacts.deleteStorageObject(p)));
      summary.deleted += 1;
    } catch (err) {
      summary.errors += 1;
      summary.errorDetails.push({ clientId, jobId, claimToken, message: err?.message || String(err) });
      console.warn(`[proof-render-retention] failed to reclaim orphaned artifact objects for ${clientId}/${jobId}/${claimToken}: ${err?.message}`);
    }
  }

  return summary;
}

module.exports = {
  sweepExpiredProofRenderArtifacts,
  reclaimOrphanedProofRenderArtifacts,
  DEFAULT_SWEEP_LIMIT,
  DEFAULT_ORPHAN_SCAN_LIMIT,
};
