// common.js - shared helpers for tool definitions.

import { ToolError } from '../jsonrpc.js';
import { OWNER_EMAIL_DEFAULT } from '../auth.js';

export const DEFAULT_CLIENT_ID = 'bryan-balli-WUoltG84';
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{3,80}$/;

export const CLIENT_ID_PROP = Object.freeze({
  type: 'string',
  description: 'Which HITLOOP client to act on. Required unless you are the workspace owner, whose own workspace is the default. Must be an existing document in the "clients" collection.',
});

/** The home-client convenience default applies only to the owner's own email (never to another admin). */
export function homeClientIdFor(ctx) {
  const owner = String(process.env.MCP_OWNER_EMAIL || OWNER_EMAIL_DEFAULT).trim().toLowerCase();
  return ctx.clientId && String(ctx.email || '').trim().toLowerCase() === owner ? ctx.clientId : null;
}

/** Build a tool definition with sensible annotations. `kind`: 'read' | 'propose' | 'sync' | 'external'. */
export function defTool({ name, title, description, inputSchema = { type: 'object', properties: {} }, handler, kind = 'read', redactKeys = true }) {
  return {
    name, title: title || name, description, inputSchema, handler, kind, redactKeys,
    annotations: {
      title: title || name,
      readOnlyHint: kind === 'read' || kind === 'external',
      destructiveHint: false,
      idempotentHint: kind === 'read' || kind === 'external',
      openWorldHint: kind === 'external',
    },
  };
}

/** The client this call targets: args.clientId when given (validated against `clients`), else the owner's home default; anyone else must name one. */
export async function resolveClientId(ctx, args) {
  const asked = typeof args?.clientId === 'string' ? args.clientId.trim() : '';
  const home = homeClientIdFor(ctx);
  if (!asked && !home) throw new ToolError('clientId is required. Pass the client to act on (use query_collection on "clients" to list them).');
  if (!asked || asked === home) return home;
  if (!CLIENT_ID_RE.test(asked)) throw new ToolError('clientId is not a valid client id.');
  const snap = await ctx.db.collection('clients').doc(asked).get();
  if (!snap.exists) throw new ToolError(`No client "${asked}" in the clients collection. Use query_collection on "clients" to list them.`);
  return asked;
}

export const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
export const int = (description, extra = {}) => ({ type: 'integer', description, ...extra });
