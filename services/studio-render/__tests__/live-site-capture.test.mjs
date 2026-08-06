// live-site-capture.test.mjs — "Live capture fluidity fixes" checkpoint
// (STUDIO-DETERMINISTIC-FINAL-RENDER-SONNET-HANDOFF.md). Pure-logic +
// fake-CDP coverage for the NEW device-screen-live capture path — never
// touches the real network (per this checkpoint's own testing constraint).
// The extracted verbatim helpers (probeExpression/captureReadinessExpression/
// waitForCaptureReady/etc.) already have proven behavior from render.mjs's
// own history and are untouched by this checkpoint; this file covers only
// what's NEW: computeCapturePlan (bugs #1-#3), resetScrollAndVerify
// (bugs #1/#4), the paint-stability readiness strengthener (bug #2's
// canvas/WebGL readiness ask), and an end-to-end captureDeviceLiveFrames
// integration test against a fully faked CDP session/browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCapturePlan, LIVE_CAPTURE_PACING, jpegFingerprintDiff,
  shouldCheckPaintStability, waitForPaintStability, resetScrollAndVerify,
  captureDeviceLiveFrames,
  resolveChromeAngleFlags, chromeGpuLaunchArgs, gpuRendererProbeExpression,
  isSoftwareRenderer, probeGpuRenderer,
} from '../live-site-capture.mjs';

// ── computeCapturePlan (bugs #1-#3, pure) ──────────────────────────────────

test('computeCapturePlan clamps travel to the true maxScrollTop when the pace limit would exceed it (bug #1)', () => {
  // Mirrors the exact hitloop.agency evidence shape: a short viewport/short
  // clip pace limit that is SMALLER than the page's real scroll extent.
  const plan = computeCapturePlan({ viewportHeight: 900, maxScrollTop: 5397, captureSeconds: 2, fps: 30 });
  const expectedPaceLimit = 900 * LIVE_CAPTURE_PACING.SCROLL_SPEED_VIEWPORTS_PER_SEC * 2;
  assert.equal(plan.paceLimitPx, expectedPaceLimit);
  assert.ok(expectedPaceLimit < 5397, 'test setup sanity: the pace limit must be the binding constraint here');
  assert.equal(plan.travel, expectedPaceLimit, 'travel must equal the pace limit, not the full page height');
  assert.ok(plan.travel <= plan.maxScrollTop, 'travel must never exceed the measured max — this is the exact clamp bug #1 fixes');
});

test('computeCapturePlan clamps travel to maxScrollTop when the page is shorter than the pace limit would allow', () => {
  // A short page (maxScrollTop well under what the pace rule would permit
  // over a long clip) must never scroll PAST its own real bottom.
  const plan = computeCapturePlan({ viewportHeight: 900, maxScrollTop: 200, captureSeconds: 6, fps: 30 });
  const paceLimit = 900 * LIVE_CAPTURE_PACING.SCROLL_SPEED_VIEWPORTS_PER_SEC * 6;
  assert.ok(paceLimit > 200, 'test setup sanity: the page height must be the binding constraint here');
  assert.equal(plan.travel, 200, 'travel must equal the real page max, never exceed it — window.scrollTo silently clamping was the original bug');
});

test('computeCapturePlan: a non-scrollable page (maxScrollTop 0) produces zero travel without throwing (degenerate case degrades sanely)', () => {
  const plan = computeCapturePlan({ viewportHeight: 900, maxScrollTop: 0, captureSeconds: 5, fps: 30 });
  assert.equal(plan.travel, 0);
  assert.ok(plan.captureFrameCount >= LIVE_CAPTURE_PACING.MIN_CAPTURE_FRAMES);
});

test('computeCapturePlan: captureFrameCount exactly matches desiredOutputFrames (round 2 — 1:1, not oversampled) within the mid-range (neither MIN nor MAX bound binds)', () => {
  // Round 2 revision: CAPTURE_OVERSAMPLE dropped from 2 to 1 once the actual
  // defect (a paint-commit race producing stale/duplicate frames) was fixed
  // at its source by the stale-frame retry in captureDeviceLiveFrames —
  // every captured frame is now genuinely distinct by construction, so an
  // oversample cushion is no longer doing useful work, and 1:1 halves real
  // wall-clock capture time on GPU-heavy pages (see the checkpoint's "round
  // 2" evidence).
  const plan = computeCapturePlan({ viewportHeight: 900, maxScrollTop: 5000, captureSeconds: 6, fps: 30 });
  assert.equal(plan.desiredOutputFrames, 180);
  assert.equal(plan.captureFrameCount, 180, 'exactly the acceptance case: 180 output frames * 1x oversample = 180 captured');
  assert.equal(plan.captureFrameCount, plan.desiredOutputFrames, 'each output frame maps to its own dedicated captured frame, no interpolation cushion needed');
});

