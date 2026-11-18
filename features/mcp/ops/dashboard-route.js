// dashboard-route.js - call a dashboard route handler in-process with the owner's authorization and ?as=<clientId>.
// Generalised from features/mcp/tools/client-brief.js callRoute (that file is owned elsewhere and left untouched).
// The route is loaded lazily and injectable (ctx.services.showcaseRoute) so tests never import app/ or Firebase.

import { ToolError } from '../jsonrpc.js';
import { ownerAuthorization } from '../owner-session.js';

/** A plain Request plus the `nextUrl` Next route handlers read. */
export function buildRoutedRequest(url, init) {
  const request = new Request(url, init);
  Object.defineProperty(request, 'nextUrl', { value: new URL(url), enumerable: false });
  return request;
}

/**
 * @param {object} ctx  MCP ctx (email, uid, origin)
 * @param {object} o    { route, path, method, query?, body?, clientId }
 * @returns {Promise<{status:number, json:object}>}
 */
export async function callDashboardRoute(ctx, { route, path, method = 'POST', query = {}, body, clientId }) {
  const authorization = await (ctx.services?.ownerAuthorization || ownerAuthorization)({ email: ctx.email, uid: ctx.uid });
  if (!authorization) throw new ToolError("Could not open the owner's dashboard session; run this from HITLOOP instead.");
  const origin = String(ctx.origin || process.env.MCP_PUBLIC_ORIGIN || '').replace(/\/+$/, '');
  if (!origin) throw new ToolError('The public origin is not known on this deployment; run this from HITLOOP instead.');
  const handler = route?.[method];
  if (typeof handler !== 'function') throw new ToolError('The route is not available on this deployment.');
  const qs = new URLSearchParams({ ...query, as: clientId });
  const init = { method, headers: { authorization, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) };
  const res = await handler(buildRoutedRequest(`${origin}${path}?${qs}`, init));
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}
