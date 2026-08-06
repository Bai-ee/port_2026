import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_TIMELINE_KEYFRAMES, DEFAULT_TIMELINE, sanitizeTimeline, migrateV1Timeline,
  timelineDuration, resolveTrackState, blendOrbitPose,
  TIMELINE_LERP_WHITELIST, blendRecipes, blendTextLayers, blendElementTransforms, lerpHexColor, shortestAngleLerp,
  buildTimelineSubmission, stripDeviceScreenSource,
} from '../timeline.js';

const recipe = (overrides = {}) => ({
  shotCam: { use: false, az: 0, el: 10, dist: 3, fov: 40 },
  envIntensity: 0.65,
  glass: {
    on: true, scale: 1, rotate: true, rotSpeed: 0.4, tint: '#ffffff', clarity: 0.06, transmission: 1,
    position: [0, 0, 0], rotationOffset: [0, 0, 0],
  },
  diffusionCamera: { enabled: false, focusDistance: 2.2, aperture: 0.4, falloff: 0.5, diffusionRadius: 0.3, highlightBloom: 0.2 },
  devicePrimary: { viewport: 'desktop', captureUrl: '', uploadAssetId: '', scroll: false, scrollSpeed: 0.4, scrollPosition: 0, sway: false, swaySpeed: 0.5, scale: 1.45, color: '#d6d8da', accent: '#c47c56' },
  fx: { bloom: false, bloomStrength: 0.55, bloomThreshold: 0.8, grain: 0, vignette: 0, t1: 8, t2: 45, t3: 1, treatment: 'none' },
  lightCans: [
    { on: true, color: '#ffffff', intensity: 1, az: 0, el: 0 },
    { on: true, color: '#ffffff', intensity: 1, az: 90, el: 0 },
    { on: true, color: '#ffffff', intensity: 1, az: 180, el: 0 },
    { on: true, color: '#ffffff', intensity: 1, az: 270, el: 0 },
  ],
  mat: {
    preset: '', finish: 'matte', baseColor: '#101114',
    holoIntensity: 0.5, holoScale: 8, bandFreq: 0.35, saturation: 0.6, hueShift: 0,
    sparkle: 0.25, specTint: 1, iridescence: 0.35, roughness: 0.12, metalness: 0.35,
    clearcoat: 0.5, coatRoughness: 0.08, sheen: 0.08, bump: 0.79, bumpTiling: 3,
  },
  anim: { on: true, turbulence: 0.6, speed: 1 },
  phys: { gravity: 2.7, damping: 0.9, stiffness: 0.85, rebound: 0, rumple: 0.79, pinMode: 'free-float' },
  bgColor: '#000000',
  bgMode: 'color',
  camSeed: 1,
  videoSeconds: 5,
  textLayers: [{
    id: 'txt-1', text: 'HEADLINE', fontId: 'space-grotesk', weight: 700, uppercase: false, align: 'center',
    sizePct: 12, leading: 1.05, tracking: 0, anchorX: 0.5, anchorY: 0.4, maxWidthPct: 85,
    rotX: 0, rotY: 0, rotZ: 0, color: '#ffffff', opacity: 1,
    backdrop: 'none', backdropColor: '#000000', backdropOpacity: 0.55, backdropPadPct: 8,
  }],
  ...overrides,
});

const textLayer = (overrides = {}) => ({
  id: 'txt-1', text: 'HEADLINE', fontId: 'space-grotesk', weight: 700, uppercase: false, align: 'center',
  sizePct: 12, leading: 1.05, tracking: 0, anchorX: 0.5, anchorY: 0.4, maxWidthPct: 85,
  rotX: 0, rotY: 0, rotZ: 0, color: '#ffffff', opacity: 1,
  backdrop: 'none', backdropColor: '#000000', backdropOpacity: 0.55, backdropPadPct: 8,
  ...overrides,
});

// ── sanitizeTimeline (v2) ─────────────────────────────────────────────────

test('sanitizeTimeline: caps at MAX_TIMELINE_KEYFRAMES and reassigns ids positionally', () => {
  const raw = { keyframes: Array.from({ length: 15 }, (_, i) => ({ t: i / 15, recipe: recipe({ camSeed: i }) })) };
  const result = sanitizeTimeline(raw);
  assert.equal(result.keyframes.length, MAX_TIMELINE_KEYFRAMES);
  result.keyframes.forEach((kf, i) => assert.equal(kf.id, `kf-${i + 1}`));
});

test('sanitizeTimeline: t clamps to [0,1] and sorts ascending', () => {
  const result = sanitizeTimeline({
    keyframes: [
      { t: 0.8, recipe: recipe({ camSeed: 1 }) },
      { t: -5, recipe: recipe({ camSeed: 2 }) }, // clamps to 0
      { t: 99, recipe: recipe({ camSeed: 3 }) }, // clamps to 1
    ],
  });
  assert.deepEqual(result.keyframes.map((k) => k.t), [0, 0.8, 1]);
  // sorted by t, not original array order: camSeed 2 (t=0) comes first
  assert.equal(result.keyframes[0].recipe.camSeed, 2);
  assert.equal(result.keyframes[2].recipe.camSeed, 3);
});

test('sanitizeTimeline: exact-tie t values are nudged +0.01 apart after sorting', () => {
  const result = sanitizeTimeline({
    keyframes: [
      { t: 0.3, recipe: recipe({ camSeed: 1 }) },
      { t: 0.3, recipe: recipe({ camSeed: 2 }) },
      { t: 0.3, recipe: recipe({ camSeed: 3 }) },
    ],
  });
  assert.equal(result.keyframes[0].t, 0.3);
  assert.equal(result.keyframes[1].t, 0.31);
  assert.equal(result.keyframes[2].t, 0.32);
});

test('sanitizeTimeline: totalSeconds clamps to [1,120] with default 8', () => {
  assert.equal(sanitizeTimeline({ keyframes: [] }).totalSeconds, 8);
  assert.equal(sanitizeTimeline({ keyframes: [], totalSeconds: 0.2 }).totalSeconds, 1);
  assert.equal(sanitizeTimeline({ keyframes: [], totalSeconds: 999 }).totalSeconds, 120);
  assert.equal(sanitizeTimeline({ keyframes: [], totalSeconds: 45 }).totalSeconds, 45);
});

