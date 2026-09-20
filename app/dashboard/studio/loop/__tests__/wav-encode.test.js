import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeWavPcm16, resampleChannelData, crc32, buildStoreZip,
} from '../wav-encode.js';

const asciiAt = (bytes, offset, len) => String.fromCharCode(...bytes.slice(offset, offset + len));

// ── encodeWavPcm16 ──────────────────────────────────────────────────────

test('encodeWavPcm16: RIFF/WAVE/fmt /data magic at the standard 44-byte-header offsets', () => {
  const channelData = [Float32Array.from([0, 0.5, -0.5, 1, -1])];
  const bytes = encodeWavPcm16({ channelData, sampleRate: 44100 });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  assert.equal(asciiAt(bytes, 0, 4), 'RIFF');
  assert.equal(asciiAt(bytes, 8, 4), 'WAVE');
  assert.equal(asciiAt(bytes, 12, 4), 'fmt ');
  assert.equal(asciiAt(bytes, 36, 4), 'data');

  const dataSize = 5 * 2; // 5 mono samples * 2 bytes
  assert.equal(bytes.length, 44 + dataSize);
  assert.equal(view.getUint32(4, true), 36 + dataSize, 'RIFF chunk size = file size - 8');
  assert.equal(view.getUint32(40, true), dataSize, 'data subchunk size');
  assert.equal(view.getUint16(20, true), 1, 'PCM audio format');
  assert.equal(view.getUint16(22, true), 1, 'mono channel count');
  assert.equal(view.getUint32(24, true), 44100, 'sample rate');
  assert.equal(view.getUint16(34, true), 16, 'bits per sample');
  assert.equal(view.getUint16(32, true), 2, 'block align = channels(1) * 2 bytes');
  assert.equal(view.getUint32(28, true), 44100 * 2, 'byte rate = sampleRate * blockAlign');
});

test('encodeWavPcm16: clamps out-of-range samples to the asymmetric int16 range before scaling', () => {
  const channelData = [Float32Array.from([2.0, -2.0, 0.5, -0.5, 0])];
  const bytes = encodeWavPcm16({ channelData, sampleRate: 48000 });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  assert.equal(view.getInt16(44 + 0 * 2, true), 32767, 'clamped +1 scales by 0x7fff');
  assert.equal(view.getInt16(44 + 1 * 2, true), -32768, 'clamped -1 scales by 0x8000');
  assert.equal(view.getInt16(44 + 2 * 2, true), Math.round(0.5 * 0x7fff));
  assert.equal(view.getInt16(44 + 3 * 2, true), Math.round(-0.5 * 0x8000));
  assert.equal(view.getInt16(44 + 4 * 2, true), 0);
});

test('encodeWavPcm16: interleaves multi-channel data per frame and preserves channel count', () => {
  const channelData = [Float32Array.from([0.5, -0.5]), Float32Array.from([0.25, -0.25])];
  const bytes = encodeWavPcm16({ channelData, sampleRate: 44100 });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  assert.equal(view.getUint16(22, true), 2, 'stereo channel count');
  assert.equal(view.getUint16(32, true), 4, 'block align = channels(2) * 2 bytes');
  const dataSize = 2 /* frames */ * 4 /* blockAlign */;
  assert.equal(view.getUint32(40, true), dataSize);

  // Frame 0: ch0 then ch1; Frame 1: ch0 then ch1.
  assert.equal(view.getInt16(44 + 0, true), Math.round(0.5 * 0x7fff));
  assert.equal(view.getInt16(44 + 2, true), Math.round(0.25 * 0x7fff));
  assert.equal(view.getInt16(44 + 4, true), Math.round(-0.5 * 0x8000));
  assert.equal(view.getInt16(44 + 6, true), Math.round(-0.25 * 0x8000));
});

test('encodeWavPcm16: startSample/endSample slices without resampling', () => {
  const channelData = [Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((v) => v / 10))];
  const bytes = encodeWavPcm16({ channelData, sampleRate: 22050, startSample: 2, endSample: 5 });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  assert.equal(view.getUint32(24, true), 22050, 'sample rate is preserved, never resampled');
  const dataSize = 3 * 2; // 3 sliced frames
  assert.equal(view.getUint32(40, true), dataSize);
  assert.equal(bytes.length, 44 + dataSize);
  assert.equal(view.getInt16(44 + 0, true), Math.round(0.2 * 0x7fff));
  assert.equal(view.getInt16(44 + 2, true), Math.round(0.3 * 0x7fff));
  assert.equal(view.getInt16(44 + 4, true), Math.round(0.4 * 0x7fff));
});

