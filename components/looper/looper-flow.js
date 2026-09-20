// Pure, framework-free helpers for the /looper page's upload → analyze flow.
// Kept separate from LooperLandingPage.jsx so the file-validation and
// terminal-line logic can be unit tested without mounting React/three.js.
//
// NOTE: `npm test`'s glob (`app/**/__tests__/**/*.test.{js,mjs}` etc. — see
// package.json) does not cover `components/**`, so the sibling test file is
// NOT picked up by `npm test`. Run it directly instead:
//   node --test components/looper/__tests__/looper-flow.test.js

export const MAX_TRACK_BYTES = 100 * 1024 * 1024; // 100 MB cap, per the looper page spec

const ALLOWED_EXTENSIONS = ['.wav', '.aiff', '.aif', '.mp3', '.m4a', '.flac'];

/**
 * Format a byte count as a one-decimal MB string, e.g. `12.3`.
 */
export function formatMb(bytes) {
  const n = Number(bytes) || 0;
  return (n / (1024 * 1024)).toFixed(1);
}

/**
 * Validate a dropped/selected track file before it's handed to the engine.
 * Returns `{ ok: true }` or `{ ok: false, reason }` — never throws, so
 * callers can render `reason` directly as an inline error message.
 */
export function validateTrackFile(file) {
  if (!file) return { ok: false, reason: 'No file selected.' };

  if (file.size > MAX_TRACK_BYTES) {
    return { ok: false, reason: `File is too large (${formatMb(file.size)} MB) — max 100 MB.` };
  }

  const name = String(file.name || '').toLowerCase();
  const hasKnownExtension = ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
  const isAudioMime = typeof file.type === 'string' && file.type.startsWith('audio/');

  if (!hasKnownExtension && !isAudioMime) {
    return { ok: false, reason: 'Unsupported file type — drop a WAV, AIFF, MP3, M4A, or FLAC file.' };
  }

  return { ok: true };
}

/**
 * Turn a loopcore `/api/analyze` response (the object `detectGrid()`
 * resolves to — see app/dashboard/studio/loop/loopcore-client.js) into a
 * flat list of honest, real-data terminal lines: downbeat count,
 * classification, the analyzed region (only when it doesn't span the whole
 * track), and every analyzer warning. No line is fabricated — a field that's
 * absent from the response is simply skipped.
 */
export function buildResultLines(analysis) {
  if (!analysis || typeof analysis !== 'object') return [];
  const lines = [];

  if (Array.isArray(analysis.downbeat_times_seconds)) {
    const n = analysis.downbeat_times_seconds.length;
    lines.push(`${n} downbeat${n === 1 ? '' : 's'}`);
  }

  if (analysis.classification) {
    lines.push(`classification: ${analysis.classification}`);
  }

  const hasRegion = Number.isFinite(analysis.region_start_seconds) && Number.isFinite(analysis.region_end_seconds);
  if (hasRegion) {
    const spansFullTrack = analysis.region_start_seconds <= 0.001
      && (!Number.isFinite(analysis.duration_seconds)
        || Math.abs(analysis.region_end_seconds - analysis.duration_seconds) < 0.01);
    if (!spansFullTrack) {
      lines.push(`region ${analysis.region_start_seconds.toFixed(2)}s – ${analysis.region_end_seconds.toFixed(2)}s`);
    }
  }

  if (Array.isArray(analysis.warnings)) {
    analysis.warnings.forEach((w) => lines.push(`warning: ${w}`));
  }

  return lines;
}

/**
 * Resolve the engine-side path `sliceTrack()` needs from a `detectGrid()`
 * response — the analyze response's own `source_path` when present, falling
 * back to the upload step's `uploaded.path` (both are the same file on disk;
 * `source_path` is simply the field the engine's later `updateGrid()`
 * responses are documented to carry, per loopcore-client.js).
 */
export function resolveSourcePath(analysis) {
  if (!analysis || typeof analysis !== 'object') return null;
  return analysis.source_path || analysis.uploaded?.path || null;
}

/**
 * Format `bpm_final` for a terminal line — one decimal place when it's a
 * finite number, an em dash when the engine didn't return one.
 */
export function formatBpm(bpmFinal) {
  return Number.isFinite(bpmFinal) ? bpmFinal.toFixed(2) : '—';
}
