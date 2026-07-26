import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');
const { getBrowserlessConfig } = require('../../../../api/_lib/browserless.cjs');
const { validateUrl } = require('../../../../api/_lib/safe-fetch.cjs');

export const maxDuration = 120;

// Maps a target site's scroll landmarks (sections + media) with their position
// as % down the page, so the Studio UI can offer "click a section to target it"
// when authoring a render recipe. DOM enumeration only — no GPU needed, so this
// runs on the existing Browserless (SwiftShader) fine.

function makeReqShim(request) {
  return { headers: { authorization: request.headers.get('authorization'), Authorization: request.headers.get('authorization') } };
}
function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

// In-Browserless function: scroll through (trigger lazy/pinned layout), then list
// sections + media with selector, %position, size, and an aria/text label hint.
const FN_CODE = `
export default async function ({ page }) {
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  await page.evaluate(async () => { const de=document.scrollingElement; const H=de.scrollHeight; for(let y=0;y<=H;y+=600){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,40));} window.scrollTo(0,0); });
  await new Promise(r => setTimeout(r, 700));
  const data = await page.evaluate(() => {
    const de=document.scrollingElement; const H=de.scrollHeight||1; const seen=new Set(); const out=[];
    const sel=(e)=>{ if(e.id) return '#'+e.id; const c=(typeof e.className==='string'?e.className:'').trim().split(/\\s+/).filter(Boolean).slice(0,2).join('.'); return c?e.tagName.toLowerCase()+'.'+c:e.tagName.toLowerCase(); };
    const add=(e)=>{ const r=e.getBoundingClientRect(); if(r.height<80||r.width<200) return; const top=(window.scrollY||de.scrollTop||0)+r.top; const key=Math.round(top)+':'+e.tagName; if(seen.has(key))return; seen.add(key);
      const label=(e.getAttribute('aria-label')||(e.querySelector('h1,h2,h3')?.textContent||'')||'').replace(/\\s+/g,' ').trim().slice(0,48);
      out.push({ pct:Math.round(top/H*100), selector:sel(e), tag:e.tagName.toLowerCase(), w:Math.round(r.width), h:Math.round(r.height), media:!!e.querySelector('video,canvas,iframe')||['VIDEO','CANVAS','IFRAME'].includes(e.tagName), label }); };
    document.querySelectorAll('section,main>div,header,footer,[id]').forEach(add);
    document.querySelectorAll('video,iframe,canvas').forEach(add);
    out.sort((a,b)=>a.pct-b.pct);
    return { pageHeight: Math.round(H), sections: out.slice(0, 60) };
  });
  return { data, type: 'application/json' };
}
`;

export async function POST(request) {
  try {
    const decoded = await verifyRequestUser(makeReqShim(request));
    const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
    if (!context.clientId) return json({ error: 'No clientId on user record.' }, 404);
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  let url;
  try { url = String((await request.json())?.url || '').trim(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }
  if (!/^https?:\/\/\S+$/i.test(url)) return json({ error: 'A valid http(s) URL is required.' }, 400);
  try {
    await validateUrl(url);
  } catch {
    return json({ error: 'A safe public http(s) URL is required.' }, 400);
  }

  const cfg = getBrowserlessConfig();
  if (!cfg.enabled) return json({ error: 'Browserless not configured.' }, 503);

  const endpoint = `${cfg.baseUrl}/function?token=${encodeURIComponent(cfg.token)}&timeout=45000`;
  const code = `const URL=${JSON.stringify(url)};\n${FN_CODE}`;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(50000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) return json({ error: `Section map failed (Browserless HTTP ${res.status}).` }, 502);
    const payload = await res.json().catch(() => null);
    const data = payload?.data ?? payload;
    if (!data?.sections) return json({ error: 'No sections returned.' }, 502);
    return json({ ok: true, url, pageHeight: data.pageHeight, sections: data.sections });
  } catch (err) {
    return json({ error: `Section map failed: ${err.message}` }, 502);
  }
}
