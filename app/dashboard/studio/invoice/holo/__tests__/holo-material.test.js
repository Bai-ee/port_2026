// Invoice Studio HoloPaper — holo-material.js unit tests (Lane S).
//
// createInvoiceHoloMaterial() only ever CONSTRUCTS objects and manipulates
// strings — it never touches a real WebGL context — so it is genuinely
// unit-testable with a minimal fake THREE namespace (no real Three.js/DOM
// needed), not just a static source-content check. onBeforeCompile is
// exercised directly against a fake `shader` object, exactly the shape
// Three.js itself passes to a material's onBeforeCompile hook.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInvoiceHoloMaterial,
  createInvoiceHoloUniforms,
  buildInvoiceHoloFragPars,
  buildInvoiceHoloFragBody,
  INVOICE_HOLO_FRAG_PARS,
  INVOICE_HOLO_FRAG_BODY,
  INVOICE_HOLO_INTENSITY,
  INVOICE_HOLO_SAT_BOOST,
  INVOICE_HOLO_SPARKLE,
  INVOICE_HOLO_BASE_COLOR,
  INVOICE_HOLO_ROUGHNESS,
  INVOICE_HOLO_METALNESS,
  INVOICE_HOLO_DARK_MASK_FLOOR,
  INVOICE_HOLO_MASK_LUMA_LOW,
  INVOICE_HOLO_MASK_LUMA_HIGH,
} from '../holo-material.js';

class FakeColor {
  constructor(hex) { this.hex = hex; }
}

class FakeMeshPhysicalMaterial {
  constructor(params) {
    Object.assign(this, params);
    this.defines = undefined;
    this.onBeforeCompile = undefined;
    this.disposed = false;
  }

  dispose() { this.disposed = true; }
}

function makeFakeTHREE() {
  return { MeshPhysicalMaterial: FakeMeshPhysicalMaterial, Color: FakeColor, FrontSide: 'front', BackSide: 'back' };
}

function makeFakeShader() {
  return {
    uniforms: {},
    fragmentShader: '// header\n#include <common>\nvoid main() {\n#include <emissivemap_fragment>\n}\n',
  };
}

// ── Legibility-tuned tuning values — sanity bounds, not exact pins ───────
// (exact numbers are allowed to be retuned later per the file's own header;
// these assert the PRODUCT REQUIREMENT — restrained vs. a decorative
// preset — rather than freezing specific magic numbers.)

test('the frozen preset is restrained: intensity/saturation/sparkle all sit well under a "showy" range', () => {
  assert.ok(INVOICE_HOLO_INTENSITY > 0 && INVOICE_HOLO_INTENSITY <= 0.3, `INVOICE_HOLO_INTENSITY=${INVOICE_HOLO_INTENSITY} should be low`);
  assert.ok(INVOICE_HOLO_SAT_BOOST > 0 && INVOICE_HOLO_SAT_BOOST <= 0.5, `INVOICE_HOLO_SAT_BOOST=${INVOICE_HOLO_SAT_BOOST} should be low`);
  assert.ok(INVOICE_HOLO_SPARKLE > 0 && INVOICE_HOLO_SPARKLE <= 0.2, `INVOICE_HOLO_SPARKLE=${INVOICE_HOLO_SPARKLE} should be low`);
});

test('the base material reads as pearl/white paper, not metal/onyx', () => {
  assert.equal(INVOICE_HOLO_BASE_COLOR, 0xfbfaf7);
  assert.ok(INVOICE_HOLO_METALNESS <= 0.1, 'metalness should be near-zero for a paper surface');
  assert.ok(INVOICE_HOLO_ROUGHNESS >= 0.2, 'roughness should be high enough to avoid hard metallic specular hot-spots');
});

test('the dark-ink legibility mask floor is a small positive fraction, not fully off or fully on', () => {
  assert.ok(INVOICE_HOLO_DARK_MASK_FLOOR > 0 && INVOICE_HOLO_DARK_MASK_FLOOR < 0.3);
  assert.ok(INVOICE_HOLO_MASK_LUMA_LOW < INVOICE_HOLO_MASK_LUMA_HIGH);
});

// ── GLSL builders ─────────────────────────────────────────────────────────

test('buildInvoiceHoloFragPars declares every uniform the shader body reads', () => {
  const pars = buildInvoiceHoloFragPars();
  for (const uniform of ['uHoloIntensity', 'uHoloScale', 'uBandFreq', 'uSatBoost', 'uHueShift', 'uSparkle', 'uTime']) {
    assert.ok(pars.includes(`uniform float ${uniform};`), `missing uniform declaration for ${uniform}`);
  }
  assert.equal(pars, INVOICE_HOLO_FRAG_PARS);
});

test('buildInvoiceHoloFragBody bakes the legibility-mask constants into the GLSL and adds (never replaces) via totalEmissiveRadiance', () => {
  const body = buildInvoiceHoloFragBody();
  assert.ok(body.includes('totalEmissiveRadiance +='), 'must be additive, never a color replacement');
  assert.ok(body.includes('diffuseColor.rgb'), 'legibility mask must read the already-resolved texture color');
  assert.ok(body.includes(INVOICE_HOLO_DARK_MASK_FLOOR.toFixed(3)));
  assert.ok(body.includes(INVOICE_HOLO_MASK_LUMA_LOW.toFixed(3)));
  assert.ok(body.includes(INVOICE_HOLO_MASK_LUMA_HIGH.toFixed(3)));
  assert.equal(body, INVOICE_HOLO_FRAG_BODY);
});

