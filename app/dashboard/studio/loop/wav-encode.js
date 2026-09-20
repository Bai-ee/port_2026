// Loop Studio — WAV/ZIP byte encoding. Pure binary construction (same
// standalone-module tier as loop-engine.js: no DOM, no Web Audio,
// no fetch/File — every export takes plain typed-array input and returns a
// Uint8Array). Directly testable under node:test by inspecting the emitted
// bytes.

const WAV_HEADER_BYTES = 44;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = 2;

function writeAscii(view, offset, str) {
  for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i) & 0xff);
}

/**
 * Encodes a slice of decoded audio (`channelData` — one Float32Array per
 * channel, as returned by `AudioBuffer.getChannelData`) as a complete,
 * self-contained 16-bit PCM RIFF/WAVE file. `[startSample, endSample)`
 * selects the slice (defaults to the whole buffer's length when `endSample`
 * is omitted); the source channel count and sample rate are preserved
 * exactly — this never resamples or downmixes.
 *
 * Each sample is clamped to [-1, 1], then scaled to a signed 16-bit
 * integer with the standard asymmetric int16 range
 * (`x < 0 ? x * 0x8000 : x * 0x7fff`), interleaved channel-by-channel per
 * frame, little-endian.
 */
export function encodeWavPcm16({ channelData, sampleRate, startSample = 0, endSample }) {
  const channels = Array.isArray(channelData) ? channelData : [];
  const numChannels = Math.max(1, channels.length);
  const sr = Number.isFinite(sampleRate) && sampleRate > 0 ? Math.round(sampleRate) : 44100;

  const sourceLength = channels[0] && typeof channels[0].length === 'number' ? channels[0].length : 0;
  const start = Number.isFinite(startSample) ? Math.max(0, Math.floor(startSample)) : 0;
  const end = Number.isFinite(endSample) ? Math.min(sourceLength, Math.floor(endSample)) : sourceLength;
  const frameCount = Math.max(0, end - start);

  const blockAlign = numChannels * BYTES_PER_SAMPLE;
  const byteRate = sr * blockAlign;
  const dataSize = frameCount * blockAlign;

  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true); // chunk size = file size - 8
  writeAscii(view, 8, 'WAVE');

  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt subchunk size (PCM)
  view.setUint16(20, 1, true); // audio format: 1 = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);

  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = WAV_HEADER_BYTES;
  for (let i = 0; i < frameCount; i += 1) {
    for (let ch = 0; ch < numChannels; ch += 1) {
      const src = channels[ch] || channels[0];
      const raw = src ? src[start + i] : 0;
      const clamped = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0;
      const scaled = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      view.setInt16(offset, Math.round(scaled), true);
      offset += 2;
    }
  }

  return bytes;
}

/** Linear resample for export-only compatibility paths. Preserves channel count. */
export function resampleChannelData(channelData, sourceRate, targetRate, startSample = 0, endSample) {
  const channels = Array.isArray(channelData) ? channelData : [];
  const srcRate = Number.isFinite(sourceRate) && sourceRate > 0 ? sourceRate : targetRate;
  const dstRate = Number.isFinite(targetRate) && targetRate > 0 ? targetRate : srcRate;
  const sourceLength = channels[0] && typeof channels[0].length === 'number' ? channels[0].length : 0;
  const start = Number.isFinite(startSample) ? Math.max(0, Math.floor(startSample)) : 0;
  const end = Number.isFinite(endSample) ? Math.min(sourceLength, Math.floor(endSample)) : sourceLength;
  const frameCount = Math.max(0, end - start);
  if (!frameCount) return channels.map(() => new Float32Array(0));
  if (Math.round(srcRate) === Math.round(dstRate)) {
    return channels.map((ch) => ch.slice(start, end));
  }

  const ratio = srcRate / dstRate;
  const outFrames = Math.max(1, Math.round(frameCount / ratio));
  return channels.map((ch) => {
    const out = new Float32Array(outFrames);
    for (let i = 0; i < outFrames; i += 1) {
      const srcPos = start + i * ratio;
      const lo = Math.floor(srcPos);
      const hi = Math.min(end - 1, lo + 1);
      const t = srcPos - lo;
      const a = ch?.[lo] ?? 0;
      const b = ch?.[hi] ?? a;
      out[i] = a + (b - a) * t;
    }
    return out;
  });
}