test('computeCapturePlan: captureFrameCount is floored at MIN_CAPTURE_FRAMES for a very short/low-fps clip', () => {
  const plan = computeCapturePlan({ viewportHeight: 900, maxScrollTop: 5000, captureSeconds: 0.1, fps: 10 });
  assert.equal(plan.desiredOutputFrames, 1);
  assert.equal(plan.captureFrameCount, LIVE_CAPTURE_PACING.MIN_CAPTURE_FRAMES);
});

test('computeCapturePlan: captureFrameCount is capped at MAX_CAPTURE_FRAMES for a long, high-fps clip (bounds real wall-clock capture time)', () => {
  const plan = computeCapturePlan({ viewportHeight: 900, maxScrollTop: 50000, captureSeconds: 15, fps: 60 });
  assert.equal(plan.desiredOutputFrames, 900);
  assert.equal(plan.captureFrameCount, LIVE_CAPTURE_PACING.MAX_CAPTURE_FRAMES);
});

test('computeCapturePlan: missing/omitted fps falls back to a 30fps assumption rather than throwing or producing 0 frames', () => {
  const plan = computeCapturePlan({ viewportHeight: 900, maxScrollTop: 5000, captureSeconds: 2 });
  assert.equal(plan.desiredOutputFrames, 60);
});

test('computeCapturePlan: negative/NaN inputs are treated as 0, never produce a negative travel or NaN frame count', () => {
  const plan = computeCapturePlan({ viewportHeight: -100, maxScrollTop: NaN, captureSeconds: -5, fps: NaN });
  assert.equal(plan.travel, 0);
  assert.ok(Number.isFinite(plan.captureFrameCount));
  assert.ok(plan.captureFrameCount >= LIVE_CAPTURE_PACING.MIN_CAPTURE_FRAMES);
});

// ── jpegFingerprintDiff (paint-stability building block) ───────────────────

test('jpegFingerprintDiff: identical strings diff to exactly 0', () => {
  assert.equal(jpegFingerprintDiff('abcdefgh', 'abcdefgh'), 0);
});

test('jpegFingerprintDiff: null/undefined either side diffs to 1 (treated as "definitely not stable")', () => {
  assert.equal(jpegFingerprintDiff(null, 'abc'), 1);
  assert.equal(jpegFingerprintDiff('abc', undefined), 1);
  assert.equal(jpegFingerprintDiff(null, null), 1);
});

test('jpegFingerprintDiff: a handful of differing bytes in an otherwise-identical string produces a small, non-zero diff', () => {
  const a = 'x'.repeat(500);
  const b = `${'x'.repeat(490)}${'y'.repeat(10)}`;
  const diff = jpegFingerprintDiff(a, b);
  assert.ok(diff > 0, 'a real difference must not read as perfectly stable');
  assert.ok(diff < 0.5, 'a small tail difference must not read as a completely different image');
});

test('jpegFingerprintDiff: wildly different lengths/content diff close to 1', () => {
  const diff = jpegFingerprintDiff('a'.repeat(1000), 'b'.repeat(20));
  assert.ok(diff > 0.9);
});

// ── shouldCheckPaintStability (bug #2 — additive-only gate) ────────────────

test('shouldCheckPaintStability: true for the exact hitloop.agency evidence shape (ready, but every DOM-text signal is zero)', () => {
  const readiness = {
    ready: true, reason: 'visual-ready', textChars: 0, textBlocks: 0, belowChromeText: 0, headingVisible: false,
    loadedImages: 0, largeMedia: 1, canvasOrVideo: 1, bgVisuals: 2,
  };
  assert.equal(shouldCheckPaintStability(readiness), true);
});

test('shouldCheckPaintStability: false for an ordinary DOM site with real heading/text — never adds extra wait for the common case', () => {
  assert.equal(shouldCheckPaintStability({ ready: true, headingVisible: true, textChars: 0, belowChromeText: 0 }), false);
  assert.equal(shouldCheckPaintStability({ ready: true, headingVisible: false, textChars: 200, belowChromeText: 0 }), false);
  assert.equal(shouldCheckPaintStability({ ready: true, headingVisible: false, textChars: 0, belowChromeText: 150 }), false);
});

test('shouldCheckPaintStability: false when readiness itself never succeeded, or is absent', () => {
  assert.equal(shouldCheckPaintStability(null), false);
  assert.equal(shouldCheckPaintStability({ ready: false, textChars: 0, headingVisible: false, belowChromeText: 0 }), false);
  assert.equal(shouldCheckPaintStability({ ready: true, timedOut: true, textChars: 0, headingVisible: false, belowChromeText: 0 }), true, 'ready:true (even after a settle timeout) still gates on the text signal alone');
});

// ── waitForPaintStability (fake CDP — no network) ───────────────────────────

