import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BITRATE_PRESETS, getBitrateFor,
  MAX_REALTIME_PIXEL_FRAME_BUDGET, estimatePixelFrameWork,
  evaluateExportCapability,
  computeCropSourceResolution,
  DEFAULT_CAPTURE_FPS, HIGH_CAPTURE_FPS, HIGH_CAPTURE_FPS_THRESHOLD, chooseCaptureFps,
  MIN_SUSTAINABLE_CAPTURE_FPS, canSustainExportCapture, describeUnsustainableCapture,
  startExportCapture, startMediaRecorderWithFallback,
  evaluateLiveRecordEligibility, evaluateDisplaySurface, DISPLAY_SURFACE_TAB,
  computeDisplayCaptureRect, shouldRetryDisplayCaptureWithoutPreferCurrentTab,
  describeDisplayCaptureError,
  evaluateScreenShareEligibility, buildScreenShareRequest, buildBasicScreenShareRequest,
  shouldRetryScreenShareWithBasicOptions, describeScreenShareError,
  describeSharedSurfaceForScreen, computeScreenCoverFit,
} from '../video-export.js';

// ── Bitrate presets ──────────────────────────────────────────────────────

test('getBitrateFor returns the documented mp4/webm rates', () => {
  assert.equal(getBitrateFor('mp4'), 12_000_000);
  assert.equal(getBitrateFor('webm'), 8_000_000);
});

test('mp4 (H.264) bitrate is always higher than webm (VP9) — H.264 needs more bits/pixel for comparable quality', () => {
  assert.ok(BITRATE_PRESETS.mp4 > BITRATE_PRESETS.webm);
});

test('getBitrateFor returns null for an unrecognized format', () => {
  assert.equal(getBitrateFor('not-a-real-format'), null);
});

// ── Pixel-frame work budget ──────────────────────────────────────────────

test('estimatePixelFrameWork computes width*height*fps*seconds', () => {
  assert.equal(estimatePixelFrameWork({ width: 1920, height: 1080, fps: 30, seconds: 5 }), 1920 * 1080 * 30 * 5);
});

test('MAX_REALTIME_PIXEL_FRAME_BUDGET is exactly a 4K@30fps-for-15s budget (documented, not an arbitrary number)', () => {
  assert.equal(MAX_REALTIME_PIXEL_FRAME_BUDGET, 3840 * 2160 * 30 * 15);
});

// ── Capability/memory/resolution safeguard evaluation ────────────────────

const CAPABLE_DESKTOP = { maxTextureSize: 16384, deviceMemory: 16, hardwareConcurrency: 12, hasMediaRecorder: true, hasCaptureStream: true };

test('a fully-capable desktop is allowed for both 1x and 2x/4K with no warnings', () => {
  const r1x = evaluateExportCapability({ width: 1920, height: 1080, fps: 30, seconds: 5, ...CAPABLE_DESKTOP });
  assert.equal(r1x.allowed, true);
  assert.deepEqual(r1x.warnings, []);

  const r4k = evaluateExportCapability({ width: 3840, height: 2160, fps: 30, seconds: 5, ...CAPABLE_DESKTOP });
  assert.equal(r4k.allowed, true);
  assert.deepEqual(r4k.warnings, []);
});

test('missing MediaRecorder or captureStream support is a hard block, not a warning', () => {
  const noRecorder = evaluateExportCapability({ width: 1920, height: 1080, ...CAPABLE_DESKTOP, hasMediaRecorder: false });
  assert.equal(noRecorder.allowed, false);
  assert.match(noRecorder.reason, /not supported/);

  const noCaptureStream = evaluateExportCapability({ width: 1920, height: 1080, ...CAPABLE_DESKTOP, hasCaptureStream: false });
  assert.equal(noCaptureStream.allowed, false);
});

test('invalid dimensions (zero, negative, NaN, non-finite) are a hard block', () => {
  for (const bad of [0, -100, NaN, Infinity]) {
    assert.equal(evaluateExportCapability({ width: bad, height: 1080, ...CAPABLE_DESKTOP }).allowed, false, `width=${bad} must be rejected`);
    assert.equal(evaluateExportCapability({ width: 1920, height: bad, ...CAPABLE_DESKTOP }).allowed, false, `height=${bad} must be rejected`);
  }
});

test('a resolution exceeding the reported maxTextureSize is a hard block with an actionable reason', () => {
  const r = evaluateExportCapability({ width: 3840, height: 2160, ...CAPABLE_DESKTOP, maxTextureSize: 2048 });
  assert.equal(r.allowed, false);
  assert.match(r.reason, /maximum texture size/);
  assert.match(r.reason, /2048/);
});

test('an UNDEFINED maxTextureSize never blocks — absence of a signal is treated as "unknown", not "unsafe"', () => {
  const r = evaluateExportCapability({ width: 3840, height: 2160, deviceMemory: 16, hardwareConcurrency: 12 });
  assert.equal(r.allowed, true);
});

test('low reported deviceMemory (<4GB) warns ONLY for a high-resolution request (above 1080p), never for a standard 1x export', () => {
  const highRes = evaluateExportCapability({ width: 3840, height: 2160, fps: 30, seconds: 5, maxTextureSize: 16384, deviceMemory: 2, hardwareConcurrency: 8 });
  assert.equal(highRes.allowed, true);
  assert.ok(highRes.warnings.some((w) => /memory/i.test(w)));

  const standardRes = evaluateExportCapability({ width: 1920, height: 1080, fps: 30, seconds: 5, maxTextureSize: 16384, deviceMemory: 2, hardwareConcurrency: 8 });
  assert.equal(standardRes.allowed, true);
  assert.deepEqual(standardRes.warnings, []);
});

test('low hardwareConcurrency (<=2 cores) warns for a high-resolution request only', () => {
  const r = evaluateExportCapability({ width: 3840, height: 2160, fps: 30, seconds: 5, maxTextureSize: 16384, deviceMemory: 16, hardwareConcurrency: 2 });
  assert.equal(r.allowed, true);
  assert.ok(r.warnings.some((w) => /CPU cores/i.test(w)));
});

test('an UNDEFINED deviceMemory/hardwareConcurrency never produces a memory/CPU warning — absence is "unknown", never assumed low-end', () => {
  const r = evaluateExportCapability({ width: 3840, height: 2160, fps: 30, seconds: 5, maxTextureSize: 16384 });
  assert.equal(r.allowed, true);
  assert.deepEqual(r.warnings, []);
});

test('exceeding the real-time pixel-frame budget warns but still allows — this is a risk signal, not a block', () => {
  // 4K @ 60fps for 15s is well past the 4K@30fps-for-15s budget.
  const r = evaluateExportCapability({ width: 3840, height: 2160, fps: 60, seconds: 15, ...CAPABLE_DESKTOP });
  assert.equal(r.allowed, true);
  assert.ok(r.warnings.some((w) => /real-time browser encoding/i.test(w)));
});

test('a request comfortably under the pixel-frame budget produces no budget warning', () => {
  const r = evaluateExportCapability({ width: 1920, height: 1080, fps: 30, seconds: 5, ...CAPABLE_DESKTOP });
  assert.deepEqual(r.warnings, []);
});

test('multiple risk signals can accumulate into multiple distinct warnings, not just the first one found', () => {
  const r = evaluateExportCapability({
    width: 3840, height: 2160, fps: 60, seconds: 15,
    maxTextureSize: 16384, deviceMemory: 2, hardwareConcurrency: 2,
  });
  assert.equal(r.allowed, true);
  assert.ok(r.warnings.length >= 3, `expected memory + CPU + pixel-budget warnings, got ${r.warnings.length}: ${JSON.stringify(r.warnings)}`);
});

test('fps/seconds default to 30/5 when omitted, matching a typical export request shape', () => {
  const r = evaluateExportCapability({ width: 1920, height: 1080, ...CAPABLE_DESKTOP });
  assert.equal(r.allowed, true);
  assert.deepEqual(r.warnings, []);
});

test('non-finite/non-positive fps is a hard block, distinct from the dimension/support checks', () => {
  for (const bad of [0, -30, NaN, Infinity]) {
    const r = evaluateExportCapability({ width: 1920, height: 1080, fps: bad, ...CAPABLE_DESKTOP });
    assert.equal(r.allowed, false, `fps=${bad} must be rejected`);
    assert.match(r.reason, /frame rate/);
  }
});

test('non-finite/non-positive seconds is a hard block', () => {
  for (const bad of [0, -5, NaN, Infinity]) {
    const r = evaluateExportCapability({ width: 1920, height: 1080, seconds: bad, ...CAPABLE_DESKTOP });
    assert.equal(r.allowed, false, `seconds=${bad} must be rejected`);
    assert.match(r.reason, /duration/);
  }
});

test('a resolution exceeding maxRenderbufferSize is a hard block with an actionable reason', () => {
  const r = evaluateExportCapability({ width: 3840, height: 2160, ...CAPABLE_DESKTOP, maxRenderbufferSize: 2048 });
  assert.equal(r.allowed, false);
  assert.match(r.reason, /renderbuffer size/);
  assert.match(r.reason, /2048/);
});

test('a resolution exceeding maxViewportDims (either axis) is a hard block', () => {
  const overWidth = evaluateExportCapability({ width: 3840, height: 2160, ...CAPABLE_DESKTOP, maxViewportDims: [2048, 16384] });
  assert.equal(overWidth.allowed, false);
  assert.match(overWidth.reason, /viewport dimensions/);

  const overHeight = evaluateExportCapability({ width: 3840, height: 2160, ...CAPABLE_DESKTOP, maxViewportDims: [16384, 2048] });
  assert.equal(overHeight.allowed, false);
});

