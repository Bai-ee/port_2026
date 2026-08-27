// Print Plates — disciplined repeating ornaments for book pages and wallpapers.
// Each direction binds a motif to an arrangement grammar so randomized output
// stays composed: grid, ring, half-drop, diamond, fan, or mirrored rows.

import { mulberry32 } from '../../elements/randomize.js';

export const PRINT_PLATE_DIRECTIONS = [
  { id: 'flower-ring', label: 'Flower Ring', colors: ['#f5efe3', '#332a29', '#b65d54', '#d9a55b', '#789a85'] },
  { id: 'melon-half-drop', label: 'Melon Half-drop', colors: ['#f8f4e9', '#2f6870', '#dc8790', '#253438', '#d7b45c'] },
  { id: 'rain-cloud-grid', label: 'Rain Cloud Grid', colors: ['#f2f0e6', '#5c7378', '#c05d62', '#8fa8a5', '#c2a65f'] },
  { id: 'lattice-diamond', label: 'Lattice Diamond', colors: ['#f4efe4', '#2f4145', '#bc5361', '#d2b05d', '#9fabb0'] },
  { id: 'paisley-fan', label: 'Paisley Fan', colors: ['#f4eee0', '#423344', '#bd6970', '#b89954', '#708c84'] },
  { id: 'tulip-mirror', label: 'Tulip Mirror', colors: ['#f6f0e6', '#384d45', '#c45a64', '#d39b50', '#94a37a'] },
  { id: 'sunburst-orbit', label: 'Sunburst Orbit', colors: ['#f7f0e2', '#40384a', '#d27463', '#d0ad53', '#849c9a'] },
  { id: 'abstract-block-plate', label: 'Abstract Block Plate', colors: ['#eee8da', '#2d394c', '#b85b58', '#d3ad58', '#78968d'] },
];

const palettes = PRINT_PLATE_DIRECTIONS.map((direction) => ({ id: direction.id, label: direction.label, colors: direction.colors }));
export const PRINT_PLATE_MOTIFS = ['Flower', 'Watermelon', 'Cloud', 'Lattice', 'Paisley', 'Tulip', 'Sunburst', 'Blocks'];
export const PRINT_PLATE_LAYOUTS = ['Grid', 'Half-drop', 'Diamond', 'Ring', 'Fan', 'Spiral', 'Scatter'];
export const PRINT_PLATE_RHYTHMS = ['Straight', 'Flipped', 'Mirrored'];
const defaults = { paletteId: 'flower-ring', background: { color: '#f5efe3' }, seed: 29, params: { density: 0.58, scale: 1, composition: 0.5, texture: 0.24, artDirection: 0, motif: -1, layout: -1, rhythm: 0 } };
const schema = { params: {
  density: { min: 0, max: 1, step: 0.01, default: 0.58 },
  scale: { min: 0.4, max: 2, step: 0.01, default: 1 },
  composition: { min: 0, max: 1, step: 0.01, default: 0.5 },
  texture: { min: 0, max: 1, step: 0.01, default: 0.24 },
  artDirection: { min: 0, max: PRINT_PLATE_DIRECTIONS.length - 1, step: 1, default: 0 },
  motif: { min: -1, max: PRINT_PLATE_MOTIFS.length - 1, step: 1, default: -1 },
  layout: { min: -1, max: PRINT_PLATE_LAYOUTS.length - 1, step: 1, default: -1 },
  rhythm: { min: 0, max: PRINT_PLATE_RHYTHMS.length - 1, step: 1, default: 0 },
} };

export function getPrintPlateDirection(value) { return PRINT_PLATE_DIRECTIONS[Math.max(0, Math.min(PRINT_PLATE_DIRECTIONS.length - 1, Math.round(Number(value) || 0)))]; }
function rgba(p, hex, alpha = 255) { const color = p.color(hex); return [p.red(color), p.green(color), p.blue(color), alpha]; }
function fill(p, hex, alpha = 255) { p.fill(...rgba(p, hex, alpha)); }
function stroke(p, hex, alpha = 255) { p.stroke(...rgba(p, hex, alpha)); }
function pointJitter(rand, amount) { return (rand() - 0.5) * amount; }