let crcTable = null;
function getCrcTable() {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

/** Standard table-based CRC-32 (polynomial 0xEDB88320) over `bytes`, as an unsigned 32-bit integer. Used by buildStoreZip's local/central headers. */
export function crc32(bytes) {
  const table = getCrcTable();
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let crc = 0xffffffff;
  for (let i = 0; i < arr.length; i += 1) {
    crc = table[(crc ^ arr[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIR_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const LOCAL_HEADER_FIXED_SIZE = 30;
const CENTRAL_HEADER_FIXED_SIZE = 46;
const EOCD_SIZE = 22;
// Fixed, valid DOS date/time (Jan 1 1980, 00:00:00) — a ZIP local/central
// header requires SOME value here, but nothing downstream (Loop Studio's
// export flow, Archive Utility, `unzip`) reads it, so one fixed constant
// avoids threading a real timestamp through this pure module.
const DOS_TIME = 0;
const DOS_DATE = 0x21;

function asciiBytes(str) {
  const s = typeof str === 'string' ? str : String(str ?? '');
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) bytes[i] = s.charCodeAt(i) & 0xff;
  return bytes;
}

/**
 * Builds an uncompressed ("store", method 0) ZIP archive from
 * `entries: [{ name, data: Uint8Array }, ...]` — no dependency on a
 * compression library, since Loop Studio's WAV slices are already compact
 * and store-mode ZIPs are trivially correct to construct and verify.
 * Produces a standard local-file-header + central-directory + EOCD layout
 * that opens in macOS Archive Utility and `unzip`.
 */
export function buildStoreZip(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const prepped = list.map((e) => {
    const nameBytes = asciiBytes(e?.name);
    const data = e?.data instanceof Uint8Array ? e.data : new Uint8Array(0);
    return { nameBytes, data, crc: crc32(data) };
  });

  const localOffsets = [];
  let localSectionSize = 0;
  prepped.forEach((p) => {
    localOffsets.push(localSectionSize);
    localSectionSize += LOCAL_HEADER_FIXED_SIZE + p.nameBytes.length + p.data.length;
  });

  let centralSectionSize = 0;
  prepped.forEach((p) => { centralSectionSize += CENTRAL_HEADER_FIXED_SIZE + p.nameBytes.length; });

  const totalSize = localSectionSize + centralSectionSize + EOCD_SIZE;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  let pos = 0;
  prepped.forEach((p) => {
    view.setUint32(pos, LOCAL_FILE_HEADER_SIG, true); pos += 4;
    view.setUint16(pos, 20, true); pos += 2; // version needed to extract
    view.setUint16(pos, 0, true); pos += 2; // general purpose flags
    view.setUint16(pos, 0, true); pos += 2; // compression method: 0 = store
    view.setUint16(pos, DOS_TIME, true); pos += 2;
    view.setUint16(pos, DOS_DATE, true); pos += 2;
    view.setUint32(pos, p.crc, true); pos += 4;
    view.setUint32(pos, p.data.length, true); pos += 4; // compressed size (== raw for store)
    view.setUint32(pos, p.data.length, true); pos += 4; // uncompressed size
    view.setUint16(pos, p.nameBytes.length, true); pos += 2;
    view.setUint16(pos, 0, true); pos += 2; // extra field length
    bytes.set(p.nameBytes, pos); pos += p.nameBytes.length;
    bytes.set(p.data, pos); pos += p.data.length;
  });

  prepped.forEach((p, i) => {
    view.setUint32(pos, CENTRAL_DIR_SIG, true); pos += 4;
    view.setUint16(pos, 20, true); pos += 2; // version made by
    view.setUint16(pos, 20, true); pos += 2; // version needed to extract
    view.setUint16(pos, 0, true); pos += 2; // general purpose flags
    view.setUint16(pos, 0, true); pos += 2; // compression method: 0 = store
    view.setUint16(pos, DOS_TIME, true); pos += 2;
    view.setUint16(pos, DOS_DATE, true); pos += 2;
    view.setUint32(pos, p.crc, true); pos += 4;
    view.setUint32(pos, p.data.length, true); pos += 4;
    view.setUint32(pos, p.data.length, true); pos += 4;
    view.setUint16(pos, p.nameBytes.length, true); pos += 2;
    view.setUint16(pos, 0, true); pos += 2; // extra field length
    view.setUint16(pos, 0, true); pos += 2; // file comment length
    view.setUint16(pos, 0, true); pos += 2; // disk number start
    view.setUint16(pos, 0, true); pos += 2; // internal file attributes
    view.setUint32(pos, 0, true); pos += 4; // external file attributes
    view.setUint32(pos, localOffsets[i], true); pos += 4; // relative offset of local header
    bytes.set(p.nameBytes, pos); pos += p.nameBytes.length;
  });

  view.setUint32(pos, EOCD_SIG, true); pos += 4;
  view.setUint16(pos, 0, true); pos += 2; // this disk number
  view.setUint16(pos, 0, true); pos += 2; // disk where central directory starts
  view.setUint16(pos, prepped.length, true); pos += 2; // central directory records on this disk
  view.setUint16(pos, prepped.length, true); pos += 2; // total central directory records
  view.setUint32(pos, centralSectionSize, true); pos += 4; // central directory size
  view.setUint32(pos, localSectionSize, true); pos += 4; // central directory offset
  view.setUint16(pos, 0, true); pos += 2; // comment length

  return bytes;
}