test('sanitizeTimeline: totalSeconds falls back to a previous fallback timeline, then the default', () => {
  assert.equal(sanitizeTimeline({ keyframes: [] }, { keyframes: [], totalSeconds: 30 }).totalSeconds, 30);
  assert.equal(sanitizeTimeline({ keyframes: [] }, { keyframes: [] }).totalSeconds, 8);
});

test('sanitizeTimeline: orbitPose sanitizes to a finite 6-tuple, or null when malformed/absent', () => {
  const result = sanitizeTimeline({
    keyframes: [
      { t: 0, recipe: recipe(), orbitPose: { px: 1, py: 2, pz: 3, tx: 4, ty: 5, tz: 6 } },
      { t: 0.5, recipe: recipe(), orbitPose: { px: 1, py: 2, pz: 'nope', tx: 4, ty: 5, tz: 6 } },
      { t: 1, recipe: recipe() }, // no orbitPose key at all
    ],
  });
  assert.deepEqual(result.keyframes[0].orbitPose, { px: 1, py: 2, pz: 3, tx: 4, ty: 5, tz: 6 });
  assert.equal(result.keyframes[1].orbitPose, null);
  assert.equal(result.keyframes[2].orbitPose, null);
});

test('sanitizeTimeline: orbitPose null explicitly clears even when a fallback pose exists', () => {
  const fallback = { keyframes: [{ id: 'kf-1', name: 'Shot 1', t: 0, recipe: recipe(), orbitPose: { px: 1, py: 1, pz: 1, tx: 0, ty: 0, tz: 0 } }], totalSeconds: 8, loop: false };
  const result = sanitizeTimeline({ keyframes: [{ t: 0, recipe: recipe(), orbitPose: null }] }, fallback);
  assert.equal(result.keyframes[0].orbitPose, null);
});

test('sanitizeTimeline: a keyframe whose recipe is not a plain object is dropped, surviving ones renumbered contiguously', () => {
  const result = sanitizeTimeline({
    keyframes: [
      { name: 'Good A', t: 0, recipe: recipe() },
      { name: 'Bad — no recipe', t: 0.2 },
      { name: 'Bad — array recipe', t: 0.4, recipe: [1, 2, 3] },
      { name: 'Bad — string recipe', t: 0.6, recipe: 'nope' },
      { name: 'Good B', t: 0.8, recipe: recipe() },
    ],
  });
  assert.equal(result.keyframes.length, 2);
  assert.equal(result.keyframes[0].id, 'kf-1');
  assert.equal(result.keyframes[0].name, 'Good A');
  assert.equal(result.keyframes[1].id, 'kf-2');
  assert.equal(result.keyframes[1].name, 'Good B');
});

test('sanitizeTimeline: garbage input (non-object, non-array keyframes) never throws and falls back safely', () => {
  assert.deepEqual(sanitizeTimeline(null), DEFAULT_TIMELINE);
  assert.deepEqual(sanitizeTimeline(undefined), DEFAULT_TIMELINE);
  assert.deepEqual(sanitizeTimeline('garbage'), DEFAULT_TIMELINE);
  assert.deepEqual(sanitizeTimeline(42), DEFAULT_TIMELINE);
  assert.deepEqual(sanitizeTimeline({ keyframes: 'not-an-array' }), DEFAULT_TIMELINE);
  assert.deepEqual(sanitizeTimeline({}), DEFAULT_TIMELINE);
});

test('sanitizeTimeline: name defaults to "Shot N" (1-based position) and is truncated at 40 chars', () => {
  const result = sanitizeTimeline({ keyframes: [{ t: 0, recipe: recipe() }, { t: 0.3, recipe: recipe(), name: '' }, { t: 0.6, recipe: recipe(), name: 'x'.repeat(80) }] });
  assert.equal(result.keyframes[0].name, 'Shot 1');
  assert.equal(result.keyframes[1].name, 'Shot 2');
  assert.equal(result.keyframes[2].name.length, 40);
});

test('sanitizeTimeline: loop coerces to a real boolean and falls back correctly', () => {
  assert.equal(sanitizeTimeline({ keyframes: [], loop: true }).loop, true);
  assert.equal(sanitizeTimeline({ keyframes: [] }, { keyframes: [], loop: true }).loop, true);
  assert.equal(sanitizeTimeline({ keyframes: [], loop: 'yes' }).loop, true);
  assert.equal(sanitizeTimeline({ keyframes: [], loop: 0 }).loop, false);
});

// ── v1 -> v2 migration ────────────────────────────────────────────────────

test('migrateV1Timeline: a real v1 blob (2 keyframes, hold 2/transition 1.5) converts to the documented t positions + hold-duplicate keys + totalSeconds', () => {
  const v1 = {
    keyframes: [
      { id: 'kf-1', name: 'Shot A', hold: 2, transition: 1.5, recipe: recipe({ camSeed: 1 }) },
      { id: 'kf-2', name: 'Shot B', hold: 2, transition: 1.5, recipe: recipe({ camSeed: 2 }) },
    ],
    loop: true,
  };
  const migrated = migrateV1Timeline(v1);
  const oldDuration = 2 + 1.5 + 2; // hold0 + transition0 + hold1 (last transition excluded)

  assert.equal(migrated.keyframes.length, 4);
  assert.equal(migrated.keyframes[0].t, 0);
  assert.equal(migrated.keyframes[1].t, 2 / oldDuration);
  assert.equal(migrated.keyframes[2].t, 3.5 / oldDuration);
  assert.equal(migrated.keyframes[3].t, 1);

  assert.equal(migrated.keyframes[0].name, 'Shot A');
  assert.equal(migrated.keyframes[1].name, 'Shot A hold');
  assert.equal(migrated.keyframes[2].name, 'Shot B');
  assert.equal(migrated.keyframes[3].name, 'Shot B hold');

  // hold-duplicate carries the SAME recipe as its originating keyframe.
  assert.equal(migrated.keyframes[0].recipe, migrated.keyframes[1].recipe);
  assert.equal(migrated.keyframes[2].recipe, migrated.keyframes[3].recipe);

  assert.equal(migrated.totalSeconds, Math.ceil(oldDuration));
  assert.equal(migrated.loop, true);
});