test('a resolution within all three GL limits (maxTextureSize/maxRenderbufferSize/maxViewportDims) is allowed', () => {
  const r = evaluateExportCapability({
    width: 3840, height: 2160, ...CAPABLE_DESKTOP,
    maxTextureSize: 16384, maxRenderbufferSize: 16384, maxViewportDims: [16384, 16384],
  });
  assert.equal(r.allowed, true);
});

test('an UNDEFINED maxRenderbufferSize/maxViewportDims never blocks — absence of a signal is "unknown", not "unsafe"', () => {
  const r = evaluateExportCapability({ width: 3840, height: 2160, deviceMemory: 16, hardwareConcurrency: 12 });
  assert.equal(r.allowed, true);
});

// ── computeCropSourceResolution ──────────────────────────────────────────

test('computeCropSourceResolution: the resulting source resolution, run back through the SAME crop math ClothStudio.jsx uses (computeFrameRect), reproduces the exact target dimensions — no upscaling needed', () => {
  // Mirrors ClothStudio.jsx's own computeFrameRect exactly, for verification only.
  const computeFrameRect = (cw, ch, aspect) => {
    let w = cw * 0.92;
    let h = w / aspect;
    if (h > ch * 0.92) { h = ch * 0.92; w = h * aspect; }
    return { w, h };
  };

  const cases = [
    // stage wider than the frame (height-constrained crop branch)
    { stageWidth: 2000, stageHeight: 900, targetWidth: 2160, targetHeight: 3840 },
    // stage narrower/taller than the frame (width-constrained crop branch)
    { stageWidth: 800, stageHeight: 1200, targetWidth: 1920, targetHeight: 1080 },
    // stage aspect very close to the frame aspect
    { stageWidth: 1600, stageHeight: 900, targetWidth: 3840, targetHeight: 2160 },
  ];
  for (const { stageWidth, stageHeight, targetWidth, targetHeight } of cases) {
    const source = computeCropSourceResolution({ stageWidth, stageHeight, targetWidth, targetHeight });
    assert.ok(source, `expected a result for ${JSON.stringify({ stageWidth, stageHeight, targetWidth, targetHeight })}`);
    const rect = computeFrameRect(source.width, source.height, targetWidth / targetHeight);
    assert.ok(Math.abs(rect.w - targetWidth) < 1, `crop width ${rect.w} must match target ${targetWidth} (source ${JSON.stringify(source)})`);
    assert.ok(Math.abs(rect.h - targetHeight) < 1, `crop height ${rect.h} must match target ${targetHeight}`);
    // Never upscaled: the source must be at least as large as the target in
    // both dimensions (the crop rect is a SUBSET of the source, by definition
    // of the 0.92 inset, so this should always hold — asserted explicitly as
    // the feature's own core guarantee).
    assert.ok(source.width >= targetWidth, 'source width must never be smaller than the target (would require upscaling)');
    assert.ok(source.height >= targetHeight, 'source height must never be smaller than the target (would require upscaling)');
  }
});

test('computeCropSourceResolution returns null for missing or non-positive inputs', () => {
  assert.equal(computeCropSourceResolution({ stageWidth: 0, stageHeight: 900, targetWidth: 1920, targetHeight: 1080 }), null);
  assert.equal(computeCropSourceResolution({ stageWidth: 1600, stageHeight: 900, targetWidth: -1, targetHeight: 1080 }), null);
  assert.equal(computeCropSourceResolution({ stageWidth: 1600, stageHeight: 900, targetHeight: 1080 }), null);
  assert.equal(computeCropSourceResolution({}), null);
});

test('computeCropSourceResolution returns integer (ceiled) dimensions, never fractional pixels', () => {
  const source = computeCropSourceResolution({ stageWidth: 1234, stageHeight: 777, targetWidth: 2160, targetHeight: 3840 });
  assert.ok(Number.isInteger(source.width));
  assert.ok(Number.isInteger(source.height));
});

// ── chooseCaptureFps ──────────────────────────────────────────────────────

test('chooseCaptureFps returns 30 (DEFAULT_CAPTURE_FPS) below the sustainability threshold', () => {
  assert.equal(chooseCaptureFps(0), DEFAULT_CAPTURE_FPS);
  assert.equal(chooseCaptureFps(30), DEFAULT_CAPTURE_FPS);
  assert.equal(chooseCaptureFps(HIGH_CAPTURE_FPS_THRESHOLD - 0.01), DEFAULT_CAPTURE_FPS);
});

test('chooseCaptureFps returns 60 (HIGH_CAPTURE_FPS) at or above the sustainability threshold', () => {
  assert.equal(chooseCaptureFps(HIGH_CAPTURE_FPS_THRESHOLD), HIGH_CAPTURE_FPS);
  assert.equal(chooseCaptureFps(60), HIGH_CAPTURE_FPS);
  assert.equal(chooseCaptureFps(144), HIGH_CAPTURE_FPS);
});

test('Codex re-review (P2): the threshold genuinely requires ~60fps, never a meaningfully lower rate like 55 — 55fps must NOT qualify as sustainable 60fps', () => {
  assert.ok(HIGH_CAPTURE_FPS_THRESHOLD >= 59, `threshold must be >= 59 to require real 60fps headroom, got ${HIGH_CAPTURE_FPS_THRESHOLD}`);
  assert.equal(chooseCaptureFps(55), DEFAULT_CAPTURE_FPS, '55fps is a genuinely different, lower frame rate than 60 and must fall back to 30, not be treated as sustainable 60');
});

test('chooseCaptureFps treats an invalid/non-finite measurement as "unknown" and defaults to 30, never assumes 60', () => {
  for (const bad of [NaN, -1, 0, Infinity, undefined, null]) {
    assert.equal(chooseCaptureFps(bad), DEFAULT_CAPTURE_FPS, `measuredFps=${bad} must default to 30`);
  }
});

// ── Export capture lifecycle (Codex re-review, P1) ──────────────────────────
// startExportCapture/startMediaRecorderWithFallback extract every external-
// API step of starting a recording that can throw — captureStream(),
// MediaRecorder construction, and the start(timeslice)→start() fallback —
// so each failure seam is independently testable with fakes, and so
// ClothStudio.jsx can wrap ONE call to each in ONE guarded try/catch that
// always restores state, regardless of where the failure happened.
// startExportCapture never resizes anything — it always captures at
// whatever resolution the caller's buildCaptureSource() already produced.

function makeFakeStream(trackCount = 2) {
  const tracks = Array.from({ length: trackCount }, () => ({ stopped: false, stop() { this.stopped = true; } }));
  return { tracks, getTracks: () => tracks };
}
function makeFakeSource({ captureStreamImpl, trackCount = 2 } = {}) {
  const stream = makeFakeStream(trackCount);
  return {
    stream,
    captureStream: captureStreamImpl || (() => stream),
  };
}

test('canSustainExportCapture: true at or above MIN_SUSTAINABLE_CAPTURE_FPS, false below it', () => {
  assert.equal(canSustainExportCapture(MIN_SUSTAINABLE_CAPTURE_FPS), true);
  assert.equal(canSustainExportCapture(MIN_SUSTAINABLE_CAPTURE_FPS + 5), true);
  assert.equal(canSustainExportCapture(MIN_SUSTAINABLE_CAPTURE_FPS - 1), false);
  assert.equal(canSustainExportCapture(1), false);
});

test('canSustainExportCapture: Codex re-review (P1) — an unmeasurable (NaN) reading now BLOCKS, deliberately NOT mirroring chooseCaptureFps\'s "unknown -> assume 30fps" default. Once document.hidden is ruled out by the caller, a stalled measurement on a visible tab means real trouble (GPU pressure, a lost WebGL context, severe throttling for some other reason) — treating it as safe would let the exact near-empty-capture failure this check exists to prevent through.', () => {
  assert.equal(canSustainExportCapture(NaN), false);
  assert.equal(canSustainExportCapture(undefined), false);
});

test('canSustainExportCapture: a real (finite) but nonsensical negative measurement is still treated as genuinely too slow, not "unknown"', () => {
  assert.equal(canSustainExportCapture(-5), false);
});

// Codex re-review (P1, round 5): the "can't sustain a usable capture"
// status message previously interpolated Math.round(measuredFps) directly,
// rendering the literal, meaningless "~NaNfps" whenever the measurement
// itself hadn't completed (the exact case a document.hidden-triggered
// measureSustainableFps ceiling-timeout produces).
test('describeUnsustainableCapture: a real finite measurement is reported by number', () => {
  assert.equal(describeUnsustainableCapture(12), ' (measured ~12fps)');
  assert.equal(describeUnsustainableCapture(26.7), ' (measured ~27fps)');
});

test('describeUnsustainableCapture: NaN never renders as "~NaNfps" — reports that throughput could not be measured instead', () => {
  assert.equal(describeUnsustainableCapture(NaN), ' (throughput could not be measured)');
  assert.equal(describeUnsustainableCapture(undefined), ' (throughput could not be measured)');
  assert.equal(describeUnsustainableCapture(Infinity), ' (throughput could not be measured)');
});

test('startExportCapture: successful path calls captureStream(captureFps) and constructs the MediaRecorder with the given mime/bitrate', () => {
  const fakeSource = makeFakeSource();
  let recorderArgs = null;
  class FakeMediaRecorder {
    constructor(stream, opts) { recorderArgs = { stream, opts }; }
  }
  const result = startExportCapture({
    buildCaptureSource: () => ({ source: fakeSource, stopCropCopy: null }),
    captureFps: 30, MediaRecorderCtor: FakeMediaRecorder, mime: 'video/mp4', videoBitsPerSecond: 45_000_000,
  });
  assert.ok(result.rec instanceof FakeMediaRecorder);
  assert.equal(recorderArgs.stream, fakeSource.stream);
  assert.deepEqual(recorderArgs.opts, { mimeType: 'video/mp4', videoBitsPerSecond: 45_000_000 });
});

