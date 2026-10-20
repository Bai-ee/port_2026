import { createRequire } from 'module';
import { checkAuthRequest, issueAuthCode, parseExtraHosts, isVerifiedIdentity, OAuthError, CLIENT_SCOPE } from '../../../../features/mcp/oauth.js';
import { checkRateLimit } from '../../../../features/mcp/limits.js';
import { json, preflight, loadServer, clientIp, originFor } from '../../../../features/mcp/http.js';
import { resolveClientConsent } from '../../../../features/client-mcp/consent.js';
import { createFirestoreGrantStore, parseClientResource } from '../../../../features/client-mcp/grants.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const require = createRequire(import.meta.url);
const { verifyRequestUser, isAdminEmail } = require('../../../../api/_lib/auth.cjs');

const PARAM_KEYS = ['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource'];
const extraHosts = () => parseExtraHosts(process.env.MCP_EXTRA_REDIRECT_HOSTS);

const pickParams = (src) => Object.fromEntries(PARAM_KEYS.map((k) => [k, typeof src?.[k] === 'string' ? src[k].slice(0, 1000) : undefined]));

// A `resource` that is a client connect link (features/client-mcp) = the read-only client flow; anything else = owner
// flow, unchanged. -> {consent|null} | {error: Response}
async function clientConsentFor(request, params, server) {
  if (!params.resource && !String(params.scope || '').split(/\s+/).includes(CLIENT_SCOPE)) return { consent: null };
  const o = originFor(request);
  if (o.error) return { error: o.error };
  return { consent: await resolveClientConsent({ params, origin: o.origin, grants: createFirestoreGrantStore(server.db) }) };
}

// GET: the consent page asks "are these authorize parameters valid, and who is asking?" (no auth needed, reveals only
// the registered client name and redirect host). An invalid client_id / redirect_uri is shown to the user, never redirected to.
export async function GET(request) {
  if (!process.env.MCP_OAUTH_SECRET) return json({ error: 'server_error', error_description: 'MCP is not configured on this deployment.' }, 503);
  const params = pickParams(Object.fromEntries(new URL(request.url).searchParams));
  try {
    const server = (await loadServer()).getServices();
    const c = await clientConsentFor(request, params, server);
    if (c.error) return c.error;
    const { client } = await checkAuthRequest(server.oauthStore, params, { extraHosts: extraHosts(), scope: c.consent?.binding.scope });
    const out = { ok: true, clientName: client.clientName, redirectHost: new URL(params.redirect_uri).host };
    return json(c.consent ? { ...out, kind: 'client', clientLabel: c.consent.label } : out);
  } catch (err) {
    if (err instanceof OAuthError) return json({ error: err.code, error_description: err.message }, err.status);
    return json({ error: 'server_error' }, 500);
  }
}

// POST: the signed-in admin pressed Allow. Verifies the Firebase ID token + admin, then issues a single-use code.
export async function POST(request) {
  if (!process.env.MCP_OAUTH_SECRET) return json({ error: 'server_error', error_description: 'MCP is not configured on this deployment.' }, 503);
  // Only a real client connect link takes the client branch; any other resource (e.g. /api/mcp) stays owner flow.
  const raw = await request.clone().json().catch(() => null);
  if (typeof raw?.resource === 'string') {
    const o = originFor(request);
    if (!o.error && parseClientResource(raw.resource, o.origin)) return allowClient(request, pickParams(raw));
  }
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

// Client connect link: the link is the credential (no sign-in). The code is bound to that grant's client, read-only.
async function allowClient(request, params) {
  try {
    const server = (await loadServer()).getServices();
    const now = Date.now();
    const rl = await checkRateLimit(server.services.counters(), `authz-client-ip:${clientIp(request)}`, { limit: 20, windowMs: 600_000, now });
    if (!rl.allowed) return json({ error: 'temporarily_unavailable', error_description: 'Too many authorizations.' }, 429);
    const c = await clientConsentFor(request, params, server);
    if (c.error) return c.error;
    const { redirectUrl } = await issueAuthCode(server.oauthStore, { params, email: c.consent.subject, now, extraHosts: extraHosts(), binding: c.consent.binding });
    return json({ ok: true, redirectUrl });
  } catch (err) {
    if (err instanceof OAuthError) return json({ error: err.code, error_description: err.message }, err.status);
    return json({ error: 'server_error' }, 500);
  }
}
export const OPTIONS = preflight;
