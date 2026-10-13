import { registerClient, parseExtraHosts, OAuthError } from '../../../../features/mcp/oauth.js';
import { checkRateLimit } from '../../../../features/mcp/limits.js';
import { json, preflight, clientIp, loadServer } from '../../../../features/mcp/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// RFC 7591 dynamic client registration for MCP connectors (public PKCE clients). Rate limited per IP and globally.
export async function POST(request) {
  if (!process.env.MCP_OAUTH_SECRET) return json({ error: 'server_error', error_description: 'MCP is not configured on this deployment.' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_client_metadata', error_description: 'JSON body required' }, 400); }
  try {
    const server = (await loadServer()).getServices();
    const counters = server.services.counters();
    const now = Date.now();
    const hour = 3600_000;
    const perIp = await checkRateLimit(counters, `reg-ip:${clientIp(request)}`, { limit: 10, windowMs: hour, now });
    const global = await checkRateLimit(counters, 'reg-all', { limit: 100, windowMs: hour, now });
    if (!perIp.allowed || !global.allowed) return json({ error: 'temporarily_unavailable', error_description: 'Too many registrations; try again later.' }, 429, { 'retry-after': String(perIp.retryAfterSec) });
    return json(await registerClient(server.oauthStore, body, { now, extraHosts: parseExtraHosts(process.env.MCP_EXTRA_REDIRECT_HOSTS) }), 201);
  } catch (err) {
    if (err instanceof OAuthError) return json({ error: err.code, error_description: err.message }, err.status);
    return json({ error: 'server_error' }, 500);
  }
}
export const OPTIONS = preflight;
