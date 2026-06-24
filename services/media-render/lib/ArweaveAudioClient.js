/**
 * ArweaveAudioClient (normalized, Phase 0)
 *
 * In EditVideos this client fetched DJ mixes/tracks from Arweave over the
 * network and was tightly coupled to Underground Existence artist catalogs.
 *
 * Phase 0 intentionally does NOT hit the network. This client resolves an
 * audio source to a LOCAL file path so the engine and tests stay offline:
 *
 *   - `file://...`  or a plain local path  -> used directly
 *   - `store:{relPath}`                     -> resolved via the MediaStore
 *
 * A real fetching implementation (downloading an Arweave/HTTP URL to a temp
 * file) belongs in a later phase, behind this same `resolveAudio()` seam.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class ArweaveAudioClient {
  /**
   * @param {object} [opts]
   * @param {boolean} [opts.allowNetwork=false]  reserved for a later phase
   */
  constructor({ allowNetwork = false } = {}) {
    this.allowNetwork = allowNetwork;
  }

  /**
   * Resolve an audio source descriptor to a local file path usable by ffmpeg.
   * @param {string|null} source   audio url/descriptor (recipe.arweaveAudioUrl)
   * @param {object} [ctx]
   * @param {import('./MediaStore.js').LocalMediaStore} [ctx.store]
   * @returns {Promise<string|null>}  local path, or null if no audio
   */
  async resolveAudio(source, { store } = {}) {
    if (!source) return null;

    // store-relative reference: store:{folder/file}
    if (source.startsWith('store:')) {
      const rel = source.slice('store:'.length);
      if (!store || typeof store.resolveSource !== 'function') {
        throw new Error('[ArweaveAudioClient] store: reference requires a store with resolveSource()');
      }
      const p = store.resolveSource(rel);
      await fs.access(p);
      return p;
    }

    // file:// URL
    if (source.startsWith('file://')) {
      const p = fileURLToPath(source);
      await fs.access(p);
      return p;
    }

    // network URL — disabled in Phase 0
    if (/^https?:\/\//i.test(source) || source.startsWith('ar://')) {
      if (!this.allowNetwork) {
        throw new Error(
          `[ArweaveAudioClient] network audio is disabled in Phase 0 (got: ${source}). ` +
            `Use a local file path, file:// URL, or store:{relPath}.`
        );
      }
      throw new Error('[ArweaveAudioClient] network fetching not implemented in Phase 0');
    }

    // plain local path
    const p = path.resolve(source);
    await fs.access(p);
    return p;
  }
}
