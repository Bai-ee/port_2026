// grants.js - connect grants for the client-scoped MCP server. Pure (node:crypto only); Firestore store at the bottom.
//
// A grant = one secret connect URL for one HITLOOP client: `${origin}/api/client-mcp/c/<secret>`. The owner creates it
// with scripts/client-mcp/grant.mjs and sends the URL to the client. Only SHA-256(secret) is stored (the doc id), so
// a database read never reveals a working URL. Revoking a grant cuts every token it issued off on the next call.

import { sha256hex } from '../mcp/oauth.js';

export const GRANT_COLLECTION = 'mcp_client_grants';
export const CLIENT_MCP_PATH = '/api/client-mcp';
export const GRANT_SECRET_RE = /^[A-Za-z0-9_-]{32,64}$/;
const GRANT_ID_RE = /^[a-f0-9]{64}$/;

export const grantIdOf = (secret) => sha256hex(secret);

/** Token audience for every client-scoped token (the grant is bound separately by the gid claim). */
export const clientResourceBase = (origin) => `${origin}${CLIENT_MCP_PATH}`;
export const clientResourceUrl = (origin, secret) => `${clientResourceBase(origin)}/c/${secret}`;
export const clientMetadataUrl = (origin, secret) => `${origin}/.well-known/oauth-protected-resource${CLIENT_MCP_PATH}/c/${secret}`;

/** The grant secret in a client connect URL on THIS origin, or null (wrong origin, wrong path, bad secret). */
export function parseClientResource(resource, origin) {
  if (typeof resource !== 'string' || resource.length > 500 || !origin) return null;
  let u;
  try { u = new URL(resource); } catch { return null; }
  if (u.origin !== new URL(origin).origin || u.search || u.hash) return null;
  const m = new RegExp(`^${CLIENT_MCP_PATH}/c/([^/]+)/?$`).exec(u.pathname);
  return m && GRANT_SECRET_RE.test(m[1]) ? m[1] : null;
}

/** A grant that may connect: exists, not revoked, names a client. */
export const isActiveGrant = (g) => Boolean(g && !g.revoked && typeof g.clientId === 'string' && g.clientId);

export function createMemoryGrantStore(rows = {}) {
  const m = new Map(Object.entries(rows));
  return { get: async (gid) => m.get(gid) ?? null, _raw: m };
}

export function createFirestoreGrantStore(db) {
  return {
    get: async (gid) => {
      if (!GRANT_ID_RE.test(String(gid))) return null;
      const s = await db.collection(GRANT_COLLECTION).doc(gid).get();
      return s.exists ? s.data() : null;
    },
  };
}
