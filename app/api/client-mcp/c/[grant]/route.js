import { NextResponse } from 'next/server';
import { handleClientMcp } from '../../../../../features/client-mcp/handler.js';
import { json, preflight, originFor, CORS } from '../../../../../features/mcp/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// HITLOOP client-scoped MCP server - Streamable HTTP, stateless JSON-RPC, READ-ONLY, one client per connect link.
// See docs/source-of-truth/CLIENT-MCP-SERVER.md. The owner server (/api/mcp) is separate and unaffected.

export async function POST(request, { params }) {
  const env = process.env;
  if (!env.MCP_OAUTH_SECRET) return json({ error: 'MCP is not configured on this deployment.' }, 503);
  const o = originFor(request, env);
  if (o.error) return o.error;
  const { grant } = await params;

  let body; let bodyError = false;
  try { body = await request.json(); } catch { bodyError = true; }

  const { getClientServices } = await import('../../../../../features/client-mcp/server.js');
  const out = await handleClientMcp({
    authorization: request.headers.get('authorization'), body, bodyError, env, now: () => Date.now(),
    origin: o.origin, grantSecret: grant, deps: getClientServices(),
  });
  if (out.status === 202 || out.body === null) return new NextResponse(null, { status: 202, headers: { ...CORS } });
  return json(out.body, out.status, out.headers || {});
}

const notAllowed = () => json({ error: 'Method not allowed. POST JSON-RPC to this endpoint.' }, 405, { allow: 'POST, OPTIONS' });
export const GET = notAllowed;
export const DELETE = notAllowed;
export const OPTIONS = preflight;