test('migrateV1Timeline: 0 keyframes -> empty, default totalSeconds, never throws', () => {
  assert.deepEqual(migrateV1Timeline({ keyframes: [] }), { keyframes: [], totalSeconds: 8, loop: false });
  assert.deepEqual(migrateV1Timeline({}), { keyframes: [], totalSeconds: 8, loop: false });
});

test('sanitizeTimeline: routes a v1 (hold/transition) blob through migration end-to-end', () => {
  const v1 = {
    keyframes: [
      { hold: 2, transition: 1.5, recipe: recipe({ camSeed: 1 }) },
      { hold: 2, transition: 1.5, recipe: recipe({ camSeed: 2 }) },
    ],
  };
  const result = sanitizeTimeline(v1);
  const oldDuration = 2 + 1.5 + 2;
  assert.equal(result.keyframes.length, 4);
  assert.deepEqual(result.keyframes.map((k) => k.t), [0, 2 / oldDuration, 3.5 / oldDuration, 1]);
  assert.equal(result.totalSeconds, Math.ceil(oldDuration));
  result.keyframes.forEach((kf, i) => assert.equal(kf.id, `kf-${i + 1}`)); // ids still reassigned positionally
});

test('sanitizeTimeline: migration respects MAX_TIMELINE_KEYFRAMES AFTER doubling (7 v1 keyframes -> 14 candidates -> capped at 12)', () => {
  const v1 = { keyframes: Array.from({ length: 7 }, (_, i) => ({ hold: 1, transition: 1, recipe: recipe({ camSeed: i }) })) };
  const result = sanitizeTimeline(v1);
  assert.equal(result.keyframes.length, MAX_TIMELINE_KEYFRAMES);
});

test('sanitizeTimeline: migration is idempotent — re-sanitizing an already-migrated timeline is a shape no-op', () => {
  const v1 = {
    keyframes: [
      { hold: 2, transition: 1.5, recipe: recipe({ camSeed: 1 }) },
      { hold: 3, transition: 0.5, recipe: recipe({ camSeed: 2 }) },
    ],
    loop: true,
  };
  const once = sanitizeTimeline(v1);
  const twice = sanitizeTimeline(once);
  assert.deepEqual(once, twice);
});

// ── timelineDuration ─────────────────────────────────────────────────────

test('timelineDuration: returns totalSeconds directly', () => {
  assert.equal(timelineDuration({ keyframes: [], totalSeconds: 12 }), 12);
  assert.equal(timelineDuration({ totalSeconds: 45 }), 45);
});

test('timelineDuration: defensive default when totalSeconds is missing/non-finite', () => {
  assert.equal(timelineDuration({}), 8);
  assert.equal(timelineDuration(null), 8);
  assert.equal(timelineDuration({ totalSeconds: 'nope' }), 8);
});

// ── resolveTrackState ─────────────────────────────────────────────────────

test('resolveTrackState: 0 keyframes is a total, done, degenerate state', () => {
  assert.deepEqual(resolveTrackState({ keyframes: [] }, 0), { fromIndex: 0, toIndex: 0, blend: 0, rawBlend: 0, done: true });
});

test('resolveTrackState: u <= first key\'s t clamps to the first key, not done', () => {
  const tl = { keyframes: [{ id: 'kf-1', t: 0.2 }, { id: 'kf-2', t: 0.8 }] };
  assert.deepEqual(resolveTrackState(tl, 0), { fromIndex: 0, toIndex: 0, blend: 0, rawBlend: 0, done: false });
  assert.deepEqual(resolveTrackState(tl, 0.2), { fromIndex: 0, toIndex: 0, blend: 0, rawBlend: 0, done: false });
});

test('resolveTrackState: u >= last key\'s t clamps to the last key and reports done', () => {
  const tl = { keyframes: [{ id: 'kf-1', t: 0.2 }, { id: 'kf-2', t: 0.8 }] };
  assert.deepEqual(resolveTrackState(tl, 0.8), { fromIndex: 1, toIndex: 1, blend: 0, rawBlend: 0, done: true });
  assert.deepEqual(resolveTrackState(tl, 1), { fromIndex: 1, toIndex: 1, blend: 0, rawBlend: 0, done: true });
});

test('resolveTrackState: exact smoothstep value at a non-midpoint blend (u=0.25 across t=[0,1])', () => {
  const tl = { keyframes: [{ id: 'kf-1', t: 0 }, { id: 'kf-2', t: 1 }] };
  const state = resolveTrackState(tl, 0.25);
  assert.equal(state.fromIndex, 0);
  assert.equal(state.toIndex, 1);
  assert.equal(state.rawBlend, 0.25);
  assert.equal(state.blend, 0.25 * 0.25 * (3 - 2 * 0.25)); // smoothstep(0.25) === 0.15625
  assert.equal(state.done, false);
});

test('resolveTrackState: marker spacing IS the speed — same u, tighter spacing yields a larger blend', () => {
  const tight = { keyframes: [{ id: 'a', t: 0 }, { id: 'b', t: 0.5 }] };
  const wide = { keyframes: [{ id: 'a', t: 0 }, { id: 'b', t: 1 }] };
  const tightState = resolveTrackState(tight, 0.25);
  const wideState = resolveTrackState(wide, 0.25);
  assert.equal(tightState.rawBlend, 0.5);
  assert.equal(wideState.rawBlend, 0.25);
  assert.notEqual(tightState.blend, wideState.blend);
  assert.ok(tightState.blend > wideState.blend);
});

test('resolveTrackState: fromIndex/toIndex index into the ORIGINAL (unsorted) keyframes array, not a sorted copy', () => {
  // authored out of chronological order: array position 0 has the LATER t.
  const tl = { keyframes: [{ id: 'late', t: 0.9 }, { id: 'early', t: 0.1 }] };
  const state = resolveTrackState(tl, 0.5);
  assert.equal(tl.keyframes[state.fromIndex].id, 'early');
  assert.equal(tl.keyframes[state.toIndex].id, 'late');
});

test('resolveTrackState: 1 keyframe never straddles — clamps before/at its own t, done once past it', () => {
  const tl = { keyframes: [{ id: 'only', t: 0.3 }] };
  assert.deepEqual(resolveTrackState(tl, 0), { fromIndex: 0, toIndex: 0, blend: 0, rawBlend: 0, done: false });
  assert.deepEqual(resolveTrackState(tl, 0.3), { fromIndex: 0, toIndex: 0, blend: 0, rawBlend: 0, done: false });
  assert.deepEqual(resolveTrackState(tl, 0.5), { fromIndex: 0, toIndex: 0, blend: 0, rawBlend: 0, done: true });
});