function fakeScreenshotCdp(dataSequence) {
  let i = 0;
  const calls = [];
  return {
    calls,
    send: async (method, params) => {
      calls.push({ method, params });
      if (method === 'Page.captureScreenshot') {
        const data = dataSequence[Math.min(i, dataSequence.length - 1)];
        i += 1;
        return { data };
      }
      return {};
    },
  };
}

test('waitForPaintStability: stabilizes quickly once successive screenshots stop changing', async () => {
  const cdp = fakeScreenshotCdp(['frameA-different', 'frameB-different', 'settled', 'settled', 'settled', 'settled']);
  const result = await waitForPaintStability(cdp, undefined, {
    maxWaitMs: 2000, sampleIntervalMs: 1, requiredStableSamples: 2, diffThreshold: 0.02,
  });
  assert.equal(result.checked, true);
  assert.equal(result.stable, true);
  assert.ok(!result.timedOut);
});

test('waitForPaintStability: a page that never stops changing times out with stable:false', async () => {
  let n = 0;
  const cdp = {
    send: async (method) => {
      if (method === 'Page.captureScreenshot') {
        n += 1;
        return { data: `always-different-${n}-${Math.random()}` };
      }
      return {};
    },
  };
  const result = await waitForPaintStability(cdp, undefined, {
    maxWaitMs: 60, sampleIntervalMs: 10, requiredStableSamples: 2, diffThreshold: 0.02,
  });
  assert.equal(result.checked, true);
  assert.equal(result.stable, false);
  assert.equal(result.timedOut, true);
});

test('waitForPaintStability: enabled:false short-circuits immediately without calling the CDP session at all', async () => {
  let called = false;
  const cdp = { send: async () => { called = true; return {}; } };
  const result = await waitForPaintStability(cdp, undefined, { enabled: false });
  assert.deepEqual(result, { checked: false, stable: null });
  assert.equal(called, false);
});

// ── resetScrollAndVerify (bugs #1/#4 — verified by readback, not assumed) ──

function fakeResetCdp(scrollYSequence) {
  let i = 0;
  const calls = [];
  return {
    calls,
    send: async (method, params) => {
      calls.push({ method, params });
      if (method === 'Runtime.evaluate' && params.expression.includes('scrollingElement&&document.scrollingElement.scrollTop')) {
        const y = scrollYSequence[Math.min(i, scrollYSequence.length - 1)];
        i += 1;
        return { result: { value: y } };
      }
      return {};
    },
  };
}

test('resetScrollAndVerify: succeeds immediately when the readback confirms 0 on the first try', async () => {
  const cdp = fakeResetCdp([0]);
  const result = await resetScrollAndVerify(cdp, undefined, { maxWaitMs: 1000, pollMs: 5 });
  assert.equal(result.ok, true);
  assert.equal(result.lastY, 0);
  const scrollToCalls = cdp.calls.filter((c) => c.params?.expression === 'window.scrollTo(0,0)');
  assert.equal(scrollToCalls.length, 1, 'must not keep re-issuing scrollTo once verified');
});

test('resetScrollAndVerify: retries (re-issuing scrollTo(0,0) every poll) until the readback finally reads 0', async () => {
  const cdp = fakeResetCdp([450, 120, 0]);
  const result = await resetScrollAndVerify(cdp, undefined, { maxWaitMs: 2000, pollMs: 5 });
  assert.equal(result.ok, true);
  const scrollToCalls = cdp.calls.filter((c) => c.params?.expression === 'window.scrollTo(0,0)');
  assert.equal(scrollToCalls.length, 3, 'must re-issue the reset on every poll, not just ask once and hope');
});

test('resetScrollAndVerify: times out truthfully (ok:false) if the page never reads back to 0 — never silently assumed', async () => {
  const cdp = fakeResetCdp([600, 600, 600, 600, 600, 600, 600, 600, 600, 600]);
  const result = await resetScrollAndVerify(cdp, undefined, { maxWaitMs: 40, pollMs: 10 });
  assert.equal(result.ok, false);
  assert.notEqual(result.lastY, 0);
});

// ── captureDeviceLiveFrames end-to-end (fully faked CDP session + browser,
// no network) — proves the deterministic step loop itself: monotonic scroll
// targets, frame 0 === scrollTop 0, clamped travel, exact frame count. ─────

