// registry.js - every MCP tool in one list. Static: no I/O at import. Handlers get ({args, ctx}) where
// ctx = {db, email, clientId, now, services}; services are injected by features/mcp/server.js (or fakes in tests).

import { strategyTools } from './tools/strategy.js';
import { dataTools } from './tools/data.js';
import { codebaseTools } from './tools/codebase.js';
import { syncTools } from './tools/syncs.js';
import { guideTool } from './guide.js';

export const registry = Object.freeze([guideTool, ...strategyTools, ...dataTools, ...codebaseTools, ...syncTools]);

export function findTool(name) {
  return registry.find((t) => t.name === name) || null;
}