test('resampleChannelData: preserves channels and linearly resamples a sliced range', () => {
  const input = [
    Float32Array.from([0, 0.25, 0.5, 0.75, 1]),
    Float32Array.from([1, 0.75, 0.5, 0.25, 0]),
  ];
  const out = resampleChannelData(input, 4, 2, 1, 5);

  assert.equal(out.length, 2);
  assert.equal(out[0].length, 2);
  assert.deepEqual(Array.from(out[0]), [0.25, 0.75]);
  assert.deepEqual(Array.from(out[1]), [0.75, 0.25]);
});

// ── crc32 ────────────────────────────────────────────────────────────────

test('crc32: known test vector "123456789" -> 0xCBF43926', () => {
  const bytes = new TextEncoder().encode('123456789');
  assert.equal(crc32(bytes), 0xcbf43926);
});

test('crc32: empty input is 0', () => {
  assert.equal(crc32(new Uint8Array(0)), 0);
});

// ── buildStoreZip ────────────────────────────────────────────────────────

test('buildStoreZip: emits valid local header / central directory / EOCD signatures', () => {
  const entries = [
    { name: 'a.txt', data: Uint8Array.from([1, 2, 3]) },
    { name: 'loops/b.wav', data: new Uint8Array(0) },
  ];
  const zip = buildStoreZip(entries);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

  assert.equal(view.getUint32(0, true), 0x04034b50, 'first local file header signature');

  // EOCD is always the last 22 bytes for a store zip with no comment.
  const eocdOffset = zip.length - 22;
  assert.equal(view.getUint32(eocdOffset, true), 0x06054b50, 'EOCD signature');
  assert.equal(view.getUint16(eocdOffset + 10, true), entries.length, 'total central directory record count');
  assert.equal(view.getUint16(eocdOffset + 8, true), entries.length, 'central directory records on this disk');

  const cdOffset = view.getUint32(eocdOffset + 16, true);
  assert.equal(view.getUint32(cdOffset, true), 0x02014b50, 'first central directory record signature');
});

test('buildStoreZip: per-entry crc32/sizes/method/name round-trip correctly', () => {
  const dataA = Uint8Array.from([10, 20, 30, 40]);
  const dataB = new TextEncoder().encode('123456789');
  const entries = [{ name: 'clip-1.wav', data: dataA }, { name: 'clip-2.wav', data: dataB }];
  const zip = buildStoreZip(entries);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

  // First local header.
  let pos = 0;
  assert.equal(view.getUint32(pos, true), 0x04034b50); pos += 4;
  assert.equal(view.getUint16(pos, true), 20, 'version needed to extract'); pos += 2;
  assert.equal(view.getUint16(pos, true), 0, 'general purpose flags'); pos += 2;
  assert.equal(view.getUint16(pos, true), 0, 'compression method: store'); pos += 2;
  pos += 4; // skip DOS time/date
  assert.equal(view.getUint32(pos, true), crc32(dataA)); pos += 4;
  assert.equal(view.getUint32(pos, true), dataA.length, 'compressed size == raw size for store'); pos += 4;
  assert.equal(view.getUint32(pos, true), dataA.length, 'uncompressed size'); pos += 4;
  const nameLen = view.getUint16(pos, true); pos += 2;
  assert.equal(nameLen, 'clip-1.wav'.length);
  pos += 2; // extra field length
  assert.equal(asciiAt(zip, pos, nameLen), 'clip-1.wav');
  pos += nameLen;
  assert.deepEqual(zip.slice(pos, pos + dataA.length), dataA);

  // The archive must open cleanly: entry count matches, and the crc for the
  // second (text) entry matches the known CRC-32 test vector.
  assert.equal(crc32(dataB), 0xcbf43926);
});

test('buildStoreZip: empty entries list still produces a valid (empty) archive', () => {
  const zip = buildStoreZip([]);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  assert.equal(zip.length, 22, 'EOCD-only archive');
  assert.equal(view.getUint32(0, true), 0x06054b50);
  assert.equal(view.getUint16(8, true), 0);
  assert.equal(view.getUint16(10, true), 0);
});
