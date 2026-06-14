'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// Test the hasValidCronSecret logic extracted from the daily-digest route.
// The key invariant: in production, missing CRON_SECRET must return false.

function hasValidCronSecret(cronSecret, provided, env = {}) {
  if (!cronSecret) {
    if (env.VERCEL_ENV === 'production' || env.NODE_ENV === 'production') {
      return false; // fail closed in production
    }
    return true; // allow in dev/preview
  }
  return provided === `Bearer ${cronSecret}`;
}

describe('cron auth — fail closed in production', () => {
  test('missing CRON_SECRET fails closed in production (VERCEL_ENV)', () => {
    assert.equal(hasValidCronSecret(undefined, undefined, { VERCEL_ENV: 'production' }), false);
  });

  test('missing CRON_SECRET fails closed in production (NODE_ENV)', () => {
    assert.equal(hasValidCronSecret(undefined, undefined, { NODE_ENV: 'production' }), false);
  });

  test('missing CRON_SECRET allows in dev', () => {
    assert.equal(hasValidCronSecret(undefined, undefined, { NODE_ENV: 'development' }), true);
  });

  test('missing CRON_SECRET allows when no env set (local)', () => {
    assert.equal(hasValidCronSecret(undefined, undefined, {}), true);
  });

  test('valid cron secret is accepted', () => {
    assert.equal(hasValidCronSecret('my-secret', 'Bearer my-secret', { VERCEL_ENV: 'production' }), true);
  });

  test('wrong cron secret is rejected', () => {
    assert.equal(hasValidCronSecret('my-secret', 'Bearer wrong-secret', { VERCEL_ENV: 'production' }), false);
  });

  test('missing provided token with set secret is rejected', () => {
    assert.equal(hasValidCronSecret('my-secret', undefined, { VERCEL_ENV: 'production' }), false);
  });
});
