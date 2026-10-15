import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Static wiring checks for the presentation files WS4 owns.
const root = new URL('../../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), 'utf8');
/** Source without // line comments and /* block comments *\/ (so prose never trips a code assertion). */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('InternalPageBackground: themed by default, pinned pages can opt out, wash uses tokens', () => {
  const src = code('InternalPageBackground.jsx');
  assert.match(src, /sceneMode = 'theme'/);
  assert.match(src, /sceneMode=\{sceneMode\}/);
  assert.match(src, /<SceneBoundary/);
  assert.match(src, /background: 'var\(--t-scene-wash\)'/);
  assert.match(src, /var\(--t-glass-highlight\)/);
  assert.ok(!/rgba\(245, 241, 223/.test(src), 'literal wash colour removed');
  assert.ok(!/rgba\(255,255,255,0\.45\)/.test(src));
  for (const id of ['internal-page-bg', 'internal-page-bg-scene-frame', 'internal-page-bg-wash']) assert.match(src, new RegExp(`id="${id}"`));
  assert.match(src, /backgroundColor=\{null\}/, 'inner pages keep a transparent canvas');
});

test('HomePage: opaque themed canvas, token text colour, scrim, deco tokens, blend via stylesheet', () => {
  const src = read('HomePage.jsx');
  assert.match(src, /useState\('theme'\)/);
  assert.match(src, /useState\('var\(--t-text-default\)'\)/);
  assert.ok(!/useState\('#ffffff'\)|useState\('#000000'\)/.test(src));
  assert.match(src, /sceneMode="theme"/);
  assert.match(src, /<SceneBoundary/);
  assert.match(src, /id="hero-text-scrim"/);
  assert.match(src, /radial-gradient\(ellipse at center, var\(--t-scrim\) 0%, transparent 70%\)/);
  for (const [n, a] of [[1, 22], [2, 18], [3, 14], [4, 12]]) {
    assert.match(src, new RegExp(`color-mix\\(in srgb, var\\(--t-deco-${n}\\) ${a}%, transparent\\)`));
  }
  assert.ok(!/mixBlendMode/.test(src), 'a CSS variable is not valid in an inline style');
  assert.match(src, /#hero-gradient-overlay \{\s*mix-blend-mode: var\(--t-blend-deco, multiply\);/);
  assert.ok(!/rgba\((196|102|214|171),/.test(src), 'deco rgba literals removed');
  assert.ok(!/<HeroSchematicOverlay[^>]*color=/s.test(src), 'overlay colour comes from the theme token');
});

test('HeroSchematicOverlay: token-driven stroke colour, re-read on tokens-changed, explicit color still wins', () => {
  const src = read('components/home/HeroSchematicOverlay.jsx');
  assert.match(src, /from '\.\.\/\.\.\/lib\/theme-runtime\/read-token\.js'/);
  assert.match(src, /readToken\(STROKE_TOKEN\)/);
  assert.match(src, /onTokensChanged\(\(\) => \{ rgb = readStrokeRgb\(color\); \}\)/);
  assert.match(src, /stopTokenWatch\(\);/);
  assert.match(src, /color = null,/);
  assert.ok(!/color = '#2a2420'/.test(src));
});

test('Looper keeps passing its own overlay colour (pinned, unchanged)', () => {
  assert.match(read('components/looper/LooperLandingPage.jsx'), /color=\{TEXT_COLOR\}/);
});

test('SceneFallback paints --t-scene-fallback over --t-page, statically', () => {
  const src = code('components/theme-scene/SceneFallback.jsx');
  assert.match(src, /backgroundColor: 'var\(--t-page\)'/);
  assert.match(src, /backgroundImage: 'var\(--t-scene-fallback\)'/);
  assert.ok(!/animation|transition|requestAnimationFrame/.test(src), 'static: nothing to reduce');
  assert.match(src, /aria-hidden="true"/);
  assert.match(src, /pointerEvents: 'none'/);
});

test('SceneBoundary is an error boundary that renders SceneFallback', () => {
  const src = read('components/theme-scene/SceneBoundary.jsx');
  assert.match(src, /static getDerivedStateFromError\(\)/);
  assert.match(src, /componentDidCatch\(/);
  assert.match(src, /<SceneFallback/);
  assert.match(src, /'use client'/);
});

test('S1: the shared gallery renderer only adds the scene hue shift (0 at baseline)', () => {
  const src = read('sharedParticleGalleryRenderer.js');
  assert.match(src, /import \{ sceneBridge \} from '\.\/lib\/theme-scene\/scene-bridge\.js'/);
  assert.match(src, /system\.hueOffset \+ sceneHueShift \+ index/);
  assert.match(src, /const sceneHueShift = readSceneHueShift\(\);/);
});

test('ox.jsx drops no existing prop and adds sceneMode with default off', () => {
  const src = read('ox.jsx');
  const signature = src.split('\n').find((line) => line.startsWith('export default function App('));
  assert.ok(signature, 'App signature line found');
  for (const prop of ['params', 'liveParamsRef', 'backgroundColor', 'onReady', 'snapRef', 'scatterRef', 'silhouetteRef', 'viewResetRef', 'pointerInfluenceScale', 'enableDiffusion']) {
    assert.match(signature, new RegExp(`\\b${prop}\\b`), prop);
  }
  assert.match(signature, /sceneMode = 'off'/);
  assert.match(src, /export function createSilhouetteBuffer/);
});
