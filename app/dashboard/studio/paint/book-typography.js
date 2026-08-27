// Book typography is part of the Paint recipe, not a DOM-only overlay: the
// same settings are rendered into previews and exported PNGs. This keeps a
// commissioned cover reproducible from its saved recipe.

export const DEFAULT_BOOK_TYPOGRAPHY = Object.freeze({
  enabled: true,
  headline: 'CHAPTER ONE',
  subhead: 'A small beginning',
  layout: 'chapter',
  spacer: 'rules',
  color: '#1d1711',
  headlineScale: 1,
  subheadScale: 1,
  backdrop: Object.freeze({ enabled: true, intensity: 0.9, blur: 0.72, size: 0.9, falloff: 0.62 }),
});

const MAX_HEADLINE_LENGTH = 90;
const MAX_SUBHEAD_LENGTH = 140;
const LAYOUTS = new Set(['chapter', 'cover']);
const SPACERS = new Set(['ornament', 'rules', 'none']);
const HEX_COLOR_RE = /^#([0-9a-fA-F]{6})$/;

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function cleanText(value, fallback, maxLength) {
  if (typeof value !== 'string') return fallback;
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function normalizeBookTypography(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : DEFAULT_BOOK_TYPOGRAPHY.enabled,
    headline: cleanText(input.headline, DEFAULT_BOOK_TYPOGRAPHY.headline, MAX_HEADLINE_LENGTH),
    subhead: cleanText(input.subhead, DEFAULT_BOOK_TYPOGRAPHY.subhead, MAX_SUBHEAD_LENGTH),
    layout: LAYOUTS.has(input.layout) ? input.layout : DEFAULT_BOOK_TYPOGRAPHY.layout,
    spacer: SPACERS.has(input.spacer) ? input.spacer : DEFAULT_BOOK_TYPOGRAPHY.spacer,
    color: typeof input.color === 'string' && HEX_COLOR_RE.test(input.color) ? input.color : DEFAULT_BOOK_TYPOGRAPHY.color,
    headlineScale: clamp(input.headlineScale, 0.65, 1.45, DEFAULT_BOOK_TYPOGRAPHY.headlineScale),
    subheadScale: clamp(input.subheadScale, 0.65, 1.65, DEFAULT_BOOK_TYPOGRAPHY.subheadScale),
    backdrop: {
      enabled: typeof input.backdrop?.enabled === 'boolean' ? input.backdrop.enabled : DEFAULT_BOOK_TYPOGRAPHY.backdrop.enabled,
      intensity: clamp(input.backdrop?.intensity, 0, 1, DEFAULT_BOOK_TYPOGRAPHY.backdrop.intensity),
      blur: clamp(input.backdrop?.blur, 0, 1, DEFAULT_BOOK_TYPOGRAPHY.backdrop.blur),
      size: clamp(input.backdrop?.size, 0.4, 1.4, DEFAULT_BOOK_TYPOGRAPHY.backdrop.size),
      falloff: clamp(input.backdrop?.falloff, 0.15, 1, DEFAULT_BOOK_TYPOGRAPHY.backdrop.falloff),
    },
  };
}

export function invertHex(hex) {
  const raw = String(hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return '#ffffff';
  const inverted = [0, 2, 4].map((index) => (255 - Number.parseInt(raw.slice(index, index + 2), 16)).toString(16).padStart(2, '0'));
  return `#${inverted.join('')}`;
}

function isDarkPixel(pixel) {
  if (!pixel || pixel.length < 3) return false;
  const [r, g, b] = pixel.map((value) => value / 255);
  const linear = [r, g, b].map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return (linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722) < 0.22;
}

export function isBookFormat(formatId) {
  return formatId === 'book-cover' || formatId === 'chapter-page';
}

export function wrapWords(text, measure, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measure(candidate) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  });
  if (line) lines.push(line);
  return lines;
}

