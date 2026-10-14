import { NextResponse } from 'next/server';
import { createRequire } from 'node:module';
import { handleRpc, RPC } from '../../../features/mcp/jsonrpc.js';
import { registry } from '../../../features/mcp/registry.js';
import { authenticateBearer, McpAuthError, wwwAuthenticate } from '../../../features/mcp/auth.js';
import { checkRateLimit, auditEntry, rpcCost } from '../../../features/mcp/limits.js';
import { json, preflight, loadServer, originFor, CORS } from '../../../features/mcp/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 300s is an existing tier (VERCEL-HOBBY-DEPLOYMENT.md): the free refresh/NAS tools can wait for a worker for a while.
export const maxDuration = 300;

// HITLOOP MCP server - Streamable HTTP, stateless JSON-RPC. See docs/source-of-truth/HITLOOP-MCP-SERVER.md.
// Auth: OAuth 2.1 access token (or a static MCP_OWNER_TOKEN of 32+ chars), admin accounts only. Fails closed (503) without
// MCP_OAUTH_SECRET. Nothing here posts, schedules, approves, deletes or writes to X.

const require = createRequire(import.meta.url);

// MCP auth is email-only; proposals/records attribute to the admin's Firebase uid. Unknown => null (attribution only).
async function uidForEmail(email) {
  try { return (await require('../../../api/_lib/firebase-admin.cjs').adminAuth.getUserByEmail(email)).uid || null; } catch { return null; }
}

const rpcError = (code, message) => ({ jsonrpc: '2.0', id: null, error: { code, message } });

export async function POST(request) {
  const env = process.env;
  if (!env.MCP_OAUTH_SECRET) return json({ error: 'MCP is not configured on this deployment.' }, 503);
  const o = originFor(request, env);
  if (o.error) return o.error;
  const { origin } = o;

  let auth;
  try {
    auth = await authenticateBearer({
      header: request.headers.get('authorization'), env, now: Date.now(), origin,
      isAdmin: async (email) => (await loadServer()).getServices().isAdmin(email),
    });
  } catch (err) {
    if (err instanceof McpAuthError) {
      const headers = err.status === 401 ? { 'www-authenticate': wwwAuthenticate(origin) } : {};
      return json({ error: err.message }, err.status, headers);
    }
    return json({ error: 'Authentication failed.' }, 500);
  }

  const server = (await loadServer()).getServices();
  const now = () => Date.now();

  let body;
  try { body = await request.json(); } catch { return json(rpcError(RPC.PARSE, 'Parse error'), 400); }

  // Keyed on the authenticated account (not the token id: a fresh token must not reset the budget); every tools/call
  // in a batch counts, so batching cannot multiply the allowance.
  const limit = await checkRateLimit(server.services.counters(), `mcp:${auth.email}`, { now: now(), cost: rpcCost(body) });
  if (!limit.allowed) return json({ error: `Rate limit: ${limit.limit} calls per 10 minutes.` }, 429, { 'retry-after': String(limit.retryAfterSec) });

  const ctx = { db: server.db, email: auth.email, uid: await uidForEmail(auth.email), clientId: server.defaultClientId, now, services: server.services };
  const out = await handleRpc(body, {
    registry, ctx, instructions: server.getInstructions(),
    onCall: ({ tool, args, ok, ms }) => server.audit.write(auditEntry({ now: now(), email: auth.email, tool, args, ok, ms })),
  });
  if (out.status === 202 || out.body === null) return new NextResponse(null, { status: 202, headers: { ...CORS } });
  return json(out.body, out.status);
}

// Stateless server: no server-initiated stream and no sessions to close.
const notAllowed = () => json({ error: 'Method not allowed. POST JSON-RPC to this endpoint.' }, 405, { allow: 'POST, OPTIONS' });
export const GET = notAllowed;
export const DELETE = notAllowed;
export const OPTIONS = preflight;