test('resolveTrackState: loop-agnostic — never reads timeline.loop, u > 1 with loop:true is still clamped/done (caller wraps u itself)', () => {
  const tl = { keyframes: [{ id: 'a', t: 0 }, { id: 'b', t: 1 }], loop: true };
  assert.deepEqual(resolveTrackState(tl, 1.5), { fromIndex: 1, toIndex: 1, blend: 0, rawBlend: 0, done: true });
});

// ── blendOrbitPose ─────────────────────────────────────────────────────────

test('blendOrbitPose: exact component lerp at .25/.5, exact endpoints at 0/1', () => {
  const a = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0 };
  const b = { px: 10, py: -4, pz: 2, tx: 1, ty: 1, tz: 1 };
  assert.deepEqual(blendOrbitPose(a, b, 0), a);
  assert.deepEqual(blendOrbitPose(a, b, 1), b);
  assert.deepEqual(blendOrbitPose(a, b, 0.5), { px: 5, py: -2, pz: 1, tx: 0.5, ty: 0.5, tz: 0.5 });
});

test('blendOrbitPose: null propagation — either side null/non-object -> null', () => {
  const a = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0 };
  assert.equal(blendOrbitPose(null, a, 0.5), null);
  assert.equal(blendOrbitPose(a, null, 0.5), null);
  assert.equal(blendOrbitPose(null, null, 0.5), null);
  assert.equal(blendOrbitPose(undefined, a, 0.5), null);
});

// ── blendRecipes — whitelist exactness ────────────────────────────────────

test('blendRecipes: every whitelisted leaf lerps exactly at blend .25/.5/1', () => {
  const from = recipe({ envIntensity: 0, fx: { ...recipe().fx, bloomStrength: 0, vignette: 0 } });
  const to = recipe({ envIntensity: 1, fx: { ...recipe().fx, bloomStrength: 1, vignette: 1 } });
  [0.25, 0.5, 1].forEach((b) => {
    const blended = blendRecipes(from, to, b);
    assert.equal(blended.envIntensity, 0 + (1 - 0) * b);
    assert.equal(blended.fx.bloomStrength, 0 + (1 - 0) * b);
    assert.equal(blended.fx.vignette, 0 + (1 - 0) * b);
  });
});

test('blendRecipes: at blend 1, every whitelisted path deep-equals toRecipe\'s own value', () => {
  const from = recipe();
  const to = recipe({
    shotCam: { use: true, az: 90, el: 40, dist: 5, fov: 60 },
    envIntensity: 1.8,
    glass: { ...recipe().glass, scale: 2, rotSpeed: 1.2, clarity: 0.3, transmission: 0.1, position: [1, 2, 3], rotationOffset: [10, 20, 30] },
    diffusionCamera: { ...recipe().diffusionCamera, focusDistance: 4, aperture: 0.9, falloff: 0.9, diffusionRadius: 0.9, highlightBloom: 0.9 },
    fx: { ...recipe().fx, bloomStrength: 2, bloomThreshold: 0.1, vignette: 0.5, grain: 0.5, t1: 20, t2: 5, t3: 3 },
    mat: { ...recipe().mat, holoIntensity: 0.9, holoScale: 20, bandFreq: 0.9, saturation: 1, hueShift: 0.5, sparkle: 0.9, specTint: 0.2, iridescence: 0.9, roughness: 0.9, metalness: 0.9, clearcoat: 0.9, coatRoughness: 0.9, sheen: 0.9, bump: 1.5, bumpTiling: 10 },
    anim: { ...recipe().anim, turbulence: 0.9, speed: 3 },
    lightCans: [
      { on: true, color: '#ffffff', intensity: 2, az: 40, el: 60 },
      { on: false, color: '#ffffff', intensity: 0, az: -100, el: -20 },
      { on: true, color: '#ffffff', intensity: 1.5, az: 200, el: 10 },
      { on: false, color: '#ffffff', intensity: 0.3, az: -5, el: 5 },
    ],
  });
  const blended = blendRecipes(from, to, 1);
  TIMELINE_LERP_WHITELIST.forEach((path) => {
    const keys = path.split('.');
    const read = (obj) => keys.reduce((o, k) => o[k], obj);
    assert.equal(read(blended), read(to), `path ${path} should equal toRecipe's value at blend=1`);
  });
});

test('blendRecipes: NON-whitelisted numeric fields never lerp, regardless of blend', () => {
  const from = recipe({ camSeed: 1, videoSeconds: 3 });
  const to = recipe({ camSeed: 999, videoSeconds: 20 });
  [0, 0.25, 0.5, 0.75, 1].forEach((b) => {
    const blended = blendRecipes(from, to, b);
    assert.equal(blended.camSeed, 999, `camSeed must never lerp (blend=${b})`);
    assert.equal(blended.videoSeconds, 20, `videoSeconds must never lerp (blend=${b})`);
  });
});

test('blendRecipes: phys.* is a hard gate — NEVER lerped, always toRecipe verbatim, at every blend', () => {
  const from = recipe({ phys: { gravity: 0, damping: 0, stiffness: 0, rebound: 0, rumple: 0, pinMode: 'free-float' } });
  const to = recipe({ phys: { gravity: 10, damping: 1, stiffness: 1, rebound: 1, rumple: 1, pinMode: 'top-corners' } });
  [0, 0.25, 0.5, 0.75, 1].forEach((b) => {
    const blended = blendRecipes(from, to, b);
    assert.deepEqual(blended.phys, to.phys, `phys must never lerp (blend=${b})`);
  });
});

test('blendRecipes: anim.turbulence and anim.speed lerp while anim.on stays a discrete cut', () => {
  const from = recipe({ anim: { on: true, turbulence: 0, speed: 1 } });
  const to = recipe({ anim: { on: false, turbulence: 1, speed: 2 } });
  const blended = blendRecipes(from, to, 0.5);
  assert.equal(blended.anim.turbulence, 0.5);
  assert.equal(blended.anim.speed, 1.5);
  assert.equal(blended.anim.on, false); // discrete: to-side's value, unblended
  assert.equal(from.anim.turbulence, 0, 'fromRecipe.anim must not be mutated');
  assert.equal(to.anim.turbulence, 1, 'toRecipe.anim must not be mutated');
});