// ── createInvoiceHoloUniforms ───────────────────────────────────────────

test('createInvoiceHoloUniforms returns a fresh object every call (scenes never accidentally share)', () => {
  const a = createInvoiceHoloUniforms();
  const b = createInvoiceHoloUniforms();
  assert.notEqual(a, b);
  assert.notEqual(a.uTime, b.uTime);
  assert.equal(a.uHoloIntensity.value, INVOICE_HOLO_INTENSITY);
});

// ── createInvoiceHoloMaterial ──────────────────────────────────────────

test('createInvoiceHoloMaterial throws without a usable THREE namespace', () => {
  assert.throws(() => createInvoiceHoloMaterial(null, 'front', { holoUniforms: createInvoiceHoloUniforms() }));
  assert.throws(() => createInvoiceHoloMaterial({}, 'front', { holoUniforms: createInvoiceHoloUniforms() }));
});

test('createInvoiceHoloMaterial throws without holoUniforms', () => {
  assert.throws(() => createInvoiceHoloMaterial(makeFakeTHREE(), 'front', {}));
});

test('createInvoiceHoloMaterial builds a MeshPhysicalMaterial with the frozen tuning and USE_UV defined', () => {
  const THREE = makeFakeTHREE();
  const holoUniforms = createInvoiceHoloUniforms();
  const mat = createInvoiceHoloMaterial(THREE, THREE.FrontSide, { holoUniforms });
  assert.ok(mat instanceof FakeMeshPhysicalMaterial);
  assert.equal(mat.side, 'front');
  assert.equal(mat.color, INVOICE_HOLO_BASE_COLOR);
  assert.equal(mat.roughness, INVOICE_HOLO_ROUGHNESS);
  assert.equal(mat.metalness, INVOICE_HOLO_METALNESS);
  assert.equal(mat.defines.USE_UV, '');
  assert.equal(typeof mat.onBeforeCompile, 'function');
});

test('createInvoiceHoloMaterial without a bumpMap sets bumpScale to 0 (no bump texture applied this round)', () => {
  const THREE = makeFakeTHREE();
  const mat = createInvoiceHoloMaterial(THREE, THREE.FrontSide, { holoUniforms: createInvoiceHoloUniforms() });
  assert.equal(mat.bumpMap, null);
  assert.equal(mat.bumpScale, 0);
});

test('onBeforeCompile injects both GLSL pieces at the documented #include anchors', () => {
  const THREE = makeFakeTHREE();
  const holoUniforms = createInvoiceHoloUniforms();
  const mat = createInvoiceHoloMaterial(THREE, THREE.FrontSide, { holoUniforms });
  const shader = makeFakeShader();
  mat.onBeforeCompile(shader);

  assert.ok(shader.fragmentShader.includes(INVOICE_HOLO_FRAG_PARS));
  assert.ok(shader.fragmentShader.includes(INVOICE_HOLO_FRAG_BODY));
  // Pars must land right after the #include <common> anchor, body right
  // after #include <emissivemap_fragment> — verify ordering, not just
  // presence.
  const commonIx = shader.fragmentShader.indexOf('#include <common>');
  const parsIx = shader.fragmentShader.indexOf(INVOICE_HOLO_FRAG_PARS);
  const emissiveIx = shader.fragmentShader.indexOf('#include <emissivemap_fragment>');
  const bodyIx = shader.fragmentShader.indexOf(INVOICE_HOLO_FRAG_BODY);
  assert.ok(commonIx < parsIx);
  assert.ok(emissiveIx < bodyIx);
});

test('onBeforeCompile assigns the SAME shared holoUniforms object into shader.uniforms (front/back share one clock)', () => {
  const THREE = makeFakeTHREE();
  const holoUniforms = createInvoiceHoloUniforms();
  const front = createInvoiceHoloMaterial(THREE, THREE.FrontSide, { holoUniforms });
  const back = createInvoiceHoloMaterial(THREE, THREE.BackSide, { holoUniforms });

  const frontShader = makeFakeShader();
  const backShader = makeFakeShader();
  front.onBeforeCompile(frontShader);
  back.onBeforeCompile(backShader);

  assert.equal(frontShader.uniforms.uHoloIntensity, holoUniforms.uHoloIntensity);
  assert.equal(backShader.uniforms.uHoloIntensity, holoUniforms.uHoloIntensity);
  // Mutating the shared object's .value must be visible through BOTH
  // shaders' uniforms refs without a second write — this is what lets the
  // scene advance uTime once per frame and have it apply to both faces.
  holoUniforms.uTime.value = 42;
  assert.equal(frontShader.uniforms.uTime.value, 42);
  assert.equal(backShader.uniforms.uTime.value, 42);
});

test('createInvoiceHoloMaterial forwards an explicit map/bumpMap through to the material', () => {
  const THREE = makeFakeTHREE();
  const fakeMap = { isTexture: true, id: 'map' };
  const fakeBump = { isTexture: true, id: 'bump' };
  const mat = createInvoiceHoloMaterial(THREE, THREE.FrontSide, {
    holoUniforms: createInvoiceHoloUniforms(), map: fakeMap, bumpMap: fakeBump,
  });
  assert.equal(mat.map, fakeMap);
  assert.equal(mat.bumpMap, fakeBump);
  assert.ok(mat.bumpScale > 0);
});
