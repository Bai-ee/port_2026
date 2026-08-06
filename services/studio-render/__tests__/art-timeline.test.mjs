// art-timeline.test.mjs — Phase C ("Interrupted export recovery" — timeline
// transport + server keyframed device scroll, STUDIO-DETERMINISTIC-FINAL-
// RENDER-SONNET-HANDOFF.md). Pure unit tests, no Playwright/Chromium, no
// Firestore — mirrors art-recipe.test.mjs's own "pure" test-file discipline
// for the sibling module this exercises.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeArtTimeline, checkArtTimelineCapabilities, timelineDurationMismatch, MAX_TIMELINE_KEYFRAMES } from '../art-timeline.mjs';
import { normalizeArtSceneRecipe } from '../art-recipe.mjs';

function baseRecipe(scene = {}) {
  return normalizeArtSceneRecipe({ kind: 'art-scene-v2', schemaVersion: 1, scene }).recipe;
}

// ── sanitizeArtTimeline — pure bounds/clamps/sort/cap ───────────────────────

test('sanitizeArtTimeline: absent/malformed input reduces to {totalSeconds:0, keyframes:[]} — identical to "no timeline"', () => {
  assert.deepEqual(sanitizeArtTimeline(undefined), { totalSeconds: 0, keyframes: [] });
  assert.deepEqual(sanitizeArtTimeline(null), { totalSeconds: 0, keyframes: [] });
  assert.deepEqual(sanitizeArtTimeline('not an object'), { totalSeconds: 0, keyframes: [] });
  assert.deepEqual(sanitizeArtTimeline([1, 2, 3]), { totalSeconds: 0, keyframes: [] });
  assert.deepEqual(sanitizeArtTimeline({}), { totalSeconds: 0, keyframes: [] });
});

test('sanitizeArtTimeline: an explicit empty keyframes array is identical to absent', () => {
  assert.deepEqual(sanitizeArtTimeline({ keyframes: [], totalSeconds: 8 }), { totalSeconds: 0, keyframes: [] });
});

test('sanitizeArtTimeline: a keyframe with a missing/non-object `recipe` is dropped — never a partial/invalid keyframe', () => {
  const raw = {
    totalSeconds: 5,
    keyframes: [
      { t: 0.1 }, // no recipe at all
      { t: 0.2, recipe: 'not-an-object' },
      { t: 0.3, recipe: ['array', 'not', 'object'] },
      { t: 0.4, recipe: { devicePrimary: { scrollPosition: 0.5 } } }, // the one survivor
    ],
  };
  const out = sanitizeArtTimeline(raw);
  assert.equal(out.keyframes.length, 1);
  assert.equal(out.keyframes[0].t, 0.4);
});

test('sanitizeArtTimeline: t clamps to [0,1] and the kept array sorts ascending by t', () => {
  const raw = {
    totalSeconds: 5,
    keyframes: [
      { t: 5, recipe: { devicePrimary: {} } }, // clamps to 1
      { t: -3, recipe: { devicePrimary: {} } }, // clamps to 0
      { t: 0.5, recipe: { devicePrimary: {} } },
    ],
  };
  const out = sanitizeArtTimeline(raw);
  const ts = out.keyframes.map((kf) => kf.t);
  assert.deepEqual(ts, [...ts].sort((a, b) => a - b), 'kept array must already be t-ascending');
  assert.equal(ts[0], 0);
  assert.equal(ts[ts.length - 1], 1);
});

test('sanitizeArtTimeline: exact-tie t values are nudged apart — never a zero-width interpolation segment', () => {
  const raw = {
    totalSeconds: 5,
    keyframes: [
      { t: 0.5, recipe: { devicePrimary: {} } },
      { t: 0.5, recipe: { devicePrimary: {} } },
    ],
  };
  const out = sanitizeArtTimeline(raw);
  assert.ok(out.keyframes[1].t > out.keyframes[0].t, 'a tie must be nudged apart, never left as a zero-width segment');
});

