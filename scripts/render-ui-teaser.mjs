#!/usr/bin/env node
// UI Teaser renderer — captures the homepage in clean mode (?teaser=1: no copy,
// no nav; section backgrounds + threejs torus + header logo only) and produces
// a 15s social-ready mp4 in public/ui-teasers/.
//
// Local-only tool (needs a browser + ffmpeg on this machine). Driven by the
// ui-teaser dashboard card via app/api/dashboard/ui-teaser, or directly:
//   node scripts/render-ui-teaser.mjs --variation scroll-up
//   node scripts/render-ui-teaser.mjs --variation random --seed 42 --headless
//
// Every render is unique: the chosen variation's scroll choreography is
// jittered by a seeded PRNG (depths, pacing, easing), mirroring the Video
// Promo variation-engine idea at local scale.

import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const execFileAsync = promisify(execFile);

// ── args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const argVal = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const hasFlag = (name) => args.includes(`--${name}`);

const BASE_URL = argVal('url', 'http://localhost:3000');
const DURATION_S = Number(argVal('duration', '15'));
// Master capture size — a real 5K viewport so the threejs canvas renders the
// particle field at full detail. The output is cut from this master by the
// virtual-camera crop, so even a 2.6x close-up still measures ~2K native.
const WIDTH = Number(argVal('width', '5120'));
const HEIGHT = Number(argVal('height', '2880'));
// Output size: 0 (default) = native crop resolution — no downscale, so a wide
// shot exports full 4K and close-ups export whatever the zoom window measures.
// Set --out-width/--out-height to force a fixed size (e.g. 1920x1080 socials).
const OUT_W = Number(argVal('out-width', '0'));
const OUT_H = Number(argVal('out-height', '0'));
const OUT_DIR = argVal('out', path.join(process.cwd(), 'public', 'ui-teasers'));
const SEED = Number(argVal('seed', String(Math.floor(Math.random() * 1e9))));
const HEADED = hasFlag('headed');

// mulberry32 — tiny seeded PRNG so a seed reproduces its exact choreography
const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rand = mulberry32(SEED);
const jitter = (base, pct) => base * (1 + (rand() * 2 - 1) * pct);
const pick = (list) => list[Math.floor(rand() * list.length)];

// ── variations ───────────────────────────────────────────────────────────────
// Each builds { prePositionVh, steps } — steps are holds and eased scrolls whose
// durations always sum to DURATION_S. toVh = scroll target in viewport heights
// (hero is 100dvh, so 1.0 = hero fully morphed out). Every variation ends with
// a scroll back to top, which triggers the hero's particle re-converge replay
// (HomePage onLeaveBack fires it once progress exceeded 0.5).
const EASES = ['inOutCubic', 'inOutSine'];

const buildVariation = (name, totalMs) => {
  const scaled = (steps) => {
    const sum = steps.reduce((s, x) => s + x.ms, 0);
    const k = totalMs / sum;
    return steps.map((x) => ({ ...x, ms: Math.round(x.ms * k) }));
  };
  if (name === 'hero-hold') {
    // The screenshot shot: idle torus up top, one slow dive + return.
    const depth = jitter(1.05, 0.2);
    return {
      prePositionVh: 0,
      steps: scaled([
        { type: 'hold', ms: jitter(2500, 0.2) },
        { type: 'scroll', toVh: depth, ms: jitter(4000, 0.15), ease: pick(EASES) },
        { type: 'hold', ms: jitter(1000, 0.3) },
        { type: 'scroll', toVh: 0, ms: jitter(4000, 0.15), ease: pick(EASES) },
        { type: 'hold', ms: 3500 },
      ]),
    };
  }
  if (name === 'scroll-up') {
    // Start deep in the page, one long rise through the panels into the hero
    // morph, ending on the converge replay.
    const depth = jitter(2.4, 0.2);
    return {
      prePositionVh: depth,
      steps: scaled([
        { type: 'hold', ms: jitter(1200, 0.25) },
        { type: 'scroll', toVh: 0, ms: jitter(9000, 0.12), ease: pick(EASES) },
        { type: 'hold', ms: 4800 },
      ]),
    };
  }
  // dive-loop — two oscillations showing the morph both directions.
  const d1 = jitter(0.9, 0.2);
  const d2 = jitter(1.4, 0.2);
  return {
    prePositionVh: 0,
    steps: scaled([
      { type: 'hold', ms: jitter(1200, 0.25) },
      { type: 'scroll', toVh: d1, ms: jitter(2800, 0.15), ease: pick(EASES) },
      { type: 'scroll', toVh: Math.min(0.35, d1 * 0.3), ms: jitter(2200, 0.15), ease: pick(EASES) },
      { type: 'scroll', toVh: d2, ms: jitter(3000, 0.15), ease: pick(EASES) },
      { type: 'scroll', toVh: 0, ms: jitter(3300, 0.15), ease: pick(EASES) },
      { type: 'hold', ms: 2500 },
    ]),
  };
};

