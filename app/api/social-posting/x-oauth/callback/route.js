import { NextResponse } from 'next/server';
import { completeXOAuthFlow } from '../../../../../features/social-posting/x-oauth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// X redirects the browser here after the user authorizes the app. There is no
// Authorization header on a redirect, so this route is gated by the single-use
// PKCE state stored when the admin clicked Connect — not by Firebase auth.

function page(title, message, ok) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{margin:0;font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;background:#0a0a0a;color:#f5f5f5;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}main{max-width:420px;text-align:center}h1{font-size:15px;letter-spacing:.08em;text-transform:uppercase;color:${ok ? '#7ee787' : '#ff7b72'}}p{font-size:13px;line-height:1.6;color:#bbb}</style></head>
<body><main><h1>${title}</h1><p>${message}</p><p>You can close this tab and return to the dashboard.</p></main>
<script>setTimeout(function(){ try { window.close(); } catch (e) {} }, 4000);</script></body></html>`;
  return new NextResponse(html, { status: ok ? 200 : 400, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const denied = params.get('error');
  if (denied) {
    return page('Connection cancelled', `X reported: ${denied}. No tokens were stored.`, false);
  }
  try {
    const { username } = await completeXOAuthFlow({
      code: params.get('code'),
      state: params.get('state'),
    });
    return page('X account connected', `Authorized as @${username || 'unknown'}. The dashboard card will pick this up on its next status refresh.`, true);
  } catch (err) {
    return page('Connection failed', err?.message || 'Token exchange failed.', false);
  }
}
