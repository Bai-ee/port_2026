'use strict';

/**
 * Shared clip selection for video-remix renders.
 *
 * Originally this logic lived only in the daily-email worker
 * (`app/api/worker/pre-digest-video/route.js`), so a render queued from the
 * Video Remix CARD got no shuffle and no anti-repeat at all — the EditVideos
 * worker picked clips itself, and its pick is effectively deterministic (see
 * the "audio pinned for repeatability" note in
 * docs/source-of-truth/VIDEO-REMIX-EDITVIDEOS-BRIDGE.md). Two renders from the
 * same folder could therefore contain the same footage.
 *
 * This module is the ONE selector both paths use, so "queue from any folder"
 * always yields a fresh-feeling video:
 *   1. keep only real videos at/above a minimum size,
 *   2. put clips NOT used by the last N renders first (shuffled),
 *   3. let recently-used clips fill only the leftover slots (shuffled),
 *   4. pin the result as an explicit `videoOrder`.
 *
 * Pure functions take their inputs; the Firestore/bucket reads are injected so
 * this stays unit-testable without a live project.
 */

const DEFAULT_SEGMENT_COUNT = 6;

/** Fisher-Yates. `rng` is injectable so tests can be deterministic. */
function shuffled(values = [], rng = Math.random) {
  const arr = [...values];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Video files at/above `minSizeBytes`. Non-video and tiny stubs are dropped. */
function eligibleClips(files = [], minSizeBytes = 0) {
  const floor = Math.max(0, Number(minSizeBytes) || 0);
  return (Array.isArray(files) ? files : []).filter((file) => (
    file
    && file.kind === 'video'
    && file.name
    && Number(file.size || 0) >= floor
  ));
}

/**
 * Clip names pinned by the last `lookbackJobs` video-remix jobs for this
 * client+folder. Best-effort memory: any read failure returns an empty set and
 * selection degrades to a plain shuffle (still random, just not anti-repeating).
 *
 * @param {object} deps - { listMediaJobs } from api/_lib/media-jobs.cjs
 */
async function listRecentlyUsedClipNames(clientId, folder, lookbackJobs, deps = {}) {
  const listMediaJobs = deps.listMediaJobs;
  if (!clientId || !lookbackJobs || typeof listMediaJobs !== 'function') return new Set();
  try {
    const jobs = await listMediaJobs(clientId, { type: 'video-remix', limit: 12 });
    const used = new Set();
    let counted = 0;
    for (const job of jobs || []) {
      const order = job && job.recipeFull && job.recipeFull.videoOrder;
      const jobFolders = job && job.recipeFull && job.recipeFull.sourceFolders;
      if (!Array.isArray(order) || !order.length) continue;
      if (!Array.isArray(jobFolders) || !jobFolders.includes(folder)) continue;
      for (const item of order) {
        if (item && item.videoName) used.add(String(item.videoName));
      }
      counted += 1;
      if (counted >= lookbackJobs) break;
    }
    return used;
  } catch {
    return new Set();
  }
}

/**
 * Order `files` fresh-first: clips untouched by recent renders (shuffled) ahead
 * of recently-used ones (shuffled). With enough footage in the folder,
 * consecutive renders share zero clips.
 */
function orderClipsFreshFirst(files, recentlyUsed = new Set(), rng = Math.random) {
  const fresh = files.filter((file) => !recentlyUsed.has(String(file.name)));
  const reused = files.filter((file) => recentlyUsed.has(String(file.name)));
  return [...shuffled(fresh, rng), ...shuffled(reused, rng)];
}

/**
 * Build a pinned `videoOrder` for ONE folder.
 *
 * @returns {Promise<Array<{segmentIndex:number,videoName:string}>|null>}
 *   null when the folder cannot fill `segmentCount` — callers decide whether
 *   that is fatal (daily email) or just "let the worker pick" (card).
 */
async function buildVideoOrder({
  clientId,
  folder,
  files,
  segmentCount = DEFAULT_SEGMENT_COUNT,
  minSizeBytes = 0,
  antiRepeatLookback = 0,
  rng = Math.random,
  deps = {},
}) {
  const count = Math.max(1, Number(segmentCount) || DEFAULT_SEGMENT_COUNT);
  const eligible = eligibleClips(files, minSizeBytes);
  if (eligible.length < count) return null;

  const recentlyUsed = await listRecentlyUsedClipNames(
    clientId,
    folder,
    Math.max(0, Number(antiRepeatLookback) || 0),
    deps,
  );

  return orderClipsFreshFirst(eligible, recentlyUsed, rng)
    .slice(0, count)
    .map((file, index) => ({ segmentIndex: index, videoName: file.name }));
}

module.exports = {
  DEFAULT_SEGMENT_COUNT,
  shuffled,
  eligibleClips,
  listRecentlyUsedClipNames,
  orderClipsFreshFirst,
  buildVideoOrder,
};
