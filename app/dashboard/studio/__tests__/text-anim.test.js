import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TEXT_LAYER, sanitizeTextLayer, sanitizeTextLayers, createTextLayer,
  TEXT_ANIM_INS, TEXT_ANIM_OUTS, TEXT_ANIM_EASES, TEXT_ANIM_TRACKING_MAX_MUL,
  computeTextAnimState,
} from '../text-layers.js';

// ── DEFAULT_TEXT_LAYER.anim / enum shape ────────────────────────────────

test('DEFAULT_TEXT_LAYER.anim matches the handoff-specified default exactly', () => {
  assert.deepEqual(DEFAULT_TEXT_LAYER.anim, { in: 'fade', out: 'none', inDur: 0.8, outDur: 0.5, delay: 0, ease: 'power2' });
});

test('TEXT_ANIM_INS / TEXT_ANIM_OUTS / TEXT_ANIM_EASES are exactly the enums the handoff specifies', () => {
  assert.deepEqual(TEXT_ANIM_INS, ['none', 'fade', 'rise', 'blur', 'tracking', 'wipe']);
  assert.deepEqual(TEXT_ANIM_OUTS, ['none', 'fade', 'sink', 'blur']);
  assert.deepEqual(TEXT_ANIM_EASES, ['linear', 'power2', 'power4']);
  assert.equal(TEXT_ANIM_TRACKING_MAX_MUL, 1.35);
});

// ── sanitizeTextLayer('.anim') — bounds + backward compat ───────────────

test('sanitizeTextLayer: a layer with no `anim` key at all (old localStorage/recipe) gets the DEFAULT_TEXT_LAYER.anim default', () => {
  const s = sanitizeTextLayer({ text: 'OLD LAYER' });
  assert.deepEqual(s.anim, DEFAULT_TEXT_LAYER.anim);
});

test('sanitizeTextLayer: anim.in/out/ease fall back to fallback.anim, then to DEFAULT_TEXT_LAYER.anim, on an invalid id', () => {
  assert.equal(sanitizeTextLayer({ anim: { in: 'not-a-real-preset' } }).anim.in, DEFAULT_TEXT_LAYER.anim.in);
  assert.equal(sanitizeTextLayer({ anim: { out: 'not-a-real-preset' } }).anim.out, DEFAULT_TEXT_LAYER.anim.out);
  assert.equal(sanitizeTextLayer({ anim: { ease: 'bounce' } }).anim.ease, DEFAULT_TEXT_LAYER.anim.ease);

  const fb = { ...DEFAULT_TEXT_LAYER, anim: { in: 'wipe', out: 'blur', inDur: 1.2, outDur: 0.9, delay: 0.3, ease: 'linear' } };
  assert.equal(sanitizeTextLayer({ anim: { in: 'nonsense' } }, fb).anim.in, 'wipe');
  assert.equal(sanitizeTextLayer({ anim: { out: 'nonsense' } }, fb).anim.out, 'blur');
  assert.equal(sanitizeTextLayer({ anim: { ease: 'nonsense' } }, fb).anim.ease, 'linear');
});

test('sanitizeTextLayer: anim.in/out are valid IDs from their own enum, never cross-swapped (an OUT-only id passed as `in` falls back)', () => {
  // 'sink' is OUT-only — never a legal `in` value.
  assert.equal(sanitizeTextLayer({ anim: { in: 'sink' } }).anim.in, DEFAULT_TEXT_LAYER.anim.in);
  // 'tracking'/'wipe' are IN-only — never legal `out` values.
  assert.equal(sanitizeTextLayer({ anim: { out: 'tracking' } }).anim.out, DEFAULT_TEXT_LAYER.anim.out);
  assert.equal(sanitizeTextLayer({ anim: { out: 'wipe' } }).anim.out, DEFAULT_TEXT_LAYER.anim.out);
});

test('sanitizeTextLayer: anim.inDur/outDur clamp to [0.1, 5]', () => {
  assert.equal(sanitizeTextLayer({ anim: { inDur: 0 } }).anim.inDur, 0.1);
  assert.equal(sanitizeTextLayer({ anim: { inDur: 999 } }).anim.inDur, 5);
  assert.equal(sanitizeTextLayer({ anim: { outDur: -3 } }).anim.outDur, 0.1);
  assert.equal(sanitizeTextLayer({ anim: { outDur: 50 } }).anim.outDur, 5);
  assert.equal(sanitizeTextLayer({ anim: { inDur: 2.3 } }).anim.inDur, 2.3);
});

