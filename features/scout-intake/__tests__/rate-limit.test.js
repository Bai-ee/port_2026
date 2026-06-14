'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// Test getClientIp — pure function, no Firestore dependency
const { getClientIp } = require('../../../api/_lib/rate-limit.cjs');

describe('getClientIp', () => {
  test('extracts first IP from x-forwarded-for', () => {
    const req = { headers: { get: (h) => h === 'x-forwarded-for' ? '1.2.3.4, 5.6.7.8' : null } };
    assert.equal(getClientIp(req), '1.2.3.4');
  });

  test('trims whitespace from forwarded IP', () => {
    const req = { headers: { get: (h) => h === 'x-forwarded-for' ? '  9.9.9.9  ' : null } };
    assert.equal(getClientIp(req), '9.9.9.9');
  });

  test('falls back to x-real-ip when no forwarded-for', () => {
    const req = { headers: { get: (h) => h === 'x-real-ip' ? '10.0.0.1' : null } };
    assert.equal(getClientIp(req), '10.0.0.1');
  });

  test('returns unknown when no IP headers present', () => {
    const req = { headers: { get: () => null } };
    assert.equal(getClientIp(req), 'unknown');
  });

  test('handles plain object headers (non-Web API)', () => {
    const req = { headers: { 'x-forwarded-for': '3.3.3.3, 4.4.4.4' } };
    assert.equal(getClientIp(req), '3.3.3.3');
  });
});

describe('rate-limit key sanitization', () => {
  // Sanity-check that the key format the route would build is safe
  test('anon IP key format does not exceed 200 chars', () => {
    const ip = '255.255.255.255';
    const route = 'create-payment-intent';
    const key = `anon:${ip}:${route}`.replace(/[^a-zA-Z0-9:@._-]/g, '_').slice(0, 200);
    assert.ok(key.length <= 200);
    assert.ok(key.startsWith('anon:'));
  });
});
