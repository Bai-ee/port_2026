// Shared OG share-image renderer for published briefs/invoices. Pure
// server code (sharp + fontkit + local woff2 fonts) — used by the public
// /briefs/[client]/[slug]/og-image route AND the admin Studio preview route
// (app/api/dashboard/custom-briefs/og-preview) so the Studio shows exactly
// what will be shared. `meta` is buildBriefOpenGraphMeta()'s shape
// (app/briefs/_lib/custom-briefs.js): title, description, clientName,
// website, dateLabel, hideOgSubhead, ogLabel, and the invoice-only
// ogSubhead/ogTiles overrides.

import { readFile } from 'fs/promises';
import { createRequire } from 'module';
import path from 'path';

import sharp from 'sharp';

import { esc } from './custom-briefs.js';

const require = createRequire(import.meta.url);
const fontkit = require('fontkit');


const WIDTH = 1200;
const HEIGHT = 630;
const DOTO_FONT_PATH = path.join(process.cwd(), 'public', 'fonts', 'doto-latin-900-normal.woff2');
const SPACE_GROTESK_400_PATH = path.join(process.cwd(), 'public', 'fonts', 'space-grotesk-latin-400-normal.woff2');
const SPACE_GROTESK_500_PATH = path.join(process.cwd(), 'public', 'fonts', 'space-grotesk-latin-500-normal.woff2');
const SPACE_MONO_400_PATH = path.join(process.cwd(), 'public', 'fonts', 'space-mono-latin-400-normal.woff2');
const SPACE_MONO_700_PATH = path.join(process.cwd(), 'public', 'fonts', 'space-mono-latin-700-normal.woff2');

let fontFacePromise;
let dotoFontPromise;
let brandLogoPromise;

const BRAND_LOGO_PATH = path.join(process.cwd(), 'public', 'img', 'circle_logo.png');

// Full-size HITLOOP torus (663×552) as a data URI for the invoice variant's
// oversized corner mark — brand-marks.js's downscaled copy would blur at
// this size. Cached for the process; '' if the asset is missing.
async function brandLogoDataUri() {
  if (!brandLogoPromise) {
    brandLogoPromise = readFile(BRAND_LOGO_PATH)
      .then((buf) => `data:image/png;base64,${buf.toString('base64')}`)
      .catch(() => '');
  }
  return brandLogoPromise;
}

function wrapText(value, maxChars, maxLines) {
  const words = String(value || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    } else {
      current = next;
    }
  }

  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[.,;:!?-]+$/g, '')}...`;
  }
  return lines.length ? lines : ['Custom Brief'];
}

function singleLineText(value, maxChars = 150) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).replace(/\s+\S*$/, '')}...`;
}

function fittedSubhead(value) {
  const text = singleLineText(value, 125);
  const length = text.length;
  let size = 31;
  if (length > 110) size = 16;
  else if (length > 95) size = 18;
  else if (length > 80) size = 20;
  else if (length > 65) size = 24;
  else if (length > 55) size = 27;

  return {
    text,
    size,
    y: 438 + Math.max(0, (31 - size) * 0.42),
  };
}

function imageFileName(value) {
  const base = String(value || 'custom-brief-og-image')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '') || 'custom-brief-og-image';
  return `${base.slice(0, 110)}.jpg`;
}

