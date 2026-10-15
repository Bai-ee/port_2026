import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyHighlightToUniforms, clearHighlightUniforms, applyBackgroundToColor, SRGB_COLOR_SPACE } from '../three-bindings.js';
import { createSceneDriver } from '../scene-driver.js';
import { applySceneToParams, SCENE_IDENTITY } from '../apply-scene.js';

// Same uniform shape ox.jsx builds its material with.
const makeMaterial = () => new THREE.ShaderMaterial({
  uniforms: {
    uOpacity: { value: 1.0 },
    uHighlight: { value: new THREE.Vector3(0, 0, 0) },
    uHighlightMix: { value: 0.0 },
  },
  transparent: true,
  vertexShader: 'void main() { gl_Position = vec4(0.0); }',
  fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
});

const scene = (extra) => ({ ...SCENE_IDENTITY, ...extra });

test('SRGB_COLOR_SPACE matches THREE.SRGBColorSpace', () => {
  assert.equal(SRGB_COLOR_SPACE, THREE.SRGBColorSpace);
});

test('repeated applies mutate the SAME material, uniforms and vector: identity preserved, no recompile signal', () => {
  const material = makeMaterial();
  const uniformsRef = material.uniforms;
  const uOpacityRef = material.uniforms.uOpacity;
  const uHighlightRef = material.uniforms.uHighlight;
  const vectorRef = material.uniforms.uHighlight.value;
  const mixRef = material.uniforms.uHighlightMix;
  const versionBefore = material.version;

  const driver = createSceneDriver();
  driver.setTarget(scene({}), 'light');
  const params = { hueOffset: 0.44, saturation: 0.9, lightness: 0.52, opacity: 0.16 };
  const out = {};

  for (let i = 0; i < 120; i += 1) {
    // a hue "drag": a new target every frame
    driver.setTarget(scene({
      hueShift: ((i * 7) % 100) / 100 - 0.5,
      opacityMul: 1 + (i % 5) / 10,
      highlight: { srgb: [i / 120, 0.5, 1 - i / 120], mix: (i % 10) / 10 },
    }), 'light');
    const s = driver.step(i / 60, 10);
    applySceneToParams(params, s, out);
    material.uniforms.uOpacity.value = out.opacity;
    applyHighlightToUniforms(material.uniforms, s);
  }

  assert.equal(material.uniforms, uniformsRef);
  assert.equal(material.uniforms.uOpacity, uOpacityRef);
  assert.equal(material.uniforms.uHighlight, uHighlightRef);
  assert.equal(material.uniforms.uHighlight.value, vectorRef, 'the Vector3 is mutated in place, never replaced');
  assert.equal(material.uniforms.uHighlightMix, mixRef);
  assert.equal(material.version, versionBefore, 'ShaderMaterial.version unchanged => needsUpdate was never set => no program rebuild');
  assert.equal(Object.keys(material.uniforms).length, 3, 'no uniforms added or removed');
});

test('applyHighlightToUniforms writes display-space numbers verbatim', () => {
  const material = makeMaterial();
  applyHighlightToUniforms(material.uniforms, { highlightR: 0.25, highlightG: 0.5, highlightB: 0.75, highlightMix: 0.6 });
  const v = material.uniforms.uHighlight.value;
  assert.deepEqual([v.x, v.y, v.z], [0.25, 0.5, 0.75]);
  assert.equal(material.uniforms.uHighlightMix.value, 0.6);
});

test('applyHighlightToUniforms / clearHighlightUniforms tolerate a material without the uniforms', () => {
  assert.equal(applyHighlightToUniforms({ uOpacity: { value: 1 } }, {}), false);
  assert.equal(applyHighlightToUniforms(null, {}), false);
  assert.equal(clearHighlightUniforms({}), false);
});

test('clearHighlightUniforms neutralises the mix (leaving theme mode)', () => {
  const material = makeMaterial();
  applyHighlightToUniforms(material.uniforms, { highlightR: 1, highlightG: 1, highlightB: 1, highlightMix: 0.5 });
  assert.equal(clearHighlightUniforms(material.uniforms), true);
  assert.equal(material.uniforms.uHighlightMix.value, 0);
  assert.equal(clearHighlightUniforms(material.uniforms), false, 'already neutral');
});

test('the background Color is mutated in place and round-trips to the sRGB hex', () => {
  const color = new THREE.Color();
  const driver = createSceneDriver();
  const hexes = ['#ffffff', '#0f0e0a', '#181713', '#c47c56', '#000000'];
  for (const hex of hexes) {
    driver.setTarget(scene({ background: hex }), 'dark');
    driver.step(Math.random() + hexes.indexOf(hex) + 1, 10, true);
    assert.equal(applyBackgroundToColor(color, driver.state), true);
    // WebGLBackground reads scene.background with getRGB(target, outputColorSpace = sRGB)
    const out = { r: 0, g: 0, b: 0 };
    color.getRGB(out, THREE.SRGBColorSpace);
    const back = '#' + [out.r, out.g, out.b].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
    assert.equal(back, hex);
    // and it is exactly what scene.background = new THREE.Color(hex) produced before this change
    const legacy = new THREE.Color(hex);
    assert.ok(Math.abs(color.r - legacy.r) < 1e-6 && Math.abs(color.g - legacy.g) < 1e-6 && Math.abs(color.b - legacy.b) < 1e-6);
  }
  assert.equal(applyBackgroundToColor(null, driver.state), false);
});
