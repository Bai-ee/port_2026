import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRpc, validateArgs, ToolError, SUPPORTED_PROTOCOLS, RPC } from '../jsonrpc.js';

const tools = [
  { name: 'echo', description: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 5 }, n: { type: 'integer', minimum: 1, maximum: 3 } }, required: ['text'] }, handler: async ({ args }) => ({ said: args.text, token: 'abc', n: args.n }) },
  { name: 'boom', description: 'boom', inputSchema: { type: 'object', properties: {} }, handler: async () => { throw new Error('secret internals'); } },
  { name: 'soft', description: 'soft', inputSchema: { type: 'object', properties: {} }, handler: async () => { throw new ToolError('nice message'); } },
  { name: 'big', description: 'big', inputSchema: { type: 'object', properties: {} }, handler: async () => ({ blob: 'x'.repeat(50000) }) },
  { name: 'list', description: 'list', inputSchema: { type: 'object', properties: {} }, handler: async () => [1, 2, 3] },
];
const calls = [];
const deps = { registry: tools, ctx: {}, instructions: 'INSTR', onCall: (c) => calls.push(c) };
const rpc = (body) => handleRpc(body, deps);
const req = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, params });

test('initialize echoes a supported protocol version, else the newest; declares tools capability and instructions', async () => {
  for (const v of SUPPORTED_PROTOCOLS) {
    const r = await rpc(req('initialize', { protocolVersion: v }));
    assert.equal(r.body.result.protocolVersion, v);
  }
  const r = await rpc(req('initialize', { protocolVersion: '1999-01-01' }));
  assert.equal(r.body.result.protocolVersion, '2025-06-18');
  assert.deepEqual(r.body.result.capabilities, { tools: { listChanged: false } });
  assert.equal(r.body.result.serverInfo.name, 'hitloop');
  assert.equal(r.body.result.instructions, 'INSTR');
  assert.equal(r.body.id, 1);
});

test('notifications get 202 and no body; ping works', async () => {
  const n = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.deepEqual(n, { status: 202, body: null });
  assert.deepEqual((await rpc(req('ping'))).body.result, {});
});

test('tools/list exposes name, description, inputSchema, and no handler', async () => {
  const r = await rpc(req('tools/list'));
  assert.equal(r.body.result.tools.length, tools.length);
  for (const t of r.body.result.tools) {
    assert.ok(t.name && t.description && t.inputSchema);
    assert.equal(t.handler, undefined);
  }
});

test('tools/call: success returns text + structuredContent and is redacted', async () => {
  const r = await rpc(req('tools/call', { name: 'echo', arguments: { text: 'hi', n: 2 } }));
  const res = r.body.result;
  assert.equal(res.isError, undefined);
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.said, 'hi');
  assert.equal(parsed.token, '[redacted]');
  assert.equal(res.structuredContent.said, 'hi');
});

test('tools/call: invalid args become isError results, not transport errors', async () => {
  for (const args of [{}, { text: 5 }, { text: 'toolong' }, { text: 'ok', n: 9 }]) {
    const r = await rpc(req('tools/call', { name: 'echo', arguments: args }));
    assert.equal(r.status, 200);
    assert.equal(r.body.result.isError, true);
    assert.match(r.body.result.content[0].text, /Invalid arguments/);
  }
});

test('tools/call: thrown errors are isError; internal errors do not leak details as a 500', async () => {
  const soft = (await rpc(req('tools/call', { name: 'soft' }))).body.result;
  assert.equal(soft.isError, true);
  assert.equal(soft.content[0].text, 'nice message');
  const boom = (await rpc(req('tools/call', { name: 'boom' }))).body;
  assert.equal(boom.result.isError, true);
  assert.ok(!boom.error);
});

test('tools/call: unknown tool and missing name are JSON-RPC invalid params', async () => {
  assert.equal((await rpc(req('tools/call', { name: 'nope' }))).body.error.code, RPC.INVALID_PARAMS);
  assert.equal((await rpc(req('tools/call', {}))).body.error.code, RPC.INVALID_PARAMS);
});

test('large results are capped and say so; arrays have no structuredContent', async () => {
  const big = (await rpc(req('tools/call', { name: 'big' }))).body.result;
  assert.ok(big.content[0].text.length < 41000);
  assert.match(big.content[0].text, /truncated/);
  assert.equal(big.structuredContent, undefined);
  const arr = (await rpc(req('tools/call', { name: 'list' }))).body.result;
  assert.equal(arr.structuredContent, undefined);
  assert.deepEqual(JSON.parse(arr.content[0].text), [1, 2, 3]);
});

test('unknown method is -32601; malformed requests are -32600', async () => {
  assert.equal((await rpc(req('resources/list'))).body.error.code, RPC.METHOD_NOT_FOUND);
  assert.equal((await rpc({ nope: true })).body.error.code, RPC.INVALID_REQUEST);
  assert.equal((await rpc('str')).body.error.code, RPC.INVALID_REQUEST);
});

test('batch: mixed requests + notifications; all-notification batch is 202; empty/oversized rejected', async () => {
  const r = await rpc([req('ping', undefined, 1), { jsonrpc: '2.0', method: 'notifications/initialized' }, req('tools/list', undefined, 2)]);
  assert.equal(r.status, 200);
  assert.equal(r.body.length, 2);
  assert.deepEqual(r.body.map((x) => x.id), [1, 2]);
  assert.deepEqual(await rpc([{ jsonrpc: '2.0', method: 'notifications/initialized' }]), { status: 202, body: null });
  assert.equal((await rpc([])).status, 400);
  assert.equal((await rpc(Array.from({ length: 21 }, (_, i) => req('ping', undefined, i + 1)))).status, 400);
});

test('onCall audit hook sees each tool call, and its failure never breaks the call', async () => {
  calls.length = 0;
  await rpc(req('tools/call', { name: 'soft' }));
  await rpc(req('tools/call', { name: 'echo', arguments: { text: 'a' } }));
  assert.deepEqual(calls.map((c) => [c.tool, c.ok]), [['soft', false], ['echo', true]]);
  const r = await handleRpc(req('tools/call', { name: 'echo', arguments: { text: 'a' } }), { ...deps, onCall: () => { throw new Error('audit down'); } });
  assert.equal(r.body.result.isError, undefined);
});

test('validateArgs: nested items and enums', () => {
  const schema = { type: 'object', properties: { list: { type: 'array', maxItems: 2, items: { type: 'object', properties: { k: { type: 'string' } }, required: ['k'] } }, mode: { type: 'string', enum: ['a', 'b'] } } };
  assert.deepEqual(validateArgs(schema, { list: [{ k: 'x' }], mode: 'a' }), []);
  assert.ok(validateArgs(schema, { list: [{}] }).length);
  assert.ok(validateArgs(schema, { list: [{ k: 'x' }, { k: 'y' }, { k: 'z' }] }).length);
  assert.ok(validateArgs(schema, { mode: 'c' }).length);
  assert.ok(validateArgs(schema, 'string').length);
});
