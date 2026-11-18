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
 *   2. put clips NOT used by the last N renders (callers pass 10) first, drawn
 *      by weighted random sampling without replacement (Efraimidis-Spirakis)
 *      so newer uploads (by `timeCreated`) are favoured but old clips still
 *      surface: w = FLOOR + (1-FLOOR) * 2^(-ageDays/HALF_LIFE_DAYS),
 *      missing/invalid timeCreated -> FLOOR,
 *   3. let recently-used clips fill only the leftover slots, least-recently-
 *      used first (deterministic),
 *   4. pin the result as an explicit `videoOrder`.
 *
 * `files` should come from listFolderClipsForSelection (editvideos-bridge.cjs),
 * which sees the whole folder; listFolderMedia caps at 120 and would hide the
 * rest of a large folder from the selector.
 *
 * Pure functions take their inputs (`rng`, `now`); the Firestore/bucket reads
 * are injected so this stays unit-testable without a live project.
 */

const { isValidVideoOrderName } = require('./media-recipe.cjs');

const DEFAULT_SEGMENT_COUNT = 6;
/** Minimum sampling weight (an arbitrarily old clip) relative to a brand-new one at 1. */
const FRESHNESS_WEIGHT_FLOOR = 0.25;
/** Days for the age-dependent part of the weight to halve. */
const FRESHNESS_HALF_LIFE_DAYS = 45;
const MS_PER_DAY = 86400000;

/** Fisher-Yates. Kept for back-compat/tests; the selector now uses weightedShuffle. `rng` is injectable so tests can be deterministic. */
function shuffled(values = [], rng = Math.random) {
  const arr = [...values];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Video files at/above `minSizeBytes`. Non-video, tiny stubs, and names that
 * validateRemixRecipe would reject as a videoOrder.videoName are dropped.
 */
function eligibleClips(files = [], minSizeBytes = 0) {
  const floor = Math.max(0, Number(minSizeBytes) || 0);
  return (Array.isArray(files) ? files : []).filter((file) => (
    file
    && file.kind === 'video'
    && isValidVideoOrderName(file.name)
    && Number(file.size || 0) >= floor
  ));
}

/**
 * Recent use per clip for this client+folder across the last `lookbackJobs`
 * video-remix jobs: Map<clipName, index of the MOST RECENT job using it>
 * (0 = newest job). Best-effort memory: any read failure returns an empty map
 * and selection degrades to a plain draw (still random, just not anti-repeating).
 *
 * listMediaJobs applies its `type` filter in memory AFTER the limit, so the
 * fetch window is wider than the lookback (other job types share the list).
 *
 * @param {object} deps - { listMediaJobs } from api/_lib/media-jobs.cjs
 */
async function listRecentClipUsage(clientId, folder, lookbackJobs, deps = {}) {
  const listMediaJobs = deps.listMediaJobs;
  const usage = new Map();
  if (!clientId || !lookbackJobs || typeof listMediaJobs !== 'function') return usage;
  try {
    const limit = Math.min(60, Math.max(20, lookbackJobs * 4));
    const jobs = await listMediaJobs(clientId, { type: 'video-remix', limit });
    let counted = 0;
    for (const job of jobs || []) {
      const order = job && job.recipeFull && job.recipeFull.videoOrder;
      const jobFolders = job && job.recipeFull && job.recipeFull.sourceFolders;
      if (!Array.isArray(order) || !order.length) continue;
      if (!Array.isArray(jobFolders) || !jobFolders.includes(folder)) continue;
      for (const item of order) {
        if (item && item.videoName && !usage.has(String(item.videoName))) {
          usage.set(String(item.videoName), counted);
        }
      }
      counted += 1;
      if (counted >= lookbackJobs) break;
    }
    return usage;
  } catch {
    return new Map();
  }
}

/** Kept for back-compat/tests; buildVideoOrder uses listRecentClipUsage. Set of clip names pinned by the last `lookbackJobs` jobs (see listRecentClipUsage). */
async function listRecentlyUsedClipNames(clientId, folder, lookbackJobs, deps = {}) {
  return new Set((await listRecentClipUsage(clientId, folder, lookbackJobs, deps)).keys());
}

/** Sampling weight in [FLOOR, 1]: newer clips weigh more; unknown age = FLOOR. */
function freshnessWeight(timeCreated, now = Date.now()) {
  if (!Number.isFinite(now)) now = Date.now();
  const created = timeCreated ? Date.parse(timeCreated) : NaN;
  if (!Number.isFinite(created)) return FRESHNESS_WEIGHT_FLOOR;
  const ageDays = Math.max(0, (now - created) / MS_PER_DAY);
  return FRESHNESS_WEIGHT_FLOOR
    + (1 - FRESHNESS_WEIGHT_FLOOR) * 2 ** (-ageDays / FRESHNESS_HALF_LIFE_DAYS);
}

/** Weighted shuffle without replacement (Efraimidis-Spirakis): sort by rng()^(1/w) desc. */
function weightedShuffle(files = [], rng = Math.random, now = Date.now()) {
  return files
    .map((file) => ({ file, key: rng() ** (1 / freshnessWeight(file.timeCreated, now)) }))
    .sort((a, b) => b.key - a.key)
    .map((entry) => entry.file);
}

/**
 * Order `files` fresh-first: clips untouched by recent renders (age-weighted
 * random order) ahead of recently-used ones (least-recently-used first).
 * `recentlyUsed` is a Map<name, recencyIndex> (0 = newest job; larger = older)
 * or a plain Set (no recency info -> original order). With enough footage in
 * the folder, consecutive renders share zero clips.
 */
function orderClipsFreshFirst(files, recentlyUsed = new Map(), rng = Math.random, now = Date.now()) {
  const recency = (file) => (recentlyUsed instanceof Map ? recentlyUsed.get(String(file.name)) : 0);
  const isUsed = (file) => recentlyUsed.has(String(file.name));
  const fresh = files.filter((file) => !isUsed(file));
  const reused = files
    .filter(isUsed)
    .map((file, index) => ({ file, index }))
    .sort((a, b) => (recency(b.file) - recency(a.file)) || (a.index - b.index))
    .map((entry) => entry.file);
  return [...weightedShuffle(fresh, rng, now), ...reused];
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
  now = Date.now(),
  deps = {},
}) {
  const clock = Number.isFinite(now) ? now : Date.now();
  const count = Math.max(1, Number(segmentCount) || DEFAULT_SEGMENT_COUNT);
  const eligible = eligibleClips(files, minSizeBytes);
  if (eligible.length < count) return null;

  const recentlyUsed = await listRecentClipUsage(
    clientId,
    folder,
    Math.max(0, Number(antiRepeatLookback) || 0),
    deps,
  );

  return orderClipsFreshFirst(eligible, recentlyUsed, rng, clock)
    .slice(0, count)
    .map((file, index) => ({ segmentIndex: index, videoName: file.name }));
}

module.exports = {
  DEFAULT_SEGMENT_COUNT,
  shuffled,
  eligibleClips,
  FRESHNESS_WEIGHT_FLOOR,
  FRESHNESS_HALF_LIFE_DAYS,
  freshnessWeight,
  weightedShuffle,
  listRecentClipUsage,
  listRecentlyUsedClipNames,
  orderClipsFreshFirst,
  buildVideoOrder,
};
