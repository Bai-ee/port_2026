import { NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

// UI Teaser — local-only render bridge for the ui-teaser dashboard card.
// POST spawns scripts/render-ui-teaser.mjs (headless GPU Playwright + ffmpeg on
// THIS machine, ~25s) which records the clean-mode homepage. Renders land in
// public/ui-teasers/ and are listed by GET. Production has no browser/ffmpeg,
// so POST 501s there — this card is a local admin tool.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const execFileAsync = promisify(execFile);
const OUT_DIR = path.join(process.cwd(), 'public', 'ui-teasers');
const VARIATIONS = ['hero-hold', 'scroll-up', 'dive-loop'];

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function listRenders() {
  if (!fs.existsSync(OUT_DIR)) return [];
  return fs.readdirSync(OUT_DIR)
    .filter((f) => f.endsWith('.mp4'))
    .map((file) => {
      const m = file.match(/^ui-teaser-(.+)-s(\d+)-(\d{8}-\d{6})\.mp4$/);
      const stat = fs.statSync(path.join(OUT_DIR, file));
      return {
        file,
        url: `/ui-teasers/${file}`,
        variation: m ? m[1] : 'unknown',
        seed: m ? Number(m[2]) : null,
        createdAt: stat.mtime.toISOString(),
        sizeBytes: stat.size,
      };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function GET() {
  return json({ ok: true, variations: VARIATIONS, renders: listRenders() });
}

export async function DELETE(request) {
  if (process.env.NODE_ENV === 'production') {
    return json({ ok: false, error: 'UI Teaser assets live on the local machine only.' }, 501);
  }
  const file = new URL(request.url).searchParams.get('file') || '';
  // Strict filename match — never a path. Covers both pre-camera filenames
  // (ui-teaser-<variation>-s<seed>-<stamp>.mp4) and camera-tagged ones.
  if (!/^ui-teaser-[a-z0-9-]+-s\d+-\d{8}-\d{6}\.mp4$/i.test(file)) {
    return json({ ok: false, error: 'invalid file name' }, 400);
  }
  const target = path.join(OUT_DIR, file);
  if (!fs.existsSync(target)) return json({ ok: false, error: 'file not found' }, 404);
  fs.unlinkSync(target);
  return json({ ok: true, renders: listRenders() });
}

export async function POST(request) {
  if (process.env.NODE_ENV === 'production') {
    return json({ ok: false, error: 'UI Teaser renders locally only — run the dashboard via `npm run dev` on a machine with Chrome + ffmpeg.' }, 501);
  }
  let body = {};
  try { body = await request.json(); } catch { /* empty body = random variation */ }
  const variation = VARIATIONS.includes(body?.variation) ? body.variation : 'random';
  const origin = new URL(request.url).origin;
  const script = path.join(process.cwd(), 'scripts', 'render-ui-teaser.mjs');

  try {
    const { stdout } = await execFileAsync('node', [script, '--variation', variation, '--url', origin], {
      timeout: 240_000,
    });
    // Last line of script output is a machine-readable JSON summary.
    const lastJson = stdout.trim().split('\n').reverse().find((l) => l.startsWith('{'));
    const result = lastJson ? JSON.parse(lastJson) : null;
    if (!result?.ok) return json({ ok: false, error: 'render produced no output' }, 500);
    return json({ ok: true, url: `/ui-teasers/${result.file}`, variation: result.variation, seed: result.seed, out: result.out || null, camera: result.camera || null, renders: listRenders() });
  } catch (err) {
    return json({ ok: false, error: err.stderr?.slice(0, 500) || err.message || 'render failed' }, 500);
  }
}
