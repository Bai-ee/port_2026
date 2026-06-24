/**
 * @hitloop/media-render — render engine entry.
 *
 * Pure, host-agnostic render function. No Firestore, no Vercel, no network.
 * Callers (an external worker: Cloud Run / GitHub Actions) supply a MediaStore
 * and a recipe; this module gathers client-scoped source media, builds 5s
 * segments, composes a square MP4, optionally applies a look filter and a music
 * track, and writes the output via the store.
 *
 * Recipe shape matches the plan's Data Model:
 *   {
 *     durationSeconds: 30,
 *     output: { width: 720, height: 720, fps: 30, format: 'mp4' },
 *     sourceFolders: ['skyline', 'neighborhood'],
 *     sourceFiles: [],                 // optional explicit "{folder}/{file}" refs
 *     arweaveAudioUrl: null,           // Phase 0: local path | file:// | store:{rel}
 *     arweaveMediaUrls: [],
 *     filter: { key: 'look_hard_bw_street_doc', intensity: 0.8 },
 *     overlay: { enabled: true, effect: 'retro_dust' },   // not applied in Phase 0
 *     logos: { topStoragePath: null, endStoragePath: null }, // not applied in Phase 0
 *     endCard: { mode: 'none', mediaPath: null, text: null },
 *     videoOrder: null                 // explicit "{folder}/{file}" ordering
 *   }
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { VideoSegmentCompositor } from './lib/VideoSegmentCompositor.js';
import { ArweaveAudioClient } from './lib/ArweaveAudioClient.js';
import { getFilter } from './lib/VideoFilters.js';
import { isMediaFile } from './lib/MediaStore.js';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);

function isImage(relPath) {
  return IMAGE_EXT.has(path.extname(relPath).toLowerCase());
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Gather candidate source files (relative "{folder}/{file}") for the recipe.
 * Discovery is client-scoped: it only looks under the store's source root.
 */
async function gatherSourceFiles(store, recipe) {
  // Explicit videoOrder wins, then explicit sourceFiles, then folder discovery.
  if (Array.isArray(recipe.videoOrder) && recipe.videoOrder.length) {
    return recipe.videoOrder.filter(isMediaFile);
  }
  if (Array.isArray(recipe.sourceFiles) && recipe.sourceFiles.length) {
    return recipe.sourceFiles.filter(isMediaFile);
  }

  let folders = Array.isArray(recipe.sourceFolders) ? recipe.sourceFolders : [];
  if (!folders.length) {
    folders = await store.listFolders();
  }

  const files = [];
  for (const folder of folders) {
    const folderFiles = await store.listFiles(folder);
    files.push(...folderFiles);
  }
  return shuffle(files);
}

/**
 * Render a remix MP4 from client-scoped source media.
 *
 * @param {object} params
 * @param {string} params.clientId
 * @param {object} params.recipe                 see module header
 * @param {import('./lib/MediaStore.js').LocalMediaStore} params.store
 * @param {string} params.outputPath             relative output path within the
 *                                               store's generated/ root,
 *                                               e.g. `${jobId}.mp4`
 * @param {object} [params.deps]                 injectable collaborators (tests)
 * @returns {Promise<{
 *   outputPath: string, storagePath: string, absolutePath: string,
 *   contentType: string, sizeBytes: number, width: number, height: number,
 *   durationSeconds: number, fps: number, segmentCount: number,
 *   sourceFolders: string[], usedFiles: string[]
 * }>}
 */
export async function renderRemix({ clientId, recipe = {}, store, outputPath, deps = {} }) {
  if (!clientId) throw new Error('[renderRemix] clientId is required');
  if (!store) throw new Error('[renderRemix] store is required');
  if (!outputPath) throw new Error('[renderRemix] outputPath is required');

  const output = recipe.output || {};
  const width = output.width || 720;
  const height = output.height || 720;
  const fps = output.fps || 30;
  const durationSeconds = recipe.durationSeconds || 30;
  const segmentDuration = 5;
  const segmentsNeeded = Math.ceil(durationSeconds / segmentDuration);

  const compositor =
    deps.compositor || new VideoSegmentCompositor({ width, height, fps });
  const audioClient = deps.audioClient || new ArweaveAudioClient();

  await compositor.init();
  try {
    // 1. Gather client-scoped source files.
    const candidates = await gatherSourceFiles(store, recipe);
    if (!candidates.length) {
      throw new Error(
        `[renderRemix] no source media found for client ${clientId} ` +
          `(folders: ${JSON.stringify(recipe.sourceFolders || 'all')})`
      );
    }

    // 2. Build the required number of segments, cycling through sources.
    const segmentPaths = [];
    const usedFiles = [];
    for (let i = 0; i < segmentsNeeded; i++) {
      const rel = candidates[i % candidates.length];
      const abs = store.resolveSource(rel);
      usedFiles.push(rel);
      const seg = isImage(rel)
        ? await compositor.createImageSegment(abs, segmentDuration)
        : await compositor.extractVideoSegment(abs, segmentDuration);
      segmentPaths.push(seg);
    }

    // 3. Concatenate to a single uniform clip.
    const concatPath = await compositor.concatSegments(segmentPaths, durationSeconds);

    // 4. Resolve the look filter.
    let filterString = null;
    if (recipe.filter && recipe.filter.key) {
      const intensity =
        typeof recipe.filter.intensity === 'number' ? recipe.filter.intensity : 0.8;
      const def = getFilter(recipe.filter.key, intensity);
      filterString = def ? def.filter : null;
    }

    // 5. Resolve optional music (local/store only in Phase 0).
    const audioPath = await audioClient.resolveAudio(recipe.arweaveAudioUrl || null, { store });

    // 6. Final pass -> write output via the store.
    const absOutput = await store.ensureOutputDir(outputPath);
    await compositor.finalize(concatPath, {
      filter: filterString,
      audioPath,
      durationSeconds,
      outputPath: absOutput,
    });

    const stats = await fs.stat(absOutput);

    return {
      outputPath,
      storagePath: `${store.storagePrefix}/generated/${outputPath}`,
      absolutePath: absOutput,
      contentType: 'video/mp4',
      sizeBytes: stats.size,
      width,
      height,
      durationSeconds,
      fps,
      segmentCount: segmentPaths.length,
      sourceFolders: recipe.sourceFolders || [],
      usedFiles,
    };
  } finally {
    await compositor.cleanup();
  }
}

export { VideoSegmentCompositor } from './lib/VideoSegmentCompositor.js';
export { ArweaveAudioClient } from './lib/ArweaveAudioClient.js';
export { LocalMediaStore, isMediaFile, safeRelative } from './lib/MediaStore.js';
export { getFilter, getAllFilterKeys, VIDEO_FILTERS } from './lib/VideoFilters.js';
