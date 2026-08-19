'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { callAnthropic } = require('../_anthropic-client.js');

// callAnthropic is a raw fetch() — no SDK timeout/retry underneath. These
// tests pin the Phase 1 guarantee (EMAIL-REBUILD-PLAN.md): every call carries
// an AbortSignal so a hung provider connection can never ride a serverless
// function to its maxDuration kill.

const realFetch = global.fetch;
let savedKey;

beforeEach(() => {
  savedKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
});

afterEach(() => {
  global.fetch = realFetch;
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
});

test('every call carries an abort signal', async () => {
  let seenSignal = null;
  global.fetch = async (url, opts) => {
    seenSignal = opts.signal;
    return { ok: true, text: async () => JSON.stringify({ content: [] }) };
  };
  await callAnthropic({ model: 'm', max_tokens: 1, messages: [] });
  assert.ok(seenSignal instanceof AbortSignal, 'fetch must receive an AbortSignal');
});

test('a hung request is aborted at the per-call timeout', async () => {
  global.fetch = (url, opts) => new Promise((resolve, reject) => {
    // Simulate a provider that never answers: settle only when aborted,
    // rejecting with the signal's TimeoutError like undici does.
    opts.signal.addEventListener('abort', () => reject(opts.signal.reason));
  });
  await assert.rejects(
    callAnthropic({ model: 'm', max_tokens: 1, messages: [] }, { timeoutMs: 30 }),
    (err) => err.name === 'TimeoutError' || /timeout/i.test(String(err?.message)),
  );
});

test('an explicit per-call timeout overrides the default', async () => {
  const started = Date.now();
  global.fetch = (url, opts) => new Promise((resolve, reject) => {
    opts.signal.addEventListener('abort', () => reject(opts.signal.reason));
  });
  await assert.rejects(callAnthropic({ model: 'm' }, { timeoutMs: 20 }));
  // Bounded fast — nowhere near the 240s default.
  assert.ok(Date.now() - started < 5_000);
});