function hatchDisc(p, r, ink, rand, density = 8) {
  p.push(); p.noFill(); stroke(p, ink, 90); p.strokeWeight(Math.max(.55, r * .025));
  for (let i = -density; i <= density; i += 1) {
    const d = i / density * r; const half = Math.sqrt(Math.max(0, r * r - d * d));
    p.line(-half, d + pointJitter(rand, r * .04), half, d + pointJitter(rand, r * .04));
  }
  p.pop();
}

function flower(p, r, c, rand) {
  p.push(); p.noStroke();
  const petals = 6 + Math.floor(rand() * 3);
  for (let i = 0; i < petals; i += 1) { p.push(); p.rotate(i * p.TWO_PI / petals + pointJitter(rand, .1)); fill(p, c[2], 145); p.ellipse(r * .66, 0, r * .96, r * .46); p.pop(); }
  hatchDisc(p, r * .68, c[1], rand, 6); fill(p, c[3]); p.circle(0, 0, r * .32); p.pop();
}
function melon(p, r, c, rand) {
  p.push(); p.rotate(pointJitter(rand, .1)); p.noStroke(); fill(p, c[1], 185); p.arc(0, 0, r * 2.1, r * 1.48, 0, p.PI, p.PIE); fill(p, c[2]); p.arc(0, -r * .05, r * 1.78, r * 1.22, 0, p.PI, p.PIE); p.noFill(); stroke(p, c[3], 170); p.strokeWeight(Math.max(1, r * .05)); p.arc(0, 0, r * 2.1, r * 1.48, 0, p.PI); p.strokeWeight(Math.max(.55, r * .025)); for (let x = -r * .55; x <= r * .55; x += r * .26) p.line(x, r * .05, x + pointJitter(rand, r * .1), r * .54); fill(p, c[3], 210); p.noStroke(); for (let i = 0; i < 5; i += 1) p.circle(pointJitter(rand, r * .65), r * (.18 + rand() * .38), r * .08); p.pop();
}
function cloud(p, r, c, rand) {
  p.push(); p.noStroke(); fill(p, c[1], 175); const lumps = 5 + Math.floor(rand() * 3); for (let i = 0; i < lumps; i += 1) p.circle((i - (lumps - 1) / 2) * r * .35, pointJitter(rand, r * .1), r * (.72 + rand() * .3)); p.rect(-r * 1.02, 0, r * 2.04, r * .32); hatchDisc(p, r * .82, c[3], rand, 7); p.noFill(); stroke(p, c[2], 150); p.strokeWeight(Math.max(.65, r * .035)); for (let i = -3; i <= 3; i += 1) { const x = i * r * .25; p.line(x, r * .5, x + pointJitter(rand, r * .12), r * (1.18 + rand() * .24)); } fill(p, c[4]); p.noStroke(); for (let i = -3; i <= 3; i += 1) p.circle(i * r * .25, r * 1.34, r * .09); p.pop();
}
function lattice(p, r, c, rand) {
  p.push(); p.rotate(pointJitter(rand, .08)); p.noFill(); stroke(p, c[1], 145); p.strokeWeight(Math.max(.7, r * .03));
  for (let i = 0; i < 4; i += 1) { p.push(); p.rotate(i * p.PI / 8); p.rect(-r * .63, -r * .63, r * 1.26, r * 1.26); p.pop(); }
  hatchDisc(p, r * .76, c[4], rand, 7); fill(p, c[2]); p.noStroke(); p.circle(0, 0, r * .44); fill(p, c[3]); for (let i = 0; i < 4; i += 1) p.circle(Math.cos(i * p.HALF_PI) * r * .94, Math.sin(i * p.HALF_PI) * r * .94, r * .12); p.pop();
}
function paisley(p, r, c, rand) {
  p.push(); p.rotate(pointJitter(rand, .25)); p.noStroke(); fill(p, c[2], 170); p.beginShape(); p.vertex(-r * .65, r * .66); p.bezierVertex(-r * 1.15, -.12 * r, -.42 * r, -r * 1.12, .45 * r, -.56 * r); p.bezierVertex(1.15 * r, -.04 * r, .48 * r, .8 * r, -.65 * r, .66 * r); p.endShape(p.CLOSE); p.noFill(); stroke(p, c[1], 155); p.strokeWeight(Math.max(.7, r * .035)); p.arc(-r * .03, r * .02, r * .8, r * .8, .1, p.TWO_PI - .45); fill(p, c[3]); p.noStroke(); p.circle(r * .04, r * .02, r * .25); p.pop();
}
function tulip(p, r, c, rand) {
  p.push(); p.noStroke(); fill(p, c[2], 170); p.beginShape(); p.vertex(-r * .72, r * .18); p.bezierVertex(-r * .88, -r * .75, -.22 * r, -r * .86, 0, -r * .35); p.bezierVertex(.28 * r, -r * .9, .86 * r, -.72 * r, .72 * r, .18 * r); p.bezierVertex(.36 * r, r * .56, -.36 * r, r * .56, -.72 * r, .18 * r); p.endShape(p.CLOSE); stroke(p, c[1], 150); p.strokeWeight(Math.max(.6, r * .026)); p.line(0, r * .42, pointJitter(rand, r * .12), r * 1.25); fill(p, c[4]); p.noStroke(); p.ellipse(-r * .2, r * .88, r * .55, r * .22); p.ellipse(r * .23, r * .72, r * .55, r * .22); p.pop();
}
function sunburst(p, r, c, rand) {
  p.push(); p.noStroke(); const rays = 12 + Math.floor(rand() * 5); for (let i = 0; i < rays; i += 1) { p.push(); p.rotate(i * p.TWO_PI / rays); fill(p, c[(i % 2) + 2], 165); p.triangle(r * .32, -r * .11, r * (1 + pointJitter(rand, .08)), 0, r * .32, r * .11); p.pop(); } fill(p, c[1]); p.circle(0, 0, r * .6); hatchDisc(p, r * .27, c[3], rand, 5); p.pop();
}
function block(p, r, c, rand) {
  p.push(); p.rotate(pointJitter(rand, .14)); p.noStroke(); fill(p, c[1], 205); p.rect(-r, -r * .66, r * 1.45, r * 1.32); fill(p, c[2], 175); p.rect(-r * .32, -r * .96, r * 1.18, r * .62); fill(p, c[3], 185); p.rect(-r * .8, r * .34, r * .92, r * .56); p.noFill(); stroke(p, c[4], 145); p.strokeWeight(Math.max(.6, r * .027)); for (let i = -3; i <= 3; i += 1) p.line(-r * 1.08, i * r * .18, r * .98, i * r * .18 + pointJitter(rand, r * .1)); p.pop();
}