function makeFakeCaptureHarness({
  maxScrollTop = 4000, viewportHeight = 900, readinessOverrides = {},
  // "Live capture GPU acceleration" checkpoint — a deterministic renderer
  // string the fake's Runtime.evaluate returns for the GPU probe expression,
  // so captureDeviceLiveFrames' own GPU-probe call resolves to something
  // meaningful instead of falling through to the harness's generic
  // catch-all `{}` (which every prior test relied on for every OTHER
  // Runtime.evaluate expression it doesn't otherwise recognize). Defaults to
  // a real-GPU-looking string so every EXISTING test using this harness
  // keeps seeing `software:false` unless it explicitly overrides this.
  gpuRenderer = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)',
} = {}) {
  const scrollTargets = [];
  let screenshotCount = 0;
  const baseReadiness = {
    ready: true,
    reason: 'text-ready',
    readyState: 'complete',
    now: 100,
    textChars: 200,
    textBlocks: 3,
    belowChromeText: 150,
    headingVisible: true,
    loadedImages: 1,
    largeMedia: 1,
    canvasOrVideo: 0,
    bgVisuals: 0,
    viewport: { width: 1440, height: viewportHeight },
    scrollHeight: maxScrollTop + viewportHeight,
    ...readinessOverrides,
  };
  const session = {
    send: async (method, params) => {
      if (method === 'Page.enable' || method === 'Runtime.enable' || method === 'Page.navigate') return {};
      if (method === 'Page.captureScreenshot') {
        screenshotCount += 1;
        return { data: `frame-${screenshotCount}` };
      }
      if (method === 'Runtime.evaluate') {
        const expr = params.expression || '';
        if (expr.includes('readyState')) return { result: { value: baseReadiness } };
        if (expr.includes('WEBGL_debug_renderer_info')) return { result: { value: gpuRenderer } };
        if (expr.includes('loadersHidden')) return { result: { value: { loadersHidden: 0, lazyImages: 0, forcedVisible: 0, events: 0 } } };
        if (expr.includes('percent-prewarmed')) return { result: { value: { y: maxScrollTop, how: 'percent-prewarmed' } } };
        if (expr === 'window.scrollTo(0,0)') return {};
        if (expr.includes('scrollingElement&&document.scrollingElement.scrollTop')) return { result: { value: 0 } };
        if (expr.includes('maxScrollTop:Math.max')) {
          return { result: { value: { scrollHeight: maxScrollTop + viewportHeight, maxScrollTop } } };
        }
        if (expr.includes('requestAnimationFrame(()=>requestAnimationFrame')) return {};
        const m = expr.match(/^window\.scrollTo\(0, (\d+)\)$/);
        if (m) { scrollTargets.push(Number(m[1])); return {}; }
        return {};
      }
      return {};
    },
  };
  const browser = {
    newPage: async () => ({ context: () => ({ newCDPSession: async () => session }) }),
    close: async () => {},
  };
  return {
    launchChromium: async () => browser,
    scrollTargets,
    getScreenshotCount: () => screenshotCount,
  };
}

// Fast capture-config override used by every integration test below — shrinks
// every real-world settle timing to near-zero so the fake-CDP tests run in
// milliseconds instead of paying the real ~1.2s+ production settle budget.
const FAST_CAPTURE = {
  warmupMs: 1,
  pollMs: 1,
  maxReadyWaitMs: 500,
  postResetSettleMs: 1,
  stepSettleMs: 0,
  resetVerify: { maxWaitMs: 200, pollMs: 1 },
  paintStability: { enabled: false },
};

test('captureDeviceLiveFrames requires the launchChromium DI seam', async () => {
  await assert.rejects(
    () => captureDeviceLiveFrames({ url: 'https://example.com' }),
    /launchChromium/,
  );
});

test('captureDeviceLiveFrames: frame 0 is captured at scrollTop 0, and scroll targets are strictly non-decreasing (bug #4 — never inverted/reversed)', async () => {
  const harness = makeFakeCaptureHarness({ maxScrollTop: 4000, viewportHeight: 900 });
  const result = await captureDeviceLiveFrames({
    url: 'https://hitloop.agency/', viewport: 'desktop', seconds: 2, fps: 30,
    capture: FAST_CAPTURE, launchChromium: harness.launchChromium,
  });
  assert.ok(harness.scrollTargets.length > 0);
  assert.equal(harness.scrollTargets[0], 0, 'the very first step must scroll to exactly 0 (the top)');
  for (let i = 1; i < harness.scrollTargets.length; i += 1) {
    assert.ok(harness.scrollTargets[i] >= harness.scrollTargets[i - 1], `scroll targets must never move backward (index ${i}: ${harness.scrollTargets[i]} < ${harness.scrollTargets[i - 1]})`);
  }
  assert.equal(result.frames.length, harness.scrollTargets.length);
});

test('captureDeviceLiveFrames: travel never exceeds the fake page\'s own reported maxScrollTop (bug #1 clamp, end to end)', async () => {
  // Pace limit for 900*0.5*2=900px would normally apply, but the page here
  // is even shorter (300px) — the real max must win.
  const harness = makeFakeCaptureHarness({ maxScrollTop: 300, viewportHeight: 900 });
  const result = await captureDeviceLiveFrames({
    url: 'https://example.com/', viewport: 'desktop', seconds: 2, fps: 30,
    capture: FAST_CAPTURE, launchChromium: harness.launchChromium,
  });
  const maxTarget = Math.max(...harness.scrollTargets);
  assert.equal(maxTarget, 300, 'the final scroll target must equal the page\'s real max, never exceed it');
  assert.equal(result.scrollInfo.maxScrollTop, 300);
});

