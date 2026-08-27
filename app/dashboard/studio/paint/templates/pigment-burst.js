// Pigment Burst — a central pigment mass with a soft falloff particle field
// and a restrained confetti scatter. Bolder, saturated pigment tones but
// still controlled — not neon, not a noisy full-frame scatter; see
// docs/plans/PAINT_STUDIO_CLAUDE_HANDOFF.md "Visual standard".
//
// Determinism: `computeBurstLayout` is a plain, pure function (no p5, no
// Math.random) seeded with `mulberry32` — it decides the center, core-blob
// placement, and every particle's/confetti mark's polar position + size +
// color index. `render()` adds a small p5-`p.noise()`-driven wobble while
// actually drawing each particle (seeded by the renderer adapter before
// every call), which does not need to be part of the serialized layout.

import { mulberry32 } from '../../elements/randomize.js';

const PALETTES = [
  { id: 'cinnabar-ink', label: 'Cinnabar Ink', colors: ['#f2ece2', '#d94f3d', '#e08a3c', '#2e6b6b', '#1c2b3a'] },
  { id: 'plum-citrus', label: 'Plum Citrus', colors: ['#f4ede6', '#8a2f5e', '#e0983c', '#3c7a5e', '#241a2e'] },
  { id: 'cobalt-ember', label: 'Cobalt Ember', colors: ['#f0ede5', '#2453a6', '#e0562f', '#f0b13e', '#182238'] },
  { id: 'berry-gold', label: 'Berry Gold', colors: ['#f5eee3', '#b23a5b', '#d9a441', '#3f5d4e', '#241c1a'] },
];

const DEFAULTS = {
  paletteId: 'cinnabar-ink',
  background: { color: '#f2ece2' },
  seed: 1,
  params: {
    density: 0.5,
    scale: 1,
    composition: 0.35,
    texture: 0.3,
    burstSpread: 0.55,
    particleCount: 0.5,
    confettiAmount: 0.25,
  },
};

const SCHEMA = {
  params: {
    density: { min: 0, max: 1, step: 0.01, default: 0.5 },
    scale: { min: 0.4, max: 2, step: 0.01, default: 1 },
    composition: { min: 0, max: 1, step: 0.01, default: 0.35 },
    texture: { min: 0, max: 1, step: 0.01, default: 0.3 },
    burstSpread: { min: 0, max: 1, step: 0.01, default: 0.55 },
    particleCount: { min: 0, max: 1, step: 0.01, default: 0.5 },
    confettiAmount: { min: 0, max: 1, step: 0.01, default: 0.25 },
  },
};

// Hard performance ceilings — protect render time at the largest export
// sizes (2560x1440 / 2048x2048 / 1170x2532) regardless of what the
// particleCount/confettiAmount params (0..1) are dialed to.
const PARTICLE_CEILING = 550;
const CONFETTI_CEILING = 90;