test('startExportCapture: whatever buildCaptureSource() returns (the live canvas directly for frameId "off", or a crop-copy canvas for a fixed frame) is captured at the given fps unchanged', () => {
  const fakeSource = makeFakeSource();
  let capturedFpsArg = null;
  fakeSource.captureStream = (fps) => { capturedFpsArg = fps; return fakeSource.stream; };
  class FakeMediaRecorder { constructor() {} }
  startExportCapture({
    buildCaptureSource: () => ({ source: fakeSource, stopCropCopy: null }),
    captureFps: 60, MediaRecorderCtor: FakeMediaRecorder, mime: 'video/webm', videoBitsPerSecond: 8_000_000,
  });
  assert.equal(capturedFpsArg, 60);
});

test('startExportCapture: a captureStream() failure calls stopCropCopy() and propagates the error', () => {
  let stopCropCopyCalls = 0;
  const fakeSource = makeFakeSource({ captureStreamImpl: () => { throw new Error('captureStream not supported'); } });
  assert.throws(
    () => startExportCapture({
      buildCaptureSource: () => ({ source: fakeSource, stopCropCopy: () => { stopCropCopyCalls += 1; } }),
      captureFps: 30, MediaRecorderCtor: class {}, mime: 'video/mp4', videoBitsPerSecond: 12_000_000,
    }),
    /captureStream not supported/,
  );
  assert.equal(stopCropCopyCalls, 1, 'the crop-copy loop must be stopped even though captureStream() failed');
});

// Both assertions below must hold TOGETHER — the crop-copy loop stopped AND
// every already-allocated MediaStreamTrack released — when the
// MediaRecorder constructor itself is what throws.
test('startExportCapture: a MediaRecorder constructor failure stops every MediaStreamTrack and stopCropCopy(), then propagates', () => {
  let stopCropCopyCalls = 0;
  const fakeSource = makeFakeSource({ trackCount: 3 });
  class ThrowingMediaRecorder { constructor() { throw new Error('mimeType not supported'); } }
  assert.throws(
    () => startExportCapture({
      buildCaptureSource: () => ({ source: fakeSource, stopCropCopy: () => { stopCropCopyCalls += 1; } }),
      captureFps: 30, MediaRecorderCtor: ThrowingMediaRecorder, mime: 'video/mp4;codecs=bogus', videoBitsPerSecond: 12_000_000,
    }),
    /mimeType not supported/,
  );
  assert.equal(stopCropCopyCalls, 1);
  assert.ok(fakeSource.stream.getTracks().every((t) => t.stopped), 'every MediaStreamTrack must be stopped when the recorder construction fails');
});

test('startExportCapture: a buildCaptureSource() failure (e.g. 2D context creation) propagates directly — nothing yet to release', () => {
  assert.throws(
    () => startExportCapture({
      buildCaptureSource: () => { throw new Error('getContext("2d") returned null'); },
      captureFps: 30, MediaRecorderCtor: class {}, mime: 'video/mp4', videoBitsPerSecond: 12_000_000,
    }),
    /getContext\("2d"\) returned null/,
  );
});

// ── startMediaRecorderWithFallback ───────────────────────────────────────

function makeFakeRecorder(startImpls) {
  let call = 0;
  return {
    startCalls: [],
    start(...args) {
      this.startCalls.push(args);
      const impl = startImpls[call];
      call += 1;
      if (impl === 'throw') throw new Error(`start() call #${call} failed`);
      return impl;
    },
  };
}

test('startMediaRecorderWithFallback: the primary start(timesliceMs) succeeding never invokes the fallback', () => {
  const rec = makeFakeRecorder([undefined]);
  const result = startMediaRecorderWithFallback(rec, 500);
  assert.deepEqual(rec.startCalls, [[500]]);
  assert.equal(result.usedFallback, false);
});