test('captureDeviceLiveFrames: produces exactly computeCapturePlan\'s captureFrameCount frames, 1:1 with the requested output frame count (round 2)', async () => {
  const harness = makeFakeCaptureHarness({ maxScrollTop: 5000, viewportHeight: 900 });
  const result = await captureDeviceLiveFrames({
    url: 'https://hitloop.agency/', viewport: 'desktop', seconds: 6, fps: 30,
    capture: FAST_CAPTURE, launchChromium: harness.launchChromium,
  });
  // Matches the acceptance case exactly: 180 output frames * 1x oversample.
  assert.equal(result.frames.length, 180);
  assert.equal(harness.getScreenshotCount(), 180);
});

// ── Round 2 (coordinator-flagged): hang safety + stale-frame retry ─────────

function baseFakeReadinessEvaluate(expr) {
  if (expr.includes('readyState')) {
    return {
      result: {
        value: {
          ready: true, headingVisible: true, textChars: 200, belowChromeText: 100, scrollHeight: 1900, viewport: { width: 1440, height: 900 },
        },
      },
    };
  }
  if (expr.includes('percent-prewarmed')) return { result: { value: { y: 1000, how: 'percent-prewarmed' } } };
  if (expr === 'window.scrollTo(0,0)') return {};
  if (expr.includes('scrollingElement&&document.scrollingElement.scrollTop')) return { result: { value: 0 } };
  if (expr.includes('maxScrollTop:Math.max')) return { result: { value: { scrollHeight: 1900, maxScrollTop: 1000 } } };
  if (expr.includes('requestAnimationFrame(()=>requestAnimationFrame')) return {};
  return undefined; // caller decides what an unmatched expression means
}

test('captureDeviceLiveFrames never hangs forever: a CDP call that never resolves is bounded by stepCdpTimeoutMs and the capture still completes', async () => {
  let scrollToCallCount = 0;
  let hungOnce = false;
  const session = {
    send: async (method, params) => {
      if (method === 'Page.enable' || method === 'Runtime.enable' || method === 'Page.navigate') return {};
      if (method === 'Runtime.evaluate') {
        const expr = params.expression || '';
        const base = baseFakeReadinessEvaluate(expr);
        if (base !== undefined) return base;
        const m = expr.match(/^window\.scrollTo\(0, (\d+)\)$/);
        if (m) {
          scrollToCallCount += 1;
          // Step 2's scrollTo call simulates a starved rAF/evaluate on a
          // GPU-saturated page: the promise NEVER resolves. Without
          // raceTimeout wrapping every step CDP call, this single step
          // would hang the entire capture forever.
          if (scrollToCallCount === 2 && !hungOnce) {
            hungOnce = true;
            return new Promise(() => {});
          }
          return {};
        }
        return {};
      }
      if (method === 'Page.captureScreenshot') return { data: `frame-${Date.now()}-${Math.random()}` };
      return {};
    },
  };
  const browser = { newPage: async () => ({ context: () => ({ newCDPSession: async () => session }) }), close: async () => {} };
  const start = Date.now();
  const result = await captureDeviceLiveFrames({
    url: 'https://example.com/', viewport: 'desktop', seconds: 1, fps: 10,
    capture: { ...FAST_CAPTURE, stepCdpTimeoutMs: 30 },
    launchChromium: async () => browser,
  });
  const elapsed = Date.now() - start;
  assert.ok(hungOnce, 'test setup sanity: the deliberately-hung call must actually have been reached');
  assert.ok(result.frames.length > 0, 'the capture must still complete and produce frames despite one stuck CDP call');
  assert.ok(elapsed < 5000, `capture must never hang indefinitely on a single unresponsive CDP call (took ${elapsed}ms)`);
});