test('sanitizeArtTimeline: missing t defaults to 0', () => {
  const out = sanitizeArtTimeline({ totalSeconds: 5, keyframes: [{ recipe: { devicePrimary: {} } }] });
  assert.equal(out.keyframes[0].t, 0);
});

test('sanitizeArtTimeline: caps at MAX_TIMELINE_KEYFRAMES, dropping the tail', () => {
  const raw = {
    totalSeconds: 5,
    keyframes: Array.from({ length: MAX_TIMELINE_KEYFRAMES + 5 }, (_, i) => ({ t: i / (MAX_TIMELINE_KEYFRAMES + 5), recipe: { devicePrimary: {} } })),
  };
  const out = sanitizeArtTimeline(raw);
  assert.equal(out.keyframes.length, MAX_TIMELINE_KEYFRAMES);
});

test('sanitizeArtTimeline: scrollPosition clamps to [0,1], posY clamps to [-0.8,0.8] — the exact recipe bounds', () => {
  const raw = {
    totalSeconds: 5,
    keyframes: [
      { t: 0, recipe: { devicePrimary: { scrollPosition: 5, posY: -50 } } },
      { t: 0.5, recipe: { devicePrimary: { scrollPosition: -5, posY: 50 } } },
    ],
  };
  const out = sanitizeArtTimeline(raw);
  assert.equal(out.keyframes[0].scroll.scrollPosition, 1);
  assert.equal(out.keyframes[0].scroll.posY, -0.8);
  assert.equal(out.keyframes[1].scroll.scrollPosition, 0);
  assert.equal(out.keyframes[1].scroll.posY, 0.8);
});

test('sanitizeArtTimeline: missing/non-finite scrollPosition/posY default to 0, and a missing devicePrimary is treated the same way', () => {
  const raw = {
    totalSeconds: 5,
    keyframes: [
      { t: 0, recipe: { devicePrimary: { scrollPosition: 'nope', posY: NaN } } },
      { t: 0.5, recipe: {} }, // no devicePrimary at all
    ],
  };
  const out = sanitizeArtTimeline(raw);
  out.keyframes.forEach((kf) => {
    assert.equal(kf.scroll.scrollPosition, 0);
    assert.equal(kf.scroll.posY, 0);
  });
});

test('sanitizeArtTimeline: totalSeconds clamps to [1,120] with default 8, but only when at least one keyframe survives', () => {
  const withKf = (totalSeconds) => sanitizeArtTimeline({ totalSeconds, keyframes: [{ t: 0, recipe: { devicePrimary: {} } }] });
  assert.equal(withKf(500).totalSeconds, 120);
  assert.equal(withKf(-5).totalSeconds, 1);
  assert.equal(withKf('nope').totalSeconds, 8);
  assert.equal(withKf(undefined).totalSeconds, 8);
  assert.equal(withKf(12).totalSeconds, 12);

  // Zero surviving keyframes -> totalSeconds is always 0, regardless of the raw value (absent-vs-empty contract).
  assert.equal(sanitizeArtTimeline({ totalSeconds: 500, keyframes: [] }).totalSeconds, 0);
});

test('sanitizeArtTimeline: never throws on hostile input (prototype-chain probes, deeply nested garbage)', () => {
  assert.doesNotThrow(() => sanitizeArtTimeline({ keyframes: [{ t: 0, recipe: { devicePrimary: { __proto__: { scrollPosition: 1 } } } }] }));
  assert.doesNotThrow(() => sanitizeArtTimeline({ __proto__: { totalSeconds: 999 }, keyframes: [{ t: 0, recipe: {} }] }));
});

// ── checkArtTimelineCapabilities — the honesty check ────────────────────────

