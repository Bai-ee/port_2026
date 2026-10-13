import { json, preflight, originFor } from '../../../../features/mcp/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// RFC 8414 authorization-server metadata for the MCP connector flow (OAuth 2.1, PKCE S256, public clients).
export function GET(request) {
  const o = originFor(request);
  if (o.error) return o.error;
  const { origin } = o;
  return json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['hitloop'],
  });
}
export const OPTIONS = preflight;
