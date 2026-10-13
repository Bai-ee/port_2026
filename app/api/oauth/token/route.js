import { handleTokenRequest, OAuthError } from '../../../../features/mcp/oauth.js';
import { checkRateLimit } from '../../../../features/mcp/limits.js';
import { resourceUrl } from '../../../../features/mcp/auth.js';
import { json, preflight, clientIp, loadServer, originFor } from '../../../../features/mcp/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function readBody(request) {
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/json')) return request.json();
  const text = await request.text();
  return Object.fromEntries(new URLSearchParams(text));
}

// OAuth token endpoint: authorization_code (PKCE S256, single use) and refresh_token (rotating).
export async function POST(request) {
  const secret = process.env.MCP_OAUTH_SECRET;
  if (!secret) return json({ error: 'server_error', error_description: 'MCP is not configured on this deployment.' }, 503);
  let body;
  try { body = await readBody(request); } catch { return json({ error: 'invalid_request', error_description: 'Unreadable body' }, 400); }
  try {
    const server = (await loadServer()).getServices();
    const now = Date.now();
    const rl = await checkRateLimit(server.services.counters(), `token-ip:${clientIp(request)}`, { limit: 60, windowMs: 600_000, now });
    if (!rl.allowed) return json({ error: 'temporarily_unavailable', error_description: 'Too many requests.' }, 429, { 'retry-after': String(rl.retryAfterSec) });
    const o = originFor(request);
    if (o.error) return o.error;
    const aud = resourceUrl(o.origin);
    const tokens = await handleTokenRequest(server.oauthStore, body, { secret, aud, now });
    return json(tokens, 200, { pragma: 'no-cache' });
  } catch (err) {
    if (err instanceof OAuthError) return json({ error: err.code, error_description: err.message }, err.status);
    return json({ error: 'server_error' }, 500);
  }
}
export const OPTIONS = preflight;