// Pure, testable layout: center + core-blob placement + every particle's and
// confetti mark's polar position/size/color index. No p5 calls here.
export function computeBurstLayout(rand, params, width, height) {
  const density = params.density ?? DEFAULTS.params.density;
  const scale = params.scale ?? DEFAULTS.params.scale;
  const composition = params.composition ?? DEFAULTS.params.composition;
  const burstSpread = params.burstSpread ?? DEFAULTS.params.burstSpread;
  const particleCount = params.particleCount ?? DEFAULTS.params.particleCount;
  const confettiAmount = params.confettiAmount ?? DEFAULTS.params.confettiAmount;
  const minSide = Math.min(width, height);

  // composition: 0 = burst centered, 1 = burst offset toward a frame edge
  const center = {
    // Retain a composed, editorial centre of gravity. Composition creates a
    // gentle, intentional offset — never a burst stranded in a corner.
    x: width * (0.5 + (rand() - 0.5) * composition * 0.24),
    y: height * (0.5 + (rand() - 0.5) * composition * 0.2),
  };

  const baseR = minSide * 0.12 * scale;
  const coreCount = 4 + Math.floor(density * 6); // 4..10
  const coreBlobs = [];
  for (let i = 0; i < coreCount; i += 1) {
    coreBlobs.push({
      angle: (i / coreCount) * Math.PI * 2 + (rand() - 0.5) * 0.34,
      dist: baseR * (0.11 + (i % 3) * 0.11 + rand() * 0.08),
      r: baseR * (0.5 + rand() * 0.7),
      colorIndex: Math.floor(rand() * 12),
      alpha: 0.5 + rand() * 0.3,
    });
  }

  const particleTotal = Math.round(
    Math.min(PARTICLE_CEILING, 60 + particleCount * 500 * (0.5 + density * 0.5))
  );
  const spreadR = minSide * (0.18 + burstSpread * 0.55);
  const particles = [];
  for (let i = 0; i < particleTotal; i += 1) {
    const falloff = Math.pow((i + rand()) / particleTotal, 1.55); // paced rings, soft long tail
    particles.push({
      angle: i * 2.399963229728653 + (rand() - 0.5) * 0.3,
      dist: falloff * spreadR,
      r: (2 + rand() * 6) * scale,
      colorIndex: Math.floor(rand() * 12),
      alpha: Math.max(0.05, 0.4 * (1 - falloff)),
    });
  }

  const confettiTotal = Math.round(Math.min(CONFETTI_CEILING, confettiAmount * CONFETTI_CEILING));
  const confetti = [];
  for (let i = 0; i < confettiTotal; i += 1) {
    confetti.push({
      angle: i * 2.399963229728653 + (rand() - 0.5) * 0.28,
      dist: spreadR * (0.58 + rand() * 0.38),
      size: (2 + rand() * 4) * scale,
      rotation: rand() * Math.PI * 2,
      colorIndex: Math.floor(rand() * 12),
    });
  }

  return { center, coreBlobs, particles, confetti };
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

function drawSoftBlob(p, x, y, r) {
  p.push();
  p.translate(x, y);
  p.beginShape();
  const steps = 14;
  for (let i = 0; i <= steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    const n = p.noise(Math.cos(a) * 0.6 + 5, Math.sin(a) * 0.6 + 5);
    const rr = r * (0.75 + n * 0.5);
    p.curveVertex(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  p.endShape(p.CLOSE);
  p.pop();
}

function render(p, ctx, recipe) {
  const { width, height } = ctx;
  const params = { ...DEFAULTS.params, ...(recipe.params || {}) };
  const palette = PALETTES.find((entry) => entry.id === recipe.paletteId) || PALETTES[0];
  const bgColor = (recipe.background && recipe.background.color) || DEFAULTS.background.color;

  p.background(bgColor);
  paintPaperGrain(p, width, height, params.texture);

  const layout = computeBurstLayout(mulberry32(recipe.seed >>> 0), params, width, height);
  const { center } = layout;

  p.noStroke();

  layout.coreBlobs.forEach((blob) => {
    const bx = center.x + Math.cos(blob.angle) * blob.dist;
    const by = center.y + Math.sin(blob.angle) * blob.dist;
    const col = p.color(palette.colors[blob.colorIndex % palette.colors.length]);
    p.fill(p.red(col), p.green(col), p.blue(col), blob.alpha * 255 * 0.55);
    drawSoftBlob(p, bx, by, blob.r);
  });

  layout.particles.forEach((particle) => {
    const wobble = (p.noise(particle.angle * 3.1, particle.dist * 0.01) - 0.5) * 20;
    const px = center.x + Math.cos(particle.angle) * particle.dist + wobble;
    const py = center.y + Math.sin(particle.angle) * particle.dist + wobble;
    const col = p.color(palette.colors[particle.colorIndex % palette.colors.length]);
    p.fill(p.red(col), p.green(col), p.blue(col), particle.alpha * 255);
    p.circle(px, py, particle.r);
  });

  layout.confetti.forEach((mark) => {
    const col = p.color(palette.colors[mark.colorIndex % palette.colors.length]);
    p.push();
    p.translate(center.x + Math.cos(mark.angle) * mark.dist, center.y + Math.sin(mark.angle) * mark.dist);
    p.rotate(mark.rotation);
    p.rectMode(p.CENTER);
    p.fill(p.red(col), p.green(col), p.blue(col), 150);
    p.rect(0, 0, mark.size, mark.size * 0.4);
    p.pop();
  });
}

export default {
  id: 'pigment-burst',
  version: 1,
  label: 'Pigment Burst',
  defaults: DEFAULTS,
  schema: SCHEMA,
  palettes: PALETTES,
  render,
};
