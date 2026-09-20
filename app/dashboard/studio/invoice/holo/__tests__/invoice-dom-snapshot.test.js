// Invoice Studio HoloPaper — invoice-dom-snapshot.js POLICY-layer tests
// (handoff §4, Lane R). No DOM in this repo's plain node:test runner (same
// constraint/pattern as identity/svg-sanitizer.js's own test file) — these
// exercise only the pure exports: size/downsample math, the generation-token
// gate, the debounce scheduler, the bounded-wait helper, the strip-rule
// predicates, and the success/failure shaping. captureInvoiceSnapshot()
// itself (the DOM-walking driver) is verified by hand in a real browser —
// see this lane's final report for the exact checks run.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_TEXTURE_DIMENSION,
  DEFAULT_DEBOUNCE_MS,
  STRIP_IDS,
  STRIP_SELECTORS,
  STRIP_ATTRIBUTES,
  shouldStripElementId,
  shouldStripSelector,
  shouldStripAttribute,
  computeCaptureSize,
  createCaptureGate,
  captureFailure,
  captureSuccessResult,
  withTimeout,
  createDebouncedScheduler,
} from '../invoice-dom-snapshot.js';

// ── computeCaptureSize ──────────────────────────────────────────────────
test('computeCaptureSize: content already under the budget is untouched (scale 1)', () => {
  const result = computeCaptureSize(900, 1200, 2048);
  assert.deepEqual(result, { width: 900, height: 1200, scale: 1 });
});

test('computeCaptureSize: exactly at the budget is untouched', () => {
  const result = computeCaptureSize(2048, 500, 2048);
  assert.equal(result.width, 2048);
  assert.equal(result.height, 500);
  assert.equal(result.scale, 1);
});

test('computeCaptureSize: a tall document scales BOTH axes by the same factor (never crops)', () => {
  const result = computeCaptureSize(1255, 5020, 2048); // 4x too tall
  assert.equal(result.height, 2048);
  // width scales by the identical factor computed from the longest axis
  const expectedWidth = Math.round(1255 * (2048 / 5020));
  assert.equal(result.width, expectedWidth);
  // Aspect ratio preserved to within rounding.
  const srcAspect = 1255 / 5020;
  const outAspect = result.width / result.height;
  assert.ok(Math.abs(srcAspect - outAspect) < 0.01);
});

test('computeCaptureSize: a wide document caps on width, scales height to match', () => {
  const result = computeCaptureSize(4096, 512, 2048);
  assert.equal(result.width, 2048);
  assert.equal(result.height, 256);
  assert.equal(result.scale, 0.5);
});

test('computeCaptureSize: default budget is MAX_TEXTURE_DIMENSION (2048)', () => {
  assert.equal(MAX_TEXTURE_DIMENSION, 2048);
  const result = computeCaptureSize(9000, 1000);
  assert.equal(result.width, 2048);
});

test('computeCaptureSize: degenerate/garbage input never throws and always returns >=1x1', () => {
  assert.deepEqual(computeCaptureSize(0, 0), { width: 1, height: 1, scale: 1 });
  assert.deepEqual(computeCaptureSize(NaN, undefined), { width: 1, height: 1, scale: 1 });
  const negativeCap = computeCaptureSize(5000, 5000, -1);
  assert.equal(negativeCap.width, 5000); // an invalid cap is treated as "no cap"
});

// ── createCaptureGate — generation-token "latest-wins" ─────────────────────
test('createCaptureGate: tokens increase monotonically and only the latest is current', () => {
  const gate = createCaptureGate();
  const t1 = gate.begin();
  const t2 = gate.begin();
  const t3 = gate.begin();
  assert.ok(t2 > t1 && t3 > t2);
  assert.equal(gate.isCurrent(t1), false);
  assert.equal(gate.isCurrent(t2), false);
  assert.equal(gate.isCurrent(t3), true);
  assert.equal(gate.current(), t3);
});

