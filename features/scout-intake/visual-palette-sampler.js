'use strict';

// visual-palette-sampler.js
// Ground-truth color palette from a homepage screenshot.
// Feeds design-system-extractor so the Brand Snapshot palette reflects what
// users actually see above the fold, not just colors declared in CSS.

const sharp = require('sharp');

const SAMPLE_WIDTH  = 128;          // downsampled width — enough signal, cheap
const HERO_RATIO    = 0.6;          // top 60% of image (above-the-fold bias)
const QUANT_STEP    = 16;           // 16-step cubic buckets (4096 total)
const MAX_COLORS    = 6;            // returned palette size
const MIN_COVERAGE  = 0.015;        // 1.5% min pixel share to be reported

function fetchTimeout(url, ms = 15000) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), ms);
    fetch(url, { signal: controller.signal })
      .then((r) => {
        clearTimeout(t);
        if (!r.ok) return reject(new Error(`fetch ${r.status}`));
        r.arrayBuffer().then((buf) => resolve(Buffer.from(buf))).catch(reject);
      })
      .catch((err) => { clearTimeout(t); reject(err); });
  });
}

function toHex(r, g, b) {
  const h = (n) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / d + 2); break;
      case b: h = ((r - g) / d + 4); break;
    }
    h *= 60;
  }
  return { h, s, l };
}

// Cheap perceptual distance (Euclidean in RGB) — good enough for merging buckets.
function colorDistance(a, b) {
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function classifyMode(avgLuminance) {
  if (avgLuminance < 0.25) return 'dark';
  if (avgLuminance > 0.75) return 'light';
  return 'mixed';
}

/**
 * Sample a dominant color palette from a homepage screenshot.
 *
 * @param {object} opts
 * @param {string} [opts.imageUrl]       Remote URL to fetch
 * @param {Buffer} [opts.imageBuffer]    Preloaded buffer (skips fetch)
 * @returns {Promise<{
 *   ok: boolean,
 *   palette?: {
 *     dominant: string,
 *     hero: string[],
 *     accents: string[],
 *     coverage: Array<{ hex: string, ratio: number }>,
 *     mode: 'dark'|'light'|'mixed',
 *     source: 'screenshot',
 *     sampleWidth: number,
 *     sampleHeight: number,
 *   },
 *   error?: string,
 * }>}
 */
async function sampleVisualPalette({ imageUrl, imageBuffer } = {}) {
  try {
    let buf = imageBuffer;
    if (!buf) {
      if (!imageUrl) return { ok: false, error: 'no image source provided' };
      buf = await fetchTimeout(imageUrl);
    }

    // Downsample + crop hero band. raw RGB output.
    const meta = await sharp(buf).metadata();
    const aspect = (meta.height || 1) / (meta.width || 1);
    const resizedHeight = Math.max(1, Math.round(SAMPLE_WIDTH * aspect));
    const heroHeight = Math.max(1, Math.round(resizedHeight * HERO_RATIO));

    const { data } = await sharp(buf)
      .resize({ width: SAMPLE_WIDTH, fit: 'inside' })
      .extract({ left: 0, top: 0, width: SAMPLE_WIDTH, height: heroHeight })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const totalPixels = data.length / 3;
    if (totalPixels < 16) return { ok: false, error: 'image too small to sample' };

    // Bucket quantize into 16-step cubes.
    const buckets = new Map(); // key -> { r, g, b, count }
    let lumSum = 0;
    for (let i = 0; i < data.length; i += 3) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      lumSum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

      const rq = Math.min(255, Math.round(r / QUANT_STEP) * QUANT_STEP);
      const gq = Math.min(255, Math.round(g / QUANT_STEP) * QUANT_STEP);
      const bq = Math.min(255, Math.round(b / QUANT_STEP) * QUANT_STEP);
      const key = `${rq},${gq},${bq}`;
      const entry = buckets.get(key);
      if (entry) {
        entry.count += 1;
        entry.rSum += r; entry.gSum += g; entry.bSum += b;
      } else {
        buckets.set(key, { count: 1, rSum: r, gSum: g, bSum: b });
      }
    }
    const avgLum = lumSum / totalPixels;

    // Turn buckets into {r,g,b,ratio} array and sort by coverage.
    const sorted = Array.from(buckets.values())
      .map((b) => ({
        r: Math.round(b.rSum / b.count),
        g: Math.round(b.gSum / b.count),
        b: Math.round(b.bSum / b.count),
        ratio: b.count / totalPixels,
      }))
      .filter((c) => c.ratio >= MIN_COVERAGE)
      .sort((a, b) => b.ratio - a.ratio);

    // Merge near-duplicates (distance < 24) by summing ratios into the larger.
    const merged = [];
    for (const c of sorted) {
      const near = merged.find((m) => colorDistance(m, c) < 24);
      if (near) {
        near.ratio += c.ratio;
      } else {
        merged.push({ ...c });
      }
      if (merged.length >= 24) break;
    }

    // Top colors with metadata (hue, saturation, lightness).
    const enriched = merged.map((c) => {
      const hsl = rgbToHsl(c.r, c.g, c.b);
      return { ...c, ...hsl, hex: toHex(c.r, c.g, c.b) };
    });

    const hero = enriched.slice(0, MAX_COLORS).map((c) => c.hex);

    // Dominant brand candidate: highest saturation within top coverage (not near-neutral).
    const saturated = enriched
      .filter((c) => c.s > 0.18 && c.l > 0.1 && c.l < 0.92)
      .sort((a, b) => (b.ratio * 0.6 + b.s * 0.4) - (a.ratio * 0.6 + a.s * 0.4));
    const dominant = (saturated[0] || enriched[0]).hex;

    // Accents = saturated colors beyond the dominant.
    const accents = saturated.slice(1, MAX_COLORS).map((c) => c.hex);

    return {
      ok: true,
      palette: {
        dominant,
        hero,
        accents,
        coverage: enriched.slice(0, MAX_COLORS).map((c) => ({ hex: c.hex, ratio: Number(c.ratio.toFixed(4)) })),
        mode: classifyMode(avgLum),
        source: 'screenshot',
        sampleWidth: SAMPLE_WIDTH,
        sampleHeight: heroHeight,
      },
    };
  } catch (err) {
    return { ok: false, error: err?.message || 'palette sampling failed' };
  }
}

module.exports = { sampleVisualPalette };