const VARIATIONS = ['hero-hold', 'scroll-up', 'dive-loop'];
let variation = argVal('variation', 'random');
if (variation === 'random' || !VARIATIONS.includes(variation)) variation = pick(VARIATIONS);

// ── virtual camera (framing) ────────────────────────────────────────────────
// The output is a zoom window cut from the 4K master: seeded zoom level +
// focus point + slow pan drift, so every render frames the torus/background
// art differently — full-frame wides, ring-arc close-ups, background corners.
// Focus presets are frame-fraction coordinates of where the art lives.
const FOCUS_PRESETS = {
  center:       { fx: 0.50, fy: 0.50 },
  'top-arc':    { fx: 0.50, fy: 0.16 }, // upper ring curve
  'left-curve': { fx: 0.26, fy: 0.52 },
  'right-curve':{ fx: 0.74, fy: 0.48 },
  'bottom-arc': { fx: 0.50, fy: 0.82 },
  'logo-corner':{ fx: 0.10, fy: 0.08 }, // header strip + logo + bg wash
  'bg-right':   { fx: 0.82, fy: 0.30 }, // gradient field, ring edge grazing
};
const buildFraming = () => {
  const zoomArg = Number(argVal('zoom', '0'));
  const focusArg = argVal('focus', '');
  // Weighted toward close-ups — the wide shot is what the old renders were.
  const zoom = zoomArg > 0 ? Math.min(2.6, Math.max(1, zoomArg))
    : pick([1, 1.6, 1.6, 2.2, 2.2, 2.6]);
  const focusName = FOCUS_PRESETS[focusArg] ? focusArg
    : zoom === 1 ? 'center' : pick(Object.keys(FOCUS_PRESETS));
  const preset = FOCUS_PRESETS[focusName];
  // Jitter the focus a touch so repeated preset picks still differ.
  const fx = Math.min(0.95, Math.max(0.05, preset.fx + (rand() * 2 - 1) * 0.06));
  const fy = Math.min(0.95, Math.max(0.05, preset.fy + (rand() * 2 - 1) * 0.06));
  // Slow pan drift across the full clip (master px). 0 when wide or --no-drift.
  const drift = (zoom === 1 || hasFlag('no-drift')) ? { dx: 0, dy: 0 }
    : { dx: Math.round((rand() * 2 - 1) * 140), dy: Math.round((rand() * 2 - 1) * 90) };
  return { zoom, focusName, fx, fy, drift };
};
const framing = buildFraming();

