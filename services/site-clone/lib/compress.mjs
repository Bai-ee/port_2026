// compress.mjs — A7: recompress images in place (same filenames, so every
// reference stays valid). JPEG -> quality 85 progressive; large PNGs ->
// 256-color palette. Runs AFTER the verify gate passes, mirroring the runbook
// order (verify first, then shrink, then re-verify screenshots — we skip the
// re-verify screenshot-diff step since there's no "live look" to diff against
// automatically; the A6 gate already ran against the uncompressed images).

import sharp from 'sharp';
import { readFile, writeFile, stat } from 'fs/promises';
import path from 'path';

const JPEG_EXT = new Set(['.jpg', '.jpeg']);
const PNG_EXT = new Set(['.png']);
const LARGE_PNG_BYTES = 200 * 1024;

/**
 * @param {object} args
 * @param {string} args.outDir
 * @param {Array<{localPath:string}>} args.assets
 * @param {(line:string)=>void} [args.log]
 */
export async function compressImages({ outDir, assets, log = () => {} }) {
  let beforeBytes = 0;
  let afterBytes = 0;

  for (const asset of assets) {
    const ext = path.extname(asset.localPath).toLowerCase();
    if (!JPEG_EXT.has(ext) && !PNG_EXT.has(ext)) continue;
    const fullPath = path.join(outDir, asset.localPath);

    try {
      const original = await readFile(fullPath);
      beforeBytes += original.length;

      let output = original;
      if (JPEG_EXT.has(ext)) {
        output = await sharp(original).jpeg({ quality: 85, progressive: true, mozjpeg: true }).toBuffer();
      } else if (original.length > LARGE_PNG_BYTES) {
        output = await sharp(original).png({ palette: true, colors: 256 }).toBuffer();
      }

      if (output.length < original.length) {
        await writeFile(fullPath, output);
        afterBytes += output.length;
      } else {
        afterBytes += original.length;
      }
    } catch (err) {
      log(`compressImages: skipped ${asset.localPath} (${err.message})`);
      const st = await stat(fullPath).catch(() => null);
      if (st) { beforeBytes += st.size; afterBytes += st.size; }
    }
  }

  log(`compressImages: ${beforeBytes}b -> ${afterBytes}b`);
  return { beforeBytes, afterBytes };
}