test('sanitizeTextLayer: anim.delay clamps to [0, 10]', () => {
  assert.equal(sanitizeTextLayer({ anim: { delay: -5 } }).anim.delay, 0);
  assert.equal(sanitizeTextLayer({ anim: { delay: 999 } }).anim.delay, 10);
  assert.equal(sanitizeTextLayer({ anim: { delay: 3.5 } }).anim.delay, 3.5);
});

test('sanitizeTextLayer: a non-object anim (or missing anim field) falls back entirely to the default, never throws', () => {
  assert.deepEqual(sanitizeTextLayer({ anim: 'not-an-object' }).anim, DEFAULT_TEXT_LAYER.anim);
  assert.deepEqual(sanitizeTextLayer({ anim: null }).anim, DEFAULT_TEXT_LAYER.anim);
  assert.deepEqual(sanitizeTextLayer({ anim: 42 }).anim, DEFAULT_TEXT_LAYER.anim);
});

test('sanitizeTextLayers: an old array of layers (no anim key on any entry) round-trips with every layer getting the default anim', () => {
  const result = sanitizeTextLayers([{ text: 'A' }, { text: 'B', sizePct: 20 }]);
  assert.deepEqual(result[0].anim, DEFAULT_TEXT_LAYER.anim);
  assert.deepEqual(result[1].anim, DEFAULT_TEXT_LAYER.anim);
});

test('createTextLayer: a partial anim override merges over the default via sanitizeTextAnim (missing anim sub-fields are NOT lost)', () => {
  const layer = createTextLayer('txt-1', { anim: { in: 'blur' } });
  assert.equal(layer.anim.in, 'blur');
  assert.equal(layer.anim.out, DEFAULT_TEXT_LAYER.anim.out);
  assert.equal(layer.anim.inDur, DEFAULT_TEXT_LAYER.anim.inDur);
  assert.equal(layer.anim.outDur, DEFAULT_TEXT_LAYER.anim.outDur);
  assert.equal(layer.anim.ease, DEFAULT_TEXT_LAYER.anim.ease);
});

// ── computeTextAnimState — both-none identity ────────────────────────────

test('computeTextAnimState: in=none AND out=none always returns identity, regardless of t', () => {
  const anim = { in: 'none', out: 'none', inDur: 0.8, outDur: 0.5, delay: 0, ease: 'power2' };
  const identity = { opacityMul: 1, offsetYPct: 0, blurPx: 0, trackingMul: 1, clipT: 1 };
  assert.deepEqual(computeTextAnimState({ anim, tNow: -5, tStart: 0, tEnd: null }), identity);
  assert.deepEqual(computeTextAnimState({ anim, tNow: 0, tStart: 0, tEnd: 10 }), identity);
  assert.deepEqual(computeTextAnimState({ anim, tNow: 1000, tStart: 0, tEnd: 10 }), identity);
});

// ── computeTextAnimState — IN phase boundaries + delay ───────────────────

test('computeTextAnimState: pre-in (t <= tStart+delay) is the FULL pre-in state for fade', () => {
  const anim = { in: 'fade', out: 'none', inDur: 0.8, outDur: 0.5, delay: 0, ease: 'power2' };
  assert.equal(computeTextAnimState({ anim, tNow: 0, tStart: 0, tEnd: null }).opacityMul, 0);
  assert.equal(computeTextAnimState({ anim, tNow: -10, tStart: 0, tEnd: null }).opacityMul, 0);
});

test('computeTextAnimState: delay is honored — the in-phase does not start easing until tStart+delay', () => {
  const anim = { in: 'fade', out: 'none', inDur: 1, outDur: 0.5, delay: 2, ease: 'linear' };
  // Still fully pre-in at t=1.9 (< tStart+delay=2).
  assert.equal(computeTextAnimState({ anim, tNow: 1.9, tStart: 0, tEnd: null }).opacityMul, 0);
  // Exactly at the delay boundary — still progress 0.
  assert.equal(computeTextAnimState({ anim, tNow: 2, tStart: 0, tEnd: null }).opacityMul, 0);
  // Halfway through inDur AFTER the delay (t=2.5, inDur=1) -> linear p=0.5.
  assert.equal(computeTextAnimState({ anim, tNow: 2.5, tStart: 0, tEnd: null }).opacityMul, 0.5);
  // Fully eased in by t=3 (delay+inDur).
  assert.equal(computeTextAnimState({ anim, tNow: 3, tStart: 0, tEnd: null }).opacityMul, 1);
});