function plateFrame(p, w, h, c) { const m = Math.min(w, h) * .065; p.noFill(); stroke(p, c[3], 120); p.strokeWeight(Math.max(1, Math.min(w, h) * .002)); p.rect(m, m, w - m * 2, h - m * 2); const corner = Math.min(w, h) * .06; for (const [x, y, sx, sy] of [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]]) { p.line(x, y, x + corner * sx, y); p.line(x, y, x, y + corner * sy); } }
function place(p, x, y, r, draw, c, rand, rhythm = 0, index = 0) { p.push(); p.translate(x + pointJitter(rand, r * .12), y + pointJitter(rand, r * .1)); if (rhythm === 1 && index % 2) p.rotate(p.PI); if (rhythm === 2 && index % 2) p.scale(-1, 1); draw(p, r * (.9 + rand() * .18), c, rand); p.pop(); }

function render(p, ctx, recipe) {
  const { width: w, height: h } = ctx; const params = { ...defaults.params, ...(recipe.params || {}) }; const direction = getPrintPlateDirection(params.artDirection); const c = direction.colors; const rand = mulberry32(recipe.seed >>> 0);
  p.background((recipe.background && recipe.background.color) || c[0]);
  const r = Math.min(w, h) * (.052 + params.scale * .026); const cols = 3 + Math.round(params.density * 2); const rows = Math.max(3, Math.round(cols * h / w * .88)); const x0 = w * .16; const x1 = w * .84; const y0 = h * .17; const y1 = h * .83;
  const mode = Math.round(params.artDirection); const derivedLayouts = [3, 1, 0, 2, 4, 0, 3, 0];
  const motif = params.motif >= 0 ? Math.round(params.motif) : mode; const layout = params.layout >= 0 ? Math.round(params.layout) : derivedLayouts[mode]; const rhythm = Math.round(params.rhythm || 0);
  const draw = [flower, melon, cloud, lattice, paisley, tulip, sunburst, block][motif]; let index = 0;
  if (layout === 3) { // ring
    const total = 10 + Math.round(params.density * 8); const orbit = Math.min(w, h) * (.23 + params.composition * .08); for (let i = 0; i < total; i += 1) { const a = i / total * p.TWO_PI - p.HALF_PI; place(p, w * .5 + Math.cos(a) * orbit, h * .5 + Math.sin(a) * orbit * .92, r, draw, c, rand); } place(p, w * .5, h * .5, r * 1.15, draw, c, rand);
  } else if (layout === 4) { // fan
    const total = 9 + Math.round(params.density * 7); for (let i = 0; i < total; i += 1) { const a = p.PI * (1.1 + i / Math.max(1, total - 1) * .8); place(p, w * .5 + Math.cos(a) * w * .28, h * .69 + Math.sin(a) * h * .4, r, draw, c, rand, rhythm, index++); }
  } else if (layout === 5) { // spiral
    const total = 10 + Math.round(params.density * 8); for (let i = 0; i < total; i += 1) { const a = i * .78; const distance = Math.min(w, h) * (.035 + i / total * .3); place(p, w * .5 + Math.cos(a) * distance, h * .5 + Math.sin(a) * distance, r, draw, c, rand, rhythm, index++); }
  } else if (layout === 6) { // disciplined scatter: evenly distributed zones, not free chaos
    const total = cols * rows; for (let i = 0; i < total; i += 1) { const col = i % cols; const row = Math.floor(i / cols); const cellW = (x1 - x0) / cols; const cellH = (y1 - y0) / rows; place(p, x0 + (col + .28 + rand() * .44) * cellW, y0 + (row + .28 + rand() * .44) * cellH, r, draw, c, rand, rhythm, index++); }
  } else { // grid / half-drop / diamond
    for (let row = 0; row < rows; row += 1) for (let col = 0; col < cols; col += 1) { const halfDrop = layout === 1 ? (row % 2 ? (x1 - x0) / cols * .45 : 0) : 0; const diamond = layout === 2 ? Math.abs(row - (rows - 1) / 2) * (x1 - x0) / cols * .16 : 0; const x = x0 + (col + .5) / cols * (x1 - x0) + halfDrop + diamond; const y = y0 + (row + .5) / rows * (y1 - y0); place(p, x, y, r, draw, c, rand, rhythm, index++); }
  }
  // Small registration dots make every layout read as a finished print plate.
  p.noStroke(); fill(p, c[4], 150); for (const x of [w * .14, w * .5, w * .86]) for (const y of [h * .13, h * .87]) p.circle(x, y, Math.max(3, r * .12)); plateFrame(p, w, h, c);
}

export default { id: 'print-plates', version: 1, label: 'Print Plates', defaults, schema, palettes, directions: PRINT_PLATE_DIRECTIONS, render };
