'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { readResponseBuffer, readResponseText, safeFetch, validateUrl } = require('../../../api/_lib/safe-fetch.cjs');

describe('validateUrl — SSRF protection', () => {
  const blocked = [
    ['localhost by name', 'http://localhost/admin'],
    ['127.0.0.1', 'http://127.0.0.1/'],
    ['127.x.x.x range', 'http://127.0.0.2/'],
    ['0.0.0.0', 'http://0.0.0.0/'],
    ['10.x.x.x private', 'http://10.1.2.3/api'],
    ['172.16.x.x private', 'http://172.16.0.1/'],
    ['172.31.x.x private', 'http://172.31.255.255/'],
    ['192.168.x.x private', 'http://192.168.1.1/'],
    ['link-local / metadata IP', 'http://169.254.169.254/latest/meta-data/'],
    ['non-http scheme ftp', 'ftp://example.com/file'],
    ['non-http scheme file', 'file:///etc/passwd'],
    ['IPv6 loopback', 'http://[::1]/'],
    ['invalid URL', 'not-a-url'],
  ];

  for (const [label, url] of blocked) {
    test(`blocks ${label}`, async () => {
      await assert.rejects(
        () => validateUrl(url),
        (err) => {
          assert.ok(
            err.message.startsWith('SSRF_BLOCKED') || err.message.includes('invalid URL'),
            `Expected SSRF_BLOCKED, got: ${err.message}`
          );
          return true;
        }
      );
    });
  }

  test('rejects non-https/http schemes', async () => {
    await assert.rejects(() => validateUrl('javascript://evil'), /SSRF_BLOCKED/);
  });
});

describe('safeFetch — redirect and body-size protection', () => {
  const originalFetch = global.fetch;

  test('blocks redirects to private/internal URLs', async (t) => {
    t.after(() => {
      global.fetch = originalFetch;
    });

    global.fetch = async () => new Response('', {
      status: 302,
      headers: { location: 'http://127.0.0.1/admin' },
    });

    await assert.rejects(
      () => safeFetch('http://93.184.216.34/start'),
      /SSRF_BLOCKED/
    );
  });

  test('readResponseText rejects oversized bodies without content-length', async () => {
    const response = new Response('abcdef', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });

    await assert.rejects(
      () => readResponseText(response, 4),
      /response too large/
    );
  });

  test('readResponseText returns body within limit', async () => {
    const response = new Response('safe body', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });

    assert.equal(await readResponseText(response, 100), 'safe body');
  });

  test('readResponseBuffer rejects oversized binary bodies without content-length', async () => {
    const response = new Response(Buffer.from('abcdef'), {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    });

    await assert.rejects(
      () => readResponseBuffer(response, 4),
      /response too large/
    );
  });

  test('readResponseBuffer returns binary body within limit', async () => {
    const response = new Response(Buffer.from('safe body'), {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    });

    assert.equal((await readResponseBuffer(response, 100)).toString('utf8'), 'safe body');
  });
});