test('computeTextAnimState: mid-in at a KNOWN ease value for each of the three ease functions (fade, no delay)', () => {
  const base = { in: 'fade', out: 'none', inDur: 1, outDur: 0.5, delay: 0 };
  assert.equal(computeTextAnimState({ anim: { ...base, ease: 'linear' }, tNow: 0.5, tStart: 0, tEnd: null }).opacityMul, 0.5);
  assert.equal(computeTextAnimState({ anim: { ...base, ease: 'power2' }, tNow: 0.5, tStart: 0, tEnd: null }).opacityMul, 0.75);
  assert.equal(computeTextAnimState({ anim: { ...base, ease: 'power4' }, tNow: 0.5, tStart: 0, tEnd: null }).opacityMul, 0.9375);
});

test('computeTextAnimState: identity mid (after the in-window completes, before any out-window starts)', () => {
  const anim = { in: 'fade', out: 'fade', inDur: 0.5, outDur: 0.5, delay: 0, ease: 'linear' };
  const state = computeTextAnimState({ anim, tNow: 5, tStart: 0, tEnd: 20 });
  assert.deepEqual(state, { opacityMul: 1, offsetYPct: 0, blurPx: 0, trackingMul: 1, clipT: 1 });
});

// ── computeTextAnimState — OUT window anchored to tEnd, mid-out, post-out ─

test('computeTextAnimState: the out window starts EXACTLY at tEnd - outDur (identity there), not tStart-relative', () => {
  const anim = { in: 'none', out: 'fade', inDur: 0.8, outDur: 2, delay: 0, ease: 'linear' };
  const tEnd = 30;
  const outStart = tEnd - anim.outDur; // 28
  assert.equal(computeTextAnimState({ anim, tNow: outStart - 0.001, tStart: 0, tEnd }).opacityMul, 1, 'just before outStart: still identity');
  assert.equal(computeTextAnimState({ anim, tNow: outStart, tStart: 0, tEnd }).opacityMul, 1, 'exactly at outStart: progress 0 -> identity');
});

test('computeTextAnimState: mid-out at a known ease value (fade, linear)', () => {
  const anim = { in: 'none', out: 'fade', inDur: 0.8, outDur: 2, delay: 0, ease: 'linear' };
  const tEnd = 30;
  // outStart=28, halfway through the 2s outDur = t=29 -> p=0.5 -> opacityMul=0.5.
  assert.equal(computeTextAnimState({ anim, tNow: 29, tStart: 0, tEnd }).opacityMul, 0.5);
});

test('computeTextAnimState: post-out (t >= tEnd) holds the out endpoint forever, never snaps back to identity', () => {
  const anim = { in: 'none', out: 'fade', inDur: 0.8, outDur: 1, delay: 0, ease: 'linear' };
  const tEnd = 10;
  assert.equal(computeTextAnimState({ anim, tNow: tEnd, tStart: 0, tEnd }).opacityMul, 0);
  assert.equal(computeTextAnimState({ anim, tNow: tEnd + 500, tStart: 0, tEnd }).opacityMul, 0, 'held long after tEnd, not reset');
});

test('computeTextAnimState: out=none holds identity forever past tEnd (no fade-out at all)', () => {
  const anim = { in: 'fade', out: 'none', inDur: 0.5, outDur: 0.5, delay: 0, ease: 'linear' };
  const state = computeTextAnimState({ anim, tNow: 1000, tStart: 0, tEnd: 10 });
  assert.deepEqual(state, { opacityMul: 1, offsetYPct: 0, blurPx: 0, trackingMul: 1, clipT: 1 });
});

// ── computeTextAnimState — no out window when tEnd is null/Infinity ──────

