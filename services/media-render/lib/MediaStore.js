/**
 * MediaStore — storage abstraction seam for the media-render worker.
 *
 * Ported/normalized from EditVideos, where storage access was hardwired to a
 * single global Firebase Storage bucket with top-level folders (`skyline`,
 * `logos`, `videos`, `paper_backgrounds`, ...). In Hitloop every path MUST be
 * client-scoped:
 *
 *   source root:   clients/{clientId}/media/source/{folder}/{fileName}
 *   output:        clients/{clientId}/media/generated/{jobId}.mp4
 *
 * This interface is the only place that knows about the underlying storage.
 * Phase 0 ships a LocalMediaStore (local filesystem, for fixtures + tests).
 * A FirebaseMediaStore can be added later behind the same interface without
 * touching the render engine.
 *
 * Interface (all paths are RELATIVE to the source root unless noted):
 *   listFolders()            -> Promise<string[]>   folder names under source root
 *   listFiles(folder)        -> Promise<string[]>   relative paths "{folder}/{file}"
 *   readFile(relPath)        -> Promise<Buffer>     read a source file
 *   writeOutput(relPath, buf)-> Promise<string>     write generated output, returns a locator
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const MEDIA_EXTENSIONS = new Set([
  '.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', // video
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', // image
  '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', // audio
]);

/**
 * Normalize and validate a client-relative folder/file path.
 * Rejects absolute paths and traversal so a recipe can never escape the
 * client-scoped source root (pitfall: cross-client file access).
 */
export function safeRelative(relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw new Error(`[MediaStore] Invalid path: ${JSON.stringify(relPath)}`);
  }
  if (path.isAbsolute(relPath)) {
    throw new Error(`[MediaStore] Absolute paths are not allowed: ${relPath}`);
  }
  const normalized = path.normalize(relPath).replace(/^([.][/\\])+/, '');
  if (normalized.startsWith('..') || normalized.includes(`..${path.sep}`)) {
    throw new Error(`[MediaStore] Path traversal is not allowed: ${relPath}`);
  }
  return normalized;
}

export function isMediaFile(name) {
  return MEDIA_EXTENSIONS.has(path.extname(name).toLowerCase());
}

/**
 * LocalMediaStore — filesystem-backed store rooted at a single client's media dir.
 *
 * @param {object} opts
 * @param {string} opts.clientId       client id (for scoping + logging)
 * @param {string} opts.rootDir        absolute dir that represents
 *                                      `clients/{clientId}/media` on disk.
 *                                      `source/` and `generated/` live under it.
 */
export class LocalMediaStore {
  constructor({ clientId, rootDir }) {
    if (!clientId) throw new Error('[LocalMediaStore] clientId is required');
    if (!rootDir) throw new Error('[LocalMediaStore] rootDir is required');
    this.clientId = clientId;
    this.rootDir = path.resolve(rootDir);
    this.sourceRoot = path.join(this.rootDir, 'source');
    this.generatedRoot = path.join(this.rootDir, 'generated');
  }

  /** Canonical storage prefix this store represents (informational). */
  get storagePrefix() {
    return `clients/${this.clientId}/media`;
  }

  async listFolders() {
    let entries;
    try {
      entries = await fs.readdir(this.sourceRoot, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  }

  async listFiles(folder) {
    const safeFolder = safeRelative(folder);
    const dir = path.join(this.sourceRoot, safeFolder);
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    return entries
      .filter((e) => e.isFile() && isMediaFile(e.name))
      .map((e) => `${safeFolder}/${e.name}`)
      .sort();
  }

  async readFile(relPath) {
    const safe = safeRelative(relPath);
    return fs.readFile(path.join(this.sourceRoot, safe));
  }

  /** Absolute on-disk path for a source file (workers need a real path for ffmpeg). */
  resolveSource(relPath) {
    const safe = safeRelative(relPath);
    return path.join(this.sourceRoot, safe);
  }

  async writeOutput(relPath, buffer) {
    const safe = safeRelative(relPath);
    const dest = path.join(this.generatedRoot, safe);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, buffer);
    return dest;
  }

  /** Absolute on-disk path for an output (ffmpeg writes directly here). */
  resolveOutput(relPath) {
    const safe = safeRelative(relPath);
    return path.join(this.generatedRoot, safe);
  }

  async ensureOutputDir(relPath) {
    const dest = this.resolveOutput(relPath);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    return dest;
  }
}
