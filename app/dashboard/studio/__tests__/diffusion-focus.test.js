import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  DIFFUSION_FOCAL_ORIGIN, DIFFUSION_FOCAL_MANUAL, DIFFUSION_FOCAL_PRIMARY_ARTWORK,
  isFocalTargetValid, resolveFocalTargetId, listDiffusionFocalTargets,
  cameraSpaceForwardDistance, linearizeDepth, computeCircleOfConfusion, computeBlurRadiusPx,
} from '../diffusion-focus.js';

const PRIMARY_ID = 'glass-petal-sphere-1';

// ── isFocalTargetValid / resolveFocalTargetId — Codex review requirement
// #4/#5/#7: never present or resolve a disabled/data-only/removed
// instance as a valid target; deterministic fallback to 'origin'. ────────

test("'origin' and 'manual' are always valid, independent of any live scene state", () => {
  const ctx = { glassOn: false, primaryArtworkAvailable: false, elementInstances: [], primaryElementId: PRIMARY_ID };
  assert.equal(isFocalTargetValid(DIFFUSION_FOCAL_ORIGIN, ctx), true);
  assert.equal(isFocalTargetValid(DIFFUSION_FOCAL_MANUAL, ctx), true);
});

test('the primary Glass Petal Sphere is a valid target ONLY while glass.on is true', () => {
  const enabled = { glassOn: true, primaryElementId: PRIMARY_ID };
  const disabled = { glassOn: false, primaryElementId: PRIMARY_ID };
  assert.equal(isFocalTargetValid(PRIMARY_ID, enabled), true);
  assert.equal(isFocalTargetValid(PRIMARY_ID, disabled), false);
});

test('an extra element instance is a valid target only while enabled:true, never a disabled/hidden one', () => {
  const ctx = {
    elementInstances: [
      { id: 'a', enabled: true },
      { id: 'b', enabled: false },
    ],
    primaryElementId: PRIMARY_ID,
  };
  assert.equal(isFocalTargetValid('a', ctx), true);
  assert.equal(isFocalTargetValid('b', ctx), false, 'a disabled (Show/Hide off) instance must never be a valid target');
});

test('a removed instance id (no longer present at all) is not valid', () => {
  const ctx = { elementInstances: [{ id: 'a', enabled: true }], primaryElementId: PRIMARY_ID };
  assert.equal(isFocalTargetValid('does-not-exist', ctx), false);
});

test('resolveFocalTargetId: a valid target resolves to itself', () => {
  const ctx = { glassOn: true, elementInstances: [], primaryElementId: PRIMARY_ID };
  assert.equal(resolveFocalTargetId(PRIMARY_ID, ctx), PRIMARY_ID);
});

test('resolveFocalTargetId: missing, disabled, and removed targets ALL fall back deterministically to origin — never a stale distance retained', () => {
  const ctx = {
    glassOn: false, // glass disabled
    elementInstances: [{ id: 'hidden-el', enabled: false }],
    primaryElementId: PRIMARY_ID,
  };
  assert.equal(resolveFocalTargetId(PRIMARY_ID, ctx), DIFFUSION_FOCAL_ORIGIN, 'glass off -> falls back to origin');
  assert.equal(resolveFocalTargetId('hidden-el', ctx), DIFFUSION_FOCAL_ORIGIN, 'disabled element -> falls back to origin');
  assert.equal(resolveFocalTargetId('never-existed', ctx), DIFFUSION_FOCAL_ORIGIN, 'removed/unknown id -> falls back to origin');
});

test('resolveFocalTargetId: a target that becomes valid again (re-enabled) resolves to itself again — no stale "always invalid" caching', () => {
  const disabledCtx = { elementInstances: [{ id: 'a', enabled: false }], primaryElementId: PRIMARY_ID };
  const enabledCtx = { elementInstances: [{ id: 'a', enabled: true }], primaryElementId: PRIMARY_ID };
  assert.equal(resolveFocalTargetId('a', disabledCtx), DIFFUSION_FOCAL_ORIGIN);
  assert.equal(resolveFocalTargetId('a', enabledCtx), 'a');
});

// ── listDiffusionFocalTargets — the dropdown's option list. ─────────────