test('blendRecipes: mat.* numeric dials lerp at .25/.5, mat.baseColor hex-lerps, mat.preset/finish stay discrete', () => {
  const from = recipe({ mat: { ...recipe().mat, holoIntensity: 0, roughness: 0, baseColor: '#000000', preset: 'from-preset' } });
  const to = recipe({ mat: { ...recipe().mat, holoIntensity: 1, roughness: 1, baseColor: '#ffffff', preset: 'to-preset' } });
  [0.25, 0.5].forEach((b) => {
    const blended = blendRecipes(from, to, b);
    assert.equal(blended.mat.holoIntensity, 0 + 1 * b);
    assert.equal(blended.mat.roughness, 0 + 1 * b);
  });
  const blendedMid = blendRecipes(from, to, 0.5);
  assert.equal(blendedMid.mat.baseColor, '#808080');
  assert.equal(blendedMid.mat.preset, 'to-preset'); // discrete, unblended
  assert.equal(from.mat.holoIntensity, 0, 'fromRecipe.mat must not be mutated');
  assert.equal(to.mat.baseColor, '#ffffff', 'toRecipe.mat must not be mutated');
});

test('blendRecipes: mat.baseColor falls back to toRecipe when either end is not valid hex', () => {
  const from = recipe({ mat: { ...recipe().mat, baseColor: undefined } });
  delete from.mat.baseColor;
  const to = recipe({ mat: { ...recipe().mat, baseColor: '#123456' } });
  const blended = blendRecipes(from, to, 0.5);
  assert.equal(blended.mat.baseColor, '#123456');
});

test('blendRecipes: glass.position and glass.rotationOffset lerp component-wise, never mutating the source arrays', () => {
  const from = recipe({ glass: { ...recipe().glass, position: [0, 0, 0], rotationOffset: [0, 0, 0] } });
  const to = recipe({ glass: { ...recipe().glass, position: [0, 5, 0], rotationOffset: [90, 0, -90] } });
  const blended = blendRecipes(from, to, 0.5);
  assert.equal(blended.glass.position[1], 2.5);
  assert.equal(blended.glass.rotationOffset[0], 45);
  assert.equal(blended.glass.rotationOffset[2], -45);
  assert.deepEqual(from.glass.position, [0, 0, 0], 'fromRecipe.glass.position must not be mutated');
  assert.deepEqual(to.glass.position, [0, 5, 0], 'toRecipe.glass.position must not be mutated');
});

test('blendRecipes: lightCans[i].az uses shortest-angle lerp, lightCans[i].el uses plain lerp', () => {
  const from = recipe({
    lightCans: [
      { on: true, color: '#ffffff', intensity: 1, az: 170, el: 10 },
      ...recipe().lightCans.slice(1),
    ],
  });
  const to = recipe({
    lightCans: [
      { on: true, color: '#ffffff', intensity: 1, az: -170, el: 50 },
      ...recipe().lightCans.slice(1),
    ],
  });
  const blended = blendRecipes(from, to, 0.5);
  assert.equal(blended.lightCans[0].az, 180); // shortest path through 180, not 0
  assert.equal(blended.lightCans[0].el, 30); // plain lerp
});

test('blendRecipes: shotCam.az uses shortest-angle lerp both directions (170 -> -170 goes through 180, not 0)', () => {
  const from = recipe({ shotCam: { ...recipe().shotCam, az: 170 } });
  const to = recipe({ shotCam: { ...recipe().shotCam, az: -170 } });
  const blended = blendRecipes(from, to, 0.5);
  assert.equal(blended.shotCam.az, 180);
  assert.notEqual(blended.shotCam.az, 0);
});

test('blendRecipes: shotCam.az shortest-angle lerp the OTHER direction (-170 -> 170)', () => {
  const from = recipe({ shotCam: { ...recipe().shotCam, az: -170 } });
  const to = recipe({ shotCam: { ...recipe().shotCam, az: 170 } });
  const blended = blendRecipes(from, to, 0.5);
  assert.equal(blended.shotCam.az, -180);
});

test('blendRecipes: bgColor lerps as a hex color when both ends are valid hex', () => {
  const from = recipe({ bgColor: '#000000' });
  const to = recipe({ bgColor: '#ffffff' });
  const blended = blendRecipes(from, to, 0.5);
  assert.equal(blended.bgColor, '#808080');
});

test('blendRecipes: bgColor falls back to toRecipe when either end is not a valid hex', () => {
  const from = recipe({ bgMode: 'scene', bgColor: undefined });
  const to = recipe({ bgColor: '#123456' });
  delete from.bgColor;
  const blended = blendRecipes(from, to, 0.5);
  assert.equal(blended.bgColor, '#123456');
});

test('blendRecipes: textLayers blend via blendTextLayers (matched id + identical discrete fields lerps)', () => {
  const from = recipe({ textLayers: [textLayer({ sizePct: 10, opacity: 0 })] });
  const to = recipe({ textLayers: [textLayer({ sizePct: 20, opacity: 1 })] });
  const blended = blendRecipes(from, to, 0.5);
  assert.equal(blended.textLayers[0].sizePct, 15);
  assert.equal(blended.textLayers[0].opacity, 0.5);
});

test('blendRecipes: never mutates fromRecipe or toRecipe', () => {
  const from = recipe({ envIntensity: 0, fx: { ...recipe().fx, bloomStrength: 0 }, mat: { ...recipe().mat, holoIntensity: 0 } });
  const to = recipe({ envIntensity: 1, fx: { ...recipe().fx, bloomStrength: 1 }, mat: { ...recipe().mat, holoIntensity: 1 } });
  const fromSnapshot = JSON.parse(JSON.stringify(from));
  const toSnapshot = JSON.parse(JSON.stringify(to));
  blendRecipes(from, to, 0.5);
  assert.deepEqual(from, fromSnapshot);
  assert.deepEqual(to, toSnapshot);
});

test('blendRecipes: a whitelisted field missing on either end falls back to toRecipe\'s own value (no throw)', () => {
  const from = recipe();
  delete from.envIntensity;
  delete from.glass;
  const to = recipe({ envIntensity: 1.4 });
  const blended = blendRecipes(from, to, 0.5);
  assert.equal(blended.envIntensity, 1.4);
  assert.deepEqual(blended.glass, to.glass);
});

