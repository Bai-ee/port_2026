'use strict';

// Phase 2 (docs/plans/BRIEF-RENDERED-SCRAPE-SONNET-HANDOFF.md §3): og:image
// artifact inspection (L3 "inspect the artifact" — present is not a finding).
//
// safeFetch/validateUrl are swapped for in-memory fakes BEFORE site-fetcher.js
// is required (same pattern as site-fetcher-rendered-fallback.test.js), so no
// real network/DNS call happens for the default (unmocked) `fetchImage` path
// either. `validateShouldBlock` lets one test exercise the REAL SSRF check
// site-fetcher.js runs before ever calling fetchImage.

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');

const safeFetchLib = require('../../../api/_lib/safe-fetch.cjs');
const originalSafeFetch = safeFetchLib.safeFetch;
const originalValidateUrl = safeFetchLib.validateUrl;

let fakeResponse = null; // { body, status, headers }
let validateShouldBlock = false;

safeFetchLib.validateUrl = async () => {
  if (validateShouldBlock) throw new Error('SSRF_BLOCKED: test-blocked host');
};
safeFetchLib.safeFetch = async () => {
  if (!fakeResponse) return new Response('', { status: 404, headers: {} });
  return new Response(fakeResponse.body, { status: fakeResponse.status || 200, headers: fakeResponse.headers || {} });
};

test.after(() => {
  safeFetchLib.safeFetch = originalSafeFetch;
  safeFetchLib.validateUrl = originalValidateUrl;
});

const { inspectOgImageArtifact, MAX_OG_IMAGE_BYTES } = require('../site-fetcher.js');

test('no og:image URL: skipped, fetchImage never invoked', async () => {
  fakeResponse = null;
  let called = false;
  const result = await inspectOgImageArtifact(null, { fetchImage: async () => { called = true; return { ok: false }; } });
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'no_og_image');
  assert.equal(result.artifact, null);
  assert.equal(called, false);
});

test('happy path: decodes with sharp, records bytes/contentType/dimensions/host', async () => {
  const png = await sharp({ create: { width: 40, height: 20, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();
  fakeResponse = { body: png, headers: { 'content-type': 'image/png' } };

  const result = await inspectOgImageArtifact('https://cdn.example.com/og.png');

  assert.equal(result.status, 'ran');
  assert.equal(result.reason, null);
  assert.ok(result.artifact);
  assert.equal(result.artifact.contentType, 'image/png');
  assert.equal(result.artifact.width, 40);
  assert.equal(result.artifact.height, 20);
  assert.equal(result.artifact.host, 'cdn.example.com');
  assert.equal(result.artifact.bytes, png.length);
});

test('oversized: a declared content-length over the cap fails cleanly, never invokes sharp', async () => {
  fakeResponse = {
    body: Buffer.from('x'),
    headers: { 'content-type': 'image/png', 'content-length': String(MAX_OG_IMAGE_BYTES + 1) },
  };

  const result = await inspectOgImageArtifact('https://cdn.example.com/huge.png');

  assert.equal(result.status, 'failed');
  assert.equal(result.artifact, null);
  assert.ok(/too large/.test(result.reason || ''), `expected an oversized reason, got: ${JSON.stringify(result.reason)}`);
});

test('undecodable image: records what it can (bytes/contentType/host), leaves width/height null, still "ran"', async () => {
  const garbage = Buffer.from('this is not a real image, just plain bytes');
  fakeResponse = { body: garbage, headers: { 'content-type': 'image/png' } };

  const result = await inspectOgImageArtifact('https://cdn.example.com/corrupt.png');

  assert.equal(result.status, 'ran');
  assert.equal(result.reason, null);
  assert.ok(result.artifact);
  assert.equal(result.artifact.width, null);
  assert.equal(result.artifact.height, null);
  assert.equal(result.artifact.bytes, garbage.length);
  assert.equal(result.artifact.contentType, 'image/png');
  assert.equal(result.artifact.host, 'cdn.example.com');
});

test('invalid/blocked URL: real SSRF validation runs the same as page URLs — failed, fetchImage never called', async () => {
  validateShouldBlock = true;
  let called = false;
  try {
    const result = await inspectOgImageArtifact('https://blocked.example.com/og.png', {
      fetchImage: async () => { called = true; return { ok: true, buffer: Buffer.from('x') }; },
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.reason, 'ssrf_blocked');
    assert.equal(result.artifact, null);
    assert.equal(called, false, 'fetchImage must never run once SSRF validation rejects the URL');
  } finally {
    validateShouldBlock = false;
  }
});

test('fetch failure (network/timeout style error from the injected fetcher): failed with the underlying reason, never throws', async () => {
  const result = await inspectOgImageArtifact('https://cdn.example.com/og.png', {
    fetchImage: async () => ({ ok: false, reason: 'timeout' }),
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'timeout');
  assert.equal(result.artifact, null);
});

test('injected fetchImage throws: caught, never propagates', async () => {
  const result = await inspectOgImageArtifact('https://cdn.example.com/og.png', {
    fetchImage: async () => { throw new Error('boom'); },
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'boom');
});