test('listDiffusionFocalTargets: never lists a disabled element, a disabled primary glass, or an unavailable primary artwork', () => {
  const targets = listDiffusionFocalTargets({
    glassOn: false,
    primaryArtworkAvailable: false,
    elementInstances: [
      { id: PRIMARY_ID, enabled: false, name: 'Glass Petal Sphere' },
      { id: 'shown', enabled: true, name: 'Shown Element' },
      { id: 'hidden', enabled: false, name: 'Hidden Element' },
    ],
    primaryElementId: PRIMARY_ID,
  });
  const ids = targets.map((t) => t.id);
  assert.deepEqual(ids, [DIFFUSION_FOCAL_ORIGIN, DIFFUSION_FOCAL_MANUAL, 'shown'], 'only origin, manual, and the one truly-enabled element should appear — no glass, no primary artwork, no hidden element');
});

test('listDiffusionFocalTargets: lists the primary glass and primary artwork once each is actually available/enabled, with human-readable labels', () => {
  const targets = listDiffusionFocalTargets({
    glassOn: true,
    primaryArtworkAvailable: true,
    elementInstances: [{ id: PRIMARY_ID, enabled: true, name: 'Glass Petal Sphere' }],
    primaryElementId: PRIMARY_ID,
  });
  const byId = Object.fromEntries(targets.map((t) => [t.id, t.label]));
  assert.equal(byId[DIFFUSION_FOCAL_ORIGIN], 'Center of scene');
  assert.equal(byId[DIFFUSION_FOCAL_MANUAL], 'Manual (Focus Distance)');
  assert.equal(byId[DIFFUSION_FOCAL_PRIMARY_ARTWORK], 'Primary artwork / cloth');
  assert.equal(byId[PRIMARY_ID], 'Glass Petal Sphere');
});

// ── cameraSpaceForwardDistance — real camera-space depth (Codex review
// requirement #1/#2/#3: real camera-space forward distance, moving the
// target updates it, orbit vs shot camera resolve independently). ───────

test('cameraSpaceForwardDistance: a point straight ahead of the camera returns its plain forward distance', () => {
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 60);
  camera.position.set(0, 0, 2.6);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const dist = cameraSpaceForwardDistance(camera, new THREE.Vector3(0, 0, 0));
  assert.ok(Math.abs(dist - 2.6) < 1e-6, `expected ~2.6, got ${dist}`);
});

test('cameraSpaceForwardDistance: moving the target along the camera axis changes the resolved distance by exactly the same amount', () => {
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 60);
  camera.position.set(0, 0, 2.6);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const before = cameraSpaceForwardDistance(camera, new THREE.Vector3(0, 0, 0));
  const after = cameraSpaceForwardDistance(camera, new THREE.Vector3(0, 0, 0.5)); // moved 0.5 units TOWARD the camera
  assert.ok(Math.abs((before - after) - 0.5) < 1e-6, `moving 0.5 units closer should reduce forward distance by 0.5, got before=${before} after=${after}`);
});

test('cameraSpaceForwardDistance: a target off-center (not on the optical axis) still uses forward (Z) distance, not Euclidean distance — the two genuinely disagree here', () => {
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 60);
  camera.position.set(0, 0, 2.6);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const offCenter = new THREE.Vector3(1.5, 0, 0); // well off the optical axis, same Z as origin
  const forwardDist = cameraSpaceForwardDistance(camera, offCenter);
  const euclideanDist = camera.position.distanceTo(offCenter);
  assert.ok(Math.abs(forwardDist - 2.6) < 1e-6, 'forward distance must match the on-axis point exactly (same camera-space Z)');
  assert.ok(euclideanDist > forwardDist + 0.3, `Euclidean distance (${euclideanDist}) must be meaningfully larger than forward distance (${forwardDist}) — proving the function is NOT just doing camera-to-target distance`);
});

test('cameraSpaceForwardDistance: Orbit and Shot cameras at different positions/orientations resolve the SAME world point to different, independently-correct distances', () => {
  const target = new THREE.Vector3(0.2, 0.1, 0);
  const orbitCam = new THREE.PerspectiveCamera(40, 1, 0.05, 60);
  orbitCam.position.set(0, 0, 2.6);
  orbitCam.lookAt(0, 0, 0);
  orbitCam.updateMatrixWorld();
  const shotCam = new THREE.PerspectiveCamera(40, 1, 0.05, 60);
  shotCam.position.set(1.5, 0.5, 3.2); // a genuinely different shot-camera pose
  shotCam.lookAt(0, 0, 0);
  shotCam.updateMatrixWorld();

  const orbitDist = cameraSpaceForwardDistance(orbitCam, target);
  const shotDist = cameraSpaceForwardDistance(shotCam, target);
  assert.notEqual(orbitDist, shotDist, 'two different camera poses must resolve a genuinely different forward distance to the same world point');
  // Each independently correct: re-deriving forward distance via the raw
  // view-space transform (not the function under test) must agree.
  const rawOrbit = target.clone().applyMatrix4(orbitCam.matrixWorldInverse);
  const rawShot = target.clone().applyMatrix4(shotCam.matrixWorldInverse);
  assert.ok(Math.abs(orbitDist - (-rawOrbit.z)) < 1e-6);
  assert.ok(Math.abs(shotDist - (-rawShot.z)) < 1e-6);
});

