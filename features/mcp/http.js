// http.js - tiny helpers shared by the MCP and OAuth route files.

import { NextResponse } from 'next/server';
import { originOf, McpAuthError } from './auth.js';

export const CORS = Object.freeze({
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, accept',
  'access-control-expose-headers': 'www-authenticate, mcp-session-id',
});

export function json(body, status = 200, headers = {}) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store', ...CORS, ...headers } });
}

export const preflight = () => new NextResponse(null, { status: 204, headers: { ...CORS, 'access-control-max-age': '86400' } });

export function clientIp(request) {
  const xf = request.headers.get('x-forwarded-for');
  return (xf ? xf.split(',')[0] : request.headers.get('x-real-ip') || 'unknown').trim().slice(0, 64);
}

export const loadServer = () => import('./server.js');

/** The public origin, or a ready 503 response when production has no MCP_PUBLIC_ORIGIN. -> {origin} | {error: Response} */
export function originFor(request, env = process.env) {
  try {
    return { origin: originOf(request.headers, request.url, env) };
  } catch (err) {
    if (err instanceof McpAuthError) return { error: json({ error: 'server_error', error_description: err.message }, err.status) };
    throw err;
  }
}