test('captureDeviceLiveFrames retries a stale (paint-not-yet-committed) screenshot up to a bound, and adopts the fresher retry result instead of the frozen one', async () => {
  const targetsSeen = [];
  const callCountForStep = {};
  const STALE_STEP_INDEX = 2; // the 3rd step (0-based) — arbitrary, mid-sequence
  const session = {
    send: async (method, params) => {
      if (method === 'Page.enable' || method === 'Runtime.enable' || method === 'Page.navigate') return {};
      if (method === 'Runtime.evaluate') {
        const expr = params.expression || '';
        const base = baseFakeReadinessEvaluate(expr);
        if (base !== undefined) return base;
        const m = expr.match(/^window\.scrollTo\(0, (\d+)\)$/);
        if (m) { targetsSeen.push(Number(m[1])); return {}; }
        return {};
      }
      if (method === 'Page.captureScreenshot') {
        const stepIdx = targetsSeen.length - 1;
        callCountForStep[stepIdx] = (callCountForStep[stepIdx] || 0) + 1;
        // The step at STALE_STEP_INDEX's first 2 screenshot attempts return
        // the PREVIOUS step's exact frame data (paint hasn't committed yet
        // — the target genuinely moved, but the compositor hadn't caught
        // up); only the 3rd attempt returns this step's own correct frame.
        if (stepIdx === STALE_STEP_INDEX && callCountForStep[stepIdx] <= 2) {
          return { data: `frame-${STALE_STEP_INDEX - 1}` };
        }
        return { data: `frame-${stepIdx}` };
      }
      return {};
    },
  };
  const browser = { newPage: async () => ({ context: () => ({ newCDPSession: async () => session }) }), close: async () => {} };
  const result = await captureDeviceLiveFrames({
    url: 'https://example.com/', viewport: 'desktop', seconds: 1, fps: 10,
    capture: { ...FAST_CAPTURE, staleRetrySettleMs: 1 },
    launchChromium: async () => browser,
  });
  assert.equal(
    result.frames[STALE_STEP_INDEX],
    `data:image/jpeg;base64,frame-${STALE_STEP_INDEX}`,
    'the FINAL recorded frame for the stale step must be its own fresh content, not the frozen repeat of the previous step',
  );
  assert.notEqual(
    result.frames[STALE_STEP_INDEX], result.frames[STALE_STEP_INDEX - 1],
    'a retried-into-freshness frame must differ from its predecessor — this is exactly the 0px-then-jump defect being closed',
  );
  assert.equal(result.scrollInfo.staleRetryTotal, 2, 'exactly 2 retries were needed (call 2 still stale, call 3 fresh) and the total must be reported for acceptance evidence');
});

test('captureDeviceLiveFrames: the stale-frame retry never engages on a genuinely static target (travel:0) — no pointless spinning', async () => {
  let screenshotCalls = 0;
  const session = {
    send: async (method, params) => {
      if (method === 'Page.enable' || method === 'Runtime.enable' || method === 'Page.navigate') return {};
      if (method === 'Runtime.evaluate') {
        const expr = params.expression || '';
        if (expr.includes('readyState')) {
          return {
            result: {
              value: {
                ready: true, headingVisible: true, textChars: 200, belowChromeText: 100, scrollHeight: 900, viewport: { width: 1440, height: 900 },
              },
            },
          };
        }
        if (expr.includes('percent-prewarmed')) return { result: { value: { y: 0, how: 'percent-prewarmed' } } };
        if (expr === 'window.scrollTo(0,0)') return {};
        if (expr.includes('scrollingElement&&document.scrollingElement.scrollTop')) return { result: { value: 0 } };
        // Non-scrollable page: scrollHeight === innerHeight -> maxScrollTop 0.
        if (expr.includes('maxScrollTop:Math.max')) return { result: { value: { scrollHeight: 900, maxScrollTop: 0 } } };
        if (expr.includes('requestAnimationFrame(()=>requestAnimationFrame')) return {};
        return {};
      }
      if (method === 'Page.captureScreenshot') {
        screenshotCalls += 1;
        return { data: 'always-the-same-frame' }; // correct: every target is 0
      }
      return {};
    },
  };
  const browser = { newPage: async () => ({ context: () => ({ newCDPSession: async () => session }) }), close: async () => {} };
  const result = await captureDeviceLiveFrames({
    url: 'https://example.com/', viewport: 'desktop', seconds: 1, fps: 10,
    capture: { ...FAST_CAPTURE, staleRetrySettleMs: 1 },
    launchChromium: async () => browser,
  });
  assert.equal(result.scrollInfo.staleRetryTotal, 0, 'identical frames on a non-scrollable page are CORRECT, not stale — must never trigger a retry');
  assert.equal(screenshotCalls, result.frames.length, 'exactly one screenshot call per step, no extra retry calls');
});

test('captureDeviceLiveFrames: paint-stability runs (and is reported) for a weak-signal canvas/WebGL readiness, and is skipped for an ordinary DOM readiness', async () => {
  const canvasHarness = makeFakeCaptureHarness({
    maxScrollTop: 1000,
    readinessOverrides: {
      textChars: 0, textBlocks: 0, belowChromeText: 0, headingVisible: false, largeMedia: 1, canvasOrVideo: 1, bgVisuals: 2,
    },
  });
  const canvasResult = await captureDeviceLiveFrames({
    url: 'https://hitloop.agency/', viewport: 'desktop', seconds: 1, fps: 10,
    capture: { ...FAST_CAPTURE, paintStability: { enabled: true, maxWaitMs: 20, sampleIntervalMs: 5, requiredStableSamples: 1, diffThreshold: 0.5 } },
    launchChromium: canvasHarness.launchChromium,
  });
  assert.ok(canvasResult.readiness.paintStability, 'a canvas/WebGL-shaped readiness must get a paint-stability report');
  assert.equal(canvasResult.readiness.paintStability.checked, true);

  const domHarness = makeFakeCaptureHarness({ maxScrollTop: 1000 }); // default readiness has real text/heading
  const domResult = await captureDeviceLiveFrames({
    url: 'https://en.wikipedia.org/wiki/Website', viewport: 'desktop', seconds: 1, fps: 10,
    capture: FAST_CAPTURE, launchChromium: domHarness.launchChromium,
  });
  assert.equal(domResult.readiness.paintStability, null, 'an ordinary DOM site with real text/heading signals must never pay the extra paint-stability wait');
});

