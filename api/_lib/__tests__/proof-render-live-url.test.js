// proof-render-live-url.test.js — Studio Deterministic Final Render, "Live
// URL wired to Final Render" wiring round. Covers resolveDeviceLiveUrl's
// SSRF-validation gate for app/api/dashboard/proof-render/route.js's own
// devicePrimary.liveUrl handling — DI-injected `validateUrl` throughout, so
// this never performs a real DNS lookup or hits the network.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveDeviceLiveUrl } = require('../proof-render-live-url.cjs');

function fakeValidateUrlOk(rawUrl) {
  return async () => new URL(rawUrl);
}

const PASSTHROUGH_VALIDATE = async (rawUrl) => new URL(rawUrl);

test('a non-string liveUrl resolves to undefined — nothing to validate', async () => {
  await Promise.all([undefined, null, 42, {}, []].map(async (v) => {
    assert.equal(await resolveDeviceLiveUrl(v, { validateUrl: PASSTHROUGH_VALIDATE }), undefined);
  }));
});

test('a blank/whitespace-only liveUrl resolves to undefined', async () => {
  assert.equal(await resolveDeviceLiveUrl('', { validateUrl: PASSTHROUGH_VALIDATE }), undefined);
  assert.equal(await resolveDeviceLiveUrl('   ', { validateUrl: PASSTHROUGH_VALIDATE }), undefined);
});

test('a bare domain with no scheme is prefixed with https:// before validation', async () => {
  let seen = null;
  const validateUrl = async (u) => { seen = u; return new URL(u); };
  const result = await resolveDeviceLiveUrl('hitloop.agency', { validateUrl });
  assert.equal(seen, 'https://hitloop.agency');
  assert.equal(result, 'https://hitloop.agency/');
});

test('an already-schemed http:// URL is left alone (not forced to https)', async () => {
  let seen = null;
  const validateUrl = async (u) => { seen = u; return new URL(u); };
  await resolveDeviceLiveUrl('http://example.com', { validateUrl });
  assert.equal(seen, 'http://example.com');
});

test('an already-schemed https:// URL passes through unchanged (scheme + trailing whitespace trimmed)', async () => {
  const result = await resolveDeviceLiveUrl('  https://hitloop.agency/path?x=1  ', { validateUrl: PASSTHROUGH_VALIDATE });
  assert.equal(result, 'https://hitloop.agency/path?x=1');
});

test('the resolved value is validateUrl\'s own normalized toString(), not the raw input', async () => {
  const validateUrl = async () => new URL('https://normalized.example.com/canonical');
  const result = await resolveDeviceLiveUrl('https://normalized.example.com', { validateUrl });
  assert.equal(result, 'https://normalized.example.com/canonical');
});

test('validateUrl rejecting an unsafe URL (SSRF_BLOCKED) throws a clean, prefix-stripped 400 error', async () => {
  const validateUrl = async () => { throw new Error('SSRF_BLOCKED: private IPv4 "10.0.0.5"'); };
  await assert.rejects(
    () => resolveDeviceLiveUrl('http://10.0.0.5/', { validateUrl }),
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /devicePrimary\.liveUrl can't be captured/);
      assert.match(err.message, /private IPv4 "10\.0\.0\.5"/);
      assert.ok(!err.message.includes('SSRF_BLOCKED'), 'the raw SSRF_BLOCKED: prefix must never leak to the client');
      return true;
    },
  );
});

test('validateUrl rejecting an invalid URL surfaces that reason precisely', async () => {
  const validateUrl = async () => { throw new Error('SSRF_BLOCKED: invalid URL'); };
  await assert.rejects(
    () => resolveDeviceLiveUrl('not a url at all', { validateUrl }),
    /devicePrimary\.liveUrl can't be captured: invalid URL/,
  );
});

test('the real (non-injected) validateUrl is the default DI value — proves the module wires safe-fetch.cjs, without this test itself needing network access', async () => {
  // localhost is rejected synchronously by safe-fetch.cjs (no DNS lookup
  // needed for that specific case), so this exercises the REAL default
  // wiring without making this test dependent on network/DNS availability.
  await assert.rejects(
    () => resolveDeviceLiveUrl('http://localhost:3000/'),
    /devicePrimary\.liveUrl can't be captured: localhost not allowed/,
  );
});

test('sanity: fakeValidateUrlOk helper mirrors a real successful validateUrl call shape (URL object with toString())', async () => {
  const result = await resolveDeviceLiveUrl('https://ok.example.com', { validateUrl: fakeValidateUrlOk('https://ok.example.com') });
  assert.equal(result, 'https://ok.example.com/');
});
