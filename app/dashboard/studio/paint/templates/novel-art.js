// Novel Art — a self-contained editorial illustration engine. It deliberately
// uses no image assets: every layer is built from first-party geometry, seeded
// variation, colour, and print-like marks. Archive imagery can become an
// optional future layer without being a requirement for a finished artwork.

import { mulberry32 } from '../../elements/randomize.js';

export const ART_DIRECTIONS = [
  { id: 'botanical-plate', label: 'Botanical Plate', palette: ['#ece7d8', '#294e41', '#88a25f', '#d36650', '#312b24'] },
  { id: 'celestial-almanac', label: 'Celestial Almanac', palette: ['#131a35', '#40569b', '#f0c76f', '#d98a77', '#f5e7cb'] },
  { id: 'cartographers-garden', label: 'Cartographer’s Garden', palette: ['#ede3cc', '#426b70', '#8d5742', '#c5a25f', '#293d3d'] },
  { id: 'pressed-flora', label: 'Pressed Flora', palette: ['#e8e0d0', '#677452', '#a7af78', '#b76557', '#443e35'] },
  { id: 'ink-and-thread', label: 'Ink & Thread', palette: ['#f3ebdd', '#1c2c45', '#bd4a4e', '#d49b42', '#4c766a'] },
  { id: 'midnight-folklore', label: 'Midnight Folklore', palette: ['#201b2b', '#5a3d69', '#ca7355', '#d9b35e', '#eee1c7'] },
  { id: 'modernist-jacket', label: 'Modernist Jacket', palette: ['#efe7d8', '#1f314b', '#c5483e', '#e1a32e', '#3f7569'] },
  { id: 'etched-still-life', label: 'Etched Still Life', palette: ['#e9e4d8', '#344b55', '#6b8464', '#bd7551', '#302a28'] },
  { id: 'tidal-letterpress', label: 'Tidal Letterpress', palette: ['#e9e2d2', '#164d64', '#3d8193', '#d37b5d', '#312b31'] },
  { id: 'folk-quilt', label: 'Folk Quilt', palette: ['#ede1ce', '#b84b45', '#dd9d35', '#386759', '#28354b'] },
  { id: 'marble-and-gilding', label: 'Marble & Gilding', palette: ['#e6e5dc', '#526b6b', '#b9b5a5', '#c59b49', '#2e3e43'] },
  { id: 'archival-index', label: 'Archival Index', palette: ['#eee8dc', '#2f4858', '#708d8a', '#b4654c', '#38332d'] },
];

const PALETTES = ART_DIRECTIONS.map((direction) => ({ id: direction.id, label: direction.label, colors: direction.palette }));
const DEFAULTS = {
  paletteId: 'botanical-plate', background: { color: '#ece7d8' }, seed: 1,
  params: { density: 0.55, scale: 1, composition: 0.48, texture: 0.45, artDirection: 0, layering: 0.62, ornament: 0.58 },
};
const SCHEMA = { params: {
  density: { min: 0, max: 1, step: 0.01, default: 0.55 },
  scale: { min: 0.4, max: 2, step: 0.01, default: 1 },
  composition: { min: 0, max: 1, step: 0.01, default: 0.48 },
  texture: { min: 0, max: 1, step: 0.01, default: 0.45 },
  artDirection: { min: 0, max: ART_DIRECTIONS.length - 1, step: 1, default: 0 },
  layering: { min: 0, max: 1, step: 0.01, default: 0.62 },
  ornament: { min: 0, max: 1, step: 0.01, default: 0.58 },
} };

export function getArtDirection(value) {
  return ART_DIRECTIONS[Math.max(0, Math.min(ART_DIRECTIONS.length - 1, Math.round(Number(value) || 0)))];
}

