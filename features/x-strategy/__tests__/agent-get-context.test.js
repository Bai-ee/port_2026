import test from 'node:test';
import assert from 'node:assert/strict';
import { runReadTool } from '../agent/tools.js';

test('get_context returns exactly what the injected getContext returns', async () => {
  const value = { clientId: 'c1', versions: { hash: 'abc' } };
  let calls = 0;
  const out = await runReadTool('get_context', {}, { getContext: async () => { calls += 1; return value; } });
  assert.equal(out, value);
  assert.equal(calls, 1);
});

test('get_context throws a clear error when getContext is not injected (no silent empty answer)', async () => {
  await assert.rejects(() => runReadTool('get_context', {}, {}), /getContext is not available/);
  await assert.rejects(() => runReadTool('get_context', {}, undefined), /getContext is not available/);
});
