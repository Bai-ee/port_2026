// Botanical Weave — dark branching paths with clustered stamped blossoms.
// Linework-driven botanical illustration study on a rich, dark ground; see
// docs/plans/PAINT_STUDIO_CLAUDE_HANDOFF.md "Visual standard".
//
// Determinism: `computeWeaveLayout` is a plain, pure function (no p5, no
// Math.random) seeded with `mulberry32` — it decides branch origins/angles
// and which branch+position each blossom stamp attaches to. `render()`
// samples the actual noise-wobbled branch curve using p5's own seeded
// `p.noise()` (seeded by the renderer adapter before every call), which is
// the "how it actually bends" decision, not a serialized layout decision.

import { mulberry32 } from '../../elements/randomize.js';

const PALETTES = [
  { id: 'midnight-ink', label: 'Midnight Ink', colors: ['#151a1f', '#3c5a4e', '#7c9a7c', '#c9b48f', '#e8ded0'] },
  { id: 'deep-forest', label: 'Deep Forest', colors: ['#12160f', '#2f4a33', '#5c8060', '#9db27a', '#e6e2c3'] },
  { id: 'ink-plum', label: 'Ink Plum', colors: ['#1a1420', '#3a2740', '#6b4a63', '#b98a7a', '#e9d9c9'] },
  { id: 'dusk-indigo', label: 'Dusk Indigo', colors: ['#10141f', '#243257', '#4d6a8a', '#9fb6c4', '#e7e3d3'] },
];

const DEFAULTS = {
  paletteId: 'midnight-ink',
  background: { color: '#151a1f' },
  seed: 1,
  params: {
    density: 0.5,
    scale: 1,
    composition: 0.4,
    texture: 0.3,
    branchDensity: 0.45,
    blossomSize: 0.45,
    weaveTightness: 0.55,
  },
};

const SCHEMA = {
  params: {
    density: { min: 0, max: 1, step: 0.01, default: 0.5 },
    scale: { min: 0.4, max: 2, step: 0.01, default: 1 },
    composition: { min: 0, max: 1, step: 0.01, default: 0.4 },
    texture: { min: 0, max: 1, step: 0.01, default: 0.3 },
    branchDensity: { min: 0, max: 1, step: 0.01, default: 0.45 },
    blossomSize: { min: 0, max: 1, step: 0.01, default: 0.45 },
    weaveTightness: { min: 0, max: 1, step: 0.01, default: 0.55 },
  },
};

// composition: 0 = branch origins pulled toward a single anchor point on the
// perimeter (converging composition), 1 = origins spread evenly around the
// full perimeter.
function perimeterPoint(t, width, height, composition) {
  const perim = 2 * (width + height);
  const anchor = 0.12; // fixed anchor point (fraction of perimeter) when composition is low
  const spreadT = anchor + (t - anchor) * composition;
  const wrapped = ((spreadT % 1) + 1) % 1;
  const d = wrapped * perim;
  if (d < width) return { x: d, y: 0 };
  if (d < width + height) return { x: width, y: d - width };
  if (d < 2 * width + height) return { x: width - (d - width - height), y: height };
  return { x: 0, y: height - (d - 2 * width - height) };
}

// Pure, testable layout: branch structure + which branch/position each
// blossom stamp is attached to. No p5 calls here.
export function computeWeaveLayout(rand, params, width, height) {
  const density = params.density ?? DEFAULTS.params.density;
  const scale = params.scale ?? DEFAULTS.params.scale;
  const composition = params.composition ?? DEFAULTS.params.composition;
  const branchDensity = params.branchDensity ?? DEFAULTS.params.branchDensity;
  const blossomSize = params.blossomSize ?? DEFAULTS.params.blossomSize;
  const weaveTightness = params.weaveTightness ?? DEFAULTS.params.weaveTightness;
  const minSide = Math.min(width, height);

  const branchCount = Math.round(2 + branchDensity * 8); // 2..10
  const branches = [];
  for (let i = 0; i < branchCount; i += 1) {
    // Even perimeter intervals keep the stems legible as a single woven
    // arrangement. The seed supplies a restrained phase and small variance,
    // never a pile-up of unrelated origins.
    const origin = perimeterPoint((i + 0.5) / branchCount + (rand() - 0.5) * 0.055, width, height, composition);
    const towardCenterAngle = Math.atan2(height / 2 - origin.y, width / 2 - origin.x);
    branches.push({
      originX: origin.x,
      originY: origin.y,
      angle: towardCenterAngle + (rand() - 0.5) * 1.1,
      length: minSide * (0.5 + rand() * 0.55),
      curl: 0.3 + weaveTightness * 1.4,
      thickness: (1 + rand() * 1.4) * scale,
    });
  }

  const blossomCount = Math.round(10 + density * 50); // 10..60
  const blossoms = [];
  for (let i = 0; i < blossomCount; i += 1) {
    const branchIndex = i % branches.length;
    const layer = Math.floor(i / branches.length);
    const layers = Math.ceil(blossomCount / branches.length);
    blossoms.push({
      branchIndex,
      // A paced progression from the edge into the focal field yields
      // clusters with breathing room rather than accidental collisions.
      t: Math.min(0.9, 0.16 + ((layer + 0.5) / layers) * 0.68 + (rand() - 0.5) * 0.075),
      r: minSide * 0.016 * scale * (0.55 + blossomSize),
      rotation: rand() * Math.PI * 2,
      petalCount: 4 + Math.floor(rand() * 4), // 4..7
      colorIndex: Math.floor(rand() * 12),
      jitter: (rand() - 0.5) * minSide * 0.012,
    });
  }

  return { branches, blossoms };
}

