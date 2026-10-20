// auth.js - bearer authentication for /api/client-mcp/c/<secret>. Pure: env, clock and the grant store are injected.
// Accepts ONLY client-scoped OAuth tokens: audience /api/client-mcp, scope client:read, a HITLOOP client id (hcid)
// and the grant id (gid) of the URL being called. Owner tokens, the static owner token and tokens issued for another
// grant are all 401. The grant is re-read on every call so revoking it takes effect immediately.

import { verifyAccessToken, CLIENT_SCOPE } from '../mcp/oauth.js';
import { bearerOf, McpAuthError } from '../mcp/auth.js';
import { clientResourceBase, grantIdOf, isActiveGrant } from './grants.js';

/** @returns {Promise<{clientId:string, grantId:string}>} @throws McpAuthError 401 | 503 */
export async function authenticateClientBearer({ header, env, now, origin, grantSecret, grants }) {
  const secret = env.MCP_OAUTH_SECRET;
  if (!secret) throw new McpAuthError(503, 'MCP is not configured on this deployment (MCP_OAUTH_SECRET is unset).', 'not-configured');
  const token = bearerOf(header);
  if (!token) throw new McpAuthError(401, 'Missing bearer token.', 'missing');
  const v = verifyAccessToken(token, { secret, aud: clientResourceBase(origin), now });
  if (!v.ok) throw new McpAuthError(401, `Invalid token (${v.error}).`, v.error);
  const { scope, hcid, gid } = v.claims;
  if (scope !== CLIENT_SCOPE || typeof hcid !== 'string' || !hcid || typeof gid !== 'string') throw new McpAuthError(401, 'Invalid token (wrong-scope).', 'wrong-scope');
  if (gid !== grantIdOf(grantSecret)) throw new McpAuthError(401, 'Invalid token (wrong-grant).', 'wrong-grant');
  const grant = await grants.get(gid);
  if (!isActiveGrant(grant) || grant.clientId !== hcid) throw new McpAuthError(401, 'This connect link was revoked.', 'revoked');
  return { clientId: hcid, grantId: gid };
}
