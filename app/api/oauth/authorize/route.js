import { createRequire } from 'module';
import { checkAuthRequest, issueAuthCode, parseExtraHosts, isVerifiedIdentity, OAuthError } from '../../../../features/mcp/oauth.js';
import { checkRateLimit } from '../../../../features/mcp/limits.js';
import { json, preflight, loadServer } from '../../../../features/mcp/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const require = createRequire(import.meta.url);
const { verifyRequestUser, isAdminEmail } = require('../../../../api/_lib/auth.cjs');

const PARAM_KEYS = ['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'state', 'scope'];
const extraHosts = () => parseExtraHosts(process.env.MCP_EXTRA_REDIRECT_HOSTS);

const pickParams = (src) => Object.fromEntries(PARAM_KEYS.map((k) => [k, typeof src?.[k] === 'string' ? src[k].slice(0, 1000) : undefined]));

// GET: the consent page asks "are these authorize parameters valid, and who is asking?" (no auth needed, reveals only
// the registered client name and redirect host). An invalid client_id / redirect_uri is shown to the user, never redirected to.
export async function GET(request) {
  if (!process.env.MCP_OAUTH_SECRET) return json({ error: 'server_error', error_description: 'MCP is not configured on this deployment.' }, 503);
  const params = pickParams(Object.fromEntries(new URL(request.url).searchParams));
  try {
    const { client } = await checkAuthRequest((await loadServer()).getServices().oauthStore, params, { extraHosts: extraHosts() });
    return json({ ok: true, clientName: client.clientName, redirectHost: new URL(params.redirect_uri).host });
  } catch (err) {
    if (err instanceof OAuthError) return json({ error: err.code, error_description: err.message }, err.status);
    return json({ error: 'server_error' }, 500);
  }
}

// POST: the signed-in admin pressed Allow. Verifies the Firebase ID token + admin, then issues a single-use code.
export async function POST(request) {
  if (!process.env.MCP_OAUTH_SECRET) return json({ error: 'server_error', error_description: 'MCP is not configured on this deployment.' }, 503);
  let decoded;
  try {
    decoded = await verifyRequestUser({ headers: { authorization: request.headers.get('authorization'), Authorization: request.headers.get('authorization') } });
  } catch {
    return json({ error: 'access_denied', error_description: 'Sign in to HITLOOP first.' }, 401);
  }
  if (!isVerifiedIdentity(decoded)) return json({ error: 'access_denied', error_description: 'Verify your email address (or sign in with Google) before connecting an MCP client.' }, 403);
  if (!(await isAdminEmail(decoded?.email))) return json({ error: 'access_denied', error_description: 'Only HITLOOP admin accounts can connect an MCP client.' }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  try {
    const server = (await loadServer()).getServices();
    const now = Date.now();
    const rl = await checkRateLimit(server.services.counters(), `authz:${decoded.email}`, { limit: 20, windowMs: 600_000, now });
    if (!rl.allowed) return json({ error: 'temporarily_unavailable', error_description: 'Too many authorizations.' }, 429);
    const { redirectUrl } = await issueAuthCode(server.oauthStore, { params: pickParams(body), email: decoded.email, now, extraHosts: extraHosts() });
    return json({ ok: true, redirectUrl });
  } catch (err) {
    if (err instanceof OAuthError) return json({ error: err.code, error_description: err.message }, err.status);
    return json({ error: 'server_error' }, 500);
  }
}
export const OPTIONS = preflight;
