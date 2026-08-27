// Editorial Fields — a second media-free print-art catalogue. Where Novel Art
// leans archival and illustrative, these directions are bolder spatial
// systems: florals, cloud studies, material texture, brutalist blocks and
// repeat patterns. Every mark is deterministic p5 geometry.

import { mulberry32 } from '../../elements/randomize.js';

export const FIELD_DIRECTIONS = [
  { id: 'flower-cascade', label: 'Flower Cascade', colors: ['#f4eee8', '#d95770', '#eea7ad', '#6c8969', '#302c3a'] },
  { id: 'cloud-atlas', label: 'Cloud Atlas', colors: ['#dcebf2', '#91bbd1', '#f6f3e8', '#687694', '#253750'] },
  { id: 'woven-texture', label: 'Woven Texture', colors: ['#e6dece', '#aa4b3b', '#d9a746', '#487366', '#2a3839'] },
  { id: 'brutalist-blocks', label: 'Brutalist Blocks', colors: ['#f2eee4', '#161616', '#ef3c34', '#f0bf22', '#2e65d8'] },
  { id: 'tessellated-pattern', label: 'Tessellated Pattern', colors: ['#e6e3dd', '#3c3d65', '#bb5d70', '#dfac4f', '#254f52'] },
  { id: 'soft-color-field', label: 'Soft Color Field', colors: ['#e9e5e0', '#bf8b9a', '#d6b06f', '#829da5', '#3a3b48'] },
];

const palettes = FIELD_DIRECTIONS.map((direction) => ({ id: direction.id, label: direction.label, colors: direction.colors }));
const defaults = { paletteId: 'flower-cascade', background: { color: '#f4eee8' }, seed: 7, params: { density: 0.55, scale: 1, composition: 0.5, texture: 0.42, artDirection: 0 } };
const schema = { params: {
  density: { min: 0, max: 1, step: 0.01, default: 0.55 },
  scale: { min: 0.4, max: 2, step: 0.01, default: 1 },
  composition: { min: 0, max: 1, step: 0.01, default: 0.5 },
  texture: { min: 0, max: 1, step: 0.01, default: 0.42 },
  artDirection: { min: 0, max: FIELD_DIRECTIONS.length - 1, step: 1, default: 0 },
} };

export function getFieldDirection(value) { return FIELD_DIRECTIONS[Math.max(0, Math.min(FIELD_DIRECTIONS.length - 1, Math.round(Number(value) || 0)))]; }
function rgba(p, hex, alpha = 255) { const c = p.color(hex); return [p.red(c), p.green(c), p.blue(c), alpha]; }
function fill(p, hex, alpha) { p.fill(...rgba(p, hex, alpha)); }
function stroke(p, hex, alpha) { p.stroke(...rgba(p, hex, alpha)); }
function flower(p, x, y, r, colors, rand) { p.push(); p.translate(x, y); p.noStroke(); const petals = 5 + Math.floor(rand() * 4); for (let i = 0; i < petals; i += 1) { p.rotate(p.TWO_PI / petals); fill(p, colors[1 + (i % 2)], 170); p.ellipse(r * .48, 0, r, r * .42); } fill(p, colors[4], 220); p.circle(0, 0, r * .32); p.pop(); }
function grain(p, w, h, amount) { p.noStroke(); const n = Math.round(500 + amount * 2800); for (let i = 0; i < n; i += 1) { p.fill(25, 25, 30, p.random(2, 12) * amount); p.circle(p.random(w), p.random(h), p.random(.3, 1.4)); } }
function render(p, ctx, recipe) {
  const { width: w, height: h } = ctx; const params = { ...defaults.params, ...(recipe.params || {}) };
  const direction = getFieldDirection(params.artDirection); const c = direction.colors; const rand = mulberry32(recipe.seed >>> 0); const mode = Math.round(params.artDirection);
  p.background((recipe.background && recipe.background.color) || c[0]); grain(p, w, h, params.texture);
  if (mode === 0) {
    const count = Math.round(9 + params.density * 20); for (let i = 0; i < count; i += 1) { const x = w * (.08 + rand() * .84); const y = h * (.08 + rand() * .84); const r = Math.min(w, h) * (.035 + rand() * .055) * params.scale; stroke(p, c[3], 135); p.strokeWeight(1); p.line(x, h * .96, x + (rand() - .5) * r, y); flower(p, x, y, r, c, rand); }
  } else if (mode === 1) {
    p.noStroke(); for (let i = 0; i < 28; i += 1) { fill(p, c[2], 16 + rand() * 40); const x = rand() * w; const y = rand() * h; p.ellipse(x, y, w * (.14 + rand() * .26), h * (.025 + rand() * .065)); } stroke(p, c[4], 80); p.strokeWeight(1); for (let y = h * .14; y < h * .9; y += h * .1) p.line(w * .12, y, w * .88, y);
  } else if (mode === 2) {
    const gap = Math.max(8, Math.min(w, h) * .024); for (let x = -w; x < w * 2; x += gap) { stroke(p, c[(Math.floor(x / gap) % 3 + 3) % 3 + 1], 95); p.strokeWeight(rand() * 1.6 + .5); p.line(x, 0, x + w * .45, h); } for (let y = 0; y < h; y += gap * 2) { stroke(p, c[4], 45); p.line(0, y, w, y); }
  } else if (mode === 3) {
    p.noStroke(); const n = Math.round(8 + params.density * 15); for (let i = 0; i < n; i += 1) { fill(p, c[(i % 3) + 1], 235); const x = rand() * w; const y = rand() * h; const bw = w * (.14 + rand() * .38); const bh = h * (.025 + rand() * .17); p.rect(x, y, bw, bh); } stroke(p, c[1], 210); p.strokeWeight(Math.max(2, w * .008)); p.line(w * .1, h * .13, w * .9, h * .13);
  } else if (mode === 4) {
    const s = Math.min(w, h) * (.065 + params.scale * .025); for (let x = -s; x < w + s; x += s) for (let y = -s; y < h + s; y += s) { const even = (Math.floor(x / s) + Math.floor(y / s)) % 2 === 0; p.noStroke(); fill(p, c[even ? 1 : 2], 175); p.push(); p.translate(x + s / 2, y + s / 2); p.rotate(even ? 0 : p.HALF_PI); p.rect(-s * .34, -s * .34, s * .68, s * .68); p.pop(); }
  } else {
    p.noStroke(); for (let i = 0; i < 18; i += 1) { fill(p, c[(i % 3) + 1], 35 + rand() * 45); p.circle(w * (.15 + rand() * .7), h * (.12 + rand() * .76), Math.min(w, h) * (.14 + rand() * .28)); } stroke(p, c[4], 65); p.strokeWeight(1); p.noFill(); p.rect(w * .08, h * .08, w * .84, h * .84);
  }
  p.noFill(); stroke(p, c[4], 92); p.strokeWeight(1); const m = Math.min(w, h) * .045; p.rect(m, m, w - m * 2, h - m * 2);
}

export default { id: 'editorial-fields', version: 1, label: 'Editorial Fields', defaults, schema, palettes, directions: FIELD_DIRECTIONS, render };
