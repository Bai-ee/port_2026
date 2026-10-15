import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applySceneToParams, SCENE_IDENTITY } from '../apply-scene.js';
import { hslToSrgb01, resolveTheme, createBaseline } from '../../theme/index.js';

// Colour-management facts this design depends on (three 0.165.0, @react-three/fiber 9.5.0):
//  1. Color.setHSL(h, s, l) uses the WORKING colour space (linear-sRGB) as its source space, so it
//     stores the raw numbers unchanged; ox.jsx writes those raw numbers into instanceColor.
//  2. ox's ShaderMaterial has no colorspace_fragment / tonemapping_fragment, so those raw numbers are
//     displayed as-is. The scene therefore only needs to produce *display-space* HSL deltas.
//  3. Only scene.background is colour-managed (hex -> linear working space -> sRGB output): round trips.

const near = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('three keeps colour management on with a linear working space (what R3F 9.5 configures)', () => {
  assert.equal(THREE.ColorManagement.enabled, true);
  assert.equal(THREE.ColorManagement.workingColorSpace, THREE.LinearSRGBColorSpace);
});

test('Color.setHSL stores the raw HSL->RGB numbers (no gamma conversion): matches lib/theme hslToSrgb01', () => {
  const c = new THREE.Color();
  for (let i = 0; i < 400; i += 1) {
    const h = (i * 0.6180339887) % 1;
    const s = 0.2 + ((i * 0.37) % 0.8);
    const l = 0.1 + ((i * 0.53) % 0.8);
    c.setHSL(h, s, l);
    const [r, g, b] = hslToSrgb01({ h, s, l });
    near(c.r, r);
    near(c.g, g);
    near(c.b, b);
  }
});

test('baseline adapter output equals what Color.setHSL wrote before the theme work (inner page + home)', () => {
  const light = resolveTheme(createBaseline(), 'light').scene;
  const surfaces = [
    { hueOffset: 0.44, saturation: 0.9, lightness: 0.52, hueSpeed: 0.016 },
    { hueOffset: 0.36, saturation: 0.75, lightness: 0.4, hueSpeed: 0.02 },
    { hueOffset: 0.5, saturation: 1, lightness: 0.55, hueSpeed: 0.02 },
  ];
  const before = new THREE.Color();
  const after = new THREE.Color();
  const eff = {};
  for (const surface of surfaces) {
    applySceneToParams(surface, light, eff);
    for (let i = 0; i < 300; i += 1) {
      const t = i / 300;
      const wave = Math.sin(i * 0.37) * Math.cos(i * 0.11) * 1.08;
      const timeHue = i * 0.003 * surface.hueSpeed;
      // legacy ox.jsx line
      const hueOld = (surface.hueOffset + t * 0.8 + timeHue + wave * 0.05) % 1;
      before.setHSL(hueOld, surface.saturation, surface.lightness + wave * 0.15);
      // themed ox.jsx line
      const hueNew = (eff.hueOffset + t * eff.hueSpan + timeHue + wave * 0.05) % 1;
      after.setHSL(hueNew, eff.saturation, eff.lightness + wave * 0.15);
      assert.equal(after.r, before.r);
      assert.equal(after.g, before.g);
      assert.equal(after.b, before.b);
    }
  }
});

test('identity scene is bit-identical to the legacy formula for any surface hue / span', () => {
  const before = new THREE.Color();
  const after = new THREE.Color();
  const eff = {};
  for (let k = 0; k < 50; k += 1) {
    const surface = { hueOffset: (k * 0.0197) % 1, saturation: 0.3 + (k % 7) / 10, lightness: 0.2 + (k % 5) / 10 };
    applySceneToParams(surface, SCENE_IDENTITY, eff);
    const hueOld = (surface.hueOffset + 0.37 * 0.8 + 0.01) % 1;
    const hueNew = (eff.hueOffset + 0.37 * eff.hueSpan + 0.01) % 1;
    before.setHSL(hueOld, surface.saturation, surface.lightness);
    after.setHSL(hueNew, eff.saturation, eff.lightness);
    assert.deepEqual([after.r, after.g, after.b], [before.r, before.g, before.b]);
  }
});

test('scene.background (the only colour-managed colour) round-trips hex -> working space -> sRGB output', () => {
  for (const hex of ['#ffffff', '#0f0e0a', '#181713', '#7f7f7f', '#16f3a3']) {
    const bg = new THREE.Color(hex);
    const out = { r: 0, g: 0, b: 0 };
    bg.getRGB(out, THREE.SRGBColorSpace); // what WebGLBackground.setClear does with outputColorSpace = sRGB
    const back = '#' + [out.r, out.g, out.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
    assert.equal(back, hex);
  }
});

test('particle shader source has no colour-space / tone-mapping chunks (raw display-space output)', async () => {
  const { readFileSync } = await import('node:fs');
  const ox = readFileSync(new URL('../../../ox.jsx', import.meta.url), 'utf8');
  const start = ox.indexOf('const material = useMemo(() => new THREE.ShaderMaterial');
  assert.ok(start > 0);
  const block = ox.slice(start, ox.indexOf('}), []);', start));
  assert.ok(!/colorspace_fragment|tonemapping_fragment|linearToOutputTexel|toneMapping/.test(block));
  assert.ok(/gl_FragColor\s*=\s*vec4\(col,\s*uOpacity\)/.test(block));
});

test('no theme-scene file or ox.jsx changes global colour management, tone mapping or exposure', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const root = new URL('../../../', import.meta.url);
  const sceneDir = new URL('../', import.meta.url);
  const files = [
    new URL('ox.jsx', root),
    new URL('sharedParticleGalleryRenderer.js', root),
    new URL('components/theme-scene/SceneBoundary.jsx', root),
    new URL('components/theme-scene/SceneFallback.jsx', root),
    ...readdirSync(sceneDir).filter((f) => f.endsWith('.js')).map((f) => new URL(f, sceneDir)),
  ];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!/ColorManagement\.(enabled|workingColorSpace)\s*=/.test(src), `${f.pathname} assigns ColorManagement`);
    assert.ok(!/toneMappingExposure\s*=/.test(src), `${f.pathname} sets exposure`);
    if (!/sharedParticleGalleryRenderer/.test(f.pathname)) {
      assert.ok(!/\.toneMapping\s*=/.test(src), `${f.pathname} sets toneMapping`);
      assert.ok(!/outputColorSpace\s*=/.test(src), `${f.pathname} sets outputColorSpace`);
    }
  }
});
