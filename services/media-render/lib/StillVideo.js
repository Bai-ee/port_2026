/**
 * StillVideo - stateless "still image -> short video" render (Active Content
 * System, Phase 3). One image (+ optional audio excerpt) in, one X-ready MP4 out.
 *
 * Output: H.264 yuv420p, 30fps, faststart, AAC stereo (silent track when no audio
 * is given, for player compatibility). Duration is clamped to 12-20s so it clears
 * the 10s quality-view floor. Ken Burns is a subtle centred zoom-in; the subject is
 * never cropped by the zoom. 1:1 is a sharp cover-crop (never a blurred pad);
 * 9:16 fits the whole image over a blurred copy of itself.
 *
 * Audio fades in/out only; there is no video fade. No network except an optional
 * audio URL (fetched to a temp file). No Firebase, no queue.
 */

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const execFileP = promisify(execFile);

export const MIN_SECONDS = 12;
export const MAX_SECONDS = 20;
export const DEFAULT_SECONDS = 15;
const FPS = 30;
const ZOOM_END = 0.06; // 1.00 -> 1.06 over the clip
const FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/System/Library/Fonts/Helvetica.ttc',
  '/Library/Fonts/Arial.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
];

const CANVAS = { '1:1': { w: 1080, h: 1080 }, '9:16': { w: 1080, h: 1920 } };

export function clampSeconds(s) {
  const n = Number(s);
  if (!Number.isFinite(n)) return DEFAULT_SECONDS;
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, n));
}

function bins(opts = {}) {
  return {
    ffmpeg: opts.ffmpegPath || process.env.FFMPEG_PATH || (fsExists('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg'),
    ffprobe: opts.ffprobePath || process.env.FFPROBE_PATH || (fsExists('/opt/homebrew/bin/ffprobe') ? '/opt/homebrew/bin/ffprobe' : 'ffprobe'),
  };
}
import { existsSync } from 'node:fs';
function fsExists(p) { return existsSync(p); }

export async function probe(file, ffprobe = 'ffprobe') {
  const { stdout } = await execFileP(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { maxBuffer: 8 * 1024 * 1024 });
  const j = JSON.parse(stdout);
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  const a = (j.streams || []).find((s) => s.codec_type === 'audio');
  return {
    width: v?.width, height: v?.height, videoCodec: v?.codec_name, pixFmt: v?.pix_fmt,
    fps: v?.r_frame_rate, audioCodec: a?.codec_name, hasAudio: Boolean(a),
    durationSec: Number(j.format?.duration),
  };
}

export async function hasDrawtext(ffmpeg = 'ffmpeg') {
  try {
    const { stdout } = await execFileP(ffmpeg, ['-hide_banner', '-filters']);
    return /\bdrawtext\b/.test(stdout);
  } catch { return false; }
}

export function findFont() {
  return FONT_CANDIDATES.find((p) => existsSync(p)) || null;
}

// drawtext text value: strip emoji/control chars, escape filter metacharacters.
export function sanitizeText(text) {
  const clean = String(text ?? '').replace(/[\p{Extended_Pictographic}\u200d\ufe0f\u0000-\u001f]/gu, '').trim();
  return clean.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, '\u2019').replace(/%/g, '\\%').replace(/,/g, '\\,').replace(/;/g, '\;');
}