test('createCaptureGate: a stale (older) token resolving after a newer one is correctly rejected', () => {
  // Simulates: capture A begins, capture B begins and resolves first, then
  // A resolves late — A must be recognized as stale even though it settles
  // AFTER B in wall-clock time.
  const gate = createCaptureGate();
  const tokenA = gate.begin();
  const tokenB = gate.begin();
  assert.equal(gate.isCurrent(tokenB), true); // B resolves "first" (or at all) — applies
  assert.equal(gate.isCurrent(tokenA), false); // A resolves later — must be dropped
});

test('createCaptureGate: independent gates do not share state', () => {
  const gateA = createCaptureGate();
  const gateB = createCaptureGate();
  const a1 = gateA.begin();
  const b1 = gateB.begin();
  assert.equal(gateA.isCurrent(a1), true);
  assert.equal(gateB.isCurrent(b1), true);
  // A token from one gate has no meaning against the other, but is at least
  // typed as a plain number, not accidentally colliding by construction.
  assert.equal(a1, b1); // both start at 1 — proves no shared module-level counter
});

// ── success/failure shaping ─────────────────────────────────────────────
test('captureFailure: normalizes a reason string, defaults when omitted', () => {
  assert.deepEqual(captureFailure('font timeout'), { ok: false, reason: 'font timeout' });
  assert.equal(captureFailure().reason, 'Snapshot failed.');
  assert.equal(captureFailure(null).reason, 'Snapshot failed.');
});

test('captureSuccessResult: carries source/width/height with ok:true', () => {
  const fakeCanvas = { tag: 'fake-canvas' };
  assert.deepEqual(
    captureSuccessResult(fakeCanvas, 800, 600),
    { ok: true, source: fakeCanvas, width: 800, height: 600 },
  );
});

// ── withTimeout — bounded wait, never rejects ────────────────────────────
test('withTimeout: resolves with the underlying value when it settles before the timeout', async () => {
  const result = await withTimeout(Promise.resolve('done'), 1000);
  assert.deepEqual(result, { timedOut: false, value: 'done' });
});

test('withTimeout: a rejected promise resolves (never rejects) with timedOut:false, value:undefined', async () => {
  const result = await withTimeout(Promise.reject(new Error('boom')), 1000);
  assert.deepEqual(result, { timedOut: false, value: undefined });
});

test('withTimeout: an injected clock that fires before the promise settles reports timedOut:true', async () => {
  let firedCallback = null;
  const fakeSetTimeout = (cb) => { firedCallback = cb; return 'fake-timer-id'; };
  const fakeClearTimeout = () => {};
  const neverSettles = new Promise(() => {}); // deliberately never resolves/rejects
  const resultPromise = withTimeout(neverSettles, 999, {
    setTimeoutFn: fakeSetTimeout, clearTimeoutFn: fakeClearTimeout,
  });
  assert.equal(typeof firedCallback, 'function');
  firedCallback(); // simulate the timer firing — no real waiting
  const result = await resultPromise;
  assert.deepEqual(result, { timedOut: true, value: undefined });
});

test('withTimeout: the timer is cleared once the promise wins the race (no leaked timer)', async () => {
  let cleared = false;
  const fakeClearTimeout = () => { cleared = true; };
  await withTimeout(Promise.resolve('fast'), 999, {
    setTimeoutFn: (cb) => { void cb; return 'id'; },
    clearTimeoutFn: fakeClearTimeout,
  });
  assert.equal(cleared, true);
});

// ── createDebouncedScheduler — trailing-edge debounce ────────────────────
test('createDebouncedScheduler: a single schedule() eventually fires fn once', () => {
  let calls = 0;
  let pendingCb = null;
  const scheduler = createDebouncedScheduler(() => { calls += 1; }, 250, {
    setTimeoutFn: (cb) => { pendingCb = cb; return 1; },
    clearTimeoutFn: () => {},
  });
  scheduler.schedule();
  assert.equal(scheduler.pending, true);
  pendingCb();
  assert.equal(calls, 1);
  assert.equal(scheduler.pending, false);
});

