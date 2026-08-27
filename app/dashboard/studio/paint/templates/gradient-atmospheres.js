// Gradient Atmospheres — a dedicated gradient and cloud catalogue. It is
// intentionally independent from illustration and pattern templates, giving
// Randomize an obvious soft, expansive visual mode.

import { mulberry32 } from '../../elements/randomize.js';

export const ATMOSPHERE_DIRECTIONS = [
  { id: 'cumulus-clouds', label: 'Cumulus Clouds', colors: ['#9fc7e4', '#eff6fb', '#fff3db', '#527b9e', '#273b5b'] },
  { id: 'sunset-fog', label: 'Sunset Fog', colors: ['#f9b99c', '#f6deac', '#d980a1', '#514777', '#342d4d'] },
  { id: 'aurora-wash', label: 'Aurora Wash', colors: ['#0c2440', '#276f8a', '#6fc7a5', '#c9e76c', '#f1f6cf'] },
  { id: 'violet-horizon', label: 'Violet Horizon', colors: ['#302a60', '#7865b8', '#d3a5d5', '#f0c9b6', '#fbebc7'] },
  { id: 'citrus-sun', label: 'Citrus Sun', colors: ['#ffe6a8', '#f8bd43', '#ed7147', '#c94667', '#572f55'] },
  { id: 'ink-bloom', label: 'Ink Bloom', colors: ['#e9edf2', '#8ba7c1', '#536f9e', '#2e3f75', '#192346'] },
];

const palettes = ATMOSPHERE_DIRECTIONS.map((direction) => ({ id: direction.id, label: direction.label, colors: direction.colors }));
const defaults = { paletteId: 'cumulus-clouds', background: { color: '#9fc7e4' }, seed: 17, params: { density: 0.58, scale: 1, composition: 0.5, texture: 0.25, artDirection: 0 } };
const schema = { params: {
  density: { min: 0, max: 1, step: 0.01, default: 0.58 },
  scale: { min: 0.4, max: 2, step: 0.01, default: 1 },
  composition: { min: 0, max: 1, step: 0.01, default: 0.5 },
  texture: { min: 0, max: 1, step: 0.01, default: 0.25 },
  artDirection: { min: 0, max: ATMOSPHERE_DIRECTIONS.length - 1, step: 1, default: 0 },
} };

export function getAtmosphereDirection(value) { return ATMOSPHERE_DIRECTIONS[Math.max(0, Math.min(ATMOSPHERE_DIRECTIONS.length - 1, Math.round(Number(value) || 0)))]; }
function rgba(p, hex, alpha = 255) { const color = p.color(hex); return [p.red(color), p.green(color), p.blue(color), alpha]; }
function fill(p, hex, alpha = 255) { p.fill(...rgba(p, hex, alpha)); }
function stroke(p, hex, alpha = 255) { p.stroke(...rgba(p, hex, alpha)); }
function gradient(p, w, h, a, b, vertical = true) { const ctx = p.drawingContext; const g = vertical ? ctx.createLinearGradient(0, 0, 0, h) : ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, a); g.addColorStop(1, b); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
function cloud(p, x, y, r, colors, rand) { p.noStroke(); for (let i = 0; i < 8; i += 1) { fill(p, colors[1], 138 + rand() * 72); p.circle(x + (rand() - .5) * r * 1.8, y + (rand() - .5) * r * .55, r * (.55 + rand() * .62)); } }

function render(p, ctx, recipe) {
  const { width: w, height: h } = ctx; const params = { ...defaults.params, ...(recipe.params || {}) };
  const mode = Math.round(params.artDirection); const colors = getAtmosphereDirection(mode).colors; const rand = mulberry32(recipe.seed >>> 0); const r = Math.min(w, h) * (.09 + params.scale * .045);
  gradient(p, w, h, colors[0], colors[2], mode !== 4);
  if (mode === 0) {
    for (let i = 0; i < Math.round(7 + params.density * 13); i += 1) cloud(p, w * (.05 + rand() * .9), h * (.08 + rand() * .76), r * (.7 + rand() * 1.4), colors, rand);
    fill(p, colors[2], 55); p.rect(0, h * .73, w, h * .27);
  } else if (mode === 1) {
    for (let i = 0; i < 15; i += 1) { fill(p, colors[(i % 3) + 1], 17 + rand() * 35); p.ellipse(w * (.1 + rand() * .8), h * (.1 + rand() * .8), w * (.28 + rand() * .38), h * (.04 + rand() * .11)); }
  } else if (mode === 2) {
    p.noFill(); for (let i = 0; i < 18; i += 1) { stroke(p, colors[(i % 3) + 1], 45 + rand() * 60); p.strokeWeight(r * (.05 + rand() * .09)); p.arc(w * .5, h * .62, w * (.5 + i * .08), h * (.26 + i * .05), p.PI, p.TWO_PI); }
  } else if (mode === 3) {
    fill(p, colors[4], 130); p.rect(0, h * .58, w, h * .42); for (let i = 0; i < 8; i += 1) { stroke(p, colors[1], 50 + i * 13); p.strokeWeight(r * .04); p.line(0, h * (.2 + i * .08), w, h * (.42 + i * .07)); }
  } else if (mode === 4) {
    fill(p, colors[4], 120); p.circle(w * .5, h * .42, Math.min(w, h) * .45); for (let i = 0; i < 12; i += 1) { stroke(p, colors[1], 65); p.strokeWeight(2); p.line(w * (.08 + i * .075), h * .82, w * (.08 + i * .075), h * .88); }
  } else {
    for (let i = 0; i < 15; i += 1) { fill(p, colors[(i % 3) + 1], 17 + rand() * 48); p.circle(w * (.1 + rand() * .8), h * (.1 + rand() * .8), r * (1.2 + rand() * 3.3)); }
  }
  p.noFill(); stroke(p, colors[4], 100); p.strokeWeight(1); const m = Math.min(w, h) * .05; p.rect(m, m, w - m * 2, h - m * 2);
}

export default { id: 'gradient-atmospheres', version: 1, label: 'Gradient Atmospheres', defaults, schema, palettes, directions: ATMOSPHERE_DIRECTIONS, render };
