// Watercolour Bloom — translucent petal layers, ink stem/vein details, soft
// pigment bleed. Quiet, paper-toned botanical study; see
// docs/plans/PAINT_STUDIO_CLAUDE_HANDOFF.md "Visual standard".
//
// Determinism: `computeBloomLayout` is a plain, pure function (no p5, no
// Math.random) seeded with `mulberry32` so it is independently unit-testable
// — it decides WHAT to draw (positions/counts/base sizes). `render()` uses
// p5's own seeded `p.random()`/`p.noise()` (seeded by the renderer adapter
// via p.randomSeed()/p.noiseSeed() before every call) for the organic
// per-vertex wobble that happens while actually drawing. Neither path ever
// calls the global Math.random().

import { mulberry32 } from '../../elements/randomize.js';

const PALETTES = [
  { id: 'blush-paper', label: 'Blush Paper', colors: ['#f7ede4', '#e8a9b8', '#d46a8a', '#c98a63', '#8a5a4a'] },
  { id: 'sage-mist', label: 'Sage Mist', colors: ['#f2efe6', '#a9c2ab', '#6f8f74', '#c9b79c', '#4f6350'] },
  { id: 'dawn-coral', label: 'Dawn Coral', colors: ['#fbeee2', '#f0a898', '#e07a5f', '#f4c095', '#8c5b4a'] },
  { id: 'indigo-wash', label: 'Indigo Wash', colors: ['#f3efe9', '#9db4c9', '#5d7ea3', '#c9a6b3', '#3d4f66'] },
  { id: 'antique-rose', label: 'Antique Rose', colors: ['#f6ece2', '#c98a93', '#8f4a56', '#d9a56b', '#5c3a3f'] },
];

const DEFAULTS = {
  paletteId: 'blush-paper',
  background: { color: '#f7ede4' },
  seed: 1,
  params: {
    density: 0.5,
    scale: 1,
    composition: 0.45,
    texture: 0.35,
    bloomSize: 0.55,
    bleed: 0.45,
    stemDensity: 0.4,
  },
};

const SCHEMA = {
  params: {
    density: { min: 0, max: 1, step: 0.01, default: 0.5 },
    scale: { min: 0.4, max: 2, step: 0.01, default: 1 },
    composition: { min: 0, max: 1, step: 0.01, default: 0.45 },
    texture: { min: 0, max: 1, step: 0.01, default: 0.35 },
    bloomSize: { min: 0, max: 1, step: 0.01, default: 0.55 },
    bleed: { min: 0, max: 1, step: 0.01, default: 0.45 },
    stemDensity: { min: 0, max: 1, step: 0.01, default: 0.4 },
  },
};

// Pure, testable layout: given a seeded rand() in [0,1), decide bloom
// positions/sizes/rotations and stem origins. No p5 calls here.
export function computeBloomLayout(rand, params, width, height) {
  const density = params.density ?? DEFAULTS.params.density;
  const scale = params.scale ?? DEFAULTS.params.scale;
  const composition = params.composition ?? DEFAULTS.params.composition;
  const bloomSize = params.bloomSize ?? DEFAULTS.params.bloomSize;
  const stemDensity = params.stemDensity ?? DEFAULTS.params.stemDensity;

  const minSide = Math.min(width, height);
  const bloomCount = Math.round(6 + density * 18); // 6..24 blooms
  const baseR = minSide * 0.07 * scale * (0.55 + bloomSize);
  // composition: 0 = tight central cluster, 1 = scattered across the frame
  const spread = 0.22 + composition * 0.7;

  const blooms = [];
  for (let i = 0; i < bloomCount; i += 1) {
    blooms.push({
      x: width * (0.5 + (rand() - 0.5) * spread),
      y: height * (0.5 + (rand() - 0.5) * spread),
      r: baseR * (0.6 + rand() * 0.8),
      rotation: rand() * Math.PI * 2,
      petalCount: 5 + Math.floor(rand() * 3), // 5..7
      colorIndex: Math.floor(rand() * 12),
      alpha: 0.32 + rand() * 0.3,
    });
  }

  const stemCount = Math.round(3 + stemDensity * 9); // 3..12
  const stems = [];
  for (let i = 0; i < stemCount; i += 1) {
    stems.push({
      x: rand() * width,
      yTop: height * (0.08 + rand() * 0.3),
      yBottom: height * (0.68 + rand() * 0.32),
      sway: (rand() - 0.5) * width * 0.06,
    });
  }

  return { blooms, stems };
}