test('checkArtTimelineCapabilities: no timeline / zero valid keyframes is trivially supported', () => {
  const base = baseRecipe();
  assert.deepEqual(checkArtTimelineCapabilities(base, undefined), { supported: true, unsupportedFeatures: [] });
  assert.deepEqual(checkArtTimelineCapabilities(base, { keyframes: [] }), { supported: true, unsupportedFeatures: [] });
  assert.deepEqual(checkArtTimelineCapabilities(base, { keyframes: [{ t: 0 }] }), { supported: true, unsupportedFeatures: [] }, 'a structurally invalid keyframe (no recipe) is skipped, not rejected');
});

test('checkArtTimelineCapabilities: identical keyframes are inert and accepted', () => {
  const base = baseRecipe({ mat: { baseColor: '#101114' } });
  const timeline = { keyframes: [{ t: 0, recipe: { mat: { baseColor: '#101114' } } }, { t: 0.5, recipe: { mat: { baseColor: '#101114' } } }] };
  assert.deepEqual(checkArtTimelineCapabilities(base, timeline), { supported: true, unsupportedFeatures: [] });
});

test('checkArtTimelineCapabilities: devicePrimary.scrollPosition/posY-only deltas are accepted (the whitelist)', () => {
  const base = baseRecipe();
  const timeline = { keyframes: [
    { t: 0, recipe: { devicePrimary: { scrollPosition: 0, posY: 0 } } },
    { t: 1, recipe: { devicePrimary: { scrollPosition: 1, posY: 0.5 } } },
  ] };
  assert.deepEqual(checkArtTimelineCapabilities(base, timeline), { supported: true, unsupportedFeatures: [] });
});

test('checkArtTimelineCapabilities: whitelist-only deltas are accepted even on a NON-device scene (the whitelist fields are device-only, but inert elsewhere — not a rejection reason)', () => {
  const base = baseRecipe({ clothShape: 'sheet' });
  const timeline = { keyframes: [
    { t: 0, recipe: { clothShape: 'sheet', devicePrimary: { scrollPosition: 0 } } },
    { t: 1, recipe: { clothShape: 'sheet', devicePrimary: { scrollPosition: 1 } } },
  ] };
  assert.deepEqual(checkArtTimelineCapabilities(base, timeline), { supported: true, unsupportedFeatures: [] });
});

test('checkArtTimelineCapabilities: a glass.scale delta rejects precisely as timeline-field:glass.scale', () => {
  const base = baseRecipe();
  const timeline = { keyframes: [{ t: 0.5, recipe: { glass: { scale: 2 } } }] };
  assert.deepEqual(checkArtTimelineCapabilities(base, timeline), { supported: false, unsupportedFeatures: ['timeline-field:glass.scale'] });
});

test('checkArtTimelineCapabilities: a shotCam.az delta rejects precisely as timeline-field:shotCam.az', () => {
  const base = baseRecipe();
  const timeline = { keyframes: [{ t: 0.5, recipe: { shotCam: { az: 99 } } }] };
  assert.deepEqual(checkArtTimelineCapabilities(base, timeline), { supported: false, unsupportedFeatures: ['timeline-field:shotCam.az'] });
});

test('checkArtTimelineCapabilities: array-element deltas use the SAME dot-path convention as TIMELINE_LERP_WHITELIST (e.g. glass.position.1, lightCans.0.intensity)', () => {
  const base = baseRecipe();
  const posDelta = checkArtTimelineCapabilities(base, { keyframes: [{ t: 0, recipe: { glass: { position: [0, 5, 0] } } }] });
  assert.deepEqual(posDelta.unsupportedFeatures, ['timeline-field:glass.position.1']);

  const canDelta = checkArtTimelineCapabilities(base, { keyframes: [{ t: 0, recipe: { lightCans: [{ intensity: 3 }, base.lightCans[1], base.lightCans[2], base.lightCans[3]] } }] });
  assert.deepEqual(canDelta.unsupportedFeatures, ['timeline-field:lightCans.0.intensity']);
});