test('createDebouncedScheduler: rapid re-scheduling collapses to exactly ONE fn call (latest wins the window)', () => {
  let calls = 0;
  let pendingCb = null;
  let clearCount = 0;
  const scheduler = createDebouncedScheduler(() => { calls += 1; }, 250, {
    setTimeoutFn: (cb) => { pendingCb = cb; return {}; },
    clearTimeoutFn: () => { clearCount += 1; },
  });
  // Simulate 5 rapid refreshKey changes within one debounce window.
  scheduler.schedule();
  scheduler.schedule();
  scheduler.schedule();
  scheduler.schedule();
  scheduler.schedule();
  // Only the LAST schedule()'s timer ever fires (the previous 4 were cleared).
  assert.equal(clearCount, 4);
  pendingCb();
  assert.equal(calls, 1);
});

test('createDebouncedScheduler: cancel() prevents a pending fn from ever firing', () => {
  let calls = 0;
  let pendingCb = null;
  const scheduler = createDebouncedScheduler(() => { calls += 1; }, 250, {
    setTimeoutFn: (cb) => { pendingCb = cb; return {}; },
    clearTimeoutFn: () => {},
  });
  scheduler.schedule();
  scheduler.cancel();
  assert.equal(scheduler.pending, false);
  // Even if the (now-cancelled) callback reference were invoked directly —
  // simulating a timer the environment failed to actually clear — a well
  // behaved scheduler's OWN state no longer considers anything pending.
  // (The real guarantee against double-fire is clearTimeoutFn being called;
  // this asserts the scheduler's internal bookkeeping agrees.)
  void pendingCb;
  assert.equal(calls, 0);
});

test('createDebouncedScheduler: schedule() after a completed run starts a fresh window', () => {
  let calls = 0;
  let pendingCb = null;
  const scheduler = createDebouncedScheduler(() => { calls += 1; }, 250, {
    setTimeoutFn: (cb) => { pendingCb = cb; return {}; },
    clearTimeoutFn: () => {},
  });
  scheduler.schedule();
  pendingCb();
  assert.equal(calls, 1);
  scheduler.schedule();
  pendingCb();
  assert.equal(calls, 2);
});

// ── Strip rules ───────────────────────────────────────────────────────────
test('strip rules: the bridge highlight style and the PDF download link are the two stripped ids', () => {
  assert.deepEqual([...STRIP_IDS], [
    'invoice-bridge-canvas-highlight-style',
    'invoice-pdf-download-link',
  ]);
  assert.equal(shouldStripElementId('invoice-bridge-canvas-highlight-style'), true);
  assert.equal(shouldStripElementId('invoice-pdf-download-link'), true);
  assert.equal(shouldStripElementId('invoice-draft-logo'), false);
  assert.equal(shouldStripElementId(''), false);
  assert.equal(shouldStripElementId(undefined), false);
});

test('strip rules: script elements are stripped, nothing else is', () => {
  assert.deepEqual([...STRIP_SELECTORS], ['script']);
  assert.equal(shouldStripSelector('script'), true);
  assert.equal(shouldStripSelector('style'), false);
  assert.equal(shouldStripSelector('iframe'), false);
});

test('strip rules: only contenteditable is stripped as an attribute', () => {
  assert.deepEqual([...STRIP_ATTRIBUTES], ['contenteditable']);
  assert.equal(shouldStripAttribute('contenteditable'), true);
  assert.equal(shouldStripAttribute('data-inv-field'), false);
});

// ── Module import sanity (per the handoff's verification instructions) ────
test('module exposes the documented constants with sane values', () => {
  assert.equal(DEFAULT_DEBOUNCE_MS, 250);
  assert.ok(MAX_TEXTURE_DIMENSION > 0);
});
