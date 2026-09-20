// Loop Studio — pure WAV/AIFF header parser. Same standalone-module tier as
// loop-engine.js/wav-encode.js: no DOM, no Web Audio, no fetch/File — every
// export takes a plain ArrayBuffer and returns a plain object or null.
//
// ── Why this exists ──────────────────────────────────────────────────────
// `AudioContext.decodeAudioData()` on a REGULAR (real-time) AudioContext
// decodes into that context's own sample rate — the device's output rate
// (commonly 48000 Hz), NOT the source file's rate (commonly 44100 Hz for a
// WAV/AIFF export). For a lossless source that's an unwanted resample: the
// resampling filter smears energy across whatever WAS a hard sample edge —
// including a loop's start/end boundary — which is what makes an otherwise
// bar-accurate cut sound audibly unclean at the seam. It also means every
// browser-side WAV export (`wav-encode.js`) re-encodes already-resampled,
// lossy floats instead of the original PCM.
//
// The fix is to decode lossless sources at their OWN rate — parse it here
// from the container header (no audio decode needed), then hand it to
// `new OfflineAudioContext(channels, 1, sourceRate).decodeAudioData(...)`
// (LoopStudio.jsx), which decodes AT `sourceRate` with no resample. Lossy
// formats (mp3/m4a/flac/ogg) have no such header this module recognizes —
// `parseAudioFileMeta` returns `null` for them and the caller falls back to
// a normal device-rate decode, same as before this module existed.

function readAscii(view, offset, length) {
  let s = '';
  for (let i = 0; i < length; i += 1) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

/**
 * Parses a RIFF/WAVE container's `fmt ` (+ `data`, if present) chunks.
 * Returns `{ format: 'wav', sampleRate, channels, bitsPerSample, frameCount,
 * durationSeconds }` (the last two `null` when no `data` chunk was found —
 * e.g. a header-only fixture) or `null` when `bytes` isn't a recognizable
 * RIFF/WAVE file or has no usable `fmt ` chunk.
 */
function parseWav(view, byteLength) {
  if (byteLength < 12) return null;
  if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') return null;

  let fmt = null;
  let dataSize = null;
  let offset = 12;
  while (offset + 8 <= byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const bodyStart = offset + 8;
    if (chunkId === 'fmt ' && !fmt && bodyStart + 16 <= byteLength) {
      fmt = {
        channels: view.getUint16(bodyStart + 2, true),
        sampleRate: view.getUint32(bodyStart + 4, true),
        bitsPerSample: view.getUint16(bodyStart + 14, true),
      };
    } else if (chunkId === 'data' && dataSize === null) {
      dataSize = Math.min(chunkSize, Math.max(0, byteLength - bodyStart));
    }
    // RIFF chunks are word-aligned: a chunk with an odd size has one pad byte.
    offset = bodyStart + chunkSize + (chunkSize % 2);
  }

  if (!fmt || !(fmt.sampleRate > 0) || !(fmt.channels > 0)) return null;

  const blockAlign = fmt.channels * Math.max(1, fmt.bitsPerSample / 8);
  const frameCount = dataSize != null && blockAlign > 0 ? Math.floor(dataSize / blockAlign) : null;
  return {
    format: 'wav',
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
    bitsPerSample: fmt.bitsPerSample,
    frameCount,
    durationSeconds: frameCount != null ? frameCount / fmt.sampleRate : null,
  };
}

/**
 * Decodes an 80-bit IEEE 754 extended-precision float (the AIFF `COMM`
 * chunk's sample-rate field), big-endian, starting at `offset` in `view`.
 * 1 sign bit + 15 exponent bits (bias 16383) + a 64-bit mantissa with an
 * EXPLICIT leading integer bit (unlike a regular double) — combined here as
 * `mantissa / 2^63 * 2^(exponent - 16383)`.
 */
function readExtendedFloat80(view, offset) {
  const sign = (view.getUint8(offset) & 0x80) ? -1 : 1;
  const exponent = ((view.getUint8(offset) & 0x7f) << 8) | view.getUint8(offset + 1);
  const hi = view.getUint32(offset + 2, false);
  const lo = view.getUint32(offset + 6, false);
  if (exponent === 0 && hi === 0 && lo === 0) return 0;
  const mantissa = hi * 4294967296 + lo; // hi * 2^32 + lo, as a double (ample precision for an audio sample rate)
  return sign * mantissa * (2 ** (exponent - 16383 - 63));
}

/**
 * Parses a FORM/AIFF or FORM/AIFC container's `COMM` chunk. Returns
 * `{ format: 'aiff', sampleRate, channels, bitsPerSample, frameCount,
 * durationSeconds }` (frame count/duration come straight from COMM's own
 * `numSampleFrames` field — no `SSND` chunk needed) or `null`.
 */
function parseAiff(view, byteLength) {
  if (byteLength < 12) return null;
  if (readAscii(view, 0, 4) !== 'FORM') return null;
  const formType = readAscii(view, 8, 4);
  if (formType !== 'AIFF' && formType !== 'AIFC') return null;

  let offset = 12;
  while (offset + 8 <= byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, false); // AIFF/IFF chunk headers are big-endian
    const bodyStart = offset + 8;
    if (chunkId === 'COMM' && bodyStart + 18 <= byteLength) {
      const channels = view.getUint16(bodyStart, false);
      const numSampleFrames = view.getUint32(bodyStart + 2, false);
      const bitsPerSample = view.getUint16(bodyStart + 6, false);
      const sampleRate = Math.round(readExtendedFloat80(view, bodyStart + 8));
      if (!(sampleRate > 0) || !(channels > 0)) return null;
      return {
        format: 'aiff',
        sampleRate,
        channels,
        bitsPerSample,
        frameCount: numSampleFrames,
        durationSeconds: numSampleFrames / sampleRate,
      };
    }
    // IFF/AIFF chunks are word-aligned like RIFF.
    offset = bodyStart + chunkSize + (chunkSize % 2);
  }
  return null;
}

/**
 * Parses `arrayBuffer`'s container header to recover the SOURCE sample
 * rate/channel count/bit depth (+ frame count/duration when available)
 * without decoding any audio — WAV (RIFF/`fmt `) and AIFF/AIFC
 * (FORM/`COMM`) only. Returns `null` for anything else (mp3, m4a, flac,
 * ogg, or a malformed/truncated file) — callers fall back to a normal
 * device-rate `AudioContext.decodeAudioData` in that case, same as before
 * this module existed.
 */
export function parseAudioFileMeta(arrayBuffer) {
  if (!arrayBuffer || typeof arrayBuffer.byteLength !== 'number' || arrayBuffer.byteLength < 12) return null;
  const view = new DataView(arrayBuffer);
  const byteLength = arrayBuffer.byteLength;
  return parseWav(view, byteLength) || parseAiff(view, byteLength);
}