// Creates a clean reading field beneath the copy. This deliberately uses the
// recipe's own page colour rather than a blurred copy of the artwork: blurring
// a dark mark at the edge of the field creates the unwanted grey/black halo
// that makes an illustration look muddy. The colour is read at render time,
// so every randomized recipe gets a field that belongs to its own background.
function drawLegibilityVignette(p, recipe, text, cx, cy, panelW, panelH, template) {
  if (!text.backdrop.enabled) return;
  const w = p.width; const h = p.height;
  const radiusX = panelW * (0.48 + text.backdrop.size * 0.32);
  const radiusY = panelH * (0.36 + text.backdrop.size * 0.32);
  // Templates that paint their own base (for example a gradient) can return
  // the local page color. Flat templates fall back to the recipe background.
  const backdropColor = template?.getBackdropColor?.(recipe, { x: cx / w, y: cy / h }) || recipe?.background?.color || '#ffffff';
  const tint = p.color(backdropColor);
  const ctx = p.drawingContext;
  const tintMask = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(radiusX, radiusY));
  // At full strength the core must contain *no* artwork. Blend softness and
  // falloff only control the final feather band; they never reintroduce a
  // dark/black intermediary color.
  const feather = Math.min(0.68, Math.max(0.06, 0.06 + text.backdrop.blur * 0.38 + text.backdrop.falloff * 0.24));
  const opaqueStop = 1 - feather;
  const coreAlpha = 0.1 + text.backdrop.intensity * 0.9;
  tintMask.addColorStop(0, `rgba(${p.red(tint)},${p.green(tint)},${p.blue(tint)},${coreAlpha})`);
  tintMask.addColorStop(opaqueStop, `rgba(${p.red(tint)},${p.green(tint)},${p.blue(tint)},${coreAlpha})`);
  tintMask.addColorStop(1, `rgba(${p.red(tint)},${p.green(tint)},${p.blue(tint)},0)`);
  ctx.save(); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.filter = 'none';
  ctx.fillStyle = tintMask; ctx.fillRect(0, 0, w, h); ctx.restore();
}

function drawRules(p, cx, y, width, ink) {
  p.push();
  p.stroke(ink);
  p.strokeWeight(Math.max(1, p.width * 0.0012));
  p.line(cx - width / 2, y, cx - width * 0.12, y);
  p.line(cx + width * 0.12, y, cx + width / 2, y);
  p.fill(ink);
  p.noStroke();
  p.circle(cx, y, Math.max(5, p.width * 0.012));
  p.pop();
}

function drawOrnament(p, cx, y, ink) {
  p.push();
  p.noFill();
  p.stroke(ink);
  p.strokeWeight(Math.max(1, p.width * 0.0011));
  const unit = p.width * 0.026;
  p.arc(cx - unit, y, unit * 1.35, unit * 1.35, -p.HALF_PI, p.HALF_PI);
  p.arc(cx + unit, y, unit * 1.35, unit * 1.35, p.HALF_PI, p.PI + p.HALF_PI);
  p.circle(cx, y, unit * 0.38);
  p.pop();
}

export function drawBookTypography(p, recipe, template) {
  const text = normalizeBookTypography(recipe?.text);
  if (!text.enabled || !text.headline) return;

  const w = p.width;
  const h = p.height;
  const portrait = h >= w;
  const cx = w / 2;
  const panelW = portrait ? w * 0.82 : w * 0.7;
  const panelH = portrait ? h * (text.layout === 'cover' ? 0.5 : 0.36) : h * 0.45;
  const panelY = text.layout === 'cover' ? h * 0.2 : h * 0.32;
  const headlineSize = (portrait ? w * (text.layout === 'cover' ? 0.101 : 0.082) : h * 0.12) * text.headlineScale;
  // A chapter subhead needs more presence than supporting UI copy; its
  // higher base scale deliberately reads as book typography at print size.
  const subheadSize = headlineSize * 0.36 * text.subheadScale;

  const headlineY = panelY + panelH * (text.layout === 'cover' ? 0.29 : 0.33);
  drawLegibilityVignette(p, recipe, text, cx, panelY + panelH * 0.48, panelW, panelH, template);
  // Sample the actual generated pixels, rather than trusting the selected
  // background swatch: several art directions paint their own dark fields.
  // On near-black passages the selected color is inverted automatically.
  const ink = isDarkPixel(p.get(cx, headlineY)) ? invertHex(text.color) : text.color;
  p.push();
  p.textAlign(p.CENTER, p.CENTER);
  p.textFont('Georgia');
  p.textStyle(p.BOLD);
  p.textSize(headlineSize);
  p.fill(ink);
  p.noStroke();
  const headlineLines = wrapWords(text.headline.toUpperCase(), (line) => p.textWidth(line), panelW * 0.76).slice(0, 3);
  const lineH = headlineSize * 0.98;
  const headlineBlockH = headlineLines.length * lineH;
  headlineLines.forEach((line, index) => p.text(line, cx, headlineY + index * lineH - headlineBlockH / 2 + lineH / 2));

  const dividerY = headlineY + headlineBlockH / 2 + panelH * 0.12;
  if (text.spacer === 'rules') drawRules(p, cx, dividerY, panelW * 0.58, ink);
  if (text.spacer === 'ornament') drawOrnament(p, cx, dividerY, ink);

  if (text.subhead) {
    p.textFont('Arial');
    p.textStyle(p.NORMAL);
    p.textSize(subheadSize);
    p.textLeading(subheadSize * 1.42);
    p.fill(ink + 'd9');
    const subLines = wrapWords(text.subhead, (line) => p.textWidth(line), panelW * 0.62).slice(0, 3);
    const subY = dividerY + panelH * 0.17;
    subLines.forEach((line, index) => p.text(line, cx, subY + index * subheadSize * 1.42));
  }
  p.pop();
}
