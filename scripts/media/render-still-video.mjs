#!/usr/bin/env node
// Still -> short video. Usage:
//   node scripts/media/render-still-video.mjs --image a.jpg [--audio t.mp3 --start 30 --dur 15]
//     [--aspect 1:1|9:16|both] [--seconds 15] [--text "Title" [--text-pos top|bottom]] --out out.mp4
import { parseArgs } from 'node:util';
import path from 'node:path';
import { renderStillVideo } from '../../services/media-render/lib/StillVideo.js';

const { values: v } = parseArgs({
  options: {
    image: { type: 'string' }, audio: { type: 'string' }, start: { type: 'string' }, dur: { type: 'string' },
    aspect: { type: 'string', default: '1:1' }, seconds: { type: 'string', default: '15' },
    text: { type: 'string' }, 'text-pos': { type: 'string', default: 'bottom' }, out: { type: 'string' },
    preset: { type: 'string' },
  },
});
if (!v.image || !v.out) {
  console.error('usage: render-still-video.mjs --image <file> --out <file.mp4> [--audio f --start s --dur s] [--aspect 1:1|9:16|both] [--seconds 12-20] [--text "..."]');
  process.exit(2);
}
const aspects = v.aspect === 'both' ? ['1:1', '9:16'] : [v.aspect];
try {
  for (const aspect of aspects) {
    const ext = path.extname(v.out) || '.mp4';
    const base = v.out.slice(0, v.out.length - path.extname(v.out).length);
    const out = aspects.length > 1 ? `${base}-${aspect.replace(':', 'x')}${ext}` : v.out;
    const r = await renderStillVideo({
      image: v.image, aspect, seconds: Number(v.seconds), out, preset: v.preset, fadeAudio: true,
      audio: v.audio ? { path: /^https?:/.test(v.audio) ? undefined : v.audio, url: /^https?:/.test(v.audio) ? v.audio : undefined, startSec: Number(v.start) || 0, durationSec: Number(v.dur) || undefined } : undefined,
      textLayers: v.text ? [{ text: v.text, position: v['text-pos'], size: 56 }] : [],
    });
    console.log(JSON.stringify({ aspect, ...r }));
  }
} catch (e) {
  console.error(`render-still-video failed: ${e.message}`);
  process.exit(1);
}