function paintPaperGrain(p, width, height, intensity) {
  if (intensity <= 0) return;
  const count = Math.round(300 + intensity * 1200);
  for (let i = 0; i < count; i += 1) {
    const x = p.random(width);
    const y = p.random(height);
    const shade = p.random(1) > 0.55 ? 255 : 20;
    p.noStroke();
    p.fill(shade, shade, shade, p.random(3, 12) * intensity);
    p.circle(x, y, p.random(0.6, 1.8));
  }
}

function drawStems(p, stems, palette) {
  const inkColor = p.color(palette.colors[palette.colors.length - 1]);
  p.noFill();
  p.stroke(p.red(inkColor), p.green(inkColor), p.blue(inkColor), 110);
  p.strokeWeight(1.1);
  stems.forEach((stem, si) => {
    const steps = 22;
    p.beginShape();
    for (let s = -1; s <= steps + 1; s += 1) {
      const clamped = Math.min(steps, Math.max(0, s));
      const t = clamped / steps;
      const y = p.lerp(stem.yTop, stem.yBottom, t);
      const n = p.noise(stem.x * 0.01, y * 0.02, si * 11.3) - 0.5;
      const x = stem.x + n * stem.sway * 2;
      p.curveVertex(x, y);
    }
    p.endShape();
    // a couple of small leaf marks along the stem
    const leafT = 0.35 + p.noise(si * 3.7) * 0.3;
    const ly = p.lerp(stem.yTop, stem.yBottom, leafT);
    const lx = stem.x + (p.noise(stem.x * 0.01, ly * 0.02, si * 11.3) - 0.5) * stem.sway * 2;
    p.push();
    p.translate(lx, ly);
    p.rotate(p.noise(si * 5.2) * Math.PI - Math.PI / 2);
    p.fill(p.red(inkColor), p.green(inkColor), p.blue(inkColor), 70);
    p.noStroke();
    p.ellipse(0, 0, 14, 5);
    p.pop();
  });
}

function drawPetalCluster(p, r, petalCount, seedOffset) {
  for (let i = 0; i < petalCount; i += 1) {
    const angle = (i / petalCount) * Math.PI * 2;
    const wobble = (p.noise(i * 3.1 + seedOffset, seedOffset * 0.7) - 0.5) * 0.5;
    p.push();
    p.rotate(angle);
    p.beginShape();
    p.vertex(0, 0);
    p.bezierVertex(r * (0.5 + wobble), -r * 0.35, r * (0.9 + wobble), -r * 0.15, r, 0);
    p.bezierVertex(r * (0.9 + wobble), r * 0.15, r * (0.5 + wobble), r * 0.35, 0, 0);
    p.endShape(p.CLOSE);
    p.pop();
  }
}

function drawBloom(p, bloom, palette, params) {
  const bleed = params.bleed ?? DEFAULTS.params.bleed;
  const layers = 3 + Math.round(bleed * 3); // 3..6 translucent layers
  p.push();
  p.translate(bloom.x, bloom.y);
  p.rotate(bloom.rotation);
  p.noStroke();
  for (let layer = 0; layer < layers; layer += 1) {
    const t = layers > 1 ? layer / (layers - 1) : 0;
    const layerR = bloom.r * (1 + t * bleed * 0.9);
    const layerAlpha = bloom.alpha * (1 - t * 0.75) * 255 * 0.5;
    const hex = palette.colors[(bloom.colorIndex + layer) % palette.colors.length];
    const col = p.color(hex);
    p.fill(p.red(col), p.green(col), p.blue(col), layerAlpha);
    drawPetalCluster(p, layerR, bloom.petalCount, layer + bloom.colorIndex);
  }
  // a small deeper-pigment centre
  const centreHex = palette.colors[(bloom.colorIndex + layers) % palette.colors.length];
  const centreCol = p.color(centreHex);
  p.fill(p.red(centreCol), p.green(centreCol), p.blue(centreCol), 160);
  p.circle(0, 0, bloom.r * 0.22);
  p.pop();
}

function render(p, ctx, recipe) {
  const { width, height } = ctx;
  const params = { ...DEFAULTS.params, ...(recipe.params || {}) };
  const palette = PALETTES.find((entry) => entry.id === recipe.paletteId) || PALETTES[0];
  const bgColor = (recipe.background && recipe.background.color) || DEFAULTS.background.color;

  p.background(bgColor);
  paintPaperGrain(p, width, height, params.texture);

  const layout = computeBloomLayout(mulberry32(recipe.seed >>> 0), params, width, height);
  drawStems(p, layout.stems, palette);
  layout.blooms.forEach((bloom) => drawBloom(p, bloom, palette, params));
}

export default {
  id: 'watercolour-bloom',
  version: 1,
  label: 'Watercolour Bloom',
  defaults: DEFAULTS,
  schema: SCHEMA,
  palettes: PALETTES,
  render,
};