function contentDispositionFileName(fileName) {
  const safe = imageFileName(fileName).replace(/"/g, "'");
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

function textLines(lines, {
  x,
  y,
  size,
  weight = 500,
  fill = '#080808',
  lineHeight = 1.08,
  family = 'Arial, Helvetica, sans-serif',
  className = '',
  letterSpacing = 0,
  textAnchor = '',
}) {
  return lines.map((line, index) => (
    `<text${className ? ` class="${className}"` : ''} x="${x}" y="${y + index * size * lineHeight}"${textAnchor ? ` text-anchor="${textAnchor}"` : ''} font-family="${family}" font-size="${size}" font-weight="${weight}"${letterSpacing ? ` letter-spacing="${letterSpacing}"` : ''} fill="${fill}">${esc(line)}</text>`
  )).join('\n');
}

async function fontFace(name, filePath, weight) {
  try {
    const font = await readFile(filePath);
    return `@font-face{font-family:${name};src:url(data:font/woff2;base64,${font.toString('base64')}) format('woff2');font-weight:${weight};font-style:normal;font-display:block;}`;
  } catch {
    return '';
  }
}

async function localFontFaces() {
  if (!fontFacePromise) {
    fontFacePromise = Promise.all([
      fontFace('DotoLocal', DOTO_FONT_PATH, 900),
      fontFace('SpaceGroteskLocal', SPACE_GROTESK_400_PATH, 400),
      fontFace('SpaceGroteskLocal', SPACE_GROTESK_500_PATH, 500),
      fontFace('SpaceMonoLocal', SPACE_MONO_400_PATH, 400),
      fontFace('SpaceMonoLocal', SPACE_MONO_700_PATH, 700),
    ]).then((faces) => faces.filter(Boolean).join('\n'));
  }
  return fontFacePromise;
}

async function dotoFont() {
  if (!dotoFontPromise) {
    dotoFontPromise = readFile(DOTO_FONT_PATH).then((font) => fontkit.create(font));
  }
  return dotoFontPromise;
}

// Any local font as glyph OUTLINES. The embedded @font-face route works on a
// dev Mac but Vercel's librsvg ignores it — the OG subhead shipped as tofu
// boxes in production — while the Doto headline, drawn as paths via fontkit,
// rendered fine. So every operator-facing text line goes through this.
const fontPromises = new Map();
function fontAt(filePath) {
  if (!fontPromises.has(filePath)) {
    fontPromises.set(filePath, readFile(filePath).then((buf) => fontkit.create(buf)).catch(() => null));
  }
  return fontPromises.get(filePath);
}

async function pathText(lines, { fontPath, x, y, size, fill = '#1a1a1a', lineHeight = 1.5, fallback }) {
  const font = await fontAt(fontPath);
  if (!font) return fallback ? fallback() : '';
  const scale = size / font.unitsPerEm;
  return lines.map((line, lineIndex) => {
    const run = font.layout(String(line || ''));
    let cursor = 0;
    const paths = run.glyphs.map((glyph, glyphIndex) => {
      const position = run.positions[glyphIndex];
      const pathData = glyph.path?.toSVG?.() || '';
      const glyphX = cursor + (position?.xOffset || 0);
      const glyphY = position?.yOffset || 0;
      cursor += position?.xAdvance || glyph.advanceWidth || 0;
      if (!pathData) return '';
      return `<path d="${pathData}" transform="translate(${glyphX} ${glyphY})" fill="${fill}"/>`;
    }).filter(Boolean).join('\n');
    const baseline = y + lineIndex * size * lineHeight;
    return `<g transform="translate(${x} ${baseline}) scale(${scale} -${scale})">${paths}</g>`;
  }).join('\n');
}

async function dotoHeadline(lines, {
  x,
  y,
  size,
  fill = '#060606',
  lineHeight = 0.92,
}) {
  const font = await dotoFont();
  const scale = size / font.unitsPerEm;
  return lines.map((line, lineIndex) => {
    const run = font.layout(String(line || '').toUpperCase());
    let cursor = 0;
    const paths = run.glyphs.map((glyph, glyphIndex) => {
      const position = run.positions[glyphIndex];
      const pathData = glyph.path?.toSVG?.() || '';
      const glyphX = cursor + (position?.xOffset || 0);
      const glyphY = position?.yOffset || 0;
      cursor += position?.xAdvance || glyph.advanceWidth || 0;
      if (!pathData) return '';
      return `<path d="${pathData}" transform="translate(${glyphX} ${glyphY})" fill="${fill}"/>`;
    }).filter(Boolean).join('\n');
    const baseline = y + lineIndex * size * lineHeight;
    return `<g transform="translate(${x} ${baseline}) scale(${scale} -${scale})">${paths}</g>`;
  }).join('\n');
}

async function makeSvg(meta) {
  const fontFaces = await localFontFaces();
  const showSubhead = meta.hideOgSubhead !== true;
  // Doc name = the big Doto headline; capped at 2 lines so the CLIENT/WEBSITE/
  // DATE meta band always has room below.
  // Invoice variant (Invoice Studio publishes): no eyebrow above, so the
  // headline starts higher, runs bigger (Doto ships one weight, 900 — size
  // is the lever) and may take a third line; up to two optional extra
  // lines (meta.ogLines) sit under the subhead.
  const invoiceVariant = meta.ogVariant === 'invoice';
  // Operator-managed headline lines (Publish card "Headline line 1/2") win
  // over auto-wrapping the title; each line is printed as given.
  const manualTitleLines = invoiceVariant && Array.isArray(meta.ogTitleLines)
    ? meta.ogTitleLines.map((line) => String(line || '').replace(/\s+/g, ' ').trim().toUpperCase()).filter(Boolean).slice(0, 3)
    : [];
  const titleLines = manualTitleLines.length
    ? manualTitleLines
    : invoiceVariant
      ? wrapText(String(meta.title || 'Invoice').toUpperCase(), 18, 3)
      : wrapText(String(meta.title || 'Custom Brief').toUpperCase(), 22, 2);
  // Invoice-kind briefs supply their own subhead ("Prepared for …") and
  // tiles via buildBriefOpenGraphMeta; everything else keeps the defaults.
  const subheadSource = meta.ogSubhead !== undefined ? meta.ogSubhead : meta.description;
  const subhead = showSubhead && subheadSource ? fittedSubhead(subheadSource) : null;
  const ogLabel = String(meta.ogLabel || 'BRYAN BALLI').trim().toUpperCase() || 'BRYAN BALLI';
  // Size from the longest line so a manual line never runs off the sheet
  // (~0.74em per Doto glyph at these sizes across the 1008px text column).
  const longest = Math.max(1, ...titleLines.map((line) => line.length));
  const fitSize = Math.floor((WIDTH - 96 * 2) / (longest * 0.74));
  const titleSize = invoiceVariant
    ? Math.max(56, Math.min(titleLines.length > 2 ? 96 : titleLines.length > 1 ? 112 : 128, fitSize))
    : (titleLines.length > 1 ? 80 : 94);
  const titleY = invoiceVariant ? 176 : 236;
  const titleLineHeight = 0.94;
  const titleBottom = titleY + (titleLines.length - 1) * titleSize * titleLineHeight;
  if (invoiceVariant && subhead) subhead.y = Math.max(subhead.y, titleBottom + 70);
  const extraLines = invoiceVariant && Array.isArray(meta.ogLines)
    ? meta.ogLines.map((line) => singleLineText(line, 90)).filter(Boolean).slice(0, 2)
    : [];
  const extraLinesY = subhead?.text ? subhead.y + 44 : titleBottom + 70;
  const contentLeft = 96;
  const contentRight = WIDTH - 96;

  // Bottom meta band — CLIENT · WEBSITE · DATE as .brief-kit .meta-tile cards.
  const tiles = Array.isArray(meta.ogTiles) && meta.ogTiles.length
    ? meta.ogTiles.map((tile) => ({ k: String(tile.k || ''), v: singleLineText(tile.v || '—', 24) }))
    : [
      { k: 'CLIENT', v: singleLineText(meta.clientName || '—', 24) },
      { k: 'WEBSITE', v: singleLineText(meta.website || '—', 26) },
      { k: 'DATE', v: (meta.dateLabel || '—') },
    ];
  const tileTop = 500;
  const tileH = 82;
  const tileGap = 18;
  const bandW = contentRight - contentLeft;
  const tileW = (bandW - tileGap * (tiles.length - 1)) / tiles.length;
  // Invoice variant (Invoice Studio publishes): no eyebrow, no meta tiles —
  // just the headline, the optional subhead, and the logo oversized and
  // bleeding off the bottom-right corner.
  const logoUri = invoiceVariant ? (meta.ogLogo || await brandLogoDataUri()) : '';
  const logoW = 620;
  const logoH = 516; // 663×552 aspect
  const logoSvg = logoUri
    ? `<image href="${esc(logoUri)}" x="${WIDTH - logoW + 90}" y="${HEIGHT - logoH + 130}" width="${logoW}" height="${logoH}" preserveAspectRatio="xMidYMid meet" opacity="0.96"/>`
    : '';
  const tilesSvg = invoiceVariant ? '' : tiles.map((tile, index) => {
    const x = contentLeft + index * (tileW + tileGap);
    return [
      `<rect x="${x}" y="${tileTop}" width="${tileW}" height="${tileH}" rx="14" fill="rgba(255,255,255,0.55)" stroke="rgba(212,196,171,0.82)" stroke-width="1"/>`,
      textLines([tile.k], { x: x + 18, y: tileTop + 30, size: 11, weight: 400, fill: '#5a5346', family: 'SpaceMonoLocal, monospace', className: 'og-tile-k' }),
      textLines([tile.v], { x: x + 18, y: tileTop + 59, size: 18, weight: 500, fill: '#0a0a0a', family: 'SpaceGroteskLocal, system-ui, sans-serif', className: 'og-tile-v' }),
    ].join('\n');
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="briefPaper" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#fefdf9"/>
      <stop offset="1" stop-color="#fbf8f0"/>
    </linearGradient>
    <radialGradient id="glowOrange" cx="0" cy="0" r="480" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ff785a" stop-opacity="0.20"/>
      <stop offset="0.65" stop-color="#ff785a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowPurple" cx="${WIDTH}" cy="189" r="440" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#b05aff" stop-opacity="0.16"/>
      <stop offset="0.65" stop-color="#b05aff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowGold" cx="240" cy="${HEIGHT}" r="470" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffb45a" stop-opacity="0.16"/>
      <stop offset="0.65" stop-color="#ffb45a" stop-opacity="0"/>
    </radialGradient>
    <style>
      ${fontFaces}
      .og-title{font-family:DotoLocal,SpaceMonoLocal,monospace;font-weight:900;letter-spacing:0;}
      .og-label{font-family:SpaceMonoLocal,monospace;font-weight:700;letter-spacing:11px;text-transform:uppercase;}
      .og-tile-k{font-family:SpaceMonoLocal,monospace;font-weight:400;letter-spacing:3px;text-transform:uppercase;}
      .og-tile-v{font-family:SpaceGroteskLocal,system-ui,sans-serif;font-weight:500;letter-spacing:0;}
      .og-body{font-family:SpaceGroteskLocal,system-ui,sans-serif;font-weight:400;letter-spacing:0;}
    </style>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#briefPaper)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glowOrange)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glowPurple)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glowGold)"/>
  ${logoSvg}
  ${invoiceVariant ? '' : `<path d="M${contentLeft} 150 H${contentRight}" stroke="#0a0a0a" stroke-opacity="0.10" stroke-width="2"/>`}
  ${invoiceVariant ? '' : `<path d="M${contentLeft} 468 H${contentRight}" stroke="#0a0a0a" stroke-opacity="0.10" stroke-width="2"/>`}
  ${invoiceVariant ? '' : `<circle cx="${contentLeft + 6}" cy="108" r="6" fill="#0a0a0a"/>`}
  ${invoiceVariant ? '' : textLines([ogLabel], { x: contentLeft + 34, y: 116, size: 24, weight: 700, fill: '#5a5346', family: 'SpaceMonoLocal, monospace', className: 'og-label' })}
  ${await dotoHeadline(titleLines, { x: contentLeft, y: titleY, size: titleSize, fill: '#0a0a0a', lineHeight: titleLineHeight })}
  ${subhead?.text ? await pathText([subhead.text], { fontPath: SPACE_GROTESK_400_PATH, x: contentLeft, y: subhead.y, size: subhead.size, fill: '#1a1a1a', lineHeight: 1, fallback: () => textLines([subhead.text], { x: contentLeft, y: subhead.y, size: subhead.size, weight: 400, fill: '#1a1a1a', lineHeight: 1, family: 'SpaceGroteskLocal, system-ui, sans-serif', className: 'og-body' }) }) : ''}
  ${extraLines.length ? await pathText(extraLines, { fontPath: SPACE_GROTESK_400_PATH, x: contentLeft, y: extraLinesY, size: 22, fill: '#5a5346', lineHeight: 1.5, fallback: () => textLines(extraLines, { x: contentLeft, y: extraLinesY, size: 22, weight: 400, fill: '#5a5346', lineHeight: 1.5, family: 'SpaceGroteskLocal, system-ui, sans-serif', className: 'og-body' }) }) : ''}
  ${tilesSvg}
</svg>`;
}


export async function renderOgImageJpeg(meta) {
  return sharp(Buffer.from(await makeSvg(meta)))
    .jpeg({ quality: 82, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

export { imageFileName, contentDispositionFileName };