test('startMediaRecorderWithFallback: the primary start(timesliceMs) throwing falls back to a bare start(), which succeeds', () => {
  const rec = makeFakeRecorder(['throw', undefined]);
  const result = startMediaRecorderWithFallback(rec, 500);
  assert.deepEqual(rec.startCalls, [[500], []]);
  assert.equal(result.usedFallback, true);
  assert.match(result.fallbackReason.message, /start\(\) call #1 failed/);
});

test('startMediaRecorderWithFallback: BOTH start(timesliceMs) and the fallback start() throwing propagates the SECOND failure — never silently swallowed', () => {
  const rec = makeFakeRecorder(['throw', 'throw']);
  assert.throws(() => startMediaRecorderWithFallback(rec, 500), /start\(\) call #2 failed/);
  assert.deepEqual(rec.startCalls, [[500], []], 'both attempts must have genuinely been made');
});

// ── Live-screen export guard (Go Live export-safety round) ─────────────────
// Pure decision + readiness contract — the seam the old fixed-1400ms timer
// guard failed at. ClothStudio.jsx wires real world state into these; every
// export path (PNG, transparent PNG, video, timeline) goes through the SAME
// runExportWithLiveGuard, so this logic guards all four.

import { evaluateLiveExportGuard, isLiveTeardownReady, planDeviceScreenSteps, shouldResumeLiveAfterExport } from '../video-export.js';

test('guard: live active + NO capture → capture-then-await (auto-obtain, never a silent block) — message is honest about capturing the website; the export callback must not run until the caller obtains a capture', () => {
  const verdict = evaluateLiveExportGuard({ clothShape: 'device', live: true, liveUrl: 'https://example.com', captureUrl: '' });
  assert.equal(verdict.action, 'capture-then-await');
  assert.match(verdict.message, /captur/i);
  assert.match(verdict.message, /website/i);
});

// Recovery round 2 (Defect 1 — "Quick Export exports a STALE capture"):
// a captureUrl that CARRIES provenance (captureSourceUrl/captureViewport)
// is only trusted while Live is active when that provenance matches the
// CURRENT liveUrl/viewport exactly. This fails under the pre-round-2 code,
// which trusted any non-empty captureUrl regardless of what it was
// actually a capture OF.
test('guard: live active + capture whose provenance is a DIFFERENT URL → capture-then-await (never await-readiness on a stale capture)', () => {
  const verdict = evaluateLiveExportGuard({
    clothShape: 'device', live: true, liveUrl: 'https://newsite.com', viewport: 'desktop',
    captureUrl: '/api/public/studio-device-capture?id=old', captureSourceUrl: 'https://example.com', captureViewport: 'desktop',
  });
  assert.equal(verdict.action, 'capture-then-await', 'a capture of a DIFFERENT site must never be trusted just because captureUrl is non-empty');
});

// Phase 6 (2026-08-04) — THE regression these two tests previously encoded
// backwards. An intermediate export-restore round made an unprovenanced
// captureUrl TRUSTED, assuming a legacy capture must be of the current site.
// The user's real saved scene proved otherwise: liveUrl "hitloop.agency"
// with a captureUrl pointing at a stored capture whose Firestore doc records
// `url: "https://example.com/"` — a genuinely successful capture of a
// DIFFERENT site. Trusting it made every export record the IANA "Example
// Domain" page while the live iframe on screen showed the real site.
//
// Absence of provenance is not evidence that a capture is of the current
// site; it is the absence of any evidence. This is also the rule
// planDeviceScreenSteps has always applied — the two functions used to
// disagree inside the same module.
test('guard: live active + capture with ABSENT provenance → capture-then-await (an unprovenanced capture can be of ANY site — the confirmed "exports example.com" defect)', () => {
  const verdict = evaluateLiveExportGuard({
    clothShape: 'device', live: true, liveUrl: 'https://hitloop.agency', viewport: 'desktop',
    captureUrl: '/api/public/studio-device-capture?id=legacy', // no captureSourceUrl/captureViewport at all
  });
  assert.equal(verdict.action, 'capture-then-await');
});

// The REAL runtime shape: ClothStudio.jsx's devicePrimary is initialized as
// {...DEFAULT_DEVICE_PRIMARY, ...saved.devicePrimary} — a plain JS spread
// never re-introduces a literally-`undefined` value for a key an old saved
// localStorage blob doesn't have, so a legacy scene reaches this function
// with captureSourceUrl/captureViewport as `''` (DEFAULT_DEVICE_PRIMARY's
// own "unset" sentinel), never actually `undefined`. The value comparison
// handles both identically — `'' === 'https://hitloop.agency'` is false.
test('guard: live active + capture with EMPTY-STRING provenance (the real ClothStudio.jsx runtime shape after its DEFAULT_DEVICE_PRIMARY merge) → capture-then-await', () => {
  const verdict = evaluateLiveExportGuard({
    clothShape: 'device', live: true, liveUrl: 'https://hitloop.agency', viewport: 'desktop',
    captureUrl: '/api/public/studio-device-capture?id=legacy', captureSourceUrl: '', captureViewport: '',
  });
  assert.equal(verdict.action, 'capture-then-await');
});

// The two functions in this module that answer "is this capture of the
// current live site" must never disagree again.
test('guard and pin planner agree on every provenance shape (they gave OPPOSITE answers for absent provenance before Phase 6)', () => {
  const cases = [
    { captureSourceUrl: '', captureViewport: '' },
    { captureSourceUrl: undefined, captureViewport: undefined },
    { captureSourceUrl: 'https://other.com', captureViewport: 'desktop' },
    { captureSourceUrl: 'https://hitloop.agency', captureViewport: 'mobile' },
    { captureSourceUrl: 'https://hitloop.agency', captureViewport: 'desktop' },
  ];
  for (const provenance of cases) {
    const guardTrusts = evaluateLiveExportGuard({
      clothShape: 'device', live: true, liveUrl: 'https://hitloop.agency', viewport: 'desktop',
      captureUrl: '/api/public/studio-device-capture?id=x', ...provenance,
    }).action === 'await-readiness';
    const plannerTrusts = planDeviceScreenSteps({
      clothShape: 'device',
      devicePrimary: {
        live: true, liveUrl: 'https://hitloop.agency', viewport: 'desktop',
        captureUrl: '/api/public/studio-device-capture?id=x', ...provenance,
      },
    }).steps[0] === 'use-capture';
    assert.equal(guardTrusts, plannerTrusts, `divergent trust for ${JSON.stringify(provenance)}`);
  }
});

test('guard: live active + capture whose provenance URL matches but VIEWPORT does not → capture-then-await', () => {
  const verdict = evaluateLiveExportGuard({
    clothShape: 'device', live: true, liveUrl: 'https://example.com', viewport: 'mobile',
    captureUrl: '/api/public/studio-device-capture?id=x', captureSourceUrl: 'https://example.com', captureViewport: 'desktop',
  });
  assert.equal(verdict.action, 'capture-then-await');
});

test('guard: live active + capture whose provenance matches BOTH url and viewport exactly → await-readiness (no redundant re-capture)', () => {
  const verdict = evaluateLiveExportGuard({
    clothShape: 'device', live: true, liveUrl: 'https://example.com', viewport: 'desktop',
    captureUrl: '/api/public/studio-device-capture?id=x', captureSourceUrl: 'https://example.com', captureViewport: 'desktop',
  });
  assert.equal(verdict.action, 'await-readiness');
});

test('guard: live NOT active → proceed untouched for every shape, regardless of any capture/provenance present', () => {
  assert.equal(evaluateLiveExportGuard({
    clothShape: 'device', live: false, liveUrl: 'https://example.com', viewport: 'desktop',
    captureUrl: '/api/public/studio-device-capture?id=x', captureSourceUrl: 'https://different-site.com', captureViewport: 'mobile',
  }).action, 'proceed', 'a non-live scene exports exactly what is on screen, no new capture, regardless of provenance mismatch');
  assert.equal(evaluateLiveExportGuard({ clothShape: 'device', live: true, liveUrl: '', captureUrl: '' }).action, 'proceed', 'live flag without a URL never actually built an iframe');
  assert.equal(evaluateLiveExportGuard({ clothShape: 'sheet', live: true, liveUrl: 'https://example.com', captureUrl: '' }).action, 'proceed', 'non-device shapes have no live screen');
});

test('readiness: requires iframe teardown AND alpha-punch restore AND captured texture AND >=1 committed frame — each signal individually gates', () => {
  const ready = { deviceLiveGone: true, screenMaterialRestored: true, capturedTextureApplied: true, framesSinceRestored: 1 };
  assert.equal(isLiveTeardownReady(ready), true);
  assert.equal(isLiveTeardownReady({ ...ready, deviceLiveGone: false }), false, 'iframe must be gone before captureStream can ever start');
  assert.equal(isLiveTeardownReady({ ...ready, screenMaterialRestored: false }), false, 'the alpha-punch hole material must be restored first');
  assert.equal(isLiveTeardownReady({ ...ready, capturedTextureApplied: false }), false, 'the captured texture must actually be the live screen map');
  assert.equal(isLiveTeardownReady({ ...ready, framesSinceRestored: 0 }), false, 'at least one frame must COMMIT with the restored state — zero elapsed frames is not readiness');
  assert.equal(isLiveTeardownReady({ ...ready, framesSinceRestored: NaN }), false);
});

// ── Device-screen SOURCE resolution planner (Interrupted export recovery,
// Phase A) — the pure priority classification pinDeviceScreenIfNeeded
// consults before any fetch/setState.

test('planDeviceScreenSteps: non-device scenes and a missing devicePrimary are a strict no-op — steps = [not-device, proceed]', () => {
  assert.deepEqual(planDeviceScreenSteps({ clothShape: 'sheet', devicePrimary: { live: true, liveUrl: 'https://example.com' } }), { steps: ['not-device', 'proceed'] });
  assert.deepEqual(planDeviceScreenSteps({ clothShape: 'tshirt', devicePrimary: { captureUrl: '/api/public/studio-device-capture?id=x' } }), { steps: ['not-device', 'proceed'] });
  assert.deepEqual(planDeviceScreenSteps({ clothShape: 'device', devicePrimary: null }), { steps: ['not-device', 'proceed'] });
});

test('planDeviceScreenSteps: case A — a pinned screenStill always wins regardless of any other field, even a stale live/liveUrl', () => {
  const plan = planDeviceScreenSteps({
    clothShape: 'device',
    devicePrimary: { screenStill: { sha256: 'a'.repeat(64), ext: 'png', width: 100, height: 100, bytes: 10 }, captureUrl: '/x', uploadAssetId: 'asset1', live: true, liveUrl: 'https://example.com' },
  });
  assert.deepEqual(plan, { steps: ['use-still', 'proceed'] });
});

test('planDeviceScreenSteps: case B — a captureUrl already present is used directly, no capture is obtained again', () => {
  const plan = planDeviceScreenSteps({
    clothShape: 'device',
    devicePrimary: { captureUrl: '/api/public/studio-device-capture?id=abc', uploadAssetId: '', live: false, liveUrl: '' },
  });
  assert.deepEqual(plan, { steps: ['use-capture', 'proceed'] });
});

// Recovery round 2 (Defect 1): planDeviceScreenSteps is pinDeviceScreenIfNeeded's
// own planner (Proof/Final Render's pin-before-submit path) — it needs the
// SAME provenance-aware trust rule the Quick Export guard above does, or a
// stale/foreign capture would get pinned and rendered server-side.
test('planDeviceScreenSteps: live active + capture whose provenance is a DIFFERENT URL → obtain-capture, not use-capture', () => {
  const plan = planDeviceScreenSteps({
    clothShape: 'device',
    devicePrimary: {
      captureUrl: '/api/public/studio-device-capture?id=old', captureSourceUrl: 'https://example.com', captureViewport: 'desktop',
      uploadAssetId: '', live: true, liveUrl: 'https://newsite.com', viewport: 'desktop',
    },
  });
  assert.deepEqual(plan, { steps: ['obtain-capture', 'proceed'] });
});

test('planDeviceScreenSteps: live active + capture with ABSENT provenance (legacy capture) → obtain-capture, never trusted blind', () => {
  const plan = planDeviceScreenSteps({
    clothShape: 'device',
    devicePrimary: { captureUrl: '/api/public/studio-device-capture?id=legacy', uploadAssetId: '', live: true, liveUrl: 'https://example.com', viewport: 'desktop' },
  });
  assert.deepEqual(plan, { steps: ['obtain-capture', 'proceed'] });
});

test('planDeviceScreenSteps: live active + capture whose provenance URL matches but viewport does not → obtain-capture', () => {
  const plan = planDeviceScreenSteps({
    clothShape: 'device',
    devicePrimary: {
      captureUrl: '/api/public/studio-device-capture?id=x', captureSourceUrl: 'https://example.com', captureViewport: 'mobile',
      uploadAssetId: '', live: true, liveUrl: 'https://example.com', viewport: 'desktop',
    },
  });
  assert.deepEqual(plan, { steps: ['obtain-capture', 'proceed'] });
});

test('planDeviceScreenSteps: live active + capture whose provenance matches BOTH url and viewport exactly → use-capture (no redundant re-capture)', () => {
  const plan = planDeviceScreenSteps({
    clothShape: 'device',
    devicePrimary: {
      captureUrl: '/api/public/studio-device-capture?id=x', captureSourceUrl: 'https://example.com', captureViewport: 'desktop',
      uploadAssetId: '', live: true, liveUrl: 'https://example.com', viewport: 'desktop',
    },
  });
  assert.deepEqual(plan, { steps: ['use-capture', 'proceed'] });
});

test('planDeviceScreenSteps: non-live scene with a capture uses it directly regardless of provenance — untouched by the live-trust rule', () => {
  const plan = planDeviceScreenSteps({
    clothShape: 'device',
    devicePrimary: {
      captureUrl: '/api/public/studio-device-capture?id=x', captureSourceUrl: 'https://different-site.com', captureViewport: 'mobile',
      uploadAssetId: '', live: false, liveUrl: 'https://example.com', viewport: 'desktop',
    },
  });
  assert.deepEqual(plan, { steps: ['use-capture', 'proceed'] });
});

test('planDeviceScreenSteps: case C — an uploadAssetId with no capture/still is used directly', () => {
  const plan = planDeviceScreenSteps({
    clothShape: 'device',
    devicePrimary: { captureUrl: '', uploadAssetId: 'asset-42', live: false, liveUrl: '' },
  });
  assert.deepEqual(plan, { steps: ['use-upload', 'proceed'] });
});

test('planDeviceScreenSteps: uploadAssetId wins over captureUrl if both are somehow set — matches factories.js deviceWantedScreenSource exactly (upload checked first)', () => {
  const plan = planDeviceScreenSteps({
    clothShape: 'device',
    devicePrimary: { captureUrl: '/api/public/studio-device-capture?id=x', uploadAssetId: 'asset-1', live: false, liveUrl: '' },
  });
  assert.deepEqual(plan, { steps: ['use-upload', 'proceed'] });
});

test('planDeviceScreenSteps: case D (the gap) — live/liveUrl with NO capture/upload/still requires obtain-capture, and it is ALWAYS steps[0]', () => {
  const plan = planDeviceScreenSteps({
    clothShape: 'device',
    devicePrimary: { captureUrl: '', uploadAssetId: '', live: true, liveUrl: 'https://example.com' },
  });
  assert.deepEqual(plan, { steps: ['obtain-capture', 'proceed'] });
  assert.equal(plan.steps.indexOf('obtain-capture'), 0, 'nothing (no upload/pin bytes read, nothing submitted) may precede obtaining the capture');
});

test('planDeviceScreenSteps: live flag without a liveUrl (never actually built an iframe) falls through to no-source, not obtain-capture', () => {
  const plan = planDeviceScreenSteps({ clothShape: 'device', devicePrimary: { captureUrl: '', uploadAssetId: '', live: true, liveUrl: '' } });
  assert.deepEqual(plan, { steps: ['use-none', 'proceed'] });
});

test('planDeviceScreenSteps: a device scene with NO source at all proceeds — the placeholder is the honest, supported render, never an error', () => {
  const plan = planDeviceScreenSteps({ clothShape: 'device', devicePrimary: { captureUrl: '', uploadAssetId: '', live: false, liveUrl: '' } });
  assert.deepEqual(plan, { steps: ['use-none', 'proceed'] });
  assert.equal(plan.steps.at(-1), 'proceed');
});

test('planDeviceScreenSteps: failure-ordering invariant holds across every case — "proceed" is always last, and any "obtain-capture" step is always first', () => {
  const cases = [
    { clothShape: 'sheet', devicePrimary: { live: true, liveUrl: 'https://x.com' } },
    { clothShape: 'device', devicePrimary: { screenStill: { sha256: 'b'.repeat(64), ext: 'jpg', width: 10, height: 10, bytes: 1 } } },
    { clothShape: 'device', devicePrimary: { captureUrl: '/api/public/studio-device-capture?id=1' } },
    { clothShape: 'device', devicePrimary: { uploadAssetId: 'a1' } },
    { clothShape: 'device', devicePrimary: { live: true, liveUrl: 'https://x.com' } },
    { clothShape: 'device', devicePrimary: {} },
  ];
  for (const input of cases) {
    const { steps } = planDeviceScreenSteps(input);
    assert.equal(steps.at(-1), 'proceed', `proceed must always be last for ${JSON.stringify(input)}`);
    const obtainIdx = steps.indexOf('obtain-capture');
    if (obtainIdx !== -1) assert.equal(obtainIdx, 0, 'obtain-capture must always be first when present');
  }
});

// ── Final Render live-URL precedence (STUDIO-DETERMINISTIC-FINAL-RENDER-
// SONNET-HANDOFF.md, "Live URL wired to Final Render" wiring round) ───────
// `preferLiveForFinalRender` defaults false — every test ABOVE this section
// already proves the default is byte-identical to the pre-existing
// behavior (none of them pass the flag). These cover the opt-in case only.

test('planDeviceScreenSteps: preferLiveForFinalRender + live active + NO other source → use-live, not obtain-capture', () => {
  const plan = planDeviceScreenSteps({
    clothShape: 'device',
    devicePrimary: { captureUrl: '', uploadAssetId: '', live: true, liveUrl: 'https://hitloop.agency/' },
    preferLiveForFinalRender: true,
  });
  assert.deepEqual(plan, { steps: ['use-live', 'proceed'] });
});

test('planDeviceScreenSteps: preferLiveForFinalRender + live active WINS over a coexisting captureUrl, regardless of its provenance', () => {
  const trustworthy = planDeviceScreenSteps({
    clothShape: 'device',
    devicePrimary: {
      captureUrl: '/api/public/studio-device-capture?id=x', captureSourceUrl: 'https://hitloop.agency/', captureViewport: 'desktop',
      uploadAssetId: '', live: true, liveUrl: 'https://hitloop.agency/', viewport: 'desktop',
    },
    preferLiveForFinalRender: true,
  });
  assert.deepEqual(trustworthy, { steps: ['use-live', 'proceed'] }, 'even a matching/trustworthy capture must not win over an explicitly active live URL for Final Render');

  const stale = planDeviceScreenSteps({
    clothShape: 'device',
    devicePrimary: {
      captureUrl: '/api/public/studio-device-capture?id=old', captureSourceUrl: 'https://different-site.com', captureViewport: 'mobile',
      uploadAssetId: '', live: true, liveUrl: 'https://hitloop.agency/', viewport: 'desktop',
    },
    preferLiveForFinalRender: true,
  });
  assert.deepEqual(stale, { steps: ['use-live', 'proceed'] });
});

test('planDeviceScreenSteps: preferLiveForFinalRender + live active WINS over a coexisting uploadAssetId', () => {
  const plan = planDeviceScreenSteps({
    clothShape: 'device',
    devicePrimary: { captureUrl: '', uploadAssetId: 'asset-1', live: true, liveUrl: 'https://hitloop.agency/' },
    preferLiveForFinalRender: true,
  });
  assert.deepEqual(plan, { steps: ['use-live', 'proceed'] });
});

test('planDeviceScreenSteps: preferLiveForFinalRender + live active WINS over a coexisting pinned screenStill', () => {
  const plan = planDeviceScreenSteps({
    clothShape: 'device',
    devicePrimary: {
      screenStill: { sha256: 'c'.repeat(64), ext: 'png', width: 100, height: 100, bytes: 10 },
      live: true, liveUrl: 'https://hitloop.agency/',
    },
    preferLiveForFinalRender: true,
  });
  assert.deepEqual(plan, { steps: ['use-live', 'proceed'] });
});

test('planDeviceScreenSteps: preferLiveForFinalRender with live NOT active behaves exactly like the default — screenStill/upload/capture precedence untouched', () => {
  assert.deepEqual(
    planDeviceScreenSteps({ clothShape: 'device', devicePrimary: { screenStill: { sha256: 'd'.repeat(64), ext: 'png', width: 1, height: 1, bytes: 1 }, live: false, liveUrl: '' }, preferLiveForFinalRender: true }),
    { steps: ['use-still', 'proceed'] },
  );
  assert.deepEqual(
    planDeviceScreenSteps({ clothShape: 'device', devicePrimary: { uploadAssetId: 'asset-9', live: false, liveUrl: '' }, preferLiveForFinalRender: true }),
    { steps: ['use-upload', 'proceed'] },
  );
  assert.deepEqual(
    planDeviceScreenSteps({ clothShape: 'device', devicePrimary: { captureUrl: '/api/public/studio-device-capture?id=x', live: false, liveUrl: '' }, preferLiveForFinalRender: true }),
    { steps: ['use-capture', 'proceed'] },
  );
  assert.deepEqual(
    planDeviceScreenSteps({ clothShape: 'device', devicePrimary: { live: false, liveUrl: 'https://hitloop.agency/' }, preferLiveForFinalRender: true }),
    { steps: ['use-none', 'proceed'] },
    'live:false means NOT active even with preferLiveForFinalRender — matches the same liveActive definition used everywhere else in this module',
  );
});

test('planDeviceScreenSteps: preferLiveForFinalRender + live:true but blank liveUrl never produces use-live (liveActive requires BOTH)', () => {
  const plan = planDeviceScreenSteps({
    clothShape: 'device',
    devicePrimary: { captureUrl: '', uploadAssetId: '', live: true, liveUrl: '' },
    preferLiveForFinalRender: true,
  });
  assert.deepEqual(plan, { steps: ['use-none', 'proceed'] });
});

test('planDeviceScreenSteps: preferLiveForFinalRender is a strict no-op for a non-device scene', () => {
  const plan = planDeviceScreenSteps({ clothShape: 'sheet', devicePrimary: { live: true, liveUrl: 'https://hitloop.agency/' }, preferLiveForFinalRender: true });
  assert.deepEqual(plan, { steps: ['not-device', 'proceed'] });
});

test('planDeviceScreenSteps: failure-ordering invariant also holds with preferLiveForFinalRender — "proceed" always last, "use-live"/"obtain-capture" always first when present', () => {
  const cases = [
    { clothShape: 'device', devicePrimary: { live: true, liveUrl: 'https://x.com' }, preferLiveForFinalRender: true },
    { clothShape: 'device', devicePrimary: { screenStill: { sha256: 'e'.repeat(64), ext: 'jpg', width: 10, height: 10, bytes: 1 } }, preferLiveForFinalRender: true },
    { clothShape: 'device', devicePrimary: { captureUrl: '/api/public/studio-device-capture?id=1' }, preferLiveForFinalRender: true },
    { clothShape: 'device', devicePrimary: {}, preferLiveForFinalRender: true },
  ];
  for (const input of cases) {
    const { steps } = planDeviceScreenSteps(input);
    assert.equal(steps.at(-1), 'proceed', `proceed must always be last for ${JSON.stringify(input)}`);
    const firstStepMustLeadIf = ['use-live', 'obtain-capture'].find((s) => steps.includes(s));
    if (firstStepMustLeadIf) assert.equal(steps[0], firstStepMustLeadIf, `${firstStepMustLeadIf} must always be first when present`);
  }
});

// ── Live-resume decision (Recovery round 2, Defect 1's secondary
// contributor — "Live is deliberately NOT auto-resumed") ──────────────────
// shouldResumeLiveAfterExport is invoked identically by ClothStudio.jsx's
// resumeLiveAfterExport glue regardless of WHY the export attempt settled
// (natural completion, a user Cancel click, or any failure) — the decision
// itself only cares about mount state + whether the screen source changed
// since the guard paused Live, never the outcome. `pending` mirrors exactly
// what runExportWithLiveGuard stashes on `world.pendingLiveResume`.

const RESUME_PENDING = { liveUrl: 'https://example.com', captureUrlAtPause: '/api/public/studio-device-capture?id=x', uploadAssetIdAtPause: '' };

test('shouldResumeLiveAfterExport: was-live + the export attempt completed (nothing changed) → resume', () => {
  const result = shouldResumeLiveAfterExport({
    mounted: true, pending: RESUME_PENDING,
    currentCaptureUrl: RESUME_PENDING.captureUrlAtPause, currentUploadAssetId: '', currentLive: false,
  });
  assert.equal(result, true);
});

test('shouldResumeLiveAfterExport: failure and cancel exit paths are indistinguishable to this decision — same inputs as a successful completion still resume (the CALLER decides when to invoke it, not this function)', () => {
  // Simulates the exact call shape resumeLiveAfterExport makes from
  // exportVideo's cleanup() on a cancel or any failure — identical to the
  // success case above; this function has no "outcome" input at all.
  const result = shouldResumeLiveAfterExport({
    mounted: true, pending: RESUME_PENDING,
    currentCaptureUrl: RESUME_PENDING.captureUrlAtPause, currentUploadAssetId: '', currentLive: false,
  });
  assert.equal(result, true);
});

test('shouldResumeLiveAfterExport: nothing was paused for this attempt (pending is null — the guard\'s own "proceed" verdict, or an already-consumed resume) → never resume', () => {
  assert.equal(shouldResumeLiveAfterExport({
    mounted: true, pending: null, currentCaptureUrl: '', currentUploadAssetId: '', currentLive: false,
  }), false);
});

test('shouldResumeLiveAfterExport: the screen source changed mid-export (a DIFFERENT capture selected) → no resume', () => {
  const result = shouldResumeLiveAfterExport({
    mounted: true, pending: RESUME_PENDING,
    currentCaptureUrl: '/api/public/studio-device-capture?id=some-other-capture', currentUploadAssetId: '', currentLive: false,
  });
  assert.equal(result, false);
});

test('shouldResumeLiveAfterExport: the screen source changed mid-export ("Use placeholder" cleared captureUrl) → no resume', () => {
  const result = shouldResumeLiveAfterExport({
    mounted: true, pending: RESUME_PENDING,
    currentCaptureUrl: '', currentUploadAssetId: '', currentLive: false,
  });
  assert.equal(result, false);
});

test('shouldResumeLiveAfterExport: the screen source changed mid-export (an upload was selected instead) → no resume', () => {
  const result = shouldResumeLiveAfterExport({
    mounted: true, pending: RESUME_PENDING,
    currentCaptureUrl: RESUME_PENDING.captureUrlAtPause, currentUploadAssetId: 'asset-42', currentLive: false,
  });
  assert.equal(result, false);
});

test('shouldResumeLiveAfterExport: the user already re-enabled Go Live themselves mid-export → never stomp their own choice', () => {
  const result = shouldResumeLiveAfterExport({
    mounted: true, pending: RESUME_PENDING,
    currentCaptureUrl: RESUME_PENDING.captureUrlAtPause, currentUploadAssetId: '', currentLive: true,
  });
  assert.equal(result, false);
});

test('shouldResumeLiveAfterExport: unmount → no resume, even with an otherwise-resumable pending snapshot', () => {
  const result = shouldResumeLiveAfterExport({
    mounted: false, pending: RESUME_PENDING,
    currentCaptureUrl: RESUME_PENDING.captureUrlAtPause, currentUploadAssetId: '', currentLive: false,
  });
  assert.equal(result, false);
});

// ── Teardown-deadline decision (export-restore Phase 5) ────────────────────
// The two user-reported symptoms — "Export timeline gives me a blank screen"
// and "the render button loses the live url site and records an example
// domain" — are the two states Phase 1's unconditional "proceed anyway"
// happily recorded. These assert the deadline never records either one, and
// that a scene with nothing wrong on screen still exports (Phase 1's intent).

import { evaluateLiveTeardownDeadline } from '../video-export.js';

const SETTLED = {
  deviceLiveGone: true, screenMaterialRestored: true, capturedTextureApplied: true,
  wantsCapturedScreen: true, screenCaptureError: null,
};

test('deadline: the live iframe is still up → STOP (recording it punches a transparent alpha hole — a device filling the frame records as a blank file)', () => {
  const verdict = evaluateLiveTeardownDeadline({ ...SETTLED, deviceLiveGone: false });
  assert.equal(verdict.action, 'stop');
  assert.match(verdict.message, /transparent hole/i);
});

test('deadline: the alpha-punch cut-out material is still on the screen mesh → STOP for the same reason, even with the iframe gone', () => {
  const verdict = evaluateLiveTeardownDeadline({ ...SETTLED, deviceLiveGone: true, screenMaterialRestored: false });
  assert.equal(verdict.action, 'stop');
  assert.match(verdict.message, /transparent hole/i);
});

test('deadline: an unresolved screen-capture LOAD FAILURE → STOP, naming the URL (never silently record the procedural placeholder site — the reported "example domain")', () => {
  const verdict = evaluateLiveTeardownDeadline({
    ...SETTLED, capturedTextureApplied: false,
    screenCaptureError: { url: '/api/public/studio-device-capture?id=abc&v=1', reason: 'route' },
  });
  assert.equal(verdict.action, 'stop');
  assert.match(verdict.message, /studio-device-capture\?id=abc/);
  assert.match(verdict.message, /placeholder/i, 'the message must say what would otherwise have been recorded');
});

test('deadline: a FOREIGN (non-route) capture reference says so explicitly — that failure can never resolve by retrying', () => {
  const verdict = evaluateLiveTeardownDeadline({
    ...SETTLED, capturedTextureApplied: false,
    screenCaptureError: { url: 'https://storage.example/legacy.jpg', reason: 'foreign' },
  });
  assert.equal(verdict.action, 'stop');
  assert.match(verdict.message, /never load/i);
});

test('deadline: a screen SOURCE exists but never became the screen map (no recorded error) → STOP rather than record the placeholder', () => {
  const verdict = evaluateLiveTeardownDeadline({ ...SETTLED, capturedTextureApplied: false });
  assert.equal(verdict.action, 'stop');
  assert.match(verdict.message, /placeholder/i);
});

test('deadline: everything settled but the frame counter simply never landed → PROCEED (Phase 1 intent preserved: a guard hiccup must not block an export)', () => {
  assert.equal(evaluateLiveTeardownDeadline(SETTLED).action, 'proceed');
});

test('deadline: no screen source at all (the placeholder IS the deliberate choice) → PROCEED even with capturedTextureApplied false', () => {
  const verdict = evaluateLiveTeardownDeadline({
    ...SETTLED, capturedTextureApplied: false, wantsCapturedScreen: false,
  });
  assert.equal(verdict.action, 'proceed');
});

test('deadline: a live-iframe failure outranks a capture failure — the hole is reported first, since it is the more destructive of the two', () => {
  const verdict = evaluateLiveTeardownDeadline({
    ...SETTLED, deviceLiveGone: false, capturedTextureApplied: false,
    screenCaptureError: { url: '/api/public/studio-device-capture?id=x', reason: 'route' },
  });
  assert.equal(verdict.action, 'stop');
  assert.match(verdict.message, /transparent hole/i);
});

test('deadline: called with no arguments at all never throws and never silently proceeds', () => {
  assert.equal(evaluateLiveTeardownDeadline().action, 'stop');
});

// ── Stranded hole-material invariant (backstop) ────────────────────────────
import { isScreenMaterialStranded } from '../video-export.js';

const FACTORY_MAT = { id: 'factory-mat' };
const HOLE_MAT = { id: 'hole-mat' };

test('isScreenMaterialStranded: genuinely live (deviceLiveActive) → never fires, even if the mesh somehow shows the wrong material', () => {
  assert.equal(isScreenMaterialStranded({
    deviceLiveActive: true, meshMaterial: HOLE_MAT, factoryMaterial: FACTORY_MAT,
  }), false);
});

test('isScreenMaterialStranded: not live + mesh already showing the factory material → nothing to fix', () => {
  assert.equal(isScreenMaterialStranded({
    deviceLiveActive: false, meshMaterial: FACTORY_MAT, factoryMaterial: FACTORY_MAT,
  }), false);
});

test('isScreenMaterialStranded: not live + mesh still showing the hole material → STRANDED, restore', () => {
  assert.equal(isScreenMaterialStranded({
    deviceLiveActive: false, meshMaterial: HOLE_MAT, factoryMaterial: FACTORY_MAT,
  }), true);
});

test('isScreenMaterialStranded: not live + mesh showing some OTHER wrong material (not necessarily the exact hole reference) → still stranded — the invariant is "must equal the factory material," not "must not equal a specific hole object"', () => {
  assert.equal(isScreenMaterialStranded({
    deviceLiveActive: false, meshMaterial: { id: 'some-other-stale-material' }, factoryMaterial: FACTORY_MAT,
  }), true);
});

test('isScreenMaterialStranded: mesh/material not built yet (both falsy) → never fires, nothing to compare', () => {
  assert.equal(isScreenMaterialStranded({ deviceLiveActive: false, meshMaterial: null, factoryMaterial: null }), false);
});

test('isScreenMaterialStranded: factory material not resolved yet (mesh exists, factory does not) → never fires', () => {
  assert.equal(isScreenMaterialStranded({ deviceLiveActive: false, meshMaterial: HOLE_MAT, factoryMaterial: null }), false);
});

test('isScreenMaterialStranded: called with no arguments at all never throws and never fires', () => {
  assert.equal(isScreenMaterialStranded({}), false);
});

// ── "Record live screen" (tab capture) — Phase 8 ─────────────────────────
// getDisplayMedia records the composited TAB (cross-origin iframes
// included), which is the only way the live CSS3D device screen can reach a
// video file. These are the mode's pure decisions; the DOM/MediaRecorder
// glue lives in ClothStudio.jsx and is deliberately untested here, exactly
// like every other helper in this module.

const LIVE_DEVICE = { clothShape: 'device', live: true, liveUrl: 'hitloop.agency', hasDisplayMedia: true };

test('evaluateLiveRecordEligibility: a device subject with Go Live on and a display-media API is eligible', () => {
  const r = evaluateLiveRecordEligibility(LIVE_DEVICE);
  assert.equal(r.eligible, true);
  assert.equal(r.reason, null);
});

test('evaluateLiveRecordEligibility: no getDisplayMedia at all → ineligible, and the reason points at the normal export path', () => {
  const r = evaluateLiveRecordEligibility({ ...LIVE_DEVICE, hasDisplayMedia: false });
  assert.equal(r.eligible, false);
  assert.match(r.reason, /getDisplayMedia/);
});

test('evaluateLiveRecordEligibility: a non-device subject is ineligible — there is no live screen to record', () => {
  assert.equal(evaluateLiveRecordEligibility({ ...LIVE_DEVICE, clothShape: 'sheet' }).eligible, false);
  assert.equal(evaluateLiveRecordEligibility({ ...LIVE_DEVICE, clothShape: 'tshirt' }).eligible, false);
});

test('evaluateLiveRecordEligibility: a device with Go Live OFF (or on with no URL) is ineligible', () => {
  assert.equal(evaluateLiveRecordEligibility({ ...LIVE_DEVICE, live: false }).eligible, false);
  assert.equal(evaluateLiveRecordEligibility({ ...LIVE_DEVICE, liveUrl: '' }).eligible, false);
});

test('evaluateLiveRecordEligibility: called with no arguments never throws and is ineligible', () => {
  assert.equal(evaluateLiveRecordEligibility().eligible, false);
});

test('evaluateDisplaySurface: a browser tab is the surface this mode asked for', () => {
  const r = evaluateDisplaySurface({ displaySurface: DISPLAY_SURFACE_TAB });
  assert.equal(r.ok, true);
  assert.equal(r.unknown, false);
  assert.equal(r.reason, null);
});

test('evaluateDisplaySurface: sharing a window or a whole screen is REFUSED by name, never recorded blind', () => {
  const win = evaluateDisplaySurface({ displaySurface: 'window' });
  assert.equal(win.ok, false);
  assert.match(win.reason, /application window/);
  const mon = evaluateDisplaySurface({ displaySurface: 'monitor' });
  assert.equal(mon.ok, false);
  assert.match(mon.reason, /entire screen/);
});

test('evaluateDisplaySurface: an unreported surface (browsers that do not expose the field) is allowed but flagged unknown', () => {
  for (const v of [undefined, null, '']) {
    const r = evaluateDisplaySurface({ displaySurface: v });
    assert.equal(r.ok, true);
    assert.equal(r.unknown, true);
  }
  assert.equal(evaluateDisplaySurface().ok, true);
});

// A 1440x900 CSS viewport captured at 2880x1800 — a real 2x ratio the caller
// must MEASURE, never assume from devicePixelRatio.
const STREAM_2X = { streamWidth: 2880, streamHeight: 1800, viewportWidth: 1440, viewportHeight: 900 };
const CANVAS_RECT = { left: 400, top: 100, width: 1000, height: 700 };

test('computeDisplayCaptureRect: with no frame, the crop is the whole canvas rect mapped by the MEASURED stream/viewport ratio', () => {
  const r = computeDisplayCaptureRect({ ...STREAM_2X, canvasRect: CANVAS_RECT, frame: null });
  assert.equal(r.ok, true);
  assert.equal(r.scaleX, 2);
  assert.equal(r.scaleY, 2);
  assert.deepEqual([r.sx, r.sy, r.sw, r.sh], [800, 200, 2000, 1400]);
  assert.deepEqual([r.outWidth, r.outHeight], [2000, 1400]);
});

test('computeDisplayCaptureRect: a NON-square stream/viewport ratio is honored per axis, not collapsed to one scale', () => {
  const r = computeDisplayCaptureRect({
    streamWidth: 1440, streamHeight: 1800, viewportWidth: 1440, viewportHeight: 900,
    canvasRect: { left: 0, top: 100, width: 1440, height: 700 }, frame: null,
  });
  assert.equal(r.ok, true);
  assert.equal(r.scaleX, 1);
  assert.equal(r.scaleY, 2);
  assert.deepEqual([r.sx, r.sy, r.sw, r.sh], [0, 200, 1440, 1400]);
});

test('computeDisplayCaptureRect: devicePixelRatio is NEVER assumed — a capped 1x stream on a 2x display maps 1:1', () => {
  const r = computeDisplayCaptureRect({
    streamWidth: 1440, streamHeight: 900, viewportWidth: 1440, viewportHeight: 900,
    canvasRect: CANVAS_RECT, frame: null,
  });
  assert.equal(r.ok, true);
  assert.deepEqual([r.sx, r.sy, r.sw, r.sh], [400, 100, 1000, 700]);
});

test('computeDisplayCaptureRect: with a capture frame, the crop matches computeFrameRect (0.92 inset, centered) and outputs the frame’s NATIVE size', () => {
  // 9:16 vertical inside a 1000x700 canvas: height is the constraining side,
  // so h = 700*0.92 = 644, w = 644 * (1080/1920) = 362.25 CSS px.
  const r = computeDisplayCaptureRect({ ...STREAM_2X, canvasRect: CANVAS_RECT, frame: { w: 1080, h: 1920 } });
  assert.equal(r.ok, true);
  assert.equal(r.sh, Math.round(644 * 2));
  assert.equal(r.sw, Math.round(362.25 * 2));
  // centered inside the canvas rect, then scaled
  assert.equal(r.sx, Math.round((400 + (1000 - 362.25) / 2) * 2));
  assert.equal(r.sy, Math.round((100 + (700 - 644) / 2) * 2));
  // Output stays the frame's own native size — identical to a normal export.
  assert.deepEqual([r.outWidth, r.outHeight], [1080, 1920]);
});

test('computeDisplayCaptureRect: a landscape frame wider than the canvas allows is width-constrained, exactly like computeFrameRect', () => {
  const r = computeDisplayCaptureRect({
    ...STREAM_2X, canvasRect: { left: 0, top: 0, width: 1000, height: 1000 }, frame: { w: 1920, h: 1080 },
  });
  assert.equal(r.ok, true);
  assert.equal(r.sw, Math.round(1000 * 0.92 * 2));
  assert.equal(r.sh, Math.round(((1000 * 0.92) / (1920 / 1080)) * 2));
});

test('computeDisplayCaptureRect: a canvas partly OUTSIDE the shared surface is refused, never silently clamped', () => {
  const offLeft = computeDisplayCaptureRect({
    ...STREAM_2X, canvasRect: { left: -50, top: 100, width: 1000, height: 700 }, frame: null,
  });
  assert.equal(offLeft.ok, false);
  assert.match(offLeft.reason, /outside the shared tab/);

  const offBottom = computeDisplayCaptureRect({
    ...STREAM_2X, canvasRect: { left: 0, top: 400, width: 1000, height: 700 }, frame: null,
  });
  assert.equal(offBottom.ok, false);
});

test('computeDisplayCaptureRect: missing/zero stream, viewport, or canvas dimensions are refused with a specific reason', () => {
  assert.equal(computeDisplayCaptureRect({ ...STREAM_2X, streamWidth: 0, canvasRect: CANVAS_RECT }).ok, false);
  assert.equal(computeDisplayCaptureRect({ ...STREAM_2X, viewportHeight: 0, canvasRect: CANVAS_RECT }).ok, false);
  assert.equal(computeDisplayCaptureRect({ ...STREAM_2X, canvasRect: { left: 0, top: 0, width: 0, height: 700 } }).ok, false);
  assert.equal(computeDisplayCaptureRect({ ...STREAM_2X }).ok, false);
  assert.equal(computeDisplayCaptureRect().ok, false);
});

test('computeDisplayCaptureRect: a frameless crop always reports EVEN output dimensions (odd sizes break some H.264 encoders)', () => {
  const r = computeDisplayCaptureRect({
    streamWidth: 1001, streamHeight: 701, viewportWidth: 1001, viewportHeight: 701,
    canvasRect: { left: 0, top: 0, width: 1001, height: 701 }, frame: null,
  });
  assert.equal(r.ok, true);
  assert.equal(r.outWidth % 2, 0);
  assert.equal(r.outHeight % 2, 0);
});

test('shouldRetryDisplayCaptureWithoutPreferCurrentTab: a constraint-combination rejection earns exactly one retry', () => {
  for (const name of ['TypeError', 'NotSupportedError', 'InvalidStateError', 'OverconstrainedError']) {
    assert.equal(shouldRetryDisplayCaptureWithoutPreferCurrentTab({ name }), true, name);
  }
});

test('shouldRetryDisplayCaptureWithoutPreferCurrentTab: a user cancellation is NEVER retried (no second prompt)', () => {
  assert.equal(shouldRetryDisplayCaptureWithoutPreferCurrentTab({ name: 'NotAllowedError' }), false);
  assert.equal(shouldRetryDisplayCaptureWithoutPreferCurrentTab({ name: 'AbortError' }), false);
  assert.equal(shouldRetryDisplayCaptureWithoutPreferCurrentTab(undefined), false);
});

test('describeDisplayCaptureError: a cancelled picker reads as a clean abort, not a crash', () => {
  const cancelled = describeDisplayCaptureError({ name: 'NotAllowedError' });
  assert.equal(cancelled.aborted, true);
  assert.match(cancelled.message, /cancelled/i);
  assert.equal(describeDisplayCaptureError({ name: 'AbortError' }).aborted, true);
});

test('describeDisplayCaptureError: real failures are NOT reported as user cancellations, and always carry a message', () => {
  for (const name of ['NotFoundError', 'NotReadableError', 'NotSupportedError', 'TypeError', 'SomethingElseError']) {
    const r = describeDisplayCaptureError({ name, message: 'detail here' });
    assert.equal(r.aborted, false, name);
    assert.ok(r.message.length > 0, name);
  }
  assert.equal(describeDisplayCaptureError(undefined).aborted, false);
});

// ── SHARE TAB — the live site as a real texture (Phase 9) ────────────────

test('evaluateScreenShareEligibility: a device subject in a browser with the API may share', () => {
  const r = evaluateScreenShareEligibility({ clothShape: 'device', hasDisplayMedia: true });
  assert.equal(r.eligible, true);
  assert.equal(r.reason, null);
});

test('evaluateScreenShareEligibility: does NOT require Go Live — SHARE TAB replaces it rather than layering on it', () => {
  // Phase 8's evaluateLiveRecordEligibility refuses without live/liveUrl; this
  // mode must not, or the only way to reach it would be through the very
  // feature it exists to make unnecessary.
  assert.equal(evaluateScreenShareEligibility({ clothShape: 'device', hasDisplayMedia: true }).eligible, true);
  assert.equal(evaluateLiveRecordEligibility({ clothShape: 'device', hasDisplayMedia: true, live: false, liveUrl: '' }).eligible, false);
});

test('evaluateScreenShareEligibility: a missing API points at the capture/upload sources, never a silent no-op', () => {
  const r = evaluateScreenShareEligibility({ clothShape: 'device', hasDisplayMedia: false });
  assert.equal(r.eligible, false);
  assert.match(r.reason, /Capture or Upload image/);
});

test('evaluateScreenShareEligibility: a non-device subject is refused with a reason naming Sheet Shape', () => {
  const r = evaluateScreenShareEligibility({ clothShape: 'sheet', hasDisplayMedia: true });
  assert.equal(r.eligible, false);
  assert.match(r.reason, /Device/);
  assert.equal(evaluateScreenShareEligibility().eligible, false);
});

test('buildScreenShareRequest: selfBrowserSurface EXCLUDE is what makes a canvas-showing-itself feedback loop impossible', () => {
  const req = buildScreenShareRequest();
  assert.equal(req.selfBrowserSurface, 'exclude');
  assert.equal(req.surfaceSwitching, 'include');
  assert.equal(req.audio, false);
  assert.equal(req.video.frameRate, 30);
});

test('buildScreenShareRequest: no preferCurrentTab and no displaySurface constraint — the user is picking ANOTHER tab', () => {
  const req = buildScreenShareRequest();
  assert.equal('preferCurrentTab' in req, false);
  assert.equal('displaySurface' in req.video, false);
});

test('buildBasicScreenShareRequest: the degraded retry is a plain video request', () => {
  assert.deepEqual(buildBasicScreenShareRequest(), { video: true, audio: false });
});

test('shouldRetryScreenShareWithBasicOptions: only constraint-class rejections retry; a user cancel never re-prompts', () => {
  for (const name of ['TypeError', 'NotSupportedError', 'InvalidStateError', 'OverconstrainedError']) {
    assert.equal(shouldRetryScreenShareWithBasicOptions({ name }), true, name);
  }
  assert.equal(shouldRetryScreenShareWithBasicOptions({ name: 'NotAllowedError' }), false);
  assert.equal(shouldRetryScreenShareWithBasicOptions({ name: 'AbortError' }), false);
  assert.equal(shouldRetryScreenShareWithBasicOptions(undefined), false);
});

test('describeScreenShareError: a cancelled picker is a clean no-op that says the screen is UNCHANGED', () => {
  for (const name of ['NotAllowedError', 'AbortError']) {
    const r = describeScreenShareError({ name });
    assert.equal(r.aborted, true, name);
    assert.match(r.message, /unchanged/i, name);
  }
});

test('describeScreenShareError: real failures are never reported as cancellations and always carry a message', () => {
  for (const name of ['NotFoundError', 'NotReadableError', 'NotSupportedError', 'TypeError', 'WeirdError']) {
    const r = describeScreenShareError({ name, message: 'detail' });
    assert.equal(r.aborted, false, name);
    assert.ok(r.message.length > 0, name);
  }
  assert.equal(describeScreenShareError(undefined).aborted, false);
});

test('describeSharedSurfaceForScreen: a shared TAB is the expected case and warns about nothing', () => {
  const r = describeSharedSurfaceForScreen({ displaySurface: DISPLAY_SURFACE_TAB });
  assert.equal(r.isTab, true);
  assert.equal(r.warning, null);
  assert.equal(r.unknown, false);
});

test('describeSharedSurfaceForScreen: a window/monitor is ALLOWED (unlike the export path) but always named in a warning', () => {
  for (const surface of ['window', 'monitor', 'something-else']) {
    const r = describeSharedSurfaceForScreen({ displaySurface: surface });
    assert.equal(r.isTab, false, surface);
    assert.ok(r.warning && r.warning.length > 0, surface);
  }
  // The export path is deliberately STRICTER — recording the wrong surface
  // produces a silently wrong file, so it refuses where this one warns.
  assert.equal(evaluateDisplaySurface({ displaySurface: 'monitor' }).ok, false);
});

test('describeSharedSurfaceForScreen: an unreported surface (Firefox/Safari) is not commented on', () => {
  for (const value of [undefined, null, '']) {
    const r = describeSharedSurfaceForScreen({ displaySurface: value });
    assert.equal(r.unknown, true);
    assert.equal(r.warning, null);
  }
  assert.equal(describeSharedSurfaceForScreen().unknown, true);
});

test('computeScreenCoverFit: a 16:9 stream on the 1.6 desktop screen crops the SIDES, keeping full height', () => {
  const fit = computeScreenCoverFit({ screenAspect: 1.44 / 0.9, sourceWidth: 1920, sourceHeight: 1080 });
  assert.equal(fit.ok, true);
  assert.equal(fit.repeat.y, 1);
  assert.ok(Math.abs(fit.repeat.x - 0.9) < 1e-9);
  assert.ok(Math.abs(fit.offset.x - 0.05) < 1e-9);
  assert.equal(fit.offset.y, 0);
});

test('computeScreenCoverFit: a stream TALLER than the screen crops top/bottom, keeping full width', () => {
  const fit = computeScreenCoverFit({ screenAspect: 1.44 / 0.9, sourceWidth: 1080, sourceHeight: 1920 });
  assert.equal(fit.ok, true);
  assert.equal(fit.repeat.x, 1);
  assert.ok(fit.repeat.y < 1);
  assert.equal(fit.offset.x, 0);
  assert.ok(Math.abs(fit.offset.y - (1 - fit.repeat.y) / 2) < 1e-12);
});

test('computeScreenCoverFit: a landscape browser tab on the TALL phone screen keeps full height and crops hard into the middle', () => {
  // The honest consequence of cover-fitting a 16:9 tab onto a 0.46-aspect
  // phone screen: ~74% of the shared tab's width is off-screen. Asserted so
  // nobody later "fixes" it into a letterbox (which would show the page as a
  // strip with dead bars) or a stretch.
  const fit = computeScreenCoverFit({ screenAspect: 0.39 / 0.844, sourceWidth: 1920, sourceHeight: 1080 });
  assert.equal(fit.ok, true);
  assert.equal(fit.repeat.y, 1, 'full height is kept');
  assert.ok(fit.repeat.x < 0.3, `expected a heavy side crop, got ${fit.repeat.x}`);
  assert.ok(Math.abs(fit.offset.x - (1 - fit.repeat.x) / 2) < 1e-12, 'and it is centred');
});

test('computeScreenCoverFit: the crop is always CENTRED on the cropped axis', () => {
  for (const [w, h] of [[1920, 1080], [1280, 1024], [800, 1600], [2560, 1440]]) {
    for (const aspect of [1.6, 0.39 / 0.844, 0.768 / 1.024]) {
      const fit = computeScreenCoverFit({ screenAspect: aspect, sourceWidth: w, sourceHeight: h });
      assert.equal(fit.ok, true);
      assert.ok(Math.abs(fit.offset.x - (1 - fit.repeat.x) / 2) < 1e-12);
      assert.ok(Math.abs(fit.offset.y - (1 - fit.repeat.y) / 2) < 1e-12);
    }
  }
});

test('computeScreenCoverFit: COVER never letterboxes — one axis is always exactly 1 and neither ever exceeds it', () => {
  for (const [w, h] of [[1920, 1080], [900, 1600], [1000, 1000], [3440, 1440]]) {
    const fit = computeScreenCoverFit({ screenAspect: 1.6, sourceWidth: w, sourceHeight: h });
    assert.equal(fit.ok, true);
    assert.ok(fit.repeat.x <= 1 + 1e-12 && fit.repeat.y <= 1 + 1e-12);
    assert.ok(Math.abs(fit.repeat.x - 1) < 1e-12 || Math.abs(fit.repeat.y - 1) < 1e-12);
  }
});

test('computeScreenCoverFit: an exact aspect match is a no-op crop', () => {
  const fit = computeScreenCoverFit({ screenAspect: 1.6, sourceWidth: 1600, sourceHeight: 1000 });
  assert.deepEqual(fit.repeat, { x: 1, y: 1 });
  assert.deepEqual(fit.offset, { x: 0, y: 0 });
});

test('computeScreenCoverFit: unusable inputs refuse with a reason rather than emitting NaN repeat values', () => {
  const cases = [
    {},
    { screenAspect: 1.6 },
    { screenAspect: 1.6, sourceWidth: 0, sourceHeight: 1080 },
    { screenAspect: 1.6, sourceWidth: 1920, sourceHeight: 0 },
    { screenAspect: 0, sourceWidth: 1920, sourceHeight: 1080 },
    { screenAspect: NaN, sourceWidth: 1920, sourceHeight: 1080 },
    { screenAspect: 1.6, sourceWidth: -100, sourceHeight: 1080 },
  ];
  for (const input of cases) {
    const fit = computeScreenCoverFit(input);
    assert.equal(fit.ok, false, JSON.stringify(input));
    assert.ok(fit.reason.length > 0);
    assert.equal(fit.repeat, undefined);
  }
  assert.equal(computeScreenCoverFit().ok, false);
});
