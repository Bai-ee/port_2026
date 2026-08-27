// Cloud & Water — an intentionally bold atmospheric catalogue: recognisable
// cloud banks and controlled water systems, not a faint texture treatment.

import { mulberry32 } from '../../elements/randomize.js';

export const CLOUD_WATER_DIRECTIONS = [
  { id: 'cloudbank', label: 'Cloudbank', colors: ['#75a7c7', '#e9f4f6', '#c7dfeb', '#37617f', '#193b59'] },
  { id: 'storm-front', label: 'Storm Front', colors: ['#506b85', '#d6d9d8', '#94a4b0', '#263a52', '#122238'] },
  { id: 'tidal-lines', label: 'Tidal Lines', colors: ['#d9e8e5', '#8fc5cb', '#387a91', '#1e526d', '#15344f'] },
  { id: 'deep-current', label: 'Deep Current', colors: ['#0d2e4a', '#1b5b79', '#46a0b0', '#b7dde0', '#e7eee4'] },
];

const palettes = CLOUD_WATER_DIRECTIONS.map((direction) => ({ id: direction.id, label: direction.label, colors: direction.colors }));
const defaults = { paletteId: 'cloudbank', background: { color: '#75a7c7' }, seed: 23, params: { density: 0.58, scale: 1, composition: 0.5, texture: 0.22, artDirection: 0 } };
const schema = { params: {
  density: { min: 0, max: 1, step: 0.01, default: 0.58 }, scale: { min: 0.4, max: 2, step: 0.01, default: 1 }, composition: { min: 0, max: 1, step: 0.01, default: 0.5 }, texture: { min: 0, max: 1, step: 0.01, default: 0.22 }, artDirection: { min: 0, max: 3, step: 1, default: 0 },
} };
export function getCloudWaterDirection(value) { return CLOUD_WATER_DIRECTIONS[Math.max(0, Math.min(3, Math.round(Number(value) || 0)))]; }
function rgba(p, hex, a = 255) { const c = p.color(hex); return [p.red(c), p.green(c), p.blue(c), a]; }
function fill(p, hex, a) { p.fill(...rgba(p, hex, a)); }
function stroke(p, hex, a) { p.stroke(...rgba(p, hex, a)); }
function cloud(p, x, y, r, c, rand) { p.noStroke(); for (let i = 0; i < 9; i += 1) { fill(p, c[1], 172 + rand() * 72); p.circle(x + (rand() - .5) * r * 2.1, y + (rand() - .5) * r * .58, r * (.65 + rand() * .72)); } }
function render(p, ctx, recipe) {
  const { width: w, height: h } = ctx; const params = { ...defaults.params, ...(recipe.params || {}) }; const mode = Math.round(params.artDirection); const c = getCloudWaterDirection(mode).colors; const rand = mulberry32(recipe.seed >>> 0); const bg = (recipe.background && recipe.background.color) || c[0];
  p.background(bg); const r = Math.min(w, h) * (.09 + params.scale * .052);
  if (mode < 2) {
    p.noStroke(); fill(p, c[3], mode === 1 ? 135 : 64); p.rect(0, h * .66, w, h * .34);
    const rows = mode === 1 ? 3 : 2; for (let row = 0; row < rows; row += 1) for (let i = 0; i < Math.round(3 + params.density * 4); i += 1) cloud(p, w * (.12 + i / (3 + params.density * 4) * .76), h * (.25 + row * .22), r * (.9 + rand() * .65), c, rand);
  } else {
    p.noFill(); const rows = Math.round(12 + params.density * 16); for (let i = 0; i < rows; i += 1) { const y = h * (.14 + i / (rows + 2) * .74); stroke(p, c[(i % 3) + 1], 115 + (i % 2) * 55); p.strokeWeight(Math.max(1, r * .045)); p.beginShape(); for (let x = -r; x < w + r; x += r * .22) p.curveVertex(x, y + Math.sin(x / r * 1.6 + i * .55) * r * (.06 + params.composition * .08)); p.endShape(); }
    if (mode === 3) { fill(p, c[4], 95); p.noStroke(); p.circle(w * .7, h * .25, r * 2.5); }
  }
  p.noFill(); stroke(p, c[4], 105); p.strokeWeight(1); const m = Math.min(w, h) * .05; p.rect(m, m, w - m * 2, h - m * 2);
}
export default { id: 'cloud-water', version: 1, label: 'Cloud & Water', defaults, schema, palettes, directions: CLOUD_WATER_DIRECTIONS, render };