test('checkArtTimelineCapabilities: complete-list behavior — every distinct unsupported path across every keyframe is reported at once (never short-circuits)', () => {
  const base = baseRecipe();
  const timeline = { keyframes: [
    { t: 0, recipe: { glass: { scale: 2 } } },
    { t: 0.5, recipe: { shotCam: { az: 10 } } },
    { t: 1, recipe: { mat: { roughness: 0.9 } } },
  ] };
  const result = checkArtTimelineCapabilities(base, timeline);
  assert.equal(result.supported, false);
  assert.deepEqual(result.unsupportedFeatures, ['timeline-field:glass.scale', 'timeline-field:mat.roughness', 'timeline-field:shotCam.az'], 'sorted, deduped, complete');
});

test('checkArtTimelineCapabilities: the SAME differing field across multiple keyframes is reported exactly once (deduped)', () => {
  const base = baseRecipe();
  const timeline = { keyframes: [
    { t: 0, recipe: { glass: { scale: 1.5 } } },
    { t: 0.5, recipe: { glass: { scale: 2 } } },
    { t: 1, recipe: { glass: { scale: 1.8 } } },
  ] };
  const result = checkArtTimelineCapabilities(base, timeline);
  assert.deepEqual(result.unsupportedFeatures, ['timeline-field:glass.scale']);
});

test('checkArtTimelineCapabilities: differing orbitPose across keyframes rejects as timeline-orbit-pose; identical (incl. all-null) is accepted', () => {
  const base = baseRecipe();
  const pose = { px: 0, py: 0, pz: 2.6, tx: 0, ty: 0, tz: 0 };
  const posedDifferently = { keyframes: [
    { t: 0, recipe: {}, orbitPose: pose },
    { t: 1, recipe: {}, orbitPose: { ...pose, px: 1 } },
  ] };
  assert.deepEqual(checkArtTimelineCapabilities(base, posedDifferently), { supported: false, unsupportedFeatures: ['timeline-orbit-pose'] });

  const posedSame = { keyframes: [
    { t: 0, recipe: {}, orbitPose: pose },
    { t: 1, recipe: {}, orbitPose: { ...pose } },
  ] };
  assert.deepEqual(checkArtTimelineCapabilities(base, posedSame), { supported: true, unsupportedFeatures: [] });

  const allNull = { keyframes: [{ t: 0, recipe: {}, orbitPose: null }, { t: 1, recipe: {} }] };
  assert.deepEqual(checkArtTimelineCapabilities(base, allNull), { supported: true, unsupportedFeatures: [] });

  const oneNullOneSet = { keyframes: [{ t: 0, recipe: {}, orbitPose: null }, { t: 1, recipe: {}, orbitPose: pose }] };
  assert.deepEqual(checkArtTimelineCapabilities(base, oneNullOneSet), { supported: false, unsupportedFeatures: ['timeline-orbit-pose'] });
});

test('checkArtTimelineCapabilities: orbit-pose AND field rejections combine into one complete list', () => {
  const base = baseRecipe();
  const timeline = { keyframes: [
    { t: 0, recipe: {}, orbitPose: { px: 0, py: 0, pz: 2.6, tx: 0, ty: 0, tz: 0 } },
    { t: 1, recipe: { glass: { scale: 2 } }, orbitPose: { px: 1, py: 0, pz: 2.6, tx: 0, ty: 0, tz: 0 } },
  ] };
  const result = checkArtTimelineCapabilities(base, timeline);
  assert.deepEqual(result.unsupportedFeatures, ['timeline-field:glass.scale', 'timeline-orbit-pose']);
});