// ── linearizeDepth — mirrors DIFFUSION_SHADER's own GLSL formula exactly
// (Codex review requirement #6: camera near/far values reach the shader
// configuration — this proves the JS-side math the render loop's near/far
// sync depends on is correct; the uniform wiring itself is confirmed by
// direct code reading + live verification, since no WebGL context exists
// in this test environment). ─────────────────────────────────────────────

test('linearizeDepth: rawDepth 0 (nearest possible) linearizes to exactly `near`', () => {
  assert.ok(Math.abs(linearizeDepth(0, 0.05, 60) - 0.05) < 1e-9);
});

test('linearizeDepth: rawDepth 1 (the untouched background/clear — nothing drew there) linearizes to exactly `far`', () => {
  assert.ok(Math.abs(linearizeDepth(1, 0.05, 60) - 60) < 1e-9);
});

test('linearizeDepth: a real camera\'s near/far genuinely change the linearized result for the same rawDepth — proving the near/far VALUES matter, not just their presence', () => {
  const withDefaultFar = linearizeDepth(0.9, 0.05, 60);
  const withDoubledFar = linearizeDepth(0.9, 0.05, 120);
  assert.notEqual(withDefaultFar, withDoubledFar, 'a different far plane must produce a different linearized distance for the same raw depth value — this is exactly what a hardcoded shader constant could never do for a camera whose far plane differs from 60');
});

test('linearizeDepth is monotonically increasing in rawDepth for a fixed near/far (nearer raw depth never linearizes to a farther distance)', () => {
  const near = 0.05, far = 60;
  let prev = -Infinity;
  for (let raw = 0; raw <= 1; raw += 0.05) {
    const d = linearizeDepth(raw, near, far);
    assert.ok(d >= prev, `linearizeDepth must be monotonic — rawDepth=${raw} gave ${d}, prior was ${prev}`);
    prev = d;
  }
});

// ── computeCircleOfConfusion / computeBlurRadiusPx — the CoC/blur response
// (Codex review requirement #9/#11: minimum stays subtle, midrange clearly
// perceptible, maximum unmistakable; the focal subject stays sharper than
// off-focus content). Mirrors DIFFUSION_SHADER's exact GLSL magic numbers. ─

test('computeCircleOfConfusion: exactly at the focal plane, CoC is zero (perfectly sharp) regardless of aperture/radius settings', () => {
  const coc = computeCircleOfConfusion({ dist: 2.6, focusDistance: 2.6, falloff: 0.5 });
  assert.equal(coc, 0);
});

test('computeCircleOfConfusion: far outside the falloff band, CoC saturates to 1 (maximum blur)', () => {
  const coc = computeCircleOfConfusion({ dist: 20, focusDistance: 2.6, falloff: 0.5 });
  assert.equal(coc, 1);
});

test('computeBlurRadiusPx: the reworked response curve — minimum stays subtle, the shipped defaults are already clearly visible, midrange is strongly perceptible, and maximum is unmistakable', () => {
  const minRadius = computeBlurRadiusPx(1, { diffusionRadius: 0, aperture: 0 });
  const defaultRadius = computeBlurRadiusPx(1, { diffusionRadius: 0.3, aperture: 0.4 });
  const midRadius = computeBlurRadiusPx(1, { diffusionRadius: 0.5, aperture: 0.5 });
  const maxRadius = computeBlurRadiusPx(1, { diffusionRadius: 1, aperture: 1 });
  assert.ok(minRadius < 1, `minimum should stay subtle (<1px), got ${minRadius}`);
  assert.ok(defaultRadius > 5, `the shipped defaults must already be clearly visible (>5px), got ${defaultRadius}`);
  assert.ok(midRadius > 10, `midrange must be clearly perceptible (>10px), got ${midRadius}`);
  assert.equal(maxRadius, 40, 'maximum must reach the full 40px ceiling');
  assert.ok(minRadius < defaultRadius && defaultRadius < midRadius && midRadius < maxRadius, 'the curve must be strictly increasing across these four points');
});