// ── capture ──────────────────────────────────────────────────────────────────
const main = async () => {
  const totalMs = DURATION_S * 1000;
  const plan = buildVariation(variation, totalMs);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-teaser-'));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`[teaser] variation=${variation} seed=${SEED} master=${WIDTH}x${HEIGHT} out=${OUT_W > 0 ? `${OUT_W}x${OUT_H}` : 'native-crop'} ${DURATION_S}s`);
  console.log(`[teaser] camera: zoom=${framing.zoom}x focus=${framing.focusName} drift=${framing.drift.dx},${framing.drift.dy}px`);
  console.log(`[teaser] source: ${BASE_URL}/?teaser=1`);

  // Headless by default with --use-angle=metal: on macOS that routes headless
  // WebGL to the real GPU (verified: "ANGLE Metal Renderer: Apple M4 Max"), so
  // the 25k-particle torus renders smoothly with no browser window popping up.
  // --headed opts back into a visible window for debugging choreography.
  const browser = await chromium.launch({
    headless: !HEADED,
    args: ['--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--use-angle=metal'],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
      recordVideo: { dir: tmpDir, size: { width: WIDTH, height: HEIGHT } },
    });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/?teaser=1`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // nextjs-portal = the dev-mode Next.js devtools badge (bottom-right circle).
    await page.addStyleTag({ content: '::-webkit-scrollbar{display:none!important} html{scrollbar-width:none} nextjs-portal{display:none!important}' });
    await page.waitForSelector('#hero-canvas-wrapper canvas', { timeout: 60_000 });
    // Let the intro timeline + particle load-in settle before the window starts.
    await page.waitForTimeout(3500);

    if (plan.prePositionVh > 0) {
      await page.evaluate((vh) => window.scrollTo(0, Math.round(vh * window.innerHeight)), plan.prePositionVh);
      await page.waitForTimeout(800);
    }

    console.log(`[teaser] recording ${DURATION_S}s choreography…`);
    await page.evaluate(async (steps) => {
      const easings = {
        inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
        inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
      };
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (const step of steps) {
        if (step.type === 'hold') { await sleep(step.ms); continue; }
        const from = window.scrollY;
        const to = Math.round(step.toVh * window.innerHeight);
        const ease = easings[step.ease] || easings.inOutCubic;
        await new Promise((resolve) => {
          const t0 = performance.now();
          const frame = (now) => {
            const p = Math.min(1, (now - t0) / step.ms);
            window.scrollTo(0, from + (to - from) * ease(p));
            if (p < 1) requestAnimationFrame(frame); else resolve();
          };
          requestAnimationFrame(frame);
        });
      }
    }, plan.steps);
    await page.waitForTimeout(300);

    const video = page.video();
    await context.close(); // flushes the webm
    const webmPath = await video.path();

    // Trim to the final DURATION_S (drops warm-up/pre-position) + encode mp4.
    const { stdout: durOut } = await execFileAsync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', webmPath,
    ]);
    const recordedS = parseFloat(durOut.trim());
    const trimStart = Math.max(0, recordedS - DURATION_S - 0.3); // 300ms tail pad above
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
    const zoomTag = framing.zoom === 1 ? 'wide' : `${framing.focusName}-${String(framing.zoom).replace('.', 'p')}x`;
    const outName = `ui-teaser-${variation}-${zoomTag}-s${SEED}-${stamp}.mp4`;
    const outPath = path.join(OUT_DIR, outName);

    // Virtual camera: crop window sized master/zoom, centered on the focus
    // point (clamped inside the frame), drifting linearly across the clip.
    // Window ≥ output for zooms up to master/output ratio, so close-ups stay
    // crisp — no upscaling until beyond 2x on the 4K→1080p defaults.
    const cw = Math.round(WIDTH / framing.zoom / 2) * 2;
    const ch = Math.round(HEIGHT / framing.zoom / 2) * 2;
    const clampf = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const baseX = clampf(Math.round(framing.fx * WIDTH - cw / 2), 0, WIDTH - cw);
    const baseY = clampf(Math.round(framing.fy * HEIGHT - ch / 2), 0, HEIGHT - ch);
    // Keep the whole drift path in-frame by pre-clamping both endpoints.
    const endX = clampf(baseX + framing.drift.dx, 0, WIDTH - cw);
    const endY = clampf(baseY + framing.drift.dy, 0, HEIGHT - ch);
    const xExpr = `${baseX}+(${endX}-${baseX})*t/${DURATION_S}`;
    const yExpr = `${baseY}+(${endY}-${baseY})*t/${DURATION_S}`;
    // Native crop resolution unless an explicit output size was requested —
    // downscaling to a fixed 1080p was reading as low-res on big displays.
    const outW = OUT_W > 0 ? OUT_W : cw;
    const outH = OUT_H > 0 ? OUT_H : ch;
    const vf = `crop=${cw}:${ch}:${xExpr}:${yExpr}${(outW !== cw || outH !== ch) ? `,scale=${outW}:${outH}:flags=lanczos` : ''}`;

    console.log(`[teaser] encoding mp4 (recorded ${recordedS.toFixed(1)}s → last ${DURATION_S}s, window ${cw}x${ch} @ ${baseX},${baseY} → ${outW}x${outH})…`);
    await execFileAsync('ffmpeg', [
      '-y', '-i', webmPath,
      '-ss', trimStart.toFixed(2), '-t', String(DURATION_S),
      '-vf', vf,
      '-r', '30', '-c:v', 'libx264', '-crf', '16', '-preset', 'medium',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
      outPath,
    ]);

    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`[teaser] done: ${outPath}`);
    // Machine-readable line for the API route.
    console.log(JSON.stringify({
      ok: true, file: outName, variation, seed: SEED,
      camera: { zoom: framing.zoom, focus: framing.focusName, drift: framing.drift },
      out: `${outW}x${outH}`,
    }));
  } finally {
    await browser.close();
  }
};

main().catch((err) => {
  console.error('[teaser] failed:', err.message || err);
  process.exit(1);
});
