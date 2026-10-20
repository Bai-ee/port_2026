// handler.js - one POST to /api/client-mcp/c/<secret>, transport-agnostic so it is testable with fakes.
// Same stateless Streamable HTTP JSON-RPC dispatcher as the owner server (features/mcp/jsonrpc.js); different auth
// (client-scoped tokens only), a different, read-only tool registry and audit rows without arguments.

import { handleRpc, RPC } from '../mcp/jsonrpc.js';
import { McpAuthError } from '../mcp/auth.js';
import { checkRateLimit, rpcCost } from '../mcp/limits.js';
import { authenticateClientBearer } from './auth.js';
import { GRANT_SECRET_RE, clientMetadataUrl } from './grants.js';
import { clientRegistry, CLIENT_INSTRUCTIONS } from './tools.js';

const rpcError = (code, message) => ({ jsonrpc: '2.0', id: null, error: { code, message } });

/** Audit row: who (client + grant prefix), which tool, ok or not, how long. Never the arguments or the result. */
export const clientAuditEntry = ({ now, clientId, grantId, tool, ok, ms }) => ({
  at: new Date(now).toISOString(), via: 'client-mcp', clientId, grant: String(grantId).slice(0, 12),
  tool: String(tool).slice(0, 80), ok: Boolean(ok), ms: Math.round(ms) || 0,
});

/**
 * @param {{authorization:string|null, body:unknown, bodyError?:boolean, env:object, now:()=>number, origin:string,
 *          grantSecret:string, deps:{grants, counters, audit, services}}} req
 * @returns {Promise<{status:number, body:object|object[]|null, headers?:object}>}
 */
export async function handleClientMcp({ authorization, body, bodyError = false, env, now, origin, grantSecret, deps }) {
  if (!env.MCP_OAUTH_SECRET) return { status: 503, body: { error: 'MCP is not configured on this deployment.' } };
  if (!GRANT_SECRET_RE.test(String(grantSecret || ''))) return { status: 404, body: { error: 'Unknown connect link.' } };
  const challenge = { 'www-authenticate': `Bearer resource_metadata="${clientMetadataUrl(origin, grantSecret)}"` };

  let auth;
  try {
    auth = await authenticateClientBearer({ header: authorization, env, now: now(), origin, grantSecret, grants: deps.grants });
  } catch (err) {
    if (err instanceof McpAuthError) return { status: err.status, body: { error: err.message }, headers: err.status === 401 ? challenge : {} };
    return { status: 500, body: { error: 'Authentication failed.' } };
  }

  if (bodyError) return { status: 400, body: rpcError(RPC.PARSE, 'Parse error') };

  const limit = await checkRateLimit(deps.counters, `client-mcp:${auth.grantId}`, { now: now(), cost: rpcCost(body) });
  if (!limit.allowed) return { status: 429, body: { error: `Rate limit: ${limit.limit} calls per 10 minutes.` }, headers: { 'retry-after': String(limit.retryAfterSec) } };

  const ctx = { clientId: auth.clientId, now, services: deps.services };
  return handleRpc(body, {
    registry: clientRegistry, ctx, instructions: CLIENT_INSTRUCTIONS,
    onCall: ({ tool, ok, ms }) => deps.audit.write(clientAuditEntry({ now: now(), clientId: auth.clientId, grantId: auth.grantId, tool, ok, ms })),
  });
}