function col(p, hex, alpha = 255) { const c = p.color(hex); return [p.red(c), p.green(c), p.blue(c), alpha]; }
function fill(p, hex, alpha) { p.fill(...col(p, hex, alpha)); }
function stroke(p, hex, alpha) { p.stroke(...col(p, hex, alpha)); }
function paper(p, w, h, amount) {
  p.background(...col(p, '#f0eee7'));
  const dots = Math.round(900 + amount * 2400);
  p.noStroke();
  for (let i = 0; i < dots; i += 1) { const a = p.random(3, 15) * amount; p.fill(p.random() > .48 ? 35 : 255, p.random() > .48 ? 30 : 255, p.random() > .48 ? 28 : 255, a); p.circle(p.random(w), p.random(h), p.random(.35, 1.7)); }
}
function frame(p, w, h, colors, weight = 1) {
  p.noFill(); stroke(p, colors[4], 120); p.strokeWeight(weight); const m = Math.min(w, h) * .055;
  p.rect(m, m, w - m * 2, h - m * 2); p.rect(m * 1.35, m * 1.35, w - m * 2.7, h - m * 2.7);
}
function rosette(p, x, y, r, colors, petals = 8) {
  p.push(); p.translate(x, y); p.noStroke();
  for (let i = 0; i < petals; i += 1) { p.rotate(Math.PI * 2 / petals); fill(p, colors[(i % 3) + 1], 145); p.ellipse(r * .56, 0, r * 1.12, r * .42); }
  fill(p, colors[4], 210); p.circle(0, 0, r * .45); p.pop();
}
function leaf(p, x, y, r, a, colors) {
  p.push(); p.translate(x, y); p.rotate(a); p.noStroke(); fill(p, colors[1], 170); p.ellipse(0, 0, r * 1.65, r * .62); stroke(p, colors[4], 115); p.strokeWeight(1); p.line(-r * .72, 0, r * .72, 0); p.pop();
}
function botanical(p, w, h, colors, rand, params) {
  const count = Math.round(4 + params.density * 8); const base = Math.min(w, h) * .1 * params.scale;
  for (let i = 0; i < count; i += 1) {
    const x = w * (.13 + rand() * .74), y = h * (.14 + rand() * .72), r = base * (.55 + rand());
    stroke(p, colors[1], 175); p.strokeWeight(1.2); p.noFill(); p.line(x, h * .93, x + (rand() - .5) * r, y);
    for (let n = 0; n < 4; n += 1) leaf(p, x + (rand() - .5) * r, y + rand() * r * 1.2, r * .32, rand() * 5, colors);
    rosette(p, x, y, r, colors, 6 + Math.floor(rand() * 4));
  }
}
function stars(p, w, h, colors, rand, amount) {
  p.noStroke(); const count = Math.round(24 + amount * 115);
  for (let i = 0; i < count; i += 1) { const x = rand() * w, y = rand() * h, r = 1 + rand() * 3.2; fill(p, colors[rand() > .7 ? 3 : 4], 90 + rand() * 150); p.circle(x, y, r); if (rand() > .83) { p.stroke(...col(p, colors[3], 130)); p.strokeWeight(.8); p.line(x-r*2,y,x+r*2,y); p.line(x,y-r*2,x,y+r*2); } }
}
function waves(p, w, h, colors, rand, amount) {
  const rows = Math.round(7 + amount * 13); p.noFill();
  for (let r = 0; r < rows; r += 1) { const y = h * (.14 + r / (rows + 2) * .73); stroke(p, colors[(r % 3) + 1], 100 + r % 2 * 60); p.strokeWeight(1 + (r % 3) * .35); p.beginShape(); for (let x = -30; x < w + 35; x += 22) p.curveVertex(x, y + Math.sin(x * .012 + r * .8) * (9 + rand() * 16)); p.endShape(); }
}
function blocks(p, w, h, colors, rand, amount) {
  const n = Math.round(4 + amount * 10); p.noStroke(); for (let i = 0; i < n; i += 1) { fill(p, colors[(i % 3) + 1], 190); const x = rand()*w, y = rand()*h, rw = w*(.08+rand()*.28), rh=h*(.04+rand()*.25); p.rect(x,y,rw,rh); }
}
function contour(p, w, h, colors, rand, amount) {
  const n = Math.round(8 + amount * 16); p.noFill(); for (let i=0;i<n;i+=1) { const cx=w*(.2+rand()*.6), cy=h*(.2+rand()*.6), r=Math.min(w,h)*(.06+rand()*.22); stroke(p, colors[(i%3)+1], 90); p.strokeWeight(.75); p.ellipse(cx,cy,r*(1+rand()*.45),r*(.42+rand()*.45)); }
}
function printMarks(p,w,h,colors,rand,params) {
  const n=Math.round(14+params.ornament*54); for(let i=0;i<n;i+=1){ const x=rand()*w,y=rand()*h; p.push();p.translate(x,y);p.rotate(rand()*Math.PI); stroke(p,colors[4],105);p.strokeWeight(.8);p.noFill(); if(rand()>.45)p.arc(0,0,8+rand()*28,8+rand()*28,0,Math.PI);else p.line(-10-rand()*18,0,10+rand()*18,0);p.pop(); }
}