test('blendRecipes: gracefully handles non-object inputs without throwing', () => {
  assert.doesNotThrow(() => blendRecipes(null, recipe(), 0.5));
  assert.doesNotThrow(() => blendRecipes(recipe(), null, 0.5));
  assert.doesNotThrow(() => blendRecipes(null, null, 0.5));
});

// ── blendTextLayers — direct coverage ──────────────────────────────────────

test('blendTextLayers: matched id + identical discrete fields lerps numeric transforms + hex colors', () => {
  const from = [textLayer({ sizePct: 10, opacity: 0, anchorX: 0, rotZ: -10, color: '#000000' })];
  const to = [textLayer({ sizePct: 20, opacity: 1, anchorX: 1, rotZ: 10, color: '#ffffff' })];
  const blended = blendTextLayers(from, to, 0.5);
  assert.equal(blended.length, 1);
  assert.equal(blended[0].sizePct, 15);
  assert.equal(blended[0].opacity, 0.5);
  assert.equal(blended[0].anchorX, 0.5);
  assert.equal(blended[0].rotZ, 0);
  assert.equal(blended[0].color, '#808080');
});

test('blendTextLayers: a pair whose text differs cuts to the to-side verbatim (no lerp)', () => {
  const from = [textLayer({ text: 'BEFORE', sizePct: 10 })];
  const to = [textLayer({ text: 'AFTER', sizePct: 20 })];
  const blended = blendTextLayers(from, to, 0.5);
  assert.equal(blended[0].text, 'AFTER');
  assert.equal(blended[0].sizePct, 20);
});

test('blendTextLayers: fontId/weight/uppercase/align differences also force a discrete cut', () => {
  [{ fontId: 'inter' }, { weight: 400 }, { uppercase: true }, { align: 'left' }].forEach((diff) => {
    const from = [textLayer({ sizePct: 10 })];
    const to = [textLayer({ sizePct: 20, ...diff })];
    const blended = blendTextLayers(from, to, 0.5);
    assert.equal(blended[0].sizePct, 20, `sizePct should cut (not lerp) when ${Object.keys(diff)[0]} differs`);
  });
});

test('blendTextLayers: a to-only layer (no matching from id) appears verbatim', () => {
  const from = [textLayer({ id: 'txt-1' })];
  const to = [textLayer({ id: 'txt-1' }), textLayer({ id: 'txt-2', text: 'NEW LAYER' })];
  const blended = blendTextLayers(from, to, 0.5);
  assert.equal(blended.length, 2);
  assert.equal(blended[1].id, 'txt-2');
  assert.equal(blended[1].text, 'NEW LAYER');
});

test('blendTextLayers: a from-only layer (no matching to id) disappears', () => {
  const from = [textLayer({ id: 'txt-1' }), textLayer({ id: 'txt-2', text: 'GONE' })];
  const to = [textLayer({ id: 'txt-1' })];
  const blended = blendTextLayers(from, to, 0.5);
  assert.equal(blended.length, 1);
  assert.equal(blended[0].id, 'txt-1');
});

test('blendTextLayers: empty/non-array inputs never throw', () => {
  assert.deepEqual(blendTextLayers(undefined, [textLayer()], 0.5), [textLayer()]);
  assert.deepEqual(blendTextLayers([textLayer()], undefined, 0.5), []);
  assert.doesNotThrow(() => blendTextLayers(null, null, 0.5));
});

test('blendTextLayers: never mutates fromLayers or toLayers', () => {
  const from = [textLayer({ sizePct: 10 })];
  const to = [textLayer({ sizePct: 20 })];
  const fromSnap = JSON.parse(JSON.stringify(from));
  const toSnap = JSON.parse(JSON.stringify(to));
  blendTextLayers(from, to, 0.5);
  assert.deepEqual(from, fromSnap);
  assert.deepEqual(to, toSnap);
});

// ── lerpHexColor / shortestAngleLerp — direct coverage ────────────────────

