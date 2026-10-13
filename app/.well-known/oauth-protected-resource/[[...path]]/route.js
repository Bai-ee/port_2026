import { resourceUrl } from '../../../../features/mcp/auth.js';
import { json, preflight, originFor } from '../../../../features/mcp/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// RFC 9728 protected-resource metadata. The optional catch-all also answers the path-suffixed form
// (/.well-known/oauth-protected-resource/api/mcp) that some clients request.
export function GET(request) {
  const o = originFor(request);
  if (o.error) return o.error;
  const { origin } = o;
  return json({
    resource: resourceUrl(origin),
    authorization_servers: [origin],
    bearer_methods_supported: ['header'],
    scopes_supported: ['hitloop'],
    resource_name: 'HITLOOP',
  });
}
export const OPTIONS = preflight;
