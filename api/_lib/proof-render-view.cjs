// proof-render-view.cjs — Phase 2 (STUDIO-DETERMINISTIC-FINAL-RENDER-SONNET-
// HANDOFF.md). Pure(-ish) client-view projection for the proof-render GET
// route, pulled out of app/api/dashboard/proof-render/route.js into a
// directly-testable api/_lib module — this repo's route.js files have no
// direct test coverage of their own (see proof-render-jobs.test.js's own
// header comment), so any real logic worth testing lives here instead, with
// the route staying a thin auth+dispatch shim.

const jobsModule = require('./proof-render-jobs.cjs');
const artifactsModule = require('./proof-render-artifacts.cjs');

/**
 * Client view + an honest `artifact.expired` flag — computed from the SAME
 * `expiresAt` retention proof-render-retention.cjs's sweep (or a bucket
 * lifecycle rule, once either is deployed) enforces, so "expired" here means
 * "the retention mechanism is expected to have reclaimed this by now,"
 * never a guess. `job.artifact` is the RAW record (has storage paths); the
 * returned `.artifact` is still `toClientView`'s own projection (never
 * leaks a path) with `expired` merged on. No signing here — that's
 * `withSignedUrls` below, only ever called for a single-job GET (Phase 2:
 * "prefer single-job signing" to avoid N signing calls on every list poll).
 */
function projectArtifactView(job) {
  const view = jobsModule.toClientView(job);
  if (!job.artifact) return view;
  const expiresMs = Date.parse(job.artifact.expiresAt);
  const expired = !Number.isFinite(expiresMs) || Date.now() > expiresMs;
  return { ...view, artifact: { ...view.artifact, expired } };
}

/**
 * Mints fresh signed MP4/poster URLs and merges them onto an already-
 * projected view — ONLY for a durable, non-expired artifact; never attempted
 * for a metadata-only legacy job (no `artifact` at all) or one already past
 * its retention window (an expired artifact stays an honest `expired:true`
 * with no URLs, never a signed link to an object the retention sweep may
 * have already deleted). A genuine signing failure (Storage/IAM outage)
 * degrades to `urlsAvailable:false` on the artifact object rather than
 * failing the whole request — every OTHER field on the job (status, output,
 * warnings, ...) is still valid and worth returning. `mintReadUrls` is
 * injectable (defaults to the real artifacts.cjs implementation) purely so
 * tests can simulate a signing failure without a live bucket.
 */
async function withSignedUrls(view, job, { mintReadUrls = artifactsModule.mintReadUrls } = {}) {
  if (!job.artifact || view.artifact.expired) return view;
  try {
    const urls = await mintReadUrls(job.artifact);
    return { ...view, artifact: { ...view.artifact, mp4Url: urls.mp4Url, posterUrl: urls.posterUrl } };
  } catch (err) {
    console.warn(`[proof-render-view] failed to mint signed URLs for job ${job.jobId}: ${err?.message}`);
    return { ...view, artifact: { ...view.artifact, urlsAvailable: false } };
  }
}

module.exports = { projectArtifactView, withSignedUrls };