test('checkArtTimelineCapabilities: device screen-source field deltas are IGNORED (never compared), even though the client already strips them — defense in depth', () => {
  const base = baseRecipe({ clothShape: 'device', devicePrimary: { screenStill: { sha256: 'a'.repeat(64), ext: 'png', width: 10, height: 10, bytes: 5 } } });
  const timeline = { keyframes: [{
    t: 0,
    recipe: {
      clothShape: 'device',
      devicePrimary: {
        live: true, liveUrl: 'https://example.com', captureUrl: '/api/public/studio-device-capture?x=1', uploadAssetId: 'evil-asset',
        // no screenStill on the keyframe side at all — the client's own stripping contract
      },
    },
  }] };
  assert.deepEqual(checkArtTimelineCapabilities(base, timeline), { supported: true, unsupportedFeatures: [] });
});

test('checkArtTimelineCapabilities: a malformed pinned-still shape on the keyframe side never leaks a timeline-field:devicePrimary.screenStill.* path (screenStillInvalid is also ignored)', () => {
  const base = baseRecipe({ clothShape: 'device' });
  const timeline = { keyframes: [{ t: 0, recipe: { clothShape: 'device', devicePrimary: { screenStill: { sha256: 'not-valid' } } } }] };
  const result = checkArtTimelineCapabilities(base, timeline);
  assert.deepEqual(result, { supported: true, unsupportedFeatures: [] });
});

// ── Recovery round 2 (Fix 3) — environmental/derived/authoring-only fields
// are ignored; genuine render-affecting deltas keep rejecting ────────────

test('checkArtTimelineCapabilities: a keyframe differing ONLY in stageAspect is ACCEPTED — the base scene\'s own value already governs the whole render (crop math never reads the keyframe\'s copy)', () => {
  const base = baseRecipe(); // default stageAspect (16/9)
  const timeline = { keyframes: [{ t: 0.5, recipe: { stageAspect: 1 } }] }; // a totally different aspect
  assert.deepEqual(checkArtTimelineCapabilities(base, timeline), { supported: true, unsupportedFeatures: [] });
});

test('checkArtTimelineCapabilities: a keyframe differing ONLY in cam.rotX/rotY/pan is ACCEPTED — orbit-drag preview toggles have zero rendering effect', () => {
  const base = baseRecipe(); // default cam {rotX:true, rotY:true, pan:true}
  const timeline = { keyframes: [{ t: 0.5, recipe: { cam: { rotX: false, rotY: false, pan: false } } }] };
  assert.deepEqual(checkArtTimelineCapabilities(base, timeline), { supported: true, unsupportedFeatures: [] });
});

test('checkArtTimelineCapabilities: a keyframe differing ONLY in lightTemplate is ACCEPTED — an informational label; lightCans (the actual values) still fully rejects when it genuinely differs', () => {
  const base = baseRecipe(); // default lightTemplate 'studio'
  const timeline = { keyframes: [{ t: 0.5, recipe: { lightTemplate: 'neon-cross' } }] };
  assert.deepEqual(checkArtTimelineCapabilities(base, timeline), { supported: true, unsupportedFeatures: [] });
});

test('checkArtTimelineCapabilities: a keyframe differing ONLY in camSeed is ACCEPTED — provenance for an already-resolved shotCam value, never read', () => {
  const base = baseRecipe(); // default camSeed 1
  const timeline = { keyframes: [{ t: 0.5, recipe: { camSeed: 42 } }] };
  assert.deepEqual(checkArtTimelineCapabilities(base, timeline), { supported: true, unsupportedFeatures: [] });
});

test('checkArtTimelineCapabilities: a keyframe differing ONLY in fxPresetId is ACCEPTED — never read; a genuine fx VALUE difference it would imply is independently caught by the fx object diff, so nothing is hidden', () => {
  const base = baseRecipe(); // default fxPresetId ''
  const timeline = { keyframes: [{ t: 0.5, recipe: { fxPresetId: 'cinema-bloom' } }] };
  assert.deepEqual(checkArtTimelineCapabilities(base, timeline), { supported: true, unsupportedFeatures: [] });
});

