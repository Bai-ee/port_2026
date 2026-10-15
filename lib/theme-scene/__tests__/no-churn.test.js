import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Static guards for contract §9.3: a theme change must never remount the Canvas, replace the
// material, recompile a program or recreate the renderer. These read the source of ox.jsx.

const root = new URL('../../../', import.meta.url);
const ox = readFileSync(new URL('ox.jsx', root), 'utf8');

/** Source text of every `useFrame(...)` callback (balanced parens from the call). */
function useFrameBodies(src) {
  const bodies = [];
  const re = /useFrame\(/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 0;
    let i = m.index + 'useFrame'.length;
    for (; i < src.length; i += 1) {
      const ch = src[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    bodies.push(src.slice(m.index, i + 1));
  }
  return bodies;
}

test('useFrame bodies were found (guard against a broken extractor)', () => {
  assert.ok(useFrameBodies(ox).length >= 4);
});

test('no useFrame callback creates or invalidates a material / program / renderer', () => {
  for (const body of useFrameBodies(ox)) {
    assert.ok(!/new THREE\.ShaderMaterial/.test(body), 'ShaderMaterial created in useFrame');
    assert.ok(!/new THREE\.WebGLRenderer/.test(body));
    assert.ok(!/material\.needsUpdate/.test(body), 'material.needsUpdate set in useFrame');
    assert.ok(!/material\.version/.test(body));
    assert.ok(!/\.(dispose|compile)\(/.test(body), 'dispose/compile in useFrame');
    assert.ok(!/(fragmentShader|vertexShader)\s*=/.test(body), 'GLSL edited in useFrame');
    assert.ok(!/(\.uniforms\s*=[^=])/.test(body), 'uniforms object replaced in useFrame');
  }
});

test('buffer-attribute needsUpdate is the only needsUpdate in the render loop', () => {
  for (const body of useFrameBodies(ox)) {
    const hits = body.match(/[A-Za-z_.]*needsUpdate/g) || [];
    for (const hit of hits) assert.ok(/instanceMatrix\.needsUpdate|instanceColor\.needsUpdate/.test(hit), `unexpected ${hit}`);
  }
});

test('exactly one ShaderMaterial, created once inside a [] useMemo', () => {
  assert.equal((ox.match(/new THREE\.ShaderMaterial/g) || []).length, 1);
  const start = ox.indexOf('const material = useMemo(() => new THREE.ShaderMaterial');
  assert.ok(start > 0);
  assert.ok(ox.indexOf('}), []);', start) > start, 'material memo has an empty dependency list');
});

test('the particle shader gained only the highlight uniforms; mix 0 is the identity', () => {
  assert.match(ox, /uHighlight:\s*\{\s*value:\s*new THREE\.Vector3/);
  assert.match(ox, /uHighlightMix:\s*\{\s*value:\s*0\.0\s*\}/);
  assert.match(ox, /uniform vec3 uHighlight;/);
  assert.match(ox, /uniform float uHighlightMix;/);
  assert.match(ox, /col = mix\(col, uHighlight, uHighlightMix \* metallic\);/);
  assert.match(ox, /vec3 col = vColor \* diffuse;/);
});

test('Canvas is not keyed by anything and no theme value is a React dependency of a remount', () => {
  const canvasTag = ox.slice(ox.indexOf('<Canvas'), ox.indexOf('>', ox.indexOf('<Canvas') + 1));
  assert.ok(!/\bkey=/.test(canvasTag), 'Canvas must not be keyed');
  assert.ok(!/gl=\{\{[^}]*(sceneMode|theme)/.test(canvasTag), 'renderer options must not depend on the theme');
  assert.ok(!/key=\{[^}]*(theme|mode|scene)/i.test(ox), 'nothing in ox.jsx is keyed by theme');
});

test('the scene store is read through refs / the driver, never through React state', () => {
  assert.ok(!/useState\([^)]*sceneBridge/.test(ox));
  assert.match(ox, /bindDriver\(sceneDriver, sceneBridge, driverMode\)/);
  assert.ok(!/useSyncExternalStore/.test(ox));
  // The only React state added for the scene is the one-off GL context-loss flag.
  assert.match(ox, /const \[sceneState, setSceneState\] = useState\('ready'\)/);
});

test('sceneMode defaults to "off" so /looper, /capture and /preview/canvas are unchanged', () => {
  assert.match(ox, /sceneMode = 'off'/);
  for (const rel of ['components/looper/LooperLandingPage.jsx', 'app/capture/page.jsx', 'app/preview/canvas/page.jsx']) {
    const src = readFileSync(new URL(rel, root), 'utf8');
    assert.ok(!/sceneMode/.test(src) && !/backgroundColor=["']theme["']/.test(src), `${rel} must not opt in`);
  }
});

test('legacy path is preserved when the scene is off (same expressions as before)', () => {
  assert.match(ox, /material\.uniforms\.uOpacity\.value = sceneActive \? sceneParams\.opacity : \(PARAMS\.opacity \?\? 1\);/);
  assert.match(ox, /const hueOffset = sceneActive \? sceneParams\.hueOffset : \(PARAMS\.hueOffset \?\? 0\);/);
  assert.match(ox, /const hueSpan = sceneActive \? sceneParams\.hueSpan : 0\.8;/);
  assert.match(ox, /const hue = \(hueOffset \+ t \* hueSpan \+ timeHue \+ wave \* 0\.05\) % 1;/);
  assert.match(ox, /pColor\.setHSL\(hue, saturation, lightness \+ wave \* 0\.15\);/);
});

test('no positive-priority useFrame was added (it would take over rendering and blank the scene)', () => {
  const bodies = useFrameBodies(ox);
  const prioritised = bodies.filter((b) => /\},\s*-?\d+\s*\)\s*$/.test(b));
  // The only one is the pre-existing /looper-only RadialDiffusionEffect (priority 1).
  assert.equal(prioritised.length, 1);
  assert.match(prioritised[0], /composer\.render\(\)/);
});

test('the opaque themed background is one Color set in place, scene.background never replaced per change', () => {
  const start = ox.indexOf('const SceneBackground =');
  const block = ox.slice(start, ox.indexOf('// Opt-in debug counters', start));
  assert.equal((block.match(/new THREE\.Color\(/g) || []).length, 2, 'one themed Color per mount + the legacy fixed-hex Color');
  assert.match(block, /applyBackgroundToColor\(themeColorRef\.current, smoothed\)/);
});

test('debug stats are gated by the debug storage key and publish the three counters', () => {
  assert.match(ox, /STORAGE_KEYS\.debug\) === '1'/);
  assert.match(ox, /window\.__themeSceneStats = \{\s*canvasId,\s*materialCount: materials\.size,\s*programCount:/);
  assert.match(ox, /\{debugStatsEnabled \? <SceneDebugStats canvasId=\{canvasId\} \/> : null\}/);
});

test('context loss keeps the canvas mounted and shows the themed fallback', () => {
  assert.match(ox, /addEventListener\('webglcontextlost', handleLost\)/);
  assert.match(ox, /addEventListener\('webglcontextrestored', onRestored\)/);
  assert.match(ox, /event\.preventDefault\(\);\s*onLost\(\);/);
  assert.match(ox, /removeEventListener\('webglcontextlost', handleLost\)/);
  assert.match(ox, /removeEventListener\('webglcontextrestored', onRestored\)/);
  assert.match(ox, /setSceneState\('lost'\)/);
  assert.match(ox, /setSceneState\('ready'\)/);
  assert.match(ox, /data-scene-state=\{sceneState\}/);
  assert.match(ox, /sceneState === 'lost' \? <SceneFallback/);
  assert.match(ox, /<SceneContextGuard onLost=\{handleContextLost\} onRestored=\{handleContextRestored\} \/>/);
});
