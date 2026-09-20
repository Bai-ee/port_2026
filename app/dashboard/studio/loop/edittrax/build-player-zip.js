// Loop Studio — EDITTRAX export orchestrator. Browser-only glue (uses
// `fetch` to pull the served template + its manifest) but otherwise a plain
// async function: no React, no DOM writes, no iframe/blob-URL lifecycle
// (that stays in EdittraxPlayerPanel.jsx). Wires together the two pure
// modules that already exist:
//   - ./edittrax-export.js's `generateTrackJs` (track.js text) and
//     `buildPlayerZipEntries` (zip entry assembly)
//   - ../wav-encode.js's `buildStoreZip` (zip byte encoding)
// This is the SAME `generateTrackJs` output shape the embedded player's
// srcdoc uses (see edittrax-export.js's top comment) — only `parts[].file`
// differs (`audio/seg.N.wav` here vs a `blob:` URL there).

import { generateTrackJs, buildPlayerZipEntries } from './edittrax-export.js';
import { buildStoreZip } from '../wav-encode.js';

/**
 * Fetches the served EDITTRAX player template's manifest and every file it
 * lists, as raw bytes. Never partially succeeds: a failed manifest fetch or
 * any missing/failed file fetch throws a descriptive error rather than
 * returning a partial template (a half-built export zip is worse than no
 * zip).
 *
 * @param {object} [args]
 * @param {string} [args.baseHref='/edittrax-player/'] - where the synced
 *   template + manifest.json are served from (see
 *   scripts/sync-edittrax-player.mjs).
 * @param {typeof fetch} [args.fetchImpl=fetch] - injectable for tests.
 * @returns {Promise<{manifest: object, templateBytesByPath: Map<string, Uint8Array>}>}
 */
export async function fetchTemplateBytes({ baseHref = '/edittrax-player/', fetchImpl = fetch } = {}) {
  const manifestUrl = `${baseHref}manifest.json`;
  const SYNC_HINT = 'Run scripts/sync-edittrax-player.mjs to (re)generate the served template + manifest.';

  let manifestRes;
  try {
    manifestRes = await fetchImpl(manifestUrl);
  } catch (err) {
    throw new Error(`fetchTemplateBytes: failed to reach ${manifestUrl} — ${String(err?.message || err)}. ${SYNC_HINT}`);
  }
  if (!manifestRes || !manifestRes.ok) {
    const status = manifestRes ? manifestRes.status : 'no response';
    throw new Error(`fetchTemplateBytes: manifest fetch failed (${status}) at ${manifestUrl}. ${SYNC_HINT}`);
  }

  const manifest = await manifestRes.json();
  const files = Array.isArray(manifest?.files) ? manifest.files : [];

  const templateBytesByPath = new Map();
  const failed = [];
  await Promise.all(files.map(async (f) => {
    const path = f?.path;
    if (typeof path !== 'string' || path === '') {
      failed.push(`${JSON.stringify(path)} (manifest entry missing a valid path)`);
      return;
    }
    try {
      const res = await fetchImpl(`${baseHref}${path}`);
      if (!res || !res.ok) {
        failed.push(`${path} (HTTP ${res ? res.status : 'no response'})`);
        return;
      }
      const buf = await res.arrayBuffer();
      templateBytesByPath.set(path, new Uint8Array(buf));
    } catch (err) {
      failed.push(`${path} (${String(err?.message || err)})`);
    }
  }));

  if (failed.length > 0) {
    throw new Error(`fetchTemplateBytes: failed to fetch template file(s): ${failed.join(', ')}`);
  }

  return { manifest, templateBytesByPath };
}

/**
 * Builds the complete, self-contained EDITTRAX player export zip: the
 * served template's files + a generated `track.js` (baking in bpm, part
 * order/lengths, and the loop-repeat counts the user set inside the
 * embedded player) + one `audio/seg.N.wav` per PART (the same loop assigned
 * to two slots yields two audio entries — a part sequence, not a
 * deduplicated sample set).
 *
 * @param {object} args
 * @param {string} args.projectBase - sanitized folder/file base (use
 *   `sanitizePlayerProjectBase` from ./edittrax-export.js before calling).
 * @param {number} args.bpm
 * @param {number} args.barsPerLoop - every studio loop is exactly this many
 *   bars (see the plan's §7 "length correctness" note) — used as every
 *   part's `length`.
 * @param {number[]} args.slots - ordered PART SEQUENCE of loop indices (a
 *   loop index may repeat).
 * @param {number[]} [args.counts] - per-slot loop-repeat count, aligned 1:1
 *   with `slots`; a missing/non-finite entry falls back to `1`.
 * @param {Uint8Array[]} args.audioBytesBySlot - per-slot WAV bytes, aligned
 *   1:1 with `slots` (same length required — one entry per part, even when
 *   the underlying loop repeats across slots).
 * @param {string} [args.baseHref='/edittrax-player/']
 * @param {typeof fetch} [args.fetchImpl=fetch]
 * @returns {Promise<{zipBytes: Uint8Array, filename: string}>}
 */
export async function buildEdittraxZipBytes({
  projectBase, bpm, barsPerLoop, slots, counts, audioBytesBySlot, baseHref = '/edittrax-player/', fetchImpl = fetch,
}) {
  if (!Array.isArray(slots) || slots.length === 0) {
    throw new Error('buildEdittraxZipBytes: slots must be a non-empty array');
  }
  if (!Array.isArray(audioBytesBySlot) || audioBytesBySlot.length !== slots.length) {
    const gotLength = Array.isArray(audioBytesBySlot) ? audioBytesBySlot.length : typeof audioBytesBySlot;
    throw new Error(`buildEdittraxZipBytes: audioBytesBySlot length (${gotLength}) must match slots length (${slots.length})`);
  }

  const parts = slots.map((loopIndex, i) => ({
    file: `audio/seg.${i + 1}.wav`,
    length: barsPerLoop,
    loop: Number.isFinite(counts?.[i]) ? counts[i] : 1,
  }));

  const trackJsText = generateTrackJs({
    bpm,
    parts,
    downloadName: `${projectBase}_EDIT.wav`,
  });

  const audioEntries = slots.map((loopIndex, i) => ({
    name: `seg.${i + 1}.wav`,
    data: audioBytesBySlot[i],
  }));

  const { manifest, templateBytesByPath } = await fetchTemplateBytes({ baseHref, fetchImpl });

  const entries = buildPlayerZipEntries({
    projectBase, manifest, templateBytesByPath, trackJsText, audioEntries,
  });

  const zipBytes = buildStoreZip(entries);

  return { zipBytes, filename: `${projectBase}-edittrax-player.zip` };
}