function computeBranchPath(p, branch, steps) {
  const dirX = Math.cos(branch.angle);
  const dirY = Math.sin(branch.angle);
  const perpX = -dirY;
  const perpY = dirX;
  const points = [];
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    const forward = t * branch.length;
    const n = p.noise(branch.originX * 0.004 + s * 0.12, branch.originY * 0.004 + s * 0.07) - 0.5;
    const wobble = n * branch.curl * branch.length * 0.12;
    points.push({
      x: branch.originX + dirX * forward + perpX * wobble,
      y: branch.originY + dirY * forward + perpY * wobble,
    });
  }
  return points;
}

function drawBranchLine(p, points, branch, palette) {
  const inkColor = p.color(palette.colors[1]);
  p.noFill();
  p.stroke(p.red(inkColor), p.green(inkColor), p.blue(inkColor), 210);
  p.strokeWeight(branch.thickness);
  p.beginShape();
  points.forEach((pt, i) => {
    p.curveVertex(pt.x, pt.y);
    if (i === 0 || i === points.length - 1) p.curveVertex(pt.x, pt.y);
  });
  p.endShape();
}

function drawBlossomStamp(p, x, y, bloom, palette) {
  const { r, rotation, petalCount, colorIndex } = bloom;
  const petalHex = palette.colors[(colorIndex + 2) % palette.colors.length];
  const petalCol = p.color(petalHex);
  const centreHex = palette.colors[(colorIndex + 4) % palette.colors.length];
  const centreCol = p.color(centreHex);
  p.push();
  p.translate(x, y);
  p.rotate(rotation);
  p.noStroke();
  for (let i = 0; i < petalCount; i += 1) {
    const angle = (i / petalCount) * Math.PI * 2;
    const px = Math.cos(angle) * r * 0.9;
    const py = Math.sin(angle) * r * 0.9;
    p.fill(p.red(petalCol), p.green(petalCol), p.blue(petalCol), 185);
    p.ellipse(px, py, r * 0.95, r * 0.55);
  }
  p.fill(p.red(centreCol), p.green(centreCol), p.blue(centreCol), 215);
  p.circle(0, 0, r * 0.75);
  p.pop();
}

function paintGrain(p, width, height, intensity) {
  if (intensity <= 0) return;
  const count = Math.round(250 + intensity * 900);
  for (let i = 0; i < count; i += 1) {
    const x = p.random(width);
    const y = p.random(height);
    p.noStroke();
    p.fill(255, 255, 255, p.random(3, 9) * intensity);
    p.circle(x, y, p.random(0.5, 1.4));
  }
}

function render(p, ctx, recipe) {
  const { width, height } = ctx;
  const params = { ...DEFAULTS.params, ...(recipe.params || {}) };
  const palette = PALETTES.find((entry) => entry.id === recipe.paletteId) || PALETTES[0];
  const bgColor = (recipe.background && recipe.background.color) || DEFAULTS.background.color;

  p.background(bgColor);

  const layout = computeWeaveLayout(mulberry32(recipe.seed >>> 0), params, width, height);
  const steps = 40;
  const paths = layout.branches.map((branch) => computeBranchPath(p, branch, steps));

  paintGrain(p, width, height, params.texture);

  paths.forEach((points, i) => drawBranchLine(p, points, layout.branches[i], palette));

  layout.blossoms.forEach((bloom) => {
    const points = paths[bloom.branchIndex] || paths[0];
    if (!points || points.length === 0) return;
    const idx = Math.min(points.length - 1, Math.round(bloom.t * (points.length - 1)));
    const base = points[idx];
    drawBlossomStamp(p, base.x + bloom.jitter, base.y + bloom.jitter * 0.6, bloom, palette);
  });
}

export default {
  id: 'botanical-weave',
  version: 1,
  label: 'Botanical Weave',
  defaults: DEFAULTS,
  schema: SCHEMA,
  palettes: PALETTES,
  render,
};