function buildTextFilters(layers, font, w) {
  return layers.map((l) => {
    const t = sanitizeText(l?.text);
    if (!t) return null;
    const size = Math.max(16, Math.min(160, Math.round(Number(l.size) || 56)));
    const y = l.position === 'top' ? `h*0.07` : `h-text_h-h*0.07`;
    return `drawtext=fontfile='${font.replace(/'/g, "\\'")}':text='${t}':fontsize=${size}:fontcolor=white:borderw=3:bordercolor=black@0.7:x=(w-text_w)/2:y=${y}`;
  }).filter(Boolean);
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.trim().split('\n').slice(-4).join(' | ')}`))));
  });
}

async function resolveAudioInput(audio, tmpDir) {
  if (!audio) return null;
  const src = audio.path || audio.url;
  if (!src) throw new Error('audio requires path or url');
  if (audio.path) {
    await fs.access(audio.path).catch(() => { throw new Error(`audio file not found: ${audio.path}`); });
    return audio.path;
  }
  const res = await fetch(audio.url);
  if (!res.ok) throw new Error(`audio download failed (${res.status})`);
  const dest = path.join(tmpDir, 'audio-src');
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

/**
 * @param {object} o { image, audio?, aspect, seconds, textLayers?, fadeAudio, out, preset? }
 * @returns {{out,width,height,durationSec,hasAudio}}
 */
export async function renderStillVideo(o = {}) {
  const aspect = o.aspect || '1:1';
  const canvas = CANVAS[aspect];
  if (!canvas) throw new Error(`unsupported aspect "${aspect}" (use 1:1 or 9:16)`);
  if (!o.image) throw new Error('image is required');
  if (!o.out) throw new Error('out is required');
  await fs.access(o.image).catch(() => { throw new Error(`image not found: ${o.image}`); });

  const { ffmpeg, ffprobe } = bins(o);
  const seconds = clampSeconds(o.seconds ?? DEFAULT_SECONDS);
  const frames = Math.round(seconds * FPS);
  const { w, h } = canvas;
  const layers = Array.isArray(o.textLayers) ? o.textLayers.filter((l) => sanitizeText(l?.text)) : [];

  let textFilters = [];
  if (layers.length) {
    const font = findFont();
    if (!font) throw new Error('text layers requested but no usable font found (checked macOS/Linux system font paths)');
    if (!(await hasDrawtext(ffmpeg))) throw new Error(`text layers requested but this ffmpeg (${ffmpeg}) has no drawtext filter (needs a build with libfreetype)`);
    textFilters = buildTextFilters(layers, font, w);
  }

  const img = await probe(o.image, ffprobe);
  if (!img.width || !img.height) throw new Error(`unreadable image: ${o.image}`);

  const zoom = `1+${ZOOM_END}*on/${frames - 1}`;
  const center = `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
  let graph;
  if (aspect === '1:1') {
    graph = `[0:v]scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2},`
      + `zoompan=z='${zoom}':${center}:d=1:s=${w}x${h}:fps=${FPS},setsar=1[base]`;
  } else {
    // blurred full-bleed backdrop + whole image fitted to the width (never cropped)
    const fitScale = Math.min(w / img.width, h / img.height);
    const fw = Math.max(2, Math.round((img.width * fitScale) / 2) * 2);
    const fh = Math.max(2, Math.round((img.height * fitScale) / 2) * 2);
    graph = `[0:v]split[a][b];`
      + `[a]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},gblur=sigma=30,eq=brightness=-0.08[bg];`
      + `[b]scale=${fw * 2}:${fh * 2},zoompan=z='${zoom}':${center}:d=1:s=${fw}x${fh}:fps=${FPS}[fg];`
      + `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[base]`;
  }
  graph += textFilters.length ? `;[base]${textFilters.join(',')}[v]` : `;[base]null[v]`;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'still-video-'));
  try {
    const audioSrc = await resolveAudioInput(o.audio, tmpDir);
    const fade = o.fadeAudio !== false;
    const fadeIn = 1;
    const fadeOut = 1.5;
    const fadeChain = fade ? `,afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${(seconds - fadeOut).toFixed(2)}:d=${fadeOut}` : '';
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-loop', '1', '-framerate', String(FPS), '-i', o.image];
    if (audioSrc) {
      const start = Math.max(0, Number(o.audio.startSec) || 0);
      const dur = Math.min(seconds, Math.max(1, Number(o.audio.durationSec) || seconds));
      args.push('-ss', String(start), '-t', String(dur), '-i', audioSrc);
      graph += `;[1:a]aformat=sample_rates=44100:channel_layouts=stereo,apad=whole_dur=${seconds}${fadeChain},atrim=0:${seconds}[a]`;
    } else {
      args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
      graph += `;[1:a]atrim=0:${seconds}[a]`;
    }
    args.push(
      '-filter_complex', graph, '-map', '[v]', '-map', '[a]',
      '-frames:v', String(frames), '-t', String(seconds),
      '-c:v', 'libx264', '-preset', o.preset || 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS),
      '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2',
      '-movflags', '+faststart', o.out,
    );
    await fs.mkdir(path.dirname(path.resolve(o.out)), { recursive: true });
    await run(ffmpeg, args);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  const p = await probe(o.out, ffprobe);
  return { out: o.out, width: p.width, height: p.height, durationSec: Number(p.durationSec.toFixed(2)), hasAudio: p.hasAudio };
}
