// common.js - shared helpers for tool definitions.

import { ToolError } from '../jsonrpc.js';

export const DEFAULT_CLIENT_ID = 'bryan-balli-WUoltG84';
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{3,80}$/;

export const CLIENT_ID_PROP = Object.freeze({
  type: 'string',
  description: `Optional. Which HITLOOP client to act on. Defaults to the owner's workspace (${DEFAULT_CLIENT_ID}). Must be an existing document in the "clients" collection.`,
});

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

/** The client this call targets: args.clientId when given (validated against `clients`), else the ctx default. */
export async function resolveClientId(ctx, args) {
  const asked = typeof args?.clientId === 'string' ? args.clientId.trim() : '';
  if (!asked || asked === ctx.clientId) return ctx.clientId;
  if (!CLIENT_ID_RE.test(asked)) throw new ToolError('clientId is not a valid client id.');
  const snap = await ctx.db.collection('clients').doc(asked).get();
  if (!snap.exists) throw new ToolError(`No client "${asked}" in the clients collection. Use query_collection on "clients" to list them.`);
  return asked;
}

export const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
export const int = (description, extra = {}) => ({ type: 'integer', description, ...extra });
