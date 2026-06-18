import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');

export const maxDuration = 20;

// Does this URL allow being embedded in an iframe? The Studio's live preview is
// a CSS3D iframe; sites with X-Frame-Options: DENY/SAMEORIGIN or CSP
// frame-ancestors that exclude us render blank. The Studio uses this to fall
// back to a captured-frame preview instead of showing a broken/blank device.

function makeReqShim(request) {
  return { headers: { authorization: request.headers.get('authorization'), Authorization: request.headers.get('authorization') } };
}
function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(request) {
  try {
    await verifyRequestUser(makeReqShim(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  const url = String(new URL(request.url).searchParams.get('url') || '').trim();
  if (!/^https?:\/\/\S+$/i.test(url)) return json({ error: 'A valid http(s) URL is required.' }, 400);

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; HitloopStudio/1.0)' },
    });
    const xfo = (res.headers.get('x-frame-options') || '').toLowerCase();
    const csp = (res.headers.get('content-security-policy') || '').toLowerCase();

    let blockedBy = null;
    if (/\b(deny|sameorigin)\b/.test(xfo)) {
      blockedBy = 'x-frame-options';
    } else {
      const m = csp.match(/frame-ancestors([^;]*)/);
      if (m) {
        const sources = m[1].trim();
        // 'none', or any explicit allowlist that won't include our dashboard
        // origin → treat as blocked. '*' (or absent) is embeddable.
        if (sources && sources !== '*' && !/\*/.test(sources)) blockedBy = 'csp-frame-ancestors';
      }
    }

    return json({ embeddable: !blockedBy, blockedBy, httpStatus: res.status });
  } catch (err) {
    // Network/timeout — can't confirm; treat as embeddable so we don't block
    // the normal iframe path on a transient error.
    return json({ embeddable: true, blockedBy: null, error: err.message });
  }
}