test('captureDeviceLiveFrames still throws if literally zero screenshots succeed — never a silently blank sourced screen', async () => {
  const browser = {
    newPage: async () => ({
      context: () => ({
        newCDPSession: async () => ({
          send: async (method, params) => {
            if (method === 'Page.captureScreenshot') return null; // every screenshot "fails"
            if (method === 'Runtime.evaluate') {
              const expr = params.expression || '';
              if (expr.includes('readyState')) {
                return {
                  result: {
                    value: {
                      ready: true, textChars: 200, headingVisible: true, belowChromeText: 100, scrollHeight: 1900, viewport: { width: 1440, height: 900 },
                    },
                  },
                };
              }
              if (expr.includes('scrollingElement&&document.scrollingElement.scrollTop')) return { result: { value: 0 } };
              if (expr.includes('maxScrollTop:Math.max')) return { result: { value: { scrollHeight: 1900, maxScrollTop: 1000 } } };
              return {};
            }
            return {};
          },
        }),
      }),
    }),
    close: async () => {},
  };
  await assert.rejects(
    () => captureDeviceLiveFrames({
      url: 'https://example.com/', viewport: 'desktop', seconds: 1, fps: 10,
      capture: FAST_CAPTURE, launchChromium: async () => browser,
    }),
    /no frames captured/,
  );
});

// ── "Live capture GPU acceleration" checkpoint ──────────────────────────────

test('resolveChromeAngleFlags: no CHROME_FLAGS override returns the platform default (darwin=metal, else vulkan)', () => {
  const original = process.env.CHROME_FLAGS;
  delete process.env.CHROME_FLAGS;
  try {
    const flags = resolveChromeAngleFlags();
    if (process.platform === 'darwin') {
      assert.deepEqual(flags, ['--use-angle=metal']);
    } else {
      assert.deepEqual(flags, ['--use-angle=vulkan', '--enable-features=Vulkan', '--no-sandbox']);
    }
  } finally {
    if (original === undefined) delete process.env.CHROME_FLAGS; else process.env.CHROME_FLAGS = original;
  }
});

test('resolveChromeAngleFlags: CHROME_FLAGS env override wins entirely over the platform default (comma-separated, trimmed)', () => {
  const original = process.env.CHROME_FLAGS;
  process.env.CHROME_FLAGS = ' --use-gl=angle, --use-angle=gl ,--enable-webgl';
  try {
    assert.deepEqual(resolveChromeAngleFlags(), ['--use-gl=angle', '--use-angle=gl', '--enable-webgl']);
  } finally {
    if (original === undefined) delete process.env.CHROME_FLAGS; else process.env.CHROME_FLAGS = original;
  }
});

test('chromeGpuLaunchArgs: always leads with --headless=new, --enable-gpu, --ignore-gpu-blocklist, then the resolved ANGLE flags', () => {
  const original = process.env.CHROME_FLAGS;
  delete process.env.CHROME_FLAGS;
  try {
    const args = chromeGpuLaunchArgs();
    assert.deepEqual(args.slice(0, 3), ['--headless=new', '--enable-gpu', '--ignore-gpu-blocklist']);
    assert.deepEqual(args.slice(3), resolveChromeAngleFlags());
  } finally {
    if (original === undefined) delete process.env.CHROME_FLAGS; else process.env.CHROME_FLAGS = original;
  }
});

test('isSoftwareRenderer: flags swiftshader/llvmpipe/software (any case), not a real GPU string', () => {
  assert.equal(isSoftwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)'), true);
  assert.equal(isSoftwareRenderer('llvmpipe (LLVM 15.0.6, 256 bits)'), true);
  assert.equal(isSoftwareRenderer('Generic Software Rasterizer'), true);
  assert.equal(isSoftwareRenderer('ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)'), false);
  assert.equal(isSoftwareRenderer('ANGLE (NVIDIA, Vulkan 1.3.0 (NVIDIA L4))'), false);
});

test('gpuRendererProbeExpression: produces a self-contained expression string that reads UNMASKED_RENDERER_WEBGL', () => {
  const expr = gpuRendererProbeExpression();
  assert.equal(typeof expr, 'string');
  assert.match(expr, /WEBGL_debug_renderer_info/);
  assert.match(expr, /UNMASKED_RENDERER_WEBGL/);
});

