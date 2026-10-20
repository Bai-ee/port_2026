// jsonrpc.js - stateless MCP (Streamable HTTP) dispatcher. Pure: the route supplies the registry and a ctx.
// Methods: initialize, notifications/*, ping, tools/list, tools/call. Everything else is -32601.

import { capText, redactValue } from './redact.js';

export const SUPPORTED_PROTOCOLS = Object.freeze(['2025-06-18', '2025-03-26', '2024-11-05']);
export const SERVER_VERSION = '1.0.0';
export const RESULT_MAX_CHARS = 40000;

export const RPC = Object.freeze({ PARSE: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602, INTERNAL: -32603 });

/** A tool failure the model should see (isError result), not a transport error. */
export class ToolError extends Error {
  constructor(message, extra) { super(message); this.name = 'ToolError'; this.extra = extra; }
}

const err = (id, code, message, data) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } });
const ok = (id, result) => ({ jsonrpc: '2.0', id, result });

// ---- minimal JSON-schema validation (required + primitive types + enum/bounds) ------------------------------

const typeOk = (t, v) => {
  switch (t) {
    case 'string': return typeof v === 'string';
    case 'integer': return Number.isInteger(v);
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'boolean': return typeof v === 'boolean';
    case 'array': return Array.isArray(v);
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    case 'null': return v === null;
    default: return true;
  }
};

function check(schema, value, path, errors, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 6) return;
  if (schema.type && !typeOk(schema.type, value)) { errors.push(`${path || 'input'} must be ${schema.type}`); return; }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} must be one of ${schema.enum.join(', ')}`);
  if (typeof value === 'string') {
    if (schema.maxLength != null && value.length > schema.maxLength) errors.push(`${path} must be at most ${schema.maxLength} characters`);
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${path} must be at least ${schema.minLength} characters`);
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${path} must be >= ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${path} must be <= ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${path} must have at most ${schema.maxItems} items`);
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${path} must have at least ${schema.minItems} items`);
    if (schema.items) value.forEach((v, i) => check(schema.items, v, `${path}[${i}]`, errors, depth + 1));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const r of schema.required || []) if (value[r] === undefined || value[r] === null) errors.push(`${path ? `${path}.` : ''}${r} is required`);
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) check(props[k], v, `${path ? `${path}.` : ''}${k}`, errors, depth + 1);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') check(schema.additionalProperties, v, `${path ? `${path}.` : ''}${k}`, errors, depth + 1);
    }
  }
}

/** @returns {string[]} problems (empty = valid) */
export function validateArgs(schema, args) {
  const errors = [];
  const value = args === undefined ? {} : args;
  check({ type: 'object', ...schema }, value, '', errors);
  return errors;
}

// ---- tool results ------------------------------------------------------------------------------------------

export function toolResult(value, { max = RESULT_MAX_CHARS, redactKeys = true } = {}) {
  const safe = redactValue(value, { keys: redactKeys });
  const { text, truncated } = capText(safe, max);
  const out = { content: [{ type: 'text', text }] };
  if (!truncated && safe && typeof safe === 'object' && !Array.isArray(safe)) out.structuredContent = safe;
  return out;
}

export function toolErrorResult(message) {
  return { content: [{ type: 'text', text: String(message).slice(0, 2000) }], isError: true };
}

export function publicTool(t) {
  return {
    name: t.name,
    title: t.title || t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    ...(t.annotations ? { annotations: t.annotations } : {}),
  };
}

// ---- dispatcher --------------------------------------------------------------------------------------------

// serverInfo: optional override (the client MCP names itself after the client); default = HITLOOP.
async function handleOne(msg, { registry, ctx, instructions, onCall, serverInfo }) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return err(msg?.id, RPC.INVALID_REQUEST, 'Invalid JSON-RPC request');
  }
  const isNotification = msg.id === undefined || msg.id === null;
  const { method, params } = msg;

  if (method.startsWith('notifications/')) return null;
  if (isNotification) return null; // any id-less message is a notification: no response

  try {
    switch (method) {
      case 'initialize': {
        const asked = params?.protocolVersion;
        return ok(msg.id, {
          protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'hitloop', title: 'HITLOOP', ...serverInfo, version: SERVER_VERSION },
          instructions,
        });
      }
      case 'ping': return ok(msg.id, {});
      case 'tools/list': return ok(msg.id, { tools: registry.map(publicTool) });
      case 'tools/call': {
        const name = params?.name;
        if (typeof name !== 'string') return err(msg.id, RPC.INVALID_PARAMS, 'params.name is required');
        const tool = registry.find((t) => t.name === name);
        if (!tool) return err(msg.id, RPC.INVALID_PARAMS, `Unknown tool: ${name.slice(0, 80)}`);
        const args = params.arguments === undefined ? {} : params.arguments;
        const problems = validateArgs(tool.inputSchema, args);
        const started = Date.now();
        let result;
        let good = true;
        if (problems.length) {
          good = false;
          result = toolErrorResult(`Invalid arguments for ${name}: ${problems.slice(0, 8).join('; ')}`);
        } else {
          try {
            result = toolResult(await tool.handler({ args, ctx }), { redactKeys: tool.redactKeys !== false });
          } catch (e) {
            good = false;
            const m = e instanceof ToolError || e?.expose || e?.status < 500 ? e.message : `Tool failed: ${String(e?.message || e).slice(0, 300)}`;
            result = toolErrorResult(m);
          }
        }
        if (onCall) { try { await onCall({ tool: name, args, ok: good, ms: Date.now() - started }); } catch { /* audit must never fail a call */ } }
        return ok(msg.id, result);
      }
      default: return err(msg.id, RPC.METHOD_NOT_FOUND, `Method not found: ${method.slice(0, 80)}`);
    }
  } catch (e) {
    return err(msg.id, RPC.INTERNAL, 'Internal error');
  }
}

/**
 * @param {unknown} body parsed JSON (single message or batch)
 * @returns {Promise<{status:number, body:object|object[]|null}>}  status 202 + null body when nothing needs a response
 */
export async function handleRpc(body, deps) {
  if (Array.isArray(body)) {
    if (!body.length) return { status: 400, body: err(null, RPC.INVALID_REQUEST, 'Empty batch') };
    if (body.length > 20) return { status: 400, body: err(null, RPC.INVALID_REQUEST, 'Batch too large (max 20)') };
    const out = [];
    for (const m of body) { const r = await handleOne(m, deps); if (r) out.push(r); }
    return out.length ? { status: 200, body: out } : { status: 202, body: null };
  }
  const r = await handleOne(body, deps);
  return r ? { status: 200, body: r } : { status: 202, body: null };
}
