#!/usr/bin/env node
// Section mapper: load a site on GPU Chrome, scroll through it to trigger lazy
// content, then list its scroll landmarks (sections + media) with their position
// as % down the page. Use this to pick a precise scroll target by % or selector
// when the label is WebGL/canvas/image (no DOM text to search).
//
// Run: node scripts/section-map.mjs [url]

import { spawn } from 'node:child_process';
const URL_TARGET = process.argv[2] || 'https://hitloop.agency';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist',
  '--hide-scrollbars', '--mute-audio', '--window-size=1440,900',
  '--remote-debugging-port=0', `--user-data-dir=/tmp/section-map-${process.pid}-${Date.now()}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

const wsUrl = await new Promise((resolve, reject) => {
  let buf = ''; const to = setTimeout(() => reject(new Error('no DevTools endpoint')), 15000);
  chrome.stderr.on('data', d => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(to); resolve(m[1]); } });
  chrome.on('exit', c => { clearTimeout(to); reject(new Error('chrome exited ' + c)); });
});

function client(url) {
  const ws = new WebSocket(url); let id = 1; const pend = new Map();
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const { resolve, reject } = pend.get(m.id); pend.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
  const send = (method, params = {}, s) => new Promise((resolve, reject) => { const i = id++; pend.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params, ...(s ? { sessionId: s } : {}) })); });
  return { ready, send, close: () => ws.close() };
}

const cdp = client(wsUrl); await cdp.ready;
const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
await cdp.send('Page.enable', {}, sessionId);
await cdp.send('Runtime.enable', {}, sessionId);
await cdp.send('Page.navigate', { url: URL_TARGET }, sessionId);
await sleep(2500);

// Scroll to bottom (trigger lazy content) then back to top so layout positions resolve.
await cdp.send('Runtime.evaluate', { expression: `(async()=>{const de=document.scrollingElement;const H=de.scrollHeight;for(let y=0;y<=H;y+=600){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,40));}window.scrollTo(0,0);})()`, awaitPromise: true }, sessionId).catch(() => {});
await sleep(800);

const json = await cdp.send('Runtime.evaluate', {
  expression: `(()=>{const de=document.scrollingElement;const H=de.scrollHeight;const seen=new Set();const out=[];
    const add=(e,kind)=>{const r=e.getBoundingClientRect();const top=(window.scrollY||de.scrollTop||0)+r.top;if(r.height<80||r.width<200)return;const key=Math.round(top)+':'+e.tagName;if(seen.has(key))return;seen.add(key);
      out.push({kind,pct:Math.round(top/H*100),tag:e.tagName.toLowerCase(),id:e.id||'',cls:(typeof e.className==='string'?e.className:'').trim().split(/\\s+/).slice(0,2).join('.'),aria:e.getAttribute('aria-label')||'',w:Math.round(r.width),h:Math.round(r.height),media:!!e.querySelector('video,canvas,iframe')||['VIDEO','CANVAS','IFRAME'].includes(e.tagName)});};
    document.querySelectorAll('section,main>div,header,footer,[id]').forEach(e=>add(e,'block'));
    document.querySelectorAll('video,iframe,canvas').forEach(e=>add(e,'media'));
    out.sort((a,b)=>a.pct-b.pct);
    return JSON.stringify({H, pageH:Math.round(H), out});})()`,
  returnByValue: true,
}, sessionId).then(r => r.result.value).catch(e => JSON.stringify({ error: e.message }));

const data = JSON.parse(json);
console.log(`\n── Section map: ${URL_TARGET}  (page height ${data.pageH}px) ──`);
console.log('  %↓  | media | size      | selector / label');
console.log('  ----+-------+-----------+--------------------------------');
for (const s of (data.out || [])) {
  const sel = s.id ? `#${s.id}` : (s.cls ? `${s.tag}.${s.cls}` : s.tag);
  console.log(`  ${String(s.pct).padStart(3)}% | ${s.media ? ' 🎬  ' : '     '} | ${String(s.w)}×${String(s.h)}`.padEnd(34) + ` | ${sel}${s.aria ? `  [${s.aria}]` : ''}`);
}
console.log(`\nPick one: tell me the % (e.g. "scroll to 62%") or the selector (e.g. "#showreel").`);

cdp.close(); chrome.kill('SIGKILL'); process.exit(0);
