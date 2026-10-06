import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderStillVideo, clampSeconds, probeMedia } from '../index.js';
import { hasDrawtext, sanitizeText } from '../lib/StillVideo.js';

const FF = fs.existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg';
let ok = true;
try { execFileSync(FF, ['-version'], { stdio: 'ignore' }); } catch { ok = false; }
const skip = ok ? false : 'ffmpeg not available';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'still-test-'));
const img = path.join(dir, 'in.png');
const tone = path.join(dir, 'tone.wav');
if (ok) {
  execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1600x1000:rate=1', '-frames:v', '1', img]);
  execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', tone]);
}
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('clampSeconds clamps to 12-20, default 15', () => {
  assert.equal(clampSeconds(5), 12);
  assert.equal(clampSeconds(99), 20);
  assert.equal(clampSeconds(), 15);
  assert.equal(clampSeconds('abc'), 15);
  assert.equal(clampSeconds(16), 16);
});

test('sanitizeText strips emoji and escapes filter chars', () => {
  assert.equal(sanitizeText('hi \u{1F600}'), 'hi');
  assert.equal(sanitizeText("a:b'c"), "a\\:b\u2019c");
});

test('missing image errors clearly', async () => {
  await assert.rejects(renderStillVideo({ image: path.join(dir, 'nope.png'), out: path.join(dir, 'x.mp4') }), /image not found/);
  await assert.rejects(renderStillVideo({ aspect: '4:3', image: img, out: 'x.mp4' }), /unsupported aspect/);
});

test('1:1 silent render, seconds clamped up to 12', { skip }, async () => {
  const out = path.join(dir, 'sq.mp4');
  const r = await renderStillVideo({ image: img, aspect: '1:1', seconds: 5, out, preset: 'ultrafast' });
  assert.equal(r.width, 1080); assert.equal(r.height, 1080);
  assert.ok(r.durationSec >= 12 && r.durationSec < 12.3, String(r.durationSec));
  assert.equal(r.hasAudio, true);
  const p = await probeMedia(out);
  assert.equal(p.videoCodec, 'h264'); assert.equal(p.pixFmt, 'yuv420p'); assert.equal(p.fps, '30/1');
});

test('9:16 render with audio excerpt', { skip }, async () => {
  const out = path.join(dir, 'tall.mp4');
  const r = await renderStillVideo({ image: img, aspect: '9:16', seconds: 12, out, preset: 'ultrafast', audio: { path: tone, startSec: 2, durationSec: 12 } });
  assert.equal(r.width, 1080); assert.equal(r.height, 1920);
  assert.ok(r.durationSec >= 12 && r.durationSec < 12.3);
  assert.equal(r.hasAudio, true);
  assert.equal((await probeMedia(out)).audioCodec, 'aac');
});

test('text layer renders when drawtext exists, else fails clearly', { skip }, async () => {
  const out = path.join(dir, 'txt.mp4');
  const args = { image: img, aspect: '1:1', seconds: 12, out, preset: 'ultrafast', textLayers: [{ text: 'Hello', position: 'bottom', size: 60 }] };
  if (await hasDrawtext(FF)) {
    assert.equal((await renderStillVideo(args)).width, 1080);
  } else {
    await assert.rejects(renderStillVideo(args), /drawtext/);
  }
});
