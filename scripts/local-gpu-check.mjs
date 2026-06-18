#!/usr/bin/env node
// GPU de-risk: drive LOCAL Chrome headless (real GPU on macOS via ANGLE/Metal,
// NOT SwiftShader) against the target site and confirm its WebGL hero renders +
// animates. Raw CDP over the built-in WebSocket — no puppeteer, no new deps.
//
// Run: node scripts/local-gpu-check.mjs [url]
// Writes: scripts/gpu-first.jpg gpu-mid.jpg gpu-last.jpg

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = dirname(fileURLToPath(import.meta.url));
const URL_TARGET = process.argv[2] || 'https://hitloop.agency';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CAPTURE_MS = 6000;

// ── Launch Chrome (new headless = GPU on macOS) ──────────────────────────────
const args = [
  '--headless=new',
  '--enable-gpu',
  '--use-angle=metal',
  '--ignore-gpu-blocklist',
  '--enable-unsafe-webgpu',
  '--hide-scrollbars',
  '--mute-audio',
  '--window-size=1440,900',
  '--remote-debugging-port=0',
  '--user-data-dir=/tmp/gpu-check-profile',
  'about:blank',
];
const chrome = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'] });

// Parse the browser WS endpoint from stderr.
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  const to = setTimeout(() => reject(new Error('Chrome did not report a DevTools endpoint')), 15000);
  chrome.stderr.on('data', (d) => {
    buf += d.toString();
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
    if (m) { clearTimeout(to); resolve(m[1]); }
  });
  chrome.on('exit', (c) => { clearTimeout(to); reject(new Error('Chrome exited early, code ' + c)); });
});

// ── Minimal CDP client over the built-in WebSocket ───────────────────────────
function makeClient(url) {
  const ws = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error('ws error')); });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  return { ready, send, on: (fn) => listeners.push(fn), close: () => ws.close() };
}

const browser = makeClient(wsUrl);
await browser.ready;

// Create a page target + attach a flat session.
const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });

const frames = [];
const stamps = [];
let t0 = 0;
browser.on((msg) => {
  if (msg.method === 'Page.screencastFrame' && msg.sessionId === sessionId) {
    frames.push(msg.params.data);
    stamps.push(t0 ? Date.now() - t0 : 0);
    browser.send('Page.screencastFrameAck', { sessionId: msg.params.sessionId }, sessionId).catch(() => {});
  }
});

await browser.send('Page.enable', {}, sessionId);
await browser.send('Runtime.enable', {}, sessionId);

t0 = Date.now();
await browser.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1 }, sessionId);
await browser.send('Page.navigate', { url: URL_TARGET }, sessionId);
await new Promise((r) => setTimeout(r, CAPTURE_MS));
await browser.send('Page.stopScreencast', {}, sessionId);

// What GPU is actually backing WebGL here?
const renderer = await browser.send('Runtime.evaluate', {
  expression: `(() => { const c=document.createElement('canvas'); const gl=c.getContext('webgl2')||c.getContext('webgl'); if(!gl) return 'NO-WEBGL'; const d=gl.getExtension('WEBGL_debug_renderer_info'); return d?gl.getParameter(d.UNMASKED_RENDERER_WEBGL):'unknown'; })()`,
  returnByValue: true,
}, sessionId).then((r) => r.result.value).catch((e) => 'eval-fail:' + e.message);

// Does the page have its own WebGL/canvas hero, and is it animating?
const canvasInfo = await browser.send('Runtime.evaluate', {
  expression: `(() => { const cs=[...document.querySelectorAll('canvas')]; return JSON.stringify(cs.map(c=>({w:c.width,h:c.height,gl:!!(c.getContext&&(c.__probed=(c.getContext('webgl2')||c.getContext('webgl'))))}))); })()`,
  returnByValue: true,
}, sessionId).then((r) => r.result.value).catch(() => '[]');

// Distinct frames = motion proxy.
let distinct = frames.length ? 1 : 0;
for (let i = 1; i < frames.length; i++) if (frames[i] !== frames[i - 1]) distinct++;

const save = (b64, name) => { if (!b64) return; writeFileSync(join(OUT, name), Buffer.from(b64, 'base64')); };
save(frames[0], 'gpu-first.jpg');
save(frames[Math.floor(frames.length / 2)], 'gpu-mid.jpg');
save(frames[frames.length - 1], 'gpu-last.jpg');

console.log('\n── Local GPU headless check ──');
console.log('Target        :', URL_TARGET);
console.log('GL renderer   :', renderer, /swiftshader|software|llvmpipe/i.test(renderer) ? '⚠ SOFTWARE' : '✓ GPU');
console.log('Page canvases :', canvasInfo);
console.log('Frames        :', frames.length, '·', distinct, 'distinct', distinct > 5 ? '(motion YES)' : '(little/no motion)');
console.log('Wrote gpu-first/mid/last.jpg');

browser.close();
chrome.kill('SIGKILL');
process.exit(0);
