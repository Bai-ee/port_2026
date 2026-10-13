// auth.js - bearer authentication for /api/mcp. Pure: env, clock and the admin check are injected.
// FAILS CLOSED: with MCP_OAUTH_SECRET unset nothing is accepted (503), not even the static owner token.

import { verifyAccessToken, safeEqual } from './oauth.js';

export const OWNER_EMAIL_DEFAULT = 'bryanballi@gmail.com';

export class McpAuthError extends Error {
  constructor(status, message, code) { super(message); this.name = 'McpAuthError'; this.status = status; this.code = code; }
}

export const bearerOf = (header) => {
  const m = /^Bearer\s+(.+)$/i.exec(String(header ?? '').trim());
  return m ? m[1].trim() : null;
};

export const OWNER_TOKEN_MIN_LENGTH = 32;
export const isProduction = (env = {}) => env.VERCEL_ENV === 'production';

/**
 * Public origin for metadata/audience URLs. MCP_PUBLIC_ORIGIN wins. In production it is REQUIRED (fails closed with a
 * 503): deriving the token audience from request headers would let a forged Host header pick the audience.
 * Elsewhere (preview, dev) it falls back to the forwarded host.
 */
export function originOf(headers, url, env = {}) {
  const fixed = String(env.MCP_PUBLIC_ORIGIN || '').trim().replace(/\/+$/, '');
  if (fixed) return fixed;
  if (isProduction(env)) throw new McpAuthError(503, 'MCP is not configured on this deployment (MCP_PUBLIC_ORIGIN is unset).', 'not-configured');
  const get = (k) => (typeof headers?.get === 'function' ? headers.get(k) : headers?.[k]);
  const host = get('x-forwarded-host') || get('host');
  const local = host && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = get('x-forwarded-proto') || (local ? 'http' : 'https');
  return host ? `${proto}://${host}` : new URL(url).origin;
}

export const resourceUrl = (origin) => `${origin}/api/mcp`;
export const metadataUrl = (origin) => `${origin}/.well-known/oauth-protected-resource`;
export const wwwAuthenticate = (origin) => `Bearer resource_metadata="${metadataUrl(origin)}"`;

/**
 * @returns {Promise<{email:string, via:'oauth'|'owner-token', tokenId:string}>}
 * @throws McpAuthError 401 (missing/invalid) | 403 (not an admin) | 503 (not configured)
 */
export async function authenticateBearer({ header, env, now, origin, isAdmin }) {
  const secret = env.MCP_OAUTH_SECRET;
  if (!secret) throw new McpAuthError(503, 'MCP is not configured on this deployment (MCP_OAUTH_SECRET is unset).', 'not-configured');
  const token = bearerOf(header);
  if (!token) throw new McpAuthError(401, 'Missing bearer token.', 'missing');

  let email; let via; let tokenId;
  const owner = env.MCP_OWNER_TOKEN;
  // A short static token is brute-forceable: ignore it unless it is long enough to be a real secret.
  if (typeof owner === 'string' && owner.length >= OWNER_TOKEN_MIN_LENGTH && safeEqual(token, owner)) {
    email = String(env.MCP_OWNER_EMAIL || OWNER_EMAIL_DEFAULT).toLowerCase();
    via = 'owner-token'; tokenId = 'owner-token';
  } else {
    const v = verifyAccessToken(token, { secret, aud: resourceUrl(origin), now });
    if (!v.ok) throw new McpAuthError(401, `Invalid token (${v.error}).`, v.error);
    email = v.claims.sub; via = 'oauth'; tokenId = v.claims.jti || 'no-jti';
  }
  // Re-check on every call: revoking admin access cuts the connector off without waiting for the token to expire.
  if (!(await isAdmin(email))) throw new McpAuthError(403, 'That account is not an admin.', 'not-admin');
  return { email, via, tokenId };
}