test('computeTextAnimState: tEnd=null means NO out window — state stays at post-in identity indefinitely (live preview loop case)', () => {
  const anim = { in: 'fade', out: 'fade', inDur: 0.5, outDur: 0.5, delay: 0, ease: 'linear' };
  const state = computeTextAnimState({ anim, tNow: 999999, tStart: 0, tEnd: null });
  assert.equal(state.opacityMul, 1, 'no out window ever fires, regardless of how much time has passed');
});

test('computeTextAnimState: tEnd=Infinity behaves identically to tEnd=null (no out window)', () => {
  const anim = { in: 'fade', out: 'fade', inDur: 0.5, outDur: 0.5, delay: 0, ease: 'linear' };
  const a = computeTextAnimState({ anim, tNow: 100, tStart: 0, tEnd: Infinity });
  const b = computeTextAnimState({ anim, tNow: 100, tStart: 0, tEnd: null });
  assert.deepEqual(a, b);
});

test('computeTextAnimState: tEnd=undefined also means no out window', () => {
  const anim = { in: 'none', out: 'fade', inDur: 0.5, outDur: 0.5, delay: 0, ease: 'linear' };
  const state = computeTextAnimState({ anim, tNow: 100, tStart: 0, tEnd: undefined });
  assert.equal(state.opacityMul, 1);
});

// ── computeTextAnimState — every preset maps to its expected channels only ─

test('computeTextAnimState: fade touches ONLY opacityMul (in and out)', () => {
  const inState = computeTextAnimState({ anim: { in: 'fade', out: 'none', inDur: 1, outDur: 0.5, delay: 0, ease: 'linear' }, tNow: 0.5, tStart: 0, tEnd: null });
  assert.equal(inState.opacityMul, 0.5);
  assert.equal(inState.offsetYPct, 0); assert.equal(inState.blurPx, 0); assert.equal(inState.trackingMul, 1); assert.equal(inState.clipT, 1);

  const outState = computeTextAnimState({ anim: { in: 'none', out: 'fade', inDur: 0.5, outDur: 1, delay: 0, ease: 'linear' }, tNow: 9.5, tStart: 0, tEnd: 10 });
  assert.equal(outState.opacityMul, 0.5);
  assert.equal(outState.offsetYPct, 0); assert.equal(outState.blurPx, 0); assert.equal(outState.trackingMul, 1); assert.equal(outState.clipT, 1);
});

test('computeTextAnimState: rise touches opacityMul + offsetYPct only, easing +8% -> 0%', () => {
  const anim = { in: 'rise', out: 'none', inDur: 1, outDur: 0.5, delay: 0, ease: 'linear' };
  const preIn = computeTextAnimState({ anim, tNow: 0, tStart: 0, tEnd: null });
  assert.equal(preIn.opacityMul, 0);
  assert.equal(preIn.offsetYPct, 8);
  assert.equal(preIn.blurPx, 0); assert.equal(preIn.trackingMul, 1); assert.equal(preIn.clipT, 1);

  const mid = computeTextAnimState({ anim, tNow: 0.5, tStart: 0, tEnd: null });
  assert.equal(mid.opacityMul, 0.5);
  assert.equal(mid.offsetYPct, 4);

  const done = computeTextAnimState({ anim, tNow: 1, tStart: 0, tEnd: null });
  assert.equal(done.opacityMul, 1);
  assert.equal(done.offsetYPct, 0);
});

test('computeTextAnimState: sink (out only) touches opacityMul + offsetYPct, easing 0% -> +8%', () => {
  const anim = { in: 'none', out: 'sink', inDur: 0.5, outDur: 1, delay: 0, ease: 'linear' };
  const tEnd = 10;
  const preOut = computeTextAnimState({ anim, tNow: 9, tStart: 0, tEnd }); // outStart
  assert.equal(preOut.opacityMul, 1);
  assert.equal(preOut.offsetYPct, 0);

  const midOut = computeTextAnimState({ anim, tNow: 9.5, tStart: 0, tEnd });
  assert.equal(midOut.opacityMul, 0.5);
  assert.equal(midOut.offsetYPct, 4);

  const postOut = computeTextAnimState({ anim, tNow: tEnd, tStart: 0, tEnd });
  assert.equal(postOut.opacityMul, 0);
  assert.equal(postOut.offsetYPct, 8);
  assert.equal(postOut.blurPx, 0); assert.equal(postOut.trackingMul, 1); assert.equal(postOut.clipT, 1);
});

