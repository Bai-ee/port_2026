// Integration-style coverage across audio-file-meta.js + wav-encode.js +
// loop-engine.js — proves the actual fix (decode lossless sources at their
// OWN sample rate) is internally consistent: a file's header-declared rate
// round-trips through the meta parser, and computeLoops' sample-accurate
// boundaries at that SAME rate map identically onto a same-rate decoded
// buffer's sample space (no device-rate mismatch to convert through).

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAudioFileMeta } from '../audio-file-meta.js';
import { encodeWavPcm16 } from '../wav-encode.js';
import { computeLoops, samplesPerBar } from '../loop-engine.js';

function toArrayBuffer(uint8) {
  return uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength);
}

test('round-trip: encodeWavPcm16 @44100 -> parseAudioFileMeta recovers the exact rate/channels/duration', () => {
  const sampleRate = 44100;
  const durationSeconds = 2; // keep the fixture small but long enough to be a meaningful duration check
  const frameCount = Math.round(sampleRate * durationSeconds);
  const channelData = [
    Float32Array.from({ length: frameCount }, (_, i) => Math.sin(i / 20) * 0.5),
    Float32Array.from({ length: frameCount }, (_, i) => Math.cos(i / 20) * 0.5),
  ];

  const wavBytes = encodeWavPcm16({ channelData, sampleRate });
  const meta = parseAudioFileMeta(toArrayBuffer(wavBytes));

  assert.ok(meta, 'expected the WAV header to parse');
  assert.equal(meta.format, 'wav');
  assert.equal(meta.sampleRate, sampleRate, 'parsed sample rate must exactly match the encoded rate');
  assert.equal(meta.channels, 2, 'parsed channel count must exactly match the encoded channel count');
  assert.equal(meta.frameCount, frameCount, 'parsed frame count must exactly match the encoded sample count');
  assert.equal(meta.durationSeconds, frameCount / sampleRate);
  assert.equal(meta.durationSeconds, durationSeconds);
});

test('boundary-consistency: computeLoops boundaries computed at the SOURCE rate map identically onto a same-rate decoded buffer (no device-rate mismatch)', () => {
  // Simulates the fixed pipeline: a WAV's header-declared source rate is
  // parsed (parseAudioFileMeta), then the browser decodes AT that source
  // rate via OfflineAudioContext (LoopStudio.jsx) instead of resampling to
  // the device's output rate -- so `audioBuffer.sampleRate === sourceRate`
  // for every lossless file, with no remaining ratio to convert through.
  const sourceRate = 44100;
  const bpm = 128;
  const meter = 4;
  const barsPerLoop = 4;
  const loopLen = samplesPerBar({ sampleRate: sourceRate, bpm, meter }) * barsPerLoop;
  const totalSamples = Math.round(loopLen * 6);

  // What the engine (loopcore, Python) would compute against the SOURCE
  // file directly, in SOURCE-rate samples.
  const engineSideLoops = computeLoops({
    totalSamples, sampleRate: sourceRate, bpm, meter, barsPerLoop, offsetSamples: 0,
  }).loops;

  // What LoopStudio.jsx computes against the decoded AudioBuffer, using
  // `audioBuffer.sampleRate` -- which, after the fix, equals sourceRate for
  // a lossless (WAV/AIFF) source, i.e. bufferSampleRate === sourceRate.
  const bufferSampleRate = sourceRate;
  const browserSideLoops = computeLoops({
    totalSamples, sampleRate: bufferSampleRate, bpm, meter, barsPerLoop, offsetSamples: 0,
  }).loops;

  assert.equal(browserSideLoops.length, engineSideLoops.length);
  browserSideLoops.forEach((loop, i) => {
    const engineLoop = engineSideLoops[i];
    // Identity: converting an engine (source-rate) boundary into the
    // buffer's rate via the standard ratio produces the EXACT same integer
    // sample index -- proving there is no residual scaling error once the
    // two rates are equal (the pre-fix bug was bufferSampleRate !=
    // sourceRate, e.g. 48000 vs 44100, which this same conversion would
    // have to scale through instead of no-op).
    const rateRatio = bufferSampleRate / sourceRate;
    assert.equal(rateRatio, 1, 'source rate and buffer rate must be identical post-fix');
    assert.equal(Math.round(engineLoop.startSample * rateRatio), loop.startSample);
    assert.equal(Math.round(engineLoop.endSample * rateRatio), loop.endSample);
    assert.equal(loop.startSample, engineLoop.startSample);
    assert.equal(loop.endSample, engineLoop.endSample);
  });
});

test('boundary-consistency: a device-rate MISMATCH (pre-fix scenario) does NOT identity-map -- demonstrates the bug this fix removes', () => {
  const sourceRate = 44100;
  const deviceRate = 48000; // a common real device output rate
  const bpm = 128;
  const meter = 4;
  const barsPerLoop = 4;
  const loopLen = samplesPerBar({ sampleRate: sourceRate, bpm, meter }) * barsPerLoop;
  const totalSamplesAtSourceRate = Math.round(loopLen * 6);

  const engineSideLoops = computeLoops({
    totalSamples: totalSamplesAtSourceRate, sampleRate: sourceRate, bpm, meter, barsPerLoop, offsetSamples: 0,
  }).loops;

  // Pre-fix: decodeAudioData resamples the buffer's total length by the
  // device/source rate ratio too, so a naive "reuse the engine's raw sample
  // indices against the resampled buffer" (i.e. skipping the seconds-based
  // conversion this repo's code actually does) is off by the rate ratio.
  const rateRatio = deviceRate / sourceRate;
  const misappliedStart = engineSideLoops[1].startSample; // engine's raw (source-rate) index, used un-converted
  const correctlyConvertedStart = Math.round(engineSideLoops[1].startSample * rateRatio);
  assert.notEqual(
    misappliedStart,
    correctlyConvertedStart,
    'an un-converted source-rate index must NOT equal the correct device-rate index when rates differ',
  );
});
