import { readFile } from 'fs/promises';
import { createRequire } from 'module';
import path from 'path';

import sharp from 'sharp';

import {
  buildBriefOpenGraphMeta,
  esc,
  resolvePublicBrief,
  validId,
} from '../../../_lib/custom-briefs.js';

const require = createRequire(import.meta.url);
const fontkit = require('fontkit');

export const runtime = 'nodejs';

const WIDTH = 1200;
const HEIGHT = 630;
const DOTO_FONT_PATH = path.join(process.cwd(), 'public', 'fonts', 'doto-latin-900-normal.woff2');
const SPACE_GROTESK_400_PATH = path.join(process.cwd(), 'public', 'fonts', 'space-grotesk-latin-400-normal.woff2');
const SPACE_GROTESK_500_PATH = path.join(process.cwd(), 'public', 'fonts', 'space-grotesk-latin-500-normal.woff2');
const SPACE_MONO_400_PATH = path.join(process.cwd(), 'public', 'fonts', 'space-mono-latin-400-normal.woff2');
const SPACE_MONO_700_PATH = path.join(process.cwd(), 'public', 'fonts', 'space-mono-latin-700-normal.woff2');

let fontFacePromise;
let dotoFontPromise;

function textResponse(message, status = 404) {
  return new Response(message, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
    },
  });
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
  return `${base.slice(0, 110)}.png`;
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
  const titleLines = wrapText(String(meta.title || 'Custom Brief').toUpperCase(), showSubhead ? 20 : 23, showSubhead ? 3 : 4);
  const subhead = showSubhead ? fittedSubhead(meta.description) : null;
  const clientLines = wrapText(meta.clientName || 'Client', 32, 1);
  const ogLabel = String(meta.ogLabel || 'BRYAN BALLI').trim().toUpperCase() || 'BRYAN BALLI';
  const titleSize = titleLines.length > 3 ? 70 : titleLines.length > 2 ? 80 : 94;
  const titleY = showSubhead ? 236 : 220;
  const titleLineHeight = titleLines.length > 2 ? 0.9 : 0.94;
  const contentLeft = 96;
  const contentRight = WIDTH - 96;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="briefBg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#ffd3ca"/>
      <stop offset="0.42" stop-color="#fffaf1"/>
      <stop offset="1" stop-color="#e7d5ff"/>
    </linearGradient>
    <radialGradient id="cyanGlow" cx="14%" cy="8%" r="72%">
      <stop offset="0" stop-color="#23c7f7" stop-opacity="0.32"/>
      <stop offset="1" stop-color="#23c7f7" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="pinkGlow" cx="90%" cy="14%" r="70%">
      <stop offset="0" stop-color="#ef2bcf" stop-opacity="0.3"/>
      <stop offset="1" stop-color="#ef2bcf" stop-opacity="0"/>
    </radialGradient>
    <style>
      ${fontFaces}
      .og-title{font-family:DotoLocal,SpaceMonoLocal,monospace;font-weight:900;letter-spacing:0;}
      .og-label{font-family:SpaceMonoLocal,monospace;font-weight:700;letter-spacing:11px;text-transform:uppercase;}
      .og-meta{font-family:SpaceMonoLocal,monospace;font-weight:400;letter-spacing:7px;text-transform:uppercase;}
      .og-body{font-family:SpaceGroteskLocal,system-ui,sans-serif;font-weight:400;letter-spacing:0;}
    </style>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#briefBg)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#cyanGlow)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#pinkGlow)"/>
  <path d="M${contentLeft} 150 H${contentRight}" stroke="#0a0a0a" stroke-opacity="0.14" stroke-width="2"/>
  <path d="M${contentLeft} 486 H${contentRight}" stroke="#0a0a0a" stroke-opacity="0.12" stroke-width="2"/>
  <circle cx="${contentLeft + 6}" cy="108" r="7" fill="#080808"/>
  ${textLines([ogLabel], { x: contentLeft + 34, y: 116, size: 24, weight: 700, fill: '#4f4846', family: 'SpaceMonoLocal, monospace', className: 'og-label' })}
  ${textLines([clientLines[0].toUpperCase()], { x: contentLeft, y: 548, size: 22, weight: 400, fill: '#5d5754', family: 'SpaceMonoLocal, monospace', className: 'og-meta' })}
  ${textLines(['HITLOOP.AGENCY'], { x: contentRight, y: 548, size: 20, weight: 400, fill: '#5d5754', family: 'SpaceMonoLocal, monospace', className: 'og-meta', textAnchor: 'end' })}
  ${await dotoHeadline(titleLines, { x: contentLeft, y: titleY, size: titleSize, fill: '#060606', lineHeight: titleLineHeight })}
  ${subhead?.text ? textLines([subhead.text], { x: contentLeft, y: subhead.y, size: subhead.size, weight: 400, fill: '#393330', lineHeight: 1, family: 'SpaceGroteskLocal, system-ui, sans-serif', className: 'og-body' }) : ''}
</svg>`;
}

export async function GET(request, context) {
  const params = await Promise.resolve(context?.params || {});
  const clientKey = String(params.clientId || '').trim();
  const briefSlug = String(params.briefSlug || '').trim();

  if (!validId(clientKey) || !validId(briefSlug)) {
    return textResponse('Invalid brief preview URL.', 400);
  }

  const resolved = await resolvePublicBrief(clientKey, briefSlug);
  if (!resolved?.brief) return textResponse('Brief preview not found.', 404);

  const meta = buildBriefOpenGraphMeta({
    origin: new URL(request.url).origin,
    clientId: resolved.clientId,
    client: resolved.client,
    brief: resolved.brief,
    snapshotId: resolved.snapshot.id,
  });

  const png = await sharp(Buffer.from(await makeSvg(meta))).png().toBuffer();
  const shouldDownload = new URL(request.url).searchParams.get('download') === '1';
  return new Response(png, {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'content-length': String(png.length),
      'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
      ...(shouldDownload ? { 'content-disposition': contentDispositionFileName(`${meta.title || 'custom-brief'} OG Image`) } : {}),
    },
  });
}
