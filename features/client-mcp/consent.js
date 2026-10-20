// consent.js - the client-connect branch of /api/oauth/authorize. Pure: grant store and origin injected.
// An authorize request whose `resource` is a client connect URL on this origin is a client request: the connect URL
// itself is the credential, so no HITLOOP sign-in is needed, and the code is bound to that grant's client only.

import { OAuthError, CLIENT_SCOPE } from '../mcp/oauth.js';
import { parseClientResource, grantIdOf, isActiveGrant, clientResourceBase } from './grants.js';

/** Sub claim for client tokens: never an email, so the owner server's admin check can never pass for it. */
export const clientSubject = (gid) => `client-grant:${String(gid).slice(0, 12)}`;

/**
 * @returns {Promise<null | {gid:string, clientId:string, label:string, binding:object, subject:string}>}
 *   null = not a client request (owner flow, unchanged). Throws OAuthError for a revoked/unknown link or a wrong scope.
 */
export async function resolveClientConsent({ params, origin, grants }) {
  const secret = parseClientResource(params?.resource, origin);
  if (!secret) {
    if (params?.scope && String(params.scope).split(/\s+/).includes(CLIENT_SCOPE)) {
      throw new OAuthError('invalid_target', 'Client access needs the connect link you were sent (the resource parameter is missing or not a HITLOOP connect link).');
    }
    return null;
  }
  const gid = grantIdOf(secret);
  const grant = await grants.get(gid);
  if (!isActiveGrant(grant)) throw new OAuthError('access_denied', 'This connect link is not valid or was revoked. Ask HITLOOP for a new one.', 403);
  return {
    gid, clientId: grant.clientId, label: String(grant.label || grant.clientId).slice(0, 80), subject: clientSubject(gid),
    binding: { aud: clientResourceBase(origin), scope: CLIENT_SCOPE, hcid: grant.clientId, gid },
  };
}
