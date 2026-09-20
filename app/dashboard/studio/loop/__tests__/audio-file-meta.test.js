import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAudioFileMeta } from '../audio-file-meta.js';
import { encodeWavPcm16 } from '../wav-encode.js';

function toArrayBuffer(uint8) {
  return uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength);
}

// ── WAV ──────────────────────────────────────────────────────────────────

test('parseAudioFileMeta: parses a canonical PCM16 WAV header (rate/channels/bit depth)', () => {
  const channelData = [Float32Array.from([0, 0.5, -0.5, 1, -1])];
  const bytes = encodeWavPcm16({ channelData, sampleRate: 44100 });
  const meta = parseAudioFileMeta(toArrayBuffer(bytes));

  assert.ok(meta);
  assert.equal(meta.format, 'wav');
  assert.equal(meta.sampleRate, 44100);
  assert.equal(meta.channels, 1);
  assert.equal(meta.bitsPerSample, 16);
  assert.equal(meta.frameCount, 5);
  assert.equal(meta.durationSeconds, 5 / 44100);
});

test('parseAudioFileMeta: WAV — stereo channel count + a different sample rate round-trip', () => {
  const channelData = [Float32Array.from([0.1, 0.2, 0.3]), Float32Array.from([-0.1, -0.2, -0.3])];
  const bytes = encodeWavPcm16({ channelData, sampleRate: 48000 });
  const meta = parseAudioFileMeta(toArrayBuffer(bytes));

  assert.ok(meta);
  assert.equal(meta.sampleRate, 48000);
  assert.equal(meta.channels, 2);
  assert.equal(meta.frameCount, 3);
});

test('parseAudioFileMeta: WAV — header-only buffer (no data chunk) still parses fmt, frameCount/duration are null', () => {
  const full = encodeWavPcm16({ channelData: [Float32Array.from([0, 0, 0])], sampleRate: 44100 });
  const headerOnly = full.slice(0, 44); // just the 44-byte RIFF/fmt header, data chunk truncated away
  const meta = parseAudioFileMeta(toArrayBuffer(headerOnly));

  assert.ok(meta);
  assert.equal(meta.format, 'wav');
  assert.equal(meta.sampleRate, 44100);
  // The 'data' chunk header (id+size) is still present at byte 36-44 even
  // though the sample bytes themselves were truncated away, so dataSize
  // reads as 0 (min(declaredSize, remaining=0)) rather than null here.
  assert.equal(meta.frameCount, 0);
});

// ── AIFF ─────────────────────────────────────────────────────────────────

// Hand-built minimal FORM/AIFF file: FORM header + one COMM chunk. The
// sample-rate bytes `40 0E AC 44 00 00 00 00 00 00` are the well-known
// EXACT 80-bit IEEE-754-extended encoding of 44100.0 (biased exponent
// 0x400E = 16398 -> unbiased 15; mantissa 0xAC440000_00000000, whose top
// 16 bits are literally 0xAC44 = 44100 shifted into position — i.e.
// mantissa == 44100 * 2^48, so value == 44100 * 2^48 / 2^63 * 2^15 ==
// 44100 exactly, no floating-point round-trip error to worry about).
function buildAiffFixture({ channels = 2, bitsPerSample = 16, numSampleFrames = 100 } = {}) {
  const commBody = new Uint8Array(18);
  const commView = new DataView(commBody.buffer);
  commView.setUint16(0, channels, false);
  commView.setUint32(2, numSampleFrames, false);
  commView.setUint16(6, bitsPerSample, false);
  // 80-bit extended float for 44100 Hz, big-endian.
  commBody.set([0x40, 0x0e, 0xac, 0x44, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00], 8);

  const formSize = 4 /* 'AIFF' */ + 8 /* 'COMM' + size */ + commBody.length;
  const file = new Uint8Array(8 + formSize);
  const view = new DataView(file.buffer);
  const enc = new TextEncoder();

  file.set(enc.encode('FORM'), 0);
  view.setUint32(4, formSize, false);
  file.set(enc.encode('AIFF'), 8);
  file.set(enc.encode('COMM'), 12);
  view.setUint32(16, commBody.length, false);
  file.set(commBody, 20);

  return file;
}

test('parseAudioFileMeta: parses a FORM/AIFF COMM chunk (extended-float80 sample rate)', () => {
  const fixture = buildAiffFixture({ channels: 2, bitsPerSample: 16, numSampleFrames: 200 });
  const meta = parseAudioFileMeta(toArrayBuffer(fixture));

  assert.ok(meta);
  assert.equal(meta.format, 'aiff');
  assert.equal(meta.sampleRate, 44100);
  assert.equal(meta.channels, 2);
  assert.equal(meta.bitsPerSample, 16);
  assert.equal(meta.frameCount, 200);
  assert.equal(meta.durationSeconds, 200 / 44100);
});

test('parseAudioFileMeta: AIFC form type is accepted the same as AIFF', () => {
  const fixture = buildAiffFixture({ channels: 1, numSampleFrames: 10 });
  new TextEncoder().encodeInto('AIFC', fixture.subarray(8, 12));
  const meta = parseAudioFileMeta(toArrayBuffer(fixture));
  assert.ok(meta);
  assert.equal(meta.format, 'aiff');
  assert.equal(meta.channels, 1);
});

// ── Unrecognized / degenerate input ─────────────────────────────────────

test('parseAudioFileMeta: returns null for unrecognized bytes (e.g. an MP3-ish buffer) and tiny/empty input', () => {
  const mp3ish = new Uint8Array([0xff, 0xfb, 0x90, 0x44, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(parseAudioFileMeta(toArrayBuffer(mp3ish)), null);
  assert.equal(parseAudioFileMeta(new ArrayBuffer(0)), null);
  assert.equal(parseAudioFileMeta(new ArrayBuffer(4)), null);
  assert.equal(parseAudioFileMeta(null), null);
  assert.equal(parseAudioFileMeta(undefined), null);
});

test('parseAudioFileMeta: RIFF/WAVE magic present but no fmt chunk -> null', () => {
  const file = new Uint8Array(20);
  const view = new DataView(file.buffer);
  const enc = new TextEncoder();
  file.set(enc.encode('RIFF'), 0);
  view.setUint32(4, 12, true);
  file.set(enc.encode('WAVE'), 8);
  file.set(enc.encode('JUNK'), 12);
  view.setUint32(16, 0, true);
  assert.equal(parseAudioFileMeta(toArrayBuffer(file)), null);
});
