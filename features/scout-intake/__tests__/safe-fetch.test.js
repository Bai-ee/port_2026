'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { validateUrl } = require('../../../api/_lib/safe-fetch.cjs');

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