test('checkArtTimelineCapabilities: a keyframe differing ONLY in videoSeconds/videoFormat is ACCEPTED — the browser\'s own local Quick Export dial, orthogonal to this render pass\'s own fps/durationSeconds', () => {
  const base = baseRecipe(); // default videoSeconds 5, videoFormat 'mp4'
  const timeline = { keyframes: [{ t: 0.5, recipe: { videoSeconds: 10, videoFormat: 'webm' } }] };
  assert.deepEqual(checkArtTimelineCapabilities(base, timeline), { supported: true, unsupportedFeatures: [] });
});

test('checkArtTimelineCapabilities: a keyframe differing ONLY in elementFormatId is ACCEPTED — editor-only placement-suggestion preference; never read anywhere in the render pipeline', () => {
  const base = baseRecipe(); // default elementFormatId 'landscape'
  const timeline = { keyframes: [{ t: 0.5, recipe: { elementFormatId: 'square' } }] };
  assert.deepEqual(checkArtTimelineCapabilities(base, timeline), { supported: true, unsupportedFeatures: [] });
});

test('checkArtTimelineCapabilities: a keyframe differing ONLY in bgFx.fit/shiftY is ACCEPTED — inert until bgMode:\'image\' itself renders, which stays capability-gated', () => {
  const base = baseRecipe(); // default bgFx {fit:'cover', shiftY:0, diffusion:true}
  const timeline = { keyframes: [{ t: 0.5, recipe: { bgFx: { fit: 'contain', shiftY: 0.5 } } }] };
  assert.deepEqual(checkArtTimelineCapabilities(base, timeline), { supported: true, unsupportedFeatures: [] });
});

test('checkArtTimelineCapabilities: bgFx.diffusion is NOT ignored — it genuinely feeds the diffusion composer\'s uBgDiffusion uniform, so a differing value still rejects precisely', () => {
  const base = baseRecipe();
  const timeline = { keyframes: [{ t: 0.5, recipe: { bgFx: { diffusion: false } } }] };
  assert.deepEqual(checkArtTimelineCapabilities(base, timeline), { supported: false, unsupportedFeatures: ['timeline-field:bgFx.diffusion'] });
});

test('checkArtTimelineCapabilities: sceneSeed is NOT ignored — it genuinely seeds the bgMode:\'scene\' backdrop film grain, so a differing value still rejects precisely (the art-render-validation.mjs field audit predates this and is stale on this one field)', () => {
  const base = baseRecipe({ bgMode: 'scene' });
  const timeline = { keyframes: [{ t: 0.5, recipe: { bgMode: 'scene', sceneSeed: 42 } }] };
  assert.deepEqual(checkArtTimelineCapabilities(base, timeline), { supported: false, unsupportedFeatures: ['timeline-field:sceneSeed'] });
});

test('checkArtTimelineCapabilities: elementQualityTier is NOT ignored — it genuinely sets the tshirt/device factory\'s own build tier, so a differing value still rejects precisely (the older field audit groups it with elementFormatId, which IS ignored — they are not equivalent)', () => {
  const base = baseRecipe({ clothShape: 'device' });
  const timeline = { keyframes: [{ t: 0.5, recipe: { clothShape: 'device', elementQualityTier: 'social' } }] };
  assert.deepEqual(checkArtTimelineCapabilities(base, timeline), { supported: false, unsupportedFeatures: ['timeline-field:elementQualityTier'] });
});

test('checkArtTimelineCapabilities: mixed case — every ignored field differing at once, PLUS one genuine render-affecting delta, reports ONLY the real one', () => {
  const base = baseRecipe();
  const timeline = { keyframes: [{
    t: 0.5,
    recipe: {
      stageAspect: 1, cam: { rotX: false, rotY: false, pan: false }, lightTemplate: 'neon-cross',
      camSeed: 42, fxPresetId: 'cinema-bloom', videoSeconds: 10, videoFormat: 'webm',
      elementFormatId: 'square', bgFx: { fit: 'contain', shiftY: 0.5 },
      glass: { scale: 2 }, // the ONE genuine render-affecting delta
    },
  }] };
  assert.deepEqual(checkArtTimelineCapabilities(base, timeline), { supported: false, unsupportedFeatures: ['timeline-field:glass.scale'] });
});