test('computeTextAnimState: blur touches opacityMul + blurPx, easing 14 -> 0 (in) / 0 -> 14 (out)', () => {
  const inAnim = { in: 'blur', out: 'none', inDur: 1, outDur: 0.5, delay: 0, ease: 'linear' };
  const preIn = computeTextAnimState({ anim: inAnim, tNow: 0, tStart: 0, tEnd: null });
  assert.equal(preIn.blurPx, 14);
  assert.equal(preIn.opacityMul, 0);
  const doneIn = computeTextAnimState({ anim: inAnim, tNow: 1, tStart: 0, tEnd: null });
  assert.equal(doneIn.blurPx, 0);

  const outAnim = { in: 'none', out: 'blur', inDur: 0.5, outDur: 1, delay: 0, ease: 'linear' };
  const tEnd = 10;
  const postOut = computeTextAnimState({ anim: outAnim, tNow: tEnd, tStart: 0, tEnd });
  assert.equal(postOut.blurPx, 14);
  assert.equal(postOut.opacityMul, 0);
});

test('computeTextAnimState: tracking (in only) touches opacityMul + trackingMul, easing 1.35 -> 1', () => {
  const anim = { in: 'tracking', out: 'none', inDur: 1, outDur: 0.5, delay: 0, ease: 'linear' };
  const preIn = computeTextAnimState({ anim, tNow: 0, tStart: 0, tEnd: null });
  assert.equal(preIn.trackingMul, TEXT_ANIM_TRACKING_MAX_MUL);
  assert.equal(preIn.opacityMul, 0);
  assert.equal(preIn.offsetYPct, 0); assert.equal(preIn.blurPx, 0); assert.equal(preIn.clipT, 1);
  const doneIn = computeTextAnimState({ anim, tNow: 1, tStart: 0, tEnd: null });
  assert.equal(doneIn.trackingMul, 1);
});

test('computeTextAnimState: wipe (in only) touches ONLY clipT — opacityMul stays 1 the whole in-phase', () => {
  const anim = { in: 'wipe', out: 'none', inDur: 1, outDur: 0.5, delay: 0, ease: 'linear' };
  const preIn = computeTextAnimState({ anim, tNow: 0, tStart: 0, tEnd: null });
  assert.equal(preIn.clipT, 0);
  assert.equal(preIn.opacityMul, 1, 'wipe never fades opacity, even at progress 0');
  assert.equal(preIn.offsetYPct, 0); assert.equal(preIn.blurPx, 0); assert.equal(preIn.trackingMul, 1);

  const mid = computeTextAnimState({ anim, tNow: 0.5, tStart: 0, tEnd: null });
  assert.equal(mid.clipT, 0.5);
  assert.equal(mid.opacityMul, 1);

  const done = computeTextAnimState({ anim, tNow: 1, tStart: 0, tEnd: null });
  assert.equal(done.clipT, 1);
});

// ── computeTextAnimState — overlap precedence (documented, deterministic) ─

test('computeTextAnimState: when the in-window and out-window overlap (very short duration), the OUT phase wins for that frame', () => {
  // inDur=1 (finishes at t=1), but outStart = tEnd-outDur = 1.5-1 = 0.5 —
  // overlapping the in-phase's own [0,1] window.
  const anim = { in: 'fade', out: 'fade', inDur: 1, outDur: 1, delay: 0, ease: 'linear' };
  const tEnd = 1.5;
  const state = computeTextAnimState({ anim, tNow: 0.6, tStart: 0, tEnd });
  // out progress at t=0.6: (0.6-0.5)/1 = 0.1 -> opacityMul = 1-0.1 = 0.9,
  // NOT the in-phase's own (0.6/1=0.6) value — out wins outright.
  assert.equal(state.opacityMul, 0.9);
});

// ── Defensive defaults (malformed anim input never throws/NaNs) ──────────

test('computeTextAnimState: a malformed/partial anim object still returns a fully-populated, finite state', () => {
  const state = computeTextAnimState({ anim: { in: 'fade' }, tNow: 0.1, tStart: 0, tEnd: null });
  Object.values(state).forEach((v) => assert.ok(Number.isFinite(v)));
});
