// Graphic Patterns — deliberately bold, non-illustrative print systems.
// These directions are kept separate from the softer editorial catalogue so
// a designer can choose graphic, square-led cover art without altering any
// existing templates.

import { mulberry32 } from '../../elements/randomize.js';

export const GRAPHIC_DIRECTIONS = [
  { id: 'brutalist-poster', label: 'Brutalist Poster', colors: ['#f5f0e6', '#151515', '#ed3e31', '#f0c526', '#2354d8'] },
  { id: 'stacked-monoliths', label: 'Stacked Monoliths', colors: ['#e8e4dc', '#262625', '#7e2d47', '#c96534', '#416c77'] },
  { id: 'checker-geometry', label: 'Checker Geometry', colors: ['#f2eee7', '#18242d', '#ec553f', '#ddac37', '#e5dccc'] },
  { id: 'dot-matrix', label: 'Dot Matrix', colors: ['#f6f2ec', '#202020', '#dc3652', '#3c81a4', '#e7af35'] },
  { id: 'signal-shapes', label: 'Signal Shapes', colors: ['#f0ece5', '#1c1c1e', '#f25239', '#f1c93d', '#5e5fd5'] },
  { id: 'offset-grid', label: 'Offset Grid', colors: ['#e9e7e0', '#263034', '#ae3450', '#d58138', '#628368'] },
];

const palettes = GRAPHIC_DIRECTIONS.map((direction) => ({ id: direction.id, label: direction.label, colors: direction.colors }));
const defaults = { paletteId: 'brutalist-poster', background: { color: '#f5f0e6' }, seed: 11, params: { density: 0.58, scale: 1, composition: 0.5, texture: 0.18, artDirection: 0 } };
const schema = { params: {
  density: { min: 0, max: 1, step: 0.01, default: 0.58 },
  scale: { min: 0.4, max: 2, step: 0.01, default: 1 },
  composition: { min: 0, max: 1, step: 0.01, default: 0.5 },
  texture: { min: 0, max: 1, step: 0.01, default: 0.18 },
  artDirection: { min: 0, max: GRAPHIC_DIRECTIONS.length - 1, step: 1, default: 0 },
} };

export function getGraphicDirection(value) { return GRAPHIC_DIRECTIONS[Math.max(0, Math.min(GRAPHIC_DIRECTIONS.length - 1, Math.round(Number(value) || 0)))]; }
function rgba(p, hex, alpha = 255) { const color = p.color(hex); return [p.red(color), p.green(color), p.blue(color), alpha]; }
function fill(p, hex, alpha = 255) { p.fill(...rgba(p, hex, alpha)); }
function stroke(p, hex, alpha = 255) { p.stroke(...rgba(p, hex, alpha)); }
function mark(p, w, h, colors, amount) { p.noStroke(); p.fill(...rgba(p, colors[1], 20 + amount * 28)); for (let i = 0; i < 150 + amount * 800; i += 1) p.rect(p.random(w), p.random(h), 1, 1); }

function render(p, ctx, recipe) {
  const { width: w, height: h } = ctx; const params = { ...defaults.params, ...(recipe.params || {}) };
  const mode = Math.round(params.artDirection); const colors = getGraphicDirection(mode).colors; const rand = mulberry32(recipe.seed >>> 0);
  p.background((recipe.background && recipe.background.color) || colors[0]); mark(p, w, h, colors, params.texture); p.noStroke();
  const unit = Math.min(w, h) * (.07 + params.scale * .026); const centerX = w * (.35 + params.composition * .3);
  if (mode === 0) {
    fill(p, colors[1]); p.rect(w * .1, h * .1, w * .8, h * .11); p.rect(w * .1, h * .78, w * .8, h * .11);
    const cols = 3; const rows = Math.round(2 + params.density * 2);
    for (let row = 0; row < rows; row += 1) for (let col = 0; col < cols; col += 1) { const bw = unit * (1.2 + ((row + col) % 2) * .65); const bh = unit * (1 + ((row * 2 + col) % 2) * .5); fill(p, colors[(row + col) % 3 + 2]); p.rect(w * (.18 + col * .25) - bw / 2, h * (.3 + row * .16) - bh / 2, bw, bh); }
    fill(p, colors[1]); p.rect(w * .12, h * .13, w * .16, h * .035);
  } else if (mode === 1) {
    for (let i = 0; i < 8; i += 1) { const width = w * (.25 + (i % 3) * .11); const height = h * (.045 + (i % 2) * .055); fill(p, colors[(i % 3) + 1]); p.rect(centerX - width / 2 + (i % 2 ? unit * .32 : -unit * .32), h * (.12 + i * .095), width, height); }
    stroke(p, colors[1]); p.strokeWeight(unit * .1); p.line(w * .16, h * .1, w * .16, h * .9);
  } else if (mode === 2) {
    const size = Math.max(unit, Math.min(w, h) * .11); for (let x = w * .11; x < w * .9; x += size) for (let y = h * .12; y < h * .88; y += size) { const cell = (Math.floor(x / size) + Math.floor(y / size)) % 2; fill(p, colors[cell ? 1 : 3]); p.rect(x, y, size * .94, size * .94); if (cell && rand() > .57) { fill(p, colors[2]); p.circle(x + size * .47, y + size * .47, size * .38); } }
  } else if (mode === 3) {
    const gap = Math.max(9, unit * .28); for (let x = w * .1; x < w * .9; x += gap) for (let y = h * .1; y < h * .9; y += gap) { const r = gap * (.12 + rand() * .38) * (1 + params.density); fill(p, colors[(Math.floor(x / gap) + Math.floor(y / gap)) % 3 + 1]); p.circle(x, y, r); }
    fill(p, colors[1]); p.rect(w * .12, h * .46, w * .76, h * .08);
  } else if (mode === 4) {
    fill(p, colors[1]); p.circle(w * .5, h * .5, Math.min(w, h) * .66); for (let i = 0; i < 12; i += 1) { const a = i / 12 * p.TWO_PI; fill(p, colors[(i % 3) + 2]); p.push(); p.translate(w * .5 + Math.cos(a) * unit * 2.1, h * .5 + Math.sin(a) * unit * 2.1); p.rotate(a); p.rect(-unit * 1.15, -unit * .24, unit * 2.3, unit * .48); p.pop(); } fill(p, colors[0]); p.circle(w * .5, h * .5, unit * 1.65);
  } else {
    const size = Math.max(unit, Math.min(w, h) * .09); for (let row = 0; row < 8; row += 1) { const shift = (row % 2 ? .5 : 0) * size; for (let x = w * .08 - shift; x < w * .95; x += size) { fill(p, colors[(row + Math.floor(x / size)) % 3 + 1], 225); p.rect(x, h * (.12 + row * .095), size * .84, size * .84); } } stroke(p, colors[1], 175); p.strokeWeight(2); p.line(w * .1, h * .08, w * .9, h * .92);
  }
  p.noFill(); stroke(p, colors[1], 160); p.strokeWeight(Math.max(1, unit * .025)); p.rect(w * .055, h * .055, w * .89, h * .89);
}

export default { id: 'graphic-patterns', version: 1, label: 'Graphic Patterns', defaults, schema, palettes, directions: GRAPHIC_DIRECTIONS, render };