test('lerpHexColor: exact midpoint and endpoints', () => {
  assert.equal(lerpHexColor('#000000', '#ffffff', 0), '#000000');
  assert.equal(lerpHexColor('#000000', '#ffffff', 1), '#ffffff');
  assert.equal(lerpHexColor('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(lerpHexColor('#ff0000', '#0000ff', 0.5), '#800080');
});

test('shortestAngleLerp: 0 -> 90 is a plain forward lerp (no wraparound needed)', () => {
  assert.equal(shortestAngleLerp(0, 90, 0.5), 45);
});

test('shortestAngleLerp: blend clamps to [0,1]', () => {
  assert.equal(shortestAngleLerp(0, 90, -1), 0);
  assert.equal(shortestAngleLerp(0, 90, 2), 90);
});

// ── blendElementTransforms — image layers / extra elements tween their
// transforms between keyframes; everything else stays a discrete cut. ────

test('blendElementTransforms: same id+type lerps position/scale linearly and rotation via shortest angle; endpoints exact', () => {
  const from = [{ id: 'il-1', type: 'image-layer', transform: { position: [-1, 0, 0], rotation: [0, 170, 0], scale: [1, 1, 1] }, material: { opacity: 1 } }];
  const to = [{ id: 'il-1', type: 'image-layer', transform: { position: [1, 0.5, 0], rotation: [0, -170, 0], scale: [2, 2, 2] }, material: { opacity: 0.4 } }];
  const mid = blendElementTransforms(from, to, 0.5)[0];
  assert.equal(mid.transform.position[0], 0);
  assert.equal(mid.transform.position[1], 0.25);
  assert.equal(mid.transform.scale[0], 1.5);
  // 170° -> -170° must go the SHORT way through 180 (i.e. ±180), never back through 0.
  assert.ok(Math.abs(Math.abs(mid.transform.rotation[1]) - 180) < 1e-9, `rotation must take the short path, got ${mid.transform.rotation[1]}`);
  assert.equal(mid.material.opacity, 0.4, 'non-transform fields are the to-side (discrete cut)');
  assert.deepEqual(blendElementTransforms(from, to, 0)[0].transform, from[0].transform, 'b=0 -> from transform exactly');
  assert.deepEqual(blendElementTransforms(from, to, 1)[0].transform, to[0].transform, 'b=1 -> to transform exactly');
});

test('blendElementTransforms: unmatched instances never lerp — to-only appears verbatim, from-only is gone, type mismatch cuts', () => {
  const from = [
    { id: 'gone', type: 'image-layer', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
    { id: 'swap', type: 'image-layer', transform: { position: [-1, -1, -1], rotation: [0, 0, 0], scale: [1, 1, 1] } },
  ];
  const to = [
    { id: 'fresh', type: 'image-layer', transform: { position: [1, 1, 1], rotation: [0, 0, 0], scale: [1, 1, 1] } },
    { id: 'swap', type: 'kinetic-rings', transform: { position: [1, 1, 1], rotation: [0, 0, 0], scale: [1, 1, 1] } },
  ];
  const out = blendElementTransforms(from, to, 0.5);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].transform.position, [1, 1, 1], 'to-only instance appears at its own transform');
  assert.deepEqual(out[1].transform.position, [1, 1, 1], 'same id but different TYPE is a different object — no lerp');
  assert.ok(!out.some((i) => i.id === 'gone'), 'from-only instance is not resurrected');
});

test('blendRecipes: extraInstances ride the blend — mid-transition transforms are tweened inside the full recipe blend', () => {
  const from = recipe({ extraInstances: [{ id: 'il-1', type: 'image-layer', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }] });
  const to = recipe({ extraInstances: [{ id: 'il-1', type: 'image-layer', transform: { position: [1, 0, 0], rotation: [0, 90, 0], scale: [1.5, 1.5, 1.5] } }] });
  const mid = blendRecipes(from, to, 0.5);
  assert.equal(mid.extraInstances[0].transform.position[0], 0.5);
  assert.equal(mid.extraInstances[0].transform.rotation[1], 45);
  assert.equal(mid.extraInstances[0].transform.scale[0], 1.25);
});

// ── buildTimelineSubmission (Phase C, "Interrupted export recovery") ───────
// The pure transport helper handleGenerateProof/handleGenerateFinalRender
// (ClothStudio.jsx) call to build the explicit top-level `timeline` field a
// Final Render/Proof submission sends alongside `scene` — keyframe device
// screen-source stripping + "absent when empty".

test('buildTimelineSubmission: an empty timeline (0 keyframes) is absent (undefined), never an empty object/array', () => {
  assert.equal(buildTimelineSubmission(DEFAULT_TIMELINE), undefined);
  assert.equal(buildTimelineSubmission({ keyframes: [], totalSeconds: 8, loop: false }), undefined);
  assert.equal(buildTimelineSubmission(null), undefined);
  assert.equal(buildTimelineSubmission(undefined), undefined);
});

test('buildTimelineSubmission: a non-empty timeline carries totalSeconds (via timelineDuration) and a coerced loop', () => {
  const tl = { keyframes: [{ id: 'kf-1', t: 0, recipe: recipe() }], totalSeconds: 12, loop: 1 };
  const out = buildTimelineSubmission(tl);
  assert.equal(out.totalSeconds, 12);
  assert.equal(out.loop, true);
  assert.equal(out.keyframes.length, 1);

  // Missing totalSeconds falls back through timelineDuration's own
  // defensive default, exactly like every other consumer of a timeline.
  const noTotal = buildTimelineSubmission({ keyframes: [{ id: 'kf-1', t: 0, recipe: recipe() }] });
  assert.equal(noTotal.totalSeconds, timelineDuration({}));
});

test('buildTimelineSubmission: strips every device screen-source field from every keyframe recipe, preserves everything else', () => {
  const dp = {
    viewport: 'mobile', scrollPosition: 0.4, posY: 0.2, sway: true,
    live: true, liveUrl: 'https://example.com', captureUrl: '/api/public/studio-device-capture?x=1',
    uploadAssetId: 'asset-1', screenStill: { sha256: 'a'.repeat(64), ext: 'png', width: 100, height: 100, bytes: 10 },
    // Capture provenance (Recovery round 2, Defect 1) — stripped alongside
    // the captureUrl it describes; meaningless on its own once captureUrl
    // is gone.
    captureSourceUrl: 'https://example.com', captureViewport: 'mobile',
  };
  const tl = {
    keyframes: [
      { id: 'kf-1', t: 0, recipe: recipe({ clothShape: 'device', devicePrimary: dp }) },
      { id: 'kf-2', t: 1, recipe: recipe({ clothShape: 'device', devicePrimary: { ...dp, scrollPosition: 0.9 } }) },
    ],
    totalSeconds: 5,
    loop: false,
  };
  const out = buildTimelineSubmission(tl);
  out.keyframes.forEach((kf) => {
    const outDp = kf.recipe.devicePrimary;
    assert.equal('live' in outDp, false, 'live must be stripped');
    assert.equal('liveUrl' in outDp, false, 'liveUrl must be stripped');
    assert.equal('captureUrl' in outDp, false, 'captureUrl must be stripped');
    assert.equal('uploadAssetId' in outDp, false, 'uploadAssetId must be stripped');
    assert.equal('screenStill' in outDp, false, 'screenStill must be stripped');
    assert.equal('captureSourceUrl' in outDp, false, 'captureSourceUrl must be stripped');
    assert.equal('captureViewport' in outDp, false, 'captureViewport must be stripped');
    // Every other field survives untouched.
    assert.equal(outDp.viewport, 'mobile');
    assert.equal(outDp.sway, true);
  });
  assert.equal(out.keyframes[0].recipe.devicePrimary.scrollPosition, 0.4);
  assert.equal(out.keyframes[1].recipe.devicePrimary.scrollPosition, 0.9);
  // Non-devicePrimary recipe fields are carried verbatim.
  assert.equal(out.keyframes[0].recipe.clothShape, 'device');
});

test('buildTimelineSubmission: a devicePrimary carrying ONLY captureSourceUrl/captureViewport (no captureUrl/live/etc.) still counts as "has a source field" and gets cloned/stripped', () => {
  const tl = {
    keyframes: [{ id: 'kf-1', t: 0, recipe: recipe({ clothShape: 'device', devicePrimary: { viewport: 'desktop', captureSourceUrl: 'https://stale.example', captureViewport: 'desktop' } }) }],
    totalSeconds: 4,
  };
  const out = buildTimelineSubmission(tl);
  const outDp = out.keyframes[0].recipe.devicePrimary;
  assert.equal('captureSourceUrl' in outDp, false);
  assert.equal('captureViewport' in outDp, false);
  assert.equal(outDp.viewport, 'desktop');
});

test('buildTimelineSubmission: a keyframe with no devicePrimary, or a devicePrimary with no source fields, passes the SAME recipe reference through (no needless clone)', () => {
  const bareRecipe = recipe();
  delete bareRecipe.devicePrimary;
  const sourceFreeRecipe = recipe({ devicePrimary: { viewport: 'desktop', scrollPosition: 0.5 } });
  const tl = {
    keyframes: [
      { id: 'kf-1', t: 0, recipe: bareRecipe },
      { id: 'kf-2', t: 0.5, recipe: sourceFreeRecipe },
    ],
    totalSeconds: 4,
  };
  const out = buildTimelineSubmission(tl);
  assert.equal(out.keyframes[0].recipe, bareRecipe, 'no devicePrimary at all -> untouched passthrough');
  assert.equal(out.keyframes[1].recipe, sourceFreeRecipe, 'no source field present -> untouched passthrough');
});

test('buildTimelineSubmission: never mutates the original timeline, its keyframes, or their recipes', () => {
  const dp = { viewport: 'desktop', scrollPosition: 0.5, live: true, liveUrl: 'https://example.com' };
  const kfRecipe = recipe({ clothShape: 'device', devicePrimary: dp });
  const tl = { keyframes: [{ id: 'kf-1', t: 0, recipe: kfRecipe }], totalSeconds: 6, loop: false };
  const beforeJson = JSON.stringify(tl);
  const out = buildTimelineSubmission(tl);
  assert.equal(JSON.stringify(tl), beforeJson, 'the original timeline object graph must be byte-identical after the call');
  assert.notEqual(out.keyframes[0].recipe, kfRecipe, 'a source-stripped keyframe must be a NEW recipe object');
  assert.ok('live' in kfRecipe.devicePrimary, 'the ORIGINAL devicePrimary must still carry its source fields — nothing shared/mutated');
});

test('buildTimelineSubmission: keyframe fields other than `recipe` (id, name, t, orbitPose) pass through verbatim', () => {
  const pose = { px: 1, py: 2, pz: 3, tx: 0, ty: 0, tz: 0 };
  const tl = { keyframes: [{ id: 'kf-1', name: 'Shot 1', t: 0.25, recipe: recipe(), orbitPose: pose }], totalSeconds: 5 };
  const out = buildTimelineSubmission(tl);
  assert.equal(out.keyframes[0].id, 'kf-1');
  assert.equal(out.keyframes[0].name, 'Shot 1');
  assert.equal(out.keyframes[0].t, 0.25);
  assert.deepEqual(out.keyframes[0].orbitPose, pose);
});

// ── stripDeviceScreenSource, used DIRECTLY by the local export path
// (export-restore Phase 5) ────────────────────────────────────────────────
// Previously reachable only through buildTimelineSubmission (the cloud
// boundary). Browser Quick Export now applies it too, because every
// keyframe recipe carries the whole devicePrimary — including live/liveUrl
// — and re-applying that mid-recording rebuilt the CSS3D live iframe and
// re-punched the alpha hole the export guard had just torn down, recording
// a blank video. These assert the contract the export path depends on.

test('stripDeviceScreenSource: removes every screen-source field (live/liveUrl above all) and keeps everything else, including the rest of the recipe', () => {
  const input = recipe({
    clothShape: 'device',
    devicePrimary: {
      viewport: 'desktop', scale: 1.2, posY: 0.3,
      live: true, liveUrl: 'https://example.com',
      captureUrl: '/api/public/studio-device-capture?id=x', captureSourceUrl: 'https://example.com', captureViewport: 'desktop',
      uploadAssetId: 'asset-9', screenStill: { sha256: 'b'.repeat(64), ext: 'png', width: 10, height: 10, bytes: 4 },
    },
  });
  const out = stripDeviceScreenSource(input);
  const dp = out.devicePrimary;
  ['live', 'liveUrl', 'captureUrl', 'captureSourceUrl', 'captureViewport', 'uploadAssetId', 'screenStill']
    .forEach((k) => assert.equal(k in dp, false, `${k} must be stripped`));
  assert.equal(dp.viewport, 'desktop');
  assert.equal(dp.scale, 1.2);
  assert.equal(dp.posY, 0.3);
  assert.equal(out.clothShape, 'device');
});

test('stripDeviceScreenSource: a recipe with no devicePrimary, or a devicePrimary with no source fields, returns the SAME reference (no needless clone per keyframe boundary, every frame of playback)', () => {
  const noDevice = { ...recipe(), devicePrimary: undefined };
  assert.equal(stripDeviceScreenSource(noDevice), noDevice);
  const cleanDevice = { ...recipe(), devicePrimary: { viewport: 'mobile', scale: 1 } };
  assert.equal(stripDeviceScreenSource(cleanDevice), cleanDevice);
  assert.equal(stripDeviceScreenSource(null), null);
  assert.equal(stripDeviceScreenSource(undefined), undefined);
});

// The REAL saved shape: DEFAULT_DEVICE_PRIMARY seeds captureUrl/uploadAssetId
// as '' (this codebase's "unset" sentinel), so a real keyframe ALWAYS carries
// source keys and is always cloned+stripped — never accidentally passed
// through unstripped on the "nothing to strip" fast path.
test('stripDeviceScreenSource: empty-string source sentinels still count as present and are removed, not passed through', () => {
  const input = { ...recipe(), devicePrimary: { viewport: 'desktop', captureUrl: '', uploadAssetId: '', live: false, liveUrl: '' } };
  const out = stripDeviceScreenSource(input);
  assert.notEqual(out, input);
  assert.deepEqual(out.devicePrimary, { viewport: 'desktop' });
});

test('stripDeviceScreenSource: never mutates the input recipe or its devicePrimary — the keyframe itself must survive an export unchanged', () => {
  const dp = { viewport: 'desktop', live: true, liveUrl: 'https://example.com' };
  const input = recipe({ devicePrimary: dp });
  stripDeviceScreenSource(input);
  assert.equal(dp.live, true, 'the stored keyframe must still say live:true after an export strips it for recording');
  assert.equal(dp.liveUrl, 'https://example.com');
  assert.equal(input.devicePrimary, dp);
});