test('checkArtTimelineCapabilities: complete-list behavior holds under the mix — ignored fields never appear, every distinct real delta across every keyframe is still reported (never short-circuits)', () => {
  const base = baseRecipe();
  const timeline = { keyframes: [
    { t: 0, recipe: { stageAspect: 1, glass: { scale: 2 } } },
    { t: 0.5, recipe: { camSeed: 7, shotCam: { az: 10 } } },
    { t: 1, recipe: { videoSeconds: 15, mat: { roughness: 0.9 } } },
  ] };
  const result = checkArtTimelineCapabilities(base, timeline);
  assert.equal(result.supported, false);
  assert.deepEqual(result.unsupportedFeatures, ['timeline-field:glass.scale', 'timeline-field:mat.roughness', 'timeline-field:shotCam.az']);
});

test('checkArtTimelineCapabilities: a keyframe beyond MAX_TIMELINE_KEYFRAMES is never evaluated (matches sanitizeArtTimeline\'s own cap)', () => {
  const base = baseRecipe();
  const keyframes = Array.from({ length: MAX_TIMELINE_KEYFRAMES }, (_, i) => ({ t: i / MAX_TIMELINE_KEYFRAMES, recipe: {} }));
  keyframes.push({ t: 1, recipe: { glass: { scale: 99 } } }); // beyond the cap — must never surface
  assert.deepEqual(checkArtTimelineCapabilities(base, { keyframes }), { supported: true, unsupportedFeatures: [] });
});

test('checkArtTimelineCapabilities: an oversized/non-serializable keyframe recipe is skipped, not thrown', () => {
  const base = baseRecipe();
  const circular = {};
  circular.self = circular;
  assert.doesNotThrow(() => checkArtTimelineCapabilities(base, { keyframes: [{ t: 0, recipe: circular }] }));
});

// ── timelineDurationMismatch — the Final Render duration contract ──────────

test('timelineDurationMismatch: exact match is never a mismatch', () => {
  const sanitized = sanitizeArtTimeline({ totalSeconds: 8, keyframes: [{ t: 0, recipe: { devicePrimary: {} } }] });
  assert.equal(timelineDurationMismatch(sanitized, 8), false);
});

test('timelineDurationMismatch: any real difference is a mismatch', () => {
  const sanitized = sanitizeArtTimeline({ totalSeconds: 8, keyframes: [{ t: 0, recipe: { devicePrimary: {} } }] });
  assert.equal(timelineDurationMismatch(sanitized, 5), true);
  assert.equal(timelineDurationMismatch(sanitized, 8.5), true);
});

test('timelineDurationMismatch: missing/non-finite durationSeconds is always a mismatch — never silently treated as a match', () => {
  const sanitized = sanitizeArtTimeline({ totalSeconds: 8, keyframes: [{ t: 0, recipe: { devicePrimary: {} } }] });
  assert.equal(timelineDurationMismatch(sanitized, undefined), true);
  assert.equal(timelineDurationMismatch(sanitized, null), true);
  assert.equal(timelineDurationMismatch(sanitized, NaN), true);
  assert.equal(timelineDurationMismatch(sanitized, 'nope'), true);
});

test('timelineDurationMismatch: a tiny float-noise difference is tolerated (both sides ultimately derive from the same client-sent number)', () => {
  const sanitized = sanitizeArtTimeline({ totalSeconds: 8, keyframes: [{ t: 0, recipe: { devicePrimary: {} } }] });
  assert.equal(timelineDurationMismatch(sanitized, 8 + 1e-9), false);
});