test('probeGpuRenderer: a real-GPU renderer string reports software:false', async () => {
  const cdp = { send: async () => ({ result: { value: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)' } }) };
  const result = await probeGpuRenderer(cdp, undefined, { logPrefix: '[test]', blankWhat: 'thing' });
  assert.equal(result.software, false);
  assert.match(result.renderer, /Metal/);
});

test('probeGpuRenderer: a SwiftShader/software renderer string reports software:true', async () => {
  const cdp = { send: async () => ({ result: { value: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)' } }) };
  const result = await probeGpuRenderer(cdp, undefined, { logPrefix: '[test]', blankWhat: 'thing' });
  assert.equal(result.software, true);
});

test('probeGpuRenderer: a failing CDP call never throws — reports renderer:unknown, software:null (same as render.mjs\'s original inline try/catch)', async () => {
  const cdp = { send: async () => { throw new Error('target closed'); } };
  const result = await probeGpuRenderer(cdp, undefined);
  assert.equal(result.renderer, 'unknown');
  assert.equal(result.software, null);
});

test('captureDeviceLiveFrames: the GPU probe result is carried on the returned metadata as gpu:{renderer,software}', async () => {
  const harness = makeFakeCaptureHarness({
    maxScrollTop: 1000,
    gpuRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)',
  });
  const result = await captureDeviceLiveFrames({
    url: 'https://hitloop.agency/', viewport: 'desktop', seconds: 1, fps: 10,
    capture: FAST_CAPTURE, launchChromium: harness.launchChromium,
  });
  assert.ok(result.gpu, 'gpu must be present on the returned capture metadata');
  assert.equal(result.gpu.software, false);
  assert.match(result.gpu.renderer, /Metal/);
});

test('captureDeviceLiveFrames: a software-renderer GPU probe result is carried through untouched (never silently upgraded to "GPU")', async () => {
  const harness = makeFakeCaptureHarness({
    maxScrollTop: 1000,
    gpuRenderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)',
  });
  const result = await captureDeviceLiveFrames({
    url: 'https://hitloop.agency/', viewport: 'desktop', seconds: 1, fps: 10,
    capture: FAST_CAPTURE, launchChromium: harness.launchChromium,
  });
  assert.equal(result.gpu.software, true);
});

test('captureDeviceLiveFrames: an overall capture budget failure throws honestly with the measured numbers, never hangs indefinitely', async () => {
  // Every individual CDP call resolves (never hits stepCdpTimeoutMs's
  // per-call ceiling) but Page.captureScreenshot pays a small REAL delay —
  // simulates a page whose every call genuinely completes, just slowly
  // overall, exactly the shape STEP_CDP_TIMEOUT_MS alone cannot bound.
  let screenshotCount = 0;
  const session = {
    send: async (method, params) => {
      if (method === 'Page.enable' || method === 'Runtime.enable' || method === 'Page.navigate') return {};
      if (method === 'Runtime.evaluate') {
        const expr = params.expression || '';
        const base = baseFakeReadinessEvaluate(expr);
        if (base !== undefined) return base;
        if (expr.includes('WEBGL_debug_renderer_info')) return { result: { value: 'llvmpipe (LLVM 15.0.6, 256 bits)' } };
        return {};
      }
      if (method === 'Page.captureScreenshot') {
        screenshotCount += 1;
        await new Promise((r) => { setTimeout(r, 15); });
        return { data: `frame-${screenshotCount}` };
      }
      return {};
    },
  };
  const browser = {
    newPage: async () => ({ context: () => ({ newCDPSession: async () => session }) }),
    close: async () => {},
  };
  await assert.rejects(
    () => captureDeviceLiveFrames({
      url: 'https://hitloop.agency/', viewport: 'desktop', seconds: 2, fps: 30,
      capture: { ...FAST_CAPTURE, maxCaptureMs: 20 },
      launchChromium: async () => browser,
    }),
    (err) => {
      assert.match(err.message, /exceeded its overall budget/);
      assert.match(err.message, /captured \d+\/\d+ steps/);
      assert.match(err.message, /GPU: llvmpipe.*SOFTWARE/);
      return true;
    },
  );
  assert.ok(screenshotCount >= 1, 'at least one real step must have run before the budget check caught the overrun');
  assert.ok(screenshotCount < 60, 'the budget must actually stop the loop early (60 = the full plan for this 2s/30fps request), not run to completion');
});

test('captureDeviceLiveFrames: a generous maxCaptureMs never interferes with an ordinary, fast capture', async () => {
  const harness = makeFakeCaptureHarness({ maxScrollTop: 1000 });
  const result = await captureDeviceLiveFrames({
    url: 'https://en.wikipedia.org/wiki/Website', viewport: 'desktop', seconds: 1, fps: 10,
    capture: { ...FAST_CAPTURE, maxCaptureMs: 60000 },
    launchChromium: harness.launchChromium,
  });
  assert.ok(result.frames.length > 0);
});
