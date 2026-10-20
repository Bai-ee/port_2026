import { resourceUrl } from '../../../../features/mcp/auth.js';
import { json, preflight, originFor } from '../../../../features/mcp/http.js';
import { CLIENT_SCOPE } from '../../../../features/mcp/oauth.js';
import { CLIENT_MCP_PATH, GRANT_SECRET_RE, clientResourceUrl } from '../../../../features/client-mcp/grants.js';

const CLIENT_SUFFIX_RE = new RegExp(`^/\\.well-known/oauth-protected-resource${CLIENT_MCP_PATH}/c/([^/]+)/?$`);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// RFC 9728 protected-resource metadata. The optional catch-all also answers the path-suffixed form
// (/.well-known/oauth-protected-resource/api/mcp) that some clients request. A client connect link
// (/api/client-mcp/c/<secret>) gets its own read-only resource; the owner answer is unchanged.
export function GET(request) {
  const o = originFor(request);
  if (o.error) return o.error;
  const { origin } = o;
  const m = CLIENT_SUFFIX_RE.exec(new URL(request.url).pathname);
  if (m && GRANT_SECRET_RE.test(m[1])) {
    return json({
      resource: clientResourceUrl(origin, m[1]),
      authorization_servers: [origin],
      bearer_methods_supported: ['header'],
      scopes_supported: [CLIENT_SCOPE],
      resource_name: 'HITLOOP client data (read-only)',
    });
  }
  return json({
    resource: resourceUrl(origin),
    authorization_servers: [origin],
    bearer_methods_supported: ['header'],
    scopes_supported: ['hitloop'],
    resource_name: 'HITLOOP',
  });
}
export const OPTIONS = preflight;
