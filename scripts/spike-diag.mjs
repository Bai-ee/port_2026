#!/usr/bin/env node
// Diagnostic: isolate which browser-control phase hangs. Same nav + screencast +
// CSP-reset as the real spike, but a trivial scene that returns immediately.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.BROWSERLESS_TOKEN) {
  for (const line of readFileSync(join(repoRoot, '.env.local'), 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (!m) continue;
    let v = m[2].trim(); if (/^["']/.test(v)) v = v.slice(1, -1); if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
const TOKEN = process.env.BROWSERLESS_TOKEN.trim();
const BASE = (process.env.BROWSERLESS_BASE_URL || 'https://production-sfo.browserless.io').replace(/\/+$/, '');
const SITE = process.env.SPIKE_SITE_URL || 'https://hitloop.agency';

const CAP_MS = Number(process.env.CAP_MS) || 10000;
const fnCode = `
export default async function ({ page }) {
  const T = []; let last = Date.now();
  const mark = (n) => { const x = Date.now(); T.push(n + '=' + (x - last) + 'ms'); last = x; };
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const frames = []; const stamps = []; const t0 = Date.now();
  const client = await page.target().createCDPSession();
  // Make the page think it is focused + visible so rAF/WebGL animation runs
  // (headless throttles/freezes animation on unfocused pages).
  await client.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch((e) => T.push('focus-err=' + e.message));
  await client.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
  client.on('Page.screencastFrame', async (e) => {
    frames.push('data:image/jpeg;base64,' + e.data); stamps.push(Date.now() - t0);
    try { await client.send('Page.screencastFrameAck', { sessionId: e.sessionId }); } catch {}
  });
  await client.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1 }).catch(() => {});
  await page.goto(${JSON.stringify(SITE)}, { waitUntil: 'domcontentloaded', timeout: 12000 }).catch((e) => { T.push('goto-err=' + e.message); });
  const dcl = Date.now() - t0;
  await new Promise((r) => setTimeout(r, ${CAP_MS}));
  await client.send('Page.stopScreencast').catch(() => {});
  mark('nav+capture');
  // approximate "content painted" by jpeg byte size jump (white pages compress tiny)
  const sizes = frames.map(f => Math.round(f.length / 1024));
  return { data: { timings: T, count: frames.length, dclMs: dcl, stamps, sizes,
    first: frames[0] || null, mid: frames[Math.floor(frames.length/2)] || null, lastF: frames[frames.length-1] || null }, type: 'application/json' };
}
`;

const ep = `${BASE}/function?token=${encodeURIComponent(TOKEN)}&timeout=60000`;
console.log(`→ diag against ${SITE}`);
const t0 = Date.now();
const res = await fetch(ep, { method: 'POST', signal: AbortSignal.timeout(70000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: fnCode }) });
const el = ((Date.now() - t0) / 1000).toFixed(1);
if (!res.ok) { console.error(`✗ HTTP ${res.status} after ${el}s\n${(await res.text().catch(() => '')).slice(0, 600)}`); process.exit(1); }
const p = await res.json();
const d = p?.data ?? p;
const { writeFileSync } = await import('node:fs');
console.log(`\n(${el}s wall)`);
console.log('timings :', (d.timings || []).join('  '));
console.log('DCL     :', d.dclMs, 'ms');
console.log('frames  :', d.count);
console.log('sizesKB :', (d.sizes || []).join(','));
console.log('stamps  :', (d.stamps || []).map(s => (s/1000).toFixed(1)).join(','));
const save = (b64, name) => { if (!b64) return; writeFileSync(join(dirname(fileURLToPath(import.meta.url)), name), Buffer.from(b64.split(',')[1], 'base64')); console.log('wrote', name); };
save(d.first, 'diag-first.jpg');
save(d.mid, 'diag-mid.jpg');
save(d.lastF, 'diag-last.jpg');
