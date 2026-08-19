'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_PRODUCTION_ORIGIN,
  digestSelfOrigin,
  workerAuthHeaders,
  fetchWorkerJson,
} = require('../digest-self-origin.cjs');

const ENV_KEYS = ['DIGEST_SELF_ORIGIN', 'NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_SITE_URL', 'PUBLIC_APP_URL', 'APP_URL', 'VERCEL_URL', 'CRON_SECRET', 'WORKER_SECRET'];
let savedEnv;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

// ── Origin resolution ────────────────────────────────────────────────────────

test('defaults to the custom production domain', () => {
  assert.equal(digestSelfOrigin(), DEFAULT_PRODUCTION_ORIGIN);
});

test('env override wins, trailing slashes stripped', () => {
  process.env.DIGEST_SELF_ORIGIN = 'https://example.test///';
  assert.equal(digestSelfOrigin(), 'https://example.test');
});

test('NEVER falls back to VERCEL_URL — it is an SSO-protected host', () => {
  // The 2026-08-18 root cause: any self-request to a *.vercel.app host of this
  // project lands on the vercel.com login page, not the app.
  process.env.VERCEL_URL = 'port-2026-xyz-baiees-projects.vercel.app';
  assert.equal(digestSelfOrigin(), DEFAULT_PRODUCTION_ORIGIN);
});

test('worker auth prefers CRON_SECRET bearer, falls back to WORKER_SECRET header', () => {
  process.env.CRON_SECRET = 's3cret';
  process.env.WORKER_SECRET = 'w0rker';
  assert.equal(workerAuthHeaders().authorization, 'Bearer s3cret');
  delete process.env.CRON_SECRET;
  assert.equal(workerAuthHeaders()['x-worker-secret'], 'w0rker');
});

// ── Sub-response contract ────────────────────────────────────────────────────

function fakeResponse({ status = 200, contentType = 'application/json', body = {}, jsonThrows = false } = {}) {
  return {
    status,
    headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? contentType : null) },
    json: async () => {
      if (jsonThrows) throw new Error('Unexpected token <');
      return body;
    },
  };
}

test('a real JSON response counts as executed', async () => {
  const out = await fetchWorkerJson('https://x.test/api', {
    fetchImpl: async () => fakeResponse({ status: 207, body: { ok: false, reason: 'partial' } }),
  });
  assert.equal(out.executed, true);
  assert.equal(out.status, 207);
  assert.equal(out.body.reason, 'partial');
});

test('a 200 HTML page (SSO login) is NOT executed and names status + content type', async () => {
  // Exactly the failure that was stamped "ok" / "Email provider did not
  // return an id." — must now be a loud, honest failure.
  const out = await fetchWorkerJson('https://x.test/api', {
    fetchImpl: async () => fakeResponse({ status: 200, contentType: 'text/html; charset=utf-8' }),
  });
  assert.equal(out.executed, false);
  assert.match(out.reason, /HTTP 200/);
  assert.match(out.reason, /text\/html/);
  assert.match(out.reason, /did not execute/);
});

test('a redirect (fetch rejects under redirect:error) is NOT executed', async () => {
  const out = await fetchWorkerJson('https://x.test/api', {
    fetchImpl: async (url, opts) => {
      assert.equal(opts.redirect, 'error'); // the contract: never follow an SSO redirect
      throw new Error('unexpected redirect');
    },
  });
  assert.equal(out.executed, false);
  assert.match(out.reason, /sub-request failed: unexpected redirect/);
});

test('JSON content-type with an unparseable body is NOT executed', async () => {
  const out = await fetchWorkerJson('https://x.test/api', {
    fetchImpl: async () => fakeResponse({ status: 502, jsonThrows: true }),
  });
  assert.equal(out.executed, false);
  assert.match(out.reason, /HTTP 502/);
  assert.match(out.reason, /unparseable JSON/);
});