test('computeBlurRadiusPx: maximum diffusion settings produce a MATERIALLY larger radius than minimum settings — the quantitative proof the fix actually changed something (before this round: max ~18px, min ~0px, and the shipped defaults were only ~3.5px)', () => {
  const min = computeBlurRadiusPx(1, { diffusionRadius: 0, aperture: 0 });
  const max = computeBlurRadiusPx(1, { diffusionRadius: 1, aperture: 1 });
  assert.ok(max - min > 30, `expected a >30px swing between minimum and maximum, got ${max - min}`);
});

test('the focal subject preserves sharpness while off-focus content blurs, for the SAME frame/settings — an algorithmic proof of "focused subject vs blurred surroundings", independent of any WebGL rendering', () => {
  const settings = { falloff: 0.4, diffusionRadius: 0.8, aperture: 0.8, foregroundBias: 0, backgroundBias: 0 };
  const focusDistance = 2.6;
  const onFocusCoc = computeCircleOfConfusion({ dist: focusDistance, focusDistance, ...settings });
  const offFocusCoc = computeCircleOfConfusion({ dist: focusDistance + 2, focusDistance, ...settings });
  const onFocusRadius = computeBlurRadiusPx(onFocusCoc, settings);
  const offFocusRadius = computeBlurRadiusPx(offFocusCoc, settings);
  assert.equal(onFocusRadius, 0, 'the exact focal-plane subject must have zero blur radius');
  assert.ok(offFocusRadius > 15, `an object 2 world units off the focal plane must be clearly blurred, got ${offFocusRadius}px`);
  assert.ok(onFocusRadius < offFocusRadius, 'the focal subject must always be strictly sharper than off-focus content under the same settings');
});

// ── Foreground/background bias — requirement #9: "must produce visibly
// different results." ────────────────────────────────────────────────────

test('foreground and background bias independently scale CoC on their own side of the focal plane only', () => {
  const base = { dist: 4, focusDistance: 2.6, falloff: 0.3 }; // dist > focusDistance -> background side
  const neutral = computeCircleOfConfusion(base);
  const backgroundBiasedUp = computeCircleOfConfusion({ ...base, backgroundBias: 1 });
  const backgroundBiasedDown = computeCircleOfConfusion({ ...base, backgroundBias: -1 });
  assert.ok(backgroundBiasedUp >= neutral, 'a +1 background bias must never reduce background CoC');
  assert.equal(backgroundBiasedDown, 0, 'a -1 background bias (biasAmt=0) must fully suppress background blur');

  const fgBase = { dist: 1, focusDistance: 2.6, falloff: 0.3 }; // dist < focusDistance -> foreground side
  const fgNeutral = computeCircleOfConfusion(fgBase);
  const fgBiasedUp = computeCircleOfConfusion({ ...fgBase, foregroundBias: 1 });
  assert.ok(fgBiasedUp >= fgNeutral, 'a +1 foreground bias must never reduce foreground CoC');
  // Changing backgroundBias must never affect the FOREGROUND side, and vice versa.
  const fgWithBackgroundBiasChanged = computeCircleOfConfusion({ ...fgBase, backgroundBias: 1 });
  assert.equal(fgWithBackgroundBiasChanged, fgNeutral, 'background bias must not leak into the foreground side\'s CoC');
});

// ── Slider dead zone — Aperture 0% × Diffusion Radius 0% maps to a sub-pixel
// worst-case radius (below the shader's own `radius > 0.4` blur gate), which
// is exactly the saved state that made the live feature read as "not working
// at all" while On. The UI warns via #cloth-diffusion-camera-no-blur-note
// using this same worst-case computation. ────────────────────────────────

test('zeroed Aperture + Diffusion Radius produce a sub-pixel worst-case radius — the dead zone the UI must warn about', () => {
  const worstCase = computeBlurRadiusPx(1, { diffusionRadius: 0, aperture: 0 });
  assert.ok(worstCase < 1, `zeroed sliders must stay sub-pixel (the UI's warning threshold), got ${worstCase}px`);
  assert.ok(worstCase <= 0.4, `zeroed sliders sit at/below the shader's 0.4px blur gate, got ${worstCase}px`);
  // The shipped defaults must sit safely OUTSIDE the dead zone, so a fresh
  // scene that toggles Diffusion On always shows a real effect.
  const shippedDefaults = computeBlurRadiusPx(1, { diffusionRadius: 0.3, aperture: 0.4 });
  assert.ok(shippedDefaults > 5, `shipped defaults must be clearly visible at coc=1, got ${shippedDefaults}px`);
});
