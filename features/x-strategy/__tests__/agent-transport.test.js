import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnthropicCaller, AgentError } from '../agent/loop.js';

const KEY = 'sk-ant-test-key-123';
const okFetch = (capture, body = { content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }) => async (url, init) => {
  capture.url = url; capture.init = init;
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
};
const args = { model: 'claude-sonnet-4-6', system: 'sys', messages: [{ role: 'user', content: 'q' }], tools: [{ name: 't', description: 'd', input_schema: { type: 'object' } }], maxTokens: 321 };

test('posts the Messages API shape with headers, model, tools, max_tokens', async () => {
  const cap = {};
  const out = await createAnthropicCaller({ apiKey: KEY, fetchImpl: okFetch(cap) })(args);
  assert.equal(cap.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(cap.init.method, 'POST');
  assert.equal(cap.init.headers['x-api-key'], KEY);
  assert.equal(cap.init.headers['anthropic-version'], '2023-06-01');
  assert.equal(cap.init.headers['content-type'], 'application/json');
  const body = JSON.parse(cap.init.body);
  assert.equal(body.model, 'claude-sonnet-4-6');
  assert.equal(body.max_tokens, 321);
  assert.equal(body.system, 'sys');
  assert.equal(body.tools[0].name, 't');
  assert.deepEqual(body.messages, args.messages);
  assert.equal(out.content[0].text, 'hi');
});

test('omits tools when none are given', async () => {
  const cap = {};
  await createAnthropicCaller({ apiKey: KEY, fetchImpl: okFetch(cap) })({ ...args, tools: [] });
  assert.ok(!('tools' in JSON.parse(cap.init.body)));
});

test('HTTP error status -> typed AgentError with no secret in the message', async () => {
  const f = async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: { message: `invalid x-api-key ${KEY}` } }) });
  await assert.rejects(createAnthropicCaller({ apiKey: KEY, fetchImpl: f })(args), (e) => {
    assert.ok(e instanceof AgentError);
    assert.equal(e.code, 'api-error');
    assert.equal(e.status, 401);
    assert.ok(!e.message.includes(KEY));
    return true;
  });
  const f429 = async () => ({ ok: false, status: 429, text: async () => 'slow down' });
  await assert.rejects(createAnthropicCaller({ apiKey: KEY, fetchImpl: f429 })(args), (e) => e.code === 'rate-limited' && e.status === 429);
});

test('network failure, bad body and missing key are typed and secret-free', async () => {
  const boom = async () => { throw new Error(`connect failed with ${KEY}`); };
  await assert.rejects(createAnthropicCaller({ apiKey: KEY, fetchImpl: boom })(args), (e) => e.code === 'transport' && !e.message.includes(KEY));
  const junk = async () => ({ ok: true, status: 200, text: async () => 'not json' });
  await assert.rejects(createAnthropicCaller({ apiKey: KEY, fetchImpl: junk })(args), (e) => e.code === 'bad-response');
  const shape = async () => ({ ok: true, status: 200, text: async () => '{"x":1}' });
  await assert.rejects(createAnthropicCaller({ apiKey: KEY, fetchImpl: shape })(args), (e) => e.code === 'bad-response');
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    await assert.rejects(createAnthropicCaller({ fetchImpl: async () => { throw new Error('should not fetch'); } })(args), (e) => e.code === 'missing-api-key');
  } finally { if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved; }
});