function render(p, ctx, recipe) {
  const { width:w, height:h } = ctx; const params={...DEFAULTS.params,...(recipe.params||{})}; const direction=getArtDirection(params.artDirection);
  const colors=direction.palette; const rand=mulberry32(recipe.seed >>> 0); const bg=(recipe.background&&recipe.background.color)||colors[0];
  p.background(bg); paper(p,w,h,params.texture*.7); p.background(...col(p,bg,235));
  const mode=Math.round(params.artDirection);
  if (mode===1 || mode===5) { p.background(...col(p,colors[0])); stars(p,w,h,colors,rand,params.density); }
  if (mode===2 || mode===11) { contour(p,w,h,colors,rand,params.layering); frame(p,w,h,colors,.9); }
  if (mode===6 || mode===9) blocks(p,w,h,colors,rand,params.layering);
  if (mode===8 || mode===10) waves(p,w,h,colors,rand,params.layering);
  if (mode===0 || mode===2 || mode===3 || mode===7) botanical(p,w,h,colors,rand,params);
  if (mode===1) { p.noFill(); stroke(p,colors[3],180); p.strokeWeight(1.2); p.circle(w*.5,h*.48,Math.min(w,h)*.34); p.circle(w*.5,h*.48,Math.min(w,h)*.53); fill(p,colors[3],205); p.circle(w*.5,h*.48,Math.min(w,h)*.12); }
  if (mode===4) { waves(p,w,h,colors,rand,.55); for(let i=0;i<14;i+=1) rosette(p,w*(.15+rand()*.7),h*(.17+rand()*.66),Math.min(w,h)*(.025+rand()*.04),colors,6); }
  if (mode===5) { for(let i=0;i<5;i+=1){ const x=w*(.15+rand()*.7),y=h*(.18+rand()*.65),r=Math.min(w,h)*(.055+rand()*.08); fill(p,colors[2],120);p.noStroke();p.triangle(x,y-r,x-r*.7,y+r,x+r*.7,y+r); rosette(p,x,y+r*.4,r*.55,colors,6); } }
  if (mode===7) { p.noFill();stroke(p,colors[4],150);p.strokeWeight(1);p.ellipse(w*.5,h*.57,w*.28,h*.32);p.line(w*.36,h*.57,w*.64,h*.57); }
  if (mode===9) { const s=Math.min(w,h)*.09; for(let x=s;x<w-s;x+=s)for(let y=s;y<h-s;y+=s){p.noFill();stroke(p,colors[(Math.floor(x/s)+Math.floor(y/s))%3+1],140);p.strokeWeight(1);p.rect(x,y,s,s);if(rand()>.55)rosette(p,x+s*.5,y+s*.5,s*.28,colors,4);} }
  if (mode===10) { for(let i=0;i<12;i+=1){p.noFill();stroke(p,colors[3],80);p.strokeWeight(.6);p.arc(w*.5,h*.5,Math.min(w,h)*(.18+i*.043),Math.min(w,h)*(.09+i*.022),i*.2,i*.2+Math.PI*1.4);} }
  if (mode===11) { for(let i=0;i<12;i+=1){const y=h*(.16+i*.057);stroke(p,colors[4],100);p.strokeWeight(1);p.line(w*.17,y,w*(.38+rand()*.18),y);p.line(w*.59,y,w*(.72+rand()*.12),y);} rosette(p,w*.72,h*.27,Math.min(w,h)*.07,colors,8); }
  printMarks(p,w,h,colors,rand,params); frame(p,w,h,colors,1.1);
}

export default { id:'novel-art', version:1, label:'Novel Art', defaults:DEFAULTS, schema:SCHEMA, palettes:PALETTES, directions:ART_DIRECTIONS, render };
